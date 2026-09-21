import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const GITHUB_API_VERSION = '2026-03-10';
const PROVIDER_WORKFLOWS = Object.freeze([
  'coding-job-worker-v14.yml',
  'held-out-coding-benchmark-v14.yml',
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`HELD_OUT_FINAL_FREE_WINDOW_ENV_MISSING:${name}`);
  return value;
}

function ageMs(timestamp, nowMs) {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? nowMs - parsed : Number.POSITIVE_INFINITY;
}

function isRecent(timestamp, nowMs) {
  const age = ageMs(timestamp, nowMs);
  return age >= 0 && age < WINDOW_MS;
}

function providerArtifact(name) {
  return name === 'aq-live-quota-reservation'
    || /^origin-held-out-/.test(name);
}

async function jsonResponse(response, codePrefix) {
  if (!response.ok) throw new Error(`${codePrefix}_HTTP_${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${codePrefix}_JSON_INVALID`);
  }
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
}

export async function verifyOpenRouterFreeTier({ apiKey, fetchImpl = fetch }) {
  const response = await fetchImpl('https://openrouter.ai/api/v1/key', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await jsonResponse(response, 'HELD_OUT_FINAL_OPENROUTER_KEY');
  const data = payload?.data;
  if (!data || data.is_free_tier !== true) {
    throw new Error('HELD_OUT_FINAL_OPENROUTER_NOT_FREE_TIER');
  }
  if (data.is_management_key === true || data.is_provisioning_key === true) {
    throw new Error('HELD_OUT_FINAL_OPENROUTER_KEY_ROLE_INVALID');
  }
  return Object.freeze({ freeTier: true });
}

async function githubJson(url, token, fetchImpl, allow404 = false) {
  const response = await fetchImpl(url, {
    headers: githubHeaders(token),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (allow404 && response.status === 404) return null;
  return jsonResponse(response, 'HELD_OUT_FINAL_GITHUB');
}

export async function recentProviderArtifacts({
  repository,
  currentRunId,
  token,
  nowMs = Date.now(),
  fetchImpl = fetch,
}) {
  const recent = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = `https://api.github.com/repos/${repository}/actions/artifacts?per_page=100&page=${page}`;
    const payload = await githubJson(url, token, fetchImpl);
    const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
    for (const artifact of artifacts) {
      const name = typeof artifact?.name === 'string' ? artifact.name : '';
      const createdAt = typeof artifact?.created_at === 'string' ? artifact.created_at : '';
      const runId = artifact?.workflow_run?.id;
      if (!providerArtifact(name) || String(runId ?? '') === String(currentRunId) || !isRecent(createdAt, nowMs)) continue;
      recent.push(Object.freeze({ kind: 'artifact', name, createdAt, runId: String(runId ?? '') }));
    }
    const totalCount = Number(payload?.total_count ?? 0);
    if (artifacts.length < 100 || page * 100 >= totalCount) break;
  }
  return Object.freeze(recent);
}

export async function recentProviderWorkflowRuns({
  repository,
  currentRunId,
  token,
  nowMs = Date.now(),
  fetchImpl = fetch,
}) {
  const recent = [];
  for (const workflow of PROVIDER_WORKFLOWS) {
    const url = `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/runs?per_page=30`;
    const payload = await githubJson(url, token, fetchImpl, true);
    if (payload === null) continue;
    const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
    for (const run of runs) {
      const createdAt = typeof run?.created_at === 'string' ? run.created_at : '';
      if (
        String(run?.id ?? '') === String(currentRunId)
        || run?.conclusion === 'skipped'
        || !isRecent(createdAt, nowMs)
      ) continue;
      recent.push(Object.freeze({
        kind: 'workflow',
        name: workflow,
        createdAt,
        runId: String(run?.id ?? ''),
      }));
    }
  }
  return Object.freeze(recent);
}

export async function checkFinalHeldoutFreeWindow({
  repository,
  currentRunId,
  token,
  apiKey,
  nowMs = Date.now(),
  fetchImpl = fetch,
}) {
  await verifyOpenRouterFreeTier({ apiKey, fetchImpl });
  const [artifacts, workflows] = await Promise.all([
    recentProviderArtifacts({ repository, currentRunId, token, nowMs, fetchImpl }),
    recentProviderWorkflowRuns({ repository, currentRunId, token, nowMs, fetchImpl }),
  ]);
  const conflicts = [...artifacts, ...workflows].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const latest = conflicts.at(-1) ?? null;
  const nextAllowedAt = latest === null
    ? null
    : new Date(Date.parse(latest.createdAt) + WINDOW_MS).toISOString();
  return Object.freeze({
    allowed: conflicts.length === 0,
    conflicts: Object.freeze(conflicts),
    nextAllowedAt,
  });
}

async function main() {
  const repository = required('GITHUB_REPOSITORY');
  const currentRunId = required('GITHUB_RUN_ID');
  const token = required('GH_TOKEN');
  const apiKey = required('OPENROUTER_API_KEY');
  const output = process.env.GITHUB_OUTPUT?.trim() || '';

  const result = await checkFinalHeldoutFreeWindow({
    repository,
    currentRunId,
    token,
    apiKey,
  });

  if (output) {
    await appendFile(output, `allowed=${result.allowed ? 'true' : 'false'}\n`, 'utf8');
    await appendFile(output, `next_allowed_at=${result.nextAllowedAt ?? ''}\n`, 'utf8');
  }

  if (!result.allowed) {
    process.stderr.write(`HELD_OUT_FINAL_FREE_WINDOW_BUSY:${result.nextAllowedAt ?? 'unknown'}\n`);
    process.exitCode = 2;
    return;
  }

  process.stdout.write('Final held-out free-provider window is clear.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'HELD_OUT_FINAL_FREE_WINDOW_FAILED'}\n`);
    process.exitCode = 1;
  });
}
