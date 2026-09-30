import {
  HELD_OUT_CODING_COMPARISON_VERSION_V14,
  evaluateHeldOutCodingComparisonV14,
  type HeldOutCodingComparisonReportV14,
  type HeldOutCodingReferenceSummaryV14,
} from './heldOutCodingComparisonV14.js';
import type {
  HeldOutCodingRunV14,
  HeldOutCodingTaskV14,
} from './heldOutCodingBenchmarkV14.js';

export const HELD_OUT_CODING_TRUSTED_COMPARISON_VERSION_V14 =
  'origin-held-out-coding-trusted-comparison-v1' as const;

const SHA40 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/;
const SAFE_REGRESSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const MAX_EVIDENCE_LIFETIME_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type HeldOutCodingTrustedReferenceTaskV14 = {
  taskId: string;
  taskDigest: string;
  durationMs: number;
  axes: {
    heldOutIdentity: boolean;
    multiFileEditing: boolean;
    verification: boolean;
    failureRecovery: boolean;
  };
  regressions: readonly string[];
  unsafeSideEffects: number;
};

export type HeldOutCodingTrustedReferenceV14 = {
  source: 'controlled-external';
  independentFromCandidate: true;
  participant: string;
  baseSha: string;
  evaluatorVersion: string;
  timeBudgetMs: number;
  evidenceId: string;
  artifactDigest: string;
  createdAt: string;
  expiresAt: string;
  tasks: readonly HeldOutCodingTrustedReferenceTaskV14[];
};

export type HeldOutCodingTrustedComparisonInputV14 = {
  version: typeof HELD_OUT_CODING_TRUSTED_COMPARISON_VERSION_V14;
  candidateSha: string;
  evaluatorVersion: string;
  tasks: readonly HeldOutCodingTaskV14[];
  candidateRuns: readonly HeldOutCodingRunV14[];
  references: readonly HeldOutCodingTrustedReferenceV14[];
};

export type HeldOutCodingTrustedComparisonReportV14 = {
  version: typeof HELD_OUT_CODING_TRUSTED_COMPARISON_VERSION_V14;
  candidateSha: string;
  trustedReferenceEvidencePassed: boolean;
  comparison: HeldOutCodingComparisonReportV14 | null;
  passed: boolean;
  blockers: readonly string[];
};

function validWindow(createdAtValue: string, expiresAtValue: string, nowMs: number): boolean {
  const createdAt = Date.parse(createdAtValue);
  const expiresAt = Date.parse(expiresAtValue);
  return Number.isFinite(createdAt)
    && Number.isFinite(expiresAt)
    && createdAt <= nowMs + MAX_CLOCK_SKEW_MS
    && expiresAt > nowMs
    && expiresAt >= createdAt
    && expiresAt - createdAt <= MAX_EVIDENCE_LIFETIME_MS;
}

function validReferenceEnvelope(
  reference: HeldOutCodingTrustedReferenceV14,
  candidateSha: string,
  evaluatorVersion: string,
  commonBudget: number,
  nowMs: number,
): boolean {
  return Boolean(
    reference?.source === 'controlled-external'
    && reference.independentFromCandidate === true
    && SAFE_ID.test(reference.participant)
    && SHA40.test(reference.baseSha)
    && reference.baseSha.toLowerCase() === candidateSha.toLowerCase()
    && SAFE_ID.test(reference.evaluatorVersion)
    && reference.evaluatorVersion === evaluatorVersion
    && Number.isInteger(reference.timeBudgetMs)
    && reference.timeBudgetMs === commonBudget
    && SAFE_ID.test(reference.evidenceId)
    && /^sha256:[a-f0-9]{64}$/.test(reference.artifactDigest)
    && validWindow(reference.createdAt, reference.expiresAt, nowMs)
    && Array.isArray(reference.tasks)
  );
}

