import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { researchMock } = vi.hoisted(() => ({ researchMock: vi.fn() }));
vi.mock("./originResearchSource.js", () => ({ researchCurrentInformation: researchMock }));

import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginResearchRouter, type OriginResearchSynthesisExecutor } from "./originResearchRouter.js";
import { OriginProviderError } from "./originProviderClient.js";
import type { GroundedResearchSynthesisProviderRetryExecutor } from "./originRecordsRetryRoute.js";
import { requiresOriginGroundedResearchRouted } from "./originChatResponsePolicy.js";
import type { OriginResearchResult } from "./originResearchSource.js";

const verifiedCatalogTime = Date.parse(DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0].verifiedAt) + 1;

const synthesisExecutionResult = {
  transportRequestCount: 1,
  actualCostUsd: 0 as const,
  providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
  routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
};

const iphoneSources = [
  { title: "iPhone 18 Pro 発表 - Apple Newsroom", url: "https://www.apple.com/jp/newsroom/iphone18", excerpt: "iPhone 18 Proは219,800円で、2026年9月18日に発売されます。", domain: "apple.com", rank: 1, sourceType: "web-search" as const, evidenceLevel: "page-verified" as const, retrievedAt: "2026-11-07T00:00:00.000Z", freshness: "recent" as const, revisionTimestamp: "2026-09-10T00:00:00.000Z" },
  { title: "iPhone価格まとめ", url: "https://example.jp/iphone", excerpt: "iPhone 18 Proの価格は219,800円と報じられています。", domain: "example.jp", rank: 2, sourceType: "web-search" as const, evidenceLevel: "snippet" as const, retrievedAt: "2026-11-07T00:00:00.000Z", freshness: "unknown" as const },
];

const iphoneQuery = "iPhone の最新モデルの、日本での価格と発売日を教えてください";

