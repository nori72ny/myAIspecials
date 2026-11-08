import { randomUUID } from 'node:crypto';
import { executeToolWithPermission, type ToolExecutionContext, type ToolName, type ToolParams, type ToolResult } from './toolRegistry.js';
import { verifyAndSelfFixArtifact } from './autoVerificationEngine.js';
import { verifyBeforeReportingCompletion } from './completionVerificationGate.js';
import { saveCheckpoint } from './checkpointManager.js';
import { assertCanReportCompleted } from './taskExecutionGate.js';
import { createAgentTaskGraph, type AgentTaskGraph } from './agentTaskGraph.js';
import { executeNextTask } from './taskGraphExecutor.js';
import type { AgentRunQuotaLedger, AgentRunRecord, AgentRunStepState, AgentRunStore } from './agentRunRecord.js';
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
import type { AgentRunConsumptionStore } from './agentOrchestratorV3.js';

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
 * - A held record is never advanced: resuming always re-enters
 *   `awaiting_approval` first (design §8), which is a later phase's flow.
 * - Chunk boundaries fall between steps, never inside one, and never
 *   between a step and the step that consumes its textual artifact.
 */

export const AGENT_RUN_ADVANCE_DEFAULT_BUDGET_MS = 100_000;
export const AGENT_RUN_ADVANCE_DEFAULT_LEASE_SECONDS = 120;

const EXECUTION_RESERVED_PROVIDER = 'origin';
const EXECUTION_RESERVED_COUNTER = 'execution_reserved';
const createExecutionId = () => `exec-${Date.now()}-${randomUUID().slice(0, 8)}`;

/** Resolves the cross-step dataflow marker at execution time. The approval
 * binding covers the planned params (marker included); resolution is a
 * deterministic local substitution of the previous step's textual artifact. */
export function resolveStepParams(step: { params: ToolParams }, previousText: string | undefined): { params: ToolParams } | { error: string } {
  if (step.params.contentFromPreviousArtifact !== true) return { params: step.params };
  if (previousText === undefined) return { error: 'AGENT_STEP_INPUT_UNAVAILABLE' };
  const { contentFromPreviousArtifact: _marker, ...rest } = step.params;
  return { params: { ...rest, content: previousText } };
}

export function textualArtifactOf(toolName: ToolName, artifact: string): string | undefined {
  if (toolName === 'file_reader') return artifact;
  if (toolName === 'document_generator') {
    try {
      const parsed = JSON.parse(artifact) as { content?: unknown };
      return typeof parsed.content === 'string' ? parsed.content : undefined;
    } catch { return undefined; }
  }
  return undefined;
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
  toolContext?: ToolExecutionContext;
  runTool?: AgentRunToolRunner;
  verifyArtifact?: AgentRunArtifactVerifier;
  verifyCompletion?: () => Promise<{ ok: boolean }>;
  now?: () => number;
}

export type AdvanceAgentRunOutcome =
  | { kind: 'completed'; record: AgentRunRecord }
  | { kind: 'failed'; record: AgentRunRecord; errorCode: string }
  | { kind: 'held'; record: AgentRunRecord; provider: string; resetAt: number }
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
    ?? ((name, input) => executeToolWithPermission(name, input, executionApproval, deps.toolContext));
  const verifyArtifact: AgentRunArtifactVerifier = deps.verifyArtifact
    ?? ((artifact, toolName, runner, params) => verifyAndSelfFixArtifact(artifact, toolName, runner, params));
  const verifyCompletion = deps.verifyCompletion ?? (() => verifyBeforeReportingCompletion(process.cwd()));

  const failRun = async (errorCode: string): Promise<AdvanceAgentRunOutcome> => {
    const finished = await runStore.finish(record.runId, driverId, 'failed');
    return { kind: 'failed', record: finished ?? { ...record, stepsState, status: 'failed' }, errorCode };
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
      consumed = await consumptionStore.consume(record.runId, record.expiresAt);
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
  const startIndex = stepsState.findIndex((step) => step.status !== 'completed');

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
    (step) => agentRunStepQuotaCharge(step.toolName) !== null
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

  try {
    for (let index = startIndex; index >= 0 && index < plan.length; index += 1) {
      const step = plan[index];
      const elapsed = now() - startedAt;
      if (index > startIndex) {
        // Chunk boundary: stop between steps when the budget is spent, but
        // never between a step and the step consuming its artifact.
        const consumesPreviousArtifact = step.params.contentFromPreviousArtifact === true && previousText !== undefined;
        if (elapsed > budgetMs && !consumesPreviousArtifact) {
          return { kind: 'progress', record: { ...record, stepsState, status: 'running' } };
        }
        if (elapsed > leaseSeconds * 750) {
          if (!await runStore.renewLease(record.runId, driverId, leaseSeconds)) {
            return { kind: 'progress', record: { ...record, stepsState, status: 'running' } };
          }
        }
      }
      // Quota gate (PR 1-D): a step that declares a charge may only run
      // while the charge fits the provider's confirmed window limit;
      // delegated jobs are serialized to one per advance (their internal
      // consumption is unmeasured — see agentRunQuotaGate.ts). A blocked
      // step is never executed: the run is parked as held at this step
      // boundary with its progress intact (design §8.3 entry 4, §9.4).
      const stepCharge = agentRunStepQuotaCharge(step.toolName);
      if (agentRunStepCostClass(step.toolName) === 'delegated-job'
        && delegatedThisAdvance >= AGENT_RUN_MAX_DELEGATED_STEPS_PER_ADVANCE) {
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
          const hold = agentRunQuotaHold(decision, now());
          const finished = await runStore.finish(record.runId, driverId, 'held', hold);
          return {
            kind: 'held',
            record: finished ?? { ...record, stepsState, status: 'held', hold },
            provider: decision.provider,
            resetAt: decision.resetAt,
          };
        }
      }
      const resolved = resolveStepParams(step, previousText);
      const stepParams = 'params' in resolved ? resolved.params : step.params;
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
          : 'ARTIFACT_VERIFICATION_FAILED';
      stepsState[index] = {
        id: `task-${index + 1}`,
        status: executionRecord?.status ?? 'failed',
        attempts: executionRecord?.attempt ?? stepsState[index].attempts,
        ...(executionRecord?.status === 'completed'
          ? { artifactRef: `task-${index + 1}`, summary: `completed:${step.toolName}` }
          : { errorCode: failureCode }),
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
      if (!await runStore.updateProgress(record.runId, driverId, {
        stepsState,
        ...(executedCharge ? { quotaLedger: currentLedger } : {}),
      })) {
        return { kind: 'busy', record: { ...record, stepsState, status: 'running' } };
      }
      if (!executionRecord?.toolExecuted || !executionRecord.verified || executionRecord.status !== 'completed' || finalTask.status !== 'completed') {
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
      previousText = textualArtifactOf(step.toolName, executionRecord.artifact) ?? previousText;
    }
  } catch {
    return failRun('TOOL_EXECUTION_BLOCKED');
  }

  if (plan.some((step) => step.toolName === 'file_writer')) {
    const completionVerification = await verifyCompletion();
    if (!completionVerification.ok) return failRun('COMPLETION_VERIFICATION_FAILED');
  }
  const finished = await runStore.finish(record.runId, driverId, 'completed');
  if (!finished) return { kind: 'progress', record: { ...record, stepsState, status: 'running' } };
  return { kind: 'completed', record: finished };
}
