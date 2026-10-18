import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const WINDOW_SECONDS = 86_400;
const MAX_API_PAGES = 20;
const UNIFIED_WORKFLOW = "aq-live-lane-shard.yml";
const LEGACY_WORKFLOW = "aq-live-research-shard.yml";
const FINAL_WORKFLOW = "q1-final-aq.yml";
const CALIBRATION_WORKFLOW = "aq-free-provider-calibration.yml";
const RESERVED_WORKFLOWS = new Set([UNIFIED_WORKFLOW, LEGACY_WORKFLOW, FINAL_WORKFLOW, CALIBRATION_WORKFLOW]);

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

function workflowFilename(path) {
  if (typeof path !== "string" || !path.startsWith(".github/workflows/")) return null;
  // GitHub may append a ref after '@' to the workflow path in run metadata.
  const filePath = path.split("@", 1)[0];
  const filename = filePath.slice(".github/workflows/".length);
  return filename.includes("/") ? null : filename;
}

function reservedArtifact(name, workflow) {
  if (workflow === UNIFIED_WORKFLOW || workflow === FINAL_WORKFLOW || workflow === CALIBRATION_WORKFLOW) {
    return name === "aq-live-quota-reservation";
  }
  if (workflow === LEGACY_WORKFLOW) return name.startsWith("aq-live-research-shard");
  return false;
}

function validateRuns(payload) {
  if (!payload || !Array.isArray(payload.workflow_runs)) {
    throw new Error("AQ_LIVE_QUOTA_INVALID_WORKFLOW_RUNS_PAYLOAD");
  }
  for (const run of payload.workflow_runs) {
    if (!run || (typeof run.id !== "number" && typeof run.id !== "string")
      || typeof run.created_at !== "string" || !Number.isFinite(Date.parse(run.created_at))
      || typeof run.path !== "string") {
      throw new Error("AQ_LIVE_QUOTA_INVALID_WORKFLOW_RUN_ENTRY");
    }
  }
  return payload.workflow_runs;
}

async function reservationForRun({ repository, run, workflow, currentRunId, includeCurrentRunReservations, token, nowMs, fetchImpl }) {
  if (!includeCurrentRunReservations && String(run.id) === String(currentRunId)) return null;
  let latest = null;
  for (let page = 1; ; page += 1) {
    const url = `https://api.github.com/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100&page=${page}`;
    const payload = await githubJson(url, token, fetchImpl);
    if (!payload || !Array.isArray(payload.artifacts)) {
      throw new Error("AQ_LIVE_QUOTA_INVALID_ARTIFACTS_PAYLOAD");
    }
    for (const artifact of payload.artifacts) {
      if (!artifact || typeof artifact.name !== "string" || !reservedArtifact(artifact.name, workflow)) continue;
      const reservedAt = typeof artifact.created_at === "string" ? artifact.created_at : "";
      const reservedMs = Date.parse(reservedAt);
      if (!Number.isFinite(reservedMs)) throw new Error("AQ_LIVE_QUOTA_INVALID_RESERVATION_TIMESTAMP");
      const ageMs = nowMs - reservedMs;
      if (ageMs < 0) throw new Error("AQ_LIVE_QUOTA_RESERVATION_TIMESTAMP_IN_FUTURE");
      if (ageMs >= WINDOW_SECONDS * 1000) continue;
      if (latest === null || reservedMs > Date.parse(latest)) latest = reservedAt;
    }
    if (payload.artifacts.length < 100) break;
    if (page >= MAX_API_PAGES) throw new Error("AQ_LIVE_QUOTA_ARTIFACT_SCAN_INCOMPLETE");
  }
  return latest;
}

/**
 * Scan repository-wide workflow runs instead of querying a workflow by filename.
 * The repository-wide endpoint preserves access to historical runs when a legacy
 * workflow file has been removed or renamed. Any incomplete scan fails closed.
 */
export async function latestReservedAt({
  repository,
  workflow,
  currentRunId,
  token,
  includeCurrentRunReservations = false,
  nowMs = Date.now(),
  fetchImpl = fetch,
}) {
  if (!RESERVED_WORKFLOWS.has(workflow)) throw new Error("AQ_LIVE_QUOTA_UNKNOWN_WORKFLOW");
  let latest = null;
  for (let page = 1; ; page += 1) {
    const url = `https://api.github.com/repos/${repository}/actions/runs?per_page=100&page=${page}&sort=created&direction=desc`;
    const runs = validateRuns(await githubJson(url, token, fetchImpl));
    for (const run of runs) {
      const filename = workflowFilename(run.path);
      if (filename === null) throw new Error("AQ_LIVE_QUOTA_INVALID_WORKFLOW_PATH");
      if (filename !== workflow) continue;
      const reservedAt = await reservationForRun({
        repository, run, workflow, currentRunId, includeCurrentRunReservations, token, nowMs, fetchImpl,
      });
      if (reservedAt !== null && (latest === null || Date.parse(reservedAt) > Date.parse(latest))) latest = reservedAt;
    }
    if (runs.length < 100) break;
    if (page >= MAX_API_PAGES) throw new Error("AQ_LIVE_QUOTA_WORKFLOW_RUN_SCAN_INCOMPLETE");
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
    [...RESERVED_WORKFLOWS].map((workflow) =>
      latestReservedAt({ repository, workflow, currentRunId, token, includeCurrentRunReservations, nowMs, fetchImpl })
    ),
  );
  const candidates = reservations.filter(Boolean).sort();
  const previous = candidates.at(-1) ?? null;
  const previousMs = previous === null ? null : Date.parse(previous);
  const nextAllowedAt = previousMs === null ? null : new Date(previousMs + WINDOW_SECONDS * 1000).toISOString();
  const remainingSeconds = previousMs === null ? 0 : Math.max(0, Math.ceil((previousMs + WINDOW_SECONDS * 1000 - nowMs) / 1000));
  return Object.freeze({ allowed: previous === null, previousReservedAt: previous, nextAllowedAt, remainingSeconds });
}

async function main() {
  const repository = required("GITHUB_REPOSITORY");
  const currentRunId = required("GITHUB_RUN_ID");
  const token = required("GITHUB_TOKEN");
  const output = required("GITHUB_OUTPUT");
  const includeCurrentRunReservations = process.env.AQ_LIVE_INCLUDE_CURRENT_RUN_RESERVATIONS?.trim() === "true";
  const result = await checkLiveQuota({ repository, currentRunId, token, includeCurrentRunReservations });
  await appendFile(output, `allowed=${result.allowed ? "true" : "false"}\n`, "utf8");
  await appendFile(output, `next_allowed_at=${result.nextAllowedAt ?? ""}\n`, "utf8");
  await appendFile(output, `remaining_seconds=${result.remainingSeconds}\n`, "utf8");
  if (result.allowed) {
    process.stdout.write("Live AQ provider quota is available.\n");
  } else {
    process.stdout.write(`Live AQ provider execution skipped until ${result.nextAllowedAt}; ${result.remainingSeconds}s remain.\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "AQ_LIVE_QUOTA_GUARD_FAILED"}\n`);
    process.exitCode = 1;
  });
}
