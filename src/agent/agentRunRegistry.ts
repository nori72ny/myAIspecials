import { createHash } from 'node:crypto';
import type { AgentRunStatus } from './agentRunContract.js';

const MAX_RUNS = 1000;
const RUN_TTL_MS = 10 * 60 * 1000;

export type AgentRunRecord = {
  runId: string;
  protocolVersion: 3;
  status: AgentRunStatus;
  goalDigest: string;
  operationDigest?: string;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
};

const runs = new Map<string, AgentRunRecord>();

function cleanup(now: number): void {
  for (const [runId, record] of runs) {
    if (record.expiresAt <= now) runs.delete(runId);
  }
  while (runs.size >= MAX_RUNS) {
    const oldest = runs.keys().next().value as string | undefined;
    if (!oldest) break;
    runs.delete(oldest);
  }
}

export function digestAgentGoal(goal: string): string {
  return createHash('sha256').update(goal).digest('hex');
}

export function registerPlannedRun(runId: string, goal: string, now = Date.now()): AgentRunRecord {
  cleanup(now);
  const record: AgentRunRecord = {
    runId,
    protocolVersion: 3,
    status: 'awaiting_approval',
    goalDigest: digestAgentGoal(goal),
    createdAt: now,
    updatedAt: now,
    expiresAt: now + RUN_TTL_MS,
  };
  runs.set(runId, record);
  return { ...record };
}

export function getAgentRun(runId: string, now = Date.now()): AgentRunRecord | null {
  cleanup(now);
  const record = runs.get(runId);
  return record ? { ...record } : null;
}

export function bindRunApproval(runId: string, operationDigest: string, now = Date.now()): AgentRunRecord {
  cleanup(now);
  const record = runs.get(runId);
  if (!record) throw new Error('AGENT_RUN_NOT_FOUND');
  if (record.status !== 'awaiting_approval') throw new Error('AGENT_RUN_NOT_AWAITING_APPROVAL');
  record.operationDigest = operationDigest;
  record.updatedAt = now;
  return { ...record };
}

export function assertRunExecutionBinding(runId: string, operationDigest: string, now = Date.now()): AgentRunRecord {
  cleanup(now);
  const record = runs.get(runId);
  if (!record) throw new Error('AGENT_RUN_NOT_FOUND');
  if (record.status !== 'awaiting_approval') throw new Error('AGENT_RUN_NOT_AWAITING_APPROVAL');
  if (!record.operationDigest || record.operationDigest !== operationDigest) throw new Error('AGENT_RUN_OPERATION_MISMATCH');
  return { ...record };
}

export function transitionRegisteredRun(runId: string, status: AgentRunStatus, now = Date.now()): AgentRunRecord {
  cleanup(now);
  const record = runs.get(runId);
  if (!record) throw new Error('AGENT_RUN_NOT_FOUND');
  const allowed: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> = {
    queued: ['planning', 'cancelled'],
    planning: ['awaiting_approval', 'failed', 'cancelled', 'timed_out'],
    awaiting_approval: ['running', 'cancelled', 'timed_out'],
    running: ['verifying', 'failed', 'cancelled', 'timed_out'],
    verifying: ['completed', 'failed', 'cancelled', 'timed_out'],
    completed: [], failed: [], cancelled: [], timed_out: [],
  };
  if (!allowed[record.status].includes(status)) throw new Error('AGENT_RUN_TRANSITION_DENIED');
  record.status = status;
  record.updatedAt = now;
  return { ...record };
}

export function clearAgentRunsForTest(): void {
  runs.clear();
}
