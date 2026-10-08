/**
 * Read-only GitHub portion of ORIGIN's feature-by-feature release audit.
 * Source data must come from the GitHub API at the moment of evaluation.
 *
 * An all-green result here DOES NOT authorize a release. Deployment Checks,
 * visual signoff, owner approval, feature-scope review, rollback and cost
 * evidence are deliberately outside this function.
 */
export const REQUIRED_ORIGIN_RELEASE_CHECKS_V1 = [
  'build-and-test (22.x)',
  'build-and-test (24.x)',
  'Artifact isolation (chromium)',
  'Artifact isolation (firefox)',
  'Artifact isolation (webkit)',
  'Dependency Review',
  'Verify Quality & Code Guidelines',
  'Analyze (javascript-typescript)',
  'Scorecard Analysis',
  'CodeQL',
] as const;

export interface OriginGithubReleaseSnapshotV1 {
  readonly pull: {
    readonly state: string;
    readonly draft: boolean;
    readonly head: { readonly sha: string };
    readonly base: { readonly ref: string; readonly sha: string };
    readonly user?: { readonly login?: string };
  } | null;
  readonly main: {
    readonly protected: boolean;
    readonly commit: { readonly sha: string };
  } | null;
  readonly checks: {
    readonly total_count: number;
    readonly check_runs: readonly {
      readonly name: string;
      readonly status: string;
      readonly conclusion: string | null;
    }[];
  } | null;
  readonly reviews: readonly {
    readonly state: string;
    readonly commit_id: string | null;
    readonly user?: { readonly login?: string };
  }[] | null;
}

export type OriginGithubReleaseBlockerV1 =
  | 'GITHUB_API_EVIDENCE_MISSING'
  | 'PR_NOT_READY'
  | 'CANDIDATE_MAIN_MISMATCH'
  | 'MAIN_UNPROTECTED'
  | 'REQUIRED_CI_NOT_GREEN'
  | 'EXACT_HEAD_REVIEW_MISSING';

export interface OriginGithubReleaseAuditV1 {
  readonly schemaVersion: 'origin.github-release-audit.v1';
  readonly candidateSha: string | null;
  readonly mainSha: string | null;
  readonly missingOrFailedChecks: readonly string[];
  readonly githubReadyForFurtherReview: boolean;
  readonly blockers: readonly OriginGithubReleaseBlockerV1[];
}

const validSha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

export function auditOriginGithubReleaseSnapshotV1(input: OriginGithubReleaseSnapshotV1): OriginGithubReleaseAuditV1 {
  const pull = input?.pull;
  const main = input?.main;
  const checks = input?.checks;
  const reviews = input?.reviews;
  const candidateSha = validSha(pull?.head?.sha) ? pull.head.sha : null;
  const mainSha = validSha(main?.commit?.sha) ? main.commit.sha : null;
  const blockers: OriginGithubReleaseBlockerV1[] = [];

  if (!pull || !main || !checks || !Array.isArray(reviews)
    || !candidateSha || !mainSha
    || !Number.isSafeInteger(checks.total_count)
    || !Array.isArray(checks.check_runs)
    || checks.total_count !== checks.check_runs.length) {
    blockers.push('GITHUB_API_EVIDENCE_MISSING');
  }
  if (pull?.state !== 'open' || pull.draft !== false || pull.base?.ref !== 'main') {
    blockers.push('PR_NOT_READY');
  }
  if (!candidateSha || !mainSha || !validSha(pull?.base?.sha)
    || pull.base.sha !== mainSha || candidateSha === mainSha) {
    blockers.push('CANDIDATE_MAIN_MISMATCH');
  }
  if (main?.protected !== true) blockers.push('MAIN_UNPROTECTED');

  // Duplicate check names from old reruns must not be silently considered valid.
  // Every required result must appear once, be completed, and have conclusion success.
  const missingOrFailedChecks = REQUIRED_ORIGIN_RELEASE_CHECKS_V1.filter(name => {
    const matches = checks?.check_runs?.filter(row => row?.name === name) ?? [];
    return matches.length !== 1 || matches[0]?.status !== 'completed' || matches[0]?.conclusion !== 'success';
  });
  if (missingOrFailedChecks.length
    || checks?.check_runs?.some(row => row?.conclusion === 'failure' || row?.conclusion === 'cancelled' || row?.conclusion === 'timed_out')) {
    blockers.push('REQUIRED_CI_NOT_GREEN');
  }

  // A prior COMMENTED review or an approval on an old SHA is not a release review.
  // GitHub response identity is used; any owner visual approval is separately verified.
  const reviewed = candidateSha !== null && Array.isArray(reviews)
    && reviews.some(review => review?.state === 'APPROVED'
      && review.commit_id === candidateSha
      && Boolean(review.user?.login)
      && review.user?.login !== pull?.user?.login);
  if (!reviewed) blockers.push('EXACT_HEAD_REVIEW_MISSING');

  return Object.freeze({
    schemaVersion: 'origin.github-release-audit.v1',
    candidateSha,
    mainSha,
    missingOrFailedChecks: Object.freeze([...missingOrFailedChecks]),
    githubReadyForFurtherReview: blockers.length === 0,
    blockers: Object.freeze([...new Set(blockers)]),
  });
}