describe("originResearchRouter", () => {
  beforeEach(() => { researchMock.mockReset(); });

  it("routes explicit research requests and returns a report without claiming completed verification", async () => {
    researchMock.mockResolvedValue({ ok: true, sources: [{ title: "Evidence", url: "https://en.wikipedia.org/wiki/AI", excerpt: "Retrieved evidence.", evidenceLevel: "page-verified", freshness: "unknown", retrievedAt: "2026-09-10T00:00:00Z" }] });
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter());
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "AIの調査レポートを出典付きで作成して" }] });
    expect(response.status).toBe(200);
    expect(response.body.research.report.status).toBe("needs-review");
    expect(response.body.research.report.verification.citationIntegrity).toBe(true);
    expect(response.body.content).toContain("[S1](https://en.wikipedia.org/wiki/AI)");
    expect(researchMock).toHaveBeenCalledTimes(1);
  });

  it("returns live public-source evidence for explicit freshness requests", async () => {
    researchMock.mockResolvedValue({ ok: true, searchProvider: "DuckDuckGo", sources: [
      { title: "AI optimization", url: "https://example.com/ai", excerpt: "Retrieved public material.", domain: "example.com", rank: 1, sourceType: "web-search", evidenceLevel: "snippet", retrievedAt: "2026-09-08T00:00:00.000Z", freshness: "unknown" },
      { title: "AI overview", url: "https://example.org/ai", excerpt: "Independent public material.", domain: "example.org", rank: 2, sourceType: "web-search", evidenceLevel: "snippet", retrievedAt: "2026-09-08T00:00:00.000Z", freshness: "unknown" },
    ] });
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter());
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "AIOの最新情報を教えて" }] });
    expect(response.status).toBe(200);
    expect(response.body.routing).toMatchObject({ provider: "DuckDuckGo", cost: 0, actualCostUsd: 0, costEvidenceStatus: "NOT_MEASURED", freeOnly: true });
    expect(response.body.research.sources).toHaveLength(2);
    expect(response.body.research.comparison).toEqual({
      sourceCount: 2,
      distinctDomainCount: 2,
      encyclopediaReferenceCount: 0,
      publicWebCount: 2,
      officialSourceCount: null,
      officialStatus: "not-assessed",
      distinctSourceCount: 2,
      repeatedDomainSourceCount: 0,
      strongEvidenceCount: 0,
      moderateEvidenceCount: 0,
      limitedEvidenceCount: 2,
      confidenceLevel: "limited",
      confidenceScope: "retrieval-evidence-only",
      pageVerifiedCount: 0,
      snippetCount: 2,
      recentCount: 0,
      olderCount: 0,
      unknownFreshnessCount: 2,
      duplicateTextGroupCount: 0,
      semanticAgreement: "not-assessed",
      semanticConflict: "not-assessed",
    });
    expect(response.body.research.sourceAssessments).toEqual([
      { domain: "example.com", publisherKind: "public-web", officialStatus: "not-assessed", officialityBasis: "none", independenceBasis: "domain-only", domainOccurrenceCount: 1, independenceStatus: "domain-distinct", evidenceStrength: "limited", confidenceBasis: ["snippet", "unknown", "unique-domain"] },
      { domain: "example.org", publisherKind: "public-web", officialStatus: "not-assessed", officialityBasis: "none", independenceBasis: "domain-only", domainOccurrenceCount: 1, independenceStatus: "domain-distinct", evidenceStrength: "limited", confidenceBasis: ["snippet", "unknown", "unique-domain"] },
    ]);
    expect(response.body.content).toContain("公式情報源: 未判定");
    expect(response.body.content).toContain("意味上の一致・矛盾: 未判定");
    expect(response.body.content).toContain("Retrieved public material.");
    expect(response.body.content).toContain("https://example.com/ai");
    expect(response.body.content).toContain("https://example.org/ai");
  });

  it("counts exact normalized duplicate excerpts without inferring semantic agreement", async () => {
    researchMock.mockResolvedValue({ ok: true, searchProvider: "Test", sources: [
      { title: "Official", url: "https://official.example/item", excerpt: "Same FACT, confirmed.", domain: "official.example", sourceType: "encyclopedia", evidenceLevel: "page-verified", retrievedAt: "2026-09-08T00:00:00.000Z", freshness: "recent" },
      { title: "Independent", url: "https://independent.example/item", excerpt: " same fact confirmed ", domain: "independent.example", sourceType: "web-search", evidenceLevel: "snippet", retrievedAt: "2026-09-08T00:00:00.000Z", freshness: "unknown" },
    ] });
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter());
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "最新モデルを教えて" }] });
    expect(response.status).toBe(200);
    expect(response.body.research.comparison).toMatchObject({
      sourceCount: 2,
      distinctDomainCount: 2,
      encyclopediaReferenceCount: 1,
      publicWebCount: 1,
      officialSourceCount: null,
      officialStatus: "not-assessed",
      distinctSourceCount: 2,
      repeatedDomainSourceCount: 0,
      strongEvidenceCount: 1,
      moderateEvidenceCount: 0,
      limitedEvidenceCount: 1,
      confidenceLevel: "moderate",
      confidenceScope: "retrieval-evidence-only",
      pageVerifiedCount: 1,
      snippetCount: 1,
      recentCount: 1,
      unknownFreshnessCount: 1,
      duplicateTextGroupCount: 1,
      semanticAgreement: "not-assessed",
      semanticConflict: "not-assessed",
    });
    expect(response.body.research.sourceAssessments).toEqual([
      { domain: "official.example", publisherKind: "encyclopedia-reference", officialStatus: "not-assessed", officialityBasis: "none", independenceBasis: "domain-only", domainOccurrenceCount: 1, independenceStatus: "domain-distinct", evidenceStrength: "strong", confidenceBasis: ["page-verified", "recent", "unique-domain"] },
      { domain: "independent.example", publisherKind: "public-web", officialStatus: "not-assessed", officialityBasis: "none", independenceBasis: "domain-only", domainOccurrenceCount: 1, independenceStatus: "domain-distinct", evidenceStrength: "limited", confidenceBasis: ["snippet", "unknown", "unique-domain"] },
    ]);
    expect(response.body.content).toContain("媒体区分: 百科事典型の参考情報");
    expect(response.body.content).toContain("公式性: 未判定");
    expect(response.body.content).toContain("取得証拠の強さ: moderate");
  });

  it("marks repeated domains without overstating source independence", async () => {
    researchMock.mockResolvedValue({ ok: true, searchProvider: "Test", sources: [
      { title: "One", url: "https://same.example/one", excerpt: "First snippet.", domain: "same.example", sourceType: "web-search", evidenceLevel: "snippet", retrievedAt: "2026-09-09T00:00:00.000Z", freshness: "unknown" },
      { title: "Two", url: "https://same.example/two", excerpt: "Second snippet.", domain: "same.example", sourceType: "web-search", evidenceLevel: "snippet", retrievedAt: "2026-09-09T00:00:00.000Z", freshness: "unknown" },
    ] });
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter());
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "最新情報を教えて" }] });
    expect(response.status).toBe(200);
    expect(response.body.research.comparison).toMatchObject({
      distinctDomainCount: 1,
      distinctSourceCount: 0,
      repeatedDomainSourceCount: 2,
      confidenceLevel: "limited",
      confidenceScope: "retrieval-evidence-only",
    });
    expect(response.body.research.sourceAssessments).toEqual([
      expect.objectContaining({ domainOccurrenceCount: 2, independenceStatus: "same-domain", evidenceStrength: "limited" }),
      expect.objectContaining({ domainOccurrenceCount: 2, independenceStatus: "same-domain", evidenceStrength: "limited" }),
    ]);
    expect(response.body.content).toContain("同一ドメイン重複 2件");
    expect(response.body.content).toContain("内容の真偽や媒体の信頼性は未評価");
  });

  it("does not intercept stable definition requests", async () => {
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter());
    app.use((_req, res) => res.status(418).json({ passedThrough: true }));
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "AIOとは？" }] });
    expect(response.status).toBe(418);
    expect(researchMock).not.toHaveBeenCalled();
  });

  it("returns a dedicated unmeasured-cost failure instead of falling through to an unverified model answer", async () => {
    researchMock.mockResolvedValue({
      ok: false,
      sources: [],
      failure: { stage: "encyclopedia-search", code: "UPSTREAM_TIMEOUT" },
      fallback: { stage: "web-search", code: "UPSTREAM_HTTP_ERROR" },
      limitation: "internal upstream detail",
    });
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter());
    app.use((_req, res) => res.status(418).json({ passedThrough: true }));
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "AIの最新情報は？" }] });
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      code: "RESEARCH_SOURCE_UNAVAILABLE",
      retryable: true,
      retryAttempted: false,
      costEvidenceStatus: "NOT_MEASURED",
      costUsd: 0,
      freeOnly: true,
      paidFallbackUsed: false,
      research: {
        sources: [],
        status: "unavailable",
        failure: { stage: "encyclopedia-search", code: "UPSTREAM_TIMEOUT" },
        fallback: { stage: "web-search", code: "UPSTREAM_HTTP_ERROR" },
      },
    });
    expect(response.body.message).toContain("通常AIで補完せず");
    expect(JSON.stringify(response.body)).not.toContain("internal upstream detail");
    expect(researchMock).toHaveBeenCalledTimes(1);
  });

  it("does not block a freshness query over an assistant-turn address (S-1b: history is never sent externally)", async () => {
    researchMock.mockResolvedValue({ ok: true, sources: [{ title: "Evidence", url: "https://en.wikipedia.org/wiki/AI", excerpt: "Retrieved evidence.", evidenceLevel: "page-verified", freshness: "unknown", retrievedAt: "2026-09-10T00:00:00Z" }] });
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter());
    const response = await request(app).post("/api/chat").send({ messages: [
      { role: "user", content: "メールの下書きを作ってください" },
      { role: "assistant", content: "下書きです。連絡先は nori@sample.co.jp です。" },
      { role: "user", content: "AIの最新情報を教えて" },
    ] });
    expect(response.status).toBe(200);
    expect(researchMock).toHaveBeenCalledTimes(1);
  });

  it("still blocks a freshness query when a user turn in the history carries a secret (S-1b)", async () => {
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter());
    const response = await request(app).post("/api/chat").send({ messages: [
      { role: "user", content: "連絡先は nori@sample.co.jp です" },
      { role: "user", content: "AIの最新情報を教えて" },
    ] });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("SENSITIVE_INPUT_BLOCKED");
    expect(researchMock).not.toHaveBeenCalled();
  });

  it("blocks sensitive freshness queries before any external research call", async () => {
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter());
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "最新情報を調べて API key=super-secret-123" }] });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("SENSITIVE_INPUT_BLOCKED");
    expect(researchMock).not.toHaveBeenCalled();
  });

  it("keeps the extractive report and marks synthesis disabled when no synthesis executor is wired", async () => {
    researchMock.mockResolvedValue({ ok: true, searchProvider: "Tavily", sources: iphoneSources });
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter({ env: { OPENROUTER_API_KEY: "synthetic-test-key" } }));
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: iphoneQuery }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toContain("出典付き調査レポート（抽出方式）");
    expect(response.body.research.synthesis).toEqual({ status: "disabled" });
    expect(response.body.routing.synthesisStatus).toBe("disabled");
  });

  it("answers a freshness query with the citation-validated synthesis instead of the extractive dump", async () => {
    researchMock.mockResolvedValue({ ok: true, searchProvider: "Tavily", sources: iphoneSources });
    const synthesis = vi.fn().mockResolvedValue({
      ...synthesisExecutionResult,
      text: [
        "## 結論",
        "",
        "iPhone 18 Proは219,800円で、2026年9月18日に発売されます。[S1](https://www.apple.com/jp/newsroom/iphone18)",
        "価格は別の資料でも219,800円とされています。[S2](https://example.jp/iphone)",
        "",
        "出典",
        "- Apple Newsroom（apple.com、2026年9月10日公開）[S1](https://www.apple.com/jp/newsroom/iphone18)",
        "- example.jp（example.jp、公開日不明）[S2](https://example.jp/iphone)",
      ].join("\n"),
    });
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter({
      env: { OPENROUTER_API_KEY: "synthetic-test-key" },
      researchSynthesis: synthesis as unknown as OriginResearchSynthesisExecutor,
      catalogNow: () => verifiedCatalogTime,
    }));
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: iphoneQuery }] });
    expect(response.status).toBe(200);
    expect(synthesis).toHaveBeenCalledTimes(1);
    expect(response.body.content).toContain("## 結論");
    expect(response.body.content).not.toContain("出典付き調査レポート（抽出方式）");
    expect(response.body.routing.synthesisStatus).toBe("citation-validated");
    expect(response.body.routing.answerMode).toBe("research");
    expect(response.body.research.synthesis).toEqual({ status: "citation-validated", sourceCount: 2, payloadChars: 3299 });
    // The extractive report stays available as metadata, not as the answer.
    expect(response.body.research.report.mode).toBe("extractive");
  });

  it("degrades safely to the extractive report when synthesis fails citation validation", async () => {
    researchMock.mockResolvedValue({ ok: true, searchProvider: "Tavily", sources: iphoneSources });
    const synthesis = vi.fn().mockResolvedValue({
      ...synthesisExecutionResult,
      text: "iPhone 18 Proは99,800円です。[S9](https://fake.example/x)",
    });
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter({
      env: { OPENROUTER_API_KEY: "synthetic-test-key" },
      researchSynthesis: synthesis as unknown as OriginResearchSynthesisExecutor,
      catalogNow: () => verifiedCatalogTime,
    }));
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: iphoneQuery }] });
    expect(response.status).toBe(200);
    // 初回＋フィードバック付き再試行1回（再試行も検証で落ち、失敗コードは初回のまま）
    expect(synthesis).toHaveBeenCalledTimes(2);
    expect(response.body.content).toContain("出典付き調査レポート（抽出方式）");
    expect(response.body.content).not.toContain("99,800円です");
    expect(response.body.research.synthesis).toEqual({ status: "citation-validation-failed", failureCode: "UNKNOWN_CITATION", payloadChars: 3299 });
  });

  it("degrades safely to the extractive report when the synthesis provider fails", async () => {
    researchMock.mockResolvedValue({ ok: true, searchProvider: "Tavily", sources: iphoneSources });
    const synthesis = vi.fn().mockRejectedValue(new Error("provider down"));
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter({
      env: { OPENROUTER_API_KEY: "synthetic-test-key" },
      researchSynthesis: synthesis as unknown as OriginResearchSynthesisExecutor,
      catalogNow: () => verifiedCatalogTime,
    }));
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: iphoneQuery }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toContain("出典付き調査レポート（抽出方式）");
    expect(response.body.research.synthesis.status).toBe("provider-failed");
  });

  it("adopts the synthesis when the provider-failure retry succeeds on another route (round-5 measure 5-2b)", async () => {
    researchMock.mockResolvedValue({ ok: true, searchProvider: "Tavily", sources: iphoneSources });
    // Before round 5 this router had no provider retry at all: the
    // initial throw went straight to the extractive landing.
    const synthesis = vi.fn().mockRejectedValue(
      new OriginProviderError("PROVIDER_RATE_LIMITED", "internal", 429, true),
    );
    const providerRetry = vi.fn().mockResolvedValue({
      kind: "executed",
      route: 2,
      result: {
        ...synthesisExecutionResult,
        text: [
          "## 結論",
          "",
          "iPhone 18 Proは219,800円で、2026年9月18日に発売されます。[S1](https://www.apple.com/jp/newsroom/iphone18)",
          "価格は別の資料でも219,800円とされています。[S2](https://example.jp/iphone)",
          "",
          "出典",
          "- Apple Newsroom（apple.com、2026年9月10日公開）[S1](https://www.apple.com/jp/newsroom/iphone18)",
          "- example.jp（example.jp、公開日不明）[S2](https://example.jp/iphone)",
        ].join("\n"),
      },
    });
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter({
      env: { OPENROUTER_API_KEY: "synthetic-test-key" },
      researchSynthesis: synthesis as unknown as OriginResearchSynthesisExecutor,
      researchSynthesisProviderRetry: providerRetry as unknown as GroundedResearchSynthesisProviderRetryExecutor,
      catalogNow: () => verifiedCatalogTime,
    }));
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: iphoneQuery }] });
    expect(response.status).toBe(200);
    expect(synthesis).toHaveBeenCalledTimes(1);
    expect(providerRetry).toHaveBeenCalledTimes(1);
    expect(response.body.content).toContain("## 結論");
    expect(response.body.routing.synthesisStatus).toBe("citation-validated");
    expect(response.body.routing.synthesisProviderRetried).toBe(true);
    expect(response.body.routing.synthesisProviderRetryRoute).toBe(2);
    expect(response.body.research.synthesis).toEqual({
      status: "citation-validated",
      sourceCount: 2,
      payloadChars: 3299,
      providerRetried: true,
      providerRetryRoute: 2,
      // Round-6 measure 6-1a: the successful retry joins the attempt
      // record (the bare result's routing evidence plus the measured
      // duration — 0 under this suite's fixed clock). The initial
      // error carried no diagnostic, so it contributes no entry.
      attempts: [{
        providerId: "cloudflare-workers-ai-free",
        modelId: "google/gemma-4-31b-it:free",
        outcome: "succeeded",
        transportRequestCount: 1,
        durationMs: 0,
      }],
    });
  });

  it("records every tried route in research.synthesis when the provider retry also fails (round-5 measures 5-2a/5-2b)", async () => {
    researchMock.mockResolvedValue({ ok: true, searchProvider: "Tavily", sources: iphoneSources });
    const initialError = new OriginProviderError("PROVIDER_RATE_LIMITED", "internal", 429, true, undefined, {
      failoverAttempts: [{
        providerId: "cloudflare-workers-ai-free",
        modelId: "@cf/google/gemma-4-26b-a4b-it",
        outcome: "availability-error",
        errorCode: "PROVIDER_RATE_LIMITED",
        transportRequestCount: 1,
      }],
    });
    const synthesis = vi.fn().mockRejectedValue(initialError);
    const providerRetry = vi.fn().mockResolvedValue({
      kind: "failed",
      route: 3,
      errorCode: "PROVIDER_UNAVAILABLE",
    });
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter({
      env: { OPENROUTER_API_KEY: "synthetic-test-key" },
      researchSynthesis: synthesis as unknown as OriginResearchSynthesisExecutor,
      researchSynthesisProviderRetry: providerRetry as unknown as GroundedResearchSynthesisProviderRetryExecutor,
      catalogNow: () => verifiedCatalogTime,
    }));
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: iphoneQuery }] });
    expect(response.status).toBe(200);
    // The landing is unchanged: the extractive report.
    expect(response.body.content).toContain("出典付き調査レポート（抽出方式）");
    expect(response.body.research.synthesis.status).toBe("provider-failed");
    expect(response.body.research.synthesis.providerRetryFailed).toBe(true);
    expect(response.body.research.synthesis.attempts).toEqual([
      {
        providerId: "cloudflare-workers-ai-free",
        modelId: "@cf/google/gemma-4-26b-a4b-it",
        outcome: "availability-error",
        errorCode: "PROVIDER_RATE_LIMITED",
        transportRequestCount: 1,
      },
      {
        providerId: "groq-free",
        modelId: "openai/gpt-oss-120b",
        outcome: "failed",
        errorCode: "PROVIDER_UNAVAILABLE",
      },
    ]);
  });
});

