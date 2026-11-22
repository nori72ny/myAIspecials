import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";

// Wiring test for the intent premise guard (I5-PR1, non-streaming
// direct path). Shadow mode logs the deterministic detection and
// returns the model answer unchanged; mode off (the default) does
// not run the guard. The case is the real measured failure REP-02
// round 3 (C-1 old-value reuse).

const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;
/** Inside the stable-fact registry's evidence window. */
const guardNow = () => Date.parse("2026-11-22T00:00:00.000Z");

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
    now: guardNow,
    createRequestId: () => "origin-premise-guard-test",
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

function guardCall(infoSpy: ReturnType<typeof vi.spyOn>) {
  return infoSpy.mock.calls.find(([message]) =>
    String(message).includes("intent premise guard"),
  );
}

const REP02_MESSAGES = [
  { role: "user", content: "イベントの企画を考えています。参加者は50人想定で、会場の広さを相談したい。" },
  { role: "assistant", content: "50名規模の会場をご案内します。" },
  { role: "user", content: "訂正します。参加者は30人でした。その前提で会場の広さを教えて。" },
  { role: "assistant", content: "30名前提でご案内します。" },
  { role: "user", content: "50人だと椅子は何脚いるかな。" },
];
const REP02_ANSWER = "**椅子の必要数**\n- 参加者 50 名 → 50 脚\n- 余裕として 2〜3 脚を追加すると 52〜53 脚が推奨されます。";

describe("intent premise guard (non-streaming router, I5-PR1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shadow mode logs the REP-02 C-1 detection and returns the body unchanged", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request(createApp(executorWith(REP02_ANSWER), {
      OPENROUTER_API_KEY: "test-openrouter-key",
      ORIGIN_INTENT_PREMISE_GUARD_MODE: "shadow",
    }))
      .post("/api/chat")
      .send({ messages: REP02_MESSAGES });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(REP02_ANSWER);
    const call = guardCall(infoSpy);
    expect(call).toBeDefined();
    const fields = call?.[1] as Record<string, unknown>;
    expect(fields.premiseGuardMode).toBe("shadow");
    expect(fields.ledgerUserCorrections).toBe(1);
    expect(fields.violationOldValueReuse).toBe(1);
    // Log-only wiring: no premise-guard metadata leaks into the response.
    expect(JSON.stringify(response.body)).not.toContain("premiseGuard");
  });

  it("mode off (default) does not run the guard at all", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request(createApp(executorWith(REP02_ANSWER), {
      OPENROUTER_API_KEY: "test-openrouter-key",
    }))
      .post("/api/chat")
      .send({ messages: REP02_MESSAGES });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(REP02_ANSWER);
    expect(guardCall(infoSpy)).toBeUndefined();
  });
});
