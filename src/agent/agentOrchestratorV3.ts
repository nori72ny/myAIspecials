import express, { type Router } from 'express';
import { executeToolWithPermission, type ToolName, type ToolParams } from './toolRegistry.js';
import { verifyAndSelfFixArtifact } from './autoVerificationEngine.js';
import { verifyBeforeReportingCompletion } from './completionVerificationGate.js';
import { saveCheckpoint } from './checkpointManager.js';
import { assertCanReportCompleted } from './taskExecutionGate.js';
import { createAgentTaskGraph } from './agentTaskGraph.js';
import { executeNextTask } from './taskGraphExecutor.js';
import { AgentRunSession } from './agentRunContract.js';
import { agentApprovalConfigured, approvalDigest, authenticateAgentRequest, consumeApproval, issueApproval, type AgentApprovalOperation } from './agentApproval.js';
import { assertRunExecutionBinding, bindRunApproval, getAgentRun, registerPlannedRun, transitionRegisteredRun } from './agentRunRegistry.js';

const TOOL_NAMES: readonly ToolName[] = ['code_interpreter', 'document_generator', 'web_search_grounding', 'image_prompt_compiler', 'repository_explorer', 'file_reader', 'file_writer', 'verification_runner'];
const isToolName = (value: unknown): value is ToolName => typeof value === 'string' && TOOL_NAMES.includes(value as ToolName);
const PLAN_TITLES = ['Goal analysis', 'Task decomposition', 'Self-critique', 'Execution', 'Verification'];
const createExecutionId = () => `exec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export function createAgentOrchestratorV3Router(): Router {
  const router = express.Router();

  router.post('/api/agent/v3/plan', (req, res) => {
    const goal = req.body?.goal;
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 4000) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_GOAL' });
    const run = new AgentRunSession();
    run.transition('planning');
    run.transition('awaiting_approval');
    const record = registerPlannedRun(run.runId, goal.trim());
    return res.status(201).json({
      ok: true,
      protocolVersion: 3,
      runId: run.runId,
      status: record.status,
      expiresAt: new Date(record.expiresAt).toISOString(),
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
      plan: PLAN_TITLES.map((title, index) => ({ id: `task-${index + 1}`, title })),
    });
  });

  router.post('/api/agent/v3/approval', (req, res) => {
    if (!agentApprovalConfigured()) return res.status(503).json({ ok: false, code: 'AGENT_APPROVAL_NOT_CONFIGURED' });
    if (!authenticateAgentRequest(req)) return res.status(401).json({ ok: false, code: 'AGENT_AUTHENTICATION_REQUIRED' });
    const { runId, toolName, params } = req.body ?? {};
    if (typeof runId !== 'string' || !runId.startsWith('run-')) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_RUN_ID' });
    if (!isToolName(toolName)) return res.status(400).json({ ok: false, code: 'INVALID_TOOL' });
    const run = getAgentRun(runId);
    if (!run) return res.status(404).json({ ok: false, code: 'AGENT_RUN_NOT_FOUND' });
    const operation: AgentApprovalOperation = { action: 'execute', runId, toolName, params: params ?? {} };
    try {
      bindRunApproval(runId, approvalDigest(operation));
      return res.status(201).json({ ok: true, protocolVersion: 3, runId, approvalToken: issueApproval(operation), expiresInMs: 120000 });
    } catch (error) {
      return res.status(409).json({ ok: false, code: error instanceof Error ? error.message : 'AGENT_RUN_APPROVAL_FAILED' });
    }
  });

  router.post('/api/agent/v3/execute', (req, res) => {
    const { runId, toolName, params, approvalToken } = req.body ?? {};
    if (!authenticateAgentRequest(req)) return res.status(401).json({ ok: false, code: 'AGENT_AUTHENTICATION_REQUIRED' });
    if (typeof runId !== 'string' || !runId.startsWith('run-')) return res.status(400).json({ ok: false, code: 'INVALID_AGENT_RUN_ID' });
    if (!isToolName(toolName)) return res.status(400).json({ ok: false, code: 'INVALID_TOOL' });
    if (typeof approvalToken !== 'string' || approvalToken.length > 200) return res.status(403).json({ ok: false, code: 'AGENT_AUTHENTICATED_APPROVAL_REQUIRED' });
    const operation: AgentApprovalOperation = { action: 'execute', runId, toolName, params: params ?? {} };
    try {
      assertRunExecutionBinding(runId, approvalDigest(operation));
      if (!consumeApproval(approvalToken, operation)) return res.status(403).json({ ok: false, code: 'AGENT_AUTHENTICATED_APPROVAL_REQUIRED' });
      transitionRegisteredRun(runId, 'running');
    } catch (error) {
      return res.status(409).json({ ok: false, code: error instanceof Error ? error.message : 'AGENT_RUN_EXECUTION_BLOCKED' });
    }

    const executionId = createExecutionId();
    const toolParams = (params ?? {}) as ToolParams;
    const executionApproval = { approved: true, costInUSD: 0, safetyPolicyPassed: true };
    void (async () => {
      try {
        const runTool = async (name: ToolName, input: ToolParams) => executeToolWithPermission(name, input, executionApproval);
        const graph = createAgentTaskGraph(`execute ${toolName}`, [toolName]);
        const execution = await executeNextTask(graph, async () => runTool(toolName, toolParams), async (result) => result.artifact
          ? verifyAndSelfFixArtifact(result.artifact, toolName, runTool, toolParams)
          : { ok: false, artifact: '', attempts: 0, selfFixed: false, issues: ['empty'] as const, diagnosis: 'No artifact was produced.' });
        transitionRegisteredRun(runId, 'verifying');
        const record = execution.record;
        const finalTask = execution.graph.tasks[0];
        if (!record?.toolExecuted || !record.verified || record.status !== 'completed' || finalTask.status !== 'completed') {
          transitionRegisteredRun(runId, 'failed');
          if (!res.headersSent) return res.status(422).json({ ok: false, code: 'ARTIFACT_VERIFICATION_FAILED', protocolVersion: 3, runId, execution });
          return;
        }
        if (toolName === 'file_writer') {
          const completionVerification = await verifyBeforeReportingCompletion(process.cwd());
          if (!completionVerification.ok) {
            transitionRegisteredRun(runId, 'failed');
            if (!res.headersSent) return res.status(422).json({ ok: false, code: 'COMPLETION_VERIFICATION_FAILED', protocolVersion: 3, runId, completionVerification });
            return;
          }
        }
        assertCanReportCompleted({ state: finalTask.status, verified: record.verified, toolExecuted: record.toolExecuted, repairAttempts: record.verificationAttempts });
        const checkpoint = saveCheckpoint({ taskId: finalTask.id, executionId, status: record.verificationAttempts > 0 ? 'self_fixed' : 'completed', artifact: record.artifact, mutation: record.mutation });
        transitionRegisteredRun(runId, 'completed');
        if (!res.headersSent) return res.status(200).json({ ok: true, protocolVersion: 3, runId, status: 'completed', freeOnly: true, costUsd: 0, paidFallbackUsed: false, tool: toolName, artifact: record.artifact, checkpoint });
      } catch (error) {
        try { transitionRegisteredRun(runId, 'failed'); } catch { /* terminal or missing */ }
        if (!res.headersSent) return res.status(403).json({ ok: false, code: error instanceof Error ? error.message : 'TOOL_EXECUTION_BLOCKED', protocolVersion: 3, runId });
      }
    })();
    return undefined;
  });

  router.get('/api/agent/v3/run/:runId', (req, res) => {
    if (!authenticateAgentRequest(req)) return res.status(401).json({ ok: false, code: 'AGENT_AUTHENTICATION_REQUIRED' });
    const run = getAgentRun(req.params.runId);
    if (!run) return res.status(404).json({ ok: false, code: 'AGENT_RUN_NOT_FOUND' });
    return res.status(200).json({ ok: true, run: { ...run, operationDigest: run.operationDigest ? 'bound' : undefined } });
  });

  return router;
}
