import { createHash } from 'node:crypto';
import { containsLikelySecret } from './safeFilePolicy.js';
import type { AgentTaskStatus } from './agentTaskGraph.js';
import type { ToolName, ToolParams } from './toolRegistry.js';
import { APPROVAL_TTL_MS, PLAN_TTL_MS } from './agentV3Capability.js';

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
/** Live-view detail caps (agent live view PR-L1, design §5.2). The
 * per-step worst case stays around 2.4KB, so even a 20-step run whose
 * every step is a research step fits the 32KiB steps_state budget. */
export const MAX_AGENT_RUN_LIVE_QUERY_LENGTH = 200;
export const MAX_AGENT_RUN_LIVE_SOURCES = 3;
export const MAX_AGENT_RUN_LIVE_SOURCE_TITLE_LENGTH = 120;
export const MAX_AGENT_RUN_LIVE_SOURCE_URL_LENGTH = 512;
export const MAX_AGENT_RUN_LIVE_SOURCE_DOMAIN_LENGTH = 253;
export const MAX_AGENT_RUN_LIVE_SOURCE_EXCERPT_LENGTH = 160;
/** Cap on the failover attempts kept in one step's live detail
 * (AGORA timeout observability, diagnosis
 * AGENT_AGORA_PROVIDER_TIMEOUT_DIAGNOSIS_2026-11-23 §5.3): a dispatch
 * tries at most three routes, so six leaves generous headroom while
 * keeping the per-step worst case bounded. */
export const MAX_AGENT_RUN_LIVE_PROVIDER_ATTEMPTS = 6;
/** Cap on the counts kept in one step's reconciliation summary
 * (misreading countermeasure design §2 layer 2): the candidate
 * list itself is capped at 200 and a run's findings are bounded
 * by its chunks, so this bound is generous headroom, not a working
 * limit — it exists so a malformed summary is dropped, never
 * stored unbounded. */
export const MAX_AGENT_RUN_LIVE_RECONCILIATION_COUNT = 1_000_000;
/** Caps on the kept/dropped index lists of one step's
 * reconciliation summary (failure diagnosis 2026-11-24, 対策1(a)):
 * the findings a run can carry are bounded by its chunks, so 200
 * — the same bound as the candidate list — is generous headroom. */
export const MAX_AGENT_RUN_LIVE_RECONCILIATION_INDEXES = 200;
/** Cap on the drop-reason token length in a reconciliation
 * summary: reasons are a closed lowercase vocabulary. */
export const MAX_AGENT_RUN_LIVE_RECONCILIATION_REASON_LENGTH = 32;
/** Caps on a rows bundle's recorded column set (対策1(c)): a
 * deliverable's columns are bounded by its input tables' width;
 * 64 names of at most 200 chars is generous headroom. */
export const MAX_AGENT_RUN_LIVE_ROWS_COLUMNS = 64;
export const MAX_AGENT_RUN_LIVE_ROWS_COLUMN_LENGTH = 200;
export const MAX_AGENT_RUN_LIVE_ROWS_COUNT = 1_000_000;
/** Caps on the recorded value-table summary (対策1(d)): the group
 * list mirrors the candidate list's 200 cap, and the key strings
 * mirror the live source title cap. */
export const MAX_AGENT_RUN_LIVE_VALUE_TABLE_GROUPS = 200;
export const MAX_AGENT_RUN_LIVE_VALUE_TABLE_KEY_LENGTH = 120;
export const MAX_AGENT_RUN_LIVE_VALUE_TABLE_COUNT = 1_000_000;
export const MAX_AGENT_RUN_PRIORITY = 100;
export const MAX_AGENT_RUN_STEP_ATTEMPTS = 10;
/**
 * Step-artifact caps (step-artifact persistence, PR-1; design §4.3).
 * The per-artifact char cap mirrors the verification engine's
 * MAX_ARTIFACT_CHARS, so every artifact the advancer can hold is
 * storable; the byte cap is a second backstop behind it, and the
 * per-run total is enforced by the stores at write time. Oversize is
 * rejected or skipped, never truncated into compliance.
 */
export const MAX_AGENT_RUN_ARTIFACT_CHARS = 120_000;
export const MAX_AGENT_RUN_ARTIFACT_BYTES = 512 * 1024;
export const MAX_AGENT_RUN_ARTIFACTS_TOTAL_CHARS = 2_000_000;
/**
 * Deliverable caps (artifact retrieval R-2; design
 * AGENT_ARTIFACT_RETRIEVAL_2026-11-23 §3.2-3). A binary deliverable
 * envelope carries its entity as base64, so the stored string is
 * larger than the entity it holds: a 512KiB entity expands to
 * ceil(524288 / 3) * 4 = 699,052 base64 characters. The deliverable
 * cap therefore rides on the entity — the envelope's declared byte
 * count against MAX_AGENT_RUN_ARTIFACT_BYTES, and its base64 form
 * against the expansion below — never on the stored string's char
 * count, which is bounded separately (and loosely) by
 * MAX_AGENT_RUN_DELIVERABLE_ARTIFACT_CHARS: the base64 cap plus room
 * for the envelope's own JSON fields. The database backstop mirrors
 * both numbers.
 */
export const MAX_AGENT_RUN_ARTIFACT_BASE64_CHARS = Math.ceil(MAX_AGENT_RUN_ARTIFACT_BYTES / 3) * 4;
export const MAX_AGENT_RUN_DELIVERABLE_ARTIFACT_CHARS = MAX_AGENT_RUN_ARTIFACT_BASE64_CHARS + 4_096;
/**
 * Terminal retention grace (step-artifact persistence, PR-3; design
 * §4.6): a run's artifacts live as long as the run does, and for this
 * long after the run reaches a terminal status, so a just-finished
 * run's intermediate outputs stay available briefly; past the grace
 * the sweep reclaims them even when the run's own (longer) TTL has
 * not elapsed. The run's own expiry stays the outer bound either way.
 */
export const AGENT_RUN_ARTIFACT_TERMINAL_GRACE_MS = 24 * 60 * 60 * 1000;

export const ORIGIN_AGENT_STEP_ARTIFACTS_ENABLED_ENV = 'ORIGIN_AGENT_STEP_ARTIFACTS_ENABLED' as const;

/** The step-artifact persistence switch (design §4.7), in the same
 * style as ORIGIN_AGENT_ATTACHMENTS_ENABLED: only the exact string
 * "true" enables it; anything else — including the variable being
 * unregistered — is OFF, and OFF keeps the pre-persistence behavior. */
export function agentStepArtifactsEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[ORIGIN_AGENT_STEP_ARTIFACTS_ENABLED_ENV] === 'true';
}

export const ORIGIN_AGENT_RATE_LIMIT_HOLD_ENABLED_ENV = 'ORIGIN_AGENT_RATE_LIMIT_HOLD_ENABLED' as const;

