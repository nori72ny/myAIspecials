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
import { approvalDigest, authenticateAgentRequest, type AgentApprovalOperation } from './agentApproval.js';
import { issueApprovalCapability, issuePlanCapability, v3CapabilityConfigured, verifyApprovalCapability, verifyPlanCapability } from './agentV3Capability.js';

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

export function createAgentOrchestratorV3Router(env: NodeJS.ProcessEnv = process.env, consumptionStore?: AgentRunConsumptionStore): Router {
  const router = express.Router();

  router.get('/api/agent/v3/status', (_req, res) => {
    const approvalSigningConfigured = v3CapabilityConfigured(env);
    const replayProtectionConfigured = Boolean(consumptionStore);
    return res.status(200).json({
      ok: true,
      protocolVersion: 3,
      ready: approvalSigningConfigured && replayProtectionConfigured,
      approvalSigningConfigured,
      replayProtectionConfigured,
      replayProtection: replayProtectionConfigured ? 'shared-atomic' : 'unavailable',
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      secretDelivery: 'server-only',
    });
  });

  router.post('/api/agent/v3/plan', (req, res) => {
    if (!v3CapabilityConfigured(env)) return res.status(503).json({ ok: false, code: 'AGENT_APPROVAL_NOT_CONFIGURED' });
    const goal = req.body?.goal;
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 4000) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_GOAL' });
    const run = new AgentRunSession();
    run.transition('planning');
    run.transition('awaiting_approval');
    const capability = issuePlanCapability(run.runId, digestGoal(goal.trim()), env);
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
      plan: PLAN_TITLES.map((title, index) => ({ id: `task-${index + 1}`, title })),
    });
  });

  router.post('/api/agent/v3/approval', (req, res) => {
    if (!v3CapabilityConfigured(env)) return res.status(503).json({ ok: false, code: 'AGENT_APPROVAL_NOT_CONFIGURED' });
    if (!authenticateAgentRequest(req, env)) return res.status(401).json({ ok: false, code: 'AGENT_AUTHENTICATION_REQUIRED' });
    const { runId, planToken, toolName, params } = req.body ?? {};
    if (typeof runId !== 'string' || !runId.startsWith('run-')) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_RUN_ID' });
    if (typeof planToken !== 'string') return res.status(403).json({ ok: false, code: 'AGENT_PLAN_CAPABILITY_REQUIRED' });
    if (!isToolName(toolName)) return res.status(400).json({ ok: false, code: 'INVALID_TOOL' });
    const plan = verifyPlanCapability(planToken, env);
    if (!plan || plan.runId !== runId) return res.status(403).json({ ok: false, code: 'AGENT_PLAN_CAPABILITY_INVALID' });
    if (!consumptionStore) return res.status(503).json({ ok: false, code: 'AGENT_REPLAY_PROTECTION_UNAVAILABLE' });
    const operation: AgentApprovalOperation = { action: 'execute', runId, toolName, params: params ?? {} };
    const capability = issueApprovalCapability(runId, approvalDigest(operation), env);
    return res.status(201).json({
      ok: true,
      protocolVersion: 3,
      runId,
      approvalToken: capability.token,
      expiresAt: new Date(capability.expiresAt).toISOString(),
      scope: 'exact-operation',
    });
  });

  router.post('/api/agent/v3/execute', (req, res) => {
    const { runId, toolName, params, approvalToken } = req.body ?? {};
    if (!authenticateAgentRequest(req, env)) return res.status(401).json({ ok: false, code: 'AGENT_AUTHENTICATION_REQUIRED' });
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
