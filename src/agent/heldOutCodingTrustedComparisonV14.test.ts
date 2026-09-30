// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  HELD_OUT_CODING_BENCHMARK_VERSION,
  type HeldOutCodingRunV14,
  type HeldOutCodingTaskV14,
} from './heldOutCodingBenchmarkV14.js';
import {
  HELD_OUT_CODING_TRUSTED_COMPARISON_VERSION_V14,
  evaluateHeldOutCodingTrustedComparisonV14,
  type HeldOutCodingTrustedReferenceV14,
} from './heldOutCodingTrustedComparisonV14.js';

const SHA = 'a'.repeat(40);
const BUDGET = 120_000;
const NOW = Date.parse('2026-10-01T00:00:00Z');

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

function reference(
  participant: string,
  tasks: readonly HeldOutCodingTaskV14[],
  solvedCount: number,
): HeldOutCodingTrustedReferenceV14 {
  return {
    source: 'controlled-external',
    independentFromCandidate: true,
    participant,
    baseSha: SHA,
    evaluatorVersion: 'evaluator-v1',
    timeBudgetMs: BUDGET,
    evidenceId: `coding-evidence:${participant}:2026-10-01`,
    artifactDigest: `sha256:${(participant === 'reference-a' ? 'b' : 'c').repeat(64)}`,
    createdAt: '2026-09-30T00:00:00.000Z',
    expiresAt: '2026-10-15T00:00:00.000Z',
    tasks: tasks.map((t, index) => {
      const solved = index < solvedCount;
      return {
        taskId: t.id,
        taskDigest: t.taskDigest,
        durationMs: 60_000,
        axes: {
          heldOutIdentity: true,
          multiFileEditing: solved,
          verification: solved,
          failureRecovery: solved,
        },
        regressions: solved ? [] : ['multi-file-editing', 'verification-incomplete', 'recovery-not-demonstrated'],
        unsafeSideEffects: 0,
      };
    }),
  };
}

function input() {
  const tasks = Array.from({ length: 6 }, (_, index) => task(index));
  return {
    version: HELD_OUT_CODING_TRUSTED_COMPARISON_VERSION_V14,
    candidateSha: SHA,
    evaluatorVersion: 'evaluator-v1',
    tasks,
    candidateRuns: tasks.map(t => runFor(t)),
    references: [
      reference('reference-a', tasks, 5),
      reference('reference-b', tasks, 4),
    ],
  } as const;
}

describe('trusted held-out coding comparison v1.4', () => {
  it('derives reference summaries from exact task-level evidence before comparing', () => {
    const report = evaluateHeldOutCodingTrustedComparisonV14(input(), NOW);
    expect(report.passed).toBe(true);
    expect(report.trustedReferenceEvidencePassed).toBe(true);
    expect(report.comparison?.strongestReference?.participant).toBe('reference-a');
    expect(report.comparison?.strongestReference?.solved).toBe(5);
    expect(report.blockers).toEqual([]);
  });

  it('fails when a reference task digest belongs to another private task', () => {
    const value = input();
    const references = [...value.references];
    const tasks = [...references[0].tasks];
    tasks[0] = { ...tasks[0], taskDigest: 'f'.repeat(64) };
    references[0] = { ...references[0], tasks };
    const report = evaluateHeldOutCodingTrustedComparisonV14({ ...value, references }, NOW);
    expect(report.passed).toBe(false);
    expect(report.trustedReferenceEvidencePassed).toBe(false);
    expect(report.blockers).toContain('CODING_TRUSTED_REFERENCE_EVIDENCE_INVALID');
  });

  it('fails when controlled-external reference evidence is expired', () => {
    const value = input();
    const references = [...value.references];
    references[0] = { ...references[0], expiresAt: '2026-09-30T12:00:00.000Z' };
    const report = evaluateHeldOutCodingTrustedComparisonV14({ ...value, references }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('CODING_TRUSTED_REFERENCE_EVIDENCE_INVALID');
  });

  it('fails when a reference hides failed axes without regression evidence', () => {
    const value = input();
    const references = [...value.references];
    const tasks = [...references[0].tasks];
    tasks[5] = { ...tasks[5], regressions: [] };
    references[0] = { ...references[0], tasks };
    const report = evaluateHeldOutCodingTrustedComparisonV14({ ...value, references }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('CODING_TRUSTED_REFERENCE_EVIDENCE_INVALID');
  });

  it('still fails when ORIGIN underperforms a trusted strongest reference', () => {
    const value = input();
    const candidateRuns = [...value.candidateRuns];
    candidateRuns[4] = runFor(value.tasks[4], { terminalStatus: 'failed' });
    candidateRuns[5] = runFor(value.tasks[5], { terminalStatus: 'failed' });
    const report = evaluateHeldOutCodingTrustedComparisonV14({ ...value, candidateRuns }, NOW);
    expect(report.passed).toBe(false);
    expect(report.comparison?.blockers).toContain('CODING_SOLVED_BELOW_STRONGEST_REFERENCE');
  });
});
