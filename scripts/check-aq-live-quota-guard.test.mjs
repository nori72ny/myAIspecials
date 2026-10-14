import { describe, expect, it, vi } from "vitest";
import { checkLiveQuota, latestReservedAt } from "./check-aq-live-quota-guard.mjs";

const NOW = Date.parse("2026-10-14T12:00:00.000Z");
const RESERVED_AT = "2026-10-14T11:30:00.000Z";

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function reservationFetch({ runId = 123, artifacts = [], workflow = "aq-free-provider-calibration.yml" } = {}) {
  return vi.fn(async (input) => {
    const url = String(input);
    if (url.includes(`/actions/workflows/${workflow}/runs`)) {
      return jsonResponse({ workflow_runs: [{ id: runId }] });
    }
    if (url.includes(`/actions/runs/${runId}/artifacts`)) {
      return jsonResponse({ artifacts });
    }
    throw new Error("Unexpected GitHub API URL");
  });
}

function quotaArgs(fetchImpl, overrides = {}) {
  return {
    repository: "nori72ny/myAIspecials",
    workflow: "aq-free-provider-calibration.yml",
    currentRunId: "999",
    token: "test-token",
    nowMs: NOW,
    fetchImpl,
    ...overrides,
  };
}

describe("shared AQ live provider quota guard", () => {
  it("recognizes a reservation artifact from the free-provider calibration workflow", async () => {
    const fetchImpl = reservationFetch({
      artifacts: [{ name: "aq-live-quota-reservation", created_at: RESERVED_AT }],
    });

    await expect(latestReservedAt(quotaArgs(fetchImpl))).resolves.toBe(RESERVED_AT);
  });

  it("blocks a new shared-quota run when calibration has reserved capacity within 24 hours", async () => {
    const fetchImpl = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/actions/workflows/aq-free-provider-calibration.yml/runs")) {
        return jsonResponse({ workflow_runs: [{ id: 123 }] });
      }
      if (url.includes("/actions/runs/123/artifacts")) {
        return jsonResponse({
          artifacts: [{ name: "aq-live-quota-reservation", created_at: RESERVED_AT }],
        });
      }
      if (url.includes("/actions/workflows/") && url.includes("/runs?per_page=100&page=1")) {
        return jsonResponse({ workflow_runs: [] });
      }
      throw new Error("Unexpected GitHub API URL");
    });

    await expect(checkLiveQuota({
      repository: "nori72ny/myAIspecials",
      currentRunId: "999",
      token: "test-token",
      nowMs: NOW,
      fetchImpl,
    })).resolves.toMatchObject({
      allowed: false,
      previousReservedAt: RESERVED_AT,
      nextAllowedAt: "2026-10-15T11:30:00.000Z",
      remainingSeconds: 84600,
    });
  });

  it.each([
    ["at reservation time", 0, true],
    ["one second before the 24-hour boundary", 86_399, true],
    ["exactly at the 24-hour boundary", 86_400, false],
    ["one second after the 24-hour boundary", 86_401, false],
  ])("applies the 24-hour window correctly: %s", async (_label, ageSeconds, shouldCount) => {
    const createdAt = new Date(NOW - ageSeconds * 1000).toISOString();
    const fetchImpl = reservationFetch({
      artifacts: [{ name: "aq-live-quota-reservation", created_at: createdAt }],
    });

    await expect(latestReservedAt(quotaArgs(fetchImpl))).resolves.toBe(
      shouldCount ? createdAt : null,
    );
  });

  it("treats a future reservation timestamp as occupied quota", async () => {
    const futureAt = new Date(NOW + 60_000).toISOString();
    const fetchImpl = reservationFetch({
      artifacts: [{ name: "aq-live-quota-reservation", created_at: futureAt }],
    });

    await expect(latestReservedAt(quotaArgs(fetchImpl))).resolves.toBe(futureAt);
  });

  it.each([null, undefined, "not-an-iso-date"])(
    "fails closed for malformed reservation timestamps (%s)",
    async (createdAt) => {
      const fetchImpl = reservationFetch({
        artifacts: [{ name: "aq-live-quota-reservation", created_at: createdAt }],
      });

      await expect(latestReservedAt(quotaArgs(fetchImpl))).rejects.toThrow(
        "AQ_LIVE_QUOTA_RESERVATION_TIMESTAMP_INVALID",
      );
    },
  );

  it("ignores an expired reservation artifact", async () => {
    const fetchImpl = reservationFetch({
      artifacts: [{
        name: "aq-live-quota-reservation",
        created_at: RESERVED_AT,
        expired: true,
      }],
    });

    await expect(latestReservedAt(quotaArgs(fetchImpl))).resolves.toBeNull();
  });

  it("includes a reservation from the current run on re-run when explicitly configured", async () => {
    const fetchImpl = reservationFetch({
      runId: 999,
      artifacts: [{ name: "aq-live-quota-reservation", created_at: RESERVED_AT }],
    });

    await expect(latestReservedAt(quotaArgs(fetchImpl, {
      currentRunId: "999",
      includeCurrentRunReservations: true,
    }))).resolves.toBe(RESERVED_AT);
  });

  it("excludes the current run only when current-run reservations are not requested", async () => {
    const fetchImpl = reservationFetch({
      runId: 999,
      artifacts: [{ name: "aq-live-quota-reservation", created_at: RESERVED_AT }],
    });

    await expect(latestReservedAt(quotaArgs(fetchImpl, {
      currentRunId: "999",
      includeCurrentRunReservations: false,
    }))).resolves.toBeNull();
  });
  it("paginates beyond the first 100 runs to find an older active reservation", async () => {
    const recentRuns = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      created_at: new Date(NOW - 60_000).toISOString(),
    }));
    const olderRun = {
      id: 101,
      created_at: new Date(NOW - 86_500_000).toISOString(),
    };
    const fetchImpl = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/actions/workflows/aq-free-provider-calibration.yml/runs?")) {
        if (url.includes("page=1")) return jsonResponse({ workflow_runs: recentRuns });
        if (url.includes("page=2")) return jsonResponse({ workflow_runs: [olderRun] });
      }
      const match = url.match(/\/actions\/runs\/(\d+)\/artifacts/);
      if (match) {
        const runId = Number(match[1]);
        return jsonResponse({
          artifacts: runId === 101
            ? [{ name: "aq-live-quota-reservation", created_at: RESERVED_AT }]
            : [],
        });
      }
      throw new Error("Unexpected GitHub API URL");
    });

    await expect(latestReservedAt(quotaArgs(fetchImpl))).resolves.toBe(RESERVED_AT);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("page=2"),
      expect.any(Object),
    );
  });

});
