import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { researchMock } = vi.hoisted(() => ({ researchMock: vi.fn() }));
vi.mock("./originResearchSource.js", () => ({ researchCurrentInformation: researchMock }));

import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { buildGroundedResearchPartialAnswer } from "../research/groundedResearchV11";
import { RECORDS_PACKET_EXCERPT_CHARS } from "../research/groundedResearchRecordsV13";
import {
  buildResearchRecordsValidationFailureAnswer,
  createOriginResearchRouter,
  RESEARCH_RECORDS_FAILURE_MAX_CONTENT_CHARS,
  type OriginResearchSynthesisExecutor,
} from "./originResearchRouter.js";
import type { OriginResearchSource } from "./originResearchSource";

// R-PR-9a (RPR9_DESIGN_2026-11-15 §2 R9-A): on the research router, a
// records-validation failure (reachable only with the
// ORIGIN_SYNTHESIS_RECORDS_ENABLED kill switch ON) returns the
// deterministic partial answer — the same shape the chat router
// falls back to — instead of the extractive dump (report markdown +
// full-excerpt concatenation, the F-12 failure shape). These tests
// pin the fallback shape and its length caps. Switch-OFF behaviour
// (citation-validation failure / provider failure degrading to the
// extractive report) is pinned unchanged in
// originResearchRouter.test.ts.

const verifiedCatalogTime = Date.parse(DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0].verifiedAt) + 1;

const synthesisExecutionResult = {
  transportRequestCount: 1,
  actualCostUsd: 0 as const,
  providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
  routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
};

const RECORDS_ON_ENV = {
  OPENROUTER_API_KEY: "synthetic-test-key",
  ORIGIN_SYNTHESIS_RECORDS_ENABLED: "true",
};

const iphoneSources: OriginResearchSource[] = [
  { title: "iPhone 18 Pro 発表 - Apple Newsroom", url: "https://www.apple.com/jp/newsroom/iphone18", excerpt: "iPhone 18 Proは219,800円で、2026年9月18日に発売されます。", domain: "apple.com", rank: 1, sourceType: "web-search", evidenceLevel: "page-verified", retrievedAt: "2026-11-07T00:00:00.000Z", freshness: "recent", revisionTimestamp: "2026-09-10T00:00:00.000Z" },
  { title: "iPhone価格まとめ", url: "https://example.jp/iphone", excerpt: "iPhone 18 Proの価格は219,800円と報じられています。", domain: "example.jp", rank: 2, sourceType: "web-search", evidenceLevel: "snippet", retrievedAt: "2026-11-07T00:00:00.000Z", freshness: "unknown" },
];

const iphoneQuery = "iPhone の最新モデルの、日本での価格と発売日を教えてください";

function createApp(researchSynthesis: OriginResearchSynthesisExecutor, sources: OriginResearchSource[]) {
  researchMock.mockReset();
  researchMock.mockResolvedValue({ ok: true, searchProvider: "Tavily", sources });
  const app = express();
  app.use(express.json());
  app.use(createOriginResearchRouter({
    env: RECORDS_ON_ENV,
    researchSynthesis,
    catalogNow: () => verifiedCatalogTime,
  }));
  return app;
}

