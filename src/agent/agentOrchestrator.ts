import express, { type Router } from 'express';
import { executeToolWithPermission, type ToolName, type ToolParams } from './toolRegistry.js';
import { verifyAndSelfFixArtifact } from './autoVerificationEngine.js';
import { runVerifiedRepositoryRepairLoop, type RepairProposal } from './verifiedRepositoryRepairLoop.js';
import { getCheckpoint, rollbackToCheckpoint, saveCheckpoint } from './checkpointManager.js';

type AgentStep = { id: string; title: string; status: 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'aborted'; detail: string };
const sse = (res: express.Response, payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

const buildPlan = (goal: string): AgentStep[] => [
  { id: 'goal', title: 'Goal analysis', status: 'running', detail: `目標: ${goal.slice(0, 180)}` },
  { id: 'plan', title: 'Task decomposition', status: 'queued', detail: '成果条件・依存関係・実行順序を分解' },
  { id: 'critique', title: 'Self-critique', status: 'queued', detail: '抜け漏れ、リスク、前提を再点検' },
  { id: 'execute', title: 'Execution', status: 'queued', detail: 'Human approval後に登録済みツールだけを実行' },
];

const isToolName = (value: unknown): value is ToolName =>
  value === 'code_interpreter' || value === 'document_generator' || value === 'web_search_grounding' || value === 'image_prompt_compiler' || value === 'repository_explorer' || value === 'file_reader' || value === 'file_writer' || value === 'verification_runner';

const isVerificationKind = (value: unknown): value is 'test' | 'typecheck' | 'build' =>
  value === 'test' || value === 'typecheck' || value === 'build';

const parseRepairProposals = (value: unknown): RepairProposal[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.path !== 'string' || typeof candidate.content !== 'string') return [];
    if (candidate.path.length === 0 || candidate.path.length > 240 || candidate.content.length > 12000) return [];
    return [{ path: candidate.path, content: candidate.content }];
  }).slice(0, 3);
};

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
      if (!isToolName(toolName)) return res.status(400).json({ code: 'INVALID_TOOL' });
      if (req.body?.intentExplicit !== true) return res.status(403).json({ ok: false, code: 'AGENT_EXECUTION_APPROVAL_REQUIRED', message: 'Explicit execution intent is required.' });
      const toolParams = (params ?? {}) as ToolParams;
      if (toolName === 'file_writer' && !isVerificationKind(toolParams.verificationKind)) {
        return res.status(400).json({ ok: false, code: 'VERIFICATION_REQUIRED_AFTER_WRITE', message: 'file_writer requires verificationKind: test, typecheck, or build.' });
      }
      const taskId = typeof req.body?.taskId === 'string' ? req.body.taskId.slice(0, 120) : 'agent-task';
      void (async () => {
        try {
          const runTool = async (name: ToolName, input: ToolParams) =>
            executeToolWithPermission(name, input, { approved: true, costInUSD: 0, safetyPolicyPassed: true });

          if (toolName === 'file_writer') {
            const verificationKind = toolParams.verificationKind as 'test' | 'typecheck' | 'build';
            const repairProposals = parseRepairProposals(toolParams.repairProposals);
            const initialWrite: RepairProposal = {
              path: typeof toolParams.path === 'string' ? toolParams.path : '',
              content: typeof toolParams.content === 'string' ? toolParams.content : '',
            };

            if (repairProposals.length > 0) {
              const repairLoop = await runVerifiedRepositoryRepairLoop(initialWrite, verificationKind, repairProposals, runTool);
              if (!repairLoop.ok) {
                if (!res.headersSent) return res.status(422).json({ ok: false, code: 'REPOSITORY_REPAIR_FAILED', repairLoop });
                return;
              }
              const checkpoint = saveCheckpoint({ taskId, status: repairLoop.repaired ? 'self_fixed' : 'completed', artifact: repairLoop.lastWrite?.artifact ?? '' });
              if (!res.headersSent) return res.status(200).json({ ok: true, tool: toolName, checkpoint, repairLoop });
              return;
            }

            const result = await runTool(toolName, toolParams);
            const verificationRun = await runTool('verification_runner', { kind: verificationKind });
            const verification = { ok: verificationRun.ok, attempts: 1, selfFixed: false, diagnosis: verificationRun.message };
            if (!verificationRun.ok) {
              if (!res.headersSent) return res.status(422).json({ ...result, ok: false, code: 'POST_WRITE_VERIFICATION_FAILED', verification, verificationRun });
              return;
            }
            const checkpoint = saveCheckpoint({ taskId, status: 'completed', artifact: result.artifact ?? '' });
            if (!res.headersSent) return res.status(200).json({ ...result, ok: true, checkpoint, verification, verificationRun });
            return;
          }

          const result = await runTool(toolName, toolParams);
          const verification = result.artifact
            ? await verifyAndSelfFixArtifact(result.artifact, toolName, runTool, toolParams)
            : { ok: false, artifact: '', attempts: 0, selfFixed: false, issues: ['empty'] as const, diagnosis: 'No artifact was produced.' };

          if (!verification.ok) {
            if (!res.headersSent) return res.status(422).json({ ...result, ok: false, code: 'ARTIFACT_VERIFICATION_FAILED', verification });
            return;
          }

          const checkpoint = saveCheckpoint({ taskId, status: verification.selfFixed ? 'self_fixed' : 'completed', artifact: verification.artifact });
          if (!res.headersSent) {
            return res.status(200).json({ ...result, ok: true, artifact: verification.artifact, checkpoint, verification: { attempts: verification.attempts, selfFixed: verification.selfFixed, diagnosis: verification.diagnosis } });
          }
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
        if (i === 1) emit({ type: 'artifact', artifact: `# Agent Plan\n\nGoal\n- ${goal.trim()}\n\nExecution Gate\n- Human approval required\n- Tool Registry + Permission Gate required\n- File writes require post-write test/typecheck/build verification\n- Bounded repository repair may retry only supplied repair proposals\n- Checkpoint created after successful execution\n` });
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