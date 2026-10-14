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

describe("shared AQ live provider quota guard", () => {
  it("recognizes a reservation artifact from the free-provider calibration workflow", async () => {
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
      throw new Error("Unexpected GitHub API URL");
    });

    await expect(latestReservedAt({
      repository: "nori72ny/myAIspecials",
      workflow: "aq-free-provider-calibration.yml",
      currentRunId: "999",
      token: "test-token",
      nowMs: NOW,
      fetchImpl,
    })).resolves.toBe(RESERVED_AT);
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
      if (url.includes("/actions/workflows/") && url.endsWith("/runs?per_page=30")) {
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
});
