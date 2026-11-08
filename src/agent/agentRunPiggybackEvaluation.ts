import {
  AGENT_RUN_APPROVAL_LAPSE_MS,
  type AgentRunHold,
  type AgentRunPlanStep,
  type AgentRunQuotaLedger,
  type AgentRunRecord,
  type AgentRunStore,
} from './agentRunRecord.js';
import {
  addAgentRunQuotaCharge,
  agentRunStepQuotaCharge,
  evaluateAgentRunQuotaCharge,
  snapshotAgentRunQuotaUsage,
  type AgentRunQuotaUsageSnapshot,
} from './agentRunQuotaGate.js';
import { diffAgentRunPlans, type AgentRunPlanStepInput } from './agentRunPlanDiff.js';

/**
 * Piggyback evaluation of held runs (multitask Phase 1, PR 1-G; design
 * §2.3 driver 2, §8.5, §8.6, §8.10 Phase 1).
 *
 * There is no resident process and no cron in this deployment, so held
 * runs are re-examined on the back of ordinary agent API traffic: the
 * owner-scoped run reads (`GET /runs`, `GET /runs/:id`) run this
 * evaluation for the requesting owner before answering. That is the
 * moment the owner is looking at their tasks — the design's "next time
 * ORIGIN is opened" point — and the response itself reflects whatever
 * the evaluation changed. Evaluation is best-effort: a failure here must
 * never break the read it rides on, and it changes nothing about the
 * safety posture:
 *
 * - The §8 invariant is absolute: approval never crosses a hold. The
 *   most this evaluator ever does is move a held run whose resume
 *   condition is met into `awaiting_approval` — the state where a fresh
 *   plan capability can be issued and a human can approve. It never
 *   queues, never claims, never executes. Execution restarts only
 *   through the 1-C resume/confirm flow with a new approval.
 * - Auto-advance is deliberately narrower than manual resume: it fires
 *   only when the re-plan is byte-identical to the stored plan (same
 *   digest, empty diff), so what the human is asked to approve is
 *   exactly the plan they saw when the run was held. A changed plan
 *   stays held; the manual resume flow presents the diff first
 *   (design §8.4). Goal-only holds (no stored plan) likewise stay held:
 *   their first plan is presented by the manual resume, not pre-stored
 *   by an automatic pass.
 * - `at_time` is judged by the clock. `quota_reset` is judged by the
 *   real ledger state through the 1-D gate, never by the estimated
 *   reset instant alone (design §8.5: the estimate is a guide, the
 *   final judgment is the actual remaining quota — an optimistic
 *   estimate can only cause a re-hold, never an overrun).
 * - `manual`, `dependency` and `condition` conditions are not evaluated
 *   here. `manual` is human-only by definition; `dependency` and
 *   `condition` have no evaluation material in Phase 1 (the design
 *   assigns dependency triggers to the Phase 2 server driver, §8.10,
 *   and external conditions to Phase 3 monitoring, §7.2).
 * - Attempt cap (design §8.6): a hold whose resumeAttempts reached
 *   AGENT_RUN_MAX_AUTO_RESUME_ATTEMPTS is out of automatic evaluation
 *   and waits for a human decision. The count accumulates across hold
 *   episodes via the record's carried count: every fall back to `held`
 *   after a resume (quota re-hold in the advancer, approval-timeout
 *   conversion below) increments it, so three consecutive failed
 *   resumes end automatic retries instead of looping forever.
 * - Approval-timeout conversion (design §8.3 entry 3): an
 *   `awaiting_approval` run past its stored approval deadline becomes
 *   `held` (reason `awaiting_approval`, manual resume) instead of
 *   silently occupying the approval queue forever. The new hold is a
 *   manual one, so a converted run is never auto-advanced in a later
 *   pass — the loop terminates by construction.
 */

/** Design §8.6: consecutive failed resumes before automation steps back. */
export const AGENT_RUN_MAX_AUTO_RESUME_ATTEMPTS = 3;

