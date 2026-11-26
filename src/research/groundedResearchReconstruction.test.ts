import { describe, expect, it } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource.js";
import { tryGroundedResearchReconstruction } from "./groundedResearchReconstruction.js";

/**
 * K-06 案A (SOURCES_ONLY_FALLBACK_DIAGNOSIS_2026-11-25): the
 * deterministic reconstruction that stands between a non-adopted
 * synthesis and the sources-only partial answer. Pins the
 * establishment discipline (verbatim, question-keyed, excerpt-origin
 * sentences and/or a confirmed value vote — nothing else), the
 * numeric discipline (every number in the output comes from a
 * source), and the never-worse contract (not established → the
 * caller keeps the standing partial answer).
 */
const NOW = Date.parse("2026-11-19T00:00:00.000Z");

function source(partial: Partial<OriginResearchSource> & { title: string; url: string; excerpt: string }): OriginResearchSource {
  return {
    sourceType: "web-search",
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-19T00:00:00.000Z",
    freshness: "recent",
    ...partial,
  };
}

const GASOLINE_QUESTION = "レギュラーガソリンの全国平均価格は今いくらくらいですか？";
const gasolineSources = (): OriginResearchSource[] => [
  source({
    title: "石油製品価格調査",
    url: "https://enecho.meti.go.jp/article",
    domain: "enecho.meti.go.jp",
    excerpt: "資源エネルギー庁が2026年11月16日に公表した調査では、レギュラーガソリンの全国平均価格は170.0円でした。",
  }),
  source({
    title: "ガソリン価格ニュース",
    url: "https://news.example/article",
    domain: "news.example",
    excerpt: "ガソリン価格の全国平均は、2026年11月16日時点で170.0円となっています。",
  }),
];

const VEGA_QUESTION = "Vega X1の価格と発売日を教えてください";
const vegaSources = (): OriginResearchSource[] => [
  source({
    title: "新型スマートフォン Vega X1 発表",
    url: "https://example.com/vega-x1",
    domain: "example.com",
    excerpt: "Vega X1は2026年12月4日に発売されます。価格は税込89,800円です。",
  }),
  source({
    title: "Vega X1 価格まとめ",
    url: "https://example.net/vega",
    domain: "example.net",
    excerpt: "Vega X1の価格は89,800円と発表されています。",
  }),
];

