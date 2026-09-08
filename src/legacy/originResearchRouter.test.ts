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
      pageVerifiedCount: 0,
      snippetCount: 2,
      recentCount: 0,
      olderCount: 0,
      unknownFreshnessCount: 2,
      duplicateTextGroupCount: 0,
      semanticAgreement: "not-assessed",
      semanticConflict: "not-assessed",
    });
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
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "現在のモデル状況を教えて" }] });
    expect(response.status).toBe(200);
    expect(response.body.research.comparison).toMatchObject({
      sourceCount: 2,
      distinctDomainCount: 2,
      pageVerifiedCount: 1,
      snippetCount: 1,
      recentCount: 1,
      unknownFreshnessCount: 1,
      duplicateTextGroupCount: 1,
      semanticAgreement: "not-assessed",
      semanticConflict: "not-assessed",
    });
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
    researchMock.mockResolvedValue({ ok: false, sources: [], limitation: "internal upstream detail" });
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
      research: { sources: [], status: "unavailable" },
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
