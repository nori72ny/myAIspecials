import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const { researchMock } = vi.hoisted(() => ({ researchMock: vi.fn() }));
vi.mock("./originResearchSource.js", () => ({ researchCurrentInformation: researchMock }));

import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginResearchRouter, type OriginResearchSynthesisExecutor } from "./originResearchRouter.js";

// Route-content test for personal context reflection (Personalization
// Stage 1, PR P1-4, design §6.3): the grounded research route must never
// receive personal context. Even if an `activeContext` field is present in
// the request body, nothing personal may reach the synthesis executor or
// the answer — grounded answers are built from sources only.

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

const PERSONAL_MARKER = "渡さない好みマーカー";

describe("originResearchRouter personal context exclusion (design §6.3)", () => {
  it("keeps personal context out of the synthesis request and the answer", async () => {
    researchMock.mockReset();
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

    const response = await request(app).post("/api/chat").send({
      messages: [{ role: "user", content: "iPhone の最新モデルの、日本での価格と発売日を教えてください" }],
      activeContext: `プロフィール:\n［好み］ ${PERSONAL_MARKER}（11月16日）`,
    });

    expect(response.status).toBe(200);
    expect(synthesis).toHaveBeenCalledTimes(1);
    // Nothing personal reaches the provider-bound synthesis request...
    expect(JSON.stringify(synthesis.mock.calls[0]?.[0] ?? {})).not.toContain(PERSONAL_MARKER);
    expect(JSON.stringify(synthesis.mock.calls[0]?.[0] ?? {})).not.toContain("untrusted_memory_boundary");
    // ...and nothing personal surfaces in the grounded answer either.
    expect(response.body.content).toContain("## 結論");
    expect(JSON.stringify(response.body)).not.toContain(PERSONAL_MARKER);
  });
});
