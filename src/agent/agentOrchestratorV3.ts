import { createHash, randomUUID } from 'node:crypto';
import express, { type Request, type Router } from 'express';
import { rateLimit, type AugmentedRequest } from 'express-rate-limit';
import { executeToolWithPermission, type ToolName, type ToolParams, type ToolExecutionContext } from './toolRegistry.js';
import { verifyAndSelfFixArtifact } from './autoVerificationEngine.js';
import { verifyBeforeReportingCompletion } from './completionVerificationGate.js';
import { saveCheckpoint } from './checkpointManager.js';
import { assertCanReportCompleted } from './taskExecutionGate.js';
import { createAgentTaskGraph } from './agentTaskGraph.js';
import { executeNextTask } from './taskGraphExecutor.js';
import { AgentRunSession } from './agentRunContract.js';
import { approvalDigest, type AgentApprovalOperation } from './agentApproval.js';
import { issueApprovalCapability, issuePlanCapability, latestApprovalExpiryForPlan, v3CapabilityConfigured, verifyApprovalCapability, verifyPlanCapability, type AgentApprovalAuthModeV3 } from './agentV3Capability.js';
import { planAgentToolsV3 } from './agentToolPlannerV3.js';
import { agentOperatorAuthorizationModeV3, agentOperatorConfiguredV3, authenticateAgentOperatorV3 } from './agentOperatorAuthV3.js';
import type { AgentCodeDelegationPort } from './agentCodingDelegationV14.js';
import { advanceAgentRun, resolveStepParams, textualArtifactOf } from './agentRunAdvancer.js';
import type { AgentRunRecord, AgentRunStore } from './agentRunRecord.js';
import { isAgentRunRecordStatus, MAX_AGENT_RUN_TTL_MS, type AgentRunRecordStatus } from './agentRunRecord.js';
import { createOriginChatRateLimiter } from '../server/originSecurity.js';

const TOOL_NAMES: readonly ToolName[] = ['code_interpreter', 'document_generator', 'web_search_grounding', 'image_prompt_compiler', 'repository_explorer', 'file_reader', 'file_writer', 'verification_runner'];
const isToolName = (value: unknown): value is ToolName => typeof value === 'string' && TOOL_NAMES.includes(value as ToolName);
const MAX_EXECUTION_STEPS = 4;
const STEP_TITLES: Record<ToolName, string> = {
  repository_explorer: 'Explore repository structure',
  file_reader: 'Read the target file',
  web_search_grounding: 'Research with grounded sources',
  code_interpreter: 'Generate or repair code (V14 pipeline)',
  document_generator: 'Generate the document',
  image_prompt_compiler: 'Compile the image prompt',
  file_writer: 'Write the file',
  verification_runner: 'Run verification',
};
const createExecutionId = () => `exec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const digestGoal = (goal: string) => createHash('sha256').update(goal).digest('hex');
const digestParams = (params: ToolParams) => createHash('sha256').update(JSON.stringify(params)).digest('hex');

export type AgentStepInputV3 = { toolName: ToolName; params: ToolParams };

/**
 * Canonical form shared by plan issuance, approval, and execution. A single
 * step keeps the exact legacy operation/params-digest shape so capabilities
 * issued before multi-step plans existed remain verifiable.
 */
function canonicalParamsDigest(steps: AgentStepInputV3[]): string {
  if (steps.length === 1) return digestParams(steps[0].params);
  return createHash('sha256').update(JSON.stringify(steps.map(step => [step.toolName, step.params]))).digest('hex');
}

function canonicalOperation(runId: string, steps: AgentStepInputV3[]): AgentApprovalOperation {
  if (steps.length === 1) return { action: 'execute', runId, toolName: steps[0].toolName, params: steps[0].params };
  return { action: 'execute', runId, steps };
}

function parseStepInputs(body: unknown): AgentStepInputV3[] | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const raw: unknown[] | null = Array.isArray(record.steps)
    ? record.steps
    : record.toolName !== undefined
      ? [{ toolName: record.toolName, params: record.params ?? {} }]
      : null;
  if (!raw || raw.length < 1 || raw.length > MAX_EXECUTION_STEPS) return null;
  const steps: AgentStepInputV3[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const candidate = item as { toolName?: unknown; params?: unknown };
    if (!isToolName(candidate.toolName)) return null;
    const params = candidate.params ?? {};
    if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
    steps.push({ toolName: candidate.toolName, params: params as ToolParams });
  }
  return steps;
}

/**
 * Browser approval is only meaningful for requests a browser actually made:
 * fetch POSTs always carry an Origin header, and it must be same-origin
 * (matching Host, or the configured APP_URL) under the same rule the chat
 * boundary applies. Requests without a valid same-origin Origin header fall
 * back to the operator credential path.
 */
function isSameOriginBrowserRequest(req: express.Request, env: NodeJS.ProcessEnv): boolean {
  const origin = req.get('origin');
  if (!origin) return false;
  let parsed: URL;
  try { parsed = new URL(origin); } catch { return false; }
  const host = req.get('host');
  if (host && parsed.host === host) return true;
  const configured = env.APP_URL;
  if (configured) {
    try { if (new URL(configured).origin === parsed.origin) return true; } catch { /* fall through */ }
  }
  return false;
}

function extractExplicitPath(normalized: string): string | undefined {
  return normalized.match(/`([^`\r\n]{1,240})`/)?.[1]
    ?? normalized.match(/(?:^|\s)((?:\.{0,2}\/)?[A-Za-z0-9_@./-]+\.[A-Za-z0-9_-]{1,12})(?![A-Za-z0-9_.-])/)?.[1];
}

function extractDocumentTitle(normalized: string): string {
  const title = normalized
    .replace(/[。.!！?？]+$/u, '')
    .replace(/(?:を)?(?:作成|作製|生成|執筆)(?:して)?(?:ください|下さい)?$/u, '')
    .replace(/(?:して)?(?:ください|下さい)$/u, '')
    .trim()
    .slice(0, 80);
  return title || '文書';
}

