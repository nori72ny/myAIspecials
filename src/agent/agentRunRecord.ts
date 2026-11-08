import { containsLikelySecret } from './safeFilePolicy.js';
import type { AgentTaskStatus } from './agentTaskGraph.js';
import type { ToolName, ToolParams } from './toolRegistry.js';

/**
 * Persistent agent run records (multitask Phase 1 foundation).
 *
 * Until now an agent v3 run lived only inside a single HTTP request: plan,
 * approval and execution were bound by short-lived capability tokens and the
 * server kept no record of progress or results. This module defines the
 * durable record that later phases build on (chunked advancement, hold and
 * resume, the task board, quota gating). It is additive only: nothing here is
 * wired into the existing synchronous execute flow.
 *
 * Invariants carried from the design:
 * - Approval is never carried across a hold. The state machine therefore has
 *   no `held -> queued` edge: resuming always re-enters `awaiting_approval`
 *   (re-plan, show the diff, fresh approval) before anything may run again.
 * - Records never contain capability tokens, credentials or other secrets.
 *   Free-text and parameter payloads pass the same likely-secret screening
 *   the checkpoint store applies, and writes fail closed when it trips.
 * - Owner binding is a SHA-256 hash of the owner identifier. Raw identifiers
 *   and secrets are never stored.
 */

export const AGENT_RUN_ID_PATTERN = /^run-[A-Za-z0-9-]{8,100}$/;
export const AGENT_RUN_OWNER_BINDING_PATTERN = /^[0-9a-f]{64}$/;
const PLAN_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
const STEP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_:-]{0,119}$/;
const LEDGER_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const PROVIDER_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export const MAX_AGENT_RUN_GOAL_LENGTH = 4000;
export const MAX_AGENT_RUN_PLAN_STEPS = 20;
export const MAX_AGENT_RUN_STEPS_STATE = 20;
export const MAX_AGENT_RUN_PLAN_BYTES = 32_768;
export const MAX_AGENT_RUN_STEPS_STATE_BYTES = 32_768;
export const MAX_AGENT_RUN_HOLD_BYTES = 4096;
export const MAX_AGENT_RUN_QUOTA_LEDGER_BYTES = 4096;
export const MAX_AGENT_RUN_SUMMARY_LENGTH = 500;
export const MAX_AGENT_RUN_ARTIFACT_REF_LENGTH = 512;
export const MAX_AGENT_RUN_PRIORITY = 100;
export const MAX_AGENT_RUN_STEP_ATTEMPTS = 10;
export const MIN_AGENT_RUN_TTL_MS = 60_000;
export const MAX_AGENT_RUN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const AGENT_RUN_RECORD_STATUSES = [
  'planning',
  'awaiting_approval',
  'queued',
  'running',
  'held',
  'completed',
  'failed',
  'cancelled',
  'expired',
] as const;
export type AgentRunRecordStatus = typeof AGENT_RUN_RECORD_STATUSES[number];

export const AGENT_RUN_TERMINAL_STATUSES: ReadonlySet<AgentRunRecordStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
  'expired',
]);

/**
 * The single definition of legal run status transitions.
 *
 * - `held -> queued` is deliberately absent: a held run may only resume into
 *   `awaiting_approval`, so execution can never restart on a stale approval.
 * - `running -> queued` exists only for stale-claim recovery (a driver whose
 *   lease expired loses the run back to the queue); the store exposes it
 *   solely through recoverStale.
 * - `expired` is reachable from every non-terminal status and is terminal:
 *   an expired record never turns back into execution.
 */
export const AGENT_RUN_STATUS_TRANSITIONS: Readonly<Record<AgentRunRecordStatus, readonly AgentRunRecordStatus[]>> = Object.freeze({
  planning: ['awaiting_approval', 'held', 'failed', 'cancelled', 'expired'],
  awaiting_approval: ['queued', 'held', 'cancelled', 'expired'],
  queued: ['running', 'held', 'cancelled', 'expired'],
  running: ['queued', 'held', 'completed', 'failed', 'cancelled', 'expired'],
  held: ['awaiting_approval', 'cancelled', 'expired'],
  completed: [],
  failed: [],
  cancelled: [],
  expired: [],
});

export function isAgentRunRecordStatus(value: unknown): value is AgentRunRecordStatus {
  return typeof value === 'string' && (AGENT_RUN_RECORD_STATUSES as readonly string[]).includes(value);
}

