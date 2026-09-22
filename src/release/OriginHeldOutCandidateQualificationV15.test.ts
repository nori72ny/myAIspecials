// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { HeldOutCodingScoreV14 } from '../agent/heldOutCodingBenchmarkV14.js';
import type { HeldOutFinalEvidenceV14 } from '../agent/heldOutCodingFinalQualificationV14.js';
import { deriveTrustedCandidateCodingQualificationV15 } from './OriginHeldOutCandidateQualificationV15.js';

function evidence(overrides: Partial<HeldOutFinalEvidenceV14> = {}): HeldOutFinalEvidenceV14 {
  return {
    eligible: true,
    reasons: [],
    taskCount: 6,
    recoveryTaskCount: 2,
    frozenBaseSha: 'a'.repeat(40),
    timeBudgetMs: 900_000,
    coverage: {
      navigationMultiFile: true,
      featureWithNewFile: true,
      regressionRecovery: true,
      buildOrTypecheckRepair: true,
      securityPathBoundary: true,
    },
    attempted: 6,
    solved: 6,
    solveRate: 1,
    totalCostUsd: 0,
    participant: 'ORIGIN',
    allAxesPassing: 6,
    ...overrides,
  };
}

function scores(): HeldOutCodingScoreV14[] {
  return Array.from({ length: 6 }, (_, index) => ({
    taskId: `task-${index + 1}`,
    participant: 'ORIGIN',
    axes: {
      heldOutIdentity: true,
      multiFileEditing: true,
      verification: true,
      failureRecovery: true,
    },
    solved: true,
    regressions: [],
    durationMs: 1000,
    costUsd: 0,
    terminalStatus: 'verified',
  }));
}

describe('trusted candidate coding qualification', () => {
  it('requires 100% solved, all axes, zero regressions and $0', () => {
    expect(deriveTrustedCandidateCodingQualificationV15(evidence(), scores())).toMatchObject({
      heldOutRunCompleted: true,
      qualificationPassed: true,
      attempted: 6,
      solved: 6,
      regressionCount: 0,
      zeroCost: true,
    });

    expect(deriveTrustedCandidateCodingQualificationV15(evidence({ solved: 5, solveRate: 5 / 6 }), scores()).qualificationPassed).toBe(false);
    expect(deriveTrustedCandidateCodingQualificationV15(evidence({ allAxesPassing: 5 }), scores()).qualificationPassed).toBe(false);
    expect(deriveTrustedCandidateCodingQualificationV15(evidence({ totalCostUsd: 0.01 }), scores()).qualificationPassed).toBe(false);

    const regressed = scores();
    regressed[0] = { ...regressed[0], regressions: ['required-path-missing'], solved: false };
    expect(deriveTrustedCandidateCodingQualificationV15(evidence({ solved: 5, allAxesPassing: 5 }), regressed).qualificationPassed).toBe(false);
  });

  it('fails closed on incomplete or duplicate task evidence', () => {
    expect(deriveTrustedCandidateCodingQualificationV15(evidence({ attempted: 5 }), scores().slice(0, 5))).toMatchObject({
      heldOutRunCompleted: false,
      qualificationPassed: false,
    });
    const duplicate = scores();
    duplicate[5] = { ...duplicate[5], taskId: duplicate[0].taskId };
    expect(deriveTrustedCandidateCodingQualificationV15(evidence(), duplicate)).toMatchObject({
      heldOutRunCompleted: false,
      qualificationPassed: false,
    });
  });
});
