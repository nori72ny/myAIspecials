import { describe, expect, it, vi } from "vitest";

import { searchOriginResearchSources } from "./OriginResearchSearchProvider";

describe("OriginResearchSearchProvider", () => {
  it("accepts a bounded zero-cost ranked list of public HTTPS sources", async () => {
    const provider = vi.fn(async (request) => ({
      queryDigest: request.queryDigest,
      results: [
        {
          rank: 1,
          title: "Official documentation",
          sourceUrl: "https://example.com/docs#section",
        },
        {
          rank: 2,
          title: "Official changelog",
          sourceUrl: "https://example.org/changelog",
        },
      ],
      actualCostUsd: 0,
      attempts: 1,
    }));

    const result = await searchOriginResearchSources("current product documentation", provider);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.record.results).toEqual([
      {
        rank: 1,
        title: "Official documentation",
        sourceUrl: "https://example.com/docs",
      },
      {
        rank: 2,
        title: "Official changelog",
        sourceUrl: "https://example.org/changelog",
      },
    ]);
  });

  it("fails closed when the provider is unavailable or throws", async () => {
    await expect(searchOriginResearchSources("safe public query"))
      .resolves.toEqual({
        ok: false,
        code: "RESEARCH_SEARCH_PROVIDER_NOT_AVAILABLE",
      });

    await expect(searchOriginResearchSources(
      "safe public query",
      vi.fn().mockRejectedValue(new Error("failed")),
    )).resolves.toEqual({
      ok: false,
      code: "RESEARCH_SEARCH_FAILED",
    });
  });

  it("blocks sensitive queries before provider execution", async () => {
    const provider = vi.fn();

    await expect(searchOriginResearchSources(
      "Authorization: Bearer synthetic_secret_token_123456",
      provider,
    )).resolves.toEqual({
      ok: false,
      code: "INVALID_RESEARCH_SEARCH_REQUEST",
    });

    expect(provider).not.toHaveBeenCalled();
  });

  it("rejects private, duplicate, mis-ranked, oversized or paid results", async () => {
    const base = async (request: { queryDigest: string }) => ({
      queryDigest: request.queryDigest,
      results: [{
        rank: 1,
        title: "Official docs",
        sourceUrl: "https://example.com/docs",
      }],
      actualCostUsd: 0,
      attempts: 1,
    });

    await expect(searchOriginResearchSources(
      "safe public query",
      vi.fn(async (request) => ({
        ...(await base(request)),
        results: [{
          rank: 1,
          title: "Internal",
          sourceUrl: "https://127.0.0.1/private",
        }],
      })),
    )).resolves.toEqual({
      ok: false,
      code: "RESEARCH_SEARCH_RECORD_MISMATCH",
    });

    await expect(searchOriginResearchSources(
      "safe public query",
      vi.fn(async (request) => ({
        ...(await base(request)),
        results: [
          { rank: 1, title: "A", sourceUrl: "https://example.com/docs" },
          { rank: 2, title: "B", sourceUrl: "https://example.com/docs#same" },
        ],
      })),
    )).resolves.toEqual({
      ok: false,
      code: "RESEARCH_SEARCH_RECORD_MISMATCH",
    });

    await expect(searchOriginResearchSources(
      "safe public query",
      vi.fn(async (request) => ({
        ...(await base(request)),
        results: [{
          rank: 2,
          title: "Wrong rank",
          sourceUrl: "https://example.com/docs",
        }],
      })),
    )).resolves.toEqual({
      ok: false,
      code: "RESEARCH_SEARCH_RECORD_MISMATCH",
    });

    await expect(searchOriginResearchSources(
      "safe public query",
      vi.fn(async (request) => ({
        ...(await base(request)),
        actualCostUsd: 0.01,
      })),
    )).resolves.toEqual({
      ok: false,
      code: "RESEARCH_SEARCH_COST_UNVERIFIED",
    });
  });
});
