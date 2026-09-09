import { beforeEach, describe, expect, it, vi } from "vitest";

const { secureFetch } = vi.hoisted(() => ({ secureFetch: vi.fn() }));
vi.mock("../../services/mission-engine/src/application/agent/ToolExecutor.js", () => ({ secureFetch }));

import { researchCurrentInformation } from "./originResearchSource.js";

describe("originResearchSource", () => {
  beforeEach(() => secureFetch.mockReset());

  it("searches the public web endpoint first and returns source metadata", async () => {
    secureFetch.mockResolvedValueOnce('<a class="result__a" href="https://example.com/ai-optimization">AI optimization</a><div class="result__snippet">AI search optimization is the practice of improving visibility in AI-mediated search.</div>');

    const result = await researchCurrentInformation("AIO");
    expect(result.ok).toBe(true);
    expect(result.sources[0]).toMatchObject({ title: "AI optimization", url: "https://example.com/ai-optimization", sourceType: "web-search", domain: "example.com", rank: 1, evidenceLevel: "snippet", freshness: "unknown", retrievedAt: expect.any(String) });
    expect(secureFetch.mock.calls[0][0]).toContain("https://html.duckduckgo.com/html/?q=AIO");
    expect(secureFetch.mock.calls[0][0]).toContain("kl=us-en");
  });

  it("uses Japanese search preferences for Japanese queries", async () => {
    secureFetch.mockResolvedValueOnce('<a class="result__a" href="https://example.com/ai">人工知能</a><div class="result__snippet">人工知能に関する説明</div>');
    const result = await researchCurrentInformation("人工知能");
    expect(result.ok).toBe(true);
    expect(result.sources[0]).toMatchObject({ title: "人工知能", domain: "example.com", sourceType: "web-search", evidenceLevel: "snippet", freshness: "unknown", retrievedAt: expect.any(String) });
    expect(secureFetch.mock.calls[0][0]).toContain("https://html.duckduckgo.com/html/");
    expect(secureFetch.mock.calls[0][0]).toContain("kl=jp-jp");
  });

  it("marks Wikipedia evidence as page-verified only after page metadata is fetched", async () => {
    secureFetch
      .mockRejectedValueOnce(new Error("search unavailable"))
      .mockResolvedValueOnce(JSON.stringify({ pages: [{ key: "AI", title: "AI", excerpt: "Artificial intelligence." }] }))
      .mockResolvedValueOnce(JSON.stringify({ html_url: "https://en.wikipedia.org/wiki/AI", latest: { timestamp: "2026-09-06T00:00:00Z" } }));

    const result = await researchCurrentInformation("latest AI news", new Date("2026-09-08T00:00:00Z"));
    expect(result.ok).toBe(true);
    expect(result.fallback).toEqual({ stage: "web-search", code: "NETWORK_FAILURE" });
    expect(result.sources[0]).toMatchObject({
      evidenceLevel: "page-verified",
      revisionTimestamp: "2026-09-06T00:00:00Z",
      retrievedAt: "2026-09-08T00:00:00.000Z",
      freshness: "recent",
    });
  });

  it("marks verified pages older than 30 days without claiming current freshness", async () => {
    secureFetch
      .mockRejectedValueOnce(new Error("search unavailable"))
      .mockResolvedValueOnce(JSON.stringify({ pages: [{ key: "AI", title: "AI", excerpt: "Artificial intelligence." }] }))
      .mockResolvedValueOnce(JSON.stringify({ html_url: "https://en.wikipedia.org/wiki/AI", latest: { timestamp: "2026-07-01T00:00:00Z" } }));

    const result = await researchCurrentInformation("latest AI news", new Date("2026-09-08T00:00:00Z"));
    expect(result.sources[0]).toMatchObject({ evidenceLevel: "page-verified", freshness: "older" });
  });

  it("fails closed when the source cannot be reached", async () => {
    secureFetch.mockRejectedValueOnce(new Error("network blocked"));
    secureFetch.mockRejectedValueOnce(new Error("Secure fetch request timed out."));
    const result = await researchCurrentInformation("latest AI news");
    expect(result.ok).toBe(false);
    expect(result.sources).toEqual([]);
    expect(result.fallback).toEqual({ stage: "web-search", code: "NETWORK_FAILURE" });
    expect(result.failure).toEqual({ stage: "encyclopedia-search", code: "UPSTREAM_TIMEOUT" });
    expect(JSON.stringify(result)).not.toContain("network blocked");
    expect(JSON.stringify(result)).not.toContain("timed out");
  });

  it("classifies invalid fallback responses without returning parser details", async () => {
    secureFetch.mockRejectedValueOnce(new Error("Fetch error: HTTP status 403"));
    secureFetch.mockResolvedValueOnce("not-json");
    const result = await researchCurrentInformation("latest AI news");
    expect(result).toMatchObject({
      ok: false,
      sources: [],
      fallback: { stage: "web-search", code: "UPSTREAM_HTTP_ERROR" },
      failure: { stage: "encyclopedia-search", code: "INVALID_RESPONSE" },
    });
    expect(JSON.stringify(result)).not.toContain("403");
    expect(JSON.stringify(result)).not.toContain("not-json");
  });
});
