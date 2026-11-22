import { randomUUID } from 'node:crypto';
import { executeToolWithPermission, type ToolExecutionContext, type ToolName, type ToolParams, type ToolResult } from './toolRegistry.js';
import { verifyAndSelfFixArtifact } from './autoVerificationEngine.js';
import { verifyBeforeReportingCompletion } from './completionVerificationGate.js';
import { saveCheckpoint } from './checkpointManager.js';
import { assertCanReportCompleted } from './taskExecutionGate.js';
import { createAgentTaskGraph, type AgentTaskGraph } from './agentTaskGraph.js';
import { executeNextTask } from './taskGraphExecutor.js';
import {
  AGENT_RUN_RATE_LIMIT_HOLD_MAX_PER_STEP,
  AGENT_RUN_RATE_LIMIT_HOLD_MAX_RUN_ELAPSED_MS,
  AGENT_RUN_RATE_LIMIT_HOLD_MIN_WAIT_MS,
  MAX_AGENT_RUN_LIVE_QUERY_LENGTH,
  MAX_AGENT_RUN_LIVE_SOURCES,
  MAX_AGENT_RUN_LIVE_SOURCE_EXCERPT_LENGTH,
  MAX_AGENT_RUN_LIVE_SOURCE_TITLE_LENGTH,
  MAX_AGENT_RUN_LIVE_SOURCE_URL_LENGTH,
  agentRateLimitHoldEnabled,
  agentStepArtifactsEnabled,
  computeAgentRunStepFingerprint,
  validatePutAgentRunStepArtifactInput,
  type AgentRunHold,
  type AgentRunPlanStep,
  type AgentRunQuotaLedger,
  type AgentRunRecord,
  type AgentRunStepLiveDetail,
  type AgentRunStepState,
  type AgentRunStore,
  type PutAgentRunStepArtifactInput,
} from './agentRunRecord.js';
import { containsLikelySecret } from './safeFilePolicy.js';
import {
  AGENT_RUN_MAX_DELEGATED_STEPS_PER_ADVANCE,
  addAgentRunQuotaCharge,
  agentRunQuotaHold,
  agentRunStepCostClass,
  agentRunStepQuotaCharge,
  evaluateAgentRunQuotaCharge,
  snapshotAgentRunQuotaUsage,
  type AgentRunQuotaUsageSnapshot,
} from './agentRunQuotaGate.js';
import {
  AGENT_RUN_REPOSITORY_WRITE_LOCK_KEY,
  agentRunStepRequiresWriteLock,
  type AgentRunWriteLockRecord,
  type AgentRunWriteLockStore,
} from './agentRunWriteLock.js';
import { agentRunConsumptionReservationExpiresAt, type AgentRunConsumptionStore } from './agentOrchestratorV3.js';
import type { AgentAttachmentStore } from './agentAttachmentRecord.js';

/**
 * The persistent-run execution core (multitask Phase 1, PR 1-B).
 *
 * This module is the step-execution loop of agent v3 with the HTTP request
 * taken out of it. The legacy `POST /api/agent/v3/execute` handler still runs
 * the same loop inline inside one request; `advanceAgentRun` runs it against
 * a durable run record instead: it claims the record under a driver lease,
 * executes as many steps as the caller's time budget allows, persists
 * progress after every step, and leaves the record in a state any later
 * driver can pick up. Step semantics (serial order, per-step verification
 * with self-fix, checkpoints, the repository-wide completion gate for
 * file_writer plans, and the previous-artifact dataflow) are intentionally
 * identical to the legacy loop.
 *
 * Driver model: the core is driver-agnostic. It advances a record on top of
 * the store's lease abstraction (`driverId` + claim/renew); which driver
 * kind calls it (client-driven advance requests in Phase 1, server drivers
 * later) is the caller's choice, and the final driver mechanism (design
 * U1) is deliberately not decided here.
 *
 * Invariants held here:
 * - Replay protection runs before the first tool execution of a run's life
 *   and is shared with the legacy path through the consumption store, so a
 *   run can never execute twice across both paths. The reservation is
 *   journaled into the record's quota ledger so resumed advances do not
 *   consume again.
 * - The quota gate (agentRunQuotaGate.ts, PR 1-D) runs before every step
 *   that declares a scarce-quota charge: the charge is checked against
 *   the provider's confirmed free limit using usage aggregated from the
 *   owner's run ledgers, executed steps journal their charge into the
 *   ledger with their progress write, and a step that no longer fits
 *   parks the run as `held` (quota_exhausted / quota_reset) instead of
 *   executing. Local steps are never gated.
 * - The writer lock (agentRunWriteLock.ts, PR 1-E) serializes repository
 *   writes across runs: a write step (the tool registry's `sideEffects:
 *   'write'` class) and the repository-wide completion verification run
 *   only while this advance holds the repository write lock, acquired
 *   after the quota gate has had its say for the step (gate → lock,
 *   design §2.4/§2.5). Contention never fails and never holds the run:
 *   the step simply does not execute and the advance reports the wait,
 *   leaving the record to return to the queue when its claim lapses.
 *   Without a lock store a write step must not run (fail closed).
 * - A held record is never advanced: resuming always re-enters
 *   `awaiting_approval` first (design §8), which is a later phase's flow.
 * - Chunk boundaries fall between steps, never inside one, and never
 *   between a step and the step that consumes its textual artifact.
 * - Step-artifact persistence (design AGENT_STEP_ARTIFACT_PERSISTENCE_
 *   2026-11-22, PR-2) sits behind ORIGIN_AGENT_STEP_ARTIFACTS_ENABLED
 *   (default OFF; OFF is byte-identical to the behavior above). When ON,
 *   artifacts a later step consumes are saved with the completing
 *   step's fenced progress write, an advance hydrates the artifacts of
 *   steps an earlier advance completed (fingerprint + attempt must
 *   match the current plan and step state, else the row is treated as
 *   absent), and the chunk boundary may also fall between a producer
 *   and its consumer whenever the producer's artifact is persisted —
 *   the next advance resolves it from the store instead of memory.
 * - The rate-limit hold (design CAPACITY_RATE_LIMIT_QUANTIFICATION_
 *   2026-11-22 §2-B) sits behind ORIGIN_AGENT_RATE_LIMIT_HOLD_ENABLED
 *   (default OFF; OFF is byte-identical to the behavior above). When ON,
 *   an attachment_analyzer step whose execution ends in
 *   PROVIDER_RATE_LIMITED parks the run as `held` (reason
 *   `rate_limited`, resume condition `at_time` at the per-minute
 *   window's recovery) instead of failing it: the step returns to
 *   `queued` with its pre-execution attempt count — the rate-limited
 *   execution is a wait, not a judged attempt — completed steps stay
 *   completed, and the §8 resume flow (re-plan, fresh approval,
 *   confirm) re-advances the same run from the parked step. Parking is
 *   bounded per step (AGENT_RUN_RATE_LIMIT_HOLD_MAX_PER_STEP) and per
 *   run age (AGENT_RUN_RATE_LIMIT_HOLD_MAX_RUN_ELAPSED_MS); past either
 *   bound the step fails terminally with the provider's code, exactly
 *   as with the switch OFF. Parse and coverage verification are never
 *   touched: the hold changes only what a rate limit DOES to a run.
 */