/**
 * The rate-limit hold switch (design CAPACITY_RATE_LIMIT_QUANTIFICATION_
 * 2026-11-22 §2, measure B), in the same style as the step-artifact
 * switch above: only the exact string "true" enables it; anything else
 * — including the variable being unregistered — is OFF, and OFF keeps
 * the pre-measure behavior exactly (a rate-limited analyzer step fails
 * its run, terminally, with the provider's own code).
 */
export function agentRateLimitHoldEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[ORIGIN_AGENT_RATE_LIMIT_HOLD_ENABLED_ENV] === 'true';
}

/**
 * Runaway bounds for the rate-limit hold (design §2-B). The per-step
 * cap counts parks of ONE step across the run's whole life (the count
 * rides the step state as `rateLimitHolds`, so it survives the hold /
 * resume cycle); the elapsed cap is measured from the run's creation.
 * A step that would park past either bound fails terminally with the
 * provider's code instead — the pre-measure behavior — so the hold can
 * never turn into an unbounded retry loop.
 */
export const AGENT_RUN_RATE_LIMIT_HOLD_MAX_PER_STEP = 5;
export const AGENT_RUN_RATE_LIMIT_HOLD_MAX_RUN_ELAPSED_MS = 60 * 60 * 1000;
/**
 * The minimum wait before a rate-limited run may resume: the providers'
 * per-minute windows are rolling 60-second windows, so no shorter wait
 * can clear the window that rejected the step. When a provider's
 * Retry-After / reset becomes observable on this path it replaces this
 * floor; today the model-call result carries only the failure code, so
 * the floor is what the hold records (design §2-B).
 */
export const AGENT_RUN_RATE_LIMIT_HOLD_MIN_WAIT_MS = 60_000;
export const MIN_AGENT_RUN_TTL_MS = 60_000;
export const MAX_AGENT_RUN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * How long a run may sit in `awaiting_approval` before the approval is
 * considered lapsed (design §8.3 entry 3): a plan capability issued when
 * the run entered the state can be approved until the end of the plan
 * TTL, and that approval remains usable for the approval TTL. Derived
 * from the capability TTLs so the record's deadline never disagrees with
 * the tokens themselves.
 */
export const AGENT_RUN_APPROVAL_LAPSE_MS = PLAN_TTL_MS + APPROVAL_TTL_MS;

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

/** One page a research step actually looked at, kept for the live view. */
export type AgentRunStepLiveSource = {
  title: string;
  url: string;
  domain?: string;
  excerpt?: string;
};

/**
 * Live-view detail for one step (agent live view PR-L1, design
 * AGENT_LIVE_VIEW_DESIGN_2026-11-13 §5.2). Optional and additive:
 * records written before this field existed read back unchanged, and
 * consumers that ignore it keep the previous behavior. It holds only
 * what the step itself was planned with or produced in public — the
 * query a research step actually ran and the first sources it returned
 * — never prompts, capability tokens or other internals.
 */
/**
 * Why an attachment_analyzer step's chunk response failed the
 * per-chunk format validation (Basel observability, diagnosis
 * AGENT_BASEL_DATA_OUTPUT_INVALID_DIAGNOSIS_2026-11-23 §4): the
 * failing chunk's global index and the parse-failure reason token
 * the analyzer reported. Counts and codes only — the response body
 * never enters the record, exactly like the rest of the live detail.
 * The reason vocabulary is the analyzer's
 * (AGENT_DATA_PARSE_FAILURE_REASONS in agentAttachmentTools.ts); the
 * normalizer below validates the token's shape, not the module, so
 * this record module keeps no dependency on the tools layer.
 */
export type AgentRunStepParseFailure = {
  chunkIndex: number;
  reason: string;
};

/**
 * Why an attachment_analyzer step failed the deterministic coverage
 * verification (Basel segment-2 observability, 案3 in
 * AGENT_BASEL_SEGMENT2_COVERAGE_DIAGNOSIS_2026-11-23): the scope of
 * the yardstick that failed — `local` (the step's own primary-table
 * chunk range) or `final` (the whole merged chain at the last
 * step) — the step's chunk range for a local failure, and the
 * breakdown: how many keys were expected and covered, how many were
 * missing, duplicated or unexpected, and the names of the numeric
 * columns whose sums disagreed. Counts and column names only — key
 * values and row data never enter the record, exactly like the rest
 * of the live detail. The breakdown is computed deterministically
 * by the analyzer; the normalizer below validates shapes and caps,
 * in the fail-soft style of this module.
 */
/** One numeric column's sums in a coverage failure (coverage
 * observability follow-on, diagnosis 2026-11-23): the yardstick's
 * own sum for the column, the sum over the output rows' readable
 * values, their difference, and how many output cells carried a
 * value the numeric parser could not read and the sum therefore
 * excluded. A nonzero difference with an unparseable count of
 * zero is a transcription error (a dropped digit); a positive
 * count marks values written in a notation the parser rejects.
 * Deterministic aggregates only — no cell text ever enters the
 * record, exactly like the rest of the live detail. */
export type AgentRunStepCoverageNumericDetail = {
  column: string;
  expectedSum: number;
  outputSum: number;
  difference: number;
  unparseableCount: number;
};

export type AgentRunStepCoverageFailure = {
  scope: 'final' | 'local';
  chunkOffset?: number;
  chunkCount?: number;
  expected: number;
  covered: number;
  missing: number;
  duplicated: number;
  unexpected: number;
  numericMismatch: string[];
  numericDetails?: AgentRunStepCoverageNumericDetail[];
};

/**
 * Which route/model served an attachment_analyzer step's chunk
 * calls, and whether the parse repair retry ran (coverage
 * observability follow-on, diagnosis 2026-11-23). Until now a
 * successful call reported only its text, so the step that
 * produced a coverage failure's rows could not be attributed to
 * the model that actually served it. The servings are the step's
 * distinct serving routes/models in first-seen order (a step's
 * calls may alternate across the capacity buckets). Identifiers
 * and a boolean only — no request or response body ever enters
 * the record, exactly like the rest of the live detail. Optional
 * and additive: records written before the field existed read
 * back unchanged.
 */
export type AgentRunStepAnalyzerExecution = {
  servings: { providerId: string; modelId?: string }[];
  repairRetried: boolean;
};

/**
 * One failover attempt of the model call that failed an
 * attachment_analyzer step (AGORA timeout observability, diagnosis
 * AGENT_AGORA_PROVIDER_TIMEOUT_DIAGNOSIS_2026-11-23 §5.3): which
 * route was tried, under which model, how the attempt ended, the
 * provider error code it produced, and how long it took. Codes,
 * identifiers and counts only — no request or response body, no
 * upstream free-form text ever enters the record, exactly like the
 * rest of the live detail. The values are the provider layer's own
 * whitelisted attempt diagnostics (originProviderClient), re-validated
 * by the normalizer below in the same fail-soft style as the parse
 * failure, so this module keeps no dependency on the provider layer.
 */
export type AgentRunStepProviderAttempt = {
  providerId: string;
  modelId?: string;
  outcome: string;
  errorCode?: string;
  durationMs?: number;
  transportRequestCount?: number;
};

