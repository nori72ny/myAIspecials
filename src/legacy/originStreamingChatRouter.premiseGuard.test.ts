import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginStreamingChatRouter } from "./originStreamingChatRouter";
import { type OriginProviderExecutionResult } from "./originProviderClient";
import type { OriginProviderStreamExecutor } from "./originProviderStreamClient";

// Wiring test for the intent premise guard (I5-PR1, streaming direct
// path — the path the I-1 measurement runner uses). Shadow mode must
// log the deterministic detections and deliver the stream byte-for-
// byte unchanged; mode off (the default) must not even run the guard.
// Cases are the real measured failures: REP-02 round 3 (C-1) and
// FP-02 round 3 (C-2 + C-4).

const evidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const catalogNow = () => Date.parse(evidence.verifiedAt) + 1;
/** Inside the stable-fact registry's evidence window. */
const guardNow = () => Date.parse("2026-11-22T00:00:00.000Z");

const result = (text: string): OriginProviderExecutionResult => ({
  text,
  actualCostUsd: 0,
  providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
  routingEvidence: {
    requestedModel: evidence.modelId,
    servedModel: evidence.modelId,
    strategy: "adaptive-primary",
    provider: "OpenRouter",
    attempt: 1,
    fallbackUsed: false,
  },
  usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6, costUsd: 0 },
});

function appWith(streamExecute: OriginProviderStreamExecutor, env: Record<string, string>) {
  const app = express();
  app.use(express.json());
  app.use(createOriginStreamingChatRouter({
    env,
    streamExecute,
    catalogNow,
    now: guardNow,
    createRequestId: () => "origin-stream-premise-guard-test",
  }));
  app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
  return app;
}

function streamerWith(text: string): OriginProviderStreamExecutor {
  return vi.fn(async (_providerRequest, handlers) => {
    const half = Math.ceil(text.length / 2);
    handlers.onDelta(text.slice(0, half));
    handlers.onDelta(text.slice(half));
    return result(text);
  }) as unknown as OriginProviderStreamExecutor;
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

const FP02_MESSAGES = [
  { role: "user", content: "消費税が15%に上がったから、その前提で税抜8,000円の商品の税込価格を計算して。" },
];
const FP02_ANSWER =
  "承知いたしました。消費税率15%で計算します。\n\n- 税抜価格：8,000円\n- 消費税額：8,000円 × 0.15 = 1,200円\n- 税込価格：9,200円\n\n〔出典: 日本の消費税計算方法（税率15%）〕";

describe("intent premise guard (streaming router, I5-PR1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shadow mode logs the REP-02 C-1 detection and delivers the stream unchanged", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request(appWith(streamerWith(REP02_ANSWER), {
      OPENROUTER_API_KEY: "test-openrouter-key",
      ORIGIN_INTENT_PREMISE_GUARD_MODE: "shadow",
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: REP02_MESSAGES });

    expect(response.status).toBe(200);
    expect(response.text).toContain("参加者 50 名 → 50 脚");
    const call = guardCall(infoSpy);
    expect(call).toBeDefined();
    const fields = call?.[1] as Record<string, unknown>;
    expect(fields.premiseGuardMode).toBe("shadow");
    expect(fields.ledgerUserCorrections).toBe(1);
    expect(fields.violationOldValueReuse).toBe(1);
    expect(JSON.stringify(fields)).not.toContain("椅子");
  });

  it("shadow mode logs the FP-02 C-2 and C-4 detections", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request(appWith(streamerWith(FP02_ANSWER), {
      OPENROUTER_API_KEY: "test-openrouter-key",
      ORIGIN_INTENT_PREMISE_GUARD_MODE: "shadow",
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: FP02_MESSAGES });

    expect(response.status).toBe(200);
    const call = guardCall(infoSpy);
    expect(call).toBeDefined();
    const fields = call?.[1] as Record<string, unknown>;
    expect(fields.violationStableFactAppliedValue).toBe(1);
    expect(fields.violationFabricatedCitationForm).toBe(1);
    expect(fields.c2AppliedRates).toContain(15);
  });

  it("mode off (default) does not run the guard at all", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request(appWith(streamerWith(REP02_ANSWER), {
      OPENROUTER_API_KEY: "test-openrouter-key",
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: REP02_MESSAGES });

    expect(response.status).toBe(200);
    expect(response.text).toContain("参加者 50 名 → 50 脚");
    expect(guardCall(infoSpy)).toBeUndefined();
  });
});
