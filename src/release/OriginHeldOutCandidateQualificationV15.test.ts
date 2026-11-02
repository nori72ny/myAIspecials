import { createOriginCostNotMeasuredV1 } from '../lib/orchestration/OriginCostEvidenceV1.js';
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { HeldOutCodingScoreV14 } from '../agent/heldOutCodingBenchmarkV14.js';
import type { HeldOutFinalEvidenceV14 } from '../agent/heldOutCodingFinalQualificationV14.js';
import { deriveTrustedCandidateCodingQualificationV15 } from './OriginHeldOutCandidateQualificationV15.js';

function evidence(overrides: Partial<HeldOutFinalEvidenceV14> = {}): HeldOutFinalEvidenceV14 {
  return {
    eligible: true,
    costEvidence: createOriginCostNotMeasuredV1("BILLING_NOT_AVAILABLE"),
    costEvidenceStatus: "NOT_MEASURED",
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
  it('requires performance criteria but never treats numeric zero as verified billing', () => {
    expect(deriveTrustedCandidateCodingQualificationV15(evidence(), scores())).toMatchObject({
      heldOutRunCompleted: true,
      qualificationPassed: false,
      attempted: 6,
      solved: 6,
      regressionCount: 0,
      zeroCost: false,
      costEvidenceStatus: 'NOT_MEASURED',
    });

    expect(deriveTrustedCandidateCodingQualificationV15(evidence({ solved: 5, solveRate: 5 / 6 }), scores()).qualificationPassed).toBe(false);
    expect(deriveTrustedCandidateCodingQualificationV15(evidence({ allAxesPassing: 5 }), scores()).qualificationPassed).toBe(false);
    expect(deriveTrustedCandidateCodingQualificationV15(evidence({ totalCostUsd: 0.01 }), scores()).qualificationPassed).toBe(false);

    const regressed = scores();
    regressed[0] = { ...regressed[0], regressions: ['required-path-missing'], solved: false };
    expect(deriveTrustedCandidateCodingQualificationV15(evidence({ solved: 5, allAxesPassing: 5 }), regressed).qualificationPassed).toBe(false);
  });

  it('rejects a JSON-shaped ZERO_COST_VERIFIED claim without the runtime verifier brand', () => {
    const forged = {
      ...evidence(),
      costEvidence: {
        schemaVersion: 'origin.cost-evidence.v1',
        status: 'ZERO_COST_VERIFIED',
        amountUsd: '0.00',
        receiptRef: 'forged',
        receiptDigest: 'sha256:' + 'a'.repeat(64),
        measuredAt: '2026-11-03T00:00:00.000Z',
        measurement: { totalCostUsd: '0.00', reconciledRequestCount: 1 },
      },
      costEvidenceStatus: 'ZERO_COST_VERIFIED',
    } as unknown as HeldOutFinalEvidenceV14;
    expect(deriveTrustedCandidateCodingQualificationV15(forged, scores())).toMatchObject({
      qualificationPassed: false,
      zeroCost: false,
      costEvidenceStatus: 'ZERO_COST_VERIFIED',
    });
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
