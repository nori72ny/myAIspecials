import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { researchMock } = vi.hoisted(() => ({ researchMock: vi.fn() }));
vi.mock("./originResearchSource.js", () => ({ researchCurrentInformation: researchMock }));

import { createOriginResearchRouter } from "./originResearchRouter.js";

describe("originResearchRouter", () => {
  beforeEach(() => researchMock.mockReset());

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
    expect(response.body.routing).toMatchObject({ provider: "DuckDuckGo", cost: 0, actualCostUsd: 0, freeOnly: true });
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

  it("returns a dedicated zero-cost failure instead of falling through to an unverified model answer", async () => {
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

  it("blocks sensitive freshness queries before any external research call", async () => {
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter());
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "最新情報を調べて API key=super-secret-123" }] });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("SENSITIVE_INPUT_BLOCKED");
    expect(researchMock).not.toHaveBeenCalled();
  });
});