export function isAgentRunTerminalStatus(status: AgentRunRecordStatus): boolean {
  return AGENT_RUN_TERMINAL_STATUSES.has(status);
}

export function canTransitionAgentRunStatus(from: AgentRunRecordStatus, to: AgentRunRecordStatus): boolean {
  return AGENT_RUN_STATUS_TRANSITIONS[from].includes(to);
}

export function assertAgentRunStatusTransition(from: AgentRunRecordStatus, to: AgentRunRecordStatus): void {
  if (!canTransitionAgentRunStatus(from, to)) throw new Error('AGENT_RUN_TRANSITION_DENIED');
}

/** One step of the approved plan snapshot. Dependencies reference earlier steps by index. */
export type AgentRunPlanStep = {
  toolName: ToolName;
  params: ToolParams;
  dependsOn: number[];
  inputFrom?: number;
};

/** Per-step progress. Status vocabulary matches the agent task graph. */
export type AgentRunStepState = {
  id: string;
  status: AgentTaskStatus;
  attempts: number;
  artifactRef?: string;
  summary?: string;
  errorCode?: string;
};

export type AgentRunHoldReason =
  | 'quota_exhausted'
  | 'awaiting_approval'
  | 'scheduled_time'
  | 'condition_wait'
  | 'dependency_wait'
  | 'user_paused'
  | 'driver_unavailable';

export type AgentRunResumeCondition =
  | { kind: 'manual' }
  | { kind: 'at_time'; at: number }
  | { kind: 'quota_reset'; provider: string; resetAt?: number }
  | { kind: 'dependency'; targetKind: 'run' | 'coding_job'; targetId: string }
  | { kind: 'condition'; conditionRef: string };

export type AgentRunHold = {
  reason: AgentRunHoldReason;
  resumeCondition: AgentRunResumeCondition;
  heldSince: number;
  resumeAttempts: number;
};

/** Provider-agnostic per-run quota accounting: provider -> counter -> amount. */
export type AgentRunQuotaLedger = Record<string, Record<string, number>>;

export type AgentRunRecord = {
  runId: string;
  ownerBinding: string;
  goal: string;
  status: AgentRunRecordStatus;
  plan: AgentRunPlanStep[] | null;
  planDigest: string | null;
  stepsState: AgentRunStepState[];
  parentRunId: string | null;
  priority: number;
  hold: AgentRunHold | null;
  quotaLedger: AgentRunQuotaLedger;
  version: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export type AgentRunLeaseRecord = AgentRunRecord & {
  driverId: string;
  leaseExpiresAt: number;
};

export type CreateAgentRunInput = {
  runId: string;
  ownerBinding: string;
  goal: string;
  status?: 'planning' | 'awaiting_approval' | 'queued' | 'held';
  plan?: AgentRunPlanStep[] | null;
  planDigest?: string | null;
  stepsState?: AgentRunStepState[];
  parentRunId?: string | null;
  priority?: number;
  hold?: AgentRunHold | null;
  quotaLedger?: AgentRunQuotaLedger;
  expiresAt: number;
};

export type ListAgentRunsByOwnerOptions = {
  statuses?: readonly AgentRunRecordStatus[];
  limit?: number;
};

export type TransitionAgentRunInput = {
  runId: string;
  ownerBinding: string;
  expectedStatus: AgentRunRecordStatus;
  expectedVersion: number;
  nextStatus: AgentRunRecordStatus;
  plan?: AgentRunPlanStep[] | null;
  planDigest?: string | null;
  stepsState?: AgentRunStepState[];
  quotaLedger?: AgentRunQuotaLedger;
  priority?: number;
  hold?: AgentRunHold | null;
};

export type AgentRunProgressPatch = {
  stepsState?: AgentRunStepState[];
  quotaLedger?: AgentRunQuotaLedger;
};

export type AgentRunFinishStatus = 'completed' | 'failed' | 'held' | 'cancelled';

/**
 * Storage boundary for persistent run records. Implementations must scope
 * owner operations by owner binding (a run is invisible to other owners),
 * perform transitions conditionally on the expected status and version, and
 * hand out `running` only through the lease-based claim.
 */
export interface AgentRunStore {
  create(input: CreateAgentRunInput, now?: number): Promise<AgentRunRecord | null>;
  get(runId: string, ownerBinding: string): Promise<AgentRunRecord | null>;
  listByOwner(ownerBinding: string, options?: ListAgentRunsByOwnerOptions): Promise<AgentRunRecord[]>;
  transition(input: TransitionAgentRunInput): Promise<AgentRunRecord | null>;
  claim(runId: string, driverId: string, leaseSeconds: number): Promise<AgentRunLeaseRecord | null>;
  renewLease(runId: string, driverId: string, leaseSeconds: number): Promise<boolean>;
  updateProgress(runId: string, driverId: string, patch: AgentRunProgressPatch): Promise<boolean>;
  finish(runId: string, driverId: string, nextStatus: AgentRunFinishStatus, hold?: AgentRunHold | null): Promise<AgentRunRecord | null>;
  recoverStale(runId: string): Promise<AgentRunRecord | null>;
  markExpired(limit?: number): Promise<number>;
}

const HOLD_REASONS: ReadonlySet<string> = new Set([
  'quota_exhausted',
  'awaiting_approval',
  'scheduled_time',
  'condition_wait',
  'dependency_wait',
  'user_paused',
  'driver_unavailable',
]);

/** Which resume condition kinds may accompany each hold reason. */
const HOLD_CONDITION_KINDS: Readonly<Record<AgentRunHoldReason, readonly AgentRunResumeCondition['kind'][]>> = Object.freeze({
  quota_exhausted: ['quota_reset', 'manual'],
  awaiting_approval: ['manual'],
  scheduled_time: ['at_time', 'manual'],
  condition_wait: ['condition'],
  dependency_wait: ['dependency'],
  user_paused: ['manual', 'at_time'],
  driver_unavailable: ['manual'],
});

const STEP_STATUSES: ReadonlySet<string> = new Set(['queued', 'running', 'completed', 'failed', 'blocked']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serializedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
  } catch {
    throw new Error('AGENT_RUN_VALUE_NOT_SERIALIZABLE');
  }
}