function documentOutlineFor(normalized: string): string[] {
  if (/議事録/.test(normalized)) return ['会議概要', '決定事項', '検討事項', 'アクションアイテム'];
  if (/週次|報告書|\breport\b/i.test(normalized)) return ['進捗サマリー', '主な実績', '課題と対策', '来週の予定'];
  if (/提案書|企画書|\bproposal\b/i.test(normalized)) return ['目的', '背景と課題', '提案内容', '期待効果', '実施計画'];
  if (/メモ|\bmemo\b/i.test(normalized)) return ['要点', '詳細', '次のアクション'];
  return ['概要', '本文', 'まとめ'];
}

function detectCodeLanguage(normalized: string, fenceLanguage?: string): string | undefined {
  const fence = (fenceLanguage ?? '').toLowerCase();
  const fenceMap: Record<string, string> = { py: 'python', python: 'python', ts: 'typescript', typescript: 'typescript', js: 'javascript', javascript: 'javascript', sql: 'sql', rust: 'rust', go: 'go' };
  if (fence && fenceMap[fence]) return fenceMap[fence];
  if (/python|パイソン/i.test(normalized)) return 'python';
  if (/typescript/i.test(normalized)) return 'typescript';
  if (/javascript/i.test(normalized)) return 'javascript';
  if (/\bsql\b/i.test(normalized)) return 'sql';
  if (/rust/i.test(normalized)) return 'rust';
  return undefined;
}

function generatedParams(toolName: ToolName, goal: string, options?: { contentFromPreviousArtifact?: boolean }): ToolParams {
  const normalized = goal.normalize('NFKC').trim();
  const explicitPath = extractExplicitPath(normalized);
  if (toolName === 'web_search_grounding') {
    const query = normalized
      .replace(/^(?:最新の|現在の|最近の)?/u, '')
      .replace(/(?:について)?(?:を)?(?:調べて(?:ください)?|調査して(?:ください)?|検索して(?:ください)?|リサーチして(?:ください)?|教えて(?:ください)?)[。.!！?？]*$/u, '')
      .trim();
    return { query: query || normalized };
  }
  if (toolName === 'file_writer') {
    if (options?.contentFromPreviousArtifact) {
      return { path: explicitPath?.trim() || 'artifacts/document.md', contentFromPreviousArtifact: true };
    }
    const isSalesTable = /売上(?:表|管理|一覧|データ)|sales\s*table/i.test(normalized);
    const path = explicitPath?.trim() || (isSalesTable ? 'artifacts/sales-table.csv' : 'artifacts/request-draft.md');
    const fenced = normalized.match(/```(?:[A-Za-z0-9_.+-]+)?\s*\n([\s\S]*?)```/)?.[1]?.trimEnd();
    let content = fenced ? `${fenced}\n` : '';
    if (!content && (isSalesTable || /\.csv$/i.test(path))) {
      content = '日付,商品,数量,単価,売上\n2026-10-01,サンプル商品A,2,1500,=C2*D2\n2026-10-02,サンプル商品B,1,2800,=C3*D3\n合計,,,,=SUM(E2:E3)\n';
    }
    if (!content) {
      const title = normalized.slice(0, 80).replace(/[。.!！?？]+$/u, '') || '作成物のたたき台';
      content = `# ${title}\n\n## 目的\n${normalized}\n\n## 前提\n- 詳細指定がないため、一般的な実務用途を想定した初版です。\n- 数値・固有情報は、確認できるまでサンプルまたは仮置きとして扱います。\n\n## たたき台\n- 目的に沿った基本構成を用意しました。\n- 実データや運用条件に合わせて調整してください。\n`;
    }
    return { path, content };
  }
  if (toolName === 'file_reader') return explicitPath ? { path: explicitPath.trim() } : {};
  if (toolName === 'repository_explorer') return {};
  if (toolName === 'image_prompt_compiler') return { prompt: normalized };
  if (toolName === 'document_generator') {
    const fenced = normalized.match(/```(?:[A-Za-z0-9_.+-]+)?\s*\n([\s\S]*?)```/)?.[1]?.trim();
    const format = /docx|\bword\b/i.test(normalized) ? 'docx'
      : /\bpdf\b/i.test(normalized) ? 'pdf'
        : /xlsx|\bexcel\b/i.test(normalized) ? 'xlsx'
          : /\bcsv\b/i.test(normalized) ? 'csv'
            : 'markdown';
    return {
      title: extractDocumentTitle(normalized),
      format,
      brief: normalized,
      outline: documentOutlineFor(normalized),
      ...(fenced ? { content: fenced } : {}),
    };
  }
  if (toolName === 'code_interpreter') {
    // Structured parameters generated from the goal: an embedded fenced code
    // block becomes provided-code mode; otherwise the goal becomes an
    // instruction for the V14 pipeline. The goal text itself is never copied
    // into a `code` field again.
    const fenced = normalized.match(/```([A-Za-z0-9_.+-]+)?\s*\n([\s\S]*?)```/);
    const language = detectCodeLanguage(normalized, fenced?.[1]);
    if (fenced && fenced[2]?.trim()) {
      const instruction = normalized.replace(/```[\s\S]*?```/, '').replace(/\s+/g, ' ').trim()
        || '与えられたコードを検証し、必要な修正を行ってください。';
      return { mode: 'provided-code', instruction, code: fenced[2].trim(), ...(language ? { language } : {}) };
    }
    return {
      mode: 'generate',
      instruction: normalized,
      ...(language ? { language } : {}),
      ...(explicitPath ? { targetPath: explicitPath.trim() } : {}),
    };
  }
  const value = normalized.toLowerCase();
  const kinds = ([
    ['test', /\btest(?:s|ing)?\b|テスト/],
    ['typecheck', /\btype[- ]?check(?:ing)?\b|型チェック/],
    ['lint', /\blint(?:ing)?\b|リント/],
    ['build', /\bbuild(?:ing)?\b|ビルド/],
  ] as const).filter(([, pattern]) => pattern.test(value));
  return kinds.length === 1 ? { kind: kinds[0][0] } : {};
}


