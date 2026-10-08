import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { auditOriginGithubReleaseSnapshotV1 as audit, REQUIRED_ORIGIN_RELEASE_CHECKS_V1 as required, type OriginGithubReleaseSnapshotV1 } from './OriginProgressiveReleaseGithubAuditV1.js';

const sha = 'b'.repeat(40);
const main = 'a'.repeat(40);
const good = (): OriginGithubReleaseSnapshotV1 => ({
  pull: { state: 'open', draft: false, head: { sha }, base: { ref: 'main', sha: main }, user: { login: 'author' } },
  main: { protected: true, commit: { sha: main } },
  mainProtection: {
    required_status_checks: { strict: true, contexts: [...required] },
    required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true },
    enforce_admins: { enabled: true }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false },
  },
  checks: { total_count: required.length, check_runs: required.map(name => ({ name, status: 'completed', conclusion: 'success' })) },
  reviews: [{ state: 'APPROVED', commit_id: sha, user: { login: 'reviewer' } }],
});

describe('live GitHub evidence audit (read-only)', () => {
  it('allows further external review only after complete checks and a current independent approval', () => {
    expect(audit(good()).githubReadyForFurtherReview).toBe(true);
  });
  it('rejects a currently unprotected main', () => {
    const input = good();
    expect(audit({ ...input, main: { ...input.main!, protected: false } }).blockers).toContain('MAIN_UNPROTECTED');
  });
  it('does not accept protected=true unless required reviews and CI are demonstrably enforced', () => {
    const input = good();
    expect(audit({ ...input, mainProtection: null }).blockers).toContain('BRANCH_RULES_UNVERIFIED');
    expect(audit({ ...input, mainProtection: { ...input.mainProtection!, required_pull_request_reviews: null } }).blockers)
      .toContain('BRANCH_RULES_UNVERIFIED');
    expect(audit({ ...input, mainProtection: {
      ...input.mainProtection!, required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: false },
    } }).blockers).toContain('BRANCH_RULES_UNVERIFIED');
    expect(audit({ ...input, mainProtection: { ...input.mainProtection!, enforce_admins: { enabled: false } } }).blockers)
      .toContain('BRANCH_RULES_UNVERIFIED');
    expect(audit({ ...input, mainProtection: { ...input.mainProtection!, allow_force_pushes: { enabled: true } } }).blockers)
      .toContain('BRANCH_RULES_UNVERIFIED');
    expect(audit({ ...input, mainProtection: { ...input.mainProtection!, allow_deletions: { enabled: true } } }).blockers)
      .toContain('BRANCH_RULES_UNVERIFIED');
    expect(audit({ ...input, mainProtection: { ...input.mainProtection!, required_status_checks: { strict: true, contexts: required.slice(1) } } }).blockers)
      .toContain('BRANCH_RULES_UNVERIFIED');
    expect(audit({ ...input, mainProtection: { ...input.mainProtection!, required_status_checks: { strict: false, contexts: [...required] } } }).blockers)
      .toContain('BRANCH_RULES_UNVERIFIED');
  });
  it('accepts official checks context objects as equivalent to string contexts', () => {
    const input = good();
    expect(audit({ ...input, mainProtection: {
      ...input.mainProtection!, required_status_checks: { strict: true, checks: required.map(context => ({ context })) },
    } }).blockers).not.toContain('BRANCH_RULES_UNVERIFIED');
  });
  it('rejects draft PRs and a changed main', () => {
    const input = good();
    expect(audit({ ...input, pull: { ...input.pull!, draft: true } }).blockers).toContain('PR_NOT_READY');
    expect(audit({ ...input, main: { protected: true, commit: { sha: 'c'.repeat(40) } } }).blockers)
      .toContain('CANDIDATE_MAIN_MISMATCH');
  });
  it('rejects old or comment-only reviews', () => {
    const input = good();
    for (const state of ['COMMENTED', 'CHANGES_REQUESTED']) {
      const reviews = [{ state, commit_id: sha, user: { login: 'reviewer' } }];
      expect(audit({ ...input, reviews }).blockers).toContain('EXACT_HEAD_REVIEW_MISSING');
    }
    expect(audit({ ...input, reviews: [{ state: 'APPROVED', commit_id: main, user: { login: 'reviewer' } }] })
      .blockers).toContain('EXACT_HEAD_REVIEW_MISSING');
  });
  it('rejects a change request despite an earlier current-SHA approval', () => {
    const snapshot = good();
    const reviews = [...snapshot.reviews!, {
      state: 'CHANGES_REQUESTED', commit_id: sha, user: { login: 'reviewer-2' },
    }];
    expect(audit({ ...snapshot, reviews }).blockers).toContain('EXACT_HEAD_REVIEW_MISSING');
  });
  it('accepts a later exact-head approval by the same reviewer after their earlier change request', () => {
    const input = good();
    const reviews = [
      { state: 'CHANGES_REQUESTED', commit_id: sha, user: { login: 'reviewer' } },
      { state: 'COMMENTED', commit_id: sha, user: { login: 'reviewer' } },
      { state: 'APPROVED', commit_id: sha, user: { login: 'reviewer' } },
    ];
    expect(audit({ ...input, reviews }).blockers).not.toContain('EXACT_HEAD_REVIEW_MISSING');
  });
  it('does not let a mere comment override outstanding changes or a different reviewer veto', () => {
    const input = good();
    expect(audit({ ...input, reviews: [
      { state: 'CHANGES_REQUESTED', commit_id: sha, user: { login: 'reviewer' } },
      { state: 'COMMENTED', commit_id: sha, user: { login: 'reviewer' } },
    ] }).blockers).toContain('EXACT_HEAD_REVIEW_MISSING');
    expect(audit({ ...input, reviews: [
      { state: 'CHANGES_REQUESTED', commit_id: sha, user: { login: 'reviewer-2' } },
      { state: 'APPROVED', commit_id: sha, user: { login: 'reviewer' } },
    ] }).blockers).toContain('EXACT_HEAD_REVIEW_MISSING');
  });
  it('a later change request invalidates an earlier approval from the same reviewer', () => {
    const input = good();
    expect(audit({ ...input, reviews: [
      { state: 'APPROVED', commit_id: sha, user: { login: 'reviewer' } },
      { state: 'CHANGES_REQUESTED', commit_id: sha, user: { login: 'reviewer' } },
    ] }).blockers).toContain('EXACT_HEAD_REVIEW_MISSING');
  });

  it('never accepts a case-variant PR author as an independent reviewer', () => {
    const input = good();
    const pull = { ...input.pull!, user: { login: 'Alice' } };
    const reviews = [{ state: 'APPROVED', commit_id: sha, user: { login: 'alice' } }];
    expect(audit({ ...input, pull, reviews }).blockers).toContain('EXACT_HEAD_REVIEW_MISSING');
  });

  it('normalizes reviewer logins across a later change request', () => {
    const input = good();
    const reviews = [
      { state: 'APPROVED', commit_id: sha, user: { login: 'Reviewer' } },
      { state: 'CHANGES_REQUESTED', commit_id: sha, user: { login: 'reviewer' } },
    ];
    expect(audit({ ...input, reviews }).blockers).toContain('EXACT_HEAD_REVIEW_MISSING');
  });

  it('rejects a missing PR author identity instead of trusting a nonempty reviewer', () => {
    const snapshot = good();
    const pull = { ...snapshot.pull!, user: undefined };
    expect(audit({ ...snapshot, pull }).blockers).toContain('EXACT_HEAD_REVIEW_MISSING');
  });
  it('rejects missing, failed, and duplicate required checks', () => {
    const input = good();
    const rows = [...input.checks!.check_runs];
    for (const check_runs of [rows.slice(1), rows.map((r, i) => i ? r : { ...r, conclusion: 'failure' }), [...rows, rows[0]]]) {
      expect(audit({ ...input, checks: { total_count: check_runs.length, check_runs } }).blockers)
        .toContain('REQUIRED_CI_NOT_GREEN');
    }
  });
  it('blocks partial API pages and malformed responses without an exception', () => {
    const input = good();
    expect(audit({ ...input, checks: { ...input.checks!, total_count: 200 } }).blockers)
      .toContain('GITHUB_API_EVIDENCE_MISSING');
    for (const value of [null, undefined, {}, [], { checks: { check_runs: 'not-array' } }]) {
      const report = audit(value as unknown as OriginGithubReleaseSnapshotV1);
      expect(report.githubReadyForFurtherReview).toBe(false);
    }
  });
  it('the standalone live audit fails closed when configuration is missing', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/audit-progressive-release-github.ts'], {
      env: { ...process.env, GITHUB_REPOSITORY: '', ORIGIN_AUDIT_PR_NUMBER: '' },
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('BLOCKED');
  });
});
