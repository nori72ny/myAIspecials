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
import { issueApprovalCapability, issuePlanCapability, latestApprovalExpiryForPlan, PLAN_TTL_MS, v3CapabilityConfigured, verifyApprovalCapability, verifyPlanCapability, type AgentApprovalAuthModeV3 } from './agentV3Capability.js';
import { planAgentToolsV3, type AgentToolStepV3 } from './agentToolPlannerV3.js';
import { agentOperatorAuthorizationModeV3, agentOperatorConfiguredV3, authenticateAgentOperatorV3 } from './agentOperatorAuthV3.js';
import type { AgentCodeDelegationPort } from './agentCodingDelegationV14.js';
import { advanceAgentRun, resolveStepParams, textualArtifactOf } from './agentRunAdvancer.js';
import { evaluateAgentRunPiggyback, type AgentRunPiggybackSummary, type AgentRunReplanPort } from './agentRunPiggybackEvaluation.js';
import type { AgentRunWriteLockStore } from './agentRunWriteLock.js';
import { diffAgentRunPlans } from './agentRunPlanDiff.js';
import type { AgentRunRecord, AgentRunStore } from './agentRunRecord.js';
import {
  isAgentRunRecordStatus,
  MAX_AGENT_RUN_TTL_MS,
  normalizeAgentRunHold,
  type AgentRunHold,
  type AgentRunHoldReason,
  type AgentRunPlanStep,
  type AgentRunRecordStatus,
  type AgentRunResumeCondition,
} from './agentRunRecord.js';
import { createOriginChatRateLimiter } from '../server/originSecurity.js';
import {
  agentAttachmentsEnabled,
  agentAttachmentSetTotals,
  computeAgentAttachmentSetDigest,
  normalizeAgentAttachmentFileName,
  normalizeAgentAttachmentMediaType,
  resolveAgentAttachmentKind,
  validateAgentAttachmentFileText,
  AGENT_ATTACHMENT_CLAIMED_GRACE_MS,
  AGENT_ATTACHMENT_SET_ID_PATTERN,
  AGENT_ATTACHMENT_SET_TTL_MS,
  MAX_AGENT_ATTACHMENT_FILE_TEXT_CHARS,
  MAX_AGENT_ATTACHMENT_SET_FILES,
  MAX_AGENT_ATTACHMENT_SET_TEXT_CHARS,
  type AgentAttachmentFileMeta,
  type AgentAttachmentSetRecord,
  type AgentAttachmentStore,
} from './agentAttachmentRecord.js';
import {
  attachmentUploadTokenDigest,
  issueAttachmentUploadCapability,
  verifyAttachmentUploadCapability,
} from './agentAttachmentCapability.js';
import { buildAgentAttachmentDataView, type AgentAttachmentDataView } from './agentAttachmentData.js';
import { augmentPlanWithAttachments } from './agentAttachmentPlanning.js';
import type { AgentModelExecutor } from './agentModelCall.js';

const TOOL_NAMES: readonly ToolName[] = ['code_interpreter', 'document_generator', 'web_search_grounding', 'image_prompt_compiler', 'repository_explorer', 'file_reader', 'file_writer', 'verification_runner', 'attachment_reader', 'attachment_analyzer'];
const isToolName = (value: unknown): value is ToolName => typeof value === 'string' && TOOL_NAMES.includes(value as ToolName);
/** Raised 4 → 6 together with the planner (file-input foundation F2,
 * design §3.6, J7): reader + analyzer + generative step is the smallest
 * attachment plan, and the two ceilings must move together so an
 * issuable plan is always an executable one. */
