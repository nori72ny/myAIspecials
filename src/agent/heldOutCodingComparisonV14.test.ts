// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  HELD_OUT_CODING_BENCHMARK_VERSION,
  type HeldOutCodingRunV14,
  type HeldOutCodingTaskV14,
} from './heldOutCodingBenchmarkV14.js';
import {
  HELD_OUT_CODING_COMPARISON_VERSION_V14,
  evaluateHeldOutCodingComparisonV14,
  type HeldOutCodingReferenceSummaryV14,
} from './heldOutCodingComparisonV14.js';

const SHA = 'a'.repeat(40);
const BUDGET = 120_000;

function task(index: number): HeldOutCodingTaskV14 {
  return {
    id: `coding-task-${String(index + 1).padStart(2, '0')}`,
    taskDigest: (index + 1).toString(16).padStart(64, '0'),
    baseSha: SHA,
    timeBudgetMs: BUDGET,
    requiredChangedPaths: [`src/task-${index}-a.ts`, `src/task-${index}-b.ts`],
    protectedPaths: [`hidden/task-${index}.test.ts`],
    recoveryRequired: index < 2,
  };
}

function passingChecks() {
  return [
    { kind: 'typecheck' as const, ok: true, exitCode: 0, timedOut: false },
    { kind: 'lint' as const, ok: true, exitCode: 0, timedOut: false },
    { kind: 'test' as const, ok: true, exitCode: 0, timedOut: false },
    { kind: 'build' as const, ok: true, exitCode: 0, timedOut: false },
  ];
}

function runFor(t: HeldOutCodingTaskV14, overrides: Partial<HeldOutCodingRunV14> = {}): HeldOutCodingRunV14 {
  const attempts = t.recoveryRequired
    ? [
      {
        attempt: 0,
        changedPaths: [...t.requiredChangedPaths],
        checks: [
          ...passingChecks().filter(check => check.kind !== 'test'),
          { kind: 'test' as const, ok: false, exitCode: 1, timedOut: false },
        ],
      },
      { attempt: 1, changedPaths: [...t.requiredChangedPaths], checks: passingChecks() },
    ]
    : [{ attempt: 0, changedPaths: [...t.requiredChangedPaths], checks: passingChecks() }];

  return {
    suite: HELD_OUT_CODING_BENCHMARK_VERSION,
    taskId: t.id,
    taskDigest: t.taskDigest,
    participant: 'ORIGIN',
    provider: 'verified-free-provider',
    model: 'verified-free-model',
    baseSha: t.baseSha,
    durationMs: 40_000,
    costUsd: 0,
    terminalStatus: 'verified',
    attempts,
    finalChangedPaths: [...t.requiredChangedPaths],
    gitPublished: false,
    deployed: false,
    ...overrides,
  };
}

function references(): HeldOutCodingReferenceSummaryV14[] {
  return [
    {
      participant: 'reference-a',
      baseSha: SHA,
      evaluatorVersion: 'evaluator-v1',
      timeBudgetMs: BUDGET,
      attempted: 6,
      solved: 5,
      regressions: 1,
      recoveryTasksAttempted: 2,
      recoveryTasksSolved: 2,
      unsafeSideEffects: 0,
    },
    {
      participant: 'reference-b',
      baseSha: SHA,
      evaluatorVersion: 'evaluator-v1',
      timeBudgetMs: BUDGET,
      attempted: 6,
      solved: 4,
      regressions: 2,
      recoveryTasksAttempted: 2,
      recoveryTasksSolved: 1,
      unsafeSideEffects: 0,
    },
  ];
}

function input() {
  const tasks = Array.from({ length: 6 }, (_, index) => task(index));
  return {
    version: HELD_OUT_CODING_COMPARISON_VERSION_V14,
    candidateSha: SHA,
    evaluatorVersion: 'evaluator-v1',
    tasks,
    candidateRuns: tasks.map(t => runFor(t)),
    references: references(),
  } as const;
}

describe('held-out coding comparison v1.4', () => {
  it('passes only with >=6 equal-base tasks, >=2 recovery tasks and >=2 references', () => {
    const report = evaluateHeldOutCodingComparisonV14(input());
    expect(report.passed).toBe(true);
    expect(report.attempted).toBe(6);
    expect(report.solved).toBe(6);
    expect(report.recoveryTasksSolved).toBe(2);
    expect(report.unsafeSideEffects).toBe(0);
    expect(report.totalCostUsd).toBe(0);
    expect(report.strongestReference?.participant).toBe('reference-a');
  });

  it('fails when ORIGIN solves fewer tasks than the strongest reference', () => {
    const value = input();
    const candidateRuns = [...value.candidateRuns];
    candidateRuns[5] = runFor(value.tasks[5], { terminalStatus: 'failed' });
    const report = evaluateHeldOutCodingComparisonV14({ ...value, candidateRuns });
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('CODING_SOLVED_BELOW_STRONGEST_REFERENCE');
  });

  it('fails on cost or unintended Git/deploy side effects even if verification otherwise looks healthy', () => {
    const value = input();
    const candidateRuns = [...value.candidateRuns];
    candidateRuns[4] = runFor(value.tasks[4], { costUsd: 0.01, gitPublished: true });
    const report = evaluateHeldOutCodingComparisonV14({ ...value, candidateRuns });
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('CODING_ZERO_COST_FAILED');
    expect(report.blockers).toContain('CODING_UNSAFE_SIDE_EFFECTS_PRESENT');
  });

  it('requires all recovery-designated tasks to be solved', () => {
    const value = input();
    const candidateRuns = [...value.candidateRuns];
    candidateRuns[0] = runFor(value.tasks[0], {
      attempts: [{ attempt: 0, changedPaths: [...value.tasks[0].requiredChangedPaths], checks: passingChecks() }],
    });
    const report = evaluateHeldOutCodingComparisonV14({ ...value, candidateRuns });
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('CODING_RECOVERY_NOT_FULLY_SOLVED');
  });

  it('rejects reference evidence that did not use the same base, evaluator, budget or recovery corpus', () => {
    const value = input();
    const badReference = { ...value.references[0], baseSha: 'b'.repeat(40) };
    const report = evaluateHeldOutCodingComparisonV14({
      ...value,
      references: [badReference, value.references[1]],
    });
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('CODING_REFERENCE_EVIDENCE_INVALID');
  });

  it('rejects fewer than six tasks and fewer than two recovery tasks', () => {
    const value = input();
    const tasks = value.tasks.slice(0, 5).map((t, index) => ({ ...t, recoveryRequired: index === 0 }));
    const candidateRuns = tasks.map(t => runFor(t));
    const refs = references().map(reference => ({
      ...reference,
      attempted: 5,
      recoveryTasksAttempted: 1,
      recoveryTasksSolved: 1,
    }));
    const report = evaluateHeldOutCodingComparisonV14({ ...value, tasks, candidateRuns, references: refs });
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('CODING_TASK_COUNT_OUT_OF_RANGE');
    expect(report.blockers).toContain('CODING_RECOVERY_TASKS_LT_2');
  });
});