describe("tryGroundedResearchReconstruction", () => {
  it("establishes via the value vote when independent sources confirm a scalar", () => {
    const attempt = tryGroundedResearchReconstruction({
      question: GASOLINE_QUESTION,
      sources: gasolineSources(),
      language: "ja",
      nowMs: NOW,
    });
    expect(attempt.established).toBe(true);
    expect(attempt.via).toBe("value-vote");
    expect(attempt.voteFired).toBe(true);
    // The confirmed value and its as-of date, stated directly.
    expect(attempt.text).toContain("170.0円");
    expect(attempt.text).toContain("2026年11月16日");
    // One unified source list in grounded numbering.
    expect(attempt.text).toContain("## 出典");
    expect(attempt.text).toContain("- S1: 石油製品価格調査（enecho.meti.go.jp）");
    expect(attempt.text).toContain("- S2: ガソリン価格ニュース（news.example）");
  });

  it("establishes via packet sentences when no vote fires: verbatim, cited, question-keyed", () => {
    const attempt = tryGroundedResearchReconstruction({
      question: VEGA_QUESTION,
      sources: vegaSources(),
      language: "ja",
      nowMs: NOW,
    });
    expect(attempt.established).toBe(true);
    expect(attempt.via).toBe("packet-sentences");
    // The price vote needs official support for a statistical price;
    // two commercial blogs do not provide it, so the vote stays out.
    expect(attempt.voteFired).toBe(false);
    // The sources' own sentences, verbatim, each cited to its source.
    expect(attempt.text).toContain("「価格は税込89,800円です。」 [S1](https://example.com/vega-x1)");
    expect(attempt.text).toContain("「Vega X1の価格は89,800円と発表されています。」 [S2](https://example.net/vega)");
    expect(attempt.sentenceCount).toBe(2);
    // The release-date sentence is NOT carried: it matches none of
    // the question's word keys (発売日 vs the sentence's 発売されます)
    // and the bare-number key from "X1" is not relevance evidence —
    // the establishment gate errs on the strict side.
    expect(attempt.text).not.toContain("発売されます");
    // Numeric discipline: every digit run in the body appears in a source.
    const corpus = vegaSources().map((item) => `${item.title} ${item.excerpt} ${item.url}`).join(" ");
    for (const digits of attempt.text!.match(/\d[\d,.]*/g) ?? []) {
      expect(corpus).toContain(digits);
    }
    expect(attempt.text).toContain("89,800");
    expect(attempt.text).not.toContain("要約した回答を作成できなかったため");
  });

  it("does not establish on chrome/marker excerpts without question keys", () => {
    const attempt = tryGroundedResearchReconstruction({
      question: "今日の公開情報を調査してください",
      sources: [
        source({
          title: "内閣総理大臣 高市 早苗 - 首相官邸ホームページ",
          url: "https://www.kantei.go.jp/jp/104/actions/index.html",
          domain: "kantei.go.jp",
          excerpt: "抜粋マーカー1 ナビゲーション ホーム 政策 広告バナー",
        }),
        source({
          title: "高市総理大臣 記者会見の概要",
          url: "https://www.nhk.or.jp/politics/articles/1.html",
          domain: "nhk.or.jp",
          excerpt: "抜粋マーカー2 サイドバー おすすめ記事 フッター案内",
        }),
      ],
      language: "ja",
      nowMs: NOW,
    });
    expect(attempt.established).toBe(false);
    expect(attempt.text).toBeUndefined();
    expect(attempt.sentenceCount).toBe(0);
  });

  it("does not establish on a sentence that merely restates the question's framing", () => {
    // The degenerate shape behind several pre-existing router pins:
    // a generic "investigate today's public information" question
    // and a source whose only sentence echoes that framing. It
    // matches one question key but carries no answer-bearing signal,
    // so the sources-only partial answer must stand.
    const attempt = tryGroundedResearchReconstruction({
      question: "今日の公開情報を調査してください",
      sources: [
        source({
          title: "Current source",
          url: "https://example.com/current",
          domain: "example.com",
          excerpt: "現在確認できた公開情報です。",
        }),
      ],
      language: "ja",
      nowMs: NOW,
    });
    expect(attempt.established).toBe(false);
    expect(attempt.text).toBeUndefined();
  });

  it("never presents title text as a source statement", () => {
    const attempt = tryGroundedResearchReconstruction({
      question: VEGA_QUESTION,
      sources: [
        source({
          title: "Vega X1の価格は99,800円",
          url: "https://example.com/title-only",
          domain: "example.com",
          excerpt: "このページは製品の概要を紹介する導入文です。詳細は各販売店へお問い合わせください。",
        }),
        source({
          title: "別の製品の案内",
          url: "https://example.net/other",
          domain: "example.net",
          excerpt: "当店では周辺機器を取り扱っています。在庫は店舗により異なります。",
        }),
      ],
      language: "ja",
      nowMs: NOW,
    });
    expect(attempt.established).toBe(false);
    expect(attempt.text).toBeUndefined();
  });

  it("skips (never truncates) an over-long sentence instead of quoting part of it", () => {
    const longSentence = `価格の内訳は、${"部品ごとの単価と工賃と諸経費の明細が延々と続く説明文で、".repeat(9)}最終的な価格は89,800円です。`;
    expect(longSentence.length).toBeGreaterThan(240);
    const attempt = tryGroundedResearchReconstruction({
      question: VEGA_QUESTION,
      sources: [
        source({
          title: "価格の内訳",
          url: "https://example.com/long",
          domain: "example.com",
          excerpt: longSentence,
        }),
        source({
          title: "別の案内",
          url: "https://example.net/other2",
          domain: "example.net",
          excerpt: "営業時間は平日9時から17時までです。",
        }),
      ],
      language: "ja",
      nowMs: NOW,
    });
    expect(attempt.established).toBe(false);
    expect(attempt.text).toBeUndefined();
  });

  it("does not establish when there are no sources", () => {
    const attempt = tryGroundedResearchReconstruction({
      question: VEGA_QUESTION,
      sources: [],
      language: "ja",
      nowMs: NOW,
    });
    expect(attempt.established).toBe(false);
  });

  it("annotates each quoted sentence and source-list line with its source's date (round-8 measure E)", () => {
    // The F-03 shape: a quoted value whose vintage matters. The
    // dated source's lines carry the date. The undated source's
    // QUOTED VALUE carries the explicit unknown marker
    // (certainty-display systematization, 推奨2): silence in the
    // annotation slot read as "current", so the unknown is now
    // stated, not implied. The quote itself stays untouched
    // (the marker sits outside it), and the source LIST line
    // still carries nothing — the list presents no value.
    const dated = vegaSources();
    dated[0] = { ...dated[0]!, revisionTimestamp: "2026-06-15T00:00:00.000Z" };
    const attempt = tryGroundedResearchReconstruction({
      question: VEGA_QUESTION,
      sources: dated,
      language: "ja",
      nowMs: NOW,
    });
    expect(attempt.established).toBe(true);
    expect(attempt.via).toBe("packet-sentences");
    expect(attempt.text).toContain(
      "「価格は税込89,800円です。」 [S1](https://example.com/vega-x1) （出典の日付：2026年6月15日）",
    );
    expect(attempt.text).toContain(
      "- S1: 新型スマートフォン Vega X1 発表（example.com） （出典の日付：2026年6月15日）",
    );
    expect(attempt.text).toContain(
      "「Vega X1の価格は89,800円と発表されています。」 [S2](https://example.net/vega) （時点不明）",
    );
    expect(attempt.text).toContain("- S2: Vega X1 価格まとめ（example.net）");
    expect(attempt.text).not.toContain("- S2: Vega X1 価格まとめ（example.net） （時点不明）");
    expect(attempt.text).not.toContain("（出典の日付：2026年6月15日） （出典の日付");
  });

  it("marks an undated quoted value as period-unknown (推奨2)", () => {
    // Both Vega sources are undated and neither quoted sentence
    // dates itself, so both sentence lines carry the marker. (The
    // English marker string is pinned at the helper level in
    // originOfficialEdition.test.ts and on the partial-answer
    // card in groundedResearchV11.test.ts; an English-question
    // reconstruction cannot be pinned here because the packet's
    // question-key extraction is Japanese-oriented — a
    // pre-existing limitation outside this change's scope.)
    const attempt = tryGroundedResearchReconstruction({
      question: VEGA_QUESTION,
      sources: vegaSources(),
      language: "ja",
      nowMs: NOW,
    });
    expect(attempt.established).toBe(true);
    expect(attempt.text).toContain(
      "「価格は税込89,800円です。」 [S1](https://example.com/vega-x1) （時点不明）",
    );
    expect(attempt.text).toContain(
      "「Vega X1の価格は89,800円と発表されています。」 [S2](https://example.net/vega) （時点不明）",
    );
  });

  it("adds no unknown marker when the quoted sentence dates its own value (推奨2)", () => {
    // The gasoline sentences state their own publication point
    // (2026年11月16日に公表した): the reader can place the value
    // from the sentence itself, so the marker would be noise.
    const attempt = tryGroundedResearchReconstruction({
      question: GASOLINE_QUESTION,
      sources: gasolineSources(),
      language: "ja",
      nowMs: NOW,
    });
    expect(attempt.established).toBe(true);
    expect(attempt.text).not.toContain("時点不明");
  });

  it("annotates an official statistics source by its EDITION, not its page date (follow-up measure 3)", () => {
    // The F-05 follow-up shape: the release page was POSTED on
    // 2026-10-30, but what makes its value current is the edition
    // it reports （令和8年9月分）. The annotation names the
    // edition; the page date must not pose as the value's vintage.
    const sources = [
      source({
        title: "一般職業紹介状況（令和8年9月分）を公表しました",
        url: "https://www.mhlw.go.jp/stf/newdata/20261030.html",
        domain: "mhlw.go.jp",
        excerpt: "全国の有効求人倍率は1.19倍でした。",
        revisionTimestamp: "2026-10-30T00:00:00.000Z",
      }),
    ];
    const attempt = tryGroundedResearchReconstruction({
      question: "最新の有効求人倍率を教えてください。いつの分ですか？",
      sources,
      language: "ja",
      nowMs: NOW,
    });
    expect(attempt.established).toBe(true);
    expect(attempt.text).toContain("（対象：令和8年9月分）");
    expect(attempt.text).not.toContain("（出典の日付：2026年10月30日）");
  });

  it("quotes the current official value, not only the stale secondary one (measure C, B3 shape)", () => {
    // ANSWER_SOURCES_ONLY_DIAGNOSIS_2026-11-26, failure 1: the
    // pool held the current MHLW release (post-extract, its value
    // sentence is in the material) and a Nikkei piece carrying the
    // previous month's value. The values disagree, so the vote
    // cannot fire; the packet landing must still quote the official
    // current value — the failure was a landing whose only quoted
    // number was the stale secondary 1.18.
    const sources = [
      source({
        title: "一般職業紹介状況（令和8年9月分）",
        url: "https://www.mhlw.go.jp/stf/newpage_76960.html",
        domain: "mhlw.go.jp",
        authorityTier: "official",
        excerpt: "令和8年9月の有効求人倍率は1.19倍で、前月と比べて0.01ポイント上昇しました。",
      }),
      source({
        title: "有効求人倍率、8月は1.18倍 横ばい",
        url: "https://www.nikkei.com/article/example",
        domain: "nikkei.com",
        authorityTier: "major-news",
        excerpt: "8月の有効求人倍率は1.18倍で、前月から横ばいでした。完全失業率は2.5%に上昇しました。",
      }),
    ];
    const attempt = tryGroundedResearchReconstruction({
      question: "有効求人倍率の最新の値を教えてください",
      sources,
      language: "ja",
      nowMs: NOW,
    });
    expect(attempt.established).toBe(true);
    expect(attempt.via).toBe("packet-sentences");
    expect(attempt.voteFired).toBe(false);
    // The official current value is quoted, cited to the ministry,
    // and annotated with its edition.
    expect(attempt.text).toContain(
      "「令和8年9月の有効求人倍率は1.19倍で、前月と比べて0.01ポイント上昇しました。」 [S1](https://www.mhlw.go.jp/stf/newpage_76960.html) （対象：令和8年9月分）",
    );
    // The unrelated unemployment figure from the secondary piece is
    // not carried: it matches none of the question's keys.
    expect(attempt.text).not.toContain("完全失業率は2.5%に上昇しました");
  });

  it("suppresses a stale-edition sentence when the current official release is carried (measure C)", () => {
    // Both releases are official; only their editions differ. Once
    // the current edition's value is carried, the superseded
    // edition's value must not be quoted next to it.
    const sources = [
      source({
        title: "一般職業紹介状況（令和8年9月分）",
        url: "https://www.mhlw.go.jp/stf/newpage_76960.html",
        domain: "mhlw.go.jp",
        authorityTier: "official",
        excerpt: "令和8年9月の有効求人倍率は1.19倍で、前月と比べて0.01ポイント上昇しました。",
      }),
      source({
        title: "一般職業紹介状況（令和7年12月分）",
        url: "https://www.mhlw.go.jp/stf/newdata/20251226.html",
        domain: "mhlw.go.jp",
        authorityTier: "official",
        excerpt: "令和7年12月の有効求人倍率は1.18倍でした。",
      }),
    ];
    const attempt = tryGroundedResearchReconstruction({
      question: "有効求人倍率の最新の値を教えてください",
      sources,
      language: "ja",
      nowMs: NOW,
    });
    expect(attempt.established).toBe(true);
    expect(attempt.text).toContain("1.19倍");
    expect(attempt.text).not.toContain("1.18倍");
  });

  it("spends the sentence cap on value sentences before file-guide sentences (round-5 measure 5-3b)", () => {
    // The measured B3 landing shape: the adopted official page's
    // quotable sentence is a file guide (no value), and it carried
    // the official + edition bonuses that ranked it first. Five
    // value sentences from a second source fill the cap; the guide
    // must not displace any of them. (The values disagree with each
    // other, so no value vote fires — this is the packet path.)
    const sources = [
      source({
        title: "労働力調査（基本集計）令和8年9月分 結果の概要",
        url: "https://www.stat.go.jp/data/roudou/sokuhou/gaiyou.html",
        domain: "stat.go.jp",
        authorityTier: "official",
        excerpt: "完全失業率の統計表（印刷用PDF：148KB）を掲載しています。",
      }),
      source({
        title: "失業率の解説",
        url: "https://blog.example.com/unemployment",
        domain: "blog.example.com",
        excerpt: Array.from(
          { length: 5 },
          (_, index) => `完全失業率は2.${index + 1}%でした。`,
        ).join(""),
      }),
    ];
    const attempt = tryGroundedResearchReconstruction({
      question: "最新の完全失業率を教えてください。いつの分ですか？",
      sources,
      language: "ja",
      nowMs: NOW,
    });
    expect(attempt.established).toBe(true);
    for (let index = 1; index <= 5; index += 1) {
      expect(attempt.text).toContain(`完全失業率は2.${index}%でした`);
    }
    expect(attempt.text).not.toContain("印刷用PDF");
  });
});