/**
 * The recorded outcome of an attachment_reconciler step (design
 * AGENT_MA_MISREADING_COUNTERMEASURE_2026-11-23 §2 layer 2): how
 * many deterministic value-mismatch candidates the step judged,
 * how many original findings it kept, how many it dropped under
 * the pairing discipline, and how many findings it picked up from
 * candidates. Counts and the mode only — finding text never enters
 * the record, exactly like the rest of the live detail. `failed`
 * marks a shadow step whose reconciliation could not be judged;
 * shadow never fails a run, so the fact is recorded instead.
 */
export type AgentRunStepReconciliation = {
  mode: 'shadow' | 'enforce';
  candidateCount: number;
  keptCount: number;
  droppedCount: number;
  pickedUpCount: number;
  failed?: boolean;
  /**
   * Why a failed reconciliation could not be judged (function
   * inspection 2026-11-25, D4): the code the step would have
   * failed with under enforce — a provider error code, or
   * AGENT_RECONCILIATION_OUTPUT_INVALID /
   * AGENT_RECONCILIATION_NO_FINDINGS. `failed` alone spent the
   * shadow observation without its reason, leaving the enforce
   * decision unable to tell a provider outage from an
   * output-shape problem from an empty judgment. Present only
   * with `failed`.
   */
  failureCode?: string;
  /**
   * Which original findings the judgment kept and dropped, by
   * index, with the drop reasons (failure diagnosis 2026-11-24,
   * 対策1(a)). Counts alone could not answer the shadow question
   * the record exists for — the production M&A run kept 2 of 5
   * findings with at least one necessarily a misreading, and
   * which two was unrecoverable. Indexes and closed-vocabulary
   * reason tokens are not finding text, so the counts-only
   * discipline's purpose (no model prose in the record) is kept.
   * Present only when the reconciliation was actually judged.
   */
  keptIndexes?: number[];
  droppedIndexes?: { index: number; reason: string }[];
};

/**
 * The column set a completed rows run actually produced (failure
 * diagnosis 2026-11-24, 対策1(c)): the merged rows bundle's
 * column names, in first-seen order, with the row count. Until
 * now the record could prove the input was fully covered but not
 * which columns the deliverable carried — the production Basel
 * run "completed" with the input's columns and no derived ones,
 * and only the retrieved artifact showed it. Column names are
 * the run's own output structure, not finding text.
 */
export type AgentRunStepRowsOutput = {
  columns: string[];
  rowCount: number;
};

/**
 * The audit value table's recorded summary (failure diagnosis
 * 2026-11-24, 対策1(d)): entry count, and the (entity, attribute)
 * group keys with their entry and distinct-value counts — the
 * grouping the deterministic candidate computation uses. It
 * separates "the table was empty" from "the keys never aligned"
 * when a run records zero candidates; values themselves never
 * enter the summary.
 */
export type AgentRunStepValueTableSummary = {
  entryCount: number;
  groupCount: number;
  groups: { entity: string; attribute: string; entries: number; distinctValues: number }[];
};

export type AgentRunStepLiveDetail = {
  startedAt?: number;
  finishedAt?: number;
  query?: string;
  sources?: AgentRunStepLiveSource[];
  parseFailure?: AgentRunStepParseFailure;
  coverageFailure?: AgentRunStepCoverageFailure;
  analyzerExecution?: AgentRunStepAnalyzerExecution;
  providerAttempts?: AgentRunStepProviderAttempt[];
  reconciliation?: AgentRunStepReconciliation;
  rowsOutput?: AgentRunStepRowsOutput;
  valueTable?: AgentRunStepValueTableSummary;
};

/** Per-step progress. Status vocabulary matches the agent task graph. */
export type AgentRunStepState = {
  id: string;
  status: AgentTaskStatus;
  attempts: number;
  artifactRef?: string;
  summary?: string;
  errorCode?: string;
  liveDetail?: AgentRunStepLiveDetail;
  /**
   * How many times this step has been parked by the rate-limit hold
   * (design CAPACITY_RATE_LIMIT_QUANTIFICATION_2026-11-22 §2-B) across
   * the run's life. Optional and additive: records written before the
   * measure existed read back unchanged, and a step that was never
   * parked carries no count. The advancer enforces
   * AGENT_RUN_RATE_LIMIT_HOLD_MAX_PER_STEP against it at park time.
   */
  rateLimitHolds?: number;
};

export type AgentRunHoldReason =
  | 'quota_exhausted'
  | 'rate_limited'
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
  /**
   * The instant after which an `awaiting_approval` run is approval-lapsed
   * (design §8.3 entry 3, PR 1-G). Non-null exactly while the run is in
   * `awaiting_approval`, mirroring the hold lifecycle: entering the state
   * sets it (entry instant + AGENT_RUN_APPROVAL_LAPSE_MS, or the stored
   * value of the plan capability actually issued), leaving clears it.
   * The piggyback evaluator converts lapsed runs to `held`; nothing else
   * reads this for authorization — approvals are still verified from the
   * capability tokens themselves.
   */
  approvalDeadlineAt: number | null;
  /**
   * The resume-attempt count of the most recent hold episode, carried
   * across episodes (design §8.6, PR 1-G). `hold.resumeAttempts` is
   * cleared with the hold when a run leaves `held`, so this field is
   * rewritten with the same value whenever a hold is written; a run that
   * falls back to `held` after a resume seeds its new hold with this
   * count + 1. Null when the run has never been held. Store-maintained:
   * callers never set it directly.
   */
  priorResumeAttempts: number | null;
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
  /**
   * Approval lapse deadline for a run born `awaiting_approval`. Defaults
   * to creation + AGENT_RUN_APPROVAL_LAPSE_MS when omitted. Must be
   * absent (or null) for every other birth status.
   */
  approvalDeadlineAt?: number | null;
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
  /**
   * Required when `nextStatus` is `awaiting_approval` (the approval lapse
   * deadline for the state being entered); must be absent otherwise.
   * Leaving `awaiting_approval` clears the stored deadline.
   */
  approvalDeadlineAt?: number | null;
};

export type AgentRunProgressPatch = {
  stepsState?: AgentRunStepState[];
  quotaLedger?: AgentRunQuotaLedger;
  /**
   * Step artifacts produced by the steps this write completes
   * (step-artifact persistence, PR-1). They are upserted inside the
   * same fenced statement as the progress write itself: a driver that
   * lost its claim writes neither progress nor artifacts. Saving is
   * subject to the per-run total cap — when the cap would be exceeded
   * the progress write still lands but the artifacts are skipped
   * (never truncated), and the consuming step then fails with
   * AGENT_STEP_INPUT_UNAVAILABLE, exactly as it does today.
   */
  artifacts?: PutAgentRunStepArtifactInput[];
};

