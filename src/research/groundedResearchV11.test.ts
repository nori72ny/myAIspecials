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
    const result = buildGroundedResearchReport("調査依頼", [
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
    expect(result.report).toContain("依頼: 調査依頼");
    expect(result.report).toContain("## 確認できた内容");
    expect(result.report).toContain("[S1](https://a.example/report)");
    expect(result.sources.every((item) => item.score <= 95)).toBe(true);
    expect(result.sources.every((item) => item.sourceAuthority === "unclassified")).toBe(true);
    expect(result.report).toContain("出典区分: 権威性未分類");
  });

  it("surfaces deterministic official and secondary-reference authority classes without upgrading them to truth claims", () => {
    const result = buildGroundedResearchReport("公式情報と参考情報を比較", [
      source({ title: "Official", url: "https://support.google.com/example", domain: "support.google.com", sourceAuthority: "official-domain-match" }),
      source({ title: "Reference", url: "https://ja.wikipedia.org/wiki/Test", domain: "ja.wikipedia.org", sourceType: "encyclopedia", sourceAuthority: "secondary-reference" }),
    ]);

    expect(result.sources.map((item) => item.sourceAuthority)).toEqual(["official-domain-match", "secondary-reference"]);
    expect(result.report).toContain("公式ドメイン一致（ユーザー指定条件）");
    expect(result.report).toContain("二次参照（百科事典）");
    expect(result.report).toContain("内容の真偽や媒体の権威性そのものを独立検証した意味ではありません");
  });

  it("flags only conservative structured value mismatches", () => {
    const result = buildGroundedResearchReport("調査依頼", [
      source({ title: "Price A", url: "https://a.example/price", domain: "a.example", excerpt: "価格 1,000円" }),
      source({ title: "Price B", url: "https://b.example/price", domain: "b.example", excerpt: "価格 1,200円" }),
    ]);

    expect(result.semanticConflictDetection).toBe("conservative-structured-only");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ kind: "structured-value-mismatch", topic: "price" });
    expect(result.conflicts[0].note).toContain("not proof");
  });

  it("does not invent semantic conflict when no structured mismatch exists", () => {
    const result = buildGroundedResearchReport("調査依頼", [
      source({ title: "A", url: "https://a.example/a", domain: "a.example", excerpt: "The service launched this week." }),
      source({ title: "B", url: "https://b.example/b", domain: "b.example", excerpt: "The product is available now." }),
    ]);
    expect(result.conflicts).toEqual([]);
    expect(result.report).toContain("意味上の一致までは判定していません");
  });
});
