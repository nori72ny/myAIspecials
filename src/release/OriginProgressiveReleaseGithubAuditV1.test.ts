import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { auditOriginGithubReleaseSnapshotV1 as audit, REQUIRED_ORIGIN_RELEASE_CHECKS_V1 as required, type OriginGithubReleaseSnapshotV1 } from './OriginProgressiveReleaseGithubAuditV1.js';

const sha = 'b'.repeat(40);
const main = 'a'.repeat(40);
const good = (): OriginGithubReleaseSnapshotV1 => ({
  pull: { state: 'open', draft: false, head: { sha }, base: { ref: 'main', sha: main }, user: { login: 'author' } },
  main: { protected: true, commit: { sha: main } },
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
