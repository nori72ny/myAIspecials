// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  HELD_OUT_CODING_BENCHMARK_VERSION,
  scoreHeldOutCodingRunV14,
  summarizeHeldOutCodingRunsV14,
  type HeldOutCodingRunV14,
  type HeldOutCodingTaskV14,
} from './heldOutCodingBenchmarkV14.js';

const digest = 'a'.repeat(64);
const baseSha = 'b'.repeat(40);
const task = (overrides: Partial<HeldOutCodingTaskV14> = {}): HeldOutCodingTaskV14 => ({
  id: 'private-task-001',
  taskDigest: digest,
  baseSha,
  timeBudgetMs: 120_000,
  requiredChangedPaths: ['src/a.ts', 'src/b.ts'],
  protectedPaths: ['hidden/task-001.test.ts'],
  recoveryRequired: true,
  ...overrides,
});
const passingChecks = () => ([
  { kind: 'typecheck' as const, ok: true, exitCode: 0, timedOut: false },
  { kind: 'lint' as const, ok: true, exitCode: 0, timedOut: false },
  { kind: 'test' as const, ok: true, exitCode: 0, timedOut: false },
  { kind: 'build' as const, ok: true, exitCode: 0, timedOut: false },
]);
const run = (overrides: Partial<HeldOutCodingRunV14> = {}): HeldOutCodingRunV14 => ({
  suite: HELD_OUT_CODING_BENCHMARK_VERSION,
  taskId: 'private-task-001',
  taskDigest: digest,
  participant: 'ORIGIN',
  provider: 'fixture-provider',
  model: 'fixture-model',
  baseSha,
  durationMs: 60_000,
  costUsd: 0,
  terminalStatus: 'verified',
  attempts: [
    {
      attempt: 0,
      changedPaths: ['src/a.ts', 'src/b.ts'],
      checks: [
        { kind: 'typecheck', ok: true, exitCode: 0, timedOut: false },
        { kind: 'lint', ok: true, exitCode: 0, timedOut: false },
        { kind: 'test', ok: false, exitCode: 1, timedOut: false },
        { kind: 'build', ok: true, exitCode: 0, timedOut: false },
      ],
    },
    { attempt: 1, changedPaths: ['src/a.ts', 'src/b.ts'], checks: passingChecks() },
  ],
  finalChangedPaths: ['src/a.ts', 'src/b.ts'],
  gitPublished: false,
  deployed: false,
  ...overrides,
});

describe('held-out Agentic Coding benchmark', () => {
  it('passes all four axes for an equal-base, multi-file, verified recovery run', () => {
    const score = scoreHeldOutCodingRunV14(task(), run());
    expect(score.solved).toBe(true);
    expect(score.axes).toEqual({ heldOutIdentity: true, multiFileEditing: true, verification: true, failureRecovery: true });
    expect(score.regressions).toEqual([]);
  });

  it('fails identity when the participant did not start from the frozen base or exceeded the equal budget', () => {
    const wrongBase = scoreHeldOutCodingRunV14(task(), run({ baseSha: 'c'.repeat(40) }));
    const overBudget = scoreHeldOutCodingRunV14(task(), run({ durationMs: 120_001 }));
    expect(wrongBase.axes.heldOutIdentity).toBe(false);
    expect(overBudget.axes.heldOutIdentity).toBe(false);
  });

  it('requires multiple production files and rejects hidden/evaluator path modification', () => {
    expect(scoreHeldOutCodingRunV14(task(), run({ finalChangedPaths: ['src/a.ts'] })).axes.multiFileEditing).toBe(false);
    const touchedHidden = scoreHeldOutCodingRunV14(task(), run({ finalChangedPaths: ['src/a.ts', 'src/b.ts', 'hidden/task-001.test.ts'] }));
    expect(touchedHidden.axes.multiFileEditing).toBe(false);
    expect(touchedHidden.regressions).toContain('protected-path-modified');
  });

  it('requires exact final typecheck/lint/test/build success and no publish/deploy side effect', () => {
    const missingBuild = run();
    missingBuild.attempts[1].checks = passingChecks().filter(check => check.kind !== 'build');
    expect(scoreHeldOutCodingRunV14(task(), missingBuild).axes.verification).toBe(false);
    expect(scoreHeldOutCodingRunV14(task(), run({ gitPublished: true })).axes.verification).toBe(false);
    expect(scoreHeldOutCodingRunV14(task(), run({ deployed: true })).axes.verification).toBe(false);
  });

  it('requires a real failed-check -> repaired -> verified sequence on recovery tasks', () => {
    const noFailure = run({ attempts: [{ attempt: 0, changedPaths: ['src/a.ts', 'src/b.ts'], checks: passingChecks() }] });
    expect(scoreHeldOutCodingRunV14(task(), noFailure).axes.failureRecovery).toBe(false);
    const optionalRecovery = scoreHeldOutCodingRunV14(task({ recoveryRequired: false }), noFailure);
    expect(optionalRecovery.axes.failureRecovery).toBe(true);
  });

  it('rejects task definitions that are not multi-file or have conflicting protected paths', () => {
    expect(() => scoreHeldOutCodingRunV14(task({ requiredChangedPaths: ['src/a.ts'] }), run())).toThrow('HELD_OUT_MULTIFILE_TASK_REQUIRED');
    expect(() => scoreHeldOutCodingRunV14(task({ protectedPaths: ['src/a.ts'] }), run())).toThrow('HELD_OUT_PATH_POLICY_CONFLICT');
  });

  it('summarizes solved/attempted, regressions, median duration and actual cost without ranking vendors', () => {
    const solved = scoreHeldOutCodingRunV14(task(), run({ durationMs: 40_000, costUsd: 0 }));
    const failed = scoreHeldOutCodingRunV14(task(), run({ durationMs: 80_000, terminalStatus: 'failed' }));
    expect(summarizeHeldOutCodingRunsV14([solved, failed])).toEqual({
      attempted: 2,
      solved: 1,
      regressions: failed.regressions.length,
      medianDurationMs: 60_000,
      totalCostUsd: 0,
    });
  });
});
