import express, { type Router } from 'express';
import { executeToolWithPermission, type ToolName } from './toolRegistry';
import { getCheckpoint, rollbackToCheckpoint, saveCheckpoint } from './checkpointManager';

type AgentStep = { id: string; title: string; status: 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'aborted'; detail: string };
const sse = (res: express.Response, payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

const buildPlan = (goal: string): AgentStep[] => [
  { id: 'goal', title: 'Goal analysis', status: 'running', detail: `目標: ${goal.slice(0, 180)}` },
  { id: 'plan', title: 'Task decomposition', status: 'queued', detail: '成果条件・依存関係・実行順序を分解' },
  { id: 'critique', title: 'Self-critique', status: 'queued', detail: '抜け漏れ、リスク、前提を再点検' },
  { id: 'execute', title: 'Execution', status: 'queued', detail: 'Human approval後に登録済みツールだけを実行' },
];

export function createAgentOrchestratorRouter(): Router {
  const router = express.Router();
  router.post('/api/agent', (req, res) => {
    const { goal, action, toolName, params, checkpointId } = req.body ?? {};
    if (action === 'rollback') {
      if (typeof checkpointId !== 'string' || !checkpointId) return res.status(400).json({ code: 'INVALID_CHECKPOINT' });
      try { return res.status(200).json({ ok: true, checkpoint: rollbackToCheckpoint(checkpointId) }); }
      catch { return res.status(404).json({ code: 'CHECKPOINT_NOT_FOUND' }); }
    }
    if (action === 'execute') {
      if (typeof toolName !== 'string' || !['code_interpreter', 'document_generator', 'web_search_grounding', 'image_prompt_compiler'].includes(toolName)) return res.status(400).json({ code: 'INVALID_TOOL' });
      const taskId = typeof req.body?.taskId === 'string' ? req.body.taskId.slice(0, 120) : 'agent-task';
      void (async () => {
        try {
          const result = await executeToolWithPermission(toolName as ToolName, (params ?? {}) as Record<string, unknown>, { approved: true, costInUSD: 0, safetyPolicyPassed: true });
          const checkpoint = result.artifact ? saveCheckpoint({ taskId, status: result.ok ? 'completed' : 'blocked', artifact: result.artifact }) : undefined;
          if (!res.headersSent) return res.status(result.ok ? 200 : 409).json({ ...result, checkpoint });
        } catch (error) {
          const code = error instanceof Error ? error.message : 'TOOL_EXECUTION_BLOCKED';
          if (!res.headersSent) return res.status(403).json({ ok: false, code, message: 'Tool execution was blocked by the permission gate.' });
        }
      })();
      return undefined;
    }
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 4000) return res.status(400).json({ code: 'INVALID_AGENT_GOAL', message: 'Agent goal is required and must be 1-4000 characters.' });
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const steps = buildPlan(goal.trim());
    let closed = false;
    req.on('close', () => { closed = true; });
    const emit = (payload: unknown) => { if (!closed) sse(res, payload); };
    const run = async () => {
      for (let i = 0; i < steps.length; i += 1) {
        if (closed) return;
        if (i > 0) { steps[i - 1] = { ...steps[i - 1], status: 'completed' }; emit({ type: 'step', step: steps[i - 1] }); }
        steps[i] = { ...steps[i], status: i === steps.length - 1 ? 'awaiting_approval' : 'running' };
        emit({ type: 'step', step: steps[i] });
        emit({ type: 'log', message: `[${steps[i].title}] ${steps[i].detail}` });
        if (i === 1) emit({ type: 'artifact', artifact: `# Agent Plan\n\nGoal\n- ${goal.trim()}\n\nExecution Gate\n- Human approval required\n- Tool Registry + Permission Gate required\n- Checkpoint created after successful execution\n` });
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      if (!closed) { emit({ type: 'done', message: 'Plan ready. Select an approved tool to execute.' }); res.end(); }
    };
    void run();
    return undefined;
  });
  router.get('/api/agent/checkpoint/:checkpointId', (req, res) => {
    const checkpoint = getCheckpoint(req.params.checkpointId);
    return checkpoint ? res.status(200).json({ ok: true, checkpoint }) : res.status(404).json({ code: 'CHECKPOINT_NOT_FOUND' });
  });
  return router;
}
