import type { HeldOutCodingScoreV14, HeldOutCodingTaskV14 } from './heldOutCodingBenchmarkV14.js';

export const HELD_OUT_FINAL_QUALIFICATION_VERSION_V14 = 'origin-held-out-final-qualification-v1' as const;
export const HELD_OUT_FINAL_MIN_TASKS_V14 = 6 as const;
export const HELD_OUT_FINAL_MAX_TASKS_V14 = 16 as const;
export const HELD_OUT_FINAL_MIN_RECOVERY_TASKS_V14 = 2 as const;

export const HELD_OUT_FINAL_REQUIRED_COVERAGE_KEYS_V14 = [
  'navigationMultiFile',
  'featureWithNewFile',
  'regressionRecovery',
  'buildOrTypecheckRepair',
  'securityPathBoundary',
] as const;

export type HeldOutFinalCoverageKeyV14 = (typeof HELD_OUT_FINAL_REQUIRED_COVERAGE_KEYS_V14)[number];
export type HeldOutFinalCoverageV14 = Record<HeldOutFinalCoverageKeyV14, boolean>;

export type HeldOutFinalCorpusV14 = {
  qualification: typeof HELD_OUT_FINAL_QUALIFICATION_VERSION_V14;
  /** Opaque public identifier. Never contains task text or hidden-test details. */
  corpusId: string;
  /** SHA-256 of the canonical private corpus payload. */
  corpusDigest: string;
  /** Exact repository revision used by every task in the final corpus. */
  frozenBaseSha: string;
  /** High-level coverage claims emitted by the trusted private-corpus builder. */
  coverage: HeldOutFinalCoverageV14;
  /** Public task projections only; no private prompt, solution, patch, or hidden test source. */
  tasks: HeldOutCodingTaskV14[];
};

export type HeldOutFinalRunProvenanceV14 = {
  /** Final qualification is one-shot. A second run is audit evidence, not unseen evidence. */
  runOrdinal: number;
  /** Must remain false until the one-shot run has completed. */
  engineeringObservedBeforeRun: boolean;
  /** Must remain false after the corpus is frozen and before the one-shot run completes. */
  taskSpecificTuningAfterFreeze: boolean;
  /** Digests of any corpora already observed during engineering/pilot work. */
  priorObservedCorpusDigests: string[];
  /** Public task digests already observed during engineering/pilot work. */
  priorObservedTaskDigests?: string[];
};

export type HeldOutFinalQualificationV14 = {
  eligible: boolean;
  reasons: string[];
  taskCount: number;
  recoveryTaskCount: number;
  frozenBaseSha: string;
  timeBudgetMs: number | null;
  coverage: HeldOutFinalCoverageV14;
};

export type HeldOutFinalEvidenceV14 = HeldOutFinalQualificationV14 & {
  attempted: number;
  solved: number;
  solveRate: number;
  totalCostUsd: number;
  participant: string | null;
  allAxesPassing: number;
};

function validSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function validGitSha(value: string): boolean {
  return /^[a-f0-9]{40}$/i.test(value);
}

function unique(values: string[]): boolean {
  return values.length === new Set(values).size;
}

function safeOpaqueId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,120}$/.test(value);
}

function blankCoverage(): HeldOutFinalCoverageV14 {
  return {
    navigationMultiFile: false,
    featureWithNewFile: false,
    regressionRecovery: false,
    buildOrTypecheckRepair: false,
    securityPathBoundary: false,
  };
}

function normalizedCoverage(value: unknown): HeldOutFinalCoverageV14 {
  if (!value || typeof value !== 'object') return blankCoverage();
  const row = value as Partial<HeldOutFinalCoverageV14>;
  return {
    navigationMultiFile: row.navigationMultiFile === true,
    featureWithNewFile: row.featureWithNewFile === true,
    regressionRecovery: row.regressionRecovery === true,
    buildOrTypecheckRepair: row.buildOrTypecheckRepair === true,
    securityPathBoundary: row.securityPathBoundary === true,
  };
}

function basicTaskShapeValid(task: HeldOutCodingTaskV14): boolean {
  return Boolean(task)
    && safeOpaqueId(task.id)
    && validSha256(task.taskDigest)
    && validGitSha(task.baseSha)
    && Number.isInteger(task.timeBudgetMs)
    && task.timeBudgetMs >= 1_000
    && task.timeBudgetMs <= 60 * 60 * 1_000
    && Array.isArray(task.requiredChangedPaths)
    && task.requiredChangedPaths.length >= 2
    && task.requiredChangedPaths.length === new Set(task.requiredChangedPaths).size
    && Array.isArray(task.protectedPaths)
    && task.protectedPaths.length === new Set(task.protectedPaths).size
    && task.requiredChangedPaths.every(path => typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.includes('..'))
    && task.protectedPaths.every(path => typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.includes('..'))
    && task.requiredChangedPaths.every(path => !task.protectedPaths.includes(path));
}

/**
 * Determines whether a frozen private corpus is eligible to become ORIGIN's final
 * unseen V1.4 evidence. This function intentionally never sees prompts, hidden
 * tests, expected solutions, or reference patches.
 */