export const AGENT_RUN_ADVANCE_DEFAULT_BUDGET_MS = 100_000;
export const AGENT_RUN_ADVANCE_DEFAULT_LEASE_SECONDS = 120;

const EXECUTION_RESERVED_PROVIDER = 'origin';
const EXECUTION_RESERVED_COUNTER = 'execution_reserved';
const createExecutionId = () => `exec-${Date.now()}-${randomUUID().slice(0, 8)}`;

/**
 * The cross-step artifact lookup the dataflow resolution reads: the
 * most recent textual artifact (`previousText`, the historical shape),
 * the textual artifact of each completed step by index (`byStep`), and
 * the raw artifact string of each completed step (`rawByStep`). A bare
 * string argument is accepted for the historical call shape and means
 * `{ previousText }`.
 */
export type StepArtifactLookup = {
  previousText?: string;
  byStep?: ReadonlyMap<number, string>;
  rawByStep?: ReadonlyMap<number, string>;
};

/** Resolves the cross-step dataflow markers at execution time. The approval
 * binding covers the planned params (markers included); resolution is a
 * deterministic local substitution of an earlier step's artifact.
 *
 * Two markers exist (file-input foundation F2, design §3.6):
 * - `contentFromPreviousArtifact: true` — the most recent textual
 *   artifact, the original single-source dataflow.
 * - `contentFromStep: <index>` — the textual artifact of one specific
 *   earlier step, so a plan with several producers can name exactly
 *   which output a step consumes (a second deliverable no longer
 *   receives the first one's content by position alone).
 * One consumer resolves differently: `attachment_analyzer` chains its
 * structured bundle from the previous analyzer step, so for that tool
 * the markers resolve to the RAW artifact string — the bundle JSON —
 * instead of its rendered `content` field. A structured-JSON
 * `document_generator` step (carrying `jsonTopLevelKeys`) resolves the
 * same way: it assembles its deliverable from the analyzer bundle,
 * and the rendered findings text would not carry the typed sections
 * it needs. Every other consumer takes the rendered text, which is
 * what a document or file step must embed. */
export function resolveStepParams(
  step: { toolName?: ToolName; params: ToolParams },
  artifacts: StepArtifactLookup | string | undefined,
): { params: ToolParams } | { error: string } {
  let lookup: StepArtifactLookup;
  if (artifacts === undefined) lookup = { previousText: undefined };
  else if (typeof artifacts === 'string') lookup = { previousText: artifacts };
  else lookup = artifacts;
  const raw = step.toolName === 'attachment_analyzer'
    || (step.toolName === 'document_generator' && Array.isArray(step.params.jsonTopLevelKeys));
  const fromStep = step.params.contentFromStep;
  if (typeof fromStep === 'number' && Number.isInteger(fromStep) && fromStep >= 0) {
    const content = raw ? lookup.rawByStep?.get(fromStep) : lookup.byStep?.get(fromStep);
    if (content === undefined) return { error: 'AGENT_STEP_INPUT_UNAVAILABLE' };
    const { contentFromStep: _from, contentFromPreviousArtifact: _marker, ...rest } = step.params;
    return { params: { ...rest, content } };
  }
  if (step.params.contentFromPreviousArtifact !== true) return { params: step.params };
  // The raw bundle form of "the previous artifact" is not defined —
  // analyzer chains always name their source step — so an analyzer
  // step, or a structured document step, carrying only the legacy
  // marker cannot resolve and fails closed like any other
  // unresolvable input.
  const content = raw ? undefined : lookup.previousText;
  if (content === undefined) return { error: 'AGENT_STEP_INPUT_UNAVAILABLE' };
  const { contentFromPreviousArtifact: _marker, ...rest } = step.params;
  return { params: { ...rest, content } };
}