/**
 * One step artifact as handed to the store: the output of the plan
 * step at `stepIndex`, identified by the step's fingerprint and the
 * attempt count its completion was recorded with. The byte size and
 * digest are deliberately not caller-supplied — validation recomputes
 * them from the body, so stored metadata can never disagree with the
 * body it describes.
 */
export type PutAgentRunStepArtifactInput = {
  stepIndex: number;
  stepFingerprint: string;
  attempt: number;
  artifact: string;
};

/** One persisted step artifact (step-artifact persistence, PR-1). */
export type AgentRunStepArtifact = {
  runId: string;
  stepIndex: number;
  stepFingerprint: string;
  attempt: number;
  artifact: string;
  artifactBytes: number;
  artifactSha256: string;
  createdAt: number;
  expiresAt: number;
};

/** A validated step-artifact write, with the measured fields filled in. */
export type NormalizedAgentRunStepArtifactInput = PutAgentRunStepArtifactInput & {
  artifactBytes: number;
  artifactSha256: string;
  charCount: number;
};

/**
 * The fingerprint that binds a stored artifact to the plan step that
 * produced it (design §4.4): SHA-256 over the canonical JSON of
 * `{ toolName, params }` with the params exactly as approved — data-flow
 * markers included, before any runtime resolution. Canonicalization
 * sorts object keys recursively, so the fingerprint depends on the
 * step's content only, never on key order. Hydration (PR-2) compares
 * it against the current plan's step at the same index and treats a
 * mismatch as "no artifact", so a re-plan can never silently reuse a
 * different step's output.
 */
/**
 * The attachment set a stored plan is bound to, if any (resume
 * attachment support; design AGENT_RESUME_ATTACHMENT_DESIGN_2026-11-22
 * §4.2). The binding lives inside the data steps' params — the same
 * place run creation reads it when claiming the set — so the plan
 * snapshot alone names the set and no record column duplicates it.
 * Pure and total: a missing plan, missing params or a non-string /
 * empty value all read as "no binding" (null), never as an error, so
 * callers can use it on any record shape a store hands back.
 */
