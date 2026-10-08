/**
 * Read-only, fail-closed decision primitive for releasing ONE ORIGIN capability
 * or automatically updating ONE previously published capability.
 *
 * This is NOT itself a GitHub branch-protection rule or Vercel Deployment Check.
 * Only a trusted server-side integration may supply verified GitHub, Vercel,
 * security, owner approval and quality evidence. Never accept browser assertions.
 */
export type OriginProgressiveReleaseKind = 'new-feature' | 'published-feature-update';
export type OriginProgressiveReleaseBlocker =
  | 'INVALID_SINGLE_FEATURE_SCOPE'
  | 'FEATURE_DIFF_SCOPE_UNVERIFIED'
  | 'OWNER_VISUAL_APPROVAL_MISSING'
  | 'EXACT_HEAD_MISMATCH'
  | 'UNPROTECTED_MAIN'
  | 'PREPUBLISH_GATE_NOT_ENFORCED'
  | 'EXACT_HEAD_CI_NOT_GREEN'
  | 'CODE_REVIEW_NOT_CURRENT'
  | 'OWNER_APPROVAL_MISSING'
  | 'QUALITY_EVIDENCE_MISSING'
  | 'SAFETY_EVIDENCE_MISSING'
  | 'POST_RELEASE_VERIFICATION_UNAVAILABLE';

export interface OriginProgressiveReleaseEvidenceV1 {
  readonly featureId: string;
  readonly kind: OriginProgressiveReleaseKind;
  /** Trusted diff inspection: all changes are within the approved feature scope. */
  readonly singleFeatureDiffVerified: boolean;
  readonly candidateSha: string;
  readonly currentHeadSha: string;
  readonly baseMainSha: string;
  readonly currentMainSha: string;
  /** Must be verified by the GitHub API, never copied from PR descriptions. */
  readonly mainProtected: boolean;
  readonly requiredChecksAndReviewEnforced: boolean;
  /** Must be verified against actual Vercel project deployment settings. */
  readonly productionDomainHeldUntilChecksPass: boolean;
  readonly exactHeadRequiredChecksGreen: boolean;
  readonly reviewedHeadSha: string | null;
  readonly uiChanged: boolean;
  readonly ownerVisualApprovedHeadSha: string | null;
  readonly ownerApproval: {
    readonly featureId: string;
    readonly kind: OriginProgressiveReleaseKind;
    readonly headSha: string;
    readonly identityVerified: boolean;
  } | null;
  /** Domain-specific, independently qualified; a skipped held-out is false. */
  readonly capabilityQualityQualified: boolean;
  readonly regressionAndDeviceTestsPassed: boolean;
  readonly zeroCostVerified: boolean;
  readonly freeOnlyVerified: boolean;
  /** Observed real USD cost, not a model estimate or truthy string. */
  readonly actualCostUsd: number;
  readonly paidFallbackDisabled: boolean;
  readonly noNewPrivilegesOrSecrets: boolean;
  readonly rollbackReady: boolean;
  readonly productionSmokeReady: boolean;
}

export interface OriginProgressiveReleaseVerdictV1 {
  readonly schemaVersion: 'origin.progressive-release-preflight.v1';
  readonly featureId: string;
  readonly candidateSha: string;
  readonly canPublish: boolean;
  readonly blockers: readonly OriginProgressiveReleaseBlocker[];
}

const validSha = (sha: unknown): sha is string => typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha);
// Broad selectors must never authorize multi-feature or whole-product releases.
const RESERVED_FEATURE_SCOPES = new Set(['all', 'any', 'main', 'production', 'release', 'features', 'everything']);
const validFeature = (s: unknown): s is string => typeof s === 'string'
  && /^[a-z][a-z0-9-]{1,63}$/.test(s)
  && !s.includes('--')
  && !RESERVED_FEATURE_SCOPES.has(s);

export function evaluateOriginProgressiveReleasePreflightV1(
  evidence: OriginProgressiveReleaseEvidenceV1,
): OriginProgressiveReleaseVerdictV1 {
  const blockers: OriginProgressiveReleaseBlocker[] = [];
  if (!validFeature(evidence.featureId)
    || (evidence.kind !== 'new-feature' && evidence.kind !== 'published-feature-update')) {
    blockers.push('INVALID_SINGLE_FEATURE_SCOPE');
  }
  if (evidence.singleFeatureDiffVerified !== true) blockers.push('FEATURE_DIFF_SCOPE_UNVERIFIED');
  if (!validSha(evidence.candidateSha)
    || !validSha(evidence.currentHeadSha)
    || !validSha(evidence.baseMainSha)
    || !validSha(evidence.currentMainSha)
    || evidence.candidateSha !== evidence.currentHeadSha
    || evidence.baseMainSha !== evidence.currentMainSha) {
    blockers.push('EXACT_HEAD_MISMATCH');
  }
  if (evidence.mainProtected !== true) blockers.push('UNPROTECTED_MAIN');
  if (evidence.requiredChecksAndReviewEnforced !== true
    || evidence.productionDomainHeldUntilChecksPass !== true) {
    blockers.push('PREPUBLISH_GATE_NOT_ENFORCED');
  }
  if (evidence.exactHeadRequiredChecksGreen !== true) blockers.push('EXACT_HEAD_CI_NOT_GREEN');
  if (evidence.reviewedHeadSha !== evidence.candidateSha || !validSha(evidence.reviewedHeadSha)) {
    blockers.push('CODE_REVIEW_NOT_CURRENT');
  }
  if (!evidence.ownerApproval
    || evidence.ownerApproval.identityVerified !== true
    || evidence.ownerApproval.headSha !== evidence.candidateSha
    || evidence.ownerApproval.featureId !== evidence.featureId
    || evidence.ownerApproval.kind !== evidence.kind) blockers.push('OWNER_APPROVAL_MISSING');
  if (evidence.uiChanged !== false && evidence.uiChanged !== true) {
    blockers.push('OWNER_VISUAL_APPROVAL_MISSING');
  } else if (evidence.uiChanged && evidence.ownerVisualApprovedHeadSha !== evidence.candidateSha) {
    blockers.push('OWNER_VISUAL_APPROVAL_MISSING');
  }
  if (evidence.capabilityQualityQualified !== true || evidence.regressionAndDeviceTestsPassed !== true) {
    blockers.push('QUALITY_EVIDENCE_MISSING');
  }
  if (evidence.zeroCostVerified !== true || evidence.freeOnlyVerified !== true
    || evidence.actualCostUsd !== 0 || !Number.isFinite(evidence.actualCostUsd)
    || evidence.paidFallbackDisabled !== true
    || evidence.noNewPrivilegesOrSecrets !== true) blockers.push('SAFETY_EVIDENCE_MISSING');
  if (evidence.rollbackReady !== true || evidence.productionSmokeReady !== true) {
    blockers.push('POST_RELEASE_VERIFICATION_UNAVAILABLE');
  }
  return Object.freeze({
    schemaVersion: 'origin.progressive-release-preflight.v1',
    featureId: typeof evidence.featureId === 'string' ? evidence.featureId : '',
    candidateSha: typeof evidence.candidateSha === 'string' ? evidence.candidateSha : '',
    canPublish: blockers.length === 0,
    blockers: Object.freeze(blockers),
  });
}
