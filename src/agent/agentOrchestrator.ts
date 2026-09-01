import express, { type Router } from 'express';
import { executeToolWithPermission, type ToolName, type ToolParams } from './toolRegistry.js';
import { verifyAndSelfFixArtifact } from './autoVerificationEngine.js';
import { getCheckpoint, rollbackToCheckpoint, saveCheckpoint } from './checkpointManager.js';
import { compactAgentContext } from './contextCompaction.js';
import { evaluateAgentOperation, MAX_AGENT_TASK_STEPS } from './agentContracts.js';
import { createAgentTaskGraph, getNextRunnableTask, markTaskResult, markTaskRunning, type AgentTaskGraph } from './agentTaskGraph.js';

type AgentStep = { id: string; title: string; status: 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'aborted'; detail: string };
const sse = (res: express.Response, payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
const PLAN_TITLES = ['Goal analysis', 'Task decomposition', 'Self-critique', 'Execution', 'Verification'];
const buildPlan = (goal: string): AgentStep[] => PLAN_TITLES.map((title, index) => ({ id: title.toLowerCase().replaceAll(' ', '-'), title, status: index === 0 ? 'running' : 'queued', detail: index === 0 ? `目標: ${goal.slice(0, 180)}` : index === 1 ? '成果条件・依存関係・実行順序を分解' : index === 2 ? '抜け漏れ、リスク、前提を再点検' : index === 3 ? '安全契約を通過した登録済みツールだけを実行' : '成果物を機械的に検証し、失敗時はbounded repair' }));
const isToolName = (value: unknown): value is ToolName => ['code_interpreter', 'document_generator', 'web_search_grounding', 'image_prompt_compiler', 'repository_explorer', 'file_reader'].includes(value as string);
const toTaskGraph = (goal: string): AgentTaskGraph => createAgentTaskGraph(goal, PLAN_TITLES);

export function createAgentOrchestratorRouter(): Router {
  const router = express.Router();
  router.post('/api/agent', (req, res) => {
    const { goal, action, toolName, params, checkpointId } = req.body ?? {};
    if (action === 'rollback') {
      if (typeof checkpointId !== 'string' || !checkpointId) return res.status(400).json({ code: 'INVALID_CHECKPOINT' });
      try { return res.status(200).json({ ok: true, checkpoint: rollbackToCheckpoint(checkpointId) }); } catch { return res.status(404).json({ code: 'CHECKPOINT_NOT_FOUND' }); }
    }
    if (action === 'execute') {
      if (!isToolName(toolName)) return res.status(400).json({ code: 'INVALID_TOOL' });
      const intentExplicit = req.body?.intentExplicit === true;
      const decision = evaluateAgentOperation('execute', intentExplicit);
      if (!decision.allowed) return res.status(403).json({ ok: false, code: 'AGENT_EXECUTION_APPROVAL_REQUIRED', message: decision.reason });
      const taskId = typeof req.body?.taskId === 'string' ? req.body.taskId.slice(0, 120) : 'agent-task';
      const toolParams = (params ?? {}) as ToolParams;
      void (async () => {
        try {
          const runTool = async (name: ToolName, input: ToolParams) => executeToolWithPermission(name, input, { approved: true, costInUSD: 0, safetyPolicyPassed: true });
          const result = await runTool(toolName, toolParams);
          const verification = result.artifact ? await verifyAndSelfFixArtifact(result.artifact, toolName, runTool, toolParams) : { ok: false, artifact: '', attempts: 0, selfFixed: false, issues: ['empty'] as const, diagnosis: 'No artifact was produced.' };
          if (!verification.ok) { if (!res.headersSent) return res.status(422).json({ ...result, ok: false, code: 'ARTIFACT_VERIFICATION_FAILED', verification }); return; }
          const checkpoint = saveCheckpoint({ taskId, status: verification.selfFixed ? 'self_fixed' : 'completed', artifact: verification.artifact });
          if (!res.headersSent) return res.status(200).json({ ...result, ok: true, artifact: verification.artifact, checkpoint, verification: { attempts: verification.attempts, selfFixed: verification.selfFixed, diagnosis: verification.diagnosis } });
        } catch (error) { const code = error instanceof Error ? error.message : 'TOOL_EXECUTION_BLOCKED'; if (!res.headersSent) return res.status(403).json({ ok: false, code, message: 'Tool execution was blocked by the permission gate.' }); }
      })();
      return undefined;
    }
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 4000) return res.status(400).json({ code: 'INVALID_AGENT_GOAL', message: 'Agent goal is required and must be 1-4000 characters.' });
    res.status(200); res.setHeader('Content-Type', 'text/event-stream; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache, no-transform'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders?.();
    const normalizedGoal = goal.trim(); const steps = buildPlan(normalizedGoal).slice(0, MAX_AGENT_TASK_STEPS); let graph = toTaskGraph(normalizedGoal); let closed = false;
    req.on('close', () => { closed = true; }); const emit = (payload: unknown) => { if (!closed) sse(res, payload); };
    const run = async () => {
      for (let i = 0; i < steps.length; i += 1) {
        if (closed) return; const runnable = getNextRunnableTask(graph);
        if (!runnable) { emit({ type: 'blocked', message: 'No dependency-ready task remains.' }); res.end(); return; }
        graph = markTaskRunning(graph, runnable.id); steps[i] = { ...steps[i], status: i === steps.length - 1 ? 'awaiting_approval' : 'running' };
        emit({ type: 'task', task: runnable }); emit({ type: 'step', step: steps[i] }); emit({ type: 'log', message: `[${steps[i].title}] ${steps[i].detail}` });
        if (i === 1) { const context = compactAgentContext(normalizedGoal, [{ stepId: 'goal', outcome: 'success', summary: 'Goal normalized and bounded.' }], 'critique assumptions and define executable steps'); emit({ type: 'context', context }); emit({ type: 'artifact', artifact: `# Agent Plan\n\nGoal\n- ${normalizedGoal}\n\nTask Graph\n- ${graph.tasks.map((task) => `${task.id}: ${task.title}`).join('\n- ')}\n\nExecution Gate\n- Explicit execution intent required\n- Tool Registry + Permission Gate required\n- Local artifact verification + bounded self-fix\n- Context is compacted between steps; raw tool output is not replayed indefinitely\n- Checkpoint created after successful execution\n` }); }
        graph = markTaskResult(graph, runnable.id, true); emit({ type: 'task_result', taskId: runnable.id, status: 'completed' }); await new Promise((resolve) => setTimeout(resolve, 120));
      }
      if (!closed) { emit({ type: 'done', message: 'Plan ready. Select an approved tool to execute.', graph }); res.end(); }
    };
    void run(); return undefined;
  });
  router.get('/api/agent/checkpoint/:checkpointId', (req, res) => { const checkpoint = getCheckpoint(req.params.checkpointId); return checkpoint ? res.status(200).json({ ok: true, checkpoint }) : res.status(404).json({ code: 'CHECKPOINT_NOT_FOUND' }); });
  return router;
}
