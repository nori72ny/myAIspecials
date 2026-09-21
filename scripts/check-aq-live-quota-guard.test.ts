import { describe, expect, it } from "vitest";
import { checkLiveQuota } from "./check-aq-live-quota-guard.mjs";

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
    ]) {
      if (url.includes(`/actions/workflows/${name}/runs`)) {
        return response({
          workflow_runs:
            createdAt && name === workflow
              ? [{ id: 123, created_at: "2026-09-17T00:00:00.000Z" }]
              : [],
        });
      }
    }
    if (url.includes("/actions/runs/123/artifacts")) {
      return response({
        artifacts: [{
          name:
            workflow === "aq-live-research-shard.yml"
              ? "aq-live-research-shard-0"
              : "aq-live-quota-reservation",
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
            created_at: "2026-09-17T00:00:00.000Z",
          }],
        });
      }
      if (
        url.includes("/actions/workflows/aq-live-research-shard.yml/runs")
        || url.includes("/actions/workflows/q1-final-aq.yml/runs")
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
});
