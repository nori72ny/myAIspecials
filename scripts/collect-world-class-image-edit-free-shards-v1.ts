import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const RUN_ID = /^[1-9][0-9]{0,19}$/;
const REPO = 'nori72ny/myAIspecials';
const WORKFLOW_PATH = '.github/workflows/world-class-image-edit-private-shards-v1.yml';
const NUM_SHARDS = 8;

type Artifact = {
  name?: string;
  expired?: boolean;
  created_at?: string;
  workflow_run?: { id?: number; head_sha?: string };
  digest?: string;
};
type ActionRun = {
  id?: number;
  head_sha?: string;
  head_branch?: string;
  event?: string;
  path?: string;
  status?: string;
  conclusion?: string;
  run_attempt?: number;
};
function assert(value: unknown, error: string): asserts value {
  if (!value) throw new Error('IMAGE_GH_PROVENANCE_' + error);
}
function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error('IMAGE_GH_PROVENANCE_ENV_' + name);
  return v;
}
async function api<T>(endpoint: string, token: string): Promise<T> {
  const response = await fetch('https://api.github.com/repos/' + REPO + endpoint, {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(25_000),
  });
  assert(response.ok, 'GITHUB_READ_FAILED');
  return (await response.json()) as T;
}
async function main() {
  const sha = required('ORIGIN_IMAGE_EDIT_CANDIDATE_SHA').toLowerCase();
  const corpus = required('ORIGIN_IMAGE_EDIT_CORPUS_DIGEST').toLowerCase();
  const plan = required('ORIGIN_IMAGE_EDIT_SHARD_PLAN_DIGEST').toLowerCase();
  const githubToken = required('GH_TOKEN');
  const outputRoot = path.resolve(required('ORIGIN_IMAGE_EDIT_SHARD_BUNDLE_ROOT'));
  assert(SHA40.test(sha) && SHA64.test(corpus) && SHA64.test(plan), 'INPUT_DIGEST_INVALID');
  assert(process.env.GITHUB_REPOSITORY === REPO
    && process.env.GITHUB_REF === 'refs/heads/main'
    && process.env.GITHUB_SHA === sha,
  'TRUSTED_RUNNER_EXACT_MAIN_REQUIRED');

  await fs.mkdir(outputRoot, { recursive: true, mode: 0o700 });
  assert((await fs.readdir(outputRoot)).length === 0, 'OUTPUT_ROOT_MUST_BE_EMPTY');
  const seenRuns = new Set<number>();
  const seenDays = new Set<string>();
  const downloaded: {
    shardIndex: number; githubRunId: number; markerName: string;
    outputArtifactName: string; artifactDigest: string; utcDay: string;
  }[] = [];

  for (let i = 0; i < NUM_SHARDS; i++) {
    const markerName = 'origin-image-free-edit-shard-started-' + sha + '-' + corpus + '-' + i;
    const matches = await api<{ total_count: number; artifacts: Artifact[] }>(
      '/actions/artifacts?name=' + encodeURIComponent(markerName) + '&per_page=5', githubToken);
    assert(matches.total_count === 1 && matches.artifacts?.length === 1,
      'MISSING_OR_DUPLICATE_START_MARKER');
    const marker = matches.artifacts[0];
    assert(marker.name === markerName && marker.expired === false,
      'START_MARKER_INVALID_OR_EXPIRED');
    const runId = marker.workflow_run?.id;
    assert(Number.isSafeInteger(runId) && Number(runId) > 0 && RUN_ID.test(String(runId)),
      'START_MARKER_RUN_ID_INVALID');
    assert(!seenRuns.has(runId!), 'DUPLICATE_RUN');
    const run = await api<ActionRun>('/actions/runs/' + runId, githubToken);
    assert(run.id === runId && run.head_sha === sha && run.head_branch === 'main'
      && run.event === 'workflow_dispatch' && run.status === 'completed'
      && run.conclusion === 'success' && run.run_attempt === 1
      && typeof run.path === 'string' && run.path.split('@')[0] === WORKFLOW_PATH,
    'WORKFLOW_RUN_UNTRUSTED_OR_FAILED');
    const day = typeof marker.created_at === 'string' ? marker.created_at.slice(0, 10) : '';
    const parsed = new Date(day + 'T00:00:00.000Z');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(parsed.getTime())
      && parsed.toISOString().slice(0, 10) === day && !seenDays.has(day),
    'SHARD_UTC_DAY_DUPLICATE_OR_INVALID');
    seenRuns.add(runId!);
    seenDays.add(day);

    const result = await api<{ total_count: number; artifacts: Artifact[] }>(
      '/actions/runs/' + runId + '/artifacts?per_page=100', githubToken);
    assert(result.total_count <= 100 && Array.isArray(result.artifacts), 'ARTIFACTS_INCOMPLETE');
    const outputName = 'origin-image-free-edit-shard-output-' + sha + '-' + i + '-' + runId;
    const matchesOutput = result.artifacts.filter(x => x.name === outputName && x.expired === false);
    assert(matchesOutput.length === 1
      && result.artifacts.some(x => x.name === markerName && x.expired === false),
    'TRUSTED_ARTIFACTS_MISSING');
    const archiveDigest = matchesOutput[0].digest;
    assert(typeof archiveDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(archiveDigest),
      'GITHUB_ARTIFACT_DIGEST_MISSING');

    const destination = path.join(outputRoot, 'shard-' + i);
    await fs.mkdir(destination, { recursive: false, mode: 0o700 });
    // The official GitHub CLI downloads the exact named artifact from the validated run.
    // Never execute downloaded files; they are passed only to read-only JSON/image digest checks.
    execFileSync('gh', ['run', 'download', String(runId), '--repo', REPO,
      '--name', outputName, '--dir', destination], {
      encoding: 'utf8',
      timeout: 180_000,
      env: { ...process.env, GH_TOKEN: githubToken },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    downloaded.push({
      shardIndex: i, githubRunId: runId!, markerName,
      outputArtifactName: outputName, artifactDigest: archiveDigest, utcDay: day,
    });
  }
  assert(downloaded.length === NUM_SHARDS && seenRuns.size === NUM_SHARDS
    && seenDays.size === NUM_SHARDS, 'INCOMPLETE_SHARD_PROVENANCE');
  // This collector does not pronounce visual superiority or actual Cloudflare remaining quota.
  await fs.writeFile(path.join(outputRoot, 'github-provenance.json'), JSON.stringify({
    schemaVersion: 'origin.image-free-edit-shard-github-provenance.v1',
    candidateSha: sha, corpusDigest: corpus, planDigest: plan,
    editCaseCountRequired: 16,
    usesExactV16EditingRoute: true,
    trustedGithubRunAndArtifactMetadata: true,
    downloadedViaAuthenticatedGithubCLI: true,
    imageBytesLocallyVerified: false,
    cloudflareFreeQuotaIndependentlyVerified: false,
    independentBlindQualityPassed: false,
    ownerVisualApproved: false,
    productionQualified: false,
    shards: downloaded,
  }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(JSON.stringify({
    event: 'image-free-edit-shards-collected',
    candidateSha: sha, distinctRuns: seenRuns.size, distinctUtcDays: seenDays.size,
    nextStep: 'npm run eval:image-edit-private-shards-verify',
    productionQualified: false,
  }) + '\n');
}
main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : '';
  process.stderr.write((/^IMAGE_GH_PROVENANCE_[A-Z0-9_:]{3,160}$/.test(code)
    ? code : 'IMAGE_GH_PROVENANCE_COLLECTION_FAILED') + '\n');
  process.exitCode = 1;
});