const TOOL_FAILURE_CODE_PATTERN = /[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/;

/**
 * Derives the run failure code for a step whose tool itself returned
 * `ok: false`. Tool failure messages carry their reason as a bare code
 * ('AGENT_DOCUMENT_PARAMS_INVALID') or embed it ('Grounded research
 * failed closed (NO_RESULTS).'); either way the tool's own code wins.
 * `ARTIFACT_VERIFICATION_FAILED` is reserved for steps whose tool ran
 * and produced an artifact that verification then rejected — using it
 * for tool failures used to erase the real reason (for example the
 * research tool failing closed) from both the record and the response.
 * A message with no code token collapses to TOOL_EXECUTION_FAILED.
 */
export function toolFailureCodeFromMessage(message: string | undefined): string {
  if (!message) return 'TOOL_EXECUTION_FAILED';
  const trimmed = message.trim();
  if (/^[A-Z][A-Z0-9_]+$/.test(trimmed)) return trimmed;
  return TOOL_FAILURE_CODE_PATTERN.exec(trimmed)?.[0] ?? 'TOOL_EXECUTION_FAILED';
}

export function textualArtifactOf(toolName: ToolName, artifact: string): string | undefined {
  if (toolName === 'file_reader') return artifact;
  if (toolName === 'document_generator' || toolName === 'attachment_reader' || toolName === 'attachment_analyzer') {
    try {
      const parsed = JSON.parse(artifact) as { content?: unknown };
      return typeof parsed.content === 'string' ? parsed.content : undefined;
    } catch { return undefined; }
  }
  return undefined;
}

/**
 * Tools whose artifact can take textual form (the set `textualArtifactOf`
 * renders) — the producer side of the persistence selectivity rule.
 */
const TEXTUAL_ARTIFACT_PRODUCER_TOOLS: ReadonlySet<ToolName> = new Set([
  'file_reader',
  'document_generator',
  'attachment_reader',
  'attachment_analyzer',
]);

/** Whether a consuming step resolves the RAW artifact string of its
 * source (analyzer bundle chaining, structured document assembly)
 * rather than the rendered text — the same distinction resolveStepParams
 * draws. */
function stepConsumesRawArtifact(step: { toolName?: ToolName; params: ToolParams }): boolean {
  return step.toolName === 'attachment_analyzer'
    || (step.toolName === 'document_generator' && Array.isArray(step.params.jsonTopLevelKeys));
}

/**
 * The plan indexes whose artifacts persistence must save (design §4.2):
 * every step a later step names through `contentFromStep`, plus — for
 * each step carrying the position-dependent
 * `contentFromPreviousArtifact` marker — every textual producer before
 * it. Deterministic from the approved plan alone, so the rule adds no
 * runtime judgment to what gets stored. Steps nobody consumes are
 * never saved.
 */
export function stepArtifactPersistIndexes(plan: readonly AgentRunPlanStep[]): ReadonlySet<number> {
  const selected = new Set<number>();
  plan.forEach((step, consumerIndex) => {
    const fromStep = step.params.contentFromStep;
    if (typeof fromStep === 'number' && Number.isInteger(fromStep) && fromStep >= 0 && fromStep < plan.length) {
      selected.add(fromStep);
    }
    if (step.params.contentFromPreviousArtifact === true) {
      for (let index = 0; index < consumerIndex; index += 1) {
        if (TEXTUAL_ARTIFACT_PRODUCER_TOOLS.has(plan[index].toolName)) selected.add(index);
      }
    }
  });
  return selected;
}

/**
 * Extracts the live-view sources from a research step's artifact JSON
 * (agent live view PR-L1, design §5.2). Fail-soft by construction: an
 * unparseable artifact or an unexpected shape yields fewer (or no)
 * sources, never an exception. Only public page material is taken —
 * title, URL, domain and the excerpt the search pipeline returned,
 * each truncated to the record caps — and any string that trips the
 * likely-secret screen is dropped (the field, or the whole source when
 * its title or URL trips) so the caller's progress write can never be
 * blocked by a page excerpt.
 */
function liveSourcesFromArtifact(artifact: string | undefined): NonNullable<AgentRunStepLiveDetail['sources']> {
  if (!artifact) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(artifact);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const rawSources = (parsed as { sources?: unknown }).sources;
  if (!Array.isArray(rawSources)) return [];
  const sources: NonNullable<AgentRunStepLiveDetail['sources']> = [];
  for (const raw of rawSources) {
    if (sources.length >= MAX_AGENT_RUN_LIVE_SOURCES) break;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const candidate = raw as { title?: unknown; url?: unknown; domain?: unknown; excerpt?: unknown };
    if (typeof candidate.title !== 'string' || typeof candidate.url !== 'string') continue;
    const title = candidate.title.trim();
    const url = candidate.url.trim();
    if (!title || !url || containsLikelySecret(title) || containsLikelySecret(url)) continue;
    const source: NonNullable<AgentRunStepLiveDetail['sources']>[number] = {
      title: title.slice(0, MAX_AGENT_RUN_LIVE_SOURCE_TITLE_LENGTH),
      url: url.slice(0, MAX_AGENT_RUN_LIVE_SOURCE_URL_LENGTH),
    };
    if (typeof candidate.domain === 'string' && candidate.domain.trim() && !containsLikelySecret(candidate.domain)) {
      source.domain = candidate.domain.trim();
    }
    if (typeof candidate.excerpt === 'string' && candidate.excerpt.trim() && !containsLikelySecret(candidate.excerpt)) {
      source.excerpt = candidate.excerpt.trim().slice(0, MAX_AGENT_RUN_LIVE_SOURCE_EXCERPT_LENGTH);
    }
    sources.push(source);
  }
  return sources;
}

/**
 * Builds the live-view detail for one executed step (agent live view
 * PR-L1, design §5.2). Strictly fail-soft: any problem drops the whole
 * detail (returning undefined) rather than the step's progress write.
 * Timestamps are recorded for every step; the query and sources only
 * for research steps — the query actually executed and the pages it
 * actually returned; and for an attachment_analyzer step whose tool
 * failed output validation, the failing chunk's index and the
 * parse-failure reason token (Basel observability). Prompts,
 * credentials, response bodies and tool internals never enter the
 * record through here.
 */
/**
 * The analyzer's output-invalid failure message carries the failing
 * chunk's global index and the parse-failure reason token in a fixed
 * parenthetical (Basel observability, diagnosis
 * AGENT_BASEL_DATA_OUTPUT_INVALID_DIAGNOSIS_2026-11-23 §4) — the
 * same "structure out of the message" pattern toolFailureCodeFromMessage
 * uses for the failure code itself. Anything that does not match the
 * fixed shape contributes nothing.
 */
const ANALYZER_PARSE_FAILURE_PATTERN = /AGENT_DATA_OUTPUT_INVALID \(chunk (\d+), parse: ([a-z][a-z0-9-]*)\)/;

export function parseFailureFromAnalyzerMessage(
  message: string | undefined,
): { chunkIndex: number; reason: string } | undefined {
  if (!message) return undefined;
  const match = ANALYZER_PARSE_FAILURE_PATTERN.exec(message);
  if (!match) return undefined;
  const chunkIndex = Number(match[1]);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) return undefined;
  return { chunkIndex, reason: match[2] };
}

export function buildStepLiveDetail(input: {
  toolName: ToolName;
  params: ToolParams;
  artifact: string | undefined;
  startedAt: number;
  finishedAt: number;
  /** The tool failure message, when the step's tool returned
   * `ok: false`. Only an attachment_analyzer's output-invalid
   * message is read, and only for its chunk index and reason token
   * — the body of any model response never enters the record. */
  failureMessage?: string;
}): AgentRunStepLiveDetail | undefined {
  try {
    const detail: AgentRunStepLiveDetail = { startedAt: input.startedAt, finishedAt: input.finishedAt };
    if (input.toolName === 'attachment_analyzer') {
      const parseFailure = parseFailureFromAnalyzerMessage(input.failureMessage);
      if (parseFailure) detail.parseFailure = parseFailure;
    }
    if (input.toolName === 'web_search_grounding') {
      const query = typeof input.params.query === 'string' ? input.params.query.trim() : '';
      if (query && !containsLikelySecret(query)) {
        detail.query = query.slice(0, MAX_AGENT_RUN_LIVE_QUERY_LENGTH);
      }
      const sources = liveSourcesFromArtifact(input.artifact);
      if (sources.length > 0) detail.sources = sources;
    }
    return detail;
  } catch {
    return undefined;
  }
}

export type AgentRunToolRunner = (name: ToolName, input: ToolParams) => Promise<ToolResult>;

export type AgentRunArtifactVerifier = (
  artifact: string,
  toolName: ToolName,
  runTool: AgentRunToolRunner,
  params: ToolParams,
) => Promise<{ ok: boolean; artifact: string; attempts: number }>;