function deriveReferenceSummary(
  reference: HeldOutCodingTrustedReferenceV14,
  tasks: readonly HeldOutCodingTaskV14[],
): HeldOutCodingReferenceSummaryV14 | null {
  const expected = new Map(tasks.map(task => [task.id, task]));
  const seen = new Set<string>();
  let solved = 0;
  let regressions = 0;
  let unsafeSideEffects = 0;
  let recoveryTasksSolved = 0;

  if (reference.tasks.length !== tasks.length) return null;

  for (const row of reference.tasks) {
    const task = expected.get(row?.taskId);
    if (
      !task
      || seen.has(row.taskId)
      || !SHA256.test(row.taskDigest)
      || row.taskDigest.toLowerCase() !== task.taskDigest.toLowerCase()
      || !Number.isFinite(row.durationMs)
      || row.durationMs < 0
      || row.durationMs > task.timeBudgetMs
      || typeof row.axes?.heldOutIdentity !== 'boolean'
      || typeof row.axes?.multiFileEditing !== 'boolean'
      || typeof row.axes?.verification !== 'boolean'
      || typeof row.axes?.failureRecovery !== 'boolean'
      || !Array.isArray(row.regressions)
      || row.regressions.length > 32
      || row.regressions.some(code => typeof code !== 'string' || !SAFE_REGRESSION.test(code))
      || new Set(row.regressions).size !== row.regressions.length
      || !Number.isInteger(row.unsafeSideEffects)
      || row.unsafeSideEffects < 0
      || row.unsafeSideEffects > 100
    ) {
      return null;
    }

    const failedAxes = Object.values(row.axes).filter(value => value !== true).length;
    if (row.regressions.length < failedAxes) return null;
    if (task.recoveryRequired && row.axes.failureRecovery !== true && row.regressions.length === 0) return null;

    const taskSolved = Object.values(row.axes).every(Boolean)
      && row.regressions.length === 0
      && row.unsafeSideEffects === 0;

    if (taskSolved) solved += 1;
    if (task.recoveryRequired && taskSolved && row.axes.failureRecovery) recoveryTasksSolved += 1;
    regressions += row.regressions.length;
    unsafeSideEffects += row.unsafeSideEffects;
    seen.add(row.taskId);
  }

  if (seen.size !== tasks.length) return null;

  return {
    participant: reference.participant,
    baseSha: reference.baseSha,
    evaluatorVersion: reference.evaluatorVersion,
    timeBudgetMs: reference.timeBudgetMs,
    attempted: tasks.length,
    solved,
    regressions,
    recoveryTasksAttempted: tasks.filter(task => task.recoveryRequired).length,
    recoveryTasksSolved,
    unsafeSideEffects,
  };
}

export function evaluateHeldOutCodingTrustedComparisonV14(
  input: HeldOutCodingTrustedComparisonInputV14,
  nowMs: number = Date.now(),
): HeldOutCodingTrustedComparisonReportV14 {
  const blockers: string[] = [];
  const candidateSha = typeof input?.candidateSha === 'string' ? input.candidateSha.toLowerCase() : '';
  const commonBudget = input.tasks?.[0]?.timeBudgetMs ?? 0;

  if (
    input?.version !== HELD_OUT_CODING_TRUSTED_COMPARISON_VERSION_V14
    || !SHA40.test(candidateSha)
    || !SAFE_ID.test(input.evaluatorVersion)
  ) {
    blockers.push('CODING_TRUSTED_COMPARISON_INPUT_INVALID');
  }

  const references = Array.isArray(input?.references) ? input.references : [];
  if (references.length < 2) blockers.push('CODING_TRUSTED_REFERENCE_SYSTEMS_LT_2');

  const participantIds = references.map(reference =>
    typeof reference?.participant === 'string' ? reference.participant.trim().toLowerCase() : '');
  if (new Set(participantIds).size !== references.length || participantIds.some(id => !id)) {
    blockers.push('CODING_TRUSTED_REFERENCE_PARTICIPANTS_INVALID');
  }

  const summaries: HeldOutCodingReferenceSummaryV14[] = [];
  let trustedReferenceEvidencePassed = references.length >= 2;

  for (const reference of references) {
    if (!validReferenceEnvelope(reference, candidateSha, input.evaluatorVersion, commonBudget, nowMs)) {
      trustedReferenceEvidencePassed = false;
      continue;
    }
    const summary = deriveReferenceSummary(reference, input.tasks);
    if (!summary) {
      trustedReferenceEvidencePassed = false;
      continue;
    }
    summaries.push(summary);
  }

  if (summaries.length !== references.length) trustedReferenceEvidencePassed = false;
  if (!trustedReferenceEvidencePassed) blockers.push('CODING_TRUSTED_REFERENCE_EVIDENCE_INVALID');

  let comparison: HeldOutCodingComparisonReportV14 | null = null;
  if (trustedReferenceEvidencePassed) {
    comparison = evaluateHeldOutCodingComparisonV14({
      version: HELD_OUT_CODING_COMPARISON_VERSION_V14,
      candidateSha: input.candidateSha,
      evaluatorVersion: input.evaluatorVersion,
      tasks: input.tasks,
      candidateRuns: input.candidateRuns,
      references: summaries,
    });
    blockers.push(...comparison.blockers);
  }

  const unique = [...new Set(blockers)];
  return {
    version: HELD_OUT_CODING_TRUSTED_COMPARISON_VERSION_V14,
    candidateSha: input.candidateSha,
    trustedReferenceEvidencePassed,
    comparison,
    passed: trustedReferenceEvidencePassed && comparison?.passed === true && unique.length === 0,
    blockers: unique,
  };
}
