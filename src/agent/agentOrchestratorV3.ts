import { createHash } from 'node:crypto';
import express, { type Router } from 'express';
import { executeToolWithPermission, type ToolName, type ToolParams } from './toolRegistry.js';
import { verifyAndSelfFixArtifact } from './autoVerificationEngine.js';
import { verifyBeforeReportingCompletion } from './completionVerificationGate.js';
import { saveCheckpoint } from './checkpointManager.js';
import { assertCanReportCompleted } from './taskExecutionGate.js';
import { createAgentTaskGraph } from './agentTaskGraph.js';
import { executeNextTask } from './taskGraphExecutor.js';
import { AgentRunSession } from './agentRunContract.js';
import { approvalDigest, type AgentApprovalOperation } from './agentApproval.js';
import { issueApprovalCapability, issuePlanCapability, latestApprovalExpiryForPlan, v3CapabilityConfigured, verifyApprovalCapability, verifyPlanCapability } from './agentV3Capability.js';
import { selectAgentToolV3 } from './agentToolPlannerV3.js';
import { agentOperatorAuthorizationModeV3, agentOperatorConfiguredV3, authenticateAgentOperatorV3 } from './agentOperatorAuthV3.js';
import { AgentCodingBridgeV3 } from './agentCodingBridgeV3.js';
import { createOriginChatRateLimiter, requireSafeOriginChatRequest } from '../server/originSecurity.js';