export function qualifyHeldOutFinalCorpusV14(
  corpus: HeldOutFinalCorpusV14,
  provenance: HeldOutFinalRunProvenanceV14,
): HeldOutFinalQualificationV14 {
  const reasons: string[] = [];
  const coverage = normalizedCoverage(corpus?.coverage);
  const tasks = Array.isArray(corpus?.tasks) ? corpus.tasks : [];

  if (!corpus || corpus.qualification !== HELD_OUT_FINAL_QUALIFICATION_VERSION_V14) reasons.push('qualification-version-invalid');
  if (!safeOpaqueId(corpus?.corpusId ?? '')) reasons.push('corpus-id-invalid');
  if (!validSha256(corpus?.corpusDigest ?? '')) reasons.push('corpus-digest-invalid');
  if (!validGitSha(corpus?.frozenBaseSha ?? '')) reasons.push('frozen-base-sha-invalid');
  if (tasks.length < HELD_OUT_FINAL_MIN_TASKS_V14 || tasks.length > HELD_OUT_FINAL_MAX_TASKS_V14) reasons.push('task-count-out-of-range');
  if (tasks.some(task => !basicTaskShapeValid(task))) reasons.push('task-contract-invalid');

  const ids = tasks.map(task => task.id);
  const digests = tasks.map(task => task.taskDigest.toLowerCase());
  if (!unique(ids)) reasons.push('task-id-duplicate');
  if (!unique(digests)) reasons.push('task-digest-duplicate');

  if (validGitSha(corpus?.frozenBaseSha ?? '') && tasks.some(task => task.baseSha.toLowerCase() !== corpus.frozenBaseSha.toLowerCase())) {
    reasons.push('base-sha-not-uniform');
  }

  const budgets = [...new Set(tasks.map(task => task.timeBudgetMs))];
  if (budgets.length !== 1) reasons.push('time-budget-not-uniform');

  const recoveryTaskCount = tasks.filter(task => task.recoveryRequired === true).length;
  if (recoveryTaskCount < HELD_OUT_FINAL_MIN_RECOVERY_TASKS_V14) reasons.push('recovery-coverage-insufficient');
  for (const key of HELD_OUT_FINAL_REQUIRED_COVERAGE_KEYS_V14) {
    if (coverage[key] !== true) reasons.push(`coverage-missing:${key}`);
  }

  const observedCorpora = Array.isArray(provenance?.priorObservedCorpusDigests)
    ? provenance.priorObservedCorpusDigests.map(value => String(value).toLowerCase())
    : [];
  if (!observedCorpora.every(validSha256)) reasons.push('prior-observed-digest-invalid');
  if (validSha256(corpus?.corpusDigest ?? '') && observedCorpora.includes(corpus.corpusDigest.toLowerCase())) reasons.push('corpus-already-observed');

  const observedTasks = Array.isArray(provenance?.priorObservedTaskDigests)
    ? provenance.priorObservedTaskDigests.map(value => String(value).toLowerCase())
    : [];
  if (!observedTasks.every(validSha256)) reasons.push('prior-observed-task-digest-invalid');
  if (digests.some(digest => observedTasks.includes(digest))) reasons.push('task-already-observed');

  if (provenance?.runOrdinal !== 1) reasons.push('final-run-not-one-shot');
  if (provenance?.engineeringObservedBeforeRun !== false) reasons.push('engineering-observed-before-run');
  if (provenance?.taskSpecificTuningAfterFreeze !== false) reasons.push('task-specific-tuning-after-freeze');

  return {
    eligible: reasons.length === 0,
    reasons,
    taskCount: tasks.length,
    recoveryTaskCount,
    frozenBaseSha: corpus?.frozenBaseSha ?? '',
    timeBudgetMs: budgets.length === 1 ? budgets[0] : null,
    coverage,
  };
}

/**
 * Produces public final-run evidence without creating a performance threshold or
 * winner. The evidence states what happened; any comparison must use the same
 * frozen corpus, base SHA, budgets, evaluator, and one-shot conditions.
 */
export function summarizeHeldOutFinalEvidenceV14(
  corpus: HeldOutFinalCorpusV14,
  provenance: HeldOutFinalRunProvenanceV14,
  scores: HeldOutCodingScoreV14[],
): HeldOutFinalEvidenceV14 {
  const qualification = qualifyHeldOutFinalCorpusV14(corpus, provenance);
  const rows = Array.isArray(scores) ? scores : [];
  const expectedTaskIds = new Set(corpus.tasks.map(task => task.id));
  const scoreTaskIds = rows.map(score => score.taskId);
  const exactTaskSet = rows.length === corpus.tasks.length
    && unique(scoreTaskIds)
    && scoreTaskIds.every(id => expectedTaskIds.has(id));
  const participants = [...new Set(rows.map(score => score.participant).filter(Boolean))];
  const zeroCost = rows.every(score => score.costUsd === 0);
  const evidenceReasons = [...qualification.reasons];
  if (!exactTaskSet) evidenceReasons.push('score-task-set-mismatch');
  if (participants.length !== 1) evidenceReasons.push('participant-not-uniform');
  if (!zeroCost) evidenceReasons.push('non-zero-cost-observed');

  const eligible = evidenceReasons.length === 0;
  const solved = rows.filter(score => score.solved).length;
  const allAxesPassing = rows.filter(score => Object.values(score.axes).every(Boolean)).length;
  return {
    ...qualification,
    eligible,
    reasons: evidenceReasons,
    attempted: rows.length,
    solved,
    solveRate: rows.length > 0 ? solved / rows.length : 0,
    totalCostUsd: rows.reduce((sum, score) => sum + score.costUsd, 0),
    participant: participants.length === 1 ? participants[0] : null,
    allAxesPassing,
  };
}
