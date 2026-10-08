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
  /** Exact evaluated candidate HEAD, bound to trusted independent quality evidence.
   * A successful main-only benchmark for some other SHA never qualifies this PR.
   * Never populate from PR comments, browser state, or unverifiable metadata. */
  readonly capabilityQualityEvidenceCandidateSha: string;
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
  // A malformed, missing or array-shaped attestation must return BLOCKED rather
  // than throwing. This routine never authenticates evidence on its own.
  const input: OriginProgressiveReleaseEvidenceV1 = evidence
    && typeof evidence === 'object' && !Array.isArray(evidence)
    ? evidence : {} as OriginProgressiveReleaseEvidenceV1;
  const blockers: OriginProgressiveReleaseBlocker[] = [];
  if (!validFeature(input.featureId)
    || (input.kind !== 'new-feature' && input.kind !== 'published-feature-update')) {
    blockers.push('INVALID_SINGLE_FEATURE_SCOPE');
  }
  if (input.singleFeatureDiffVerified !== true) blockers.push('FEATURE_DIFF_SCOPE_UNVERIFIED');
  if (!validSha(input.candidateSha)
    || !validSha(input.currentHeadSha)
    || !validSha(input.baseMainSha)
    || !validSha(input.currentMainSha)
    || input.candidateSha !== input.currentHeadSha
    || input.baseMainSha !== input.currentMainSha) {
    blockers.push('EXACT_HEAD_MISMATCH');
  }
  if (input.mainProtected !== true) blockers.push('UNPROTECTED_MAIN');
  if (input.requiredChecksAndReviewEnforced !== true
    || input.productionDomainHeldUntilChecksPass !== true) {
    blockers.push('PREPUBLISH_GATE_NOT_ENFORCED');
  }
  if (input.exactHeadRequiredChecksGreen !== true) blockers.push('EXACT_HEAD_CI_NOT_GREEN');
  if (input.reviewedHeadSha !== input.candidateSha || !validSha(input.reviewedHeadSha)) {
    blockers.push('CODE_REVIEW_NOT_CURRENT');
  }
  if (!input.ownerApproval
    || input.ownerApproval.identityVerified !== true
    || input.ownerApproval.headSha !== input.candidateSha
    || input.ownerApproval.featureId !== input.featureId
    || input.ownerApproval.kind !== input.kind) blockers.push('OWNER_APPROVAL_MISSING');
  if (input.uiChanged !== false && input.uiChanged !== true) {
    blockers.push('OWNER_VISUAL_APPROVAL_MISSING');
  } else if (input.uiChanged && input.ownerVisualApprovedHeadSha !== input.candidateSha) {
    blockers.push('OWNER_VISUAL_APPROVAL_MISSING');
  }
  if (input.capabilityQualityQualified !== true
    || !validSha(input.capabilityQualityEvidenceCandidateSha)
    || input.capabilityQualityEvidenceCandidateSha !== input.candidateSha
    || input.regressionAndDeviceTestsPassed !== true) {
    blockers.push('QUALITY_EVIDENCE_MISSING');
  }
  if (input.zeroCostVerified !== true || input.freeOnlyVerified !== true
    || input.actualCostUsd !== 0 || !Number.isFinite(input.actualCostUsd)
    || input.paidFallbackDisabled !== true
    || input.noNewPrivilegesOrSecrets !== true) blockers.push('SAFETY_EVIDENCE_MISSING');
  if (input.rollbackReady !== true || input.productionSmokeReady !== true) {
    blockers.push('POST_RELEASE_VERIFICATION_UNAVAILABLE');
  }
  return Object.freeze({
    schemaVersion: 'origin.progressive-release-preflight.v1',
    featureId: typeof input.featureId === 'string' ? input.featureId : '',
    candidateSha: typeof input.candidateSha === 'string' ? input.candidateSha : '',
    canPublish: blockers.length === 0,
    blockers: Object.freeze(blockers),
  });
}
