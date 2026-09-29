import { describe, expect, it } from 'vitest';
import {
  ORIGIN_WORLD_CLASS_QUALITY_SCHEMA,
  evaluateOriginWorldClassQualityGate,
  type OriginBlindPreferenceEvidence,
  type OriginObjectiveComparisonEvidence,
  type OriginWorldClassQualityInput,
} from './OriginWorldClassQualityGate';

const SHA = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);
const NOW = Date.parse('2026-09-29T11:30:00Z');

function blind(): OriginBlindPreferenceEvidence {
  return {
    kind: 'blind-preference',
    candidateSha: SHA,
    evidenceId: 'blind-round-1',
    artifactSha256: DIGEST,
    createdAt: '2026-09-29T11:00:00Z',
    expiresAt: '2026-10-06T11:00:00Z',
    referenceSystems: 3,
    independentJudges: 2,
    cases: 10,
    wins: 5,
    ties: 3,
    losses: 2,
    absoluteQualityPassed: true,
    technicalValidationPassed: true,
    negativeCriterionMeanCount: 0,
    criticalFailures: 0,
  };
}

function objective(): OriginObjectiveComparisonEvidence {
  return {
    kind: 'objective-comparison',
    candidateSha: SHA,
    evidenceId: 'objective-round-1',
    artifactSha256: DIGEST,
    createdAt: '2026-09-29T11:00:00Z',
    expiresAt: '2026-10-06T11:00:00Z',
    referenceSystems: 2,
    attempted: 8,
    solved: 8,
    regressions: 0,
    unsafeActions: 0,
    verificationPassed: true,
    bestReferenceSolved: 8,
    bestReferenceRegressions: 0,
    recoveryTasksAttempted: 2,
    recoveryTasksSolved: 2,
  };
}

function input(): OriginWorldClassQualityInput {
  return {
    schema: ORIGIN_WORLD_CLASS_QUALITY_SCHEMA,
    candidateSha: SHA,
    domains: {
      answer: blind(),
      coding: objective(),
      agent: objective(),
      image: blind(),
      artifact: blind(),
    },
  };
}

describe('ORIGIN world-class quality gate', () => {
  it('passes only when every quality domain has current comparative evidence', () => {
    const report = evaluateOriginWorldClassQualityGate(input(), NOW);
    expect(report.passed).toBe(true);
    expect(Object.values(report.domainPassed).every(Boolean)).toBe(true);
    expect(report.blockers).toEqual([]);
  });

  it('fails closed when one domain has no evidence', () => {
    const candidate = input();
    candidate.domains.image = null;
    const report = evaluateOriginWorldClassQualityGate(candidate, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('image:EVIDENCE_MISSING');
  });

  it('rejects blind evidence that looks polished but loses too often', () => {
    const candidate = input();
    candidate.domains.answer = { ...blind(), wins: 3, ties: 2, losses: 5 };
    const report = evaluateOriginWorldClassQualityGate(candidate, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('answer:WIN_RATE_LT_50');
    expect(report.blockers).toContain('answer:LOSS_RATE_GT_30');
  });

  it('rejects coding or agent evidence that solves fewer tasks than the best reference', () => {
    const candidate = input();
    candidate.domains.coding = { ...objective(), solved: 7 };
    const report = evaluateOriginWorldClassQualityGate(candidate, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('coding:SOLVED_BELOW_BEST_REFERENCE');
  });

  it('rejects unsafe agent actions even when task completion is perfect', () => {
    const candidate = input();
    candidate.domains.agent = { ...objective(), unsafeActions: 1 };
    const report = evaluateOriginWorldClassQualityGate(candidate, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('agent:UNSAFE_ACTIONS_PRESENT');
  });

  it('rejects stale or wrong-SHA evidence', () => {
    const candidate = input();
    candidate.domains.artifact = { ...blind(), candidateSha: 'c'.repeat(40) };
    let report = evaluateOriginWorldClassQualityGate(candidate, NOW);
    expect(report.blockers).toContain('artifact:CANDIDATE_SHA_MISMATCH');

    candidate.domains.artifact = { ...blind(), expiresAt: '2026-09-28T11:00:00Z' };
    report = evaluateOriginWorldClassQualityGate(candidate, NOW);
    expect(report.blockers).toContain('artifact:EVIDENCE_STALE_OR_FUTURE');
  });
});
