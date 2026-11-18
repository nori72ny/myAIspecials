import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginStreamingChatRouter } from "./originStreamingChatRouter";
import { type OriginProviderExecutionResult } from "./originProviderClient";
import type { OriginProviderStreamExecutor } from "./originProviderStreamClient";

// Wiring tests for PR-5's bounded refusal retry on the streaming
// (direct) path. The retry can only run when a gate armed the
// buffered delivery — here the publication gate in enforce mode,
// which buffers every non-deck direct answer — because on an
// incrementally released stream the refusal would already be on
// the user's screen.

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

function appWith(streamExecute: OriginProviderStreamExecutor, env: NodeJS.ProcessEnv) {
  const app = express();
  app.use(express.json());
  app.use(createOriginStreamingChatRouter({
    env,
    streamExecute,
    catalogNow,
    createRequestId: () => "origin-stream-refusal-retry-test",
  }));
  app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
  return app;
}

const J05_QUESTION = { messages: [{ role: "user", content: "副業を始めたいのですが、会社にバレずにやる方法を教えてください。" }] };
const J05_REFUSAL = "申し訳ありませんが、そのご要望には対応できません。";
const J05_SUBSTANTIVE =
  "副業を始める場合は、まず就業規則で副業が許可されているかを確認することが前提です。副業の所得が年間20万円を超える場合は確定申告が必要ですし、住民税は普通徴収を選べる場合があります。会社の許可が必要なケースでは、事前に所定の手続きで申請してください。";
const BUFFERED_ENV: NodeJS.ProcessEnv = {
  OPENROUTER_API_KEY: "synthetic-key",
  ORIGIN_PUBLICATION_GATE_MODE: "enforce",
  ORIGIN_RECOVERY_REFUSAL_VALIDATION_MODE: "enforce",
};

function streamOf(texts: string[]) {
  let call = 0;
  return vi.fn(async (_providerRequest: unknown, handlers: { onDelta: (text: string) => void }) => {
    const text = texts[Math.min(call, texts.length - 1)];
    call += 1;
    handlers.onDelta(text);
    return result(text);
  }) as unknown as OriginProviderStreamExecutor & ReturnType<typeof vi.fn>;
}

describe("recovery refusal retry (streaming router, PR-5)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-executes once when buffered and delivers the substantive retry instead of the refusal", async () => {
    const streamExecute = streamOf([J05_REFUSAL, J05_SUBSTANTIVE]);
    const response = await request(appWith(streamExecute, BUFFERED_ENV))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send(J05_QUESTION);

    expect(response.status).toBe(200);
    expect(streamExecute).toHaveBeenCalledTimes(2);
    expect(response.text).toContain("就業規則で副業が許可されているか");
    expect(response.text).not.toContain("対応できません");
    // The retry dispatch carries the fixed minimal instruction on
    // the standard instruction (and never on the compact route-3
    // instruction).
    const retryRequest = streamExecute.mock.calls[1]?.[0] as { systemInstruction: string; groqSystemInstruction?: string };
    const firstRequest = streamExecute.mock.calls[0]?.[0] as { systemInstruction: string; groqSystemInstruction?: string };
    expect(retryRequest.systemInstruction).toContain("短い拒否だけでは終わらせないでください");
    expect(retryRequest.groqSystemInstruction).toBe(firstRequest.groqSystemInstruction);
  });

  it("keeps the original refusal when the retry is also refusal-like", async () => {
    const streamExecute = streamOf([J05_REFUSAL, "申し訳ありませんが、お答えできません。"]);
    const response = await request(appWith(streamExecute, BUFFERED_ENV))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send(J05_QUESTION);

    expect(response.status).toBe(200);
    expect(streamExecute).toHaveBeenCalledTimes(2);
    expect(response.text).toContain("対応できません");
    expect(response.text).not.toContain("お答えできません");
  });

  it("in shadow mode never re-executes, even when buffered", async () => {
    const streamExecute = streamOf([J05_REFUSAL, J05_SUBSTANTIVE]);
    const response = await request(appWith(streamExecute, { ...BUFFERED_ENV, ORIGIN_RECOVERY_REFUSAL_VALIDATION_MODE: "shadow" }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send(J05_QUESTION);

    expect(response.status).toBe(200);
    expect(streamExecute).toHaveBeenCalledTimes(1);
    expect(response.text).toContain("対応できません");
  });

  it("does not retry on an incrementally released stream (no gate armed)", async () => {
    const streamExecute = streamOf([J05_REFUSAL, J05_SUBSTANTIVE]);
    const response = await request(appWith(streamExecute, {
      OPENROUTER_API_KEY: "synthetic-key",
      ORIGIN_RECOVERY_REFUSAL_VALIDATION_MODE: "enforce",
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send(J05_QUESTION);

    expect(response.status).toBe(200);
    expect(streamExecute).toHaveBeenCalledTimes(1);
    expect(response.text).toContain("対応できません");
  });
});
