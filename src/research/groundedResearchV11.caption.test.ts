import { describe, expect, it } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import { buildGroundedResearchPartialAnswer } from "./groundedResearchV11";

// P3-0 (WEEKLY_INSPECTION_P3_DESIGN_2026-11-23 §3.6): tier-T3 source
// cards must not quote photo captions. The 2026-11-23 weekly
// inspection's S3 quote was a photo's description plus its credit
// ("…画像提供, Reuters") — alt text that names the question's
// subject, selected as answer-bearing. The presentation-stage quote
// filter drops credit-carrying sentences and, inside a quote that
// carries a credit, the caption block's descriptive fragments;
// substantive sentences and credit-free quotes are untouched.

function makeSource(overrides: Partial<OriginResearchSource>): OriginResearchSource {
  return {
    title: "資料",
    url: "https://example.com/article",
    excerpt: "",
    sourceType: "web-search",
    domain: "example.com",
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-23T01:00:00.000Z",
    freshness: "recent",
    sourceAuthority: "unclassified",
    ...overrides,
  };
}

const PM_QUESTION = "現在の内閣総理大臣は誰ですか？";

describe("tier-T3 quotes — caption contamination (P3-0)", () => {
  it("drops the inspection's caption run and keeps the substantive sentence", () => {
    const sources = [
      makeSource({
        title: "首相会見",
        url: "https://news.example.co.jp/pm-photo",
        domain: "news.example.co.jp",
        excerpt:
          "えんじ色の幕を背に演台に向かって話す内閣総理大臣。内閣総理大臣は紺のスーツを着ている 画像提供, Reuters。内閣総理大臣は記者会見で新しい経済対策を発表した。",
      }),
    ];
    const text = buildGroundedResearchPartialAnswer(sources, "ja", PM_QUESTION);
    expect(text).toContain("内閣総理大臣は記者会見で新しい経済対策を発表した。");
    expect(text).not.toContain("えんじ色");
    expect(text).not.toContain("画像提供");
    expect(text).not.toContain("スーツ");
  });

  it("shows no quote at all when the source's quote is only a caption", () => {
    const sources = [
      makeSource({
        title: "首相の写真",
        url: "https://news.example.co.jp/pm-photo-only",
        domain: "news.example.co.jp",
        excerpt: "えんじ色の幕を背に演台に向かって話す内閣総理大臣。内閣総理大臣は紺のスーツを着ている 画像提供, Reuters",
      }),
    ];
    const text = buildGroundedResearchPartialAnswer(sources, "ja", PM_QUESTION);
    expect(text).toContain("news.example.co.jp");
    expect(text).not.toContain("えんじ色");
    expect(text).not.toContain("画像提供");
    expect(text).not.toContain("『");
  });

  it("drops a standalone credit line and keeps the substantive sentences around it", () => {
    const sources = [
      makeSource({
        title: "首相指名",
        url: "https://news.example.co.jp/pm-credit",
        domain: "news.example.co.jp",
        excerpt: "内閣総理大臣は国会で指名された。内閣総理大臣の写真、画像提供：ロイター。内閣総理大臣は就任の記者会見で所信を述べた。",
      }),
    ];
    const text = buildGroundedResearchPartialAnswer(sources, "ja", PM_QUESTION);
    expect(text).toContain("内閣総理大臣は国会で指名された。");
    expect(text).toContain("内閣総理大臣は就任の記者会見で所信を述べた。");
    expect(text).not.toContain("画像提供");
    expect(text).not.toContain("ロイター");
  });

  it("leaves a credit-free quote untouched, including a noun-final sentence", () => {
    // The fragment rule is caption-block-scoped: without a credit
    // anywhere in the quote, a noun-final sentence is the source's
    // own style and stays.
    const sources = [
      makeSource({
        title: "首相の経済対策",
        url: "https://news.example.co.jp/pm-policy",
        domain: "news.example.co.jp",
        excerpt: "内閣総理大臣の新しい経済対策。内閣総理大臣は記者会見で対策の詳細を説明した。",
      }),
    ];
    const text = buildGroundedResearchPartialAnswer(sources, "ja", PM_QUESTION);
    expect(text).toContain("内閣総理大臣の新しい経済対策。");
    expect(text).toContain("内閣総理大臣は記者会見で対策の詳細を説明した。");
  });
});