const MAX_EXECUTION_STEPS = 6;
const STEP_TITLES: Record<ToolName, string> = {
  repository_explorer: 'Explore repository structure',
  file_reader: 'Read the target file',
  web_search_grounding: 'Research with grounded sources',
  code_interpreter: 'Generate or repair code (V14 pipeline)',
  document_generator: 'Generate the document',
  image_prompt_compiler: 'Compile the image prompt',
  file_writer: 'Write the file',
  verification_runner: 'Run verification',
  attachment_reader: 'Read the attached data',
  attachment_analyzer: 'Analyze the attached data',
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
 * Builds the executable step inputs for a goal from the planner's tool
 * choices. Shared by the legacy /plan endpoint and the resume re-plan so
 * both produce byte-identical steps (and therefore identical digests) for
 * the same goal.
 */
function plannedStepsForGoal(goal: string, plannedSteps: readonly AgentToolStepV3[]): AgentStepInputV3[] {
  return plannedSteps.map((step, index) => ({
    toolName: step.toolName,
    params: generatedParams(step.toolName, goal, {
      contentFromPreviousArtifact: step.toolName === 'file_writer'
        && index > 0
        && plannedSteps[index - 1].toolName === 'document_generator',
    }),
  }));
}

/** The durable plan snapshot stored on a run record for a step list. */
function planSnapshotFromSteps(steps: readonly AgentStepInputV3[]): AgentRunPlanStep[] {
  return steps.map((step, index) => ({
    toolName: step.toolName,
    params: step.params,
    dependsOn: index === 0 ? [] : [index - 1],
    ...(typeof step.params.contentFromStep === 'number' && step.params.contentFromStep >= 0 && step.params.contentFromStep < index
      ? { inputFrom: step.params.contentFromStep }
      : step.params.contentFromPreviousArtifact === true && index > 0 ? { inputFrom: index - 1 } : {}),
  }));
}

/** Rebuilds executable step inputs from a stored plan snapshot. */
function stepInputsFromPlanSnapshot(plan: readonly AgentRunPlanStep[]): AgentStepInputV3[] {
  return plan.map((step) => ({ toolName: step.toolName, params: step.params }));
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
      const title = normalized.slice(0, 80).replace(/[。.!！?？]+$/u, '') || '成果物のたたき台';
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


const SAFE_RUN_STORE_ERROR_FIELD = /^[A-Za-z0-9_.:-]{1,80}$/;

function safeRunStoreErrorField(error: unknown, field: 'name' | 'code'): string {
  if (error && typeof error === 'object' && field in error) {
    const value = (error as Record<string, unknown>)[field];
    if (typeof value === 'string' && SAFE_RUN_STORE_ERROR_FIELD.test(value)) return value;
  }
  return 'UNKNOWN';
}

/**
 * Records a run-store infrastructure failure for production triage. Only
 * the error's name and code are logged — never the message: driver error
 * messages can be composed from host names or connection details (the
 * same policy as the coding router's ORIGIN_CODING_DB_PROBE_FAILED). The
 * code carries the diagnostic value: for Postgres it is the SQLSTATE
 * (for example 42P01 when the runs table does not exist).
 */
function logAgentRunStoreFailure(operation: string, error: unknown): void {
  console.error('ORIGIN_AGENT_RUN_STORE_FAILED', {
    operation,
    name: safeRunStoreErrorField(error, 'name'),
    code: safeRunStoreErrorField(error, 'code'),
  });
}

/**
 * Records an advance that ended `unavailable` for production triage.
 * The advance handler answers those with a bare 503 and no other log
 * line, so without this record an infrastructure failure inside the
 * advancer (for example replay protection rejecting the reservation) is
 * invisible in the production logs. Only the outcome's error code is
 * logged — validated against the same safe-token pattern as the
 * run-store failure log; codes are internal constants, never free text.
 */
function logAgentRunAdvanceUnavailable(errorCode: string): void {
  console.error('ORIGIN_AGENT_RUN_ADVANCE_UNAVAILABLE', {
    code: SAFE_RUN_STORE_ERROR_FIELD.test(errorCode) ? errorCode : 'UNKNOWN',
  });
}

/**
 * Records an advance that ended `failed` for production triage. The
 * 422 response carries the failure code, but the browser client only
 * writes it to its own console, so without this record a deterministic
 * step failure (for example the research tool failing closed) leaves
 * no trace in the production logs at all. Only the outcome's error
 * code is logged — validated against the same safe-token pattern as
 * the unavailable log; codes are internal constants, never free text.
 */
function logAgentRunAdvanceFailed(errorCode: string): void {
  console.error('ORIGIN_AGENT_RUN_ADVANCE_FAILED', {
    code: SAFE_RUN_STORE_ERROR_FIELD.test(errorCode) ? errorCode : 'UNKNOWN',
  });
}

/**
 * Records an attachment-store infrastructure failure for production
 * triage, under the same name/code-only policy as the run-store
 * failure log. Attachment bodies, file names and tokens are never
 * logged.
 */
function logAgentAttachmentStoreFailure(operation: string, error: unknown): void {
  console.error('ORIGIN_AGENT_ATTACHMENT_STORE_FAILED', {
    operation,
    name: safeRunStoreErrorField(error, 'name'),
    code: safeRunStoreErrorField(error, 'code'),
  });
}

/** The longest reservation expiry the consumption store contract accepts,
 * measured from the reservation instant. The Postgres implementation
 * validates against this same constant, so callers and store can never
 * drift apart. */
export const AGENT_RUN_CONSUMPTION_MAX_TTL_MS = 15 * 60 * 1_000;

/** The reservation window callers ask for when the authorizing lifetime
 * bound is longer than the store contract: the legacy execute path's
 * floor (an approval's expiry, but at least twelve minutes). A short
 * horizon is sufficient because the capability tokens that could
 * re-enter execution are themselves short-lived (plan TTL 10 minutes +
 * approval TTL 2 minutes). */
export const AGENT_RUN_CONSUMPTION_RESERVATION_TTL_MS = 12 * 60 * 1_000;

/**
 * The reservation expiry a runs-path caller passes to `consume()` for a
 * run whose record lifetime (`recordExpiresAt`, creation + 7 days) far
 * exceeds the store contract. Mirrors the legacy execute path's
 * semantics — retain for the authorizing lifetime, with the
 * twelve-minute floor — clamped to the store's maximum so the call can
 * never be rejected with INVALID_AGENT_RUN_EXPIRY: passing the record
 * expiry verbatim made every durable-run advance fail deterministically
 * (and, through the reservation journal in the record's quota ledger,
 * the runs path stays protected after the reservation lapses).
 */
export function agentRunConsumptionReservationExpiresAt(recordExpiresAt: number, nowMs: number): number {
  return Math.min(
    Math.max(recordExpiresAt, nowMs + AGENT_RUN_CONSUMPTION_RESERVATION_TTL_MS),
    nowMs + AGENT_RUN_CONSUMPTION_MAX_TTL_MS,
  );
}

/** Must atomically reserve a run across all server instances until expiresAt.
 * Return false for a previously reserved run. Never release after a tool failure.
 * No process-local default: serverless instances cannot share an in-memory map.
 */
export interface AgentRunConsumptionStore {
  consume(runId: string, expiresAt: number): Promise<boolean>;
}

export function createAgentOrchestratorV3Router(env: NodeJS.ProcessEnv = process.env, consumptionStore?: AgentRunConsumptionStore, deps?: { codeDelegation?: AgentCodeDelegationPort; runStore?: AgentRunStore; writeLockStore?: AgentRunWriteLockStore; attachmentStore?: AgentAttachmentStore; modelCall?: AgentModelExecutor }): Router {
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
  // Retry-After contract. The inner limiter stays POST-only; GET /status
  // is covered by the outer guard alone because it verifies operator
  // credentials, so credential guessing against it must be metered too
  // (CodeQL js/missing-rate-limiting).
  const agentV3RateLimiter = createOriginChatRateLimiter(Date.now, ['POST']);
  const toolContext: ToolExecutionContext = {
    codeDelegation: deps?.codeDelegation,
    env,
    ...(deps?.modelCall ? { modelCall: deps.modelCall } : {}),
  };
  const runStore = deps?.runStore;
  const writeLockStore = deps?.writeLockStore;
  const attachmentStore = deps?.attachmentStore;

  router.get('/api/agent/v3/status', agentV3RateLimitGuard, (req, res) => {
    const approvalSigningConfigured = v3CapabilityConfigured(env);
    const operatorAuthenticationConfigured = agentOperatorConfiguredV3(env);
    const authorizationMode = agentOperatorAuthorizationModeV3(env);
    const replayProtectionConfigured = Boolean(consumptionStore);
    // Unauthenticated callers only learn readiness booleans. The security
    // configuration breakdown below (authorization mode, credential
    // separation, secret delivery, replay-protection method) is
    // reconnaissance material, so it is returned solely to a request that
    // authenticates as the operator.
    const publicStatus = {
      ok: true,
      protocolVersion: 3,
      ready: approvalSigningConfigured && operatorAuthenticationConfigured && replayProtectionConfigured,
      approvalSigningConfigured,
      replayProtectionConfigured,
      browserApprovalEnabled: approvalSigningConfigured && replayProtectionConfigured,
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
    };
    if (!authenticateAgentOperatorV3(req, env)) {
      return res.status(200).json(publicStatus);
    }
    return res.status(200).json({
      ...publicStatus,
      operatorAuthenticationConfigured,
      authorizationMode,
      credentialSeparationConfigured: authorizationMode === 'agent-operator',
      replayProtection: replayProtectionConfigured ? 'shared-atomic' : 'unavailable',
      secretDelivery: authorizationMode === 'agent-operator'
        ? 'signing-secret-server-only'
        : authorizationMode === 'legacy-approval-compat'
          ? 'legacy-shared-credential'
          : 'unavailable',
    });
  });

  router.post('/api/agent/v3/plan', agentV3RateLimitGuard, agentV3RateLimiter, async (req, res) => {
    if (!v3CapabilityConfigured(env)) return res.status(503).json({ ok: false, code: 'AGENT_APPROVAL_NOT_CONFIGURED' });
    const goal = req.body?.goal;
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 4000) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_GOAL' });
    // Attachment binding (file-input foundation F1, design §1.2): when
    // the caller names an attachment set, the set is loaded under the
    // caller's ownership proof and its content digest is bound into
    // the plan's params below, so the approval digest covers the data
    // itself. Without an attachmentSetId this handler produces exactly
    // the plan it produced before the foundation existed.
    let boundAttachment: { set: AgentAttachmentSetRecord; setDigest: string; view: AgentAttachmentDataView } | null = null;
    if (req.body?.attachmentSetId !== undefined) {
      const resolved = await resolvePlanAttachment(req, req.body.attachmentSetId);
      if ('status' in resolved) return res.status(resolved.status).json({ ok: false, code: resolved.code });
      boundAttachment = resolved.attachment;
    }
    const planned = planAgentToolsV3(goal.trim());
    if ('code' in planned) {
      return res.status(422).json({ ok: false, code: planned.code, protocolVersion: 3, candidates: planned.candidates });
    }
    const run = new AgentRunSession();
    run.transition('planning');
    run.transition('awaiting_approval');
    let steps: AgentStepInputV3[] = plannedStepsForGoal(goal.trim(), planned.steps);
    let effectivePlanned: readonly AgentToolStepV3[] = planned.steps;
    if (boundAttachment) {
      // F2 augmentation (design §3.6): the reader leads, analyzer
      // steps carry the data work, and the first generative step is
      // re-grounded on the analyzer's output. Every data step carries
      // { attachmentSetId, setDigest } inside the params the canonical
      // digest is computed over, so replacing a file after approval
      // breaks the digest chain and the plan can no longer be approved
      // or executed as-is. Oversize sets are refused here, at plan
      // time, with the counts attached (design §4.3).
      const augmented = augmentPlanWithAttachments({
        goal: goal.trim(),
        plannedSteps: planned.steps,
        steps,
        setId: boundAttachment.set.setId,
        setDigest: boundAttachment.setDigest,
        view: boundAttachment.view,
        maxSteps: MAX_EXECUTION_STEPS,
      });
      if (augmented.ok === false) {
        return res.status(422).json({
          ok: false,
          code: augmented.code,
          protocolVersion: 3,
          chunkCount: augmented.chunkCount,
          limit: augmented.limit,
        });
      }
      steps = augmented.steps;
      effectivePlanned = augmented.plannedSteps;
    }
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
      steps: effectivePlanned.map((step, index) => ({
        toolName: step.toolName,
        reasonCode: step.reasonCode,
        params: steps[index].params,
      })),
      toolChoice: { source: 'deterministic-local', reasonCode: effectivePlanned[0].reasonCode, mode: steps.length > 1 ? 'multi-step' : 'single-step' },
      plan: steps.map((step, index) => ({ id: `task-${index + 1}`, title: STEP_TITLES[step.toolName] })),
      ...(boundAttachment ? {
        attachments: {
          setId: boundAttachment.set.setId,
          setDigest: boundAttachment.setDigest,
          fileCount: boundAttachment.set.files.length,
          totalChars: agentAttachmentSetTotals(boundAttachment.set.files).totalChars,
          files: boundAttachment.set.files.map((file) => ({ name: file.name, charCount: file.charCount })),
        },
      } : {}),
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
        const textualByStep = new Map<number, string>();
        const rawByStep = new Map<number, string>();
        let failure: { graph: typeof graph; record?: unknown } | null = null;
        for (const [index, step] of steps.entries()) {
          const resolved = resolveStepParams(step, { previousText, byStep: textualByStep, rawByStep });
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
          const stepText = textualArtifactOf(step.toolName, record.artifact);
          if (stepText !== undefined) textualByStep.set(index, stepText);
          rawByStep.set(index, record.artifact);
          previousText = stepText ?? previousText;
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
  // Attachment sets use the same two owner namespaces: operator sets
  // bind to the operator namespace digest, browser sets bind to a
  // digest of their upload token (the token is per-set and is the
  // browser-side capability for the set, exactly as a plan token is
  // for a run). Bindings and tokens are never returned or logged.
  const browserAttachmentOwnerBinding = (uploadToken: string) => createHash('sha256').update(`origin.agent.attachments.owner.browser.v1:${uploadToken}`).digest('hex');
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
    approvalDeadlineAt: record.approvalDeadlineAt ? new Date(record.approvalDeadlineAt).toISOString() : null,
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
  // Same 503 contract as runsStoreUnavailable, but the underlying store
  // failure is recorded first: without this, an infrastructure error
  // (for example a missing runs table) is indistinguishable in the
  // production logs from the store simply not being configured.
  const runsStoreFailure = (res: express.Response, operation: string, error: unknown) => {
    logAgentRunStoreFailure(operation, error);
    return runsStoreUnavailable(res);
  };
  const attachmentStoreUnavailable = (res: express.Response) => res.status(503).json({ ok: false, code: 'AGENT_ATTACHMENT_STORE_UNAVAILABLE' });
  const attachmentStoreFailure = (res: express.Response, operation: string, error: unknown) => {
    logAgentAttachmentStoreFailure(operation, error);
    return attachmentStoreUnavailable(res);
  };

  // Piggyback evaluation (multitask Phase 1, PR 1-G; design §2.3, §8.5):
  // the owner-scoped run reads below first re-examine the owner's held
  // and approval-lapsed runs, so the response reflects the freshest
  // state. The re-plan port reuses the resume endpoint's planner helpers
  // verbatim — automatic and manual resumes produce byte-identical
  // steps and digests for the same goal. Best-effort by construction:
  // any failure collapses to "no evaluation happened" and the read
  // proceeds exactly as before. The evaluator itself never executes
  // anything (design §8): its strongest move is held ->
  // awaiting_approval, after which a human still has to approve.
  const runReplanPort: AgentRunReplanPort = {
    replan(goal: string) {
      const planned = planAgentToolsV3(goal);
      if ('code' in planned) return null;
      const steps = plannedStepsForGoal(goal, planned.steps);
      return { steps, plan: planSnapshotFromSteps(steps), planDigest: canonicalParamsDigest(steps) };
    },
  };
  const runPiggybackEvaluation = async (ownerBinding: string): Promise<AgentRunPiggybackSummary | null> => {
    // Attachment expiry sweep (file-input foundation F1, design §2.3):
    // expired sets are reclaimed on the same piggyback opportunity as
    // the run evaluation. Best-effort and fire-and-forget — the lazy
    // deletion on every attachment read is the correctness guarantee;
    // this only reclaims storage sooner.
    if (attachmentStore) void attachmentStore.sweepExpired().catch(() => 0);
    if (!runStore) return null;
    return evaluateAgentRunPiggyback({ runStore, replan: runReplanPort }, ownerBinding, Date.now()).catch(() => null);
  };
  const piggybackSummaryView = (summary: AgentRunPiggybackSummary | null) => summary === null ? undefined : {
    advanced: summary.advanced.length,
    approvalTimeouts: summary.approvalTimeouts.length,
    capped: summary.capped.length,
  };

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
        plan: planSnapshotFromSteps(steps),
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
      // Attachment claim (file-input foundation F2, design J2): a run
      // whose approved plan names an attachment set claims the set, so
      // its lifetime follows the run (record expiry + grace) instead of
      // the 24-hour unclaimed expiry. Best-effort by design: the claim
      // resolves under the run's owner binding, which is the binding
      // the data steps will read through — a set owned under a
      // different binding (a browser set, whose binding derives from
      // its upload token) is invisible here and simply stays unclaimed
      // until the browser flow's own claim wiring lands with the UI
      // stage; execution then fails closed as unavailable rather than
      // reading across bindings.
      const claimedSetId = created.plan
        ?.map((step) => step.params.attachmentSetId)
        .find((value): value is string => typeof value === 'string' && value.length > 0);
      if (attachmentStore && claimedSetId) {
        await attachmentStore.claimSet(
          claimedSetId,
          ownerBinding,
          runId,
          created.expiresAt + AGENT_ATTACHMENT_CLAIMED_GRACE_MS,
        ).catch((error: unknown) => {
          logAgentAttachmentStoreFailure('attachment-claim', error);
          return null;
        });
      }
      return res.status(201).json({ ok: true, protocolVersion: 3, persistence: 'durable-run-record', run: publicAgentRunView(created), ...runEnvelope });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.startsWith('AGENT_RUN_')) return res.status(400).json({ ok: false, code: message });
      return runsStoreFailure(res, 'create', error);
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
    const evaluation = piggybackSummaryView(await runPiggybackEvaluation(resolved.auth.ownerBinding));
    try {
      const runs = await runStore.listByOwner(resolved.auth.ownerBinding, { statuses: statuses as AgentRunRecordStatus[] | undefined, limit });
      return res.json({ ok: true, protocolVersion: 3, runs: runs.map(publicAgentRunView), ...(evaluation ? { piggybackEvaluation: evaluation } : {}), ...runEnvelope });
    } catch (error) {
      return runsStoreFailure(res, 'list', error);
    }
  });

  router.get('/api/agent/v3/runs/:runId', agentV3RateLimitGuard, async (req, res) => {
    if (!runStore) return runsStoreUnavailable(res);
    const runId = typeof req.params.runId === 'string' ? req.params.runId : '';
    if (!runId.startsWith('run-')) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_RUN_ID' });
    const planToken = typeof req.headers['x-agent-plan-token'] === 'string' ? req.headers['x-agent-plan-token'] : undefined;
    const resolved = authenticateRunsRequest(req, planToken, runId);
    if ('status' in resolved) return res.status(resolved.status).json({ ok: false, code: resolved.code });
    const evaluation = piggybackSummaryView(await runPiggybackEvaluation(resolved.auth.ownerBinding));
    try {
      const record = await runStore.get(runId, resolved.auth.ownerBinding);
      if (!record) return res.status(404).json({ ok: false, code: 'AGENT_RUN_NOT_FOUND', runId });
      return res.json({ ok: true, protocolVersion: 3, run: publicAgentRunView(record), ...(evaluation ? { piggybackEvaluation: evaluation } : {}), ...runEnvelope });
    } catch (error) {
      return runsStoreFailure(res, 'get', error);
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
    } catch (error) {
      return runsStoreFailure(res, 'advance', error);
    }
    if (!record) return res.status(404).json({ ok: false, code: 'AGENT_RUN_NOT_FOUND', runId });
    const budgetMs = typeof body.budgetMs === 'number' && Number.isFinite(body.budgetMs)
      ? Math.min(110_000, Math.max(1_000, Math.floor(body.budgetMs)))
      : undefined;
    const outcome = await advanceAgentRun(
      { runStore, consumptionStore, toolContext, writeLockStore, attachmentStore },
      record,
      `driver-${resolved.auth.mode}-${randomUUID()}`,
      { budgetMs },
    );
    const refreshed = await runStore.get(runId, resolved.auth.ownerBinding).catch(() => null);
    const view = publicAgentRunView(refreshed ?? outcome.record);
    switch (outcome.kind) {
      case 'completed':
        // PR-D1 (wiring design §4.3): the completing advance hands the
        // final artifact body to the caller for display, mirroring the
        // legacy /execute response's `artifact` field. Delivery-only —
        // the record and its view never carry artifact bodies — and
        // absent when the completing advance finalized no step.
        return res.json({ ok: true, protocolVersion: 3, runId, status: 'completed', ...(outcome.artifact !== undefined ? { artifact: outcome.artifact } : {}), run: view, ...runEnvelope });
      case 'failed':
        logAgentRunAdvanceFailed(outcome.errorCode);
        return res.status(422).json({ ok: false, protocolVersion: 3, runId, code: outcome.errorCode, status: 'failed', run: view, ...runEnvelope, error: 'The run failed verification or execution.' });
      case 'held':
        // Quota gate (PR 1-D): the advance parked the run instead of
        // executing a step whose provider quota is exhausted. Held is a
        // first-class state, not a failure: the record's hold carries
        // the quota_reset resume condition for the blocking provider.
        return res.status(202).json({ ok: true, protocolVersion: 3, runId, status: 'held', advanced: false, code: 'AGENT_RUN_QUOTA_EXHAUSTED', quota: { provider: outcome.provider, resetAt: new Date(outcome.resetAt).toISOString() }, run: view, ...runEnvelope });
      case 'write_lock_busy':
        // Writer lock (PR 1-E): another run currently holds the
        // repository write lock. The write step waits in the queue —
        // contention made explicit, never a failure and never a hold
        // (design §2.5). The holder is a run id (not a secret), so it
        // is safe to name.
        return res.status(202).json({ ok: true, protocolVersion: 3, runId, status: 'running', advanced: false, code: 'AGENT_RUN_WRITE_LOCK_BUSY', writeLock: { holderRunId: outcome.holderRunId, expiresAt: outcome.lockExpiresAt ? new Date(outcome.lockExpiresAt).toISOString() : null }, run: view, ...runEnvelope });
      case 'progress':
        return res.status(202).json({ ok: true, protocolVersion: 3, runId, status: 'running', advanced: true, run: view, ...runEnvelope });
      case 'busy':
        return res.status(202).json({ ok: true, protocolVersion: 3, runId, status: view.status, advanced: false, code: 'AGENT_RUN_DRIVER_BUSY', run: view, ...runEnvelope });
      case 'unavailable':
        logAgentRunAdvanceUnavailable(outcome.errorCode);
        return res.status(503).json({ ok: false, code: outcome.errorCode, runId });
      case 'not_runnable':
        // A held run must re-plan and be re-approved before it can move
        // again (design §8): see the resume endpoints below. It is
        // reported, never advanced, from here.
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
    } catch (error) {
      return runsStoreFailure(res, 'cancel', error);
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
        await consumptionStore.consume(runId, agentRunConsumptionReservationExpiresAt(record.expiresAt, Date.now()));
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

  // ---------------------------------------------------------------------
  // Hold and resume (multitask Phase 1, PR 1-C; design §8).
  //
  // Hold is a first-class state of a run, not an error: a run that cannot
  // proceed right now (quota exhausted, approval lapsed, the user paused
  // it, ...) is kept as a durable record with a reason and a structured
  // resume condition instead of vanishing. The hold endpoint below is the
  // single mechanism behind design §8.3 entries 1-3 (explicit user pause,
  // quota-exhaustion hold, approval-timeout conversion); what differs is
  // only the reason/condition pair. Automatic triggering (converting an
  // awaiting_approval run when its approval lapses without anyone
  // asking) is the piggyback evaluator's job (PR 1-G): the record now
  // stores the approval lapse deadline set here at resume time, and the
  // evaluator converts lapsed runs on ordinary run reads.
  //
  // Resume is two steps, mirroring the normal plan/approval flow:
  //   1. POST /runs/:id/resume re-plans the goal with the current
  //      planner, stores the new plan snapshot on the record
  //      (held -> awaiting_approval), returns the plan diff against the
  //      stored snapshot plus a freshly minted plan capability.
  //   2. The human approves that exact plan through the existing
  //      /approval or /browser-approval endpoints, then
  //      POST /runs/:id/resume/confirm binds the approval capability to
  //      the stored plan (awaiting_approval -> queued), after which the
  //      existing advance endpoint drives the run as usual.
  // The state machine has no held -> queued edge, and no approval token
  // is ever stored on the record, so the system itself cannot carry an
  // approval across a hold; confirm additionally rejects approval
  // capabilities minted before the resume instant (beyond a small
  // clock-skew tolerance), which closes the residual bearer-token window
  // for holds that begin and end inside one approval TTL.
  const AGENT_RUN_APPROVAL_FRESHNESS_TOLERANCE_MS = 5_000;
  const AGENT_RUN_HOLD_REASONS: ReadonlySet<string> = new Set([
    'quota_exhausted',
    'awaiting_approval',
    'scheduled_time',
    'condition_wait',
    'dependency_wait',
    'user_paused',
    'driver_unavailable',
  ]);
  /** Reasons whose resume condition may default to a plain manual resume
   * when the caller does not supply one. condition_wait and
   * dependency_wait are meaningless without their condition payload. */
  const AGENT_RUN_HOLD_MANUAL_DEFAULT_REASONS: ReadonlySet<string> = new Set([
    'quota_exhausted',
    'awaiting_approval',
    'scheduled_time',
    'user_paused',
    'driver_unavailable',
  ]);

  router.post('/api/agent/v3/runs/:runId/hold', agentV3RateLimitGuard, agentV3RateLimiter, async (req, res) => {
    if (!runStore) return runsStoreUnavailable(res);
    const runId = typeof req.params.runId === 'string' ? req.params.runId : '';
    if (!runId.startsWith('run-')) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_RUN_ID' });
    const body = (req.body ?? {}) as { planToken?: unknown; reason?: unknown; resumeCondition?: unknown };
    const resolved = authenticateRunsRequest(req, typeof body.planToken === 'string' ? body.planToken : undefined, runId);
    if ('status' in resolved) return res.status(resolved.status).json({ ok: false, code: resolved.code });
    let record: AgentRunRecord | null;
    try {
      record = await runStore.get(runId, resolved.auth.ownerBinding);
    } catch (error) {
      return runsStoreFailure(res, 'hold', error);
    }
    if (!record) return res.status(404).json({ ok: false, code: 'AGENT_RUN_NOT_FOUND', runId });
    if (record.status === 'held') {
      // Idempotent: the first hold stands. Changing a hold's reason or
      // resume condition is a resume/cancel decision, not a re-hold.
      return res.json({ ok: true, protocolVersion: 3, runId, status: 'held', held: 'already', run: publicAgentRunView(record), ...runEnvelope });
    }
    if (record.status === 'completed' || record.status === 'failed' || record.status === 'cancelled' || record.status === 'expired') {
      return res.status(409).json({ ok: false, code: 'AGENT_RUN_NOT_HOLDABLE', runId, run: publicAgentRunView(record), ...runEnvelope });
    }
    const reason = typeof body.reason === 'string' ? body.reason : '';
    if (!AGENT_RUN_HOLD_REASONS.has(reason)) {
      return res.status(400).json({ ok: false, code: 'AGENT_RUN_HOLD_INVALID', runId });
    }
    let resumeCondition: AgentRunResumeCondition | undefined;
    if (body.resumeCondition !== undefined) {
      if (!body.resumeCondition || typeof body.resumeCondition !== 'object' || Array.isArray(body.resumeCondition)) {
        return res.status(400).json({ ok: false, code: 'AGENT_RUN_HOLD_INVALID', runId });
      }
      resumeCondition = body.resumeCondition as AgentRunResumeCondition;
    } else if (AGENT_RUN_HOLD_MANUAL_DEFAULT_REASONS.has(reason)) {
      resumeCondition = { kind: 'manual' };
    } else {
      return res.status(400).json({ ok: false, code: 'AGENT_RUN_HOLD_INVALID', runId });
    }
    let hold: AgentRunHold;
    try {
      const normalized = normalizeAgentRunHold({
        reason: reason as AgentRunHoldReason,
        resumeCondition,
        heldSince: Date.now(),
        resumeAttempts: 0,
      });
      if (!normalized) throw new Error('AGENT_RUN_HOLD_INVALID');
      hold = normalized;
    } catch {
      return res.status(400).json({ ok: false, code: 'AGENT_RUN_HOLD_INVALID', runId });
    }
    // planning / awaiting_approval / queued runs hold directly. A running
    // run holds through the same conditional transition: the store
    // detaches the driver lease as it leaves `running`, so the active
    // driver can no longer persist progress or finish the run (its
    // in-flight tool call, if any, is the one effect that cannot be
    // recalled). A version conflict means the driver moved first and is
    // reported as a conflict, per the transition table's terms.
    const held = await runStore.transition({
      runId,
      ownerBinding: resolved.auth.ownerBinding,
      expectedStatus: record.status,
      expectedVersion: record.version,
      nextStatus: 'held',
      hold,
    }).catch(() => null);
    if (!held) {
      const current = await runStore.get(runId, resolved.auth.ownerBinding).catch(() => null);
      if (current?.status === 'held') {
        return res.json({ ok: true, protocolVersion: 3, runId, status: 'held', held: 'already', run: publicAgentRunView(current), ...runEnvelope });
      }
      return res.status(409).json({ ok: false, code: 'AGENT_RUN_VERSION_CONFLICT', runId });
    }
    return res.json({ ok: true, protocolVersion: 3, runId, status: 'held', held: true, run: publicAgentRunView(held), ...runEnvelope });
  });

  router.post('/api/agent/v3/runs/:runId/resume', agentV3RateLimitGuard, agentV3RateLimiter, async (req, res) => {
    if (!runStore) return runsStoreUnavailable(res);
    const runId = typeof req.params.runId === 'string' ? req.params.runId : '';
    if (!runId.startsWith('run-')) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_RUN_ID' });
    if (!v3CapabilityConfigured(env)) return res.status(503).json({ ok: false, code: 'AGENT_APPROVAL_NOT_CONFIGURED' });
    const body = (req.body ?? {}) as { planToken?: unknown };
    const resolved = authenticateRunsRequest(req, typeof body.planToken === 'string' ? body.planToken : undefined, runId);
    if ('status' in resolved) return res.status(resolved.status).json({ ok: false, code: resolved.code });
    let record: AgentRunRecord | null;
    try {
      record = await runStore.get(runId, resolved.auth.ownerBinding);
    } catch (error) {
      return runsStoreFailure(res, 'resume', error);
    }
    if (!record) return res.status(404).json({ ok: false, code: 'AGENT_RUN_NOT_FOUND', runId });

    const resumeResponse = (
      current: AgentRunRecord,
      steps: AgentStepInputV3[],
      plannedSteps: readonly AgentToolStepV3[],
      alreadyResumed: boolean,
      nowMs: number,
    ) => {
      const planDigest = canonicalParamsDigest(steps);
      const capability = issuePlanCapability(
        runId,
        digestGoal(current.goal.trim()),
        env,
        nowMs,
        steps[0].toolName,
        planDigest,
        steps.map((step) => step.toolName),
      );
      const planDiff = diffAgentRunPlans(alreadyResumed ? current.plan : record?.plan ?? null, steps);
      return res.status(200).json({
        ok: true,
        protocolVersion: 3,
        runId,
        status: 'awaiting_approval',
        resumed: alreadyResumed ? 'already' : true,
        planToken: capability.token,
        planExpiresAt: new Date(capability.expiresAt).toISOString(),
        planChanged: planDiff.changed,
        planDiff,
        previousPlan: alreadyResumed ? current.plan : record?.plan ?? null,
        steps: plannedSteps.map((step, index) => ({
          toolName: step.toolName,
          reasonCode: step.reasonCode,
          params: steps[index].params,
        })),
        plan: steps.map((step, index) => ({ id: `task-${index + 1}`, title: STEP_TITLES[step.toolName] })),
        run: publicAgentRunView(current),
        ...runEnvelope,
      });
    };

    if (record.status === 'awaiting_approval' && record.plan) {
      // Idempotent re-issue: a client that lost the resume response gets
      // a fresh plan capability for the stored (already re-planned) plan.
      // The record is not touched, so the approval-freshness anchor
      // (updatedAt of the resume transition) does not move. The stored
      // snapshot is authoritative here — even if the planner would now
      // produce something else, what gets approved is the stored plan.
      const storedSteps = stepInputsFromPlanSnapshot(record.plan);
      const planned = planAgentToolsV3(record.goal.trim());
      const plannerAgrees = !('code' in planned)
        && canonicalParamsDigest(plannedStepsForGoal(record.goal.trim(), planned.steps)) === record.planDigest;
      const steps = plannerAgrees ? plannedStepsForGoal(record.goal.trim(), planned.steps) : storedSteps;
      const plannedSteps: readonly AgentToolStepV3[] = plannerAgrees
        ? planned.steps
        : storedSteps.map((step) => ({ toolName: step.toolName, reasonCode: 'resumed-plan' }));
      // The re-issued capability restarts the approval window, so the
      // stored lapse deadline (PR 1-G) moves with it; otherwise the
      // piggyback evaluator could convert the run while this fresh
      // capability is still usable. Best-effort: a failed refresh only
      // means the older deadline stands.
      const resumeNowMs = Date.now();
      await runStore.refreshApprovalDeadline(
        runId,
        resolved.auth.ownerBinding,
        latestApprovalExpiryForPlan(resumeNowMs + PLAN_TTL_MS),
      ).catch(() => false);
      return resumeResponse(record, steps, plannedSteps, true, resumeNowMs);
    }
    if (record.status !== 'held') {
      return res.status(409).json({ ok: false, code: 'AGENT_RUN_NOT_HELD', runId, run: publicAgentRunView(record), ...runEnvelope });
    }

    const planned = planAgentToolsV3(record.goal.trim());
    if ('code' in planned) {
      // The goal can no longer be planned (planner rules changed, or the
      // goal was always ambiguous): the run stays held, honestly.
      return res.status(422).json({ ok: false, code: planned.code, protocolVersion: 3, runId, candidates: planned.candidates, run: publicAgentRunView(record), ...runEnvelope });
    }
    const steps = plannedStepsForGoal(record.goal.trim(), planned.steps);
    const planDiff = diffAgentRunPlans(record.plan, steps);
    const newPlanDigest = canonicalParamsDigest(steps);
    // Step progress only carries over when the re-plan is exactly the
    // stored plan (same tools and params, proven by the diff and the
    // digest). Approving a different plan restarts its steps from zero:
    // partial progress under another plan is not evidence about this one.
    const planUnchanged = !planDiff.changed && newPlanDigest === record.planDigest;
    // One instant anchors both the stored approval lapse deadline and
    // the plan capability issued in the response, so the deadline is
    // exactly the last moment an approval for this resume can complete
    // (plan TTL + approval TTL, PR 1-G).
    const resumeNowMs = Date.now();
    const transitioned = await runStore.transition({
      runId,
      ownerBinding: resolved.auth.ownerBinding,
      expectedStatus: 'held',
      expectedVersion: record.version,
      nextStatus: 'awaiting_approval',
      plan: planSnapshotFromSteps(steps),
      planDigest: newPlanDigest,
      approvalDeadlineAt: latestApprovalExpiryForPlan(resumeNowMs + PLAN_TTL_MS),
      stepsState: planUnchanged
        ? record.stepsState
        : steps.map((_, index) => ({ id: `task-${index + 1}`, status: 'queued' as const, attempts: 0 })),
    }).catch(() => null);
    if (!transitioned) {
      // A concurrent resume (or another transition) won the version
      // race; nothing about this request's re-plan was stored.
      return res.status(409).json({ ok: false, code: 'AGENT_RUN_VERSION_CONFLICT', runId });
    }
    return resumeResponse(transitioned, steps, planned.steps, false, resumeNowMs);
  });

  router.post('/api/agent/v3/runs/:runId/resume/confirm', agentV3RateLimitGuard, agentV3RateLimiter, async (req, res) => {
    if (!runStore) return runsStoreUnavailable(res);
    const runId = typeof req.params.runId === 'string' ? req.params.runId : '';
    if (!runId.startsWith('run-')) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_RUN_ID' });
    const body = (req.body ?? {}) as { planToken?: unknown; approvalToken?: unknown };
    const resolved = authenticateRunsRequest(req, typeof body.planToken === 'string' ? body.planToken : undefined, runId);
    if ('status' in resolved) return res.status(resolved.status).json({ ok: false, code: resolved.code });
    let record: AgentRunRecord | null;
    try {
      record = await runStore.get(runId, resolved.auth.ownerBinding);
    } catch (error) {
      return runsStoreFailure(res, 'resume-confirm', error);
    }
    if (!record) return res.status(404).json({ ok: false, code: 'AGENT_RUN_NOT_FOUND', runId });
    if (record.status === 'queued') {
      return res.json({ ok: true, protocolVersion: 3, runId, status: 'queued', confirmed: 'already', run: publicAgentRunView(record), ...runEnvelope });
    }
    if (record.status === 'held') {
      return res.status(409).json({ ok: false, code: 'AGENT_RUN_NOT_RESUMED', runId, run: publicAgentRunView(record), ...runEnvelope });
    }
    if (record.status !== 'awaiting_approval') {
      return res.status(409).json({ ok: false, code: 'AGENT_RUN_NOT_AWAITING_APPROVAL', runId, run: publicAgentRunView(record), ...runEnvelope });
    }
    if (!record.plan || record.plan.length === 0) {
      return res.status(409).json({ ok: false, code: 'AGENT_RUN_PLAN_MISSING', runId, run: publicAgentRunView(record), ...runEnvelope });
    }
    const steps = stepInputsFromPlanSnapshot(record.plan);
    if (canonicalParamsDigest(steps) !== record.planDigest) {
      return res.status(409).json({ ok: false, code: 'AGENT_RUN_PLAN_DIGEST_MISMATCH', runId });
    }
    const approval = verifyApprovalCapability(typeof body.approvalToken === 'string' ? body.approvalToken : undefined, env, Date.now());
    if (!approval || approval.runId !== runId || approval.digest !== approvalDigest(canonicalOperation(runId, steps))) {
      return res.status(403).json({ ok: false, code: 'AGENT_APPROVAL_INVALID' });
    }
    if (resolved.auth.mode === 'operator' ? (approval.authMode !== undefined && approval.authMode !== 'operator') : approval.authMode !== 'browser') {
      return res.status(403).json({ ok: false, code: 'AGENT_APPROVAL_AUTH_MODE_MISMATCH' });
    }
    // Freshness (§8.4): the approval must have been minted after the
    // resume transition moved the run into awaiting_approval (the
    // record's updatedAt), not before the hold. The tolerance only
    // absorbs clock skew between the app server and the database.
    if (typeof approval.iat !== 'number' || approval.iat < record.updatedAt - AGENT_RUN_APPROVAL_FRESHNESS_TOLERANCE_MS) {
      return res.status(403).json({ ok: false, code: 'AGENT_RUN_STALE_APPROVAL' });
    }
    const queued = await runStore.transition({
      runId,
      ownerBinding: resolved.auth.ownerBinding,
      expectedStatus: 'awaiting_approval',
      expectedVersion: record.version,
      nextStatus: 'queued',
    }).catch(() => null);
    if (!queued) {
      const current = await runStore.get(runId, resolved.auth.ownerBinding).catch(() => null);
      if (current?.status === 'queued') {
        return res.json({ ok: true, protocolVersion: 3, runId, status: 'queued', confirmed: 'already', run: publicAgentRunView(current), ...runEnvelope });
      }
      return res.status(409).json({ ok: false, code: 'AGENT_RUN_VERSION_CONFLICT', runId });
    }
    return res.json({ ok: true, protocolVersion: 3, runId, status: 'queued', confirmed: true, run: publicAgentRunView(queued), ...runEnvelope });
  });

  // ---------------------------------------------------------------------
  // Attachment sets (agent file-input foundation, F1; design
  // AGENT_FILE_INPUT_DESIGN_2026-11-18 §1.1, §2): the storage and
  // intake layer for files a user hands to the agent. Data steps that
  // read the bodies arrive in F2; F1 ships the four endpoints, the
  // store, ingestion validation, expiry/deletion, and the /plan
  // binding (above) that threads a set's content digest into the
  // approved params.
  //
  // Everything here is gated by ORIGIN_AGENT_ATTACHMENTS_ENABLED
  // (default OFF): with the switch off the endpoints answer 503 and
  // the rest of the v3 API behaves exactly as before.
  //
  // Ownership has the same two shapes as runs. Operator requests use
  // the operator credential and the operator namespace binding.
  // Browser requests prove ownership of a set with its upload token:
  // the token is HMAC-signed, names exactly one set, and the set row
  // stores only its digest; a browser-created set's owner binding is
  // derived from the token itself. A set is invisible under any other
  // binding — including the operator's, for browser-created sets.
  type AttachmentAuth = { ownerBinding: string; viaToken: boolean; token: string };
  type AttachmentAuthFailure = { status: number; code: string };
  function resolveAttachmentAuth(req: express.Request, expectedSetId?: string): AttachmentAuth | AttachmentAuthFailure {
    if (agentOperatorConfiguredV3(env) && authenticateAgentOperatorV3(req, env)) {
      return { ownerBinding: OPERATOR_RUN_OWNER_BINDING, viaToken: false, token: '' };
    }
    // Dispatch on the verification outcome, never on the mere
    // presence of the header: presenting any non-empty value grants
    // nothing by itself. verifyAttachmentUploadCapability checks the
    // HMAC signature (timing-safe), the payload shape and the expiry,
    // and returns null for absent, empty or forged tokens alike; the
    // set lookup afterwards (loadAttachmentSet) additionally scopes
    // by the token-derived owner binding and the stored token digest.
    const token = req.get('x-agent-attachment-token') ?? '';
    const payload = verifyAttachmentUploadCapability(token, env);
    if (payload) {
      if (expectedSetId !== undefined && payload.setId !== expectedSetId) return { status: 404, code: 'AGENT_ATTACHMENT_SET_NOT_FOUND' };
      return { ownerBinding: browserAttachmentOwnerBinding(token), viaToken: true, token };
    }
    if (token.length > 0) return { status: 403, code: 'AGENT_ATTACHMENT_TOKEN_INVALID' };
    if (!agentOperatorConfiguredV3(env) && !v3CapabilityConfigured(env)) return { status: 503, code: 'AGENT_APPROVAL_NOT_CONFIGURED' };
    if (agentOperatorConfiguredV3(env)) return { status: 401, code: 'AGENT_AUTHENTICATION_REQUIRED' };
    return { status: 403, code: 'AGENT_ATTACHMENT_TOKEN_REQUIRED' };
  }

  /** Loads a set for an authenticated caller, applying the token
   * digest check that makes the upload token single-issuance. A set
   * that is missing, expired, or bound to another owner is reported
   * uniformly as not found. */
  async function loadAttachmentSet(
    setId: string,
    auth: AttachmentAuth,
  ): Promise<{ set: AgentAttachmentSetRecord } | { failure: { status: number; code: string; error?: unknown } }> {
    let set: AgentAttachmentSetRecord | null;
    try {
      set = await attachmentStore!.getSet(setId, auth.ownerBinding);
    } catch (error) {
      return { failure: { status: 503, code: 'AGENT_ATTACHMENT_STORE_UNAVAILABLE', error } };
    }
    if (!set || (auth.viaToken && set.uploadTokenDigest !== attachmentUploadTokenDigest(auth.token))) {
      return { failure: { status: 404, code: 'AGENT_ATTACHMENT_SET_NOT_FOUND' } };
    }
    return { set };
  }

  /**
   * Resolves the attachment binding for /plan (design §1.2). Declared
   * as a function so the /plan handler above can use it; it runs at
   * request time, after every factory binding exists.
   */
  async function resolvePlanAttachment(
    req: express.Request,
    attachmentSetId: unknown,
  ): Promise<{ attachment: { set: AgentAttachmentSetRecord; setDigest: string; view: AgentAttachmentDataView } } | AttachmentAuthFailure> {
    if (typeof attachmentSetId !== 'string' || !AGENT_ATTACHMENT_SET_ID_PATTERN.test(attachmentSetId)) {
      return { status: 400, code: 'AGENT_ATTACHMENT_SET_ID_INVALID' };
    }
    if (!agentAttachmentsEnabled(env)) return { status: 503, code: 'AGENT_ATTACHMENTS_DISABLED' };
    if (!attachmentStore) return { status: 503, code: 'AGENT_ATTACHMENT_STORE_UNAVAILABLE' };
    const auth = resolveAttachmentAuth(req, attachmentSetId);
    if ('status' in auth) return auth;
    const loaded = await loadAttachmentSet(attachmentSetId, auth);
    if ('failure' in loaded) {
      if (loaded.failure.error !== undefined) logAgentAttachmentStoreFailure('attachment-plan-bind', loaded.failure.error);
      return { status: loaded.failure.status, code: loaded.failure.code };
    }
    const { set } = loaded;
    if (set.status !== 'open') return { status: 409, code: 'AGENT_ATTACHMENT_SET_NOT_OPEN' };
    if (set.files.length === 0) return { status: 422, code: 'AGENT_ATTACHMENT_SET_EMPTY' };
    // The F2 plan shape depends on the data itself (chunk counts drive
    // the analyzer split and the plan-time oversize refusal), so the
    // deterministic data view is built here, server-side, from the
    // stored texts. A body the store cannot produce for a set it just
    // listed is an inconsistency: the plan is refused as unavailable
    // rather than shaped around a guess.
    const files: { name: string; text: string }[] = [];
    for (const file of set.files) {
      let text: string | null;
      try {
        text = await attachmentStore.getFileText(set.setId, auth.ownerBinding, file.idx);
      } catch (error) {
        logAgentAttachmentStoreFailure('attachment-plan-bind', error);
        return { status: 503, code: 'AGENT_ATTACHMENT_STORE_UNAVAILABLE' };
      }
      if (text === null) return { status: 409, code: 'AGENT_ATTACHMENT_UNAVAILABLE' };
      files.push({ name: file.name, text });
    }
    return {
      attachment: {
        set,
        setDigest: computeAgentAttachmentSetDigest(set.files),
        view: buildAgentAttachmentDataView(files),
      },
    };
  }

  const publicAttachmentFileMeta = (file: AgentAttachmentFileMeta) => ({
    idx: file.idx,
    name: file.name,
    mediaType: file.mediaType,
    kind: file.kind,
    byteSize: file.byteSize,
    charCount: file.charCount,
    sha256: file.sha256,
    extractionStatus: file.extractionStatus,
  });
  const publicAttachmentSetView = (set: AgentAttachmentSetRecord) => {
    const totals = agentAttachmentSetTotals(set.files);
    return {
      setId: set.setId,
      status: set.status,
      claimedRunId: set.claimedRunId,
      fileCount: totals.fileCount,
      totalChars: totals.totalChars,
      setDigest: computeAgentAttachmentSetDigest(set.files),
      files: set.files.map(publicAttachmentFileMeta),
      createdAt: new Date(set.createdAt).toISOString(),
      updatedAt: new Date(set.updatedAt).toISOString(),
      expiresAt: new Date(set.expiresAt).toISOString(),
    };
  };
  const attachmentsDisabled = (res: express.Response) => res.status(503).json({ ok: false, code: 'AGENT_ATTACHMENTS_DISABLED' });

  router.post('/api/agent/v3/attachment-sets', agentV3RateLimitGuard, agentV3RateLimiter, async (req, res) => {
    if (!agentAttachmentsEnabled(env)) return attachmentsDisabled(res);
    if (!attachmentStore) return attachmentStoreUnavailable(res);
    // Creation is authorized like /plan — operator credential, or a
    // same-origin browser request — because what is issued is only an
    // upload capability: the data itself is used solely inside a plan
    // a human approves afterwards.
    const operatorAuthenticated = agentOperatorConfiguredV3(env) && authenticateAgentOperatorV3(req, env);
    const browserEligible = !operatorAuthenticated && isSameOriginBrowserRequest(req, env);
    if (!operatorAuthenticated && !browserEligible) {
      if (!agentOperatorConfiguredV3(env) && !v3CapabilityConfigured(env)) return res.status(503).json({ ok: false, code: 'AGENT_APPROVAL_NOT_CONFIGURED' });
      if (agentOperatorConfiguredV3(env)) return res.status(401).json({ ok: false, code: 'AGENT_AUTHENTICATION_REQUIRED' });
      return res.status(403).json({ ok: false, code: 'AGENT_BROWSER_ORIGIN_REQUIRED' });
    }
    const now = Date.now();
    const setId = `att-${randomUUID()}`;
    let issued: { token: string; expiresAt: number };
    try {
      issued = issueAttachmentUploadCapability(setId, env, now);
    } catch {
      return res.status(503).json({ ok: false, code: 'AGENT_APPROVAL_NOT_CONFIGURED' });
    }
    const ownerBinding = operatorAuthenticated ? OPERATOR_RUN_OWNER_BINDING : browserAttachmentOwnerBinding(issued.token);
    try {
      const created = await attachmentStore.createSet({
        setId,
        ownerBinding,
        uploadTokenDigest: attachmentUploadTokenDigest(issued.token),
        expiresAt: now + AGENT_ATTACHMENT_SET_TTL_MS,
      }, now);
      if (!created) return res.status(409).json({ ok: false, code: 'AGENT_ATTACHMENT_SET_ALREADY_EXISTS' });
      return res.status(201).json({
        ok: true,
        protocolVersion: 3,
        attachmentSetId: setId,
        uploadToken: issued.token,
        expiresAt: new Date(created.expiresAt).toISOString(),
        ...runEnvelope,
      });
    } catch (error) {
      return attachmentStoreFailure(res, 'attachment-set-create', error);
    }
  });

  router.post('/api/agent/v3/attachment-sets/:setId/files', agentV3RateLimitGuard, agentV3RateLimiter, async (req, res) => {
    if (!agentAttachmentsEnabled(env)) return attachmentsDisabled(res);
    if (!attachmentStore) return attachmentStoreUnavailable(res);
    const setId = typeof req.params.setId === 'string' ? req.params.setId : '';
    if (!AGENT_ATTACHMENT_SET_ID_PATTERN.test(setId)) return res.status(400).json({ ok: false, code: 'AGENT_ATTACHMENT_SET_ID_INVALID' });
    const auth = resolveAttachmentAuth(req, setId);
    if ('status' in auth) return res.status(auth.status).json({ ok: false, code: auth.code });
    const loaded = await loadAttachmentSet(setId, auth);
    if ('failure' in loaded) {
      if (loaded.failure.error !== undefined) return attachmentStoreFailure(res, 'attachment-file-add', loaded.failure.error);
      return res.status(loaded.failure.status).json({ ok: false, code: loaded.failure.code });
    }
    const { set } = loaded;
    if (set.status !== 'open') return res.status(409).json({ ok: false, code: 'AGENT_ATTACHMENT_SET_NOT_OPEN' });
    const body = (req.body ?? {}) as { name?: unknown; mediaType?: unknown; contentText?: unknown };
    let name: string;
    try {
      name = normalizeAgentAttachmentFileName(body.name);
    } catch {
      return res.status(400).json({ ok: false, code: 'AGENT_ATTACHMENT_FILE_INVALID' });
    }
    if (typeof body.contentText !== 'string') return res.status(400).json({ ok: false, code: 'AGENT_ATTACHMENT_FILE_INVALID' });
    const kind = resolveAgentAttachmentKind(name, typeof body.mediaType === 'string' ? body.mediaType : undefined);
    if (!kind) return res.status(415).json({ ok: false, code: 'AGENT_ATTACHMENT_KIND_UNSUPPORTED', fileName: name });
    const mediaType = normalizeAgentAttachmentMediaType(name, body.mediaType);
    // Ingestion validation (design §2.1, §4.3): oversize and secret
    // screening reject the file as a whole — with the numbers in the
    // response — instead of truncating it into compliance.
    let measured: { byteSize: number; charCount: number; sha256: string };
    try {
      measured = validateAgentAttachmentFileText(body.contentText);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'AGENT_ATTACHMENT_FILE_TOO_LARGE') {
        return res.status(413).json({ ok: false, code, fileName: name, charCount: body.contentText.length, limit: MAX_AGENT_ATTACHMENT_FILE_TEXT_CHARS });
      }
      if (code === 'AGENT_ATTACHMENT_SECRET_CONTENT_BLOCKED') return res.status(422).json({ ok: false, code, fileName: name });
      return res.status(400).json({ ok: false, code: 'AGENT_ATTACHMENT_FILE_INVALID' });
    }
    const totals = agentAttachmentSetTotals(set.files);
    if (totals.fileCount >= MAX_AGENT_ATTACHMENT_SET_FILES) {
      return res.status(409).json({ ok: false, code: 'AGENT_ATTACHMENT_SET_FILE_LIMIT', fileName: name, fileCount: totals.fileCount, limit: MAX_AGENT_ATTACHMENT_SET_FILES });
    }
    if (totals.totalChars + measured.charCount > MAX_AGENT_ATTACHMENT_SET_TEXT_CHARS) {
      return res.status(413).json({ ok: false, code: 'AGENT_ATTACHMENT_SET_TOO_LARGE', fileName: name, totalChars: totals.totalChars + measured.charCount, limit: MAX_AGENT_ATTACHMENT_SET_TEXT_CHARS });
    }
    try {
      const meta = await attachmentStore.addFile(setId, auth.ownerBinding, {
        name,
        mediaType,
        kind,
        byteSize: measured.byteSize,
        charCount: measured.charCount,
        sha256: measured.sha256,
        extractedText: body.contentText,
      });
      const files = [...set.files, meta];
      const nextTotals = agentAttachmentSetTotals(files);
      return res.status(201).json({
        ok: true,
        protocolVersion: 3,
        attachmentSetId: setId,
        file: publicAttachmentFileMeta(meta),
        setDigest: computeAgentAttachmentSetDigest(files),
        fileCount: nextTotals.fileCount,
        totalChars: nextTotals.totalChars,
        ...runEnvelope,
      });
    } catch (error) {
      // The store re-checks the set-level limits atomically; map its
      // refusal codes onto the same responses as the pre-checks above.
      const code = error instanceof Error ? error.message : '';
      if (code === 'AGENT_ATTACHMENT_SET_NOT_FOUND') return res.status(404).json({ ok: false, code });
      if (code === 'AGENT_ATTACHMENT_SET_NOT_OPEN') return res.status(409).json({ ok: false, code });
      if (code === 'AGENT_ATTACHMENT_SET_FILE_LIMIT') return res.status(409).json({ ok: false, code, fileName: name });
      if (code === 'AGENT_ATTACHMENT_SET_TOO_LARGE') return res.status(413).json({ ok: false, code, fileName: name });
      if (code === 'AGENT_ATTACHMENT_SECRET_CONTENT_BLOCKED') return res.status(422).json({ ok: false, code, fileName: name });
      return attachmentStoreFailure(res, 'attachment-file-add', error);
    }
  });

  router.get('/api/agent/v3/attachment-sets/:setId', agentV3RateLimitGuard, async (req, res) => {
    if (!agentAttachmentsEnabled(env)) return attachmentsDisabled(res);
    if (!attachmentStore) return attachmentStoreUnavailable(res);
    const setId = typeof req.params.setId === 'string' ? req.params.setId : '';
    if (!AGENT_ATTACHMENT_SET_ID_PATTERN.test(setId)) return res.status(400).json({ ok: false, code: 'AGENT_ATTACHMENT_SET_ID_INVALID' });
    const auth = resolveAttachmentAuth(req, setId);
    if ('status' in auth) return res.status(auth.status).json({ ok: false, code: auth.code });
    const loaded = await loadAttachmentSet(setId, auth);
    if ('failure' in loaded) {
      if (loaded.failure.error !== undefined) return attachmentStoreFailure(res, 'attachment-set-get', loaded.failure.error);
      return res.status(loaded.failure.status).json({ ok: false, code: loaded.failure.code });
    }
    // Metadata only: this endpoint never returns a file body.
    return res.json({ ok: true, protocolVersion: 3, attachmentSet: publicAttachmentSetView(loaded.set), ...runEnvelope });
  });

  router.delete('/api/agent/v3/attachment-sets/:setId', agentV3RateLimitGuard, async (req, res) => {
    if (!agentAttachmentsEnabled(env)) return attachmentsDisabled(res);
    if (!attachmentStore) return attachmentStoreUnavailable(res);
    const setId = typeof req.params.setId === 'string' ? req.params.setId : '';
    if (!AGENT_ATTACHMENT_SET_ID_PATTERN.test(setId)) return res.status(400).json({ ok: false, code: 'AGENT_ATTACHMENT_SET_ID_INVALID' });
    const auth = resolveAttachmentAuth(req, setId);
    if ('status' in auth) return res.status(auth.status).json({ ok: false, code: auth.code });
    const loaded = await loadAttachmentSet(setId, auth);
    if ('failure' in loaded) {
      if (loaded.failure.error !== undefined) return attachmentStoreFailure(res, 'attachment-set-delete', loaded.failure.error);
      return res.status(loaded.failure.status).json({ ok: false, code: loaded.failure.code });
    }
    try {
      const deleted = await attachmentStore.deleteSet(setId, auth.ownerBinding);
      if (!deleted) return res.status(404).json({ ok: false, code: 'AGENT_ATTACHMENT_SET_NOT_FOUND' });
      return res.json({ ok: true, protocolVersion: 3, attachmentSetId: setId, deleted: true, ...runEnvelope });
    } catch (error) {
      return attachmentStoreFailure(res, 'attachment-set-delete', error);
    }
  });

  return router;
}
