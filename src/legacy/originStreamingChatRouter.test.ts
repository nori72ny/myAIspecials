import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginStreamingChatRouter } from "./originStreamingChatRouter";
import { OriginProviderError, type OriginProviderExecutionResult } from "./originProviderClient";
import type { OriginProviderStreamExecutor } from "./originProviderStreamClient";

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
    createRequestId: () => "origin-stream-test",
  }));
  app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
  return app;
}

describe("createOriginStreamingChatRouter", () => {
  it("forwards provider deltas directly without post-completion artificial splitting", async () => {
    const streamExecute = vi.fn(async (_providerRequest, handlers) => {
      handlers.onDelta("first");
      handlers.onDelta(" second");
      return result("first second");
    }) as unknown as OriginProviderStreamExecutor;
    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "短い案内文を作ってください" }] });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["x-origin-stream-source"]).toBe("upstream");
    expect(response.headers["x-origin-stream-protocol"]).toBe("origin-verified-sse-v1");
    expect(response.headers["x-origin-free-only"]).toBe("true");
    expect(response.headers["x-origin-cost-usd"]).toBe("0");
    expect(response.headers["x-origin-billing-tier"]).toBe("free");
    expect(response.headers["x-origin-model-id"]).toBe(evidence.modelId);
    expect(response.text).toContain(`data: {"type":"delta","text":"first"}`);
    expect(response.text).toContain(`data: {"type":"delta","text":" second"}`);
    expect(response.text).toContain(`data: {"type":"complete","modelId":"${evidence.modelId}","servedModel":"${evidence.modelId}","costUsd":0,"fallbackUsed":false}`);
    expect(response.text).toMatch(/data: \[DONE\]\s*$/);
    expect(streamExecute).toHaveBeenCalledTimes(1);
  });

  it("passes the coherent multi-turn context window to the streaming provider", async () => {
    const streamExecute = vi.fn(async (providerRequest, handlers) => {
      expect(providerRequest.messages).toEqual([
        { role: "user", content: "合言葉は ORIGIN-CONTEXT-42 です。" },
        { role: "assistant", content: "覚えました。" },
        { role: "user", content: "さきほどの合言葉を答えてください。" },
      ]);
      handlers.onDelta("ORIGIN-CONTEXT-42");
      return result("ORIGIN-CONTEXT-42");
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [
        { role: "user", content: "合言葉は ORIGIN-CONTEXT-42 です。" },
        { role: "assistant", content: "覚えました。" },
        { role: "user", content: "さきほどの合言葉を答えてください。" },
      ] });
    expect(response.status).toBe(200);
    expect(response.text).toContain(`data: {"type":"delta","text":"ORIGIN-CONTEXT-42"}`);
    expect(response.text).toMatch(/data: \[DONE\]\s*$/);
    expect(streamExecute).toHaveBeenCalledTimes(1);
  });

  it("keeps task-specific clarification guidance when the user answers with a short choice", async () => {
    const streamExecute = vi.fn(async (providerRequest, handlers) => {
      expect(providerRequest.systemInstruction).toContain("Requirement clarification mode (adaptive");
      expect(providerRequest.systemInstruction).toContain("user-workflows");
      expect(providerRequest.systemInstruction).toContain("storage-sharing");
      expect(providerRequest.systemInstruction).toContain("Never ask the same requirement twice");
      handlers.onDelta("確認を続けます");
      return result("確認を続けます");
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [
        { role: "user", content: "ウェブアプリで売上を管理できるようにしてください" },
        { role: "assistant", content: "簡易版と複数人利用版のどちらにしますか？ 1. 簡易版 2. 複数人利用版" },
        { role: "user", content: "1" },
      ] });

    expect(response.status).toBe(200);
    expect(response.text).toContain('"type":"complete"');
    expect(streamExecute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["supplied pricing transformation", "この文章を200字以内に短くして。『新サービスは10月開始予定で、詳細料金は来週確定します。』"],
    ["hypothetical freshness failure", "最新の為替レートを検索できない状態だと仮定します。1ドルが何円か断定せず、安全な次の行動を示してください。"],
    ["stable pricing concept", "価格弾力性の意味を実務向けに説明してください。"],
  ])("keeps %s on the upstream streaming path", async (_label, prompt) => {
    const streamExecute = vi.fn(async (providerRequest, handlers) => {
      expect(providerRequest.systemInstruction).toContain("For complex multi-part requests, use as many distinct points as needed");
      expect(providerRequest.systemInstruction).toContain("Distinguish user-provided claims explicitly");
      handlers.onDelta("streamed");
      return result("streamed");
    }) as unknown as OriginProviderStreamExecutor;
    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: prompt }] });
    expect(response.status).toBe(200);
    expect(response.text).toContain('"type":"complete"');
    expect(streamExecute).toHaveBeenCalledTimes(1);
  });

  it("ends a failed partial stream without a completion proof or DONE", async () => {
    const streamExecute = vi.fn(async (_providerRequest, handlers) => {
      handlers.onDelta("unverified partial");
      throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "private detail", 502, false);
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "文章を作ってください" }] });
    expect(response.status).toBe(200);
    expect(response.text).toContain(`data: {"type":"delta","text":"unverified partial"}`);
    expect(response.text).toContain(`data: {"type":"error"}`);
    expect(response.text).not.toContain('"type":"complete"');
    expect(response.text).not.toContain("[DONE]");
  });

  it("returns a safe JSON failure when the upstream fails before the first delta", async () => {
    const streamExecute = vi.fn(async () => {
      throw new OriginProviderError("PROVIDER_UNAVAILABLE", "private upstream body", 503, true, undefined, { upstreamErrorType: "private-diagnostic" });
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "文章を作ってください" }] });
    expect(response.status).toBe(503);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true, retryAttempted: false, requestId: "origin-stream-test" });
    expect(JSON.stringify(response.body)).not.toContain("private-");
    expect(streamExecute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["capability question", "あなたは何ができるのですか？"],
    ["current information with a modifier", "今日のAIニュースを教えてください"],
    ["explicit research", "候補サービスを調査して、公開情報の出典を探してください"],
  ])("delegates %s to the legacy grounded/local fail-closed path", async (_label, prompt) => {
    const streamExecute = vi.fn() as unknown as OriginProviderStreamExecutor;
    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: prompt }] });
    expect(response.status).toBe(418);
    expect(response.body).toEqual({ delegated: true });
    expect(streamExecute).not.toHaveBeenCalled();
  });
});
