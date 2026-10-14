import { describe, expect, it } from "vitest";
import { checkLiveQuota, latestReservedAt } from "./check-aq-live-quota-guard.mjs";

const repository = "owner/repo";
const token = "test-token";
const currentRunId = "999";
const nowMs = Date.parse("2026-09-20T04:00:00.000Z");

function response(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fetchWithReservation(
  createdAt: string | null,
  workflow: "aq-live-lane-shard.yml" | "q1-final-aq.yml" = "aq-live-lane-shard.yml",
) {
  return async (input: string | URL | Request) => {
    const url = String(input);
    for (const name of [
      "aq-live-lane-shard.yml",
      "aq-live-research-shard.yml",
      "q1-final-aq.yml",
      "aq-free-provider-calibration.yml",
    ]) {
      if (url.includes(`/actions/workflows/${name}/runs`)) {
        return response({
          workflow_runs:
            createdAt && name === workflow
              ? [{
                  id: 123,
                  status: "completed",
                  created_at: "2026-09-17T00:00:00.000Z",
                  updated_at: new Date(nowMs).toISOString(),
                }]
              : [],
        });
      }
    }
    if (url.includes("/actions/runs/123/artifacts")) {
      return response({
        artifacts: [{
          name: "aq-live-quota-reservation",
          created_at: createdAt,
        }],
      });
    }
    throw new Error(`unexpected URL: ${url}`);
  };
}

describe("AQ live quota guard readiness", () => {
  it("reports the exact next allowed time while a lane reservation is active", async () => {
    const previous = "2026-09-19T05:22:46.000Z";
    const result = await checkLiveQuota({
      repository,
      currentRunId,
      token,
      nowMs,
      fetchImpl: fetchWithReservation(previous) as typeof fetch,
    });

    expect(result.allowed).toBe(false);
    expect(result.previousReservedAt).toBe(previous);
    expect(result.nextAllowedAt).toBe("2026-09-20T05:22:46.000Z");
    expect(result.remainingSeconds).toBe(4966);
  });

  it("also blocks on a scheduled final AQ reservation", async () => {
    const previous = "2026-09-19T05:00:00.000Z";
    const result = await checkLiveQuota({
      repository,
      currentRunId,
      token,
      nowMs,
      fetchImpl: fetchWithReservation(previous, "q1-final-aq.yml") as typeof fetch,
    });

    expect(result.allowed).toBe(false);
    expect(result.previousReservedAt).toBe(previous);
    expect(result.nextAllowedAt).toBe("2026-09-20T05:00:00.000Z");
  });

  it("allows execution exactly at the 24-hour boundary", async () => {
    const previous = "2026-09-19T04:00:00.000Z";
    const result = await checkLiveQuota({
      repository,
      currentRunId,
      token,
      nowMs,
      fetchImpl: fetchWithReservation(previous) as typeof fetch,
    });

    expect(result.allowed).toBe(true);
    expect(result.previousReservedAt).toBeNull();
    expect(result.nextAllowedAt).toBeNull();
    expect(result.remainingSeconds).toBe(0);
  });

  it("allows execution when no prior reservation exists", async () => {
    const result = await checkLiveQuota({
      repository,
      currentRunId,
      token,
      nowMs,
      fetchImpl: fetchWithReservation(null) as typeof fetch,
    });

    expect(result.allowed).toBe(true);
    expect(result.nextAllowedAt).toBeNull();
    expect(result.remainingSeconds).toBe(0);
  });

  it("counts a prior-attempt reservation from the current workflow run when enabled", async () => {
    const previous = "2026-09-19T05:22:46.000Z";
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/actions/workflows/aq-live-lane-shard.yml/runs")) {
        return response({
          workflow_runs: [{
            id: Number(currentRunId),
            status: "completed",
            created_at: "2026-09-17T00:00:00.000Z",
            updated_at: new Date(nowMs).toISOString(),
          }],
        });
      }
      if (
        url.includes("/actions/workflows/aq-live-research-shard.yml/runs")
        || url.includes("/actions/workflows/q1-final-aq.yml/runs")
        || url.includes("/actions/workflows/aq-free-provider-calibration.yml/runs")
      ) {
        return response({ workflow_runs: [] });
      }
      if (url.includes(`/actions/runs/${currentRunId}/artifacts`)) {
        return response({
          artifacts: [{
            name: "aq-live-quota-reservation",
            created_at: previous,
          }],
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    };

    const result = await checkLiveQuota({
      repository,
      currentRunId,
      token,
      includeCurrentRunReservations: true,
      nowMs,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.allowed).toBe(false);
    expect(result.previousReservedAt).toBe(previous);
    expect(result.nextAllowedAt).toBe("2026-09-20T05:22:46.000Z");
  });

  it("paginates beyond the first 100 workflow runs to find an active reservation", async () => {
    const recentRuns = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      status: "completed",
      created_at: new Date(nowMs - 60_000).toISOString(),
      updated_at: new Date(nowMs - 60_000).toISOString(),
    }));
    // Old queued runs must still be inspected because they can upload a
    // reservation artifact after waiting in the queue for more than 24 hours.
    recentRuns[99] = {
      id: 100,
      status: "queued",
      created_at: new Date(nowMs - 3 * 86_400_000).toISOString(),
      updated_at: new Date(nowMs - 3 * 86_400_000).toISOString(),
    };
    const olderRun = {
      id: 101,
      status: "queued",
      created_at: new Date(nowMs - 4 * 86_400_000).toISOString(),
      updated_at: new Date(nowMs - 4 * 86_400_000).toISOString(),
    };
    const reservationAt = new Date(nowMs - 60_000).toISOString();
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/actions/workflows/aq-free-provider-calibration.yml/runs?")) {
        const page = new URL(url).searchParams.get("page");
        if (page === "1") return response({ workflow_runs: recentRuns });
        if (page === "2") return response({ workflow_runs: [olderRun] });
      }
      const match = url.match(/\/actions\/runs\/(\d+)\/artifacts/);
      if (match) {
        return response({
          artifacts: [{
            name: "aq-live-quota-reservation",
            created_at: Number(match[1]) === 101 ? reservationAt : null,
          }].filter((artifact) => artifact.created_at !== null),
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    };

    await expect(latestReservedAt({
      repository,
      workflow: "aq-free-provider-calibration.yml",
      currentRunId,
      token,
      nowMs,
      fetchImpl: fetchImpl as typeof fetch,
    })).resolves.toBe(reservationAt);
  });

  it("keeps a recently updated completed run even when it was created before the 24-hour window", async () => {
    const previous = new Date(nowMs - 30_000).toISOString();
    const result = await latestReservedAt({
      repository,
      workflow: "aq-free-provider-calibration.yml",
      currentRunId,
      token,
      nowMs,
      fetchImpl: fetchWithReservation(previous, "aq-free-provider-calibration.yml") as typeof fetch,
    });

    expect(result).toBe(previous);
  });

  it("paginates artifact listings to find a reservation after the first 100 unrelated artifacts", async () => {
    const runId = 123;
    const reservationAt = new Date(nowMs - 30_000).toISOString();
    const requestedPages: string[] = [];
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/actions/workflows/aq-free-provider-calibration.yml/runs?")) {
        return response({ workflow_runs: [{ id: runId, status: "in_progress", created_at: "2026-09-17T00:00:00.000Z", updated_at: new Date(nowMs).toISOString() }] });
      }
      if (url.includes(`/actions/runs/${runId}/artifacts?`)) {
        const parsed = new URL(url);
        const page = parsed.searchParams.get("page") ?? "1";
        requestedPages.push(page);
        if (page === "1") {
          return response({ artifacts: Array.from({ length: 100 }, (_, i) => ({ name: `unrelated-${i}`, created_at: reservationAt })) });
        }
        if (page === "2") {
          return response({ artifacts: [{ name: "aq-live-quota-reservation", created_at: reservationAt, expired: false }] });
        }
      }
      throw new Error(`unexpected URL: ${url}`);
    };

    await expect(latestReservedAt({
      repository,
      workflow: "aq-free-provider-calibration.yml",
      currentRunId,
      token,
      nowMs,
      fetchImpl: fetchImpl as typeof fetch,
    })).resolves.toBe(reservationAt);
    expect(requestedPages).toContain("2");
  });

  it("fails closed on a future-dated reservation rather than opening quota", async () => {
    const future = new Date(nowMs + 60_000).toISOString();
    const result = await checkLiveQuota({
      repository,
      currentRunId,
      token,
      nowMs,
      fetchImpl: fetchWithReservation(future) as typeof fetch,
    });

    expect(result.allowed).toBe(false);
    expect(result.previousReservedAt).toBe(future);
    expect(result.nextAllowedAt).toBe(new Date(Date.parse(future) + 86_400_000).toISOString());
    expect(result.remainingSeconds).toBe(86_460);
  });
});
