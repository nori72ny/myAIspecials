import { beforeEach, describe, expect, it } from "vitest";
import {
  getOriginCapacityLedgerSnapshot,
  originCapacityBudgetDayKey,
  parseOriginRateLimitHeaders,
  recordOriginCloudflareNeuronEstimate,
  recordOriginRateLimitObservation,
  reconcileOriginCloudflareNeurons,
  resetOriginCapacityLedgerForTests,
} from "./originProviderCapacityLedger";

const FULL_HEADERS = {
  "x-ratelimit-limit-requests": "1000",
  "x-ratelimit-remaining-requests": "999",
  "x-ratelimit-limit-tokens": "200000",
  "x-ratelimit-remaining-tokens": "199500",
  "x-ratelimit-reset-requests": "2s",
  "x-ratelimit-reset-tokens": "0.5s",
};
const FULL_SNAPSHOT = {
  limitRequests: 1000,
  remainingRequests: 999,
  limitTokens: 200000,
  remainingTokens: 199500,
  resetRequestsSeconds: 2,
  resetTokensSeconds: 0.5,
};

describe("parseOriginRateLimitHeaders", () => {
  it("parses the full Groq header set, including Go-style reset durations", () => {
    expect(parseOriginRateLimitHeaders(new Headers(FULL_HEADERS))).toEqual(FULL_SNAPSHOT);
  });

  it("parses compound and millisecond reset durations", () => {
    const snapshot = parseOriginRateLimitHeaders(new Headers({
      "x-ratelimit-reset-requests": "2m30s",
      "x-ratelimit-reset-tokens": "500ms",
    }));
    expect(snapshot).toEqual({ resetRequestsSeconds: 150, resetTokensSeconds: 0.5 });
  });

  it("accepts a bare-seconds reset and drops unparseable values field by field", () => {
    const snapshot = parseOriginRateLimitHeaders(new Headers({
      "x-ratelimit-limit-requests": "30",
      "x-ratelimit-remaining-requests": "soon",
      "x-ratelimit-reset-requests": "45",
      "x-ratelimit-reset-tokens": "in a bit",
    }));
    expect(snapshot).toEqual({ limitRequests: 30, resetRequestsSeconds: 45 });
  });

  it("returns undefined when no usable header is present", () => {
    expect(parseOriginRateLimitHeaders(new Headers())).toBeUndefined();
    expect(parseOriginRateLimitHeaders(new Headers({ "x-ratelimit-limit-requests": "1,000" }))).toBeUndefined();
    expect(parseOriginRateLimitHeaders(undefined)).toBeUndefined();
    expect(parseOriginRateLimitHeaders(null)).toBeUndefined();
  });
});

describe("originCapacityBudgetDayKey", () => {
  it("rolls over at 09:00 JST, not at midnight", () => {
    // 08:59:59 JST on Nov 22 still belongs to the budget day that began Nov 21 09:00 JST.
    expect(originCapacityBudgetDayKey(Date.parse("2026-11-21T23:59:59.000Z"))).toBe("2026-11-21");
    expect(originCapacityBudgetDayKey(Date.parse("2026-11-22T00:00:00.000Z"))).toBe("2026-11-22");
    expect(originCapacityBudgetDayKey(Date.parse("2026-11-22T14:59:59.000Z"))).toBe("2026-11-22");
    // 00:00 JST on Nov 23 still belongs to the Nov 22 budget day.
    expect(originCapacityBudgetDayKey(Date.parse("2026-11-22T15:00:00.000Z"))).toBe("2026-11-22");
    expect(originCapacityBudgetDayKey(Date.parse("2026-11-23T00:00:00.000Z"))).toBe("2026-11-23");
  });
});

