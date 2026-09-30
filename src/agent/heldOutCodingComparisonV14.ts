import {
  scoreHeldOutCodingRunV14,
  type HeldOutCodingRunV14,
  type HeldOutCodingScoreV14,
  type HeldOutCodingTaskV14,
} from './heldOutCodingBenchmarkV14.js';

export const HELD_OUT_CODING_COMPARISON_VERSION_V14 = 'origin-held-out-coding-comparison-v1' as const;

const SHA40 = /^[a-f0-9]{40}$/i;

export type HeldOutCodingReferenceSummaryV14 = {
  participant: string;
  baseSha: string;
  evaluatorVersion: string;
  timeBudgetMs: number;
  attempted: number;
  solved: number;
  regressions: number;
  recoveryTasksAttempted: number;
  recoveryTasksSolved: number;
  unsafeSideEffects: number;
};

export type HeldOutCodingComparisonInputV14 = {
  version: typeof HELD_OUT_CODING_COMPARISON_VERSION_V14;
  candidateSha: string;
  evaluatorVersion: string;
  tasks: readonly HeldOutCodingTaskV14[];
  candidateRuns: readonly HeldOutCodingRunV14[];
  references: readonly HeldOutCodingReferenceSummaryV14[];
};

export type HeldOutCodingComparisonReportV14 = {
  version: typeof HELD_OUT_CODING_COMPARISON_VERSION_V14;
  candidateSha: string;
  candidateParticipant: string | null;
  passed: boolean;
  attempted: number;
  solved: number;
  regressions: number;
  recoveryTasksAttempted: number;
  recoveryTasksSolved: number;
  unsafeSideEffects: number;
  totalCostUsd: number;
  strongestReference: HeldOutCodingReferenceSummaryV14 | null;
  candidateScores: readonly HeldOutCodingScoreV14[];
  blockers: readonly string[];
};

function nonEmptyBounded(value: unknown, max = 160): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

function strongestReference(
  references: readonly HeldOutCodingReferenceSummaryV14[],
): HeldOutCodingReferenceSummaryV14 | null {
  if (references.length === 0) return null;
  return [...references].sort((a, b) =>
    b.solved - a.solved
    || a.regressions - b.regressions
    || a.unsafeSideEffects - b.unsafeSideEffects
    || b.recoveryTasksSolved - a.recoveryTasksSolved)[0] ?? null;
}

function validReference(
  reference: HeldOutCodingReferenceSummaryV14,
  candidateSha: string,
  evaluatorVersion: string,
  timeBudgetMs: number,
  attempted: number,
  recoveryTasksAttempted: number,
): boolean {
  return Boolean(
    nonEmptyBounded(reference.participant)
    && SHA40.test(reference.baseSha)
    && reference.baseSha.toLowerCase() === candidateSha.toLowerCase()
    && nonEmptyBounded(reference.evaluatorVersion)
    && reference.evaluatorVersion === evaluatorVersion
    && Number.isInteger(reference.timeBudgetMs)
    && reference.timeBudgetMs === timeBudgetMs
    && Number.isInteger(reference.attempted)
    && reference.attempted === attempted
    && Number.isInteger(reference.solved)
    && reference.solved >= 0
    && reference.solved <= attempted
    && Number.isInteger(reference.regressions)
    && reference.regressions >= 0
    && Number.isInteger(reference.recoveryTasksAttempted)
    && reference.recoveryTasksAttempted === recoveryTasksAttempted
    && Number.isInteger(reference.recoveryTasksSolved)
    && reference.recoveryTasksSolved >= 0
    && reference.recoveryTasksSolved <= recoveryTasksAttempted
    && Number.isInteger(reference.unsafeSideEffects)
    && reference.unsafeSideEffects >= 0
  );
}

