import {
  AGENT_RUN_ID_PATTERN,
  AGENT_RUN_OWNER_BINDING_PATTERN,
  assertAgentRunStatusTransition,
  isAgentRunRecordStatus,
  normalizeAgentRunHold,
  normalizeAgentRunPlan,
  normalizeAgentRunPlanDigest,
  normalizeAgentRunPriority,
  normalizeAgentRunQuotaLedger,
  normalizeAgentRunStepsState,
  validateCreateAgentRunInput,
  type AgentRunFinishStatus,
  type AgentRunLeaseRecord,
  type AgentRunProgressPatch,
  type AgentRunRecord,
  type AgentRunStore,
  type CreateAgentRunInput,
  type ListAgentRunsByOwnerOptions,
  type TransitionAgentRunInput,
} from './agentRunRecord.js';
import { AGENT_RUN_MAX_LEASE_SECONDS, AGENT_RUN_MIN_LEASE_SECONDS } from './supabaseAgentRunStore.js';

/**
 * Test double for `AgentRunStore` with the same observable semantics as the
 * Postgres store (owner scoping, expiry filtering, transition table, lease
 * claim/renew, version checks). Test-only: never wire this into the server —
 * durable runs require the Postgres store.
 */

const AGENT_RUN_DRIVER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;

interface StoredRun extends AgentRunRecord {
  driverId?: string;
  leaseExpiresAt?: number;
}

const clone = <T>(value: T): T => structuredClone(value);

function assertDriverAndLease(driverId: string, leaseSeconds: number): void {
  if (!AGENT_RUN_DRIVER_ID_PATTERN.test(driverId)) throw new Error('AGENT_RUN_CLAIM_INPUT_INVALID');
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < AGENT_RUN_MIN_LEASE_SECONDS || leaseSeconds > AGENT_RUN_MAX_LEASE_SECONDS) {
    throw new Error('AGENT_RUN_CLAIM_INPUT_INVALID');
  }
}

export class InMemoryAgentRunStore implements AgentRunStore {
  private readonly runs = new Map<string, StoredRun>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private toRecord(stored: StoredRun): AgentRunRecord {
    const { driverId: _driverId, leaseExpiresAt: _leaseExpiresAt, ...record } = stored;
    return clone(record);
  }

  private toLeaseRecord(stored: StoredRun): AgentRunLeaseRecord {
    const { driverId, leaseExpiresAt, ...record } = stored;
    return { ...clone(record), driverId: String(driverId), leaseExpiresAt: Number(leaseExpiresAt) };
  }

  private live(runId: string): StoredRun | undefined {
    const stored = this.runs.get(runId);
    if (!stored || stored.expiresAt <= this.now()) return undefined;
    return stored;
  }

  private leasedTo(runId: string, driverId: string): StoredRun | undefined {
    const stored = this.live(runId);
    if (!stored || stored.status !== 'running' || stored.driverId !== driverId) return undefined;
    if (stored.leaseExpiresAt === undefined || stored.leaseExpiresAt <= this.now()) return undefined;
    return stored;
  }

  async create(input: CreateAgentRunInput, now?: number): Promise<AgentRunRecord | null> {
    const timestamp = now ?? this.now();
    const validated = validateCreateAgentRunInput(input, timestamp);
    if (this.runs.has(validated.runId)) return null;
    const stored: StoredRun = { ...clone(validated), version: 1, createdAt: timestamp, updatedAt: timestamp };
    this.runs.set(validated.runId, stored);
    return this.toRecord(stored);
  }

  async get(runId: string, ownerBinding: string): Promise<AgentRunRecord | null> {
    if (!AGENT_RUN_ID_PATTERN.test(runId) || !AGENT_RUN_OWNER_BINDING_PATTERN.test(ownerBinding)) return null;
    const stored = this.live(runId);
    if (!stored || stored.ownerBinding !== ownerBinding) return null;
    return this.toRecord(stored);
  }