describe("capacity ledger rate-limit observations", () => {
  beforeEach(() => {
    resetOriginCapacityLedgerForTests();
  });

  it("keeps the latest observation per provider and model, with its limit-hit flag", () => {
    const at = Date.parse("2026-11-22T01:00:00.000Z");
    recordOriginRateLimitObservation({ providerId: "groq-free", modelId: "openai/gpt-oss-120b", snapshot: FULL_SNAPSHOT, limitHit: false, observedAtMs: at });
    recordOriginRateLimitObservation({ providerId: "groq-free", modelId: "openai/gpt-oss-20b", snapshot: { remainingRequests: 5 }, limitHit: true, observedAtMs: at + 1 });
    recordOriginRateLimitObservation({ providerId: "groq-free", modelId: "openai/gpt-oss-120b", snapshot: { remainingRequests: 900 }, limitHit: false, observedAtMs: at + 2 });
    const ledger = getOriginCapacityLedgerSnapshot(at + 3);
    expect(ledger.rateLimits).toEqual([
      { providerId: "groq-free", modelId: "openai/gpt-oss-120b", source: "observed", limitHit: false, observedAtMs: at + 2, snapshot: { remainingRequests: 900 } },
      { providerId: "groq-free", modelId: "openai/gpt-oss-20b", source: "observed", limitHit: true, observedAtMs: at + 1, snapshot: { remainingRequests: 5 } },
    ]);
  });

  it("ignores observations without any usable snapshot field", () => {
    recordOriginRateLimitObservation({ providerId: "groq-free", modelId: "openai/gpt-oss-120b", snapshot: {}, limitHit: false, observedAtMs: 1 });
    expect(getOriginCapacityLedgerSnapshot(2).rateLimits).toEqual([]);
  });
});

describe("capacity ledger Cloudflare neuron estimate", () => {
  beforeEach(() => {
    resetOriginCapacityLedgerForTests();
  });

  it("accumulates tracked estimates inside one budget day and restarts on the next", () => {
    const dayA = Date.parse("2026-11-21T23:30:00.000Z"); // budget day 2026-11-21
    const dayB = Date.parse("2026-11-22T01:00:00.000Z"); // budget day 2026-11-22
    recordOriginCloudflareNeuronEstimate(1_000, dayA);
    recordOriginCloudflareNeuronEstimate(500, dayA + 60_000);
    expect(getOriginCapacityLedgerSnapshot(dayA + 120_000).cloudflareNeurons).toEqual({
      budgetDay: "2026-11-21",
      trackedEstimateNeurons: 1_500,
      source: "estimated",
    });
    recordOriginCloudflareNeuronEstimate(700, dayB);
    expect(getOriginCapacityLedgerSnapshot(dayB).cloudflareNeurons).toEqual({
      budgetDay: "2026-11-22",
      trackedEstimateNeurons: 700,
      source: "estimated",
    });
    // The ledger is a current-day view: once the budget day rolls over,
    // the closed day is no longer reported (D-1 adds day-scoped reads if
    // pacing ever needs them).
  });

  it("reconciles an account actual against the tracked estimate with a correction factor", () => {
    const at = Date.parse("2026-11-22T01:00:00.000Z");
    recordOriginCloudflareNeuronEstimate(2_000, at);
    reconcileOriginCloudflareNeurons(2_600, at + 1_000);
    expect(getOriginCapacityLedgerSnapshot(at + 2_000).cloudflareNeurons).toEqual({
      budgetDay: "2026-11-22",
      trackedEstimateNeurons: 2_000,
      accountActualNeurons: 2_600,
      correctionFactor: 1.3,
      reconciledAtMs: at + 1_000,
      source: "observed",
    });
  });

  it("records an account actual without a factor when nothing was tracked, and ignores invalid values", () => {
    const at = Date.parse("2026-11-22T01:00:00.000Z");
    recordOriginCloudflareNeuronEstimate(-5, at);
    recordOriginCloudflareNeuronEstimate(Number.NaN, at);
    reconcileOriginCloudflareNeurons(300, at);
    reconcileOriginCloudflareNeurons(-1, at);
    expect(getOriginCapacityLedgerSnapshot(at).cloudflareNeurons).toEqual({
      budgetDay: "2026-11-22",
      trackedEstimateNeurons: 0,
      accountActualNeurons: 300,
      reconciledAtMs: at,
      source: "observed",
    });
  });
});
