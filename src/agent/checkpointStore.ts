import { createHash } from 'node:crypto';

export type Checkpoint = {
  id: string;
  taskId: string;
  step: number;
  status: 'pending' | 'completed' | 'failed';
  summary: string;
  updatedAt: string;
};

const MAX_SUMMARY = 4000;
const MAX_CHECKPOINTS = 20;

export function createCheckpoint(taskId: string, step: number, status: Checkpoint['status'], summary: string): Checkpoint {
  const safeSummary = summary
    .replace(/(?:api[_-]?key|secret|password|token)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED]')
    .slice(0, MAX_SUMMARY);
  const id = createHash('sha256').update(`${taskId}:${step}:${status}:${safeSummary}`).digest('hex').slice(0, 16);
  return { id, taskId, step, status, summary: safeSummary, updatedAt: new Date().toISOString() };
}

export function appendCheckpoint(history: Checkpoint[], checkpoint: Checkpoint): Checkpoint[] {
  const next = history.filter((item) => item.id !== checkpoint.id).concat(checkpoint);
  return next.slice(-MAX_CHECKPOINTS);
}