/** Screens every string inside a payload with the checkpoint secret rules. */
function assertNoLikelySecret(value: unknown): void {
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    visited += 1;
    if (visited > 10_000) throw new Error('AGENT_RUN_VALUE_NOT_SERIALIZABLE');
    if (typeof current === 'string') {
      if (containsLikelySecret(current)) throw new Error('AGENT_RUN_SECRET_CONTENT_BLOCKED');
    } else if (Array.isArray(current)) {
      pending.push(...current);
    } else if (isPlainObject(current)) {
      pending.push(...Object.values(current));
    }
  }
}

export function assertAgentRunId(runId: unknown): asserts runId is string {
  if (typeof runId !== 'string' || !AGENT_RUN_ID_PATTERN.test(runId)) throw new Error('AGENT_RUN_ID_INVALID');
}

export function assertAgentRunOwnerBinding(ownerBinding: unknown): asserts ownerBinding is string {
  if (typeof ownerBinding !== 'string' || !AGENT_RUN_OWNER_BINDING_PATTERN.test(ownerBinding)) {
    throw new Error('AGENT_RUN_OWNER_BINDING_INVALID');
  }
}

export function normalizeAgentRunGoal(goal: unknown): string {
  if (typeof goal !== 'string' || goal.trim().length === 0 || goal.length > MAX_AGENT_RUN_GOAL_LENGTH) {
    throw new Error('AGENT_RUN_GOAL_INVALID');
  }
  assertNoLikelySecret(goal);
  return goal;
}

function normalizeStepIndex(value: unknown, stepCount: number, ownIndex: number): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) >= stepCount || Number(value) >= ownIndex) {
    throw new Error('AGENT_RUN_PLAN_INVALID');
  }
  return Number(value);
}

