import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const WINDOW_SECONDS = 86_400;
const API_PAGE_SIZE = 100;
const MAX_API_PAGES = 10;
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

async function githubJsonPages(url, arrayKey, token, fetchImpl = fetch) {
  const collected = [];

  for (let page = 1; page <= MAX_API_PAGES; page += 1) {
    const separator = url.includes("?") ? "&" : "?";
    const pageUrl = `${url}${separator}per_page=${API_PAGE_SIZE}&page=${page}`;
    const payload = await githubJson(pageUrl, token, fetchImpl);
    const items = payload?.[arrayKey];

    if (!Array.isArray(items)) {
      throw new Error(`AQ_LIVE_QUOTA_GITHUB_INVALID_LIST:${arrayKey}`);
    }

    collected.push(...items);
    if (items.length < API_PAGE_SIZE) return collected;
  }

  // A full final page does not prove the scan is complete. Fail closed rather
  // than authorizing a live request when more reservation records may exist.
  throw new Error(`AQ_LIVE_QUOTA_GITHUB_PAGE_LIMIT:${arrayKey}`);
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
  // Do not use the created filter here. A run may have been created more
  // than 24 hours ago, remain queued, and only start/upload its reservation
  // recently. A long-running run may also complete after its reservation was
  // created. Scan the unfiltered run list and fail closed if the bounded scan
  // cannot prove completeness.
  const runsUrl =
    `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/runs`;
  const runs = await githubJsonPages(runsUrl, "workflow_runs", token, fetchImpl);
  const uniqueRuns = new Map();
  for (const run of runs) {
    if (!run || run.id == null) {
      throw new Error("AQ_LIVE_QUOTA_GITHUB_INVALID_RUN");
    }
    uniqueRuns.set(String(run.id), run);
  }
  let latest = null;
  const cutoffMs = nowMs - WINDOW_SECONDS * 1000;

  for (const run of uniqueRuns.values()) {
    if (!includeCurrentRunReservations && String(run.id) === String(currentRunId)) continue;

    // Enumerate run metadata broadly, but fetch artifacts only for runs that
    // could plausibly contain a reservation created inside the active window.
    // Missing/unparseable timestamps are not grounds to skip a run.
    const createdMs = Date.parse(typeof run.created_at === "string" ? run.created_at : "");
    const startedMs = Date.parse(typeof run.run_started_at === "string" ? run.run_started_at : "");
    const updatedMs = Date.parse(typeof run.updated_at === "string" ? run.updated_at : "");
    const active = run.status === "queued" || run.status === "in_progress";
    const recentMetadata = [createdMs, startedMs, updatedMs].some(
      (value) => Number.isFinite(value) && value >= cutoffMs && value <= nowMs,
    );
    if (!active && !recentMetadata
      && Number.isFinite(createdMs) && Number.isFinite(startedMs) && Number.isFinite(updatedMs)) {
      continue;
    }

    const artifactsUrl =
      `https://api.github.com/repos/${repository}/actions/runs/${run.id}/artifacts`;
    const artifacts = await githubJsonPages(artifactsUrl, "artifacts", token, fetchImpl);

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
