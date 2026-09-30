// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  ORIGIN_FREE_MODEL_CANDIDATE_QUALIFICATION_SCHEMA_V2,
  qualifyOriginFreeModelCandidateV2,
  type OriginFreeModelCandidateEvidenceV2,
} from './OriginFreeModelCandidateQualificationV2.js';

const NOW = Date.parse('2026-10-01T00:00:00Z');

function evidence(): OriginFreeModelCandidateEvidenceV2 {
  return {
    schemaVersion: ORIGIN_FREE_MODEL_CANDIDATE_QUALIFICATION_SCHEMA_V2,
    modelId: 'qwen/qwen3.8-27b:free',
    source: 'openrouter-official',
    sourceUrl: 'https://openrouter.ai/qwen/qwen3.8-27b:free',
    verifiedAt: '2026-09-30T00:00:00.000Z',
    reviewAfter: '2026-10-03T00:00:00.000Z',
    catalogArtifactDigest: 'a'.repeat(64),
    pricing: {
      promptUsdPerToken: 0,
      completionUsdPerToken: 0,
    },
    syntheticPublicCalibrationOnly: true,
    liveChecks: [
      {
        checkId: 'identity-01',
        requestedModel: 'qwen/qwen3.8-27b:free',
        servedModel: 'qwen/qwen3.8-27b',
        providerZdrRequested: true,
        dataCollectionDenied: true,
        fallbacksDisabled: true,
        maxPromptPriceUsd: 0,
        maxCompletionPriceUsd: 0,
        maxRequestPriceUsd: 0,
        actualCostUsd: 0,
        usageCostUsd: 0,
        responseReceived: true,
      },
      {
        checkId: 'arithmetic-01',
        requestedModel: 'qwen/qwen3.8-27b:free',
        servedModel: 'qwen/qwen3.8-27b:free',
        providerZdrRequested: true,
        dataCollectionDenied: true,
        fallbacksDisabled: true,
        maxPromptPriceUsd: 0,
        maxCompletionPriceUsd: 0,
        maxRequestPriceUsd: 0,
        actualCostUsd: 0,
        usageCostUsd: 0,
        responseReceived: true,
      },
    ],
  };
}

describe('free model candidate qualification v2', () => {
  it('qualifies only as an A/B benchmark candidate, not as a production promotion', () => {
    const report = qualifyOriginFreeModelCandidateV2(evidence(), NOW);
    expect(report.eligibleForQualityBenchmark).toBe(true);
    expect(report.zeroPriceVerified).toBe(true);
    expect(report.privacyRoutingVerified).toBe(true);
    expect(report.exactModelVerified).toBe(true);
    expect(report.liveZeroCostVerified).toBe(true);
    expect(report.blockers).toEqual([]);
  });

  it('fails closed when privacy routing is not ZDR + deny + no fallback', () => {
    const value = evidence();
    const checks = [...value.liveChecks];
    checks[0] = { ...checks[0], providerZdrRequested: false as true };
    const report = qualifyOriginFreeModelCandidateV2({ ...value, liveChecks: checks }, NOW);
    expect(report.eligibleForQualityBenchmark).toBe(false);
    expect(report.blockers).toContain('FREE_MODEL_CANDIDATE_PRIVACY_POLICY_UNVERIFIED');
  });

  it('rejects a paid or unknown-cost candidate', () => {
    const value = evidence() as any;
    value.pricing = { promptUsdPerToken: 0.000001, completionUsdPerToken: 0 };
    value.liveChecks[0] = { ...value.liveChecks[0], usageCostUsd: 0.01 };
    const report = qualifyOriginFreeModelCandidateV2(value, NOW);
    expect(report.eligibleForQualityBenchmark).toBe(false);
    expect(report.blockers).toContain('FREE_MODEL_CANDIDATE_NOT_ZERO_PRICE');
    expect(report.blockers).toContain('FREE_MODEL_CANDIDATE_LIVE_ZERO_COST_UNVERIFIED');
  });

  it('rejects a different served model even when cost is zero', () => {
    const value = evidence();
    const checks = [...value.liveChecks];
    checks[1] = { ...checks[1], servedModel: 'another/model:free' };
    const report = qualifyOriginFreeModelCandidateV2({ ...value, liveChecks: checks }, NOW);
    expect(report.eligibleForQualityBenchmark).toBe(false);
    expect(report.blockers).toContain('FREE_MODEL_CANDIDATE_SERVED_MODEL_MISMATCH');
  });

  it('rejects stale evidence and any calibration that could contain user data', () => {
    const value = evidence();
    const report = qualifyOriginFreeModelCandidateV2({
      ...value,
      reviewAfter: '2026-09-30T12:00:00.000Z',
      syntheticPublicCalibrationOnly: false as true,
    }, NOW);
    expect(report.eligibleForQualityBenchmark).toBe(false);
    expect(report.blockers).toContain('FREE_MODEL_CANDIDATE_PROVENANCE_INVALID');
    expect(report.blockers).toContain('FREE_MODEL_CANDIDATE_CALIBRATION_DATA_UNSAFE');
  });

  it('requires repeated live checks rather than a single lucky request', () => {
    const value = evidence();
    const report = qualifyOriginFreeModelCandidateV2({
      ...value,
      liveChecks: value.liveChecks.slice(0, 1),
    }, NOW);
    expect(report.eligibleForQualityBenchmark).toBe(false);
    expect(report.blockers).toContain('FREE_MODEL_CANDIDATE_LIVE_CHECKS_LT_2');
  });
});
