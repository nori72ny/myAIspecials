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
  if (
    workflow === UNIFIED_WORKFLOW
    || workflow === FINAL_WORKFLOW
    || workflow === CALIBRATION_WORKFLOW
  ) {
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
  // Page through recent workflow runs so a reservation cannot disappear merely
  // because more than 30 skipped/failed runs were created after it. The API sorts
  // runs newest-first; inspect the first page that reaches beyond the quota window.
  let page = 1;
  let latest = null;
  let reachedOlderRuns = false;

  while (!reachedOlderRuns) {
    const runsUrl =
      `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/runs?per_page=100&page=${page}`;
    const runsPayload = await githubJson(runsUrl, token, fetchImpl);
    const runs = Array.isArray(runsPayload?.workflow_runs) ? runsPayload.workflow_runs : [];
    if (runs.length === 0) break;

    for (const run of runs) {
    if (!run) continue;
    if (!includeCurrentRunReservations && String(run.id) === String(currentRunId)) continue;

    const artifactsUrl =
      `https://api.github.com/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`;
    const artifactsPayload = await githubJson(artifactsUrl, token, fetchImpl);
    const artifacts = Array.isArray(artifactsPayload?.artifacts)
      ? artifactsPayload.artifacts
      : [];

    for (const artifact of artifacts) {
      if (
        !artifact
        || typeof artifact.name !== "string"
        || !reservedArtifact(artifact.name, workflow)
      ) {
        continue;
      }

      // GitHub may retain expired artifacts in the listing. They cannot represent
      // an active reservation; all valid reservations have a 2-day retention,
      // longer than this 24-hour quota window.
      if (artifact.expired === true) continue;

      const reservedAt = typeof artifact.created_at === "string" ? artifact.created_at : "";
      const reservedMs = Date.parse(reservedAt);
      // A malformed matching reservation must fail closed, not silently free quota.
      if (!Number.isFinite(reservedMs)) {
        throw new Error("AQ_LIVE_QUOTA_RESERVATION_TIMESTAMP_INVALID");
      }

      // Future timestamps are treated as reservations too (e.g. clock skew),
      // preventing malformed/future metadata from opening a quota bypass.
      const ageSeconds = Math.floor((nowMs - reservedMs) / 1000);
      if (ageSeconds >= WINDOW_SECONDS) continue;
      if (latest === null || reservedMs > Date.parse(latest)) latest = reservedAt;
    }

    // Process the whole page before stopping so even the first run older than
    // 24h is checked for an artifact created shortly after the run began.
    reachedOlderRuns = runs.some((run) => {
      const createdMs = Date.parse(typeof run?.created_at === "string" ? run.created_at : "");
      return Number.isFinite(createdMs) && createdMs < nowMs - WINDOW_SECONDS * 1000;
    });
    if (runs.length < 100) break;
    page += 1;
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