export function normalizeAgentRunPlan(plan: AgentRunPlanStep[] | null | undefined): AgentRunPlanStep[] | null {
  if (plan === null || plan === undefined) return null;
  if (!Array.isArray(plan) || plan.length === 0 || plan.length > MAX_AGENT_RUN_PLAN_STEPS) {
    throw new Error('AGENT_RUN_PLAN_INVALID');
  }
  const normalized = plan.map((step, index) => {
    if (!isPlainObject(step)) throw new Error('AGENT_RUN_PLAN_INVALID');
    const { toolName, params, dependsOn, inputFrom } = step as Record<string, unknown>;
    if (typeof toolName !== 'string' || !TOOL_NAME_PATTERN.test(toolName)) throw new Error('AGENT_RUN_PLAN_INVALID');
    if (!isPlainObject(params)) throw new Error('AGENT_RUN_PLAN_INVALID');
    if (!Array.isArray(dependsOn)) throw new Error('AGENT_RUN_PLAN_INVALID');
    const deps = dependsOn.map((dep) => normalizeStepIndex(dep, plan.length, index));
    if (new Set(deps).size !== deps.length) throw new Error('AGENT_RUN_PLAN_INVALID');
    const normalizedStep: AgentRunPlanStep = {
      toolName: toolName as ToolName,
      params: params as ToolParams,
      dependsOn: deps,
    };
    if (inputFrom !== undefined) normalizedStep.inputFrom = normalizeStepIndex(inputFrom, plan.length, index);
    return normalizedStep;
  });
  if (serializedBytes(normalized) > MAX_AGENT_RUN_PLAN_BYTES) throw new Error('AGENT_RUN_PLAN_INVALID');
  assertNoLikelySecret(normalized);
  return normalized;
}

export function normalizeAgentRunPlanDigest(planDigest: string | null | undefined): string | null {
  if (planDigest === null || planDigest === undefined) return null;
  if (typeof planDigest !== 'string' || !PLAN_DIGEST_PATTERN.test(planDigest)) {
    throw new Error('AGENT_RUN_PLAN_DIGEST_INVALID');
  }
  return planDigest;
}

export function normalizeAgentRunStepsState(stepsState: AgentRunStepState[] | undefined): AgentRunStepState[] {
  if (stepsState === undefined) return [];
  if (!Array.isArray(stepsState) || stepsState.length > MAX_AGENT_RUN_STEPS_STATE) {
    throw new Error('AGENT_RUN_STEPS_STATE_INVALID');
  }
  const seen = new Set<string>();
  const normalized = stepsState.map((step) => {
    if (!isPlainObject(step)) throw new Error('AGENT_RUN_STEPS_STATE_INVALID');
    const { id, status, attempts, artifactRef, summary, errorCode } = step as Record<string, unknown>;
    if (typeof id !== 'string' || !STEP_ID_PATTERN.test(id) || seen.has(id)) throw new Error('AGENT_RUN_STEPS_STATE_INVALID');
    seen.add(id);
    if (typeof status !== 'string' || !STEP_STATUSES.has(status)) throw new Error('AGENT_RUN_STEPS_STATE_INVALID');
    if (!Number.isInteger(attempts) || Number(attempts) < 0 || Number(attempts) > MAX_AGENT_RUN_STEP_ATTEMPTS) {
      throw new Error('AGENT_RUN_STEPS_STATE_INVALID');
    }
    const normalizedStep: AgentRunStepState = { id, status: status as AgentTaskStatus, attempts: Number(attempts) };
    if (artifactRef !== undefined) {
      if (typeof artifactRef !== 'string' || artifactRef.length > MAX_AGENT_RUN_ARTIFACT_REF_LENGTH) {
        throw new Error('AGENT_RUN_STEPS_STATE_INVALID');
      }
      normalizedStep.artifactRef = artifactRef;
    }
    if (summary !== undefined) {
      if (typeof summary !== 'string' || summary.length > MAX_AGENT_RUN_SUMMARY_LENGTH) {
        throw new Error('AGENT_RUN_STEPS_STATE_INVALID');
      }
      normalizedStep.summary = summary;
    }
    if (errorCode !== undefined) {
      if (typeof errorCode !== 'string' || !ERROR_CODE_PATTERN.test(errorCode)) {
        throw new Error('AGENT_RUN_STEPS_STATE_INVALID');
      }
      normalizedStep.errorCode = errorCode;
    }
    return normalizedStep;
  });
  if (serializedBytes(normalized) > MAX_AGENT_RUN_STEPS_STATE_BYTES) throw new Error('AGENT_RUN_STEPS_STATE_INVALID');
  assertNoLikelySecret(normalized);
  return normalized;
}