/** The current planner's output for a goal, in the resume flow's shapes. */
export interface AgentRunReplannedGoal {
  steps: readonly AgentRunPlanStepInput[];
  plan: AgentRunPlanStep[];
  planDigest: string;
}

/**
 * Re-planning is the orchestrator's planner plumbing (the same helpers
 * the manual resume endpoint uses, so both paths produce byte-identical
 * steps and digests for the same goal). Injected so this module stays
 * free of the HTTP layer.
 */
export interface AgentRunReplanPort {
  /** Returns null when the goal can no longer be planned at all. */
  replan(goal: string): AgentRunReplannedGoal | null;
}

export interface AgentRunPiggybackDeps {
  runStore: AgentRunStore;
  replan: AgentRunReplanPort;
  /**
   * Approval window granted to an auto-advanced run (deadline stored on
   * the record). Defaults to AGENT_RUN_APPROVAL_LAPSE_MS, the capability
   * TTL sum the resume flow works with.
   */
  approvalWindowMs?: number;
}

export interface AgentRunPiggybackSummary {
  evaluatedAt: number;
  /** Held runs moved to `awaiting_approval` (condition met, plan unchanged). */
  advanced: string[];
  /** `awaiting_approval` runs converted to `held` after their approval lapsed. */
  approvalTimeouts: string[];
  /** Held runs skipped: the §8.6 attempt cap leaves them to a human. */
  capped: string[];
  /** Held runs whose at_time / quota_reset condition is not met yet. */
  notReady: string[];
  /** Held runs whose re-plan differs from the stored plan (manual resume shows the diff). */
  planChanged: string[];
  /** Goal-only held runs with no stored plan (manual resume plans them). */
  unplanned: string[];
  /** Held runs whose goal the current planner can no longer plan. */
  plannerFailed: string[];
  /** Runs a concurrent transition won first; evaluation lost the race honestly. */
  contended: string[];
  /** Held runs whose condition kind this evaluator does not judge (manual/dependency/condition). */
  skippedCondition: string[];
  /** Runs whose evaluation raised; isolated per run, never fatal to the pass. */
  errors: string[];
}

/**
 * Whether every not-yet-finished step's declared quota charge fits the
 * provider's confirmed window, simulating the advancer's own gating
 * (window snapshot plus the charges earlier pending steps of this same
 * run would journal first). Steps without a charge never block.
 */
function quotaConditionMet(record: AgentRunRecord, snapshot: AgentRunQuotaUsageSnapshot, now: number): boolean {
  if (!record.plan) return true;
  let sessionCharges: AgentRunQuotaLedger = {};
  for (let index = 0; index < record.plan.length; index += 1) {
    const state = record.stepsState[index];
    if (state && (state.status === 'completed' || state.status === 'failed')) continue;
    const charge = agentRunStepQuotaCharge(record.plan[index].toolName);
    if (!charge) continue;
    const decision = evaluateAgentRunQuotaCharge({ charge, snapshot, sessionCharges, now });
    if (!decision.allowed) return false;
    sessionCharges = addAgentRunQuotaCharge(sessionCharges, charge);
  }
  return true;
}

async function convertApprovalTimeout(
  deps: AgentRunPiggybackDeps,
  record: AgentRunRecord,
  ownerBinding: string,
  now: number,
  summary: AgentRunPiggybackSummary,
): Promise<void> {
  const hold: AgentRunHold = {
    reason: 'awaiting_approval',
    resumeCondition: { kind: 'manual' },
    heldSince: now,
    resumeAttempts: record.priorResumeAttempts === null ? 0 : record.priorResumeAttempts + 1,
  };
  const converted = await deps.runStore.transition({
    runId: record.runId,
    ownerBinding,
    expectedStatus: 'awaiting_approval',
    expectedVersion: record.version,
    nextStatus: 'held',
    hold,
  }).catch(() => null);
  if (converted) summary.approvalTimeouts.push(record.runId);
  else summary.contended.push(record.runId);
}