describe("originResearchRouter records-validation failure fallback (R-PR-9a)", () => {
  beforeEach(() => { researchMock.mockReset(); });

  it("returns the deterministic partial answer instead of the extractive dump (ja)", async () => {
    const synthesis = vi.fn().mockResolvedValue({ ...synthesisExecutionResult, text: "よく分かりませんでした。" });
    const response = await request(createApp(synthesis as unknown as OriginResearchSynthesisExecutor, iphoneSources))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: iphoneQuery }] });

    expect(response.status).toBe(200);
    expect(response.body.research.synthesis).toEqual({ status: "records-validation-failed", failureCode: "NO_ACCEPTED_RECORDS" });
    expect(response.body.routing.synthesisStatus).toBe("records-validation-failed");
    // The body is exactly the chat router's partial-answer shape for
    // the same sources: honest lead, confirmed scope from titles,
    // compact source list. No extractive report, no source excerpts.
    expect(response.body.content).toBe(buildGroundedResearchPartialAnswer(iphoneSources, "ja"));
    expect(response.body.content).not.toContain("出典付き調査レポート（抽出方式）");
    expect(response.body.content).not.toContain("iPhone 18 Proは219,800円で、2026年9月18日に発売されます。");
    expect(response.body.content).not.toContain("証拠比較");
    expect(response.body.content.length).toBeLessThanOrEqual(RESEARCH_RECORDS_FAILURE_MAX_CONTENT_CHARS);
    // Two executions inside the records path (records, then the
    // selection layer) — never a fall back into the text path.
    expect(synthesis).toHaveBeenCalledTimes(2);
  });

  it("returns the deterministic partial answer instead of the extractive dump (en)", async () => {
    const enSources: OriginResearchSource[] = [
      { title: "iPhone 18 Pro announced - Apple Newsroom", url: "https://www.apple.com/newsroom/iphone18", excerpt: "The iPhone 18 Pro starts at 219,800 yen and will be released on September 18, 2026.", domain: "apple.com", rank: 1, sourceType: "web-search", evidenceLevel: "page-verified", retrievedAt: "2026-11-07T00:00:00.000Z", freshness: "recent" },
      { title: "iPhone price roundup", url: "https://example.com/iphone", excerpt: "The iPhone 18 Pro price is reported as 219,800 yen.", domain: "example.com", rank: 2, sourceType: "web-search", evidenceLevel: "snippet", retrievedAt: "2026-11-07T00:00:00.000Z", freshness: "unknown" },
    ];
    const synthesis = vi.fn().mockResolvedValue({ ...synthesisExecutionResult, text: "I am not sure." });
    const response = await request(createApp(synthesis as unknown as OriginResearchSynthesisExecutor, enSources))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "What is the latest price of the newest iPhone model in Japan?" }] });

    expect(response.status).toBe(200);
    expect(response.body.research.synthesis).toEqual({ status: "records-validation-failed", failureCode: "NO_ACCEPTED_RECORDS" });
    expect(response.body.content).toBe(buildGroundedResearchPartialAnswer(enSources, "en"));
    expect(response.body.content).not.toContain("Cited research report (extractive)");
    expect(response.body.content).not.toContain("starts at 219,800 yen");
  });

  it("keeps the caps inert for ordinary sources (builder output equals the partial answer)", () => {
    expect(buildResearchRecordsValidationFailureAnswer(iphoneSources, "ja"))
      .toBe(buildGroundedResearchPartialAnswer(iphoneSources, "ja"));
    expect(buildResearchRecordsValidationFailureAnswer(iphoneSources, "en"))
      .toBe(buildGroundedResearchPartialAnswer(iphoneSources, "en"));
  });

  it("returns the deterministic partial answer when the records helper throws (provider-failed, R-PR-9d)", async () => {
    // The deferred 9a item: when the records helper itself throws,
    // the branch settles as provider-failed — and before R-PR-9d
    // that state still degraded to the extractive dump. It is a
    // records-path failure, so it now takes the same partial answer
    // as a records-validation failure. (A provider failure of the
    // TEXT synthesis keeps the extractive body; that switch-OFF
    // behaviour stays pinned in originResearchRouter.test.ts.)
    const synthesis = vi.fn().mockRejectedValue(new Error("provider exploded"));
    const response = await request(createApp(synthesis as unknown as OriginResearchSynthesisExecutor, iphoneSources))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: iphoneQuery }] });

    expect(response.status).toBe(200);
    expect(response.body.research.synthesis).toEqual({ status: "provider-failed", failureCode: "PROVIDER_INTERNAL_ERROR" });
    expect(response.body.routing.synthesisStatus).toBe("provider-failed");
    expect(response.body.content).toBe(buildGroundedResearchPartialAnswer(iphoneSources, "ja"));
    expect(response.body.content).not.toContain("出典付き調査レポート（抽出方式）");
    expect(response.body.content).not.toContain("iPhone 18 Proは219,800円で、2026年9月18日に発売されます。");
    expect(response.body.content).not.toContain("証拠比較");
    // The records execution threw once and the branch settled: the
    // text path never ran for a records-selected request.
    expect(synthesis).toHaveBeenCalledTimes(1);
  });

  it("caps any single line at the records packet excerpt cap and the whole body at the ceiling", () => {
    const longTitleSources: OriginResearchSource[] = Array.from({ length: 8 }, (_, i) => ({
      title: `出典${i + 1} ${"あ".repeat(1200)}`,
      url: `https://example${i + 1}.jp/item`,
      excerpt: `抜粋${i + 1}の本文テキストです。`,
      sourceType: "web-search",
      domain: `example${i + 1}.jp`,
      rank: i + 1,
      evidenceLevel: "snippet",
      retrievedAt: "2026-11-07T00:00:00.000Z",
      freshness: "unknown",
    }));
    const content = buildResearchRecordsValidationFailureAnswer(longTitleSources, "ja");
    for (const line of content.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(RECORDS_PACKET_EXCERPT_CHARS);
    }
    expect(content.length).toBeLessThanOrEqual(RESEARCH_RECORDS_FAILURE_MAX_CONTENT_CHARS);
    // The total cap fired and says so, at a line boundary, as the
    // last line; source body text never appears at any length.
    expect(content.endsWith("（出典一覧の一部を省略しました）")).toBe(true);
    expect(content).not.toContain("抜粋1の本文テキストです。");
  });
});
