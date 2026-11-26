import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginStreamingChatRouter } from "./originStreamingChatRouter";
import { type OriginProviderExecutionResult } from "./originProviderClient";
import type { OriginProviderStreamExecutor } from "./originProviderStreamClient";

// Wiring test for the publication gate's shadow mode (streaming/direct
// path): the delivered SSE stream stays byte-identical to the model
// answer, and the gate logs kinds and counts only — never answer text.

const evidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const catalogNow = () => Date.parse(evidence.verifiedAt) + 1;
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

function appWith(streamExecute: OriginProviderStreamExecutor) {
  const app = express();
  app.use(express.json());
  app.use(createOriginStreamingChatRouter({
    env: { OPENROUTER_API_KEY: "synthetic-key" },
    streamExecute,
    catalogNow,
    createRequestId: () => "origin-stream-publication-gate-test",
  }));
  app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
  return app;
}

const FABRICATED_LAW_ANSWER = "デジタル資産保護法は2021年4月1日から施行されました。登録手数料は16,000円です。";

describe("publication gate shadow mode (streaming router)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs detections for a direct answer and delivers the text unchanged", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const streamExecute = vi.fn(async (_providerRequest, handlers) => {
      handlers.onDelta(FABRICATED_LAW_ANSWER);
      return result(FABRICATED_LAW_ANSWER);
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "手紙の書き出しの例を教えてください。" }] });

    expect(response.status).toBe(200);
    // The delivered stream carries the model answer verbatim (shadow
    // mode never alters delivery, even for a fabricated statute).
    expect(response.text).toContain("デジタル資産保護法は2021年4月1日から施行されました");
    expect(response.text).toContain("16,000円");
    // The shadow log carries the detection as kinds and counts only.
    const gateCall = infoSpy.mock.calls.find(([message]) => String(message).includes("publication gate (shadow)"));
    expect(gateCall).toBeDefined();
    const fields = gateCall?.[1] as Record<string, unknown>;
    expect(fields.requestId).toBe("origin-stream-publication-gate-test");
    expect(fields.publicationGateLawNameCount).toBe(1);
    expect(fields.publicationGateLawEnforcementCount).toBe(1);
    expect(fields.publicationGateAmountFeeCount).toBe(1);
    expect(fields.lawNameCandidateCount).toBe(1);
    expect(fields.lawNameVerifiedCount).toBe(0);
    expect(fields.lawNameUnverifiedCount).toBe(1);
    // No answer text anywhere in the logged fields.
    expect(JSON.stringify(fields)).not.toContain("デジタル資産保護法");
    expect(JSON.stringify(fields)).not.toContain("16,000円");
  });

  it("logs a zero summary for a claim-free direct answer", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const answer = "短い回答です。特に主張は含みません。";
    const streamExecute = vi.fn(async (_providerRequest, handlers) => {
      handlers.onDelta(answer);
      return result(answer);
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "あいさつ文の例を教えてください。" }] });

    expect(response.status).toBe(200);
    expect(response.text).toContain("短い回答です");
    const gateCall = infoSpy.mock.calls.find(([message]) => String(message).includes("publication gate (shadow)"));
    expect(gateCall).toBeDefined();
    const fields = gateCall?.[1] as Record<string, unknown>;
    expect(fields.publicationGateTotalCount).toBe(0);
    expect(fields.lawNameCandidateCount).toBe(0);
  });
});

const STALE_CAPACITY_ANSWER = "衆議院は465名、参議院は245名です。";
const STALE_CAPACITY_QUESTION = "国会の衆議院と参議院の議員定数はそれぞれ何人ですか？";
const CALCULATION_QUESTION = "税抜12,800円の商品を3個買うと、消費税10%込みでいくらになりますか？";
const CALCULATION_ANSWER = "税込みで42,240円です。";

function appWithEnv(streamExecute: OriginProviderStreamExecutor, env: NodeJS.ProcessEnv) {
  const app = express();
  app.use(express.json());
  app.use(createOriginStreamingChatRouter({
    env,
    streamExecute,
    catalogNow,
    createRequestId: () => "origin-stream-publication-gate-test",
  }));
  app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
  return app;
}

function streamingExecutor(fullText: string, splitAt: number): OriginProviderStreamExecutor {
  return vi.fn(async (_providerRequest, handlers) => {
    handlers.onDelta(fullText.slice(0, splitAt));
    handlers.onDelta(fullText.slice(splitAt));
    return result(fullText);
  }) as unknown as OriginProviderStreamExecutor;
}

describe("publication gate enforcement mode (streaming router)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("buffers a stale-capacity answer and delivers the tier-T4 hold instead", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request(appWithEnv(streamingExecutor(STALE_CAPACITY_ANSWER, 8), {
      OPENROUTER_API_KEY: "synthetic-key",
      ORIGIN_PUBLICATION_GATE_MODE: "enforce",
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: STALE_CAPACITY_QUESTION }] });

    expect(response.status).toBe(200);
    // The stale figure never reaches the client; the hold text does.
    expect(response.text).not.toContain("245名");
    expect(response.text).toContain("確認できた情報がないため、推測で回答しません");
    const enforceCall = infoSpy.mock.calls.find(([message]) => String(message).includes("publication gate (enforce)"));
    expect(enforceCall).toBeDefined();
    const fields = enforceCall?.[1] as Record<string, unknown>;
    expect(fields.publicationGateHeld).toBe(true);
    expect(fields.researchTier).toBe("T4");
    expect(fields.researchOutcome).toBe("ABSTAIN");
    expect(fields.researchAbstainReason).toBe("high-risk-insufficient-sources");
    expect(JSON.stringify(fields)).not.toContain("245名");
    // The shadow line is not emitted for the same answer (no double count).
    const shadowCall = infoSpy.mock.calls.find(([message]) => String(message).includes("publication gate (shadow)"));
    expect(shadowCall).toBeUndefined();
  });

  it("streams an amount-only calculation answer unchanged in enforce mode", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request(appWithEnv(streamingExecutor(CALCULATION_ANSWER, 4), {
      OPENROUTER_API_KEY: "synthetic-key",
      ORIGIN_PUBLICATION_GATE_MODE: "enforce",
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: CALCULATION_QUESTION }] });

    expect(response.status).toBe(200);
    // Delivered as the buffered deltas flushed in order (the split
    // point sits between the two fragments asserted here).
    expect(response.text).toContain("税込みで");
    expect(response.text).toContain("42,240円です");
  });

  it("without the env switch the same stale-capacity answer streams unchanged (shadow default)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request(appWithEnv(streamingExecutor(STALE_CAPACITY_ANSWER, 8), {
      OPENROUTER_API_KEY: "synthetic-key",
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: STALE_CAPACITY_QUESTION }] });

    expect(response.status).toBe(200);
    expect(response.text).toContain("参議院は245名です");
  });
});
