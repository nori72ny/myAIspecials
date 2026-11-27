import { describe, expect, it } from 'vitest';
import {
  evaluateOriginProgressiveReleasePreflightV1 as evaluate,
  type OriginProgressiveReleaseEvidenceV1,
} from './OriginProgressiveReleasePreflightV1.js';

const sha = 'b'.repeat(40);
const main = 'a'.repeat(40);
const valid = (): OriginProgressiveReleaseEvidenceV1 => ({
  featureId: 'pwa-safe-update',
  kind: 'published-feature-update',
  singleFeatureDiffVerified: true,
  candidateSha: sha,
  currentHeadSha: sha,
  baseMainSha: main,
  currentMainSha: main,
  mainProtected: true,
  requiredChecksAndReviewEnforced: true,
  productionDomainHeldUntilChecksPass: true,
  allProtectedProductionAliasesHeld: true,
  exactHeadRequiredChecksGreen: true,
  reviewedHeadSha: sha,
  uiChanged: false,
  ownerVisualApprovedHeadSha: null,
  ownerApproval: { featureId: 'pwa-safe-update', kind: 'published-feature-update', headSha: sha, identityVerified: true },
  capabilityQualityQualified: true,
  capabilityQualityEvidenceCandidateSha: sha,
  regressionAndDeviceTestsPassed: true,
  zeroCostVerified: true,
  freeOnlyVerified: true,
  actualCostUsd: 0,
  paidFallbackDisabled: true,
  noNewPrivilegesOrSecrets: true,
  rollbackReady: true,
  productionSmokeReady: true,
});