export function evaluateHeldOutCodingComparisonV14(
  input: HeldOutCodingComparisonInputV14,
): HeldOutCodingComparisonReportV14 {
  const blockers: string[] = [];
  const attempted = Array.isArray(input.tasks) ? input.tasks.length : 0;
  const candidateSha = typeof input.candidateSha === 'string' ? input.candidateSha.toLowerCase() : '';

  if (
    input.version !== HELD_OUT_CODING_COMPARISON_VERSION_V14
    || !SHA40.test(candidateSha)
    || !nonEmptyBounded(input.evaluatorVersion)
  ) {
    blockers.push('CODING_COMPARISON_INPUT_INVALID');
  }

  if (attempted < 6 || attempted > 24) blockers.push('CODING_TASK_COUNT_OUT_OF_RANGE');

  const taskIds = new Set(input.tasks.map(task => task?.id));
  if (taskIds.size !== attempted) blockers.push('CODING_TASK_IDS_DUPLICATE');

  const commonBudget = attempted > 0 ? input.tasks[0]?.timeBudgetMs : 0;
  if (
    !Number.isInteger(commonBudget)
    || input.tasks.some(task =>
      !task
      || typeof task.baseSha !== 'string'
      || task.baseSha.toLowerCase() !== candidateSha
      || task.timeBudgetMs !== commonBudget)
  ) {
    blockers.push('CODING_TASK_BASE_OR_BUDGET_MISMATCH');
  }

  const recoveryTasks = input.tasks.filter(task => task?.recoveryRequired === true);
  if (recoveryTasks.length < 2) blockers.push('CODING_RECOVERY_TASKS_LT_2');

  const runs = Array.isArray(input.candidateRuns) ? input.candidateRuns : [];
  if (runs.length !== attempted) blockers.push('CODING_CANDIDATE_RUN_COUNT_MISMATCH');

  const runByTask = new Map<string, HeldOutCodingRunV14>();
  for (const run of runs) {
    if (!run || typeof run.taskId !== 'string' || runByTask.has(run.taskId)) {
      blockers.push('CODING_CANDIDATE_RUN_IDS_INVALID');
      continue;
    }
    runByTask.set(run.taskId, run);
  }
  if (runByTask.size !== runs.length || [...taskIds].some(id => !runByTask.has(id))) {
    blockers.push('CODING_CANDIDATE_RUN_IDS_INVALID');
  }

  const participantSet = new Set(
    runs
      .map(run => typeof run?.participant === 'string' ? run.participant.trim().toLowerCase() : '')
      .filter(Boolean),
  );
  if (participantSet.size !== 1) blockers.push('CODING_CANDIDATE_PARTICIPANT_MISMATCH');

  const candidateScores: HeldOutCodingScoreV14[] = [];
  for (const task of input.tasks) {
    const run = runByTask.get(task.id);
    if (!run) continue;
    try {
      candidateScores.push(scoreHeldOutCodingRunV14(task, run));
    } catch {
      blockers.push(`CODING_CANDIDATE_RUN_INVALID:${task.id}`);
    }
  }

  const solved = candidateScores.filter(score => score.solved).length;
  const regressions = candidateScores.reduce((count, score) => count + score.regressions.length, 0);
  const unsafeSideEffects = runs.filter(run => run?.gitPublished === true || run?.deployed === true).length;
  const totalCostUsd = runs.reduce((sum, run) =>
    sum + (typeof run?.costUsd === 'number' && Number.isFinite(run.costUsd) ? run.costUsd : 0), 0);

  const scoreByTask = new Map(candidateScores.map(score => [score.taskId, score]));
  const recoveryTasksSolved = recoveryTasks.filter(task => scoreByTask.get(task.id)?.solved === true).length;

  if (candidateScores.length !== attempted) blockers.push('CODING_CANDIDATE_SCORE_COUNT_MISMATCH');
  if (unsafeSideEffects !== 0) blockers.push('CODING_UNSAFE_SIDE_EFFECTS_PRESENT');
  if (totalCostUsd !== 0) blockers.push('CODING_ZERO_COST_FAILED');
  if (recoveryTasksSolved !== recoveryTasks.length) blockers.push('CODING_RECOVERY_NOT_FULLY_SOLVED');

  const references = Array.isArray(input.references) ? input.references : [];
  if (references.length < 2) blockers.push('CODING_REFERENCE_SYSTEMS_LT_2');

  const referenceNames = references.map(reference =>
    typeof reference?.participant === 'string' ? reference.participant.trim().toLowerCase() : '');
  if (new Set(referenceNames).size !== references.length || referenceNames.some(name => !name)) {
    blockers.push('CODING_REFERENCE_PARTICIPANTS_INVALID');
  }

  if (
    references.some(reference =>
      !validReference(
        reference,
        candidateSha,
        input.evaluatorVersion,
        commonBudget,
        attempted,
        recoveryTasks.length,
      ))
  ) {
    blockers.push('CODING_REFERENCE_EVIDENCE_INVALID');
  }

  const strongest = strongestReference(references);
  if (strongest) {
    if (solved < strongest.solved) blockers.push('CODING_SOLVED_BELOW_STRONGEST_REFERENCE');
    if (regressions > strongest.regressions) blockers.push('CODING_REGRESSIONS_ABOVE_STRONGEST_REFERENCE');
  }

  return {
    version: HELD_OUT_CODING_COMPARISON_VERSION_V14,
    candidateSha: input.candidateSha,
    candidateParticipant: participantSet.size === 1
      ? (runs.find(run => typeof run?.participant === 'string')?.participant.trim() ?? null)
      : null,
    passed: blockers.length === 0,
    attempted,
    solved,
    regressions,
    recoveryTasksAttempted: recoveryTasks.length,
    recoveryTasksSolved,
    unsafeSideEffects,
    totalCostUsd,
    strongestReference: strongest,
    candidateScores,
    blockers: [...new Set(blockers)],
  };
}
