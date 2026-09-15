// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { HeldOutCodingScoreV14, HeldOutCodingTaskV14 } from './heldOutCodingBenchmarkV14.js';
import {
  HELD_OUT_FINAL_QUALIFICATION_VERSION_V14,
  qualifyHeldOutFinalCorpusV14,
  summarizeHeldOutFinalEvidenceV14,
  type HeldOutFinalCorpusV14,
  type HeldOutFinalRunProvenanceV14,
} from './heldOutCodingFinalQualificationV14.js';

const baseSha = 'a'.repeat(40);

function task(index: number, recoveryRequired = false): HeldOutCodingTaskV14 {
  return {
    id: `final-${index}`,
    taskDigest: index.toString(16).padStart(64, '0'),
    baseSha,
    timeBudgetMs: 900_000,
    requiredChangedPaths: [`src/agent/final-${index}.ts`, `src/agent/final-${index}-helper.ts`],
    protectedPaths: [`tests/__origin_heldout__/final-${index}.test.ts`],
    recoveryRequired,
  };
}

function corpus(): HeldOutFinalCorpusV14 {
  return {
    qualification: HELD_OUT_FINAL_QUALIFICATION_VERSION_V14,
    corpusId: 'origin-final-unseen-001',
    corpusDigest: 'f'.repeat(64),
    frozenBaseSha: baseSha,
    coverage: {
      navigationMultiFile: true,
      featureWithNewFile: true,
      regressionRecovery: true,
      buildOrTypecheckRepair: true,
      securityPathBoundary: true,
    },
    tasks: [task(1, true), task(2, true), task(3), task(4), task(5), task(6)],
  };
}

function provenance(overrides: Partial<HeldOutFinalRunProvenanceV14> = {}): HeldOutFinalRunProvenanceV14 {
  return {
    runOrdinal: 1,
    engineeringObservedBeforeRun: false,
    taskSpecificTuningAfterFreeze: false,
    priorObservedCorpusDigests: ['e'.repeat(64)],
    ...overrides,
  };
}

function score(row: HeldOutCodingTaskV14, solved = true, participant = 'origin-v1.4'): HeldOutCodingScoreV14 {
  return {
    taskId: row.id,
    participant,
    axes: {
      heldOutIdentity: solved,
      multiFileEditing: solved,
      verification: solved,
      failureRecovery: solved,
    },
    solved,
    regressions: solved ? [] : ['verification-incomplete'],
    durationMs: 120_000,
    costUsd: 0,
    terminalStatus: solved ? 'verified' : 'failed',
  };
}

describe('V1.4 final held-out qualification gate', () => {
  it('accepts a fresh one-shot corpus with six tasks, recovery coverage and all required domains', () => {
    const result = qualifyHeldOutFinalCorpusV14(corpus(), provenance());
    expect(result).toMatchObject({
      eligible: true,
      reasons: [],
      taskCount: 6,
      recoveryTaskCount: 2,
      frozenBaseSha: baseSha,
      timeBudgetMs: 900_000,
    });
  });

  it('rejects a corpus that engineering already observed or that is being rerun', () => {
    const value = corpus();
    const result = qualifyHeldOutFinalCorpusV14(value, provenance({
      runOrdinal: 2,
      engineeringObservedBeforeRun: true,
      priorObservedCorpusDigests: [value.corpusDigest],
    }));
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'corpus-already-observed',
      'final-run-not-one-shot',
      'engineering-observed-before-run',
    ]));
  });

  it('rejects task-specific tuning after freeze and insufficient recovery coverage', () => {
    const value = corpus();
    value.tasks = value.tasks.map((row, index) => ({ ...row, recoveryRequired: index === 0 }));
    const result = qualifyHeldOutFinalCorpusV14(value, provenance({ taskSpecificTuningAfterFreeze: true }));
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'recovery-coverage-insufficient',
      'task-specific-tuning-after-freeze',
    ]));
  });

  it('rejects non-uniform frozen bases or budgets and missing coverage claims', () => {
    const value = corpus();
    value.tasks[1] = { ...value.tasks[1], baseSha: 'b'.repeat(40) };
    value.tasks[2] = { ...value.tasks[2], timeBudgetMs: 600_000 };
    value.coverage.securityPathBoundary = false;
    const result = qualifyHeldOutFinalCorpusV14(value, provenance());
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'base-sha-not-uniform',
      'time-budget-not-uniform',
      'coverage-missing:securityPathBoundary',
    ]));
  });

  it('requires the public score set to cover every final task exactly once under one participant and zero cost', () => {
    const value = corpus();
    const validScores = value.tasks.map(row => score(row));
    expect(summarizeHeldOutFinalEvidenceV14(value, provenance(), validScores)).toMatchObject({
      eligible: true,
      attempted: 6,
      solved: 6,
      solveRate: 1,
      totalCostUsd: 0,
      participant: 'origin-v1.4',
      allAxesPassing: 6,
    });

    const invalidScores = [
      ...validScores.slice(0, 5),
      { ...score(value.tasks[5], true, 'different-participant'), costUsd: 0.01 },
    ];
    const invalid = summarizeHeldOutFinalEvidenceV14(value, provenance(), invalidScores);
    expect(invalid.eligible).toBe(false);
    expect(invalid.reasons).toEqual(expect.arrayContaining(['participant-not-uniform', 'non-zero-cost-observed']));
  });

  it('reports observed performance without inventing a pass threshold or winner', () => {
    const value = corpus();
    const scores = value.tasks.map((row, index) => score(row, index < 4));
    const result = summarizeHeldOutFinalEvidenceV14(value, provenance(), scores);
    expect(result.eligible).toBe(true);
    expect(result.attempted).toBe(6);
    expect(result.solved).toBe(4);
    expect(result.solveRate).toBeCloseTo(4 / 6);
    expect(result.allAxesPassing).toBe(4);
  });
});