describe('Origin Progressive Release Preflight V1', () => {
  it('permits one fully reviewed, approved, protected and qualified published-feature update', () => {
    expect(evaluate(valid())).toEqual({
      schemaVersion: 'origin.progressive-release-preflight.v1',
      featureId: 'pwa-safe-update',
      candidateSha: sha,
      canPublish: true,
      blockers: [],
    });
  });

  it('also supports a new feature without waiving the same gates', () => {
    const input = valid();
    expect(evaluate({ ...input, kind: 'new-feature', ownerApproval: { ...input.ownerApproval!, kind: 'new-feature' } }).canPublish).toBe(true);
    expect(evaluate({ ...input, kind: 'new-feature' }).blockers).toContain('OWNER_APPROVAL_MISSING');
  });

  it.each([
    ['unprotected main', { mainProtected: false }, 'UNPROTECTED_MAIN'],
    ['multiple features in changed-file scope', { singleFeatureDiffVerified: false }, 'FEATURE_DIFF_SCOPE_UNVERIFIED'],
    ['UI change without owner visual approval', { uiChanged: true }, 'OWNER_VISUAL_APPROVAL_MISSING'],
    ['visual signoff on stale SHA', { uiChanged: true, ownerVisualApprovedHeadSha: main }, 'OWNER_VISUAL_APPROVAL_MISSING'],
    ['unknown UI-change classification', { uiChanged: undefined }, 'OWNER_VISUAL_APPROVAL_MISSING'],
    ['unenforced required checks', { requiredChecksAndReviewEnforced: false }, 'PREPUBLISH_GATE_NOT_ENFORCED'],
    ['auto-promoted domain without deployment hold', { productionDomainHeldUntilChecksPass: false }, 'PREPUBLISH_GATE_NOT_ENFORCED'],
    ['only primary alias held but default domains were auto-promoted', { allProtectedProductionAliasesHeld: false }, 'PREPUBLISH_GATE_NOT_ENFORCED'],
    ['failed or pending CI', { exactHeadRequiredChecksGreen: false }, 'EXACT_HEAD_CI_NOT_GREEN'],
    ['stale review', { reviewedHeadSha: main }, 'CODE_REVIEW_NOT_CURRENT'],
    ['unreviewed PR', { reviewedHeadSha: null }, 'CODE_REVIEW_NOT_CURRENT'],
    ['missing owner approval', { ownerApproval: null }, 'OWNER_APPROVAL_MISSING'],
    ['missing held-out quality', { capabilityQualityQualified: false }, 'QUALITY_EVIDENCE_MISSING'],
    ['quality tested on previous main, not candidate PR', { capabilityQualityEvidenceCandidateSha: main }, 'QUALITY_EVIDENCE_MISSING'],
    ['missing bound quality source SHA', { capabilityQualityEvidenceCandidateSha: undefined }, 'QUALITY_EVIDENCE_MISSING'],
    ['malformed bound quality SHA', { capabilityQualityEvidenceCandidateSha: 'main' }, 'QUALITY_EVIDENCE_MISSING'],
    ['device regression', { regressionAndDeviceTestsPassed: false }, 'QUALITY_EVIDENCE_MISSING'],
    ['cost unverified', { zeroCostVerified: false }, 'SAFETY_EVIDENCE_MISSING'],
    ['free-only not attested', { freeOnlyVerified: false }, 'SAFETY_EVIDENCE_MISSING'],
    ['actual paid charge', { actualCostUsd: 0.01 }, 'SAFETY_EVIDENCE_MISSING'],
    ['non-finite cost', { actualCostUsd: Number.NaN }, 'SAFETY_EVIDENCE_MISSING'],
    ['paid fallback', { paidFallbackDisabled: false }, 'SAFETY_EVIDENCE_MISSING'],
    ['privilege expansion', { noNewPrivilegesOrSecrets: false }, 'SAFETY_EVIDENCE_MISSING'],
    ['no rollback', { rollbackReady: false }, 'POST_RELEASE_VERIFICATION_UNAVAILABLE'],
    ['no real production smoke', { productionSmokeReady: false }, 'POST_RELEASE_VERIFICATION_UNAVAILABLE'],
    ['changed candidate head', { currentHeadSha: main }, 'EXACT_HEAD_MISMATCH'],
    ['main changed since base', { currentMainSha: sha }, 'EXACT_HEAD_MISMATCH'],
  ] as const)('blocks %s', (_name, mutation, reason) => {
    const report = evaluate({ ...valid(), ...mutation });
    expect(report.canPublish).toBe(false);
    expect(report.blockers).toContain(reason);
  });

  it('rejects missing or string-spoofed three-domain hold evidence', () => {
    for (const reportedHold of [undefined, null, 'true', 'approved', 1]) {
      const verdict = evaluate({
        ...valid(),
        allProtectedProductionAliasesHeld: reportedHold,
      } as unknown as OriginProgressiveReleaseEvidenceV1);
      expect(verdict.canPublish).toBe(false);
      expect(verdict.blockers).toContain('PREPUBLISH_GATE_NOT_ENFORCED');
    }
  });

  it('never substitutes main-only AQ 40-case success for the candidate exact-head quality result', () => {
    const candidate = valid();
    const staleQuality = evaluate({
      ...candidate,
      capabilityQualityQualified: true,
      capabilityQualityEvidenceCandidateSha: candidate.currentMainSha,
    });
    expect(staleQuality.canPublish).toBe(false);
    expect(staleQuality.blockers).toContain('QUALITY_EVIDENCE_MISSING');
    expect(evaluate(candidate).blockers).not.toContain('QUALITY_EVIDENCE_MISSING');
  });

  it('requires a visual approval on the exact SHA for UI-changing updates', () => {
    const input = valid();
    expect(evaluate({ ...input, uiChanged: true, ownerVisualApprovedHeadSha: sha }).canPublish).toBe(true);
    expect(evaluate({ ...input, uiChanged: true, ownerVisualApprovedHeadSha: main }).canPublish).toBe(false);
    expect(evaluate({ ...input, uiChanged: true, ownerVisualApprovedHeadSha: null }).canPublish).toBe(false);
  });

  it('forbids a superseded approval even when CI, model quality and safety all pass', () => {
    const input = valid();
    expect(evaluate({ ...input, ownerApproval: { ...input.ownerApproval!, headSha: main } }).blockers).toContain('OWNER_APPROVAL_MISSING');
    expect(evaluate({ ...input, ownerApproval: { ...input.ownerApproval!, identityVerified: false } }).blockers).toContain('OWNER_APPROVAL_MISSING');
    expect(evaluate({ ...input, ownerApproval: { ...input.ownerApproval!, featureId: 'another-feature' } }).blockers).toContain('OWNER_APPROVAL_MISSING');
  });

  it.each(['all', 'any', 'main', 'production', 'release', 'features', 'everything', 'pwa-safe-update,agent', '', 'pwa--safe', 'PWA', '../pwa'])('rejects feature scope %j', featureId => {
    expect(evaluate({ ...valid(), featureId }).blockers).toContain('INVALID_SINGLE_FEATURE_SCOPE');
  });

  it.each([null, undefined, false, true, 1, 0, '', 'approved', [], ['approved'], {}])(
    'returns BLOCKED without throwing for an invalid top-level attestation (%j)',
    evidence => {
      const verdict = evaluate(evidence as unknown as OriginProgressiveReleaseEvidenceV1);
      expect(verdict.canPublish).toBe(false);
      expect(verdict.blockers).toContain('EXACT_HEAD_MISMATCH');
      expect(verdict.blockers).toContain('OWNER_APPROVAL_MISSING');
      expect(verdict.blockers).toContain('PREPUBLISH_GATE_NOT_ENFORCED');
    },
  );

  it('rejects malformed nested approvals and absent visual state without exceptions', () => {
    const data = valid();
    for (const approval of [false, 'approved', [], { headSha: sha }, { identityVerified: true }]) {
      const verdict = evaluate({ ...data, ownerApproval: approval } as unknown as OriginProgressiveReleaseEvidenceV1);
      expect(verdict.canPublish).toBe(false);
      expect(verdict.blockers).toContain('OWNER_APPROVAL_MISSING');
    }
    expect(evaluate({ ...data, uiChanged: null } as unknown as OriginProgressiveReleaseEvidenceV1).blockers)
      .toContain('OWNER_VISUAL_APPROVAL_MISSING');
  });

  it('never accepts malformed strings in place of verified evidence booleans', () => {
    const input = valid();
    const report = evaluate({ ...input, mainProtected: 'true', zeroCostVerified: 'true', actualCostUsd: '0' } as unknown as OriginProgressiveReleaseEvidenceV1);
    expect(report.canPublish).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining(['UNPROTECTED_MAIN', 'SAFETY_EVIDENCE_MISSING']));
  });

  it('matches the currently unprotected observed ORIGIN main as BLOCKED even when every other field is passing', () => {
    expect(evaluate({ ...valid(), mainProtected: false }).canPublish).toBe(false);
  });
});