export interface AgentRunAdvancerDeps {
  runStore: AgentRunStore;
  /** Shared replay protection with the legacy execute path. Required to
   * advance: without it the core refuses (fail closed), like the legacy
   * handler's 503 stance. */
  consumptionStore?: AgentRunConsumptionStore;
  /** Repository writer lock (PR 1-E). Required before any write step or
   * the completion verification may run; without it those steps refuse
   * (fail closed) while read-only steps advance as before. */
  writeLockStore?: AgentRunWriteLockStore;
  /** Attachment store for the data tools (file-input foundation F2).
   * When present, the default tool runner binds it — scoped to this
   * record's owner binding — into the execution context, which is the
   * only way attachment_reader / attachment_analyzer can reach a file
   * body. Without it those steps fail closed as unavailable. */
  attachmentStore?: AgentAttachmentStore;
  /** Step-artifact persistence switch (design §4.7). When absent, the
   * ORIGIN_AGENT_STEP_ARTIFACTS_ENABLED env decides; either way the
   * default is OFF and OFF changes nothing about this advance. */
  stepArtifactsEnabled?: boolean;
  /** Rate-limit hold switch (design CAPACITY_RATE_LIMIT_
   * QUANTIFICATION_2026-11-22 §2-B). When absent, the
   * ORIGIN_AGENT_RATE_LIMIT_HOLD_ENABLED env decides; either way the
   * default is OFF and OFF changes nothing about this advance. */
  rateLimitHoldEnabled?: boolean;
  toolContext?: ToolExecutionContext;
  runTool?: AgentRunToolRunner;
  verifyArtifact?: AgentRunArtifactVerifier;
  verifyCompletion?: () => Promise<{ ok: boolean }>;
  now?: () => number;
}

/**
 * The `completed` variant may carry `artifact`: the final step's artifact
 * body, finalized by this very advance (PR-D1, wiring design §4.3). It is
 * a delivery-only hand-off for display — the record itself never persists
 * artifact bodies (steps keep only `artifactRef` / `summary`) — and it is
 * absent when this advance finalized no step (for example when every step
 * had already completed in an earlier advance). No other variant carries
 * an artifact body.
 */
export type AdvanceAgentRunOutcome =
  | { kind: 'completed'; record: AgentRunRecord; artifact?: string }
  | { kind: 'failed'; record: AgentRunRecord; errorCode: string }
  | { kind: 'held'; record: AgentRunRecord; provider: string; resetAt: number }
  | { kind: 'rate_limited'; record: AgentRunRecord; retryAt: number }
  | { kind: 'write_lock_busy'; record: AgentRunRecord; holderRunId: string | null; lockExpiresAt: number | null }
  | { kind: 'progress'; record: AgentRunRecord }
  | { kind: 'busy'; record: AgentRunRecord }
  | { kind: 'not_runnable'; record: AgentRunRecord }
  | { kind: 'unavailable'; record: AgentRunRecord; errorCode: string };

function stepStateFor(record: AgentRunRecord, index: number): AgentRunStepState {
  const id = `task-${index + 1}`;
  return record.stepsState.find((step) => step.id === id) ?? { id, status: 'queued', attempts: 0 };
}

/** Rebuilds the serial task graph for a record, overlaying persisted step
 * state so a resumed advance continues where the previous one stopped. A
 * step left `running` by a lost driver is re-queued with its attempts
 * preserved; terminal step states are kept as the graph defines them. */
function graphForRecord(record: AgentRunRecord, stepsState: AgentRunStepState[]): AgentTaskGraph {
  const plan = record.plan ?? [];
  const graph = createAgentTaskGraph(
    `execute ${plan.map((step) => step.toolName).join(' + ')}`,
    plan.map((step) => step.toolName),
  );
  return {
    ...graph,
    tasks: graph.tasks.map((task, index) => {
      const state = stepsState[index];
      if (!state) return task;
      return {
        ...task,
        status: state.status === 'running' ? 'queued' : state.status,
        attempts: state.attempts,
      };
    }),
  };
}

