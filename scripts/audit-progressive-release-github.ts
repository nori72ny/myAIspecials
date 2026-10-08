/**
 * Read-only GitHub release audit. Example:
 * GITHUB_REPOSITORY=owner/repo ORIGIN_AUDIT_PR_NUMBER=123 GH_TOKEN=... \
 *   npx tsx scripts/audit-progressive-release-github.ts
 *
 * This command cannot publish or approve a deployment. Missing API permissions
 * and incomplete responses always produce BLOCKED; never print auth headers.
 */
import { auditOriginGithubReleaseSnapshotV1, type OriginGithubReleaseSnapshotV1 } from '../src/release/OriginProgressiveReleaseGithubAuditV1.js';

const repo = process.env.GITHUB_REPOSITORY ?? '';
const prNumber = process.env.ORIGIN_AUDIT_PR_NUMBER ?? '';
if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)
  || !/^[1-9][0-9]{0,6}$/.test(prNumber)) {
  console.error('BLOCKED: supply GITHUB_REPOSITORY and ORIGIN_AUDIT_PR_NUMBER.');
  process.exitCode = 2;
} else {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ORIGIN-progressive-release-auditor',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const base = `https://api.github.com/repos/${repo}`;
  const validSha = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s);
  const getJson = async (path: string): Promise<unknown> => {
    try {
      const response = await fetch(`${base}${path}`, { headers, redirect: 'error', signal: AbortSignal.timeout(12000) });
      // Do not treat access errors, redirects or paginated responses as verified evidence.
      if (!response.ok || response.headers.has('link') && /rel="next"/.test(response.headers.get('link') ?? '')) return null;
      return await response.json();
    } catch {
      return null;
    }
  };
  const [pull, main, reviews] = await Promise.all([
    getJson(`/pulls/${prNumber}`),
    getJson('/branches/main'),
    getJson(`/pulls/${prNumber}/reviews?per_page=100`),
  ]);
  const maybeSha = (pull as { head?: { sha?: unknown } } | null)?.head?.sha;
  const checks = validSha(maybeSha)
    ? await getJson(`/commits/${maybeSha}/check-runs?per_page=100`) : null;
  const snapshot: OriginGithubReleaseSnapshotV1 = {
    pull: pull as OriginGithubReleaseSnapshotV1['pull'],
    main: main as OriginGithubReleaseSnapshotV1['main'],
    reviews: reviews as OriginGithubReleaseSnapshotV1['reviews'],
    checks: checks as OriginGithubReleaseSnapshotV1['checks'],
  };
  const result = auditOriginGithubReleaseSnapshotV1(snapshot);
  console.log(JSON.stringify({
    ...result,
    // An audited GitHub snapshot NEVER proves Vercel Deployment Checks,
    // identity-bound owner approval, measured zero cost or production smoke.
    finalProductionAuthorization: false,
    missingExternalGates: ['VERCEL_DEPLOYMENT_CHECKS', 'OWNER_APPROVAL', 'INDEPENDENT_QUALITY', 'ZERO_COST', 'PRODUCTION_SMOKE'],
  }, null, 2));
  if (!result.githubReadyForFurtherReview) process.exitCode = 2;
}
