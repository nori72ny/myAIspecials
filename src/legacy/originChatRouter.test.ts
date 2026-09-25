import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OriginContextPolicy } from "../lib/orchestration/OriginContextPolicy";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";
import { OriginProviderError } from "./originProviderClient";

const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;
const defaultExecutionResult = {
  text: "安全な確認結果です。",
  actualCostUsd: 0 as const,
  providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
  routingEvidence: { requestedModel: "inclusionai/ling-3.0-flash-sante:free", servedModel: "inclusionai/ling-3.0-flash-sante:free", strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
};

function createApp(
  execute: OriginChatExecutor,
  env: NodeJS.ProcessEnv = { OPENROUTER_API_KEY: "synthetic-test-key" },
  catalogNow: () => number = () => verifiedCatalogTime,
  contextPolicy?: OriginContextPolicy,
  research: OriginResearchExecutor = async () => ({ ok: false, sources: [], failure: { stage: "web-search", code: "NO_RESULTS" } }),
  researchSynthesis: OriginChatExecutor | null = null,
) {
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({ env, execute, research, researchSynthesis, now: (() => { let current = 1_000; return () => { current += 25; return current; }; })(), catalogNow, contextPolicy, createRequestId: () => "origin-test-trace" }));
  return app;
}

describe("createOriginChatRouter", () => {
  let execute: OriginChatExecutor;
  let executeMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { executeMock = vi.fn().mockResolvedValue(defaultExecutionResult); execute = executeMock as OriginChatExecutor; });

  it("rejects invalid messages before provider execution", async () => { const response = await request(createApp(execute)).post("/api/chat").send({}); expect(response.status).toBe(400); expect(response.body.code).toBe("INVALID_CHAT_MESSAGES"); expect(executeMock).not.toHaveBeenCalled(); });
  it("blocks synthetic secrets before provider execution", async () => { const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "Authorization: Bearer synthetic_token_value_123456" }] }); expect(response.status).toBe(422); expect(response.body.code).toBe("SENSITIVE_INPUT_BLOCKED"); expect(JSON.stringify(response.body)).not.toContain("synthetic_token_value_123456"); expect(executeMock).not.toHaveBeenCalled(); });
  it("returns a validated zero-cost routing envelope", async () => { const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "認証処理をレビューしてください" }] }); expect(response.status).toBe(200); expect(response.body.content).toBe("安全な確認結果です。"); expect(response.body.routing).toEqual(expect.objectContaining({ model: "ORIGIN 無料AI", providerId: "openrouter-free", modelId: "inclusionai/ling-3.0-flash-sante:free", cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, freeOnly: true, traceId: "origin-test-trace", verificationStatus: "not-run", reviewRequired: true, providerAttempts: 1, providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true }, providerRouting: { requestedModel: "inclusionai/ling-3.0-flash-sante:free", servedModel: "inclusionai/ling-3.0-flash-sante:free", strategy: "adaptive-primary", provider: "OpenRouter", attempt: 1, fallbackUsed: false }, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 } })); expect(executeMock).toHaveBeenCalledTimes(1); const call = executeMock.mock.calls[0]?.[0]; expect(call?.systemInstruction).toContain("For routine explanatory or comparison answers"); expect(call?.systemInstruction).toContain("For complex multi-part requests, use as many distinct points as needed"); expect(call?.systemInstruction).toContain("Ask one to three focused questions per turn"); expect(call?.systemInstruction).toContain("Continue the clarification loop across turns"); });
  it("marks low-risk writing as not requiring independent review", async () => { const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "短い案内文を読みやすく整えてください" }] }); expect(response.status).toBe(200); expect(response.body.answer.verification).toEqual({ status: "not-required", independentReviewPerformed: false, summary: "この依頼では、追加の独立確認を必須と判定していません。" }); expect(response.body.answer.limitations).toEqual([]); expect(response.body.answer.nextActions).toEqual([]); });
  it("preserves model-provided HTTPS evidence without claiming verification", async () => {
    executeMock.mockResolvedValueOnce({ ...defaultExecutionResult, text: "詳細は[公式資料](https://example.com/current)を参照してください。" });
    const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "この候補について説明してください" }] });
    expect(response.status).toBe(200);
    expect(response.body.answer.evidence).toEqual([expect.objectContaining({
      label: "公式資料",
      sourceUrl: "https://example.com/current",
      evidenceLevel: "provided",
      checks: { safeUrl: "passed", content: "not-run", freshness: "not-run", claimSupport: "not-run" },
    })]);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("keeps grounded-research failure evidence empty instead of falling through to the model", async () => {
    const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "候補を比較調査してください" }] });
    expect(response.status).toBe(200);
    expect(response.body.answer.evidence).toEqual([]);
    expect(response.body.answer.limitations).toContain("この依頼について、現在の公開情報源を確認できていません。");
    expect(response.body.routing.answerMode).toBe("research");
    expect(executeMock).not.toHaveBeenCalled();
  });
  it("sends only the latest coherent context window", async () => { const response = await request(createApp(execute, undefined, undefined, { version: 1, maxMessages: 3, maxCharacters: 12_000 })).post("/api/chat").send({ messages: [{ role: "ai", content: "初期案内" }, { role: "user", content: "古い依頼" }, { role: "ai", content: "古い回答" }, { role: "user", content: "直近の依頼" }, { role: "ai", content: "直近の回答" }, { role: "user", content: "最新の依頼" }] }); expect(response.status).toBe(200); const call = executeMock.mock.calls[0]?.[0]; expect(call?.messages).toEqual([{ role: "user", content: "直近の依頼" }, { role: "ai", content: "直近の回答" }, { role: "user", content: "最新の依頼" }]); });
  it("sanitizes non-retryable authentication failures", async () => { executeMock.mockRejectedValueOnce(new OriginProviderError("PROVIDER_NOT_CONFIGURED", "内部詳細", 401, false, undefined, { upstreamStatus: 401 })); const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "文章を作ってください" }] }); expect(response.status).toBe(401); expect(JSON.stringify(response.body)).not.toContain("内部詳細"); expect(executeMock).toHaveBeenCalledTimes(1); });
  it.each([
    ["PROVIDER_RATE_LIMITED", 429], ["PROVIDER_TIMEOUT", 504],
    ["PROVIDER_INVALID_RESPONSE", 502], ["PROVIDER_UNAVAILABLE", 503],
  ] as const)("returns a safe failure for %s even when streaming is requested", async (code, status) => {
    executeMock.mockRejectedValue(new OriginProviderError(code, "secret-internal-detail", status, true, undefined, { upstreamErrorType: "secret-diagnostic" }));
    const response = await request(createApp(execute)).post("/api/chat").set("Accept", "text/event-stream").send({ messages: [{ role: "user", content: "短い案内文を整えてください" }] });
    expect(response.status).toBe(status);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({ code, retryable: true, retryAttempted: false });
    expect(response.body.content).toBeUndefined();
    expect(response.body.answer).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain("secret-");
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
  it("does not turn an unexpected exception into a successful answer", async () => {
    executeMock.mockRejectedValue(new Error("secret-internal-detail"));
    const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "文章を整えてください" }] });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe("PROVIDER_INTERNAL_ERROR");
    expect(JSON.stringify(response.body)).not.toContain("secret-internal-detail");
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
  it("does not use Gemini when no explicitly free primary provider is configured", async () => { const response = await request(createApp(execute, { GEMINI_API_KEY: "synthetic-gemini-key" })).post("/api/chat").send({ messages: [{ role: "user", content: "文章を確認してください" }] }); expect(response.status).toBe(503); expect(response.body.code).toBe("FREE_PROVIDER_NOT_CONFIGURED"); expect(executeMock).not.toHaveBeenCalled(); });
  it("fails closed after free-model evidence expires", async () => { const response = await request(createApp(execute, { OPENROUTER_API_KEY: "synthetic-test-key" }, () => Date.parse(verifiedEvidence.reviewAfter) + 1)).post("/api/chat").send({ messages: [{ role: "user", content: "文章を確認してください" }] }); expect(response.status).toBe(503); expect(response.body.code).toBe("FREE_MODEL_EVIDENCE_STALE"); expect(executeMock).not.toHaveBeenCalled(); });
  it("handles weather clarification locally", async () => { const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "今日の天気は？" }] }); expect(response.status).toBe(200); expect(response.body.content).toBe("どの地域の天気をお調べしますか？"); expect(executeMock).not.toHaveBeenCalled(); });
  it("answers capability questions truthfully without provider execution", async () => { const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "あなたは何ができるのですか？具体例を5つ教えてください" }] }); expect(response.status).toBe(200); expect(response.body.content).toContain("Grounded Research"); expect(response.body.content).toContain("PDF、DOCX、XLSX、PPTX"); expect(response.body.content).toContain("MCP経由"); expect(executeMock).not.toHaveBeenCalled(); });
  it("automatically uses Grounded Research for time-sensitive requests without provider execution", async () => {
    const researchMock = vi.fn().mockResolvedValue({
      ok: true,
      searchProvider: "DuckDuckGo",
      sources: [
        {
          title: "Current public source",
          url: "https://example.com/current",
          excerpt: "現在確認できた公開情報の要点です。",
          sourceType: "web-search",
          domain: "example.com",
          rank: 1,
          evidenceLevel: "page-verified",
          retrievedAt: "2026-09-24T06:00:00.000Z",
          freshness: "recent",
        },
      ],
    }) as unknown as OriginResearchExecutor;
    const response = await request(createApp(execute, {}, undefined, undefined, researchMock))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日のニュースを教えてください" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toContain("確認できた公開情報");
    expect(response.body.content).toContain("https://example.com/current");
    expect(response.body.routing).toEqual(expect.objectContaining({
      model: "ORIGIN アプリ内処理",
      answerMode: "research",
      verificationLevel: "evidence-required",
      sourceCount: 1,
      researchProvider: "DuckDuckGo",
      cost: 0,
      freeOnly: true,
    }));
    expect(response.body.answer.evidence).toEqual([
      expect.objectContaining({
        sourceUrl: "https://example.com/current",
        evidenceLevel: "provided",
      }),
    ]);
    expect(researchMock).toHaveBeenCalledWith("今日のニュースを教えてください");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("adopts one zero-cost synthesis only when citations match the retrieved evidence packet", async () => {
    const researchMock = vi.fn().mockResolvedValue({
      ok: true,
      searchProvider: "DuckDuckGo",
      sources: [
        {
          title: "Price source one",
          url: "https://example.com/one",
          excerpt: "料金は100円と記載されています。",
          sourceType: "web-search",
          domain: "example.com",
          rank: 1,
          evidenceLevel: "page-verified",
          retrievedAt: "2026-09-24T06:00:00.000Z",
          freshness: "recent",
        },
        {
          title: "Price source two",
          url: "https://example.org/two",
          excerpt: "料金は120円と記載されています。",
          sourceType: "web-search",
          domain: "example.org",
          rank: 2,
          evidenceLevel: "page-verified",
          retrievedAt: "2026-09-24T06:00:00.000Z",
          freshness: "recent",
        },
      ],
    }) as unknown as OriginResearchExecutor;
    const synthesisText = [
      "## 結論",
      "",
      "取得できた資料では料金表記が一致していません。[S1](https://example.com/one) [S2](https://example.org/two)",
      "",
      "- 1つ目の資料は100円としています。[S1](https://example.com/one)",
      "- 2つ目の資料は120円としています。[S2](https://example.org/two)",
    ].join("\n");
    const synthesisMock = vi.fn().mockResolvedValue({ ...defaultExecutionResult, text: synthesisText }) as unknown as OriginChatExecutor;

    const response = await request(createApp(
      execute,
      { OPENROUTER_API_KEY: "synthetic-test-key" },
      undefined,
      undefined,
      researchMock,
      synthesisMock,
    )).post("/api/chat").send({ messages: [{ role: "user", content: "現在の料金を比較調査してください" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(synthesisText);
    expect(response.body.routing).toEqual(expect.objectContaining({
      model: "ORIGIN 無料AI",
      answerMode: "research",
      verificationLevel: "evidence-required",
      synthesisStatus: "citation-validated",
      synthesisSourceCount: 2,
      providerAttempts: 1,
      cost: 0,
      actualCostUsd: 0,
      freeOnly: true,
    }));
    expect(response.body.answer.verification.status).toBe("not-run");
    expect(response.body.answer.limitations.join(" ")).toContain("引用先が取得済みソースと一致");
    expect(synthesisMock).toHaveBeenCalledTimes(1);
    const synthesisRequest = (synthesisMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(synthesisRequest.messages).toHaveLength(1);
    expect(synthesisRequest.messages[0].content).toContain("[S1](https://example.com/one)");
    expect(synthesisRequest.messages[0].content).toContain("[S2](https://example.org/two)");
    expect(synthesisRequest.systemInstruction).toContain("記憶由来の事実を追加しない");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("discards synthesized text when citation validation fails and returns the deterministic digest", async () => {
    const researchMock = vi.fn().mockResolvedValue({
      ok: true,
      searchProvider: "DuckDuckGo",
      sources: [
        {
          title: "Source one",
          url: "https://example.com/one",
          excerpt: "公開情報その1です。",
          sourceType: "web-search",
          domain: "example.com",
          rank: 1,
          evidenceLevel: "page-verified",
          retrievedAt: "2026-09-24T06:00:00.000Z",
          freshness: "recent",
        },
        {
          title: "Source two",
          url: "https://example.org/two",
          excerpt: "公開情報その2です。",
          sourceType: "web-search",
          domain: "example.org",
          rank: 2,
          evidenceLevel: "page-verified",
          retrievedAt: "2026-09-24T06:00:00.000Z",
          freshness: "recent",
        },
      ],
    }) as unknown as OriginResearchExecutor;
    const synthesisMock = vi.fn().mockResolvedValue({
      ...defaultExecutionResult,
      text: "捏造された統合結果です。[S9](https://outside.invalid/fake)",
    }) as unknown as OriginChatExecutor;

    const response = await request(createApp(
      execute,
      { OPENROUTER_API_KEY: "synthetic-test-key" },
      undefined,
      undefined,
      researchMock,
      synthesisMock,
    )).post("/api/chat").send({ messages: [{ role: "user", content: "最新情報を調査してください" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toContain("確認できた公開情報");
    expect(response.body.content).not.toContain("捏造された統合結果");
    expect(response.body.content).not.toContain("outside.invalid");
    expect(response.body.routing).toEqual(expect.objectContaining({
      model: "ORIGIN アプリ内処理",
      synthesisStatus: "citation-validation-failed",
      synthesisFailureCode: "UNKNOWN_CITATION",
      freeOnly: true,
      cost: 0,
    }));
    expect(synthesisMock).toHaveBeenCalledTimes(1);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("fails the synthesis stage closed after one provider failure and keeps only retrieved evidence", async () => {
    const researchMock = vi.fn().mockResolvedValue({
      ok: true,
      searchProvider: "DuckDuckGo",
      sources: [{
        title: "Current source",
        url: "https://example.com/current",
        excerpt: "現在確認できた公開情報です。",
        sourceType: "web-search",
        domain: "example.com",
        rank: 1,
        evidenceLevel: "page-verified",
        retrievedAt: "2026-09-24T06:00:00.000Z",
        freshness: "recent",
      }],
    }) as unknown as OriginResearchExecutor;
    const synthesisMock = vi.fn().mockRejectedValue(
      new OriginProviderError("PROVIDER_RATE_LIMITED", "internal", 429, true),
    ) as unknown as OriginChatExecutor;

    const response = await request(createApp(
      execute,
      { OPENROUTER_API_KEY: "synthetic-test-key" },
      undefined,
      undefined,
      researchMock,
      synthesisMock,
    )).post("/api/chat").send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toContain("確認できた公開情報");
    expect(response.body.routing).toEqual(expect.objectContaining({
      synthesisStatus: "provider-failed",
      synthesisFailureCode: "PROVIDER_RATE_LIMITED",
      freeOnly: true,
      cost: 0,
    }));
    expect(synthesisMock).toHaveBeenCalledTimes(1);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("does not call synthesis when the verified free provider plan is unavailable", async () => {
    const researchMock = vi.fn().mockResolvedValue({
      ok: true,
      searchProvider: "DuckDuckGo",
      sources: [{
        title: "Current source",
        url: "https://example.com/current",
        excerpt: "現在確認できた公開情報です。",
        sourceType: "web-search",
        domain: "example.com",
        rank: 1,
        evidenceLevel: "page-verified",
        retrievedAt: "2026-09-24T06:00:00.000Z",
        freshness: "recent",
      }],
    }) as unknown as OriginResearchExecutor;
    const synthesisMock = vi.fn() as unknown as OriginChatExecutor;

    const response = await request(createApp(
      execute,
      {},
      undefined,
      undefined,
      researchMock,
      synthesisMock,
    )).post("/api/chat").send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toContain("確認できた公開情報");
    expect(response.body.routing).toEqual(expect.objectContaining({
      synthesisStatus: "plan-unavailable",
      synthesisFailureCode: "FREE_PROVIDER_NOT_CONFIGURED",
      freeOnly: true,
      cost: 0,
    }));
    expect(synthesisMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("automatically uses Grounded Research for an explicit research request", async () => {
    const researchMock = vi.fn().mockResolvedValue({
      ok: true,
      searchProvider: "DuckDuckGo",
      sources: [{
        title: "Competitor source",
        url: "https://example.com/competitor",
        excerpt: "競合サービスの公開情報です。",
        sourceType: "web-search",
        domain: "example.com",
        rank: 1,
        evidenceLevel: "page-verified",
        retrievedAt: "2026-09-24T06:00:00.000Z",
        freshness: "recent",
      }],
    }) as unknown as OriginResearchExecutor;

    const response = await request(createApp(execute, {}, undefined, undefined, researchMock))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "競合サービスを調査してください" }] });

    expect(response.status).toBe(200);
    expect(response.body.routing.answerMode).toBe("research");
    expect(response.body.routing.sourceCount).toBe(1);
    expect(researchMock).toHaveBeenCalledTimes(1);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("does not turn a supplied research-text transformation into a new external search", async () => {
    const researchMock = vi.fn() as unknown as OriginResearchExecutor;
    const response = await request(createApp(execute, undefined, undefined, undefined, researchMock))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "この調査結果を200字に要約してください。『競合Aは法人向けです。』" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe("安全な確認結果です。");
    expect(researchMock).not.toHaveBeenCalled();
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("drops unsafe research URLs and fails closed when no safe HTTPS evidence remains", async () => {
    const researchMock = vi.fn().mockResolvedValue({
      ok: true,
      searchProvider: "DuckDuckGo",
      sources: [{
        title: "Unsafe source",
        url: "http://example.com/current",
        excerpt: "安全ではないURLです。",
        sourceType: "web-search",
        domain: "example.com",
        rank: 1,
        evidenceLevel: "snippet",
        retrievedAt: "2026-09-24T06:00:00.000Z",
        freshness: "unknown",
      }],
    }) as unknown as OriginResearchExecutor;

    const response = await request(createApp(execute, {}, undefined, undefined, researchMock))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "最新情報を調査してください" }] });

    expect(response.status).toBe(200);
    expect(response.body.routing.answerMode).toBe("research");
    expect(response.body.routing.sourceCount).toBe(0);
    expect(response.body.answer.evidence).toEqual([]);
    expect(response.body.content).not.toContain("http://example.com/current");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("fails closed when Grounded Research cannot retrieve current evidence", async () => {
    const response = await request(createApp(execute, {}))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "現在の料金を教えてください" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toContain("現在の情報を推測して回答しません");
    expect(response.body.routing.answerMode).toBe("research");
    expect(response.body.routing.sourceCount).toBe(0);
    expect(executeMock).not.toHaveBeenCalled();
  });
  it("treats acronym definitions as ordinary stable questions unless freshness is explicit", async () => { const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "AIO対策について教えて" }] }); expect(response.status).toBe(200); expect(executeMock).toHaveBeenCalledTimes(1); });
  it("does not confuse personal planning for today with live information", async () => { const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "今日の予定を整理してください" }] }); expect(response.status).toBe(200); expect(response.body.content).toBe("安全な確認結果です。"); expect(executeMock).toHaveBeenCalledTimes(1); });
  it("does not treat supplied pricing text transformation as a live pricing request", async () => { const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "この文章を200字以内に短くして。『新サービスは10月開始予定で、対象は既存会員です。詳細料金は来週確定します。』" }] }); expect(response.status).toBe(200); expect(response.body.content).toBe("安全な確認結果です。"); expect(executeMock).toHaveBeenCalledTimes(1); });
  it("lets the model reason about a hypothetical freshness failure without attempting live verification", async () => { const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "最新の為替レートを検索できない状態だと仮定します。1ドルが何円か断定せず、何が未確認かと安全な次の行動を示してください。" }] }); expect(response.status).toBe(200); expect(response.body.content).toBe("安全な確認結果です。"); expect(executeMock).toHaveBeenCalledTimes(1); });
  it("rejects invalid client policy before provider execution", async () => { const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "文章を確認してください" }], executionPolicy: { timeoutMs: 0 } }); expect(response.status).toBe(400); expect(response.body.code).toBe("INVALID_EXECUTION_POLICY"); expect(executeMock).not.toHaveBeenCalled(); });
});
