import { describe, expect, it } from "vitest";
import { checkLiveQuota } from "./check-aq-live-quota-guard.mjs";

const repository = "owner/repo";
const token = "test-token";
const currentRunId = "999";
const nowMs = Date.parse("2026-09-20T04:00:00.000Z");

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function run(id: number, filename: string, createdAt = "2026-09-19T00:00:00.000Z") {
  return { id, created_at: createdAt, path: `.github/workflows/${filename}@refs/heads/main` };
}

function fetchForRuns(runs: unknown[], artifactsByRun: Record<string, unknown[]> = {}) {
  return async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/actions/runs?")) {
      const page = Number(new URL(url).searchParams.get("page"));
      return response({ workflow_runs: page === 1 ? runs : [] });
    }
    const match = url.match(/\/actions\/runs\/(\d+)\/artifacts/);
    if (match) return response({ artifacts: artifactsByRun[match[1]] ?? [] });
    throw new Error(`unexpected URL: ${url}`);
  };
}

describe("AQ live quota guard readiness", () => {
  it("blocks on a reservation from a current calibration workflow", async () => {
    const previous = "2026-09-19T05:11:00.000Z";
    const result = await checkLiveQuota({
      repository, currentRunId, token, nowMs,
      fetchImpl: fetchForRuns(
        [run(123, "aq-free-provider-calibration.yml")],
        { "123": [{ name: "aq-live-quota-reservation", created_at: previous }] },
      ) as typeof fetch,
    });
    expect(result.allowed).toBe(false);
    expect(result.previousReservedAt).toBe(previous);
    expect(result.nextAllowedAt).toBe("2026-09-20T05:11:00.000Z");
    expect(result.remainingSeconds).toBe(4260);
  });

  it("blocks on a scheduled final AQ reservation", async () => {
    const previous = "2026-09-19T05:00:00.000Z";
    const result = await checkLiveQuota({
      repository, currentRunId, token, nowMs,
      fetchImpl: fetchForRuns(
        [run(123, "q1-final-aq.yml")],
        { "123": [{ name: "aq-live-quota-reservation", created_at: previous }] },
      ) as typeof fetch,
    });
    expect(result.allowed).toBe(false);
    expect(result.previousReservedAt).toBe(previous);
    expect(result.nextAllowedAt).toBe("2026-09-20T05:00:00.000Z");
  });

  it("allows execution exactly at the 24-hour boundary", async () => {
    const previous = "2026-09-19T04:00:00.000Z";
    const result = await checkLiveQuota({
      repository, currentRunId, token, nowMs: Date.parse("2026-09-20T04:00:00.000Z"),
      fetchImpl: fetchForRuns(
        [run(123, "aq-live-lane-shard.yml")],
        { "123": [{ name: "aq-live-quota-reservation", created_at: previous }] },
      ) as typeof fetch,
    });
    expect(result.allowed).toBe(true);
    expect(result.previousReservedAt).toBeNull();
    expect(result.nextAllowedAt).toBeNull();
    expect(result.remainingSeconds).toBe(0);
  });

  it("allows execution when no prior reservation exists", async () => {
    const result = await checkLiveQuota({
      repository, currentRunId, token, nowMs,
      fetchImpl: fetchForRuns([]) as typeof fetch,
    });
    expect(result.allowed).toBe(true);
    expect(result.nextAllowedAt).toBeNull();
    expect(result.remainingSeconds).toBe(0);
  });

  it("counts a prior-attempt reservation from the current run when enabled", async () => {
    const previous = "2026-09-19T05:22:46.000Z";
    const result = await checkLiveQuota({
      repository, currentRunId, token, includeCurrentRunReservations: true, nowMs,
      fetchImpl: fetchForRuns(
        [run(Number(currentRunId), "aq-live-lane-shard.yml")],
        { [currentRunId]: [{ name: "aq-live-quota-reservation", created_at: previous }] },
      ) as typeof fetch,
    });
    expect(result.allowed).toBe(false);
    expect(result.previousReservedAt).toBe(previous);
    expect(result.nextAllowedAt).toBe("2026-09-20T05:22:46.000Z");
  });

  it("finds reservations from a legacy workflow even when it is no longer listed as a current workflow", async () => {
    const previous = "2026-09-19T05:22:46.000Z";
    const result = await checkLiveQuota({
      repository, currentRunId, token, nowMs,
      fetchImpl: fetchForRuns(
        [run(123, "aq-live-research-shard.yml")],
        { "123": [{ name: "aq-live-research-shard-1", created_at: previous }] },
      ) as typeof fetch,
    });
    expect(result.allowed).toBe(false);
    expect(result.previousReservedAt).toBe(previous);
  });

  it("ignores unrelated workflow artifacts", async () => {
    const result = await checkLiveQuota({
      repository, currentRunId, token, nowMs,
      fetchImpl: fetchForRuns(
        [run(123, "unrelated.yml")],
        { "123": [{ name: "aq-live-quota-reservation", created_at: "2026-09-19T05:22:46.000Z" }] },
      ) as typeof fetch,
    });
    expect(result.allowed).toBe(true);
    expect(result.previousReservedAt).toBeNull();
  });

  it("fails closed when the repository-wide workflow-run API fails", async () => {
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/actions/runs?")) return response({ message: "not found" }, 404);
      throw new Error(`unexpected URL: ${url}`);
    };
    await expect(checkLiveQuota({
      repository, currentRunId, token, nowMs, fetchImpl: fetchImpl as typeof fetch,
    })).rejects.toThrow("AQ_LIVE_QUOTA_GITHUB_HTTP_404");
  });

  it("fails closed when workflow path metadata is missing", async () => {
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/actions/runs?")) return response({ workflow_runs: [{ id: 123, created_at: "2026-09-19T00:00:00.000Z" }] });
      throw new Error(`unexpected URL: ${url}`);
    };
    await expect(checkLiveQuota({
      repository, currentRunId, token, nowMs, fetchImpl: fetchImpl as typeof fetch,
    })).rejects.toThrow("AQ_LIVE_QUOTA_INVALID_WORKFLOW_RUN_ENTRY");
  });

  it("follows repository-run pagination before allowing quota use", async () => {
    const previous = "2026-09-19T05:22:46.000Z";
    const requestedPages = new Set<number>();
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/actions/runs?")) {
        const page = Number(new URL(url).searchParams.get("page"));
        requestedPages.add(page);
        if (page === 1) return response({ workflow_runs: Array.from({ length: 100 }, (_, i) => run(i + 1, "unrelated.yml")) });
        if (page === 2) return response({ workflow_runs: [run(500, "aq-live-lane-shard.yml")] });
        return response({ workflow_runs: [] });
      }
      if (url.includes("/actions/runs/500/artifacts")) return response({ artifacts: [{ name: "aq-live-quota-reservation", created_at: previous }] });
      if (url.includes("/actions/runs/")) return response({ artifacts: [] });
      throw new Error(`unexpected URL: ${url}`);
    };
    const result = await checkLiveQuota({
      repository, currentRunId, token, nowMs, fetchImpl: fetchImpl as typeof fetch,
    });
    expect(requestedPages.has(2)).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.previousReservedAt).toBe(previous);
  });

  it("stops scanning when workflow runs exceed the max run age window", async () => {
    const requestedPages: number[] = [];
    const oldRunDate = "2026-09-15T00:00:00.000Z"; // 5 days old (> 48h)
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/actions/runs?")) {
        const page = Number(new URL(url).searchParams.get("page"));
        requestedPages.push(page);
        if (page === 1) {
          return response({
            workflow_runs: Array.from({ length: 100 }, (_, i) => run(i + 1, "unrelated.yml", oldRunDate)),
          });
        }
        return response({ workflow_runs: [] });
      }
      throw new Error(`unexpected URL: ${url}`);
    };
    const result = await checkLiveQuota({
      repository, currentRunId, token, nowMs, fetchImpl: fetchImpl as typeof fetch,
    });
    expect(requestedPages.every((p) => p === 1)).toBe(true);
    expect(requestedPages.includes(2)).toBe(false);
    expect(result.allowed).toBe(true);
  });

  it("fails closed when the repository scan reaches its hard page cap", async () => {
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/actions/runs?")) {
        // Recent runs within 48h to prevent age limit cutoff
        const recentDate = "2026-09-20T03:00:00.000Z";
        return response({ workflow_runs: Array.from({ length: 100 }, (_, i) => run(i + 1, "unrelated.yml", recentDate)) });
      }
      throw new Error(`unexpected URL: ${url}`);
    };
    await expect(checkLiveQuota({
      repository, currentRunId, token, nowMs, fetchImpl: fetchImpl as typeof fetch,
    })).rejects.toThrow("AQ_LIVE_QUOTA_WORKFLOW_RUN_SCAN_INCOMPLETE");
  });
});