export async function advanceAgentRun(
  deps: AgentRunAdvancerDeps,
  snapshot: AgentRunRecord,
  driverId: string,
  options: { budgetMs?: number; leaseSeconds?: number } = {},
): Promise<AdvanceAgentRunOutcome> {
  const { runStore } = deps;
  if (snapshot.status !== 'queued' && snapshot.status !== 'running') {
    return { kind: 'not_runnable', record: snapshot };
  }
  if (!deps.consumptionStore) {
    return { kind: 'unavailable', record: snapshot, errorCode: 'AGENT_REPLAY_PROTECTION_UNAVAILABLE' };
  }
  const consumptionStore = deps.consumptionStore;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const budgetMs = options.budgetMs ?? AGENT_RUN_ADVANCE_DEFAULT_BUDGET_MS;
  const leaseSeconds = options.leaseSeconds ?? AGENT_RUN_ADVANCE_DEFAULT_LEASE_SECONDS;
  const stepArtifactsOn = deps.stepArtifactsEnabled ?? agentStepArtifactsEnabled(process.env);
  const rateLimitHoldOn = deps.rateLimitHoldEnabled ?? agentRateLimitHoldEnabled(process.env);

  const lease = await runStore.claim(snapshot.runId, driverId, leaseSeconds);
  if (!lease) return { kind: 'busy', record: snapshot };
  const record: AgentRunRecord = lease;
  const plan = record.plan;
  if (!plan || plan.length === 0) {
    const finished = await runStore.finish(record.runId, driverId, 'failed');
    return { kind: 'failed', record: finished ?? { ...record, status: 'failed' }, errorCode: 'AGENT_RUN_PLAN_MISSING' };
  }

  const stepsState: AgentRunStepState[] = plan.map((_, index) => stepStateFor(record, index));
  const executionApproval = { approved: true, costInUSD: 0, safetyPolicyPassed: true };
  const runTool: AgentRunToolRunner = deps.runTool
    ?? ((name, input) => executeToolWithPermission(name, input, executionApproval, {
      ...deps.toolContext,
      ...(deps.attachmentStore
        ? { attachments: { store: deps.attachmentStore, ownerBinding: record.ownerBinding } }
        : {}),
    }));
  const verifyArtifact: AgentRunArtifactVerifier = deps.verifyArtifact
    ?? ((artifact, toolName, runner, params) => verifyAndSelfFixArtifact(artifact, toolName, runner, params));
  const verifyCompletion = deps.verifyCompletion ?? (() => verifyBeforeReportingCompletion(process.cwd()));

  // Writer lock (PR 1-E): acquired lazily at the first write step of
  // this advance and held until the advance ends, so a write step and
  // the completion verification that follows it in the same advance are
  // atomic with respect to other runs. Release is best-effort: a lost
  // release only means the lock frees itself at its lease expiry.
  let writeLock: AgentRunWriteLockRecord | null = null;
  const releaseWriteLock = async (): Promise<void> => {
    if (!writeLock || !deps.writeLockStore) {
      writeLock = null;
      return;
    }
    const held = writeLock;
    writeLock = null;
    await deps.writeLockStore.release(held.lockKey, held.holderRunId, held.holderDriverId).catch(() => false);
  };
  const ensureWriteLock = async (): Promise<'acquired' | 'busy' | 'unavailable'> => {
    if (writeLock) return 'acquired';
    if (!deps.writeLockStore) return 'unavailable';
    let acquired: AgentRunWriteLockRecord | null;
    try {
      acquired = await deps.writeLockStore.acquire(AGENT_RUN_REPOSITORY_WRITE_LOCK_KEY, record.runId, driverId, leaseSeconds);
    } catch {
      return 'unavailable';
    }
    if (!acquired) return 'busy';
    writeLock = acquired;
    return 'acquired';
  };
  const writeLockBusyOutcome = async (): Promise<AdvanceAgentRunOutcome> => {
    let holder: AgentRunWriteLockRecord | null = null;
    if (deps.writeLockStore) {
      holder = await deps.writeLockStore.inspect(AGENT_RUN_REPOSITORY_WRITE_LOCK_KEY).catch(() => null);
    }
    return {
      kind: 'write_lock_busy',
      record: { ...record, stepsState, status: 'running' },
      holderRunId: holder?.holderRunId ?? null,
      lockExpiresAt: holder?.leaseExpiresAt ?? null,
    };
  };

  const failRun = async (errorCode: string): Promise<AdvanceAgentRunOutcome> => {
    await releaseWriteLock();
    const finished = await runStore.finish(record.runId, driverId, 'failed');
    return { kind: 'failed', record: finished ?? { ...record, stepsState, status: 'failed' }, errorCode };
  };

  /**
   * Rate-limit hold (design CAPACITY_RATE_LIMIT_QUANTIFICATION_
   * 2026-11-22 §2-B): parks the run instead of failing it when the
   * step at `index` ended in PROVIDER_RATE_LIMITED. Returns the
   * outcome that ends this advance when the park lands (or its honest
   * fallback when the park write loses the claim), or null when the
   * runaway bounds refuse the park and the caller must fail the run
   * with the provider's code exactly as before.
   *
   * `priorStepState` is the step's state before this execution: the
   * parked step returns to `queued` with that attempt count and the
   * provider code kept as its errorCode, because the rate-limited
   * execution produced nothing the step can be judged on — it is a
   * wait, not an attempt. The bounds that keep a persistently limited
   * step from looping forever are the hold's own (per-step park count,
   * run age), not the task graph's attempt cap. The step's declared
   * quota charge stays journaled: the execution did spend provider
   * calls, and the ledger counts attempts, not outcomes.
   */
  const tryParkRateLimitedStep = async (
    index: number,
    priorStepState: AgentRunStepState,
    liveDetail: AgentRunStepLiveDetail | undefined,
  ): Promise<AdvanceAgentRunOutcome | null> => {
    const priorHolds = priorStepState.rateLimitHolds ?? 0;
    if (priorHolds >= AGENT_RUN_RATE_LIMIT_HOLD_MAX_PER_STEP) return null;
    const parkedAt = now();
    if (parkedAt - record.createdAt >= AGENT_RUN_RATE_LIMIT_HOLD_MAX_RUN_ELAPSED_MS) return null;
    // The resume instant is the per-minute window's recovery floor
    // (AGENT_RUN_RATE_LIMIT_HOLD_MIN_WAIT_MS). A provider Retry-After
    // or reset replaces the floor when it becomes observable on the
    // model-call path; the result type carries only the failure code
    // today, so the floor is what the hold records (design §1.5).
    const retryAt = parkedAt + AGENT_RUN_RATE_LIMIT_HOLD_MIN_WAIT_MS;
    stepsState[index] = {
      id: `task-${index + 1}`,
      status: 'queued',
      attempts: priorStepState.attempts,
      errorCode: 'PROVIDER_RATE_LIMITED',
      rateLimitHolds: priorHolds + 1,
      ...(liveDetail ? { liveDetail } : {}),
    };
    if (!await runStore.updateProgress(record.runId, driverId, { stepsState })) {
      return { kind: 'busy', record: { ...record, stepsState } };
    }
    const hold: AgentRunHold = {
      reason: 'rate_limited',
      resumeCondition: { kind: 'at_time', at: retryAt },
      heldSince: parkedAt,
      // The §8.6 carried-count convention, shared with the quota hold:
      // a first hold starts at 0; a run that was resumed and parks
      // again counts one more resume episode.
      resumeAttempts: record.priorResumeAttempts === null ? 0 : record.priorResumeAttempts + 1,
    };
    await releaseWriteLock();
    const finished = await runStore.finish(record.runId, driverId, 'held', hold);
    if (!finished) return { kind: 'progress', record: { ...record, stepsState, status: 'running' } };
    return { kind: 'rate_limited', record: finished, retryAt };
  };

  // Replay protection: exactly one reservation per run lifetime, shared with
  // the legacy execute path. The ledger journal lets a resumed advance tell
  // "already reserved by an earlier advance" apart from "reserved by the
  // legacy path or a cancellation tombstone", which must never re-execute.
  // The working copy of the run's quota ledger for this advance: the
  // reservation journal below and every executed step's quota charge are
  // written through it, so the persisted ledger always reflects what this
  // run has actually spent.
  let currentLedger: AgentRunQuotaLedger = record.quotaLedger;
  const alreadyReserved = record.quotaLedger[EXECUTION_RESERVED_PROVIDER]?.[EXECUTION_RESERVED_COUNTER] === 1;
  const anyProgress = stepsState.some((step) => step.attempts > 0 || step.status === 'completed');
  if (!alreadyReserved && !anyProgress) {
    let consumed: boolean;
    try {
      // The record's own expiry (creation + 7 days) is far beyond the
      // consumption store's reservation contract (at most 15 minutes),
      // so the reservation expiry is derived from the shared helper —
      // the same semantics the legacy execute path applies — instead of
      // passing record.expiresAt verbatim (which the store rejects with
      // INVALID_AGENT_RUN_EXPIRY, failing every advance).
      consumed = await consumptionStore.consume(
        record.runId,
        agentRunConsumptionReservationExpiresAt(record.expiresAt, now()),
      );
    } catch {
      return { kind: 'unavailable', record, errorCode: 'AGENT_REPLAY_PROTECTION_UNAVAILABLE' };
    }
    if (!consumed) return failRun('AGENT_RUN_ALREADY_CONSUMED');
    const quotaLedger: AgentRunQuotaLedger = {
      ...record.quotaLedger,
      [EXECUTION_RESERVED_PROVIDER]: {
        ...(record.quotaLedger[EXECUTION_RESERVED_PROVIDER] ?? {}),
        [EXECUTION_RESERVED_COUNTER]: 1,
      },
    };
    if (!await runStore.updateProgress(record.runId, driverId, { quotaLedger })) {
      return { kind: 'busy', record: { ...record, stepsState } };
    }
    currentLedger = quotaLedger;
  }

  let graph = graphForRecord(record, stepsState);
  const executionId = createExecutionId();
  let previousText: string | undefined;
  /** Textual artifact per completed step index (for `contentFromStep`)
   * and the raw artifact strings (for analyzer bundle chaining). Only
   * steps completed in THIS advance are present; a resumed advance
   * rebuilds them as it re-walks the plan, and a step whose source
   * completed in an earlier advance cannot resolve — the same
   * chunk-boundary discipline that already kept a step and its
   * consumer inside one advance. */
  const textualByStep = new Map<number, string>();
  const rawByStep = new Map<number, string>();
  /** The subset of the two maps a FUTURE advance could reconstruct
   * from the store: rows hydrated at this advance's start plus the
   * artifacts this advance itself saves. The chunk-boundary rule
   * consults only these — an artifact that exists solely in this
   * advance's memory still pins its consumer to this advance. */
  const persistedTextualByStep = new Map<number, string>();
  const persistedRawByStep = new Map<number, string>();
  let finalArtifact: string | undefined;
  const startIndex = stepsState.findIndex((step) => step.status !== 'completed');
  const persistIndexes = stepArtifactsOn ? stepArtifactPersistIndexes(plan) : new Set<number>();

  // Hydration (design §4.4): rebuild the dataflow for steps an earlier
  // advance completed from their persisted artifacts. A row is used
  // only when its step is recorded completed, its fingerprint matches
  // the current plan's step at that index, and its attempt matches the
  // recorded step state; anything else is treated as absent, so a
  // re-plan can never silently inherit a different step's output and a
  // consumer whose source is missing fails closed with
  // AGENT_STEP_INPUT_UNAVAILABLE, exactly as it does without
  // persistence. A store read failure degrades the same way.
  if (stepArtifactsOn && startIndex > 0) {
    let storedArtifacts: Awaited<ReturnType<AgentRunStore['listStepArtifacts']>> = [];
    try {
      storedArtifacts = await runStore.listStepArtifacts(record.runId);
    } catch {
      storedArtifacts = [];
    }
    for (const stored of storedArtifacts) {
      const index = stored.stepIndex;
      if (index < 0 || index >= startIndex) continue;
      const state = stepsState[index];
      const producer = plan[index];
      if (!state || state.status !== 'completed' || !producer) continue;
      if (stored.attempt !== state.attempts) continue;
      let fingerprint: string;
      try {
        fingerprint = computeAgentRunStepFingerprint(producer.toolName, producer.params);
      } catch {
        continue;
      }
      if (fingerprint !== stored.stepFingerprint) continue;
      rawByStep.set(index, stored.artifact);
      persistedRawByStep.set(index, stored.artifact);
      const text = textualArtifactOf(producer.toolName, stored.artifact);
      if (text !== undefined) {
        textualByStep.set(index, text);
        persistedTextualByStep.set(index, text);
      }
    }
    for (let index = 0; index < startIndex; index += 1) {
      const text = textualByStep.get(index);
      if (text !== undefined) previousText = text;
    }
  }

  // Quota gate preparation (PR 1-D): only advances whose remaining steps
  // declare a scarce-quota charge or a delegated job need usage data, so
  // local-only runs keep the exact pre-gate behavior (and store traffic).
  // Usage is aggregated from the owner's run ledgers once per advance;
  // charges journaled during this advance are tracked separately and the
  // gate adds both. If usage cannot be read, consuming steps must not
  // run on a guess: the advance reports unavailable and the claim lapses
  // back to the queue like other transient driver failures.
  const remainingSteps = startIndex >= 0 ? plan.slice(startIndex) : [];
  const gateEngaged = remainingSteps.some(
    (step) => agentRunStepQuotaCharge(step.toolName, step.params) !== null
      || agentRunStepCostClass(step.toolName) === 'delegated-job',
  );
  let quotaSnapshot: AgentRunQuotaUsageSnapshot | null = null;
  if (gateEngaged) {
    let ownerRuns: AgentRunRecord[];
    try {
      ownerRuns = await runStore.listByOwner(record.ownerBinding, { limit: 100 });
    } catch {
      return { kind: 'unavailable', record, errorCode: 'AGENT_RUN_QUOTA_USAGE_UNAVAILABLE' };
    }
    quotaSnapshot = snapshotAgentRunQuotaUsage(ownerRuns, now());
  }
  let sessionCharges: AgentRunQuotaLedger = {};
  let delegatedThisAdvance = 0;

  let currentStepIndex = -1;
  try {
    for (let index = startIndex; index >= 0 && index < plan.length; index += 1) {
      currentStepIndex = index;
      const step = plan[index];
      const elapsed = now() - startedAt;
      if (index > startIndex) {
        // Chunk boundary: stop between steps when the budget is spent, but
        // never between a step and the step consuming its artifact.
        const consumesPreviousArtifact = (step.params.contentFromPreviousArtifact === true && previousText !== undefined)
          || (typeof step.params.contentFromStep === 'number'
            && (textualByStep.has(step.params.contentFromStep) || rawByStep.has(step.params.contentFromStep)));
        // With persistence ON the boundary may also fall between a
        // producer and its consumer when the artifact the consumer
        // needs is persisted (hydrated, or saved by this advance): the
        // next advance reconstructs it from the store. When the needed
        // artifact exists only in this advance's memory — its save was
        // refused by the size caps or the secret screen — the consumer
        // stays pinned to this advance, exactly as without persistence.
        let stopAllowed = !consumesPreviousArtifact;
        if (stepArtifactsOn && !stopAllowed) {
          const fromStep = step.params.contentFromStep;
          if (typeof fromStep === 'number' && Number.isInteger(fromStep) && fromStep >= 0) {
            stopAllowed = stepConsumesRawArtifact(step)
              ? persistedRawByStep.has(fromStep)
              : persistedTextualByStep.has(fromStep);
          } else if (step.params.contentFromPreviousArtifact === true) {
            if (stepConsumesRawArtifact(step)) {
              // The raw form of "the previous artifact" is undefined —
              // resolution fails closed whether we stop or run it now.
              stopAllowed = true;
            } else {
              stopAllowed = true;
              for (let source = index - 1; source >= 0; source -= 1) {
                if (textualByStep.has(source)) {
                  stopAllowed = persistedTextualByStep.has(source);
                  break;
                }
              }
            }
          }
        }
        if (elapsed > budgetMs && stopAllowed) {
          await releaseWriteLock();
          return { kind: 'progress', record: { ...record, stepsState, status: 'running' } };
        }
        if (elapsed > leaseSeconds * 750) {
          if (!await runStore.renewLease(record.runId, driverId, leaseSeconds)) {
            await releaseWriteLock();
            return { kind: 'progress', record: { ...record, stepsState, status: 'running' } };
          }
          if (writeLock && deps.writeLockStore) {
            // The write lock rides the same renewal cadence as the claim:
            // losing it mid-advance (lapsed and taken over) stops the
            // advance here rather than writing unprotected.
            const renewed = await deps.writeLockStore.renew(writeLock.lockKey, writeLock.holderRunId, writeLock.holderDriverId, leaseSeconds).catch(() => false);
            if (!renewed) {
              await releaseWriteLock();
              return { kind: 'progress', record: { ...record, stepsState, status: 'running' } };
            }
          }
        }
      }
      // Quota gate (PR 1-D): a step that declares a charge may only run
      // while the charge fits the provider's confirmed window limit;
      // delegated jobs are serialized to one per advance (their internal
      // consumption is unmeasured — see agentRunQuotaGate.ts). A blocked
      // step is never executed: the run is parked as held at this step
      // boundary with its progress intact (design §8.3 entry 4, §9.4).
      const stepCharge = agentRunStepQuotaCharge(step.toolName, step.params);
      if (agentRunStepCostClass(step.toolName) === 'delegated-job'
        && delegatedThisAdvance >= AGENT_RUN_MAX_DELEGATED_STEPS_PER_ADVANCE) {
        await releaseWriteLock();
        return { kind: 'progress', record: { ...record, stepsState, status: 'running' } };
      }
      if (stepCharge && quotaSnapshot) {
        const decision = evaluateAgentRunQuotaCharge({
          charge: stepCharge,
          snapshot: quotaSnapshot,
          sessionCharges,
          now: now(),
        });
        if (decision.allowed === false) {
          const hold = agentRunQuotaHold(decision, now(), record.priorResumeAttempts);
          await releaseWriteLock();
          const finished = await runStore.finish(record.runId, driverId, 'held', hold);
          return {
            kind: 'held',
            record: finished ?? { ...record, stepsState, status: 'held', hold },
            provider: decision.provider,
            resetAt: decision.resetAt,
          };
        }
      }
      // Writer lock (PR 1-E): after the quota gate has had its say for
      // this step (gate → lock), a write step runs only while this
      // advance holds the repository write lock. Contention is a step
      // wait, never a failure and never a hold (design §2.5): the step
      // does not execute, earlier progress stays persisted, and the
      // record returns to the queue when its claim lapses.
      if (agentRunStepRequiresWriteLock(step.toolName)) {
        const lockAttempt = await ensureWriteLock();
        if (lockAttempt === 'unavailable') {
          return { kind: 'unavailable', record, errorCode: 'AGENT_WRITE_LOCK_UNAVAILABLE' };
        }
        if (lockAttempt === 'busy') {
          return writeLockBusyOutcome();
        }
      }
      const resolved = resolveStepParams(step, { previousText, byStep: textualByStep, rawByStep });
      const stepParams = 'params' in resolved ? resolved.params : step.params;
      // The step's pre-execution state, captured for the rate-limit
      // hold: a parked step is restored from exactly this (plus its
      // incremented park count), so the capture must happen before
      // the post-execution assignment below replaces the entry.
      const stepStateBeforeExecution = stepsState[index];
      const stepStartedAt = now();
      const execution = await executeNextTask(graph, async () => {
        if ('error' in resolved) return { ok: false, message: resolved.error };
        return runTool(step.toolName, stepParams);
      }, async (result) => result.artifact
        ? verifyArtifact(result.artifact, step.toolName, runTool, stepParams)
        : { ok: false, artifact: '', attempts: 0 });
      graph = execution.graph;
      const executionRecord = execution.record;
      const finalTask = execution.graph.tasks[index];
      const failureCode = 'error' in resolved
        ? resolved.error
        : !executionRecord?.toolExecuted
          ? 'TOOL_EXECUTION_BLOCKED'
          : executionRecord.toolFailureMessage !== undefined
            ? toolFailureCodeFromMessage(executionRecord.toolFailureMessage)
            : 'ARTIFACT_VERIFICATION_FAILED';
      // Live-view detail (PR-L1): built fail-soft from what this step
      // actually did, and written with the same progress update as the
      // step state itself — a live-detail problem can never cost the
      // run its progress write.
      const liveDetail = buildStepLiveDetail({
        toolName: step.toolName,
        params: stepParams,
        artifact: executionRecord?.artifact,
        startedAt: stepStartedAt,
        finishedAt: now(),
        failureMessage: executionRecord?.toolFailureMessage,
      });
      stepsState[index] = {
        id: `task-${index + 1}`,
        status: executionRecord?.status ?? 'failed',
        attempts: executionRecord?.attempt ?? stepsState[index].attempts,
        ...(executionRecord?.status === 'completed'
          ? { artifactRef: `task-${index + 1}`, summary: `completed:${step.toolName}` }
          : { errorCode: failureCode }),
        ...(liveDetail ? { liveDetail } : {}),
      };
      // Quota journaling (PR 1-D): a step that actually executed spent
      // its declared charge even when verification later fails (providers
      // count attempts), so the charge is written with the same progress
      // update as the step state — one write, never one without the
      // other. A step that never executed declares nothing.
      const executedCharge = stepCharge && executionRecord?.toolExecuted ? stepCharge : null;
      if (executionRecord?.toolExecuted && agentRunStepCostClass(step.toolName) === 'delegated-job') {
        delegatedThisAdvance += 1;
      }
      if (executedCharge) {
        currentLedger = addAgentRunQuotaCharge(currentLedger, executedCharge);
        sessionCharges = addAgentRunQuotaCharge(sessionCharges, executedCharge);
      }
      // Step-artifact persistence (design §4.2/§4.4): a completed
      // step whose artifact a later step consumes rides the SAME
      // fenced progress write as its step state, so a driver that
      // lost its claim persists neither. The store boundary re-checks
      // size and secret screening; the advancer pre-screens with the
      // same validation so a refused artifact — oversize, secret-like,
      // or past the run-total cap the store enforces — is simply not
      // saved (never truncated) and a later consumer degrades to
      // AGENT_STEP_INPUT_UNAVAILABLE instead of failing this step.
      const stepSucceeded = Boolean(executionRecord?.toolExecuted && executionRecord.verified
        && executionRecord.status === 'completed' && finalTask.status === 'completed');
      let artifactToSave: PutAgentRunStepArtifactInput | undefined;
      if (stepArtifactsOn && stepSucceeded && persistIndexes.has(index) && executionRecord?.artifact) {
        try {
          const candidate: PutAgentRunStepArtifactInput = {
            stepIndex: index,
            stepFingerprint: computeAgentRunStepFingerprint(step.toolName, step.params),
            attempt: stepsState[index].attempts,
            artifact: executionRecord.artifact,
          };
          validatePutAgentRunStepArtifactInput(candidate);
          artifactToSave = candidate;
        } catch {
          artifactToSave = undefined;
        }
      }
      if (!await runStore.updateProgress(record.runId, driverId, {
        stepsState,
        ...(executedCharge ? { quotaLedger: currentLedger } : {}),
        ...(artifactToSave ? { artifacts: [artifactToSave] } : {}),
      })) {
        await releaseWriteLock();
        return { kind: 'busy', record: { ...record, stepsState, status: 'running' } };
      }
      if (artifactToSave) {
        persistedRawByStep.set(index, artifactToSave.artifact);
        const savedText = textualArtifactOf(step.toolName, artifactToSave.artifact);
        if (savedText !== undefined) persistedTextualByStep.set(index, savedText);
      }
      if (!executionRecord?.toolExecuted || !executionRecord.verified || executionRecord.status !== 'completed' || finalTask.status !== 'completed') {
        // Rate-limit hold (design §2-B): an analyzer step the provider
        // rate-limited parks the run instead of failing it, when the
        // switch is on and the hold's runaway bounds allow. Every
        // other failure — and a rate limit past the bounds — fails
        // exactly as before, with the same code.
        if (rateLimitHoldOn
          && step.toolName === 'attachment_analyzer'
          && failureCode === 'PROVIDER_RATE_LIMITED'
          && executionRecord?.toolExecuted) {
          const parked = await tryParkRateLimitedStep(index, stepStateBeforeExecution, liveDetail);
          if (parked) return parked;
        }
        return failRun(failureCode);
      }
      assertCanReportCompleted({
        state: finalTask.status,
        verified: executionRecord.verified,
        toolExecuted: executionRecord.toolExecuted,
        repairAttempts: executionRecord.verificationAttempts,
      });
      saveCheckpoint({
        taskId: finalTask.id,
        executionId,
        status: executionRecord.verificationAttempts > 0 ? 'self_fixed' : 'completed',
        artifact: executionRecord.artifact,
        mutation: executionRecord.mutation,
      });
      const stepText = textualArtifactOf(step.toolName, executionRecord.artifact);
      if (stepText !== undefined) textualByStep.set(index, stepText);
      rawByStep.set(index, executionRecord.artifact);
      previousText = stepText ?? previousText;
      finalArtifact = executionRecord.artifact;
    }
  } catch (error) {
    // An exception escaping the step loop — a tool that throws
    // instead of returning ok:false (the repository writer on a
    // read-only deployment bundle is the production case, ALE
    // attempt 3) — used to collapse into a bare
    // TOOL_EXECUTION_BLOCKED with no step state written, leaving the
    // failed step looking untouched (queued, zero attempts, no
    // code). Restore the reason from the exception message when it
    // carries one (a bare code or an embedded one), and record the
    // in-flight step as failed before failing the run, so the record
    // always says which step failed and why. The progress write is
    // best-effort: the run still fails with the same code even if
    // the write cannot land.
    const message = error instanceof Error ? error.message : undefined;
    const errorCode = message !== undefined && TOOL_FAILURE_CODE_PATTERN.test(message)
      ? toolFailureCodeFromMessage(message)
      : 'TOOL_EXECUTION_BLOCKED';
    if (currentStepIndex >= 0 && stepsState[currentStepIndex]?.status !== 'completed') {
      const priorStepState = stepsState[currentStepIndex];
      stepsState[currentStepIndex] = {
        ...stepsState[currentStepIndex],
        id: `task-${currentStepIndex + 1}`,
        status: 'failed',
        errorCode,
      };
      await runStore.updateProgress(record.runId, driverId, { stepsState }).catch(() => false);
      // Rate-limit hold (design §2-B): the same parking as the step
      // loop's failure path, for a rate limit that escaped as an
      // exception instead of arriving as a tool result. A park
      // problem here degrades to the terminal failure below, never
      // to a second exception.
      if (rateLimitHoldOn
        && errorCode === 'PROVIDER_RATE_LIMITED'
        && priorStepState !== undefined
        && plan[currentStepIndex]?.toolName === 'attachment_analyzer') {
        const parked = await tryParkRateLimitedStep(currentStepIndex, priorStepState, undefined).catch(() => null);
        if (parked) return parked;
      }
    }
    return failRun(errorCode);
  }

  if (plan.some((step) => agentRunStepRequiresWriteLock(step.toolName))) {
    // The completion verification reads the whole repository, so it runs
    // under the same writer lock as the writes it verifies (design
    // §2.5) — including when the write steps themselves completed in an
    // earlier advance and only the verification remains.
    const lockAttempt = await ensureWriteLock();
    if (lockAttempt === 'unavailable') {
      return { kind: 'unavailable', record, errorCode: 'AGENT_WRITE_LOCK_UNAVAILABLE' };
    }
    if (lockAttempt === 'busy') {
      return writeLockBusyOutcome();
    }
    const completionVerification = await verifyCompletion();
    if (!completionVerification.ok) return failRun('COMPLETION_VERIFICATION_FAILED');
  }
  await releaseWriteLock();
  const finished = await runStore.finish(record.runId, driverId, 'completed');
  if (!finished) return { kind: 'progress', record: { ...record, stepsState, status: 'running' } };
  return {
    kind: 'completed',
    record: finished,
    // Delivery-only (see the outcome type): the persisted record is
    // unchanged and never gains the artifact body.
    ...(finalArtifact ? { artifact: finalArtifact } : {}),
  };
}
