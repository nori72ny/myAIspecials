import { describe, expect, it } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource.js";
import {
  buildGroundedResearchPartialAnswer,
  buildGroundedResearchReport,
} from "./groundedResearchV11.js";

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
    expect(result.report).toContain("### S1 · a.example");
    expect(result.report).toContain("[A](https://a.example/report)");
    expect(result.report).toContain("取得日：2026年9月10日");
    expect(result.report).not.toContain("と示されています");
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

  it("keeps retrieved page text and the cross-check breakdown out of the user-facing report (synthesis-hygiene)", () => {
    const result = buildGroundedResearchReport("調査依頼", [
      source({ title: "Page A", url: "https://a.example/a", domain: "a.example", excerpt: "価格 1,000円 ナビゲーション広告文" }),
      source({ title: "Page B", url: "https://b.example/b", domain: "b.example", excerpt: "価格 1,200円 フッター案内文" }),
    ]);
    // Conflict detection still runs on the structured fields; only the
    // user-facing rendering changed.
    expect(result.conflicts).toHaveLength(1);
    expect(result.report).not.toContain("照合メモ");
    expect(result.report).not.toContain("ナビゲーション広告文");
    expect(result.report).not.toContain("フッター案内文");
    expect(result.report).not.toContain("1,000円 / 1,200円");
    expect(result.report).toContain("### S1 · a.example");
    expect(result.report).toContain("[Page A](https://a.example/a)");
    expect(result.report).not.toContain("と示されています");
    expect(result.report).toContain("値の食い違いが見られます");
  });

  it("presents sources as cards without the attribution boilerplate (sources-display follow-up)", () => {
    const result = buildGroundedResearchReport("日本の内閣総理大臣は誰ですか", [
      source({
        title: "首相官邸ホームページ",
        url: "https://www.kantei.go.jp/jp/104/actions/index.html",
        domain: "kantei.go.jp",
        evidenceLevel: "page-verified",
        freshness: "recent",
        retrievedAt: "2026-11-20T00:00:00.000Z",
        excerpt: "高市早苗は第104代内閣総理大臣です。内閣総理大臣の職務は内閣を代表して行政各部を指揮監督することです。",
      }),
      source({
        title: "政治ニュース",
        url: "https://news.example.co.jp/politics",
        domain: "news.example.co.jp",
        retrievedAt: "2026-11-19T00:00:00.000Z",
        excerpt: "高市早苗首相は記者会見で経済対策について説明しました。",
      }),
    ]);
    // Card presentation, the same shape as the partial answer's:
    // a heading with the source id and domain, then the linked title.
    expect(result.report).toContain("### S1 · kantei.go.jp");
    expect(result.report).toContain("[首相官邸ホームページ](https://www.kantei.go.jp/jp/104/actions/index.html)");
    expect(result.report).toContain("### S2 · news.example.co.jp");
    // Retrieval dates are collected into a single line, each date once.
    expect(result.report).toContain("取得日：2026年11月20日、2026年11月19日");
    // The old per-source attribution boilerplate no longer appears.
    expect(result.report).not.toContain("と示されています");
    expect(result.report).not.toMatch(/- S\d+（.+）では『/);
    // The report keeps its PKG-9 hygiene: even answer-bearing excerpt
    // sentences are not quoted on this surface — the card quote stays
    // exclusive to the partial answer.
    expect(result.report).not.toContain("高市早苗は第104代内閣総理大臣です");
    expect(result.report).not.toContain("記者会見で経済対策について説明しました");
    // The retrieval-metadata section is unchanged.
    expect(result.report).toContain("## 出典と取得状況");
    expect(result.report).toContain("取得状態: 本文確認済み");
  });
});

describe("source card vintage line (display measure 5-A, server side)", () => {
  it("shows the publication date under the title link when revisionTimestamp is known", () => {
    const text = buildGroundedResearchPartialAnswer([
      source({
        title: "一般求人情報",
        url: "https://a.example/jobs",
        domain: "a.example",
        revisionTimestamp: "2026-10-31T00:00:00.000Z",
      }),
    ], "ja", "求人について");
    expect(text).toContain("公表日：2026年10月31日");
    // The line sits directly under the title link, ahead of any quote.
    const linkIndex = text.indexOf("[一般求人情報](https://a.example/jobs)");
    const lineIndex = text.indexOf("公表日：2026年10月31日");
    expect(linkIndex).toBeGreaterThanOrEqual(0);
    expect(lineIndex).toBeGreaterThan(linkIndex);
  });

  it("prefers the edition stated in the title over the publication date (measure-3 rule)", () => {
    const text = buildGroundedResearchPartialAnswer([
      source({
        title: "一般職業紹介状況（令和8年9月分）",
        url: "https://www.mhlw.go.jp/stf/release",
        domain: "mhlw.go.jp",
        revisionTimestamp: "2026-10-30T00:00:00.000Z",
      }),
    ], "ja", "有効求人倍率を教えてください");
    expect(text).toContain("公表日：対象：令和8年9月分");
    expect(text).not.toContain("公表日：2026年10月30日");
  });

  it("omits the line entirely when the vintage cannot be read (no invented date)", () => {
    const text = buildGroundedResearchPartialAnswer([
      source({ title: "日付のないページ", url: "https://a.example/x", domain: "a.example" }),
      source({
        title: "読めない日付のページ",
        url: "https://b.example/y",
        domain: "b.example",
        revisionTimestamp: "not-a-date",
      }),
    ], "ja", "質問");
    expect(text).not.toContain("公表日");
  });

  it("renders the English forms", () => {
    const dated = buildGroundedResearchPartialAnswer([
      source({
        title: "Jobs report",
        url: "https://a.example/jobs",
        domain: "a.example",
        revisionTimestamp: "2026-10-31T00:00:00.000Z",
      }),
    ], "en", "jobs");
    expect(dated).toContain("Published: 2026-10-31");
    const edition = buildGroundedResearchPartialAnswer([
      source({
        title: "一般職業紹介状況（令和8年9月分）",
        url: "https://www.mhlw.go.jp/stf/release",
        domain: "mhlw.go.jp",
        revisionTimestamp: "2026-10-30T00:00:00.000Z",
      }),
    ], "en", "job openings ratio");
    expect(edition).toContain("Published: reference period: September 2026");
  });

  it("carries the same line on the research report's cards", () => {
    const result = buildGroundedResearchReport("調査依頼", [
      source({
        title: "公表資料",
        url: "https://a.example/release",
        domain: "a.example",
        revisionTimestamp: "2026-10-31T00:00:00.000Z",
      }),
    ]);
    expect(result.report).toContain("公表日：2026年10月31日");
  });
});
