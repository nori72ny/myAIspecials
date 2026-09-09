import { randomUUID } from 'node:crypto';

export const AGENT_RUN_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_AGENT_RUN_TIMEOUT_MS = 15_000;
export const MAX_AGENT_RUN_TIMEOUT_MS = 60_000;

export type AgentRunStatus =
  | 'queued'
  | 'planning'
  | 'awaiting_approval'
  | 'running'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export type AgentRunEvent<T extends Record<string, unknown> = Record<string, unknown>> = T & {
  protocolVersion: typeof AGENT_RUN_PROTOCOL_VERSION;
  runId: string;
  sequence: number;
  timestamp: string;
  status: AgentRunStatus;
  type: string;
  freeOnly: true;
  costUsd: 0;
  paidFallbackUsed: false;
};

const TERMINAL = new Set<AgentRunStatus>(['completed', 'failed', 'cancelled', 'timed_out']);
const TRANSITIONS: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> = Object.freeze({
  queued: ['planning', 'cancelled'],
  planning: ['awaiting_approval', 'failed', 'cancelled', 'timed_out'],
  awaiting_approval: ['running', 'cancelled', 'timed_out'],
  running: ['verifying', 'failed', 'cancelled', 'timed_out'],
  verifying: ['completed', 'failed', 'cancelled', 'timed_out'],
  completed: [],
  failed: [],
  cancelled: [],
  timed_out: [],
});

function boundedTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_AGENT_RUN_TIMEOUT_MS;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1_000) return DEFAULT_AGENT_RUN_TIMEOUT_MS;
  return Math.min(value, MAX_AGENT_RUN_TIMEOUT_MS);
}

export class AgentRunSession {
  readonly runId: string;
  readonly createdAt: number;
  readonly deadlineAt: number;
  private sequence = 0;
  private currentStatus: AgentRunStatus = 'queued';

  constructor(options: { now?: number; timeoutMs?: number; idFactory?: () => string } = {}) {
    const now = options.now ?? Date.now();
    if (!Number.isFinite(now)) throw new Error('INVALID_AGENT_RUN_TIME');
    const id = (options.idFactory ?? randomUUID)();
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) throw new Error('INVALID_AGENT_RUN_ID');
    this.runId = `run-${id}`;
    this.createdAt = now;
    this.deadlineAt = now + boundedTimeout(options.timeoutMs);
  }

  get status(): AgentRunStatus { return this.currentStatus; }
  get isTerminal(): boolean { return TERMINAL.has(this.currentStatus); }
  isExpired(now = Date.now()): boolean { return now >= this.deadlineAt; }

  transition(next: AgentRunStatus): void {
    if (!TRANSITIONS[this.currentStatus].includes(next)) throw new Error('AGENT_RUN_TRANSITION_DENIED');
    this.currentStatus = next;
  }

  cancel(): void {
    if (!this.isTerminal && TRANSITIONS[this.currentStatus].includes('cancelled')) this.currentStatus = 'cancelled';
  }

  event<T extends Record<string, unknown>>(type: string, payload: T, now = Date.now()): AgentRunEvent<T> {
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(type)) throw new Error('INVALID_AGENT_RUN_EVENT_TYPE');
    this.sequence += 1;
    return {
      ...payload,
      protocolVersion: AGENT_RUN_PROTOCOL_VERSION,
      runId: this.runId,
      sequence: this.sequence,
      timestamp: new Date(now).toISOString(),
      status: this.currentStatus,
      type,
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
    };
  }
}