export function agentRunPlanAttachmentSetId(plan: readonly AgentRunPlanStep[] | null): string | null {
  if (!plan) return null;
  for (const step of plan) {
    const value = step?.params?.attachmentSetId;
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

export function computeAgentRunStepFingerprint(toolName: string, params: ToolParams): string {
  if (typeof toolName !== 'string' || !TOOL_NAME_PATTERN.test(toolName)) {
    throw new Error('AGENT_RUN_ARTIFACT_INPUT_INVALID');
  }
  if (!isPlainObject(params)) throw new Error('AGENT_RUN_ARTIFACT_INPUT_INVALID');
  return createHash('sha256').update(canonicalJson({ params, toolName }), 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('AGENT_RUN_ARTIFACT_INPUT_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new Error('AGENT_RUN_ARTIFACT_INPUT_INVALID');
}

const CANONICAL_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function parseDocumentEnvelope(artifact: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(artifact);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) || parsed.kind !== 'document') return null;
  return parsed;
}

/**
 * Whether a stored body is a binary deliverable envelope (artifact
 * retrieval R-2): a document envelope carrying its entity as a
 * base64 string. The store's read path mirrors the write path's
 * caps with this same test, so a row the write path accepted can
 * always be read back.
 */
export function isBinaryDeliverableEnvelope(artifact: string): boolean {
  const envelope = parseDocumentEnvelope(artifact);
  return envelope !== null && typeof envelope.contentBase64 === 'string';
}

/**
 * Reads a stored body as a binary deliverable envelope (artifact
 * retrieval R-2): a JSON object of kind 'document' that carries its
 * entity as `contentBase64`. Anything else — raw text, an analyzer
 * bundle, a text envelope carrying `content` — is not a deliverable
 * and returns null, so the ordinary caps apply unchanged. A document
 * envelope whose contentBase64 is present but not a string is
 * malformed input, not an ordinary artifact.
 */
function documentDeliverableEnvelope(artifact: string): Record<string, unknown> | null {
  const envelope = parseDocumentEnvelope(artifact);
  if (envelope === null || !('contentBase64' in envelope)) return null;
  if (typeof envelope.contentBase64 !== 'string') throw new Error('AGENT_RUN_ARTIFACT_INPUT_INVALID');
  return envelope;
}

/**
 * Verifies a deliverable envelope's declared entity against the
 * entity it actually carries (design §3.2-3): the declared byte
 * count must fit the entity cap, and the base64 payload must be
 * canonical and decode to exactly the declared byte count and
 * digest. A declaration the payload does not reproduce is refused
 * with AGENT_RUN_ARTIFACT_CONTENT_MISMATCH — the envelope is never
 * stored on its own say-so.
 */
function validateDocumentDeliverableEnvelope(envelope: Record<string, unknown>): void {
  const declaredBytes = envelope.bytes;
  if (typeof declaredBytes !== 'number' || !Number.isInteger(declaredBytes) || declaredBytes < 0) {
    throw new Error('AGENT_RUN_ARTIFACT_INPUT_INVALID');
  }
  if (declaredBytes > MAX_AGENT_RUN_ARTIFACT_BYTES) throw new Error('AGENT_RUN_ARTIFACT_TOO_LARGE');
  const declaredSha256 = envelope.sha256;
  if (typeof declaredSha256 !== 'string' || !PLAN_DIGEST_PATTERN.test(declaredSha256)) {
    throw new Error('AGENT_RUN_ARTIFACT_INPUT_INVALID');
  }
  const contentBase64 = envelope.contentBase64 as string;
  if (contentBase64.length > MAX_AGENT_RUN_ARTIFACT_BASE64_CHARS) throw new Error('AGENT_RUN_ARTIFACT_TOO_LARGE');
  if (!CANONICAL_BASE64_PATTERN.test(contentBase64)) throw new Error('AGENT_RUN_ARTIFACT_CONTENT_MISMATCH');
  const decoded = Buffer.from(contentBase64, 'base64');
  if (decoded.length !== declaredBytes) throw new Error('AGENT_RUN_ARTIFACT_CONTENT_MISMATCH');
  if (createHash('sha256').update(decoded).digest('hex') !== declaredSha256) {
    throw new Error('AGENT_RUN_ARTIFACT_CONTENT_MISMATCH');
  }
}

/**
 * Validates one step-artifact write at the store boundary. The size
 * and digest are recomputed from the body itself (the attachment
 * store's rule), and the body passes the same likely-secret screening
 * as every other run payload: a body that trips it is refused whole,
 * never stored in part. A binary deliverable envelope is validated
 * against its carried entity instead of the stored string (see
 * validateDocumentDeliverableEnvelope); every other body keeps the
 * char and byte caps above.
 */
export function validatePutAgentRunStepArtifactInput(
  input: PutAgentRunStepArtifactInput,
): NormalizedAgentRunStepArtifactInput {
  if (!isPlainObject(input)) throw new Error('AGENT_RUN_ARTIFACT_INPUT_INVALID');
  const { stepIndex, stepFingerprint, attempt, artifact } = input;
  if (!Number.isInteger(stepIndex) || Number(stepIndex) < 0 || Number(stepIndex) >= MAX_AGENT_RUN_PLAN_STEPS) {
    throw new Error('AGENT_RUN_ARTIFACT_INPUT_INVALID');
  }
  if (typeof stepFingerprint !== 'string' || !PLAN_DIGEST_PATTERN.test(stepFingerprint)) {
    throw new Error('AGENT_RUN_ARTIFACT_INPUT_INVALID');
  }
  if (!Number.isInteger(attempt) || Number(attempt) < 0 || Number(attempt) > MAX_AGENT_RUN_STEP_ATTEMPTS) {
    throw new Error('AGENT_RUN_ARTIFACT_INPUT_INVALID');
  }
  if (typeof artifact !== 'string') throw new Error('AGENT_RUN_ARTIFACT_INPUT_INVALID');
  const charCount = artifact.length;
  const artifactBytes = Buffer.byteLength(artifact, 'utf8');
  const deliverable = documentDeliverableEnvelope(artifact);
  if (deliverable !== null) {
    if (charCount > MAX_AGENT_RUN_DELIVERABLE_ARTIFACT_CHARS || artifactBytes > MAX_AGENT_RUN_DELIVERABLE_ARTIFACT_CHARS) {
      throw new Error('AGENT_RUN_ARTIFACT_TOO_LARGE');
    }
    validateDocumentDeliverableEnvelope(deliverable);
  } else {
    if (charCount > MAX_AGENT_RUN_ARTIFACT_CHARS) throw new Error('AGENT_RUN_ARTIFACT_TOO_LARGE');
    if (artifactBytes > MAX_AGENT_RUN_ARTIFACT_BYTES) throw new Error('AGENT_RUN_ARTIFACT_TOO_LARGE');
  }
  if (containsLikelySecret(artifact)) throw new Error('AGENT_RUN_ARTIFACT_SECRET_CONTENT_BLOCKED');
  return {
    stepIndex: Number(stepIndex),
    stepFingerprint,
    attempt: Number(attempt),
    artifact,
    artifactBytes,
    artifactSha256: createHash('sha256').update(artifact, 'utf8').digest('hex'),
    charCount,
  };
}

/**
 * Validates a progress write's artifact batch: every entry must be
 * individually valid, and a step may appear at most once per write
 * (one completion produces one artifact).
 */
export function validatePutAgentRunStepArtifacts(
  inputs: readonly PutAgentRunStepArtifactInput[],
): NormalizedAgentRunStepArtifactInput[] {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('AGENT_RUN_ARTIFACT_INPUT_INVALID');
  const seen = new Set<number>();
  return inputs.map((input) => {
    const normalized = validatePutAgentRunStepArtifactInput(input);
    if (seen.has(normalized.stepIndex)) throw new Error('AGENT_RUN_ARTIFACT_INPUT_INVALID');
    seen.add(normalized.stepIndex);
    return normalized;
  });
}

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
  /**
   * Extends the approval lapse deadline of a run that is still in
   * `awaiting_approval` (a fresh plan capability was re-issued for the
   * stored plan). Deadline-only maintenance: it deliberately does not
   * touch `version` or `updatedAt`, because `updatedAt` is the
   * approval-freshness anchor the resume confirm verifies against.
   * Returns false when the run is not in `awaiting_approval` (anymore).
   */
  refreshApprovalDeadline(runId: string, ownerBinding: string, approvalDeadlineAt: number): Promise<boolean>;
  claim(runId: string, driverId: string, leaseSeconds: number): Promise<AgentRunLeaseRecord | null>;
  renewLease(runId: string, driverId: string, leaseSeconds: number): Promise<boolean>;
  updateProgress(runId: string, driverId: string, patch: AgentRunProgressPatch): Promise<boolean>;
  finish(runId: string, driverId: string, nextStatus: AgentRunFinishStatus, hold?: AgentRunHold | null): Promise<AgentRunRecord | null>;
  recoverStale(runId: string): Promise<AgentRunRecord | null>;
  markExpired(limit?: number): Promise<number>;
  /**
   * Lists a run's persisted step artifacts (step-artifact persistence,
   * PR-1), ordered by step index; rows past their retention are never
   * returned. Scoped by run id alone, like the driver operations: the
   * caller is the run's driver mid-advance (hydration, PR-2) or a path
   * that already proved ownership of the run.
   */
  listStepArtifacts(runId: string): Promise<AgentRunStepArtifact[]>;
  /**
   * Deletes step artifacts whose retention has passed, oldest first,
   * and returns how many rows were deleted. Retention has passed when
   * the artifact's own expiry (a copy of its run's expiry) has
   * passed, or when the run has been in a terminal status for longer
   * than AGENT_RUN_ARTIFACT_TERMINAL_GRACE_MS (design §4.6) — a
   * terminal run's updatedAt is its terminal transition time, because
   * terminal rows never transition again. Wired into the piggyback
   * evaluation (PR-3); deleting a run row also removes its artifacts
   * by cascade. Reads never depend on the sweep: listStepArtifacts
   * already hides rows past their own expiry.
   */
  sweepExpiredArtifacts(limit?: number): Promise<number>;
}

const HOLD_REASONS: ReadonlySet<string> = new Set([
  'quota_exhausted',
  'rate_limited',
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
  // A rate-limit hold is a wait for a clock instant (the per-minute
  // window's recovery), never a ledger judgment: the run's own quota
  // ledger does not measure the providers' per-minute windows.
  rate_limited: ['at_time', 'manual'],
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

/** Epoch-ms upper bound for live-detail timestamps (2100-01-01 UTC). */
const MAX_LIVE_TIMESTAMP_MS = 4_102_444_800_000;

function truncateLiveText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, maxLength);
}

/** Reason tokens are kebab-case slugs from a closed vocabulary
 * (json-not-extractable, row-key-missing, …). Anything else — free
 * text, an overlong string, a non-string — is not a reason token and
 * the field is dropped, in the fail-soft style of this normalizer. */
const LIVE_PARSE_FAILURE_REASON_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function normalizeAgentRunStepParseFailure(value: unknown): AgentRunStepParseFailure | undefined {
  if (!isPlainObject(value)) return undefined;
  const { chunkIndex, reason } = value;
  if (!Number.isInteger(chunkIndex) || Number(chunkIndex) < 0) return undefined;
  if (typeof reason !== 'string' || reason.length > 40 || !LIVE_PARSE_FAILURE_REASON_PATTERN.test(reason)) {
    return undefined;
  }
  return { chunkIndex: Number(chunkIndex), reason };
}

/** Upper bound for a recorded coverage count. The counts are
 * deterministic tallies over a run's key space, itself bounded by
 * the attachment caps; anything beyond is not a count this system
 * produced, and the field carrying it is dropped — fail-soft, like
 * the rest of the live detail. */
const MAX_LIVE_COVERAGE_COUNT = 1_000_000;
/** Numeric columns a coverage breakdown may name. A table's numeric
 * columns are bounded by its header width; the cap keeps a malformed
 * record from smuggling an unbounded list into the step state. */
const MAX_LIVE_COVERAGE_NUMERIC_COLUMNS = 8;

function normalizeLiveCoverageCount(value: unknown): number | undefined {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > MAX_LIVE_COVERAGE_COUNT) return undefined;
  return Number(value);
}