function normalizeResumeCondition(condition: unknown): AgentRunResumeCondition {
  if (!isPlainObject(condition)) throw new Error('AGENT_RUN_HOLD_INVALID');
  const kind = condition.kind;
  switch (kind) {
    case 'manual':
      return { kind: 'manual' };
    case 'at_time': {
      const at = condition.at;
      if (!Number.isFinite(at) || Number(at) <= 0) throw new Error('AGENT_RUN_HOLD_INVALID');
      return { kind: 'at_time', at: Number(at) };
    }
    case 'quota_reset': {
      const provider = condition.provider;
      if (typeof provider !== 'string' || !PROVIDER_KEY_PATTERN.test(provider)) throw new Error('AGENT_RUN_HOLD_INVALID');
      const result: AgentRunResumeCondition = { kind: 'quota_reset', provider };
      if (condition.resetAt !== undefined) {
        if (!Number.isFinite(condition.resetAt) || Number(condition.resetAt) <= 0) throw new Error('AGENT_RUN_HOLD_INVALID');
        result.resetAt = Number(condition.resetAt);
      }
      return result;
    }
    case 'dependency': {
      const { targetKind, targetId } = condition;
      if (targetKind !== 'run' && targetKind !== 'coding_job') throw new Error('AGENT_RUN_HOLD_INVALID');
      if (typeof targetId !== 'string' || targetId.length === 0 || targetId.length > 128) throw new Error('AGENT_RUN_HOLD_INVALID');
      if (targetKind === 'run' && !AGENT_RUN_ID_PATTERN.test(targetId)) throw new Error('AGENT_RUN_HOLD_INVALID');
      return { kind: 'dependency', targetKind, targetId };
    }
    case 'condition': {
      const conditionRef = condition.conditionRef;
      if (typeof conditionRef !== 'string' || conditionRef.length === 0 || conditionRef.length > 256) {
        throw new Error('AGENT_RUN_HOLD_INVALID');
      }
      return { kind: 'condition', conditionRef };
    }
    default:
      throw new Error('AGENT_RUN_HOLD_INVALID');
  }
}

export function normalizeAgentRunHold(hold: AgentRunHold | null | undefined, now = Date.now()): AgentRunHold | null {
  if (hold === null || hold === undefined) return null;
  if (!isPlainObject(hold)) throw new Error('AGENT_RUN_HOLD_INVALID');
  const { reason, resumeCondition, heldSince, resumeAttempts } = hold as Record<string, unknown>;
  if (typeof reason !== 'string' || !HOLD_REASONS.has(reason)) throw new Error('AGENT_RUN_HOLD_INVALID');
  const normalizedCondition = normalizeResumeCondition(resumeCondition);
  if (!HOLD_CONDITION_KINDS[reason as AgentRunHoldReason].includes(normalizedCondition.kind)) {
    throw new Error('AGENT_RUN_HOLD_INVALID');
  }
  if (!Number.isFinite(heldSince) || Number(heldSince) <= 0 || Number(heldSince) > now + 60_000) {
    throw new Error('AGENT_RUN_HOLD_INVALID');
  }
  if (!Number.isInteger(resumeAttempts) || Number(resumeAttempts) < 0 || Number(resumeAttempts) > 100_000) {
    throw new Error('AGENT_RUN_HOLD_INVALID');
  }
  const normalized: AgentRunHold = {
    reason: reason as AgentRunHoldReason,
    resumeCondition: normalizedCondition,
    heldSince: Number(heldSince),
    resumeAttempts: Number(resumeAttempts),
  };
  if (serializedBytes(normalized) > MAX_AGENT_RUN_HOLD_BYTES) throw new Error('AGENT_RUN_HOLD_INVALID');
  assertNoLikelySecret(normalized);
  return normalized;
}

