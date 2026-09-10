import { describe, expect, it } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource.js";
import { buildGroundedResearchReport } from "./groundedResearchV11.js";

function source(overrides: Partial<OriginResearchSource>): OriginResearchSource {
  return {
    title: "Source",
    url: "https://example.com/source",
    excerpt: "Verified evidence",
    sourceType: "web-search",
    domain: "example.com",
    evidenceLevel: "snippet",
    retrievedAt: "2026-09-10T00:00:00.000Z",
    freshness: "unknown",
    ...overrides,
  };
}

describe("Grounded Research V1.1 evidence engine", () => {
  it("builds bounded citations and retrieval-only confidence", () => {
    const result = buildGroundedResearchReport([
      source({ title: "A", url: "https://a.example/report", domain: "a.example", evidenceLevel: "page-verified", freshness: "recent" }),
      source({ title: "B", url: "https://b.example/report", domain: "b.example", evidenceLevel: "page-verified", freshness: "older" }),
      source({ title: "C", url: "https://c.example/report", domain: "c.example", freshness: "unknown" }),
    ]);

    expect(result.version).toBe("1.1");
    expect(result.sourceCount).toBe(3);
    expect(result.distinctDomainCount).toBe(3);
    expect(result.confidence).toBe("strong");
    expect(result.confidenceScope).toBe("retrieval-evidence-only");
    expect(result.sources.map((item) => item.id)).toEqual(["S1", "S2", "S3"]);
    expect(result.report).toContain("[S1](https://a.example/report)");
    expect(result.sources.every((item) => item.score <= 95)).toBe(true);
  });

  it("flags only conservative structured value mismatches", () => {
    const result = buildGroundedResearchReport([
      source({ title: "Price A", url: "https://a.example/price", domain: "a.example", excerpt: "価格 1,000円" }),
      source({ title: "Price B", url: "https://b.example/price", domain: "b.example", excerpt: "価格 1,200円" }),
    ]);

    expect(result.semanticConflictDetection).toBe("conservative-structured-only");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ kind: "structured-value-mismatch", topic: "price" });
    expect(result.conflicts[0].note).toContain("not proof");
  });

  it("does not invent semantic conflict when no structured mismatch exists", () => {
    const result = buildGroundedResearchReport([
      source({ title: "A", url: "https://a.example/a", domain: "a.example", excerpt: "The service launched this week." }),
      source({ title: "B", url: "https://b.example/b", domain: "b.example", excerpt: "The product is available now." }),
    ]);
    expect(result.conflicts).toEqual([]);
    expect(result.report).toContain("Semantic agreement/conflict remains unassessed");
  });
});