// CB-1 passthrough (CODE_TASK_PREDICATE_PROD_GAP_DIAGNOSIS_2026-11-23 案1):
// this router's freshness scan runs over the raw text — fenced code
// included — so the three codebench prompts below (verbatim task texts)
// were intercepted here on the strength of `price` / `prices` inside the
// pasted code and never reached the chat routers' policy layer. With
// ORIGIN_CODE_TASK_ROUTING_MODE not off, a request the shared predicate
// accepts must be handed down instead; with the mode off, interception
// is byte-identical to the historical behaviour.
describe("originResearchRouter CB-1 code-task passthrough", () => {
  const evidenceResult: OriginResearchResult = {
    ok: true,
    sources: [{ title: "Evidence", url: "https://en.wikipedia.org/wiki/AI", excerpt: "Retrieved evidence.", evidenceLevel: "page-verified", freshness: "unknown", retrievedAt: "2026-09-10T00:00:00Z" }],
  };

  const c05Prompt = [
    "次のPythonコードを、動作を変えずにリファクタリングしてください。検証・金額計算・文字列整形をそれぞれ別の関数に分け、process_order はそれらを組み合わせるだけにしてください。返り値の文字列の形式は変えないでください。修正後のコード全体をコードブロックで返してください。変更のポイントも簡潔に説明してください。",
    "",
    "```python",
    "def process_order(order):",
    "    if not order.get('items'):",
    "        return 'error: no items'",
    "    total = 0",
    "    for item in order['items']:",
    "        total += item['price'] * item['qty']",
    "    tax = total * 0.1",
    "    total_with_tax = total + tax",
    "    name = order.get('customer', 'unknown')",
    "    return f\"{name}: total={total_with_tax:.0f} yen (tax {tax:.0f} yen)\"",
    "```",
  ].join("\n");

  const e05Prompt = [
    "次のPythonコードをレビューしてください。性能上の問題点があれば、理由と、結果が同じになる改善コードを示してください。",
    "",
    "```python",
    "def order_totals(db):",
    "    orders = db.execute('SELECT id FROM orders').fetchall()",
    "    result = []",
    "    for (order_id,) in orders:",
    "        rows = db.execute('SELECT price, qty FROM items WHERE order_id = ?', (order_id,)).fetchall()",
    "        result.append((order_id, sum(p * q for p, q in rows)))",
    "    return result",
    "```",
  ].join("\n");

  const b01Prompt = [
    "次のPythonコードにはバグがあります。バグを特定し、修正したコード全体をコードブロックで返してください。何がバグだったかの説明も簡潔に付けてください。なお、空のリストの平均は 0 を返す仕様にしてください。",
    "",
    "```python",
    "def add_price(price, prices=[]):",
    "    prices.append(price)",
    "    return prices",
    "",
    "def average_price(prices):",
    "    return sum(prices) / len(prices)",
    "```",
  ].join("\n");

  const codeTaskPrompts: Array<[string, string]> = [
    ["C-05", c05Prompt],
    ["E-05", e05Prompt],
    ["B-01", b01Prompt],
  ];

  function buildApp(env: NodeJS.ProcessEnv, research: (query: string) => Promise<OriginResearchResult>) {
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter({ env, research }));
    // Stand-in for the chat routers mounted after this router.
    app.use((_req, res) => { res.status(200).json({ downstream: true }); });
    return app;
  }

  it.each(codeTaskPrompts)("hands %s down to the chat routers in shadow mode", async (_id, prompt) => {
    const research = vi.fn(async (_query: string): Promise<OriginResearchResult> => evidenceResult);
    const app = buildApp({ ORIGIN_CODE_TASK_ROUTING_MODE: "shadow" }, research);
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: prompt }] });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ downstream: true });
    expect(research).not.toHaveBeenCalled();
  });

  it.each(codeTaskPrompts)("hands %s down to the chat routers in enforce mode", async (_id, prompt) => {
    const research = vi.fn(async (_query: string): Promise<OriginResearchResult> => evidenceResult);
    const app = buildApp({ ORIGIN_CODE_TASK_ROUTING_MODE: "enforce" }, research);
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: prompt }] });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ downstream: true });
    expect(research).not.toHaveBeenCalled();
  });

  it.each(codeTaskPrompts)("still intercepts %s with the mode off (kill switch)", async (_id, prompt) => {
    const research = vi.fn(async (_query: string): Promise<OriginResearchResult> => evidenceResult);
    const app = buildApp({ ORIGIN_CODE_TASK_ROUTING_MODE: "off" }, research);
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: prompt }] });
    expect(response.status).toBe(200);
    expect(response.body.downstream).toBeUndefined();
    expect(research).toHaveBeenCalledTimes(1);
  });

  it("still intercepts C-05 when the mode variable is unset (default off)", async () => {
    const research = vi.fn(async (_query: string): Promise<OriginResearchResult> => evidenceResult);
    const app = buildApp({}, research);
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: c05Prompt }] });
    expect(response.status).toBe(200);
    expect(response.body.downstream).toBeUndefined();
    expect(research).toHaveBeenCalledTimes(1);
  });

  it("still intercepts a genuine freshness request with a code block in shadow mode (prose does not refer to the code)", async () => {
    const research = vi.fn(async (_query: string): Promise<OriginResearchResult> => evidenceResult);
    const app = buildApp({ ORIGIN_CODE_TASK_ROUTING_MODE: "shadow" }, research);
    const prompt = [
      "最新の料金を調べてください。",
      "",
      "```python",
      "def total(price, qty):",
      "    return price * qty",
      "```",
    ].join("\n");
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: prompt }] });
    expect(response.status).toBe(200);
    expect(response.body.downstream).toBeUndefined();
    expect(research).toHaveBeenCalledTimes(1);
  });

  it("still intercepts a code task whose prose asks for the latest information in enforce mode", async () => {
    const research = vi.fn(async (_query: string): Promise<OriginResearchResult> => evidenceResult);
    const app = buildApp({ ORIGIN_CODE_TASK_ROUTING_MODE: "enforce" }, research);
    const prompt = [
      "このコードを、最新の料金体系に合わせて修正してください。",
      "",
      "```python",
      "def total(price, qty):",
      "    return price * qty",
      "```",
    ].join("\n");
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: prompt }] });
    expect(response.status).toBe(200);
    expect(response.body.downstream).toBeUndefined();
    expect(research).toHaveBeenCalledTimes(1);
  });

  it("still intercepts an explicit research request with a code block in enforce mode", async () => {
    const research = vi.fn(async (_query: string): Promise<OriginResearchResult> => evidenceResult);
    const app = buildApp({ ORIGIN_CODE_TASK_ROUTING_MODE: "enforce" }, research);
    const prompt = [
      "次のコードについて、調査レポートを出典付きで作成してください。",
      "",
      "```python",
      "def total(price, qty):",
      "    return price * qty",
      "```",
    ].join("\n");
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: prompt }] });
    expect(response.status).toBe(200);
    expect(response.body.downstream).toBeUndefined();
    expect(research).toHaveBeenCalledTimes(1);
  });

  it.each(codeTaskPrompts)("the handed-down %s request is evaluated by the chat-side routed determination in shadow mode", async (_id, prompt) => {
    const research = vi.fn(async (_query: string): Promise<OriginResearchResult> => evidenceResult);
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter({ env: { ORIGIN_CODE_TASK_ROUTING_MODE: "shadow" }, research }));
    // Stand-in for the chat routers: runs the same routed determination
    // they run and returns the captured shadow fields.
    app.post("/api/chat", (req, res) => {
      const logs: Array<Record<string, unknown>> = [];
      const content = (req.body as { messages: Array<{ content: string }> }).messages.at(-1)!.content;
      requiresOriginGroundedResearchRouted(content, {
        env: { ORIGIN_CODE_TASK_ROUTING_MODE: "shadow" },
        logger: (_message, fields) => { logs.push(fields); },
      });
      res.status(200).json({ downstream: true, logs });
    });
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: prompt }] });
    expect(response.status).toBe(200);
    expect(response.body.downstream).toBe(true);
    expect(research).not.toHaveBeenCalled();
    expect(response.body.logs).toHaveLength(1);
    expect(response.body.logs[0].codeTaskRequestMatched).toBe(true);
  });

  it("shadow evaluation of the handed-down requests reports the expected exemption outcomes", async () => {
    const research = vi.fn(async (_query: string): Promise<OriginResearchResult> => evidenceResult);
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter({ env: { ORIGIN_CODE_TASK_ROUTING_MODE: "shadow" }, research }));
    app.post("/api/chat", (req, res) => {
      const logs: Array<Record<string, unknown>> = [];
      const content = (req.body as { messages: Array<{ content: string }> }).messages.at(-1)!.content;
      requiresOriginGroundedResearchRouted(content, {
        env: { ORIGIN_CODE_TASK_ROUTING_MODE: "shadow" },
        logger: (_message, fields) => { logs.push(fields); },
      });
      res.status(200).json({ downstream: true, logs });
    });
    const expectations: Array<[string, boolean]> = [
      [c05Prompt, true],
      [e05Prompt, true],
      [b01Prompt, false],
    ];
    for (const [prompt, wouldExempt] of expectations) {
      const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: prompt }] });
      expect(response.status).toBe(200);
      expect(response.body.logs).toHaveLength(1);
      expect(response.body.logs[0]).toMatchObject({ codeTaskRequestMatched: true, codeTaskWouldExempt: wouldExempt });
    }
    expect(research).not.toHaveBeenCalled();
  });
});