function normalizeAgentRunStepCoverageFailure(value: unknown): AgentRunStepCoverageFailure | undefined {
  if (!isPlainObject(value)) return undefined;
  const { scope, chunkOffset, chunkCount, expected, covered, missing, duplicated, unexpected, numericMismatch } = value;
  if (scope !== 'final' && scope !== 'local') return undefined;
  const expectedCount = normalizeLiveCoverageCount(expected);
  const coveredCount = normalizeLiveCoverageCount(covered);
  const missingCount = normalizeLiveCoverageCount(missing);
  const duplicatedCount = normalizeLiveCoverageCount(duplicated);
  const unexpectedCount = normalizeLiveCoverageCount(unexpected);
  if (
    expectedCount === undefined
    || coveredCount === undefined
    || missingCount === undefined
    || duplicatedCount === undefined
    || unexpectedCount === undefined
  ) {
    return undefined;
  }
  if (!Array.isArray(numericMismatch)) return undefined;
  const columns: string[] = [];
  for (const raw of numericMismatch) {
    if (columns.length >= MAX_LIVE_COVERAGE_NUMERIC_COLUMNS) break;
    const name = truncateLiveText(raw, 80);
    if (name !== undefined) columns.push(name);
  }
  const failure: AgentRunStepCoverageFailure = {
    scope,
    expected: expectedCount,
    covered: coveredCount,
    missing: missingCount,
    duplicated: duplicatedCount,
    unexpected: unexpectedCount,
    numericMismatch: columns,
  };
  const offset = normalizeLiveCoverageCount(chunkOffset);
  if (offset !== undefined) failure.chunkOffset = offset;
  const count = normalizeLiveCoverageCount(chunkCount);
  if (count !== undefined) failure.chunkCount = count;
  const numericDetails = normalizeLiveCoverageNumericDetails(value.numericDetails);
  if (numericDetails !== undefined) failure.numericDetails = numericDetails;
  return failure;
}

/** Upper bound for a recorded coverage sum. The sums are
 * deterministic totals over an attachment table's numeric column;
 * a value beyond this — or not finite at all — is not a sum this
 * system produced, and the detail entry carrying it is dropped,
 * fail-soft like the counts above. */
const MAX_LIVE_COVERAGE_SUM = 1e15;

function normalizeLiveCoverageSum(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_LIVE_COVERAGE_SUM) {
    return undefined;
  }
  return value;
}

function normalizeLiveCoverageNumericDetails(
  value: unknown,
): AgentRunStepCoverageNumericDetail[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const details: AgentRunStepCoverageNumericDetail[] = [];
  for (const raw of value) {
    if (details.length >= MAX_LIVE_COVERAGE_NUMERIC_COLUMNS) break;
    if (!isPlainObject(raw)) continue;
    const column = truncateLiveText(raw.column, 80);
    const expectedSum = normalizeLiveCoverageSum(raw.expectedSum);
    const outputSum = normalizeLiveCoverageSum(raw.outputSum);
    const difference = normalizeLiveCoverageSum(raw.difference);
    const unparseableCount = normalizeLiveCoverageCount(raw.unparseableCount);
    if (
      column === undefined
      || expectedSum === undefined
      || outputSum === undefined
      || difference === undefined
      || unparseableCount === undefined
    ) {
      continue;
    }
    details.push({ column, expectedSum, outputSum, difference, unparseableCount });
  }
  return details.length > 0 ? details : undefined;
}

/** Distinct servings a step's execution trace may record. A
 * step's calls realistically touch one route per capacity bucket;
 * the cap keeps a malformed record from smuggling an unbounded
 * list into the step state. */
const MAX_LIVE_ANALYZER_SERVINGS = 4;

function normalizeAgentRunStepAnalyzerExecution(
  value: unknown,
): AgentRunStepAnalyzerExecution | undefined {
  if (!isPlainObject(value)) return undefined;
  const { servings, repairRetried } = value;
  if (!Array.isArray(servings) || typeof repairRetried !== 'boolean') return undefined;
  const normalized: AgentRunStepAnalyzerExecution['servings'] = [];
  for (const raw of servings) {
    if (normalized.length >= MAX_LIVE_ANALYZER_SERVINGS) break;
    if (!isPlainObject(raw)) continue;
    const { providerId, modelId } = raw;
    if (typeof providerId !== 'string' || !LIVE_PROVIDER_ID_PATTERN.test(providerId)) continue;
    if (modelId !== undefined && (typeof modelId !== 'string' || !LIVE_MODEL_ID_PATTERN.test(modelId))) continue;
    const serving: { providerId: string; modelId?: string } = { providerId };
    if (typeof modelId === 'string') serving.modelId = modelId;
    normalized.push(serving);
  }
  if (normalized.length === 0) return undefined;
  return { servings: normalized, repairRetried };
}

/** Provider-attempt field vocabularies for the live detail. Route
 * and model identifiers keep the provider layer's own safe shapes
 * (the same patterns its surfaced diagnostics validate against);
 * outcomes are the attempt evidence's closed set; error codes are
 * provider error-code tokens. Anything outside — free text, a
 * credential-shaped string, an overlong value — drops the entry, in
 * the fail-soft style of this normalizer. */
const LIVE_PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const LIVE_MODEL_ID_PATTERN = /^[A-Za-z0-9@][A-Za-z0-9@/_:.+-]{0,127}$/;
const LIVE_PROVIDER_ATTEMPT_OUTCOMES: ReadonlySet<string> = new Set([
  'succeeded',
  'availability-error',
  'failed',
  'skipped',
]);

function normalizeAgentRunStepProviderAttempt(value: unknown): AgentRunStepProviderAttempt | undefined {
  if (!isPlainObject(value)) return undefined;
  const { providerId, modelId, outcome, errorCode, durationMs, transportRequestCount } = value;
  if (typeof providerId !== 'string' || !LIVE_PROVIDER_ID_PATTERN.test(providerId)) return undefined;
  if (typeof outcome !== 'string' || !LIVE_PROVIDER_ATTEMPT_OUTCOMES.has(outcome)) return undefined;
  const attempt: AgentRunStepProviderAttempt = { providerId, outcome };
  if (modelId !== undefined) {
    if (typeof modelId !== 'string' || !LIVE_MODEL_ID_PATTERN.test(modelId)) return undefined;
    attempt.modelId = modelId;
  }
  if (errorCode !== undefined) {
    if (typeof errorCode !== 'string' || !ERROR_CODE_PATTERN.test(errorCode)) return undefined;
    attempt.errorCode = errorCode;
  }
  if (durationMs !== undefined) {
    if (!Number.isInteger(durationMs) || Number(durationMs) < 0 || Number(durationMs) > 3_600_000) return undefined;
    attempt.durationMs = Number(durationMs);
  }
  if (transportRequestCount !== undefined) {
    if (!Number.isInteger(transportRequestCount) || Number(transportRequestCount) < 0 || Number(transportRequestCount) > 100_000) {
      return undefined;
    }
    attempt.transportRequestCount = Number(transportRequestCount);
  }
  return attempt;
}