async function evaluateHeldRun(
  deps: AgentRunPiggybackDeps,
  record: AgentRunRecord,
  quotaSnapshot: AgentRunQuotaUsageSnapshot,
  ownerBinding: string,
  now: number,
  summary: AgentRunPiggybackSummary,
): Promise<void> {
  const hold = record.hold;
  if (!hold) return;
  if (hold.resumeAttempts >= AGENT_RUN_MAX_AUTO_RESUME_ATTEMPTS) {
    summary.capped.push(record.runId);
    return;
  }
  const condition = hold.resumeCondition;
  if (condition.kind === 'manual' || condition.kind === 'dependency' || condition.kind === 'condition') {
    summary.skippedCondition.push(record.runId);
    return;
  }
  if (condition.kind === 'at_time' && now < condition.at) {
    summary.notReady.push(record.runId);
    return;
  }
  if (condition.kind === 'quota_reset' && !quotaConditionMet(record, quotaSnapshot, now)) {
    summary.notReady.push(record.runId);
    return;
  }
  // The condition is met. From here the only automatic move §8 allows is
  // into `awaiting_approval`, and only for a plan the human has already
  // seen: the re-plan must be identical to the stored snapshot.
  if (!record.plan || !record.planDigest) {
    summary.unplanned.push(record.runId);
    return;
  }
  const replanned = deps.replan.replan(record.goal.trim());
  if (!replanned) {
    summary.plannerFailed.push(record.runId);
    return;
  }
  const planDiff = diffAgentRunPlans(record.plan, replanned.steps);
  if (planDiff.changed || replanned.planDigest !== record.planDigest) {
    summary.planChanged.push(record.runId);
    return;
  }
  const advanced = await deps.runStore.transition({
    runId: record.runId,
    ownerBinding,
    expectedStatus: 'held',
    expectedVersion: record.version,
    nextStatus: 'awaiting_approval',
    plan: replanned.plan,
    planDigest: replanned.planDigest,
    approvalDeadlineAt: now + (deps.approvalWindowMs ?? AGENT_RUN_APPROVAL_LAPSE_MS),
  }).catch(() => null);
  if (advanced) summary.advanced.push(record.runId);
  else summary.contended.push(record.runId);
}

/**
 * One best-effort evaluation pass over one owner's live runs, in the
 * store's priority order (design §8.9: quota recovery processes holds
 * in priority order). Per-run failures are isolated into the summary;
 * the pass itself only rejects when the owner's run list cannot be
 * read at all, which callers treat as "no evaluation happened".
 */
export async function evaluateAgentRunPiggyback(
  deps: AgentRunPiggybackDeps,
  ownerBinding: string,
  now: number,
): Promise<AgentRunPiggybackSummary> {
  const summary: AgentRunPiggybackSummary = {
    evaluatedAt: now,
    advanced: [],
    approvalTimeouts: [],
    capped: [],
    notReady: [],
    planChanged: [],
    unplanned: [],
    plannerFailed: [],
    contended: [],
    skippedCondition: [],
    errors: [],
  };
  const records = await deps.runStore.listByOwner(ownerBinding, { limit: 100 });
  // One quota snapshot serves every quota_reset judgment in the pass
  // (the same ledger attribution the 1-D gate applies at advance time).
  const quotaSnapshot = snapshotAgentRunQuotaUsage(records, now);
  for (const record of records) {
    try {
      if (record.status === 'awaiting_approval') {
        if (record.approvalDeadlineAt !== null && now > record.approvalDeadlineAt) {
          await convertApprovalTimeout(deps, record, ownerBinding, now, summary);
        }
      } else if (record.status === 'held') {
        await evaluateHeldRun(deps, record, quotaSnapshot, ownerBinding, now, summary);
      }
    } catch {
      summary.errors.push(record.runId);
    }
  }
  return summary;
}
