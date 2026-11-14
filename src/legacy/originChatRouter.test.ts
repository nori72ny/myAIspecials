import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OriginContextPolicy } from "../lib/orchestration/OriginContextPolicy";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";
import { originGroqRouteSystemInstruction } from "./originChatResponsePolicy";
import { OriginProviderError } from "./originProviderClient";

const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;
const defaultExecutionResult = {
  text: "安全な確認結果です。",
  transportRequestCount: 1,
  actualCostUsd: 0 as const,
  providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
  routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
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

  it("answers supplied price arithmetic without requiring public-source retrieval", async () => {
    const researchMock = vi.fn();
    executeMock.mockResolvedValueOnce({ ...defaultExecutionResult, text: "元の価格に戻ります。1000 × 0.8 × 1.25 = 1000円です。" });
    const response = await request(createApp(execute, undefined, undefined, undefined, researchMock))
      .post("/api/chat").send({ messages: [{ role: "user", content: "商品を20%値引きした後、値引き後の価格を25%値上げしました。元の価格を1000円として計算してください。" }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toContain("1000 × 0.8 × 1.25");
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(researchMock).not.toHaveBeenCalled();
    expect(response.body.routing.answerMode).not.toBe("research");
  });

  it("rejects invalid messages before provider execution", async () => { const response = await request(createApp(execute)).post("/api/chat").send({}); expect(response.status).toBe(400); expect(response.body.code).toBe("INVALID_CHAT_MESSAGES"); expect(executeMock).not.toHaveBeenCalled(); });

  it("carries the compact route-3 instruction on the dispatch request without shrinking the standard instruction", async () => {
    const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "認証処理をレビューしてください" }] });
    expect(response.status).toBe(200);
    expect(executeMock).toHaveBeenCalledTimes(1);
    const call = executeMock.mock.calls[0]?.[0];
    // Route-3 activation wiring: the Groq executor receives the compact substitute
    // via this field; routes 1 and 2 keep the full standard instruction.
    expect(call?.groqSystemInstruction).toBe(originGroqRouteSystemInstruction());
    expect(call?.groqSystemInstruction?.length).toBeLessThanOrEqual(3_000);
    expect(call?.systemInstruction.length).toBeGreaterThan(9_000);
    expect(call?.systemInstruction).not.toBe(call?.groqSystemInstruction);
  });
  it("blocks synthetic secrets before provider execution", async () => { const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "Authorization: Bearer synthetic_token_value_123456" }] }); expect(response.status).toBe(422); expect(response.body.code).toBe("SENSITIVE_INPUT_BLOCKED"); expect(JSON.stringify(response.body)).not.toContain("synthetic_token_value_123456"); expect(executeMock).not.toHaveBeenCalled(); });
  it("returns a validated zero-cost routing envelope", async () => { const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "認証処理をレビューしてください" }] }); expect(response.status).toBe(200); expect(response.body.content).toBe("安全な確認結果です。"); expect(response.body.routing).toEqual(expect.objectContaining({ model: "ORIGIN 無料AI", providerId: "openrouter-free", modelId: "google/gemma-4-31b-it:free", cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, costEvidenceStatus: "NOT_MEASURED", freeOnly: true, traceId: "origin-test-trace", verificationStatus: "not-run", reviewRequired: true, providerAttempts: 1, providerTransportRequests: 1, providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true }, providerRouting: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary", provider: "OpenRouter", attempt: 1, fallbackUsed: false }, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 } })); expect(executeMock).toHaveBeenCalledTimes(1); const call = executeMock.mock.calls[0]?.[0]; expect(call?.systemInstruction).toContain("For routine explanatory or comparison answers"); expect(call?.systemInstruction).toContain("For complex multi-part requests, use as many distinct points as needed"); expect(call?.systemInstruction).toContain("ask at most one or two focused questions after the Version 1 draft"); expect(call?.systemInstruction).toContain("Use follow-up answers to improve the existing draft"); expect(call?.systemInstruction).toContain("Treat explicit output-shape constraints as hard requirements"); expect(call?.systemInstruction).toContain("JSON only, code only, no Markdown, exactly N items"); });
  it("marks low-risk writing as not requiring independent review", async () => { const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "短い案内文を読みやすく整えてください" }] }); expect(response.status).toBe(200); expect(response.body.answer.verification).toEqual({ status: "not-required", independentReviewPerformed: false, summary: "この依頼では、追加の独立確認を必須と判定していません。" }); expect(response.body.answer.limitations).toEqual([]); expect(response.body.answer.nextActions).toEqual([]); });
  it("delivers a truncated partial answer with the incompleteness stated instead of an error (PKG-2)", async () => {
    executeMock.mockResolvedValueOnce({ ...defaultExecutionResult, text: "長い回答の途中までです。", truncated: true });
    const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "短い案内文を読みやすく整えてください" }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe("長い回答の途中までです。");
    expect(response.body.routing.answerTruncated).toBe(true);
    expect(response.body.answer.limitations).toContain("この回答は長さの上限に達したため、途中で終わっています（未完です）。続きが必要な場合は「続き」と送ってください。");
    expect(response.body.answer.nextActions).toContain("「続き」と送ると、この回答の続きを依頼できます。");
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
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
  // S-PR-1 note: this test pins context windowing only. Its final message
  // used to be 「最新の依頼」, which under the unified needs-freshness
  // determination now routes to grounded research (fresh_general fails
  // toward search) and never reaches the provider — so the window fixture
  // uses a freshness-neutral final message with the same shape.
  it("sends only the latest coherent context window", async () => { const response = await request(createApp(execute, undefined, undefined, { version: 1, maxMessages: 3, maxCharacters: 12_000 })).post("/api/chat").send({ messages: [{ role: "ai", content: "初期案内" }, { role: "user", content: "古い依頼" }, { role: "ai", content: "古い回答" }, { role: "user", content: "直近の依頼" }, { role: "ai", content: "直近の回答" }, { role: "user", content: "新しい依頼" }] }); expect(response.status).toBe(200); const call = executeMock.mock.calls[0]?.[0]; expect(call?.messages).toEqual([{ role: "user", content: "直近の依頼" }, { role: "ai", content: "直近の回答" }, { role: "user", content: "新しい依頼" }]); });
  it("keeps creation intent and task-specific clarification guidance after a short option reply", async () => {
    const response = await request(createApp(execute)).post("/api/chat").send({
      messages: [
        { role: "user", content: "ウェブアプリで売上を管理できるようにしてください" },
        { role: "ai", content: "簡易版と複数人利用版のどちらにしますか？ 1. 簡易版 2. 複数人利用版" },
        { role: "user", content: "1" },
      ],
    });
    expect(response.status).toBe(200);
    const call = executeMock.mock.calls[0]?.[0];
    expect(call?.messages).toHaveLength(3);
    expect(call?.systemInstruction).toContain("Requirement clarification mode (adaptive");
    expect(call?.systemInstruction).toContain("user-workflows");
    expect(call?.systemInstruction).toContain("platform-device");
    expect(call?.systemInstruction).toContain("storage-sharing");
    expect(call?.systemInstruction).toContain("Never ask the same requirement twice");
  });
  it("sanitizes non-retryable authentication failures", async () => { executeMock.mockRejectedValueOnce(new OriginProviderError("PROVIDER_NOT_CONFIGURED", "内部詳細", 401, false, undefined, { upstreamStatus: 401 })); const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "文章を作ってください" }] }); expect(response.status).toBe(401); expect(JSON.stringify(response.body)).not.toContain("内部詳細"); expect(executeMock).toHaveBeenCalledTimes(1); });
  it("surfaces a sanitized per-route failure diagnostic in the response body and as a flat JSON log string", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const attempts = [
        { providerId: "openrouter-free", modelId: "google/gemma-4-31b-it:free", outcome: "availability-error" as const, errorCode: "PROVIDER_RATE_LIMITED" as const, upstreamStatus: 429, upstreamErrorType: "rate_limit_exceeded", transportRequestCount: 1 },
        { providerId: "cloudflare-workers-ai-free", modelId: "@cf/google/gemma-4-26b-a4b-it", outcome: "availability-error" as const, errorCode: "PROVIDER_RATE_LIMITED" as const, upstreamStatus: 429, upstreamErrorCode: "10023", transportRequestCount: 4 },
        { providerId: "groq-free", modelId: "openai/gpt-oss-120b", outcome: "skipped" as const, skipReason: "token-budget-exceeded", transportRequestCount: 0 },
      ];
      executeMock.mockRejectedValueOnce(new OriginProviderError("PROVIDER_RATE_LIMITED", "内部詳細", 429, false, 120, { upstreamStatus: 429, transportRequestCount: 4, failoverAttempts: attempts }));
      const response = await request(createApp(execute)).post("/api/chat").send({ messages: [{ role: "user", content: "文章を作ってください" }] });
      expect(response.status).toBe(429);
      expect(response.body).toMatchObject({ code: "PROVIDER_RATE_LIMITED", retryAttempted: false, providerTransportRequests: 4 });
      expect(response.body.diagnostic).toEqual({ upstreamStatus: 429, transportRequestCount: 4, failoverAttempts: attempts });
      expect(JSON.stringify(response.body)).not.toContain("内部詳細");
      const failureLog = warn.mock.calls.find((call) => String(call[0]).includes("provider request failed"));
      expect(failureLog).toBeDefined();
      const loggedDiagnostic = (failureLog?.[1] as { diagnostic?: unknown } | undefined)?.diagnostic;
      expect(typeof loggedDiagnostic).toBe("string");
      const parsed = JSON.parse(String(loggedDiagnostic)) as { failoverAttempts: unknown[] };
      expect(parsed.failoverAttempts).toHaveLength(3);
      expect(String(loggedDiagnostic)).not.toContain("[Object]");
    } finally {
      warn.mockRestore();
    }
  });
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
    expect(response.body.content).toContain("確認できた範囲と出典の一覧をお伝えします");
    expect(response.body.content).toContain("https://example.com/current");
    expect(response.body.content).not.toContain("現在確認できた公開情報の要点です。");
    expect(response.body.content).not.toContain("## 確認できた公開情報");
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

  it("carries comparison and proposal output intent into the grounded synthesis stage", async () => {
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
      "## 比較と提案",
      "",
      "取得できた資料では100円と120円の差があります。[S1](https://example.com/one) [S2](https://example.org/two)",
    ].join("\n");
    const synthesisMock = vi.fn().mockResolvedValue({ ...defaultExecutionResult, text: synthesisText }) as unknown as OriginChatExecutor;

    const response = await request(createApp(
      execute,
      { OPENROUTER_API_KEY: "synthetic-test-key" },
      undefined,
      undefined,
      researchMock,
      synthesisMock,
    )).post("/api/chat").send({
      messages: [{ role: "user", content: "現在の料金を比較調査して、比較表と提案書にまとめてください" }],
    });

    expect(response.status).toBe(200);
    expect(response.body.routing).toEqual(expect.objectContaining({
      requestedOutputs: ["proposal", "comparison"],
      supervisorMode: "origin.supervisor.v2",
      supervisorStatus: "not-required",
      generatedOutputs: [],
      pendingOutputs: [],
      downstreamDeliverablePending: false,
    }));
    const synthesisRequest = (synthesisMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(synthesisRequest.systemInstruction).toContain("提案書として読める提案本文");
    expect(synthesisRequest.systemInstruction).toContain("比較表・比較整理");
    expect(synthesisRequest.messages[0].content).toContain("要求された成果形の契約");
  });

  it("runs the Supervisor through research synthesis into a verified PowerPoint artifact", async () => {
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
    const synthesisText = "スライド原稿の要点は100円と120円の比較です。[S1](https://example.com/one) [S2](https://example.org/two)";
    const synthesisMock = vi.fn().mockResolvedValue({ ...defaultExecutionResult, text: synthesisText }) as unknown as OriginChatExecutor;

    const response = await request(createApp(
      execute,
      { OPENROUTER_API_KEY: "synthetic-test-key" },
      undefined,
      undefined,
      researchMock,
      synthesisMock,
    )).post("/api/chat").send({
      messages: [{ role: "user", content: "現在の料金を調査してPowerPointにまとめてください" }],
    });

    expect(response.status).toBe(200);
    expect(response.body.routing).toEqual(expect.objectContaining({
      requestedOutputs: ["presentation"],
      supervisorMode: "origin.supervisor.v2",
      supervisorStatus: "completed",
      generatedOutputs: ["presentation"],
      pendingOutputs: [],
      downstreamDeliverablePending: false,
    }));
    expect(response.body.answer.richOutputs).toEqual([
      expect.objectContaining({
        kind: "presentation",
        artifactId: expect.stringMatching(/^artifact-pptx-/),
      }),
    ]);
    expect(response.body.supervisor).toEqual(expect.objectContaining({
      version: "origin.supervisor.v2",
      status: "completed",
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
      automaticProviderRetries: 0,
      steps: [
        expect.objectContaining({ id: "research", status: "completed", evidenceCount: 2 }),
        expect.objectContaining({ id: "synthesis", status: "completed", citationValidated: true, providerAttempts: 1 }),
        expect.objectContaining({ id: "artifact", status: "completed", artifactCount: 1, completedOutputs: ["presentation"], pendingOutputs: [] }),
      ],
    }));
    expect(response.body.artifacts).toHaveLength(1);
    expect(response.body.artifacts[0]).toEqual(expect.objectContaining({
      artifactType: "pptx",
      verified: true,
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
      encoding: "base64",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(Buffer.from(response.body.artifacts[0].data, "base64").includes(Buffer.from("ppt/presentation.xml"))).toBe(true);
    const synthesisRequest = (synthesisMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(synthesisRequest.systemInstruction).toContain("スライド/PPTX");
    expect(synthesisRequest.systemInstruction).toContain("## 見出し");
    expect(synthesisRequest.systemInstruction).toContain("実ファイルを生成済みとは表現しない");
  });

  it("discards synthesized text when citation validation fails and falls back to the source list", async () => {
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
    expect(response.body.content).toContain("確認できた範囲と出典の一覧をお伝えします");
    expect(response.body.content).toContain("https://example.com/one");
    expect(response.body.content).toContain("https://example.org/two");
    expect(response.body.content).not.toContain("公開情報その1です。");
    expect(response.body.content).not.toContain("公開情報その2です。");
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

  it("fails the synthesis stage closed after one provider failure and keeps only the retrieved source list", async () => {
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
    expect(response.body.content).toContain("確認できた範囲と出典の一覧をお伝えします");
    expect(response.body.content).toContain("https://example.com/current");
    expect(response.body.content).not.toContain("現在確認できた公開情報です。");
    expect(response.body.routing).toEqual(expect.objectContaining({
      synthesisStatus: "provider-failed",
      synthesisFailureCode: "PROVIDER_RATE_LIMITED",
      freeOnly: true,
      cost: 0,
    }));
    expect(response.body.supervisor).toEqual(expect.objectContaining({
      version: "origin.supervisor.v2",
      status: "not-required",
      automaticProviderRetries: 0,
      steps: [
        expect.objectContaining({ id: "research", status: "completed", evidenceCount: 1 }),
        expect.objectContaining({ id: "synthesis", status: "blocked", failureCode: "PROVIDER_RATE_LIMITED", providerAttempts: 1 }),
        expect.objectContaining({ id: "artifact", status: "not-required", artifactCount: 0 }),
      ],
    }));
    expect(synthesisMock).toHaveBeenCalledTimes(1);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("never pastes a raw extracted page into the answer when synthesis fails (PKG-9 search-dump regression)", async () => {
    // Mirrors the production defect (chat 100-question inspection batch 1,
    // A-02 / B-01 / B-05): for number-critical question types the grounding
    // layer replaces the snippet with a full extracted page, navigation and
    // advertising text included. When synthesis then fails, the fallback
    // answer must list compact citations only — the extracted page text,
    // boilerplate included, must not leak into the answer body.
    const rawPageText = "サービス紹介 資料ダウンロード お問い合わせ 退職の基礎知識を確認したい人事担当者も、ぜひ最後までチェックしてみてください。退職の予告は民法により、原則として2週間前の申し出で退職が可能です。資料を無料ダウンロード";
    const researchMock = vi.fn().mockResolvedValue({
      ok: true,
      searchProvider: "Tavily",
      sources: [{
        title: "法律で退職は何日前までに伝えられるべき？",
        url: "https://example.com/retirement-law",
        excerpt: rawPageText,
        sourceType: "web-search",
        domain: "example.com",
        rank: 1,
        evidenceLevel: "extracted",
        retrievedAt: "2026-09-24T06:00:00.000Z",
        freshness: "recent",
      }],
    }) as unknown as OriginResearchExecutor;
    const synthesisMock = vi.fn().mockRejectedValue(
      new OriginProviderError("PROVIDER_TIMEOUT", "internal", 504, true),
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
    expect(response.body.routing.synthesisStatus).toBe("provider-failed");
    // No fragment of the extracted page — fact sentence or boilerplate — is
    // presented as the answer.
    expect(response.body.content).not.toContain("退職の予告は民法により");
    expect(response.body.content).not.toContain("お問い合わせ");
    expect(response.body.content).not.toContain("無料ダウンロード");
    expect(response.body.content).not.toContain("## 確認できた公開情報");
    // The fallback states its own limit first, shows the confirmed scope
    // as a title-only attribution, and cites the source compactly (title,
    // domain, URL). The internal cross-check section (照合メモ) never
    // appears in the user-facing body (synthesis-hygiene).
    expect(response.body.content).toContain("要約した回答を作成できなかったため、確認できた範囲と出典の一覧をお伝えします");
    expect(response.body.content).not.toContain("照合メモ");
    expect(response.body.content).toContain("## 確認できた範囲");
    expect(response.body.content).toContain("では『法律で退職は何日前までに伝えられるべき?』と示されています");
    expect(response.body.content).toContain("法律で退職は何日前までに伝えられるべき？");
    expect(response.body.content).toContain("example.com");
    expect(response.body.content).toContain("https://example.com/retirement-law");
    expect(response.body.answer.conclusion).toContain("要約した回答を作成できなかった");
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
    expect(response.body.content).toContain("確認できた範囲と出典の一覧をお伝えします");
    expect(response.body.content).toContain("https://example.com/current");
    expect(response.body.content).not.toContain("現在確認できた公開情報です。");
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