function normalizeAgentRunStepProviderAttempts(value: unknown): AgentRunStepProviderAttempt[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attempts: AgentRunStepProviderAttempt[] = [];
  for (const raw of value) {
    if (attempts.length >= MAX_AGENT_RUN_LIVE_PROVIDER_ATTEMPTS) break;
    const attempt = normalizeAgentRunStepProviderAttempt(raw);
    if (attempt) attempts.push(attempt);
  }
  return attempts.length > 0 ? attempts : undefined;
}

function normalizeAgentRunStepReconciliation(value: unknown): AgentRunStepReconciliation | undefined {
  if (!isPlainObject(value)) return undefined;
  const mode = value.mode === 'shadow' || value.mode === 'enforce' ? value.mode : undefined;
  if (mode === undefined) return undefined;
  const count = (raw: unknown): number | undefined => {
    if (!Number.isInteger(raw) || Number(raw) < 0 || Number(raw) > MAX_AGENT_RUN_LIVE_RECONCILIATION_COUNT) {
      return undefined;
    }
    return Number(raw);
  };
  const candidateCount = count(value.candidateCount);
  const keptCount = count(value.keptCount);
  const droppedCount = count(value.droppedCount);
  const pickedUpCount = count(value.pickedUpCount);
  if (candidateCount === undefined || keptCount === undefined || droppedCount === undefined || pickedUpCount === undefined) {
    return undefined;
  }
  const reconciliation: AgentRunStepReconciliation = {
    mode,
    candidateCount,
    keptCount,
    droppedCount,
    pickedUpCount,
  };
  if (value.failed === true) {
    reconciliation.failed = true;
    // The failure's reason code (D4): carried only for a failed
    // reconciliation and only in the error-code shape, fail-soft
    // like the rest of the detail — a malformed code is dropped,
    // never fatal, and the failure itself stays recorded.
    if (typeof value.failureCode === 'string' && ERROR_CODE_PATTERN.test(value.failureCode)) {
      reconciliation.failureCode = value.failureCode;
    }
  }
  // Kept/dropped indexes (対策1(a)): validated per entry and
  // fail-soft like the rest of the detail — a malformed entry is
  // skipped, an overlong list truncated, and an absent or
  // non-array value simply carries no list (a reconciliation that
  // was never judged records neither).
  if (Array.isArray(value.keptIndexes)) {
    const keptIndexes: number[] = [];
    for (const raw of value.keptIndexes) {
      if (keptIndexes.length >= MAX_AGENT_RUN_LIVE_RECONCILIATION_INDEXES) break;
      if (!Number.isInteger(raw) || Number(raw) < 0 || Number(raw) > MAX_AGENT_RUN_LIVE_RECONCILIATION_COUNT) continue;
      keptIndexes.push(Number(raw));
    }
    reconciliation.keptIndexes = keptIndexes;
  }
  if (Array.isArray(value.droppedIndexes)) {
    const droppedIndexes: { index: number; reason: string }[] = [];
    for (const raw of value.droppedIndexes) {
      if (droppedIndexes.length >= MAX_AGENT_RUN_LIVE_RECONCILIATION_INDEXES) break;
      if (!isPlainObject(raw)) continue;
      if (!Number.isInteger(raw.index) || Number(raw.index) < 0 || Number(raw.index) > MAX_AGENT_RUN_LIVE_RECONCILIATION_COUNT) continue;
      const reason = truncateLiveText(raw.reason, MAX_AGENT_RUN_LIVE_RECONCILIATION_REASON_LENGTH);
      if (reason === undefined || !/^[a-z][a-z-]*$/.test(reason)) continue;
      droppedIndexes.push({ index: Number(raw.index), reason });
    }
    reconciliation.droppedIndexes = droppedIndexes;
  }
  return reconciliation;
}

function normalizeAgentRunStepRowsOutput(value: unknown): AgentRunStepRowsOutput | undefined {
  if (!isPlainObject(value)) return undefined;
  if (!Array.isArray(value.columns)) return undefined;
  if (!Number.isInteger(value.rowCount) || Number(value.rowCount) < 0 || Number(value.rowCount) > MAX_AGENT_RUN_LIVE_ROWS_COUNT) {
    return undefined;
  }
  const columns: string[] = [];
  for (const raw of value.columns) {
    if (columns.length >= MAX_AGENT_RUN_LIVE_ROWS_COLUMNS) break;
    const column = truncateLiveText(raw, MAX_AGENT_RUN_LIVE_ROWS_COLUMN_LENGTH);
    if (column === undefined) continue;
    columns.push(column);
  }
  if (columns.length === 0) return undefined;
  return { columns, rowCount: Number(value.rowCount) };
}

function normalizeAgentRunStepValueTableSummary(value: unknown): AgentRunStepValueTableSummary | undefined {
  if (!isPlainObject(value)) return undefined;
  const count = (raw: unknown): number | undefined => {
    if (!Number.isInteger(raw) || Number(raw) < 0 || Number(raw) > MAX_AGENT_RUN_LIVE_VALUE_TABLE_COUNT) return undefined;
    return Number(raw);
  };
  const entryCount = count(value.entryCount);
  const groupCount = count(value.groupCount);
  if (entryCount === undefined || groupCount === undefined) return undefined;
  if (!Array.isArray(value.groups)) return undefined;
  const groups: AgentRunStepValueTableSummary['groups'] = [];
  for (const raw of value.groups) {
    if (groups.length >= MAX_AGENT_RUN_LIVE_VALUE_TABLE_GROUPS) break;
    if (!isPlainObject(raw)) continue;
    const entity = truncateLiveText(raw.entity, MAX_AGENT_RUN_LIVE_VALUE_TABLE_KEY_LENGTH);
    const attribute = truncateLiveText(raw.attribute, MAX_AGENT_RUN_LIVE_VALUE_TABLE_KEY_LENGTH);
    const entries = count(raw.entries);
    const distinctValues = count(raw.distinctValues);
    if (entity === undefined || attribute === undefined || entries === undefined || distinctValues === undefined) continue;
    groups.push({ entity, attribute, entries, distinctValues });
  }
  return { entryCount, groupCount, groups };
}

function normalizeLiveTimestamp(value: unknown): number | undefined {
  if (!Number.isFinite(value) || Number(value) <= 0 || Number(value) > MAX_LIVE_TIMESTAMP_MS) return undefined;
  return Math.floor(Number(value));
}

