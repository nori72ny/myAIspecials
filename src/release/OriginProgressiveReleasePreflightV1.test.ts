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
  candidateSha: sha,
  currentHeadSha: sha,
  baseMainSha: main,
  currentMainSha: main,
  mainProtected: true,
  requiredChecksAndReviewEnforced: true,
  productionDomainHeldUntilChecksPass: true,
  exactHeadRequiredChecksGreen: true,
  reviewedHeadSha: sha,
  ownerApproval: { featureId: 'pwa-safe-update', kind: 'published-feature-update', headSha: sha, identityVerified: true },
  capabilityQualityQualified: true,
  regressionAndDeviceTestsPassed: true,
  zeroCostVerified: true,
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
    ['unenforced required checks', { requiredChecksAndReviewEnforced: false }, 'PREPUBLISH_GATE_NOT_ENFORCED'],
    ['auto-promoted domain without deployment hold', { productionDomainHeldUntilChecksPass: false }, 'PREPUBLISH_GATE_NOT_ENFORCED'],
    ['failed or pending CI', { exactHeadRequiredChecksGreen: false }, 'EXACT_HEAD_CI_NOT_GREEN'],
    ['stale review', { reviewedHeadSha: main }, 'CODE_REVIEW_NOT_CURRENT'],
    ['unreviewed PR', { reviewedHeadSha: null }, 'CODE_REVIEW_NOT_CURRENT'],
    ['missing owner approval', { ownerApproval: null }, 'OWNER_APPROVAL_MISSING'],
    ['missing held-out quality', { capabilityQualityQualified: false }, 'QUALITY_EVIDENCE_MISSING'],
    ['device regression', { regressionAndDeviceTestsPassed: false }, 'QUALITY_EVIDENCE_MISSING'],
    ['cost unverified', { zeroCostVerified: false }, 'SAFETY_EVIDENCE_MISSING'],
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

  it('forbids a superseded approval even when CI, model quality and safety all pass', () => {
    const input = valid();
    expect(evaluate({ ...input, ownerApproval: { ...input.ownerApproval!, headSha: main } }).blockers).toContain('OWNER_APPROVAL_MISSING');
    expect(evaluate({ ...input, ownerApproval: { ...input.ownerApproval!, identityVerified: false } }).blockers).toContain('OWNER_APPROVAL_MISSING');
    expect(evaluate({ ...input, ownerApproval: { ...input.ownerApproval!, featureId: 'another-feature' } }).blockers).toContain('OWNER_APPROVAL_MISSING');
  });

  it.each(['all', 'pwa-safe-update,agent', '', 'pwa--safe', 'PWA', '../pwa'])('rejects feature scope %j', featureId => {
    expect(evaluate({ ...valid(), featureId }).blockers).toContain('INVALID_SINGLE_FEATURE_SCOPE');
  });

  it('never accepts malformed strings in place of verified evidence booleans', () => {
    const input = valid();
    const report = evaluate({ ...input, mainProtected: 'true', zeroCostVerified: 'true' } as unknown as OriginProgressiveReleaseEvidenceV1);
    expect(report.canPublish).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining(['UNPROTECTED_MAIN', 'SAFETY_EVIDENCE_MISSING']));
  });

  it('matches the currently unprotected observed ORIGIN main as BLOCKED even when every other field is passing', () => {
    expect(evaluate({ ...valid(), mainProtected: false }).canPublish).toBe(false);
  });
});