  async listByOwner(ownerBinding: string, options: ListAgentRunsByOwnerOptions = {}): Promise<AgentRunRecord[]> {
    if (!AGENT_RUN_OWNER_BINDING_PATTERN.test(ownerBinding)) throw new Error('AGENT_RUN_LIST_INPUT_INVALID');
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('AGENT_RUN_LIST_INPUT_INVALID');
    const statuses = options.statuses;
    if (statuses !== undefined && (!Array.isArray(statuses) || statuses.some((status) => !isAgentRunRecordStatus(status)))) {
      throw new Error('AGENT_RUN_LIST_INPUT_INVALID');
    }
    return [...this.runs.values()]
      .filter((stored) => stored.ownerBinding === ownerBinding && stored.expiresAt > this.now())
      .filter((stored) => statuses === undefined || statuses.includes(stored.status))
      .sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((stored) => this.toRecord(stored));
  }

  async transition(input: TransitionAgentRunInput): Promise<AgentRunRecord | null> {
    if (!AGENT_RUN_ID_PATTERN.test(input.runId) || !AGENT_RUN_OWNER_BINDING_PATTERN.test(input.ownerBinding)) return null;
    if (!isAgentRunRecordStatus(input.expectedStatus) || !isAgentRunRecordStatus(input.nextStatus)) {
      throw new Error('AGENT_RUN_TRANSITION_INPUT_INVALID');
    }
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error('AGENT_RUN_TRANSITION_INPUT_INVALID');
    }
    assertAgentRunStatusTransition(input.expectedStatus, input.nextStatus);
    if (input.nextStatus === 'running' || input.nextStatus === 'expired') {
      throw new Error('AGENT_RUN_TRANSITION_DENIED');
    }
    const hasPlan = input.plan !== undefined || input.planDigest !== undefined;
    let plan = input.plan as AgentRunRecord['plan'];
    let planDigest = input.planDigest as AgentRunRecord['planDigest'];
    if (hasPlan) {
      plan = normalizeAgentRunPlan(input.plan);
      planDigest = normalizeAgentRunPlanDigest(input.planDigest);
      if ((plan === null) !== (planDigest === null)) throw new Error('AGENT_RUN_TRANSITION_INPUT_INVALID');
    }
    let hold: AgentRunRecord['hold'];
    if (input.nextStatus === 'held') {
      hold = normalizeAgentRunHold(input.hold, this.now());
      if (hold === null) throw new Error('AGENT_RUN_TRANSITION_INPUT_INVALID');
    } else {
      if (input.hold !== undefined && input.hold !== null) throw new Error('AGENT_RUN_TRANSITION_INPUT_INVALID');
      hold = undefined;
    }
    const stored = this.live(input.runId);
    if (!stored || stored.ownerBinding !== input.ownerBinding) return null;
    if (stored.status !== input.expectedStatus || stored.version !== input.expectedVersion) return null;
    const next: StoredRun = {
      ...stored,
      status: input.nextStatus,
      ...(hasPlan ? { plan, planDigest } : {}),
      ...(input.stepsState !== undefined ? { stepsState: normalizeAgentRunStepsState(input.stepsState) } : {}),
      ...(input.quotaLedger !== undefined ? { quotaLedger: normalizeAgentRunQuotaLedger(input.quotaLedger) } : {}),
      ...(input.priority !== undefined ? { priority: normalizeAgentRunPriority(input.priority) } : {}),
      hold: input.nextStatus === 'held' ? hold : stored.status === 'held' ? null : stored.hold,
      version: stored.version + 1,
      updatedAt: this.now(),
      ...(stored.status === 'running' ? { driverId: undefined, leaseExpiresAt: undefined } : {}),
    };
    this.runs.set(input.runId, next);
    return this.toRecord(next);
  }

  async claim(runId: string, driverId: string, leaseSeconds: number): Promise<AgentRunLeaseRecord | null> {
    if (!AGENT_RUN_ID_PATTERN.test(runId)) throw new Error('AGENT_RUN_CLAIM_INPUT_INVALID');
    assertDriverAndLease(driverId, leaseSeconds);
    const stored = this.live(runId);
    if (!stored) return null;
    const claimable = stored.status === 'queued'
      || (stored.status === 'running' && (stored.leaseExpiresAt ?? 0) <= this.now());
    if (!claimable) return null;
    const next: StoredRun = {
      ...stored,
      status: 'running',
      driverId,
      leaseExpiresAt: this.now() + leaseSeconds * 1_000,
      version: stored.version + 1,
      updatedAt: this.now(),
    };
    this.runs.set(runId, next);
    return this.toLeaseRecord(next);
  }

  async renewLease(runId: string, driverId: string, leaseSeconds: number): Promise<boolean> {
    if (!AGENT_RUN_ID_PATTERN.test(runId)) throw new Error('AGENT_RUN_CLAIM_INPUT_INVALID');
    assertDriverAndLease(driverId, leaseSeconds);
    const stored = this.leasedTo(runId, driverId);
    if (!stored) return false;
    this.runs.set(runId, { ...stored, leaseExpiresAt: this.now() + leaseSeconds * 1_000, version: stored.version + 1, updatedAt: this.now() });
    return true;
  }

  async updateProgress(runId: string, driverId: string, patch: AgentRunProgressPatch): Promise<boolean> {
    if (!AGENT_RUN_ID_PATTERN.test(runId) || !AGENT_RUN_DRIVER_ID_PATTERN.test(driverId)) {
      throw new Error('AGENT_RUN_PROGRESS_INPUT_INVALID');
    }
    if (patch.stepsState === undefined && patch.quotaLedger === undefined) throw new Error('AGENT_RUN_PROGRESS_INPUT_INVALID');
    const stepsState = patch.stepsState === undefined ? undefined : normalizeAgentRunStepsState(patch.stepsState);
    const quotaLedger = patch.quotaLedger === undefined ? undefined : normalizeAgentRunQuotaLedger(patch.quotaLedger);
    const stored = this.leasedTo(runId, driverId);
    if (!stored) return false;
    this.runs.set(runId, {
      ...stored,
      ...(stepsState !== undefined ? { stepsState } : {}),
      ...(quotaLedger !== undefined ? { quotaLedger } : {}),
      version: stored.version + 1,
      updatedAt: this.now(),
    });
    return true;
  }

  async finish(runId: string, driverId: string, nextStatus: AgentRunFinishStatus, hold?: AgentRunRecord['hold']): Promise<AgentRunRecord | null> {
    if (!AGENT_RUN_ID_PATTERN.test(runId) || !AGENT_RUN_DRIVER_ID_PATTERN.test(driverId) || !isAgentRunRecordStatus(nextStatus)) {
      throw new Error('AGENT_RUN_FINISH_INPUT_INVALID');
    }
    const stored = this.leasedTo(runId, driverId);
    if (!stored) return null;
    assertAgentRunStatusTransition('running', nextStatus);
    const nextHold = nextStatus === 'held' ? normalizeAgentRunHold(hold, this.now()) : null;
    if (nextStatus === 'held' && nextHold === null) throw new Error('AGENT_RUN_FINISH_INPUT_INVALID');
    const next: StoredRun = {
      ...stored,
      status: nextStatus,
      hold: nextHold,
      driverId: undefined,
      leaseExpiresAt: undefined,
      version: stored.version + 1,
      updatedAt: this.now(),
    };
    this.runs.set(runId, next);
    return this.toRecord(next);
  }

  async recoverStale(runId: string): Promise<AgentRunRecord | null> {
    if (!AGENT_RUN_ID_PATTERN.test(runId)) throw new Error('AGENT_RUN_RECOVERY_INPUT_INVALID');
    const stored = this.live(runId);
    if (!stored || stored.status !== 'running' || (stored.leaseExpiresAt ?? Number.POSITIVE_INFINITY) > this.now()) return null;
    const next: StoredRun = { ...stored, status: 'queued', driverId: undefined, leaseExpiresAt: undefined, version: stored.version + 1, updatedAt: this.now() };
    this.runs.set(runId, next);
    return this.toRecord(next);
  }

  async markExpired(limit = 100): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error('AGENT_RUN_EXPIRY_INPUT_INVALID');
    let count = 0;
    for (const stored of this.runs.values()) {
      if (count >= limit) break;
      if (stored.expiresAt > this.now()) continue;
      if (stored.status === 'completed' || stored.status === 'failed' || stored.status === 'cancelled' || stored.status === 'expired') continue;
      this.runs.set(stored.runId, { ...stored, status: 'expired', hold: null, driverId: undefined, leaseExpiresAt: undefined, version: stored.version + 1, updatedAt: this.now() });
      count += 1;
    }
    return count;
  }
}
