import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";

// Wiring test for the date/weekday verification gate (non-streaming
// direct path), using the real H-07 case from the fixed-100 round-4
// measurement: shadow mode logs the detection and returns the model
// answer unchanged; enforce mode returns the deterministically
// corrected answer.

const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;

const H07_QUESTION = "2026年11月7日の45日後は、何月何日で何曜日ですか？";
const H07_ANSWER =
  "2026年12月23日（火曜日）が45日後です。  \n\n**ポイント**  \n- 2026年11月7日から23日で11月30日まで。  \n- 残り22日で12月23日になる。  \n- 2026年11月7日は土曜日。45日後は3日後 → 火曜日。";
const H07_CORRECTED =
  "2026年12月22日（火曜日）が45日後です。  \n\n**ポイント**  \n- 2026年11月7日から23日で11月30日まで。  \n- 残り22日で12月22日になる。  \n- 2026年11月7日は土曜日。45日後は3日後 → 火曜日。";

function createApp(execute: OriginChatExecutor, env: Record<string, string>) {
  const app = express();
  app.use(express.json());
  const research: OriginResearchExecutor = async () => ({ ok: false, sources: [], failure: { stage: "web-search", code: "NO_RESULTS" } });
  app.use(createOriginChatRouter({
    env,
    execute,
    research,
    researchSynthesis: null,
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-date-verification-test",
  }));
  return app;
}

function executorWith(text: string): OriginChatExecutor {
  return vi.fn(async () => ({
    text,
    transportRequestCount: 1,
    actualCostUsd: 0 as const,
    providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
    routingEvidence: { requestedModel: verifiedEvidence.modelId, servedModel: verifiedEvidence.modelId, strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
  })) as unknown as OriginChatExecutor;
}

function gateCall(infoSpy: ReturnType<typeof vi.spyOn>, marker: string) {
  return infoSpy.mock.calls.find(([message]) => String(message).includes(marker));
}

describe("date/weekday verification gate (non-streaming router)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shadow mode (default) logs the H-07 detection and returns the body unchanged", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request(createApp(executorWith(H07_ANSWER), { OPENROUTER_API_KEY: "synthetic-test-key" }))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: H07_QUESTION }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(H07_ANSWER);
    const call = gateCall(infoSpy, "date weekday verification (shadow)");
    expect(call).toBeDefined();
    const fields = call?.[1] as Record<string, unknown>;
    expect(fields.requestId).toBe("origin-date-verification-test");
    expect(fields.dateVerificationPairCount).toBe(2);
    expect(fields.dateVerificationWeekdayMismatchCount).toBe(1);
    expect(fields.dateVerificationRelativeChecked).toBe(1);
    expect(fields.dateVerificationRelativeMismatchCount).toBe(1);
    expect(fields.dateVerificationFixableCount).toBe(2);
    expect(fields.dateVerificationCorrectedCount).toBe(0);
    expect(JSON.stringify(fields)).not.toContain("12月23日");
  });

  it("enforce mode returns the corrected H-07 answer", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request(createApp(executorWith(H07_ANSWER), {
      OPENROUTER_API_KEY: "synthetic-test-key",
      ORIGIN_DATE_WEEKDAY_VERIFICATION_MODE: "enforce",
    }))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: H07_QUESTION }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(H07_CORRECTED);
    const call = gateCall(infoSpy, "date weekday verification (enforce)");
    expect(call).toBeDefined();
    const fields = call?.[1] as Record<string, unknown>;
    expect(fields.dateVerificationCorrectedCount).toBe(2);
    expect(JSON.stringify(fields)).not.toContain("12月22日");
  });
});
