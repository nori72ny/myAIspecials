export const ORIGIN_FREE_MODEL_CANDIDATE_QUALIFICATION_SCHEMA_V2 =
  'origin.free-model-candidate-qualification.v2' as const;

const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*:free$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_EVIDENCE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type OriginFreeModelCandidateLiveCheckV2 = {
  checkId: string;
  requestedModel: string;
  servedModel: string;
  providerZdrRequested: true;
  dataCollectionDenied: true;
  fallbacksDisabled: true;
  maxPromptPriceUsd: 0;
  maxCompletionPriceUsd: 0;
  maxRequestPriceUsd: 0;
  actualCostUsd: 0;
  usageCostUsd: 0;
  responseReceived: true;
};

export type OriginFreeModelCandidateEvidenceV2 = {
  schemaVersion: typeof ORIGIN_FREE_MODEL_CANDIDATE_QUALIFICATION_SCHEMA_V2;
  modelId: string;
  source: 'openrouter-official';
  sourceUrl: string;
  verifiedAt: string;
  reviewAfter: string;
  catalogArtifactDigest: string;
  pricing: {
    promptUsdPerToken: 0;
    completionUsdPerToken: 0;
  };
  syntheticPublicCalibrationOnly: true;
  liveChecks: readonly OriginFreeModelCandidateLiveCheckV2[];
};

export type OriginFreeModelCandidateQualificationV2 = {
  schemaVersion: typeof ORIGIN_FREE_MODEL_CANDIDATE_QUALIFICATION_SCHEMA_V2;
  modelId: string;
  zeroPriceVerified: boolean;
  privacyRoutingVerified: boolean;
  exactModelVerified: boolean;
  liveZeroCostVerified: boolean;
  syntheticOnlyVerified: boolean;
  eligibleForQualityBenchmark: boolean;
  blockers: readonly string[];
};

function canonicalModelId(value: string): string {
  return value.replace(/:free$/i, '');
}

function validWindow(verifiedAtValue: string, reviewAfterValue: string, nowMs: number): boolean {
  const verifiedAt = Date.parse(verifiedAtValue);
  const reviewAfter = Date.parse(reviewAfterValue);
  return Number.isFinite(verifiedAt)
    && Number.isFinite(reviewAfter)
    && verifiedAt <= nowMs + MAX_CLOCK_SKEW_MS
    && reviewAfter > nowMs
    && reviewAfter >= verifiedAt
    && reviewAfter - verifiedAt <= MAX_EVIDENCE_LIFETIME_MS;
}

function exactServedModel(requestedModel: string, servedModel: string): boolean {
  return servedModel === requestedModel || servedModel === canonicalModelId(requestedModel);
}

export function qualifyOriginFreeModelCandidateV2(
  evidence: OriginFreeModelCandidateEvidenceV2,
  nowMs: number = Date.now(),
): OriginFreeModelCandidateQualificationV2 {
  const blockers: string[] = [];
  const modelId = typeof evidence?.modelId === 'string' ? evidence.modelId : '';

  if (
    evidence?.schemaVersion !== ORIGIN_FREE_MODEL_CANDIDATE_QUALIFICATION_SCHEMA_V2
    || !MODEL_ID.test(modelId)
    || evidence?.source !== 'openrouter-official'
    || typeof evidence.sourceUrl !== 'string'
    || !evidence.sourceUrl.startsWith('https://openrouter.ai/')
    || !SHA256.test(evidence.catalogArtifactDigest)
    || !validWindow(evidence.verifiedAt, evidence.reviewAfter, nowMs)
  ) {
    blockers.push('FREE_MODEL_CANDIDATE_PROVENANCE_INVALID');
  }

  const zeroPriceVerified = evidence?.pricing?.promptUsdPerToken === 0
    && evidence?.pricing?.completionUsdPerToken === 0;
  if (!zeroPriceVerified) blockers.push('FREE_MODEL_CANDIDATE_NOT_ZERO_PRICE');

  const checks = Array.isArray(evidence?.liveChecks) ? evidence.liveChecks : [];
  if (checks.length < 2) blockers.push('FREE_MODEL_CANDIDATE_LIVE_CHECKS_LT_2');

  const ids = checks.map(check => check?.checkId);
  if (new Set(ids).size !== checks.length || ids.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9._:-]{2,119}$/i.test(id))) {
    blockers.push('FREE_MODEL_CANDIDATE_CHECK_IDS_INVALID');
  }

  const privacyRoutingVerified = checks.length >= 2 && checks.every(check =>
    check?.providerZdrRequested === true
    && check?.dataCollectionDenied === true
    && check?.fallbacksDisabled === true
    && check?.maxPromptPriceUsd === 0
    && check?.maxCompletionPriceUsd === 0
    && check?.maxRequestPriceUsd === 0);
  if (!privacyRoutingVerified) blockers.push('FREE_MODEL_CANDIDATE_PRIVACY_POLICY_UNVERIFIED');

  const exactModelVerified = checks.length >= 2 && checks.every(check =>
    check?.requestedModel === modelId
    && typeof check?.servedModel === 'string'
    && exactServedModel(modelId, check.servedModel));
  if (!exactModelVerified) blockers.push('FREE_MODEL_CANDIDATE_SERVED_MODEL_MISMATCH');

  const liveZeroCostVerified = checks.length >= 2 && checks.every(check =>
    check?.actualCostUsd === 0
    && check?.usageCostUsd === 0
    && check?.responseReceived === true);
  if (!liveZeroCostVerified) blockers.push('FREE_MODEL_CANDIDATE_LIVE_ZERO_COST_UNVERIFIED');

  const syntheticOnlyVerified = evidence?.syntheticPublicCalibrationOnly === true;
  if (!syntheticOnlyVerified) blockers.push('FREE_MODEL_CANDIDATE_CALIBRATION_DATA_UNSAFE');

  const unique = [...new Set(blockers)];
  return Object.freeze({
    schemaVersion: ORIGIN_FREE_MODEL_CANDIDATE_QUALIFICATION_SCHEMA_V2,
    modelId,
    zeroPriceVerified,
    privacyRoutingVerified,
    exactModelVerified,
    liveZeroCostVerified,
    syntheticOnlyVerified,
    eligibleForQualityBenchmark: unique.length === 0,
    blockers: Object.freeze(unique),
  });
}
