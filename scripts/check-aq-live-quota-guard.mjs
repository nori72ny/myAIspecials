import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const WINDOW_SECONDS = 86_400;
const UNIFIED_WORKFLOW = "aq-live-lane-shard.yml";
const LEGACY_WORKFLOW = "aq-live-research-shard.yml";
const FINAL_WORKFLOW = "q1-final-aq.yml";
const CALIBRATION_WORKFLOW = "aq-free-provider-calibration.yml";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`AQ_LIVE_QUOTA_ENV_MISSING:${name}`);
  return value;
}

function headers(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubJson(url, token, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: headers(token),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`AQ_LIVE_QUOTA_GITHUB_HTTP_${response.status}`);
  return response.json();
}

function reservedArtifact(name, workflow) {
  if (workflow === UNIFIED_WORKFLOW || workflow === FINAL_WORKFLOW || workflow === CALIBRATION_WORKFLOW) {
    return name === "aq-live-quota-reservation";
  }
  if (workflow === LEGACY_WORKFLOW) return name.startsWith("aq-live-research-shard");
  return false;
}

export async function latestReservedAt({
  repository,
  workflow,
  currentRunId,
  token,
  includeCurrentRunReservations = false,
  nowMs = Date.now(),
  fetchImpl = fetch,
}) {
  const runs = [];
  for (let page = 1; ; page += 1) {
    const runsUrl = `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/runs?per_page=100&page=${page}`;
    const runsPayload = await githubJson(runsUrl, token, fetchImpl);
    const pageRuns = Array.isArray(runsPayload?.workflow_runs) ? runsPayload.workflow_runs : [];
    runs.push(...pageRuns);
    if (pageRuns.length < 100) break;
  }
  let latest = null;

  for (const run of runs) {
    if (!run) continue;
    if (!includeCurrentRunReservations && String(run.id) === String(currentRunId)) continue;

    const artifacts = [];
    for (let page = 1; ; page += 1) {
      const artifactsUrl = `https://api.github.com/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100&page=${page}`;
      const artifactsPayload = await githubJson(artifactsUrl, token, fetchImpl);
      const pageArtifacts = Array.isArray(artifactsPayload?.artifacts) ? artifactsPayload.artifacts : [];
      artifacts.push(...pageArtifacts);
      if (pageArtifacts.length < 100) break;
    }

    for (const artifact of artifacts) {
      if (
        !artifact
        || typeof artifact.name !== "string"
        || !reservedArtifact(artifact.name, workflow)
      ) {
        continue;
      }

      const reservedAt = typeof artifact.created_at === "string" ? artifact.created_at : "";
      const reservedMs = Date.parse(reservedAt);
      if (!Number.isFinite(reservedMs)) continue;

      const ageSeconds = Math.floor((nowMs - reservedMs) / 1000);
      if (ageSeconds < 0 || ageSeconds >= WINDOW_SECONDS) continue;
      if (latest === null || reservedMs > Date.parse(latest)) latest = reservedAt;
    }
  }

  return latest;
}

export async function checkLiveQuota({
  repository,
  currentRunId,
  token,
  includeCurrentRunReservations = false,
  nowMs = Date.now(),
  fetchImpl = fetch,
}) {
  const reservations = await Promise.all(
    [UNIFIED_WORKFLOW, LEGACY_WORKFLOW, FINAL_WORKFLOW, CALIBRATION_WORKFLOW].map((workflow) =>
      latestReservedAt({
        repository,
        workflow,
        currentRunId,
        token,
        includeCurrentRunReservations,
        nowMs,
        fetchImpl,
      })
    ),
  );

  const candidates = reservations.filter(Boolean).sort();
  const previous = candidates.at(-1) ?? null;
  const previousMs = previous === null ? null : Date.parse(previous);
  const nextAllowedAt = previousMs === null
    ? null
    : new Date(previousMs + WINDOW_SECONDS * 1000).toISOString();
  const remainingSeconds = previousMs === null
    ? 0
    : Math.max(
        0,
        Math.ceil((previousMs + WINDOW_SECONDS * 1000 - nowMs) / 1000),
      );

  return Object.freeze({
    allowed: previous === null,
    previousReservedAt: previous,
    nextAllowedAt,
    remainingSeconds,
  });
}

async function main() {
  const repository = required("GITHUB_REPOSITORY");
  const currentRunId = required("GITHUB_RUN_ID");
  const token = required("GITHUB_TOKEN");
  const output = required("GITHUB_OUTPUT");
  const includeCurrentRunReservations =
    process.env.AQ_LIVE_INCLUDE_CURRENT_RUN_RESERVATIONS?.trim() === "true";

  const result = await checkLiveQuota({
    repository,
    currentRunId,
    token,
    includeCurrentRunReservations,
  });

  await appendFile(output, `allowed=${result.allowed ? "true" : "false"}\n`, "utf8");
  await appendFile(output, `next_allowed_at=${result.nextAllowedAt ?? ""}\n`, "utf8");
  await appendFile(output, `remaining_seconds=${result.remainingSeconds}\n`, "utf8");

  if (result.allowed) {
    process.stdout.write("Live AQ provider quota is available.\n");
  } else {
    process.stdout.write(
      `Live AQ provider execution skipped until ${result.nextAllowedAt}; ${result.remainingSeconds}s remain.\n`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "AQ_LIVE_QUOTA_GUARD_FAILED"}\n`,
    );
    process.exitCode = 1;
  });
}
