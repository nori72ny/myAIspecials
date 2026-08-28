import express, { type Router } from 'express';

type AgentStep = { id: string; title: string; status: 'queued' | 'running' | 'awaiting_approval' | 'completed'; detail: string };

const buildPlan = (goal: string): AgentStep[] => [
  { id: 'goal', title: 'Goal analysis', status: 'running', detail: `目標: ${goal.slice(0, 180)}` },
  { id: 'plan', title: 'Task decomposition', status: 'queued', detail: '成果条件・依存関係・実行順序を分解' },
  { id: 'critique', title: 'Self-critique', status: 'queued', detail: '抜け漏れ、リスク、前提を再点検' },
  { id: 'execute', title: 'Execution', status: 'queued', detail: 'Human approval後に許可された操作だけを実行' },
];

const sse = (res: express.Response, payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

export function createAgentOrchestratorRouter(): Router {
  const router = express.Router();
  router.post('/api/agent', (req, res) => {
    const goal = req.body?.goal;
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 4000) {
      return res.status(400).json({ code: 'INVALID_AGENT_GOAL', message: 'Agent goal is required and must be 1-4000 characters.' });
    }
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
        if (i > 0) {
          steps[i - 1] = { ...steps[i - 1], status: steps[i - 1].id === 'critique' ? 'completed' : steps[i - 1].id === 'execute' ? 'completed' : 'completed' };
          emit({ type: 'step', step: steps[i - 1] });
        }
        steps[i] = { ...steps[i], status: i === steps.length - 1 ? 'awaiting_approval' : 'running' };
        emit({ type: 'step', step: steps[i] });
        emit({ type: 'log', message: `[${steps[i].title}] ${steps[i].detail}` });
        if (i === 1) {
          emit({ type: 'log', message: '[DAG] 依存関係を確認: goal → plan → critique → execute' });
          emit({ type: 'artifact', artifact: `# Agent Plan\n\nGoal\n- ${goal.trim()}\n\nExecution Gate\n- Human approval required\n- External side effects are not performed by the planner\n` });
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      if (!closed) { emit({ type: 'done', message: 'Plan ready. Human approval is required before execution.' }); res.end(); }
    };
    void run();
    return undefined;
  });
  return router;
}