export function normalizeAgentRunQuotaLedger(ledger: AgentRunQuotaLedger | undefined): AgentRunQuotaLedger {
  if (ledger === undefined) return {};
  if (!isPlainObject(ledger)) throw new Error('AGENT_RUN_QUOTA_LEDGER_INVALID');
  const providers = Object.entries(ledger as Record<string, unknown>);
  if (providers.length > 16) throw new Error('AGENT_RUN_QUOTA_LEDGER_INVALID');
  const normalized: AgentRunQuotaLedger = {};
  for (const [provider, counters] of providers) {
    if (!LEDGER_KEY_PATTERN.test(provider) || !isPlainObject(counters)) throw new Error('AGENT_RUN_QUOTA_LEDGER_INVALID');
    const entries = Object.entries(counters);
    if (entries.length > 16) throw new Error('AGENT_RUN_QUOTA_LEDGER_INVALID');
    const normalizedCounters: Record<string, number> = {};
    for (const [counter, amount] of entries) {
      if (!LEDGER_KEY_PATTERN.test(counter) || !Number.isSafeInteger(amount) || Number(amount) < 0 || Number(amount) > 1_000_000_000) {
        throw new Error('AGENT_RUN_QUOTA_LEDGER_INVALID');
      }
      normalizedCounters[counter] = Number(amount);
    }
    normalized[provider] = normalizedCounters;
  }
  if (serializedBytes(normalized) > MAX_AGENT_RUN_QUOTA_LEDGER_BYTES) throw new Error('AGENT_RUN_QUOTA_LEDGER_INVALID');
  return normalized;
}

export function normalizeAgentRunPriority(priority: number | undefined): number {
  if (priority === undefined) return 0;
  if (!Number.isInteger(priority) || priority < -MAX_AGENT_RUN_PRIORITY || priority > MAX_AGENT_RUN_PRIORITY) {
    throw new Error('AGENT_RUN_PRIORITY_INVALID');
  }
  return priority;
}

export type NormalizedCreateAgentRunInput = {
  runId: string;
  ownerBinding: string;
  goal: string;
  status: 'planning' | 'awaiting_approval' | 'queued' | 'held';
  plan: AgentRunPlanStep[] | null;
  planDigest: string | null;
  stepsState: AgentRunStepState[];
  parentRunId: string | null;
  priority: number;
  hold: AgentRunHold | null;
  quotaLedger: AgentRunQuotaLedger;
  expiresAt: number;
};

/**
 * Validates and normalizes a create request. A run may be born `held`
 * (goal-only requests included), but approval-bound statuses require the
 * plan snapshot and its digest as a pair, and only `held` records may
 * carry hold information.
 */
export function validateCreateAgentRunInput(input: CreateAgentRunInput, now = Date.now()): NormalizedCreateAgentRunInput {
  if (!isPlainObject(input)) throw new Error('AGENT_RUN_CREATE_INPUT_INVALID');
  assertAgentRunId(input.runId);
  assertAgentRunOwnerBinding(input.ownerBinding);
  const goal = normalizeAgentRunGoal(input.goal);
  const status = input.status ?? 'planning';
  if (status !== 'planning' && status !== 'awaiting_approval' && status !== 'queued' && status !== 'held') {
    throw new Error('AGENT_RUN_CREATE_INPUT_INVALID');
  }
  const plan = normalizeAgentRunPlan(input.plan);
  const planDigest = normalizeAgentRunPlanDigest(input.planDigest);
  if ((plan === null) !== (planDigest === null)) throw new Error('AGENT_RUN_CREATE_INPUT_INVALID');
  if ((status === 'awaiting_approval' || status === 'queued') && plan === null) {
    throw new Error('AGENT_RUN_CREATE_INPUT_INVALID');
  }
  const hold = normalizeAgentRunHold(input.hold, now);
  if (status === 'held' && hold === null) throw new Error('AGENT_RUN_CREATE_INPUT_INVALID');
  if (status !== 'held' && hold !== null) throw new Error('AGENT_RUN_CREATE_INPUT_INVALID');
  const parentRunId = input.parentRunId ?? null;
  if (parentRunId !== null && (!AGENT_RUN_ID_PATTERN.test(parentRunId) || parentRunId === input.runId)) {
    throw new Error('AGENT_RUN_CREATE_INPUT_INVALID');
  }
  if (!Number.isFinite(input.expiresAt) || input.expiresAt < now + MIN_AGENT_RUN_TTL_MS || input.expiresAt > now + MAX_AGENT_RUN_TTL_MS + 10_000) {
    throw new Error('AGENT_RUN_CREATE_INPUT_INVALID');
  }
  return {
    runId: input.runId,
    ownerBinding: input.ownerBinding,
    goal,
    status,
    plan,
    planDigest,
    stepsState: normalizeAgentRunStepsState(input.stepsState),
    parentRunId,
    priority: normalizeAgentRunPriority(input.priority),
    hold,
    quotaLedger: normalizeAgentRunQuotaLedger(input.quotaLedger),
    expiresAt: input.expiresAt,
  };
}
