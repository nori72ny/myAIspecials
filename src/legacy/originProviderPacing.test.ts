import { beforeEach, describe, expect, it } from "vitest";
import {
  evaluateOriginProviderPacing,
  isOriginGroqPacingAllocationEnabled,
  recordOriginProviderPacingSend,
  resetOriginProviderPacingForTests,
  ORIGIN_PROVIDER_PACING_MAX_WAIT_MS,
} from "./originProviderPacing";
import {
  recordOriginRateLimitObservation,
  resetOriginCapacityLedgerForTests,
} from "./originProviderCapacityLedger";
import { ORIGIN_GROQ_FREE_PROVIDER_ID } from "../lib/orchestration/OriginExecutionPolicy";
import {
  ORIGIN_GROQ_FREE_MODEL_ID,
  ORIGIN_GROQ_FREE_ROTATION_MODEL_ID,
} from "../lib/orchestration/OriginGroqFreeModelCatalog";

const T0 = Date.parse("2026-11-22T03:00:00.000Z");
const LIMIT = 8_000; // safety line: floor(8000 * 0.8) = 6,400

beforeEach(() => {
  resetOriginProviderPacingForTests();
  resetOriginCapacityLedgerForTests();
});

describe("isOriginGroqPacingAllocationEnabled", () => {
  it("is true only for the exact value 'true'", () => {
    expect(isOriginGroqPacingAllocationEnabled({ ORIGIN_GROQ_PACING_ALLOCATION_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isOriginGroqPacingAllocationEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isOriginGroqPacingAllocationEnabled({ ORIGIN_GROQ_PACING_ALLOCATION_ENABLED: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isOriginGroqPacingAllocationEnabled({ ORIGIN_GROQ_PACING_ALLOCATION_ENABLED: "TRUE" } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("evaluateOriginProviderPacing (local window)", () => {
  it("sends at once on an empty window", () => {
    expect(evaluateOriginProviderPacing({ modelId: ORIGIN_GROQ_FREE_MODEL_ID, estimatedTokens: 4_114, limitTokensPerMinute: LIMIT, nowMs: T0 }))
      .toEqual({ action: "send" });
  });

  it("waits until the earliest expiry that makes room", () => {
    recordOriginProviderPacingSend(ORIGIN_GROQ_FREE_MODEL_ID, 3_000, T0);
    // 3,000 booked + 4,114 estimated = 7,114 > 6,400 line; the booking
    // expires one window after it was recorded.
    expect(evaluateOriginProviderPacing({ modelId: ORIGIN_GROQ_FREE_MODEL_ID, estimatedTokens: 4_114, limitTokensPerMinute: LIMIT, nowMs: T0 }))
      .toEqual({ action: "wait", waitMs: 60_000 });
    expect(evaluateOriginProviderPacing({ modelId: ORIGIN_GROQ_FREE_MODEL_ID, estimatedTokens: 4_114, limitTokensPerMinute: LIMIT, nowMs: T0 + 30_000 }))
      .toEqual({ action: "wait", waitMs: 30_000 });
    expect(evaluateOriginProviderPacing({ modelId: ORIGIN_GROQ_FREE_MODEL_ID, estimatedTokens: 4_114, limitTokensPerMinute: LIMIT, nowMs: T0 + 60_000 }))
      .toEqual({ action: "send" });
  });

  it("books windows per model: another model's bookings do not count", () => {
    recordOriginProviderPacingSend(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID, 6_000, T0);
    expect(evaluateOriginProviderPacing({ modelId: ORIGIN_GROQ_FREE_MODEL_ID, estimatedTokens: 4_114, limitTokensPerMinute: LIMIT, nowMs: T0 }))
      .toEqual({ action: "send" });
    expect(evaluateOriginProviderPacing({ modelId: ORIGIN_GROQ_FREE_ROTATION_MODEL_ID, estimatedTokens: 4_114, limitTokensPerMinute: LIMIT, nowMs: T0 }))
      .toEqual({ action: "wait", waitMs: 60_000 });
  });

  it("never paces a single send larger than the safety line (the per-request gate governs it)", () => {
    recordOriginProviderPacingSend(ORIGIN_GROQ_FREE_MODEL_ID, 6_000, T0);
    expect(evaluateOriginProviderPacing({ modelId: ORIGIN_GROQ_FREE_MODEL_ID, estimatedTokens: 7_000, limitTokensPerMinute: LIMIT, nowMs: T0 }))
      .toEqual({ action: "send" });
  });

  it("sends on degenerate inputs instead of inventing a wait", () => {
    expect(evaluateOriginProviderPacing({ modelId: ORIGIN_GROQ_FREE_MODEL_ID, estimatedTokens: 0, limitTokensPerMinute: LIMIT, nowMs: T0 }))
      .toEqual({ action: "send" });
    expect(evaluateOriginProviderPacing({ modelId: ORIGIN_GROQ_FREE_MODEL_ID, estimatedTokens: 100, limitTokensPerMinute: 0, nowMs: T0 }))
      .toEqual({ action: "send" });
  });
});

describe("evaluateOriginProviderPacing (D-0 ledger correction)", () => {
  it("lets the provider's own reported booked amount govern when it is larger", () => {
    // The provider reports only 2,000 of 8,000 tokens remaining, resetting
    // in 45s: 6,000 booked until then, invisible to the local window.
    recordOriginRateLimitObservation({
      providerId: ORIGIN_GROQ_FREE_PROVIDER_ID,
      modelId: ORIGIN_GROQ_FREE_MODEL_ID,
      snapshot: { limitTokens: 8_000, remainingTokens: 2_000, resetTokensSeconds: 45 },
      limitHit: false,
      observedAtMs: T0,
    });
    expect(evaluateOriginProviderPacing({ modelId: ORIGIN_GROQ_FREE_MODEL_ID, estimatedTokens: 500, limitTokensPerMinute: LIMIT, nowMs: T0 }))
      .toEqual({ action: "wait", waitMs: 45_000 });
    expect(evaluateOriginProviderPacing({ modelId: ORIGIN_GROQ_FREE_MODEL_ID, estimatedTokens: 500, limitTokensPerMinute: LIMIT, nowMs: T0 + 45_000 }))
      .toEqual({ action: "send" });
  });

  it("takes the maximum of local and observed bookings, never the sum", () => {
    recordOriginProviderPacingSend(ORIGIN_GROQ_FREE_MODEL_ID, 5_000, T0);
    // Observed booked is 3,000 (the provider's figure already includes
    // this process's own sends). Sum semantics would book 8,000 and
    // wait; max semantics books 5,000, and 5,000 + 1,000 fits the line.
    recordOriginRateLimitObservation({
      providerId: ORIGIN_GROQ_FREE_PROVIDER_ID,
      modelId: ORIGIN_GROQ_FREE_MODEL_ID,
      snapshot: { limitTokens: 8_000, remainingTokens: 5_000, resetTokensSeconds: 10 },
      limitHit: false,
      observedAtMs: T0,
    });
    expect(evaluateOriginProviderPacing({ modelId: ORIGIN_GROQ_FREE_MODEL_ID, estimatedTokens: 1_000, limitTokensPerMinute: LIMIT, nowMs: T0 }))
      .toEqual({ action: "send" });
  });

  it("ignores an observation whose reset horizon has already passed", () => {
    recordOriginRateLimitObservation({
      providerId: ORIGIN_GROQ_FREE_PROVIDER_ID,
      modelId: ORIGIN_GROQ_FREE_MODEL_ID,
      snapshot: { limitTokens: 8_000, remainingTokens: 0, resetTokensSeconds: 30 },
      limitHit: true,
      observedAtMs: T0 - 120_000,
    });
    expect(evaluateOriginProviderPacing({ modelId: ORIGIN_GROQ_FREE_MODEL_ID, estimatedTokens: 4_114, limitTokensPerMinute: LIMIT, nowMs: T0 }))
      .toEqual({ action: "send" });
  });

  it("keeps the wait ceiling aligned with the analyzer retry's per-step ceiling", () => {
    expect(ORIGIN_PROVIDER_PACING_MAX_WAIT_MS).toBe(60_000);
  });
});