/**
 * Normalizes the optional live-view detail of one step. Unlike the
 * surrounding fields this is deliberately fail-soft (design §5.2): the
 * detail is display data derived from public pages, so a malformed
 * value is dropped and overlong text is truncated to the caps instead
 * of rejecting the step state — a bad excerpt must never make a
 * progress write (or a stored record's read-back) fail.
 */
function normalizeAgentRunStepLiveDetail(value: unknown): AgentRunStepLiveDetail | undefined {
  if (!isPlainObject(value)) return undefined;
  const detail: AgentRunStepLiveDetail = {};
  const startedAt = normalizeLiveTimestamp(value.startedAt);
  if (startedAt !== undefined) detail.startedAt = startedAt;
  const finishedAt = normalizeLiveTimestamp(value.finishedAt);
  if (finishedAt !== undefined) detail.finishedAt = finishedAt;
  const query = truncateLiveText(value.query, MAX_AGENT_RUN_LIVE_QUERY_LENGTH);
  if (query !== undefined) detail.query = query;
  const parseFailure = normalizeAgentRunStepParseFailure(value.parseFailure);
  if (parseFailure !== undefined) detail.parseFailure = parseFailure;
  const coverageFailure = normalizeAgentRunStepCoverageFailure(value.coverageFailure);
  if (coverageFailure !== undefined) detail.coverageFailure = coverageFailure;
  const analyzerExecution = normalizeAgentRunStepAnalyzerExecution(value.analyzerExecution);
  if (analyzerExecution !== undefined) detail.analyzerExecution = analyzerExecution;
  const providerAttempts = normalizeAgentRunStepProviderAttempts(value.providerAttempts);
  if (providerAttempts !== undefined) detail.providerAttempts = providerAttempts;
  const reconciliation = normalizeAgentRunStepReconciliation(value.reconciliation);
  if (reconciliation !== undefined) detail.reconciliation = reconciliation;
  const rowsOutput = normalizeAgentRunStepRowsOutput(value.rowsOutput);
  if (rowsOutput !== undefined) detail.rowsOutput = rowsOutput;
  const valueTable = normalizeAgentRunStepValueTableSummary(value.valueTable);
  if (valueTable !== undefined) detail.valueTable = valueTable;
  if (Array.isArray(value.sources)) {
    const sources: AgentRunStepLiveSource[] = [];
    for (const raw of value.sources) {
      if (sources.length >= MAX_AGENT_RUN_LIVE_SOURCES) break;
      if (!isPlainObject(raw)) continue;
      const title = truncateLiveText(raw.title, MAX_AGENT_RUN_LIVE_SOURCE_TITLE_LENGTH);
      const url = truncateLiveText(raw.url, MAX_AGENT_RUN_LIVE_SOURCE_URL_LENGTH);
      if (title === undefined || url === undefined) continue;
      const source: AgentRunStepLiveSource = { title, url };
      const domain = truncateLiveText(raw.domain, MAX_AGENT_RUN_LIVE_SOURCE_DOMAIN_LENGTH);
      if (domain !== undefined) source.domain = domain;
      const excerpt = truncateLiveText(raw.excerpt, MAX_AGENT_RUN_LIVE_SOURCE_EXCERPT_LENGTH);
      if (excerpt !== undefined) source.excerpt = excerpt;
      sources.push(source);
    }
    if (sources.length > 0) detail.sources = sources;
  }
  return Object.keys(detail).length > 0 ? detail : undefined;
}

export function normalizeAgentRunStepsState(stepsState: AgentRunStepState[] | undefined): AgentRunStepState[] {
  if (stepsState === undefined) return [];
  if (!Array.isArray(stepsState) || stepsState.length > MAX_AGENT_RUN_STEPS_STATE) {
    throw new Error('AGENT_RUN_STEPS_STATE_INVALID');
  }
  const seen = new Set<string>();
  const normalized = stepsState.map((step) => {
    if (!isPlainObject(step)) throw new Error('AGENT_RUN_STEPS_STATE_INVALID');
    const { id, status, attempts, artifactRef, summary, errorCode, liveDetail, rateLimitHolds } = step as Record<string, unknown>;
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
    if (liveDetail !== undefined) {
      const normalizedLiveDetail = normalizeAgentRunStepLiveDetail(liveDetail);
      if (normalizedLiveDetail) normalizedStep.liveDetail = normalizedLiveDetail;
    }
    if (rateLimitHolds !== undefined) {
      if (!Number.isInteger(rateLimitHolds) || Number(rateLimitHolds) < 0 || Number(rateLimitHolds) > AGENT_RUN_RATE_LIMIT_HOLD_MAX_PER_STEP) {
        throw new Error('AGENT_RUN_STEPS_STATE_INVALID');
      }
      normalizedStep.rateLimitHolds = Number(rateLimitHolds);
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

/**
 * Validates an approval lapse deadline (epoch ms). A deadline must be a
 * real instant and never beyond the record's own retention horizon. A
 * deadline in the past is valid data: it simply means the approval has
 * already lapsed and the piggyback evaluator will convert the run.
 */
export function normalizeAgentRunApprovalDeadlineAt(value: unknown, now: number, expiresAt?: number): number {
  if (!Number.isFinite(value) || Number(value) <= 0) throw new Error('AGENT_RUN_APPROVAL_DEADLINE_INVALID');
  const deadline = Number(value);
  if (deadline > now + MAX_AGENT_RUN_TTL_MS + 60_000) throw new Error('AGENT_RUN_APPROVAL_DEADLINE_INVALID');
  if (expiresAt !== undefined && deadline > expiresAt + 60_000) throw new Error('AGENT_RUN_APPROVAL_DEADLINE_INVALID');
  return deadline;
}

/** Validates a carried resume-attempt count (see AgentRunRecord). */
export function normalizeAgentRunPriorResumeAttempts(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 100_000) {
    throw new Error('AGENT_RUN_PRIOR_RESUME_ATTEMPTS_INVALID');
  }
  return Number(value);
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
  approvalDeadlineAt: number | null;
  priorResumeAttempts: number | null;
  expiresAt: number;
};

/**
 * Validates and normalizes a create request. A run may be born `held`
 * (goal-only requests included), but approval-bound statuses require the
 * plan snapshot and its digest as a pair, and only `held` records may
 * carry hold information. A run born `awaiting_approval` always carries
 * an approval lapse deadline; the carried resume-attempt count starts
 * from the birth hold (null when the run was never held).
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
  let approvalDeadlineAt: number | null = null;
  if (status === 'awaiting_approval') {
    approvalDeadlineAt = input.approvalDeadlineAt === undefined || input.approvalDeadlineAt === null
      ? now + AGENT_RUN_APPROVAL_LAPSE_MS
      : normalizeAgentRunApprovalDeadlineAt(input.approvalDeadlineAt, now, input.expiresAt);
  } else if (input.approvalDeadlineAt !== undefined && input.approvalDeadlineAt !== null) {
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
    approvalDeadlineAt,
    priorResumeAttempts: hold ? hold.resumeAttempts : null,
    expiresAt: input.expiresAt,
  };
}