/** Must atomically reserve a run across all server instances until expiresAt.
 * Return false for a previously reserved run. Never release after a tool failure.
 * No process-local default: serverless instances cannot share an in-memory map.
 */
export interface AgentRunConsumptionStore {
  consume(runId: string, expiresAt: number): Promise<boolean>;
}

export function createAgentOrchestratorV3Router(env: NodeJS.ProcessEnv = process.env, consumptionStore?: AgentRunConsumptionStore, deps?: { codeDelegation?: AgentCodeDelegationPort; runStore?: AgentRunStore }): Router {
  const router = express.Router();
  // Outer guard: express-rate-limit, the standard library that static
  // analysis (CodeQL js/missing-rate-limiting) recognizes as rate limiting.
  // It enforces the sustained ceiling of 60 requests per minute per IP and
  // answers with the same 429 contract as the inner limiter below
  // (CHAT_RATE_LIMITED + Retry-After).
  const agentV3RateLimitGuard = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      const resetTime = (req as AugmentedRequest).rateLimit?.resetTime;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(((resetTime?.getTime() ?? Date.now() + 60_000) - Date.now()) / 1_000),
      );
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        code: 'CHAT_RATE_LIMITED',
        message: '短時間の依頼が集中しています。少し待ってから再度お試しください。',
        retryable: true,
        requestId: `origin-${randomUUID()}`,
        retryAfterSeconds,
        retryAfterMs: retryAfterSeconds * 1_000,
      });
    },
  });
  // Inner enforcement: one shared limiter instance is passed directly as
  // middleware to each POST route defined below, so all five routes draw
  // on the same token bucket with the shared thresholds (burst 8,
  // sustained 60/min, concurrency 2) and the CHAT_RATE_LIMITED /
  // Retry-After contract. GET /status is read-only and stays unmetered.
  const agentV3RateLimiter = createOriginChatRateLimiter(Date.now, ['POST']);
  const toolContext: ToolExecutionContext = { codeDelegation: deps?.codeDelegation };
  const runStore = deps?.runStore;

  router.get('/api/agent/v3/status', (_req, res) => {
    const approvalSigningConfigured = v3CapabilityConfigured(env);
    const operatorAuthenticationConfigured = agentOperatorConfiguredV3(env);
    const authorizationMode = agentOperatorAuthorizationModeV3(env);
    const replayProtectionConfigured = Boolean(consumptionStore);
    return res.status(200).json({
      ok: true,
      protocolVersion: 3,
      ready: approvalSigningConfigured && operatorAuthenticationConfigured && replayProtectionConfigured,
      approvalSigningConfigured,
      operatorAuthenticationConfigured,
      authorizationMode,
      credentialSeparationConfigured: authorizationMode === 'agent-operator',
      replayProtectionConfigured,
      replayProtection: replayProtectionConfigured ? 'shared-atomic' : 'unavailable',
      browserApprovalEnabled: approvalSigningConfigured && replayProtectionConfigured,
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      secretDelivery: authorizationMode === 'agent-operator'
        ? 'signing-secret-server-only'
        : authorizationMode === 'legacy-approval-compat'
          ? 'legacy-shared-credential'
          : 'unavailable',
    });
  });

  router.post('/api/agent/v3/plan', agentV3RateLimitGuard, agentV3RateLimiter, (req, res) => {
    if (!v3CapabilityConfigured(env)) return res.status(503).json({ ok: false, code: 'AGENT_APPROVAL_NOT_CONFIGURED' });
    const goal = req.body?.goal;
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 4000) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_GOAL' });
    const planned = planAgentToolsV3(goal.trim());
    if ('code' in planned) {
      return res.status(422).json({ ok: false, code: planned.code, protocolVersion: 3, candidates: planned.candidates });
    }
    const run = new AgentRunSession();
    run.transition('planning');
    run.transition('awaiting_approval');
    const steps: AgentStepInputV3[] = planned.steps.map((step, index) => ({
      toolName: step.toolName,
      params: generatedParams(step.toolName, goal.trim(), {
        contentFromPreviousArtifact: step.toolName === 'file_writer'
          && index > 0
          && planned.steps[index - 1].toolName === 'document_generator',
      }),
    }));
    const capability = issuePlanCapability(
      run.runId,
      digestGoal(goal.trim()),
      env,
      Date.now(),
      steps[0].toolName,
      canonicalParamsDigest(steps),
      steps.map(step => step.toolName),
    );
    return res.status(201).json({
      ok: true,
      protocolVersion: 3,
      runId: run.runId,
      status: 'awaiting_approval',
      planToken: capability.token,
      expiresAt: new Date(capability.expiresAt).toISOString(),
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
      persistence: 'stateless-server-signed',
      selectedTool: steps[0].toolName,
      params: steps[0].params,
      steps: planned.steps.map((step, index) => ({
        toolName: step.toolName,
        reasonCode: step.reasonCode,
        params: steps[index].params,
      })),
      toolChoice: { source: 'deterministic-local', reasonCode: planned.steps[0].reasonCode, mode: steps.length > 1 ? 'multi-step' : 'single-step' },
      plan: steps.map((step, index) => ({ id: `task-${index + 1}`, title: STEP_TITLES[step.toolName] })),
    });
  });

  /**
   * Shared approval issuance for both authorization modes. The plan
   * capability binding (run, ordered tool sequence, exact params digest) is
   * identical for operator and browser approvals; only the way the human's
   * approval is authenticated differs, and the issued capability records
   * which mode minted it so execution can require the same mode back.
   */
  const issueBoundApproval = (req: express.Request, res: express.Response, authMode: AgentApprovalAuthModeV3): void => {
    const { runId, planToken } = req.body ?? {};
    if (typeof runId !== 'string' || !runId.startsWith('run-')) { res.status(400).json({ ok: false, code: 'INVALID_AGENT_RUN_ID' }); return; }
    if (typeof planToken !== 'string') { res.status(403).json({ ok: false, code: 'AGENT_PLAN_CAPABILITY_REQUIRED' }); return; }
    const steps = parseStepInputs(req.body);
    if (!steps) { res.status(400).json({ ok: false, code: 'INVALID_TOOL' }); return; }
    // Bind validation and issuance to one instant at the expiry boundary.
    const approvalNow = Date.now();
    const plan = verifyPlanCapability(planToken, env, approvalNow);
    if (!plan || plan.runId !== runId) { res.status(403).json({ ok: false, code: 'AGENT_PLAN_CAPABILITY_INVALID' }); return; }
    const plannedTools = plan.plannedTools ?? (plan.plannedTool ? [plan.plannedTool] : []);
    if (plannedTools.length !== steps.length || plannedTools.some((tool, index) => tool !== steps[index].toolName)) {
      res.status(403).json({ ok: false, code: 'AGENT_PLAN_TOOL_MISMATCH' });
      return;
    }
    if (typeof plan.paramsDigest !== 'string' || plan.paramsDigest !== canonicalParamsDigest(steps)) {
      res.status(403).json({ ok: false, code: 'AGENT_PLAN_PARAMS_MISMATCH' });
      return;
    }
    if (!consumptionStore) { res.status(503).json({ ok: false, code: 'AGENT_REPLAY_PROTECTION_UNAVAILABLE' }); return; }
    const operation = canonicalOperation(runId, steps);
    const capability = issueApprovalCapability(runId, approvalDigest(operation), env, approvalNow, authMode);
    res.status(201).json({
      ok: true,
      protocolVersion: 3,
      runId,
      approvalToken: capability.token,
      expiresAt: new Date(capability.expiresAt).toISOString(),
      scope: 'exact-operation',
      authMode,
    });
  };

  router.post('/api/agent/v3/approval', agentV3RateLimitGuard, agentV3RateLimiter, (req, res) => {
    if (!v3CapabilityConfigured(env)) return res.status(503).json({ ok: false, code: 'AGENT_APPROVAL_NOT_CONFIGURED' });
    if (!agentOperatorConfiguredV3(env)) return res.status(503).json({ ok: false, code: 'AGENT_OPERATOR_AUTH_NOT_CONFIGURED' });
    if (!authenticateAgentOperatorV3(req, env)) return res.status(401).json({ ok: false, code: 'AGENT_AUTHENTICATION_REQUIRED' });
    return issueBoundApproval(req, res, 'operator');
  });

  /**
   * Browser approval: the human approves the exact plan in their own
   * same-origin browser session. No operator credential is involved; the
   * authorization evidence is (1) a same-origin Origin header, which only a
   * page served from this origin can produce in a browser, (2) possession of
   * the HMAC-signed plan capability, and (3) an explicit confirm flag. The
   * issued approval capability is short-lived, bound to the exact operation
   * digest, marked authMode 'browser', and still single-use through the
   * shared replay-consumption store at execution time.
   */
  router.post('/api/agent/v3/browser-approval', agentV3RateLimitGuard, agentV3RateLimiter, (req, res) => {
    if (!v3CapabilityConfigured(env)) return res.status(503).json({ ok: false, code: 'AGENT_APPROVAL_NOT_CONFIGURED' });
    if (!isSameOriginBrowserRequest(req, env)) return res.status(403).json({ ok: false, code: 'AGENT_BROWSER_ORIGIN_REQUIRED' });
    if (req.body?.confirm !== true) return res.status(400).json({ ok: false, code: 'AGENT_CONFIRMATION_REQUIRED' });
    return issueBoundApproval(req, res, 'browser');
  });

  router.post('/api/agent/v3/cancel', agentV3RateLimitGuard, agentV3RateLimiter, (req, res) => {
    if (!agentOperatorConfiguredV3(env)) return res.status(503).json({ ok: false, code: 'AGENT_OPERATOR_AUTH_NOT_CONFIGURED' });
    if (!authenticateAgentOperatorV3(req, env)) return res.status(401).json({ ok: false, code: 'AGENT_AUTHENTICATION_REQUIRED' });
    const { runId, planToken } = req.body ?? {};
    if (typeof runId !== 'string' || !runId.startsWith('run-')) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_RUN_ID' });
    if (typeof planToken !== 'string') return res.status(403).json({ ok: false, code: 'AGENT_PLAN_CAPABILITY_REQUIRED' });
    const plan = verifyPlanCapability(planToken, env);
    if (!plan || plan.runId !== runId) return res.status(403).json({ ok: false, code: 'AGENT_PLAN_CAPABILITY_INVALID' });
    if (!consumptionStore) return res.status(503).json({ ok: false, code: 'AGENT_REPLAY_PROTECTION_UNAVAILABLE' });

    void (async () => {
      try {
        // A last-moment approval can outlive its plan. Keep the cancellation
        // tombstone until every approval that plan could issue has expired.
        const consumed = await consumptionStore.consume(runId, latestApprovalExpiryForPlan(plan.exp));
        if (!consumed) {
          if (!res.headersSent) return res.status(409).json({
            ok: false,
            code: 'AGENT_RUN_ALREADY_CONSUMED',
            protocolVersion: 3,
            runId,
          });
          return;
        }
        if (!res.headersSent) return res.status(200).json({
          ok: true,
          protocolVersion: 3,
          runId,
          status: 'cancelled',
          freeOnly: true,
          costUsd: 0,
          paidFallbackUsed: false,
          cancellation: 'shared-atomic',
        });
      } catch {
        if (!res.headersSent) return res.status(503).json({
          ok: false,
          code: 'AGENT_REPLAY_PROTECTION_UNAVAILABLE',
          protocolVersion: 3,
          runId,
        });
      }
    })();
    return undefined;
  });

  router.post('/api/agent/v3/execute', agentV3RateLimitGuard, agentV3RateLimiter, (req, res) => {
    const { runId, approvalToken } = req.body ?? {};
    // Authorization has two modes. Operator mode (admin) uses the operator
    // credential as before. Browser mode requires a same-origin request plus
    // an approval capability that was minted by the browser approval
    // endpoint (authMode 'browser'); the modes never substitute for each
    // other, and every other request shape keeps the historical failures.
    const operatorAuthenticated = agentOperatorConfiguredV3(env) && authenticateAgentOperatorV3(req, env);
    const browserEligible = !operatorAuthenticated && v3CapabilityConfigured(env) && isSameOriginBrowserRequest(req, env);
    if (!operatorAuthenticated && !browserEligible) {
      if (!agentOperatorConfiguredV3(env)) return res.status(503).json({ ok: false, code: 'AGENT_OPERATOR_AUTH_NOT_CONFIGURED' });
      return res.status(401).json({ ok: false, code: 'AGENT_AUTHENTICATION_REQUIRED' });
    }
    const authMode: AgentApprovalAuthModeV3 = operatorAuthenticated ? 'operator' : 'browser';
    if (typeof runId !== 'string' || !runId.startsWith('run-')) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_RUN_ID' });
    const steps = parseStepInputs(req.body);
    if (!steps) return res.status(400).json({ ok: false, code: 'INVALID_TOOL' });
    if (typeof approvalToken !== 'string') return res.status(403).json({ ok: false, code: 'AGENT_AUTHENTICATED_APPROVAL_REQUIRED' });
    const operation = canonicalOperation(runId, steps);
    const approval = verifyApprovalCapability(approvalToken, env);
    const approvalModeMatches = authMode === 'operator'
      ? approval?.authMode === undefined || approval?.authMode === 'operator'
      : approval?.authMode === 'browser';
    if (!approval || approval.runId !== runId || approval.digest !== approvalDigest(operation) || !approvalModeMatches) {
      return res.status(403).json({ ok: false, code: 'AGENT_AUTHENTICATED_APPROVAL_REQUIRED' });
    }
    if (!consumptionStore) return res.status(503).json({ ok: false, code: 'AGENT_REPLAY_PROTECTION_UNAVAILABLE' });

    const executionId = createExecutionId();
    const executionApproval = { approved: true, costInUSD: 0, safetyPolicyPassed: true };
    void (async () => {
      try {
        // Retain through the entire plan lifetime, including a later approval's TTL.
        // Reserving before execution also prevents concurrent requests and retries.
        let consumed: boolean;
        try {
          consumed = await consumptionStore.consume(runId, Math.max(approval.exp, Date.now() + 12 * 60 * 1000));
        } catch {
          if (!res.headersSent) return res.status(503).json({ ok: false, code: 'AGENT_REPLAY_PROTECTION_UNAVAILABLE', protocolVersion: 3, runId });
          return;
        }
        if (!consumed) return res.status(409).json({ ok: false, code: 'AGENT_RUN_ALREADY_CONSUMED', protocolVersion: 3, runId });
        const runTool = async (name: ToolName, input: ToolParams) => executeToolWithPermission(name, input, executionApproval, toolContext);
        let graph = createAgentTaskGraph(
          `execute ${steps.map(step => step.toolName).join(' + ')}`,
          steps.map(step => step.toolName),
        );
        const stepResults: Array<{ toolName: ToolName; status: string; artifact: string }> = [];
        const checkpoints: unknown[] = [];
        let previousText: string | undefined;
        let failure: { graph: typeof graph; record?: unknown } | null = null;
        for (const [index, step] of steps.entries()) {
          const resolved = resolveStepParams(step, previousText);
          const stepParams = resolved && 'params' in resolved ? resolved.params : step.params;
          const execution = await executeNextTask(graph, async () => {
            if ('error' in resolved) return { ok: false, message: resolved.error };
            return runTool(step.toolName, stepParams);
          }, async (result) => result.artifact
            ? verifyAndSelfFixArtifact(result.artifact, step.toolName, runTool, stepParams)
            : { ok: false, artifact: '', attempts: 0, selfFixed: false, issues: ['empty'] as const, diagnosis: 'No artifact was produced.' });
          graph = execution.graph;
          const record = execution.record;
          const finalTask = execution.graph.tasks[index];
          if (!record?.toolExecuted || !record.verified || record.status !== 'completed' || finalTask.status !== 'completed') {
            failure = { graph: execution.graph, record };
            break;
          }
          assertCanReportCompleted({ state: finalTask.status, verified: record.verified, toolExecuted: record.toolExecuted, repairAttempts: record.verificationAttempts });
          checkpoints.push(saveCheckpoint({ taskId: finalTask.id, executionId, status: record.verificationAttempts > 0 ? 'self_fixed' : 'completed', artifact: record.artifact, mutation: record.mutation }));
          stepResults.push({ toolName: step.toolName, status: record.status, artifact: record.artifact });
          previousText = textualArtifactOf(step.toolName, record.artifact) ?? previousText;
        }
        if (failure) {
          if (!res.headersSent) return res.status(422).json({ ok: false, code: 'ARTIFACT_VERIFICATION_FAILED', protocolVersion: 3, runId, execution: failure });
          return;
        }
        if (steps.some(step => step.toolName === 'file_writer')) {
          const completionVerification = await verifyBeforeReportingCompletion(process.cwd());
          if (!completionVerification.ok) {
            if (!res.headersSent) return res.status(422).json({ ok: false, code: 'COMPLETION_VERIFICATION_FAILED', protocolVersion: 3, runId, completionVerification });
            return;
          }
        }
        const lastStep = steps[steps.length - 1];
        const lastResult = stepResults[stepResults.length - 1];
        if (!res.headersSent) return res.status(200).json({
          ok: true,
          protocolVersion: 3,
          runId,
          status: 'completed',
          freeOnly: true,
          costUsd: 0,
          paidFallbackUsed: false,
          authMode,
          tool: lastStep.toolName,
          artifact: lastResult.artifact,
          checkpoint: checkpoints[checkpoints.length - 1],
          steps: stepResults,
        });
      } catch {
        if (!res.headersSent) return res.status(403).json({ ok: false, code: 'TOOL_EXECUTION_BLOCKED', protocolVersion: 3, runId });
      }
    })();
    return undefined;
  });

  // ---------------------------------------------------------------------
  // Durable run records (multitask Phase 1, PR 1-B): the owner-scoped
  // /runs API over the persisted run store, driven by the separated
  // execution core in agentRunAdvancer.ts. Purely additive — the legacy
  // single-request flow above is unchanged.
  //
  // Owner binding: records bind to a SHA-256 digest, never to a raw
  // credential. Operator mode uses one fixed namespace digest (the operator
  // credential itself is the capability, exactly as on /execute). Browser
  // mode binds to the run's own plan capability token digest: the token is
  // per-run and already the browser-side capability for the run, so holding
  // it proves browser-side ownership of that run (design §11 U5 remains
  // open; the design names this plan-token binding as the fallback until a
  // path-scoped owner binding is decided). Bindings and tokens are never
  // returned or logged.
  const OPERATOR_RUN_OWNER_BINDING = createHash('sha256').update('origin.agent.runs.owner.operator.v1').digest('hex');
  const browserRunOwnerBinding = (planToken: string) => createHash('sha256').update(`origin.agent.runs.owner.browser.v1:${planToken}`).digest('hex');
  const runEnvelope = { freeOnly: true, costUsd: 0, paidFallbackUsed: false } as const;
  const publicAgentRunView = (record: AgentRunRecord) => ({
    runId: record.runId,
    status: record.status,
    goal: record.goal,
    plan: record.plan,
    planDigest: record.planDigest,
    stepsState: record.stepsState,
    parentRunId: record.parentRunId,
    priority: record.priority,
    hold: record.hold,
    quotaLedger: record.quotaLedger,
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
    expiresAt: new Date(record.expiresAt).toISOString(),
  });
  type RunsAuth = { mode: AgentApprovalAuthModeV3; ownerBinding: string };
  const authenticateRunsRequest = (req: Request, planToken: string | undefined, runId?: string): { auth: RunsAuth } | { status: number; code: string } => {
    if (agentOperatorConfiguredV3(env) && authenticateAgentOperatorV3(req, env)) {
      return { auth: { mode: 'operator', ownerBinding: OPERATOR_RUN_OWNER_BINDING } };
    }
    if (v3CapabilityConfigured(env) && isSameOriginBrowserRequest(req, env)) {
      if (typeof planToken !== 'string' || !planToken) return { status: 403, code: 'AGENT_PLAN_CAPABILITY_INVALID' };
      const plan = verifyPlanCapability(planToken, env, Date.now());
      if (!plan || (runId !== undefined && plan.runId !== runId)) return { status: 403, code: 'AGENT_PLAN_CAPABILITY_INVALID' };
      return { auth: { mode: 'browser', ownerBinding: browserRunOwnerBinding(planToken) } };
    }
    if (!agentOperatorConfiguredV3(env) && !v3CapabilityConfigured(env)) return { status: 503, code: 'AGENT_APPROVAL_NOT_CONFIGURED' };
    if (agentOperatorConfiguredV3(env)) return { status: 401, code: 'AGENT_AUTHENTICATION_REQUIRED' };
    return { status: 403, code: 'AGENT_BROWSER_ORIGIN_REQUIRED' };
  };
  const runsStoreUnavailable = (res: express.Response) => res.status(503).json({ ok: false, code: 'AGENT_RUN_STORE_UNAVAILABLE' });

  router.post('/api/agent/v3/runs', agentV3RateLimitGuard, agentV3RateLimiter, async (req, res) => {
    if (!runStore) return runsStoreUnavailable(res);
    const body = (req.body ?? {}) as { runId?: unknown; goal?: unknown; planToken?: unknown; approvalToken?: unknown; priority?: unknown };
    const runId = typeof body.runId === 'string' ? body.runId : '';
    const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
    if (!runId.startsWith('run-') || !goal) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_RUN_REQUEST' });
    const steps = parseStepInputs((req.body ?? {}) as Record<string, unknown>);
    if (!steps) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_EXECUTION_STEPS' });
    const operatorAuthenticated = agentOperatorConfiguredV3(env) && authenticateAgentOperatorV3(req, env);
    const browserEligible = !operatorAuthenticated && v3CapabilityConfigured(env) && isSameOriginBrowserRequest(req, env);
    if (!operatorAuthenticated && !browserEligible) {
      if (!agentOperatorConfiguredV3(env)) return res.status(503).json({ ok: false, code: 'AGENT_OPERATOR_AUTH_NOT_CONFIGURED' });
      return res.status(401).json({ ok: false, code: 'AGENT_AUTHENTICATION_REQUIRED' });
    }
    const mode: AgentApprovalAuthModeV3 = operatorAuthenticated ? 'operator' : 'browser';
    // The browser binding input is only used after the token verifies below.
    const ownerBinding = operatorAuthenticated
      ? OPERATOR_RUN_OWNER_BINDING
      : browserRunOwnerBinding(typeof body.planToken === 'string' ? body.planToken : '');
    if (!v3CapabilityConfigured(env)) return res.status(503).json({ ok: false, code: 'AGENT_APPROVAL_NOT_CONFIGURED' });
    const plan = verifyPlanCapability(typeof body.planToken === 'string' ? body.planToken : undefined, env, Date.now());
    if (!plan || plan.runId !== runId) return res.status(403).json({ ok: false, code: 'AGENT_PLAN_CAPABILITY_INVALID' });
    const plannedTools = plan.plannedTools ?? (plan.plannedTool ? [plan.plannedTool] : []);
    if (plannedTools.length !== steps.length || plannedTools.some((tool, index) => tool !== steps[index].toolName)) {
      return res.status(403).json({ ok: false, code: 'AGENT_PLAN_TOOLS_MISMATCH' });
    }
    const planDigest = canonicalParamsDigest(steps);
    if (plan.paramsDigest !== planDigest) return res.status(403).json({ ok: false, code: 'AGENT_PLAN_PARAMS_MISMATCH' });
    if (plan.digest !== digestGoal(goal)) return res.status(403).json({ ok: false, code: 'AGENT_PLAN_GOAL_MISMATCH' });
    const approval = verifyApprovalCapability(typeof body.approvalToken === 'string' ? body.approvalToken : undefined, env, Date.now());
    if (!approval || approval.runId !== runId || approval.digest !== approvalDigest(canonicalOperation(runId, steps))) {
      return res.status(403).json({ ok: false, code: 'AGENT_APPROVAL_INVALID' });
    }
    if (mode === 'operator' ? (approval.authMode !== undefined && approval.authMode !== 'operator') : approval.authMode !== 'browser') {
      return res.status(403).json({ ok: false, code: 'AGENT_APPROVAL_AUTH_MODE_MISMATCH' });
    }
    try {
      const created = await runStore.create({
        runId,
        ownerBinding,
        goal,
        status: 'queued',
        plan: steps.map((step, index) => ({
          toolName: step.toolName,
          params: step.params,
          dependsOn: index === 0 ? [] : [index - 1],
          ...(step.params.contentFromPreviousArtifact === true && index > 0 ? { inputFrom: index - 1 } : {}),
        })),
        planDigest,
        stepsState: steps.map((_, index) => ({ id: `task-${index + 1}`, status: 'queued' as const, attempts: 0 })),
        priority: typeof body.priority === 'number' ? body.priority : undefined,
        expiresAt: Date.now() + MAX_AGENT_RUN_TTL_MS,
      });
      if (!created) {
        // Idempotent create: the same owner re-submitting the same approved
        // plan gets the existing record back instead of an error.
        const existing = await runStore.get(runId, ownerBinding);
        if (existing && existing.planDigest === planDigest) {
          return res.status(200).json({ ok: true, protocolVersion: 3, persistence: 'durable-run-record', run: publicAgentRunView(existing), ...runEnvelope });
        }
        return res.status(409).json({ ok: false, code: 'AGENT_RUN_ALREADY_EXISTS', runId });
      }
      return res.status(201).json({ ok: true, protocolVersion: 3, persistence: 'durable-run-record', run: publicAgentRunView(created), ...runEnvelope });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.startsWith('AGENT_RUN_')) return res.status(400).json({ ok: false, code: message });
      return runsStoreUnavailable(res);
    }
  });

  router.get('/api/agent/v3/runs', agentV3RateLimitGuard, async (req, res) => {
    if (!runStore) return runsStoreUnavailable(res);
    const planToken = typeof req.headers['x-agent-plan-token'] === 'string' ? req.headers['x-agent-plan-token'] : undefined;
    const resolved = authenticateRunsRequest(req, planToken);
    if ('status' in resolved) return res.status(resolved.status).json({ ok: false, code: resolved.code });
    const statusQuery = typeof req.query.status === 'string' ? req.query.status : undefined;
    const statuses = statusQuery === undefined ? undefined : statusQuery.split(',').map((value) => value.trim()).filter(Boolean);
    if (statuses !== undefined && (statuses.length === 0 || statuses.some((status) => !isAgentRunRecordStatus(status)))) {
      return res.status(400).json({ ok: false, code: 'AGENT_RUN_LIST_INPUT_INVALID' });
    }
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ ok: false, code: 'AGENT_RUN_LIST_INPUT_INVALID' });
    }
    try {
      const runs = await runStore.listByOwner(resolved.auth.ownerBinding, { statuses: statuses as AgentRunRecordStatus[] | undefined, limit });
      return res.json({ ok: true, protocolVersion: 3, runs: runs.map(publicAgentRunView), ...runEnvelope });
    } catch {
      return runsStoreUnavailable(res);
    }
  });

  router.get('/api/agent/v3/runs/:runId', agentV3RateLimitGuard, async (req, res) => {
    if (!runStore) return runsStoreUnavailable(res);
    const runId = typeof req.params.runId === 'string' ? req.params.runId : '';
    if (!runId.startsWith('run-')) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_RUN_ID' });
    const planToken = typeof req.headers['x-agent-plan-token'] === 'string' ? req.headers['x-agent-plan-token'] : undefined;
    const resolved = authenticateRunsRequest(req, planToken, runId);
    if ('status' in resolved) return res.status(resolved.status).json({ ok: false, code: resolved.code });
    try {
      const record = await runStore.get(runId, resolved.auth.ownerBinding);
      if (!record) return res.status(404).json({ ok: false, code: 'AGENT_RUN_NOT_FOUND', runId });
      return res.json({ ok: true, protocolVersion: 3, run: publicAgentRunView(record), ...runEnvelope });
    } catch {
      return runsStoreUnavailable(res);
    }
  });

  router.post('/api/agent/v3/runs/:runId/advance', agentV3RateLimitGuard, agentV3RateLimiter, async (req, res) => {
    if (!runStore) return runsStoreUnavailable(res);
    const runId = typeof req.params.runId === 'string' ? req.params.runId : '';
    if (!runId.startsWith('run-')) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_RUN_ID' });
    const body = (req.body ?? {}) as { planToken?: unknown; budgetMs?: unknown };
    const resolved = authenticateRunsRequest(req, typeof body.planToken === 'string' ? body.planToken : undefined, runId);
    if ('status' in resolved) return res.status(resolved.status).json({ ok: false, code: resolved.code });
    let record: AgentRunRecord | null;
    try {
      record = await runStore.get(runId, resolved.auth.ownerBinding);
    } catch {
      return runsStoreUnavailable(res);
    }
    if (!record) return res.status(404).json({ ok: false, code: 'AGENT_RUN_NOT_FOUND', runId });
    const budgetMs = typeof body.budgetMs === 'number' && Number.isFinite(body.budgetMs)
      ? Math.min(110_000, Math.max(1_000, Math.floor(body.budgetMs)))
      : undefined;
    const outcome = await advanceAgentRun(
      { runStore, consumptionStore, toolContext },
      record,
      `driver-${resolved.auth.mode}-${randomUUID()}`,
      { budgetMs },
    );
    const refreshed = await runStore.get(runId, resolved.auth.ownerBinding).catch(() => null);
    const view = publicAgentRunView(refreshed ?? outcome.record);
    switch (outcome.kind) {
      case 'completed':
        return res.json({ ok: true, protocolVersion: 3, runId, status: 'completed', run: view, ...runEnvelope });
      case 'failed':
        return res.status(422).json({ ok: false, protocolVersion: 3, runId, code: outcome.errorCode, status: 'failed', run: view, ...runEnvelope, error: 'The run failed verification or execution.' });
      case 'progress':
        return res.status(202).json({ ok: true, protocolVersion: 3, runId, status: 'running', advanced: true, run: view, ...runEnvelope });
      case 'busy':
        return res.status(202).json({ ok: true, protocolVersion: 3, runId, status: view.status, advanced: false, code: 'AGENT_RUN_DRIVER_BUSY', run: view, ...runEnvelope });
      case 'unavailable':
        return res.status(503).json({ ok: false, code: outcome.errorCode, runId });
      case 'not_runnable':
        // A held run must re-plan and be re-approved before it can move
        // again (design §8); that resume flow is a later phase, so the run
        // is reported, never advanced, from here.
        if (record.status === 'held') return res.status(409).json({ ok: false, code: 'AGENT_RUN_HELD', runId, run: view, ...runEnvelope });
        if (record.status === 'planning' || record.status === 'awaiting_approval') {
          return res.status(409).json({ ok: false, code: 'AGENT_RUN_NOT_APPROVED', runId, run: view, ...runEnvelope });
        }
        return res.json({ ok: true, protocolVersion: 3, runId, status: record.status, advanced: false, run: view, ...runEnvelope });
    }
  });

  router.post('/api/agent/v3/runs/:runId/cancel', agentV3RateLimitGuard, agentV3RateLimiter, async (req, res) => {
    if (!runStore) return runsStoreUnavailable(res);
    const runId = typeof req.params.runId === 'string' ? req.params.runId : '';
    if (!runId.startsWith('run-')) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_RUN_ID' });
    const body = (req.body ?? {}) as { planToken?: unknown };
    const resolved = authenticateRunsRequest(req, typeof body.planToken === 'string' ? body.planToken : undefined, runId);
    if ('status' in resolved) return res.status(resolved.status).json({ ok: false, code: resolved.code });
    let record: AgentRunRecord | null;
    try {
      record = await runStore.get(runId, resolved.auth.ownerBinding);
    } catch {
      return runsStoreUnavailable(res);
    }
    if (!record) return res.status(404).json({ ok: false, code: 'AGENT_RUN_NOT_FOUND', runId });
    if (record.status === 'completed' || record.status === 'failed' || record.status === 'cancelled' || record.status === 'expired') {
      return res.json({ ok: true, protocolVersion: 3, runId, cancellation: 'already-terminal', run: publicAgentRunView(record), ...runEnvelope });
    }
    if (record.status === 'running') {
      // The transition table has no running→cancelled edge: the active
      // driver owns the run until its lease ends. Cancelling a running run
      // is reported honestly instead of racing the driver.
      return res.status(409).json({ ok: false, code: 'AGENT_RUN_IN_PROGRESS', runId, run: publicAgentRunView(record), ...runEnvelope });
    }
    const cancelled = await runStore.transition({
      runId,
      ownerBinding: resolved.auth.ownerBinding,
      expectedStatus: record.status,
      expectedVersion: record.version,
      nextStatus: 'cancelled',
    }).catch(() => null);
    if (!cancelled) {
      const current = await runStore.get(runId, resolved.auth.ownerBinding).catch(() => null);
      if (current?.status === 'cancelled') {
        return res.json({ ok: true, protocolVersion: 3, runId, cancellation: 'run-record', run: publicAgentRunView(current), ...runEnvelope });
      }
      return res.status(409).json({ ok: false, code: 'AGENT_RUN_VERSION_CONFLICT', runId });
    }
    // Best-effort shared tombstone, mirroring the legacy cancel, so the
    // legacy execute path cannot run this approval afterwards either. The
    // record transition above is the authoritative cancellation for the
    // runs path, so a tombstone failure degrades the label, not the result.
    let tombstoned = false;
    if (consumptionStore) {
      try {
        await consumptionStore.consume(runId, record.expiresAt);
        tombstoned = true;
      } catch { tombstoned = false; }
    }
    return res.json({
      ok: true,
      protocolVersion: 3,
      runId,
      cancellation: tombstoned ? 'run-record-and-shared-reservation' : 'run-record',
      run: publicAgentRunView(cancelled),
      ...runEnvelope,
    });
  });

  return router;
}
