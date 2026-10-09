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
  /** Effective main branch protection details from the authenticated GitHub API. */
  readonly mainProtection: {
    readonly required_status_checks?: { readonly strict?: boolean; readonly contexts?: readonly string[]; readonly checks?: readonly { readonly context?: string; readonly app_id?: number }[] } | null;
    readonly required_pull_request_reviews?: { readonly required_approving_review_count?: number; readonly dismiss_stale_reviews?: boolean } | null;
    readonly enforce_admins?: { readonly enabled?: boolean } | null;
    readonly allow_force_pushes?: { readonly enabled?: boolean } | null;
    readonly allow_deletions?: { readonly enabled?: boolean } | null;
  } | null;
  readonly checks: {
    readonly total_count: number;
    readonly check_runs: readonly {
      readonly name: string;
      readonly status: string;
      readonly conclusion: string | null;
      /** GitHub Checks API identifies the actual submitting GitHub App. */
      readonly app?: { readonly id?: number } | null;
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
  | 'BRANCH_RULES_UNVERIFIED'
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

function configuredCheckNames(protection: OriginGithubReleaseSnapshotV1['mainProtection']): string[] {
  const rules = protection?.required_status_checks;
  const contexts = Array.isArray(rules?.contexts) ? rules.contexts : [];
  const checks = Array.isArray(rules?.checks) ? rules.checks : [];
  return [...new Set([
    ...contexts.filter((c): c is string => typeof c === 'string'),
    ...checks.map(c => c?.context).filter((c): c is string => typeof c === 'string'),
  ])];
}

// A protected=true summary flag alone does not attest enforced CI, reviews,
// stale-approval dismissal or admin coverage. Missing 403 responses fail closed.
function verifiedMainBranchRules(protection: OriginGithubReleaseSnapshotV1['mainProtection']): boolean {
  if (!protection || typeof protection !== 'object' || Array.isArray(protection)) return false;
  const rules = protection.required_status_checks;
  const reviews = protection.required_pull_request_reviews;
  if (!rules || rules.strict !== true || !reviews
    || !Number.isInteger(reviews.required_approving_review_count)
    || (reviews.required_approving_review_count ?? 0) < 1
    || reviews.dismiss_stale_reviews !== true
    || protection.enforce_admins?.enabled !== true
    || protection.allow_force_pushes?.enabled !== false
    || protection.allow_deletions?.enabled !== false) return false;
  const required = new Set(configuredCheckNames(protection));
  return REQUIRED_ORIGIN_RELEASE_CHECKS_V1.every(name => required.has(name));
}

export function auditOriginGithubReleaseSnapshotV1(input: OriginGithubReleaseSnapshotV1): OriginGithubReleaseAuditV1 {
  const pull = input?.pull;
  const main = input?.main;
  const checks = input?.checks;
  const reviews = input?.reviews;
  const checkRows = Array.isArray(checks?.check_runs) ? checks.check_runs : [];
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
  if (!verifiedMainBranchRules(input?.mainProtection)) blockers.push('BRANCH_RULES_UNVERIFIED');

  // Duplicate check names from old reruns must not be silently considered valid.
  // Every required result must appear once, be completed, and have conclusion success.
  // Repository-enforced checks may be stricter than our built-in minimum.
  // Missing or skipped additional quality gates must also block this audit.
  const requiredNames = [...new Set([
    ...REQUIRED_ORIGIN_RELEASE_CHECKS_V1,
    ...configuredCheckNames(input?.mainProtection),
  ])];
  const boundApps = new Map<string, number>();
  for (const configured of input?.mainProtection?.required_status_checks?.checks ?? []) {
    const name = configured?.context;
    // app_id=-1 explicitly means any application may provide this check.
    // That is not sufficient evidence of an app identity for release controls.
    if (typeof name === 'string' && Number.isSafeInteger(configured?.app_id)
      && Number(configured.app_id) > 0) {
      const existing = boundApps.get(name);
      if (existing !== undefined && existing !== configured.app_id) {
        // Contradictory protection entries cannot be used as positive proof.
        boundApps.set(name, -1);
      } else {
        boundApps.set(name, Number(configured.app_id));
      }
    }
  }
  const missingOrFailedChecks = requiredNames.filter(name => {
    const matches = checkRows.filter(row => row?.name === name);
    if (matches.length !== 1 || matches[0]?.status !== 'completed'
      || matches[0]?.conclusion !== 'success') return true;
    const expectedApp = boundApps.get(name);
    return expectedApp !== undefined && matches[0]?.app?.id !== expectedApp;
  });
  if (missingOrFailedChecks.length
    || checkRows.some(row => row?.conclusion === 'failure' || row?.conclusion === 'cancelled' || row?.conclusion === 'timed_out')) {
    blockers.push('REQUIRED_CI_NOT_GREEN');
  }

  // GitHub reviews are returned oldest-first. A subsequent approval from
  // the SAME reviewer resolves that reviewer's earlier change request, but
  // another reviewer's outstanding request must still block. Comments do not
  // override an outstanding decision. Missing identities fail closed.
  const latestDecisiveReview = new Map<string, { state: string; commit_id: string | null }>();
  let unidentifiedChangeRequest = false;
  if (Array.isArray(reviews)) {
    for (const review of reviews) {
      if (!review || (review.state !== 'APPROVED' && review.state !== 'CHANGES_REQUESTED'
        && review.state !== 'DISMISSED')) continue;
      const author = review.user?.login;
      if (typeof author !== 'string' || author.length === 0) {
        if (review.state === 'CHANGES_REQUESTED') unidentifiedChangeRequest = true;
        continue;
      }
      // GitHub account login identifiers compare case-insensitively.
      latestDecisiveReview.set(author.toLowerCase(), { state: review.state, commit_id: review.commit_id });
    }
  }
  const anyChangesRequested = unidentifiedChangeRequest || [...latestDecisiveReview.values()]
    .some(review => review.state === 'CHANGES_REQUESTED');
  const requiredApprovals = input?.mainProtection?.required_pull_request_reviews?.required_approving_review_count;
  const independentApprovals = [...latestDecisiveReview].filter(([reviewer, review]) => review.state === 'APPROVED'
    && review.commit_id === candidateSha && reviewer !== pull?.user?.login?.toLowerCase()).length;
  const reviewed = candidateSha !== null && Array.isArray(reviews)
    && typeof pull?.user?.login === 'string' && pull.user.login.length > 0
    && !anyChangesRequested
    && Number.isSafeInteger(requiredApprovals) && (requiredApprovals ?? 0) >= 1
    && independentApprovals >= (requiredApprovals ?? Infinity);
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