const TOOL_NAMES: readonly ToolName[] = ['code_interpreter', 'document_generator', 'web_search_grounding', 'image_prompt_compiler', 'repository_explorer', 'file_reader', 'file_writer', 'verification_runner'];
const isToolName = (value: unknown): value is ToolName => typeof value === 'string' && TOOL_NAMES.includes(value as ToolName);
const PLAN_TITLES = ['Goal analysis', 'Task decomposition', 'Self-critique', 'Execution', 'Verification'];
const createExecutionId = () => `exec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const digestGoal = (goal: string) => createHash('sha256').update(goal).digest('hex');

/** Must atomically reserve a run across all server instances until expiresAt.
 * Return false for a previously reserved run. Never release after a tool failure.
 * No process-local default: serverless instances cannot share an in-memory map.
 */
export interface AgentRunConsumptionStore {
  consume(runId: string, expiresAt: number): Promise<boolean>;
}

export function createAgentOrchestratorV3Router(env: NodeJS.ProcessEnv = process.env, consumptionStore?: AgentRunConsumptionStore, codingBridge?: AgentCodingBridgeV3): Router {
  const router = express.Router();
  // Use one limiter instance across every POST control-plane endpoint.
  // Place both guards directly on each route so auth, state mutation and
  // signed capability paths cannot accidentally bypass protection.
  const safePost = requireSafeOriginChatRequest(env);
  const limitPost = createOriginChatRateLimiter(Date.now, ['POST']);

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
      codingBridgeConfigured: Boolean(codingBridge),
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

  router.post('/api/agent/v3/plan', safePost, limitPost, (req, res) => {
    if (!v3CapabilityConfigured(env)) return res.status(503).json({ ok: false, code: 'AGENT_APPROVAL_NOT_CONFIGURED' });
    const goal = req.body?.goal;
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 4000) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_GOAL' });
    const selected = selectAgentToolV3(goal.trim());
    if ('code' in selected) {
      return res.status(422).json({ ok: false, code: selected.code, protocolVersion: 3 });
    }
    if (selected.toolName === 'code_interpreter' && !codingBridge) {
      return res.status(503).json({ ok: false, code: 'AGENT_CODE_GENERATION_UNAVAILABLE', protocolVersion: 3 });
    }
    const run = new AgentRunSession();
    run.transition('planning');
    run.transition('awaiting_approval');
    const capability = issuePlanCapability(run.runId, digestGoal(goal.trim()), env, Date.now(), selected.toolName);
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
      selectedTool: selected.toolName,
      toolChoice: { source: 'deterministic-local', reasonCode: selected.reasonCode },
      plan: PLAN_TITLES.map((title, index) => ({ id: `task-${index + 1}`, title })),
    });
  });

  router.post('/api/agent/v3/approval', safePost, limitPost, (req, res) => {
    if (!v3CapabilityConfigured(env)) return res.status(503).json({ ok: false, code: 'AGENT_APPROVAL_NOT_CONFIGURED' });
    if (!agentOperatorConfiguredV3(env)) return res.status(503).json({ ok: false, code: 'AGENT_OPERATOR_AUTH_NOT_CONFIGURED' });
    if (!authenticateAgentOperatorV3(req, env)) return res.status(401).json({ ok: false, code: 'AGENT_AUTHENTICATION_REQUIRED' });
    const { runId, planToken, toolName, params } = req.body ?? {};
    if (typeof runId !== 'string' || !runId.startsWith('run-')) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_RUN_ID' });
    if (typeof planToken !== 'string') return res.status(403).json({ ok: false, code: 'AGENT_PLAN_CAPABILITY_REQUIRED' });
    if (!isToolName(toolName)) return res.status(400).json({ ok: false, code: 'INVALID_TOOL' });
    // Bind validation and issuance to one instant at the expiry boundary.
    const approvalNow = Date.now();
    const plan = verifyPlanCapability(planToken, env, approvalNow);
    if (!plan || plan.runId !== runId) return res.status(403).json({ ok: false, code: 'AGENT_PLAN_CAPABILITY_INVALID' });
    if (!isToolName(plan.plannedTool) || plan.plannedTool !== toolName) {
      return res.status(403).json({ ok: false, code: 'AGENT_PLAN_TOOL_MISMATCH' });
    }
    if (toolName === 'code_interpreter' && !codingBridge) {
      return res.status(503).json({ ok: false, code: 'AGENT_CODE_GENERATION_UNAVAILABLE', protocolVersion: 3 });
    }
    if (!consumptionStore) return res.status(503).json({ ok: false, code: 'AGENT_REPLAY_PROTECTION_UNAVAILABLE' });
    if (toolName === 'code_interpreter') {
      const codingGoal = params && typeof params === 'object' && !Array.isArray(params) ? (params as Record<string, unknown>).goal : undefined;
      if (typeof codingGoal !== 'string' || !codingGoal.trim() || digestGoal(codingGoal.trim()) !== plan.digest) {
        return res.status(403).json({ ok: false, code: 'AGENT_PLAN_GOAL_MISMATCH' });
      }
    }
    const operation: AgentApprovalOperation = { action: 'execute', runId, toolName, params: params ?? {} };
    const capability = issueApprovalCapability(runId, approvalDigest(operation), env, approvalNow);
    return res.status(201).json({
      ok: true,
      protocolVersion: 3,
      runId,
      approvalToken: capability.token,
      expiresAt: new Date(capability.expiresAt).toISOString(),
      scope: 'exact-operation',
    });
  });

  router.post('/api/agent/v3/cancel', safePost, limitPost, (req, res) => {
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

  router.post('/api/agent/v3/coding/recover', safePost, limitPost, (req, res) => {
    if (!codingBridge) return res.status(503).json({ ok: false, code: 'AGENT_CODING_BRIDGE_UNAVAILABLE' });
    if (agentOperatorAuthorizationModeV3(env) !== 'agent-operator' || !agentOperatorConfiguredV3(env)) {
      return res.status(503).json({ ok: false, code: 'AGENT_OPERATOR_AUTH_NOT_CONFIGURED' });
    }
    if (!authenticateAgentOperatorV3(req, env)) {
      return res.status(401).json({ ok: false, code: 'AGENT_AUTHENTICATION_REQUIRED' });
    }
    const { runId, jobId } = req.body ?? {};
    if (typeof runId !== 'string' || !/^run-[A-Za-z0-9-]{1,100}$/.test(runId)
      || typeof jobId !== 'string' || !/^coding-[A-Za-z0-9_-]{22}$/.test(jobId)) {
      return res.status(400).json({ ok: false, code: 'AGENT_CODING_RECOVERY_INVALID' });
    }
    void (async () => {
      try {
        const state = await codingBridge.recover(runId, jobId);
        if (!res.headersSent) return res.status(state.ok ? 200 : 404).json({ protocolVersion: 3, ...state });
      } catch {
        if (!res.headersSent) return res.status(503).json({ ok: false, code: 'AGENT_CODING_RECOVERY_UNAVAILABLE', protocolVersion: 3 });
      }
    })();
    return undefined;
  });

  router.post('/api/agent/v3/coding/status', safePost, limitPost, (req, res) => {
    if (!codingBridge) return res.status(503).json({ ok: false, code: 'AGENT_CODING_BRIDGE_UNAVAILABLE' });
    const { runId, jobId, bridgeToken } = req.body ?? {};
    if (typeof runId !== 'string' || !runId.startsWith('run-')) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_RUN_ID' });
    if (typeof jobId !== 'string' || !jobId.startsWith('coding-')) return res.status(400).json({ ok: false, code: 'INVALID_CODING_JOB_ID' });
    if (typeof bridgeToken !== 'string') return res.status(403).json({ ok: false, code: 'AGENT_CODING_BRIDGE_TOKEN_REQUIRED' });
    void (async () => {
      try {
        const state = await codingBridge.poll(runId, jobId, bridgeToken);
        if (!res.headersSent) return res.status(state.ok ? 200 : 422).json({ protocolVersion: 3, ...state });
      } catch {
        if (!res.headersSent) return res.status(503).json({ ok: false, code: 'AGENT_CODING_STATUS_UNAVAILABLE', protocolVersion: 3, runId });
      }
    })();
    return undefined;
  });

  router.post('/api/agent/v3/coding/cancel', safePost, limitPost, (req, res) => {
    if (!codingBridge) return res.status(503).json({ ok: false, code: 'AGENT_CODING_BRIDGE_UNAVAILABLE' });
    const { runId, jobId, bridgeToken } = req.body ?? {};
    if (typeof runId !== 'string' || !runId.startsWith('run-')) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_RUN_ID' });
    if (typeof jobId !== 'string' || !jobId.startsWith('coding-')) return res.status(400).json({ ok: false, code: 'INVALID_CODING_JOB_ID' });
    if (typeof bridgeToken !== 'string') return res.status(403).json({ ok: false, code: 'AGENT_CODING_BRIDGE_TOKEN_REQUIRED' });
    void (async () => {
      try {
        const state = await codingBridge.cancel(runId, jobId, bridgeToken);
        if (!res.headersSent) return res.status(state.ok ? 200 : 422).json({ protocolVersion: 3, ...state });
      } catch {
        if (!res.headersSent) return res.status(503).json({ ok: false, code: 'AGENT_CODING_CANCEL_UNAVAILABLE', protocolVersion: 3, runId });
      }
    })();
    return undefined;
  });

  router.post('/api/agent/v3/execute', safePost, limitPost, (req, res) => {
    const { runId, toolName, params, approvalToken } = req.body ?? {};
    if (!agentOperatorConfiguredV3(env)) return res.status(503).json({ ok: false, code: 'AGENT_OPERATOR_AUTH_NOT_CONFIGURED' });
    if (!authenticateAgentOperatorV3(req, env)) return res.status(401).json({ ok: false, code: 'AGENT_AUTHENTICATION_REQUIRED' });
    if (typeof runId !== 'string' || !runId.startsWith('run-')) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_RUN_ID' });
    if (!isToolName(toolName)) return res.status(400).json({ ok: false, code: 'INVALID_TOOL' });
    if (typeof approvalToken !== 'string') return res.status(403).json({ ok: false, code: 'AGENT_AUTHENTICATED_APPROVAL_REQUIRED' });
    const operation: AgentApprovalOperation = { action: 'execute', runId, toolName, params: params ?? {} };
    const approval = verifyApprovalCapability(approvalToken, env);
    if (!approval || approval.runId !== runId || approval.digest !== approvalDigest(operation)) {
      return res.status(403).json({ ok: false, code: 'AGENT_AUTHENTICATED_APPROVAL_REQUIRED' });
    }
    if (!consumptionStore) return res.status(503).json({ ok: false, code: 'AGENT_REPLAY_PROTECTION_UNAVAILABLE' });

    const executionId = createExecutionId();
    const toolParams = (params ?? {}) as ToolParams;
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
        if (toolName === 'code_interpreter') {
          if (!codingBridge) {
            if (!res.headersSent) return res.status(503).json({ ok: false, code: 'AGENT_CODING_BRIDGE_UNAVAILABLE', protocolVersion: 3, runId });
            return;
          }
          const codingGoal = typeof toolParams.goal === 'string' ? toolParams.goal.trim() : '';
          if (!codingGoal) {
            if (!res.headersSent) return res.status(400).json({ ok: false, code: 'AGENT_CODING_GOAL_REQUIRED', protocolVersion: 3, runId });
            return;
          }
          const started = await codingBridge.start(runId, codingGoal);
          if (!res.headersSent) return res.status(202).json({ protocolVersion: 3, ...started });
          return;
        }
        const runTool = async (name: ToolName, input: ToolParams) => executeToolWithPermission(name, input, executionApproval);
        const graph = createAgentTaskGraph(`execute ${toolName}`, [toolName]);
        const execution = await executeNextTask(graph, async () => runTool(toolName, toolParams), async (result) => result.artifact
          ? verifyAndSelfFixArtifact(result.artifact, toolName, runTool, toolParams)
          : { ok: false, artifact: '', attempts: 0, selfFixed: false, issues: ['empty'] as const, diagnosis: 'No artifact was produced.' });
        const record = execution.record;
        const finalTask = execution.graph.tasks[0];
        if (!record?.toolExecuted || !record.verified || record.status !== 'completed' || finalTask.status !== 'completed') {
          if (!res.headersSent) return res.status(422).json({ ok: false, code: 'ARTIFACT_VERIFICATION_FAILED', protocolVersion: 3, runId, execution });
          return;
        }
        if (toolName === 'file_writer') {
          const completionVerification = await verifyBeforeReportingCompletion(process.cwd());
          if (!completionVerification.ok) {
            if (!res.headersSent) return res.status(422).json({ ok: false, code: 'COMPLETION_VERIFICATION_FAILED', protocolVersion: 3, runId, completionVerification });
            return;
          }
        }
        assertCanReportCompleted({ state: finalTask.status, verified: record.verified, toolExecuted: record.toolExecuted, repairAttempts: record.verificationAttempts });
        const checkpoint = saveCheckpoint({ taskId: finalTask.id, executionId, status: record.verificationAttempts > 0 ? 'self_fixed' : 'completed', artifact: record.artifact, mutation: record.mutation });
        if (!res.headersSent) return res.status(200).json({ ok: true, protocolVersion: 3, runId, status: 'completed', freeOnly: true, costUsd: 0, paidFallbackUsed: false, tool: toolName, artifact: record.artifact, checkpoint });
      } catch {
        if (!res.headersSent) return res.status(403).json({ ok: false, code: 'TOOL_EXECUTION_BLOCKED', protocolVersion: 3, runId });
      }
    })();
    return undefined;
  });

  return router;
}
