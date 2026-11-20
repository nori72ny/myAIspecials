import { describe, expect, it } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import { buildGroundedResearchEvidenceCards } from "./groundedResearchEvidenceCards";
import { buildGroundedResearchPartialAnswer } from "./groundedResearchV11";
import {
  buildGroundedResearchSynthesisPrompt,
  compactExcerpt,
  validateGroundedResearchSynthesis,
} from "./groundedResearchSynthesisV12";

// N-2b (N2_N5_IMPLEMENTATION_DESIGN_2026-11-17 §1.4 / §1.6): the
// evidence cards built in N-2a are wired into the two presentation
// surfaces — the synthesis packet presents each source as its card
// (claim sentences first, excerpt after, metadata and citation tokens
// unchanged), and the tier-T3 extractive partial answer quotes the
// cards' claim sentences instead of the excerpt's head. The validator
// is not touched: its evidence set stays the full source side, which
// the invariance test below pins.

function source(partial: Partial<OriginResearchSource>): OriginResearchSource {
  return {
    title: "資料",
    url: "https://example.com/source",
    excerpt: "",
    sourceType: "web-search",
    domain: "example.com",
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-14T03:00:00.000Z",
    freshness: "recent",
    ...partial,
  };
}

const packetSources: OriginResearchSource[] = [
  source({
    title: "参議院の定数について",
    url: "https://example.com/councillors",
    domain: "example.com",
    excerpt:
      "このページでは制度の概要と利用案内を掲載しています。参議院の定数は248人です。前回の改選では定数は245人でした。申込期限は2026年3月31日です。",
  }),
  source({
    title: "関連資料",
    url: "https://example.org/related",
    domain: "example.org",
    excerpt: "関連する制度の説明です。対象は全国の自治体です。",
  }),
];

function packetField(prompt: string, field: string): unknown {
  const match = prompt.match(new RegExp(`${field}: (\"(?:[^\"\\\\]|\\\\.)*\"|\\[(?:[^\\[\\]]|\\\\.)*\\]|null)`));
  expect(match, `packet field ${field}`).not.toBeNull();
  return JSON.parse(match![1]);
}

describe("N-2b synthesis packet card presentation", () => {
  it("presents claim sentences first, then the excerpt, with E ids aligned 1:1 to S ids", () => {
    const question = "参議院の定数は何人ですか？";
    const prompt = buildGroundedResearchSynthesisPrompt(question, packetSources, [], "ja");
    const cards = buildGroundedResearchEvidenceCards(question, packetSources).cards;

    // The card fields ride inside each source block, claim sentences
    // ahead of the excerpt (the coverage allocation of §1.4).
    expect(prompt).toContain('evidenceId_json: "E1"');
    expect(prompt).toContain('evidenceId_json: "E2"');
    expect(packetField(prompt, "claimSentences_json")).toEqual(cards[0].claimSentences);
    const firstBlock = prompt.split("</source>")[0];
    expect(firstBlock.indexOf("claimSentences_json")).toBeLessThan(firstBlock.indexOf("excerpt_json"));

    // The claim sentences are the question-answering core: the
    // capacity sentence is selected, in the source's own words.
    expect(cards[0].claimSentences.join(" ")).toContain("参議院の定数は248人です。");

    // Metadata and citation tokens are byte-identical to the pre-card
    // packet: the excerpt field is exactly compactExcerpt's output and
    // citations stay S-based.
    expect(packetField(prompt, "excerpt_json")).toBe(compactExcerpt(packetSources[0].excerpt));
    expect(prompt).toContain("citation_token: [S1](https://example.com/councillors)");
    expect(prompt).toContain("citation_token: [S2](https://example.org/related)");
  });

  it("keeps every claim sentence verbatim from its source excerpt (no fabrication)", () => {
    const question = "参議院の定数は何人ですか？";
    const { cards } = buildGroundedResearchEvidenceCards(question, packetSources);
    cards.forEach((card, index) => {
      const normalizedExcerpt = packetSources[index].excerpt.replace(/\s+/g, " ");
      for (const sentence of card.claimSentences) {
        expect(normalizedExcerpt).toContain(sentence);
      }
    });
  });

  it("leaves the validator's evidence set on the full source side (§1.1 invariant)", () => {
    const question = "参議院の定数は何人ですか？";
    const invarianceSources: OriginResearchSource[] = [
      source({
        title: "参議院の定数について",
        url: "https://example.com/councillors",
        domain: "example.com",
        excerpt:
          "参議院の定数は248人です。申込期限は2026年3月31日です。対象は全国の自治体です。前回の改選では定数は245人でした。",
      }),
      source({
        title: "関連資料",
        url: "https://example.org/related",
        domain: "example.org",
        excerpt: "関連する制度の説明です。対象は全国の自治体です。",
      }),
    ];
    const { cards } = buildGroundedResearchEvidenceCards(question, invarianceSources);
    // 245人 appears in the first source's excerpt but is NOT one of
    // its card's claim sentences — the card is a presentation
    // selection, not the evidence boundary.
    expect(cards[0].claimSentences.join(" ")).toContain("248人");
    expect(cards[0].claimSentences.join(" ")).not.toContain("245人");
    expect(invarianceSources[0].excerpt).toContain("245人");

    // A synthesis resting on that non-claim excerpt sentence still
    // passes the unchanged validator, because validation reads the
    // full source side (title + excerpt + date forms).
    const answer = [
      "前回の改選では定数は245人でした [S1](https://example.com/councillors)",
      "関連する制度の対象は全国の自治体です [S2](https://example.org/related)",
    ].join("\n");
    const validation = validateGroundedResearchSynthesis(answer, invarianceSources);
    expect(validation).toEqual({ ok: true, usedSourceIds: ["S1", "S2"] });
  });
});

describe("N-2b tier-T3 partial answer claim quotes", () => {
  const t3Sources: OriginResearchSource[] = [
    source({
      title: "参議院について",
      url: "https://example.com/about",
      excerpt:
        "このサイトでは各種手続きの案内と窓口の営業時間を掲載しています。参議院の定数は248人です。関連リンク集はこちらです。",
    }),
  ];

  it("quotes the claim sentences selected for the question, not the excerpt head", () => {
    const text = buildGroundedResearchPartialAnswer(t3Sources, "ja", "参議院の定数は何人ですか？");
    // The answer-bearing sentence is quoted on the source's card…
    expect(text).toContain("『参議院の定数は248人です。』");
    // …and the unselected trailing sentence no longer rides along the
    // way the head-of-excerpt quote carried it.
    expect(text).not.toContain("関連リンク集");
    expect(text).toContain("## 確認できた範囲");
    // Sources-display redesign (2026-11-20): the cards replace both
    // the attribution boilerplate and the duplicated plain source
    // list, so there is no separate 出典 section anymore.
    expect(text).not.toContain("## 出典");
    expect(text).not.toContain("と示されています");
    expect(text).toContain("### S1 · example.com");
    expect(text).toContain("[参議院について](https://example.com/about)");
  });

  it("still applies the R-1 neutralization to claim quotes", () => {
    const hostile = [source({
      title: "案内",
      url: "https://example.com/hostile",
      excerpt: "詳細は[案内ページ](https://example.org/x)を見てください。定員は248人です。",
    })];
    const text = buildGroundedResearchPartialAnswer(hostile, "ja", "定員は何人ですか？");
    // PR-2: the packet now quotes only the answering sentence, so the
    // link-bearing sentence no longer rides the quote at all (it does
    // not answer the question); the neutralization properties below
    // are unchanged — no URL and no link syntax survive in the quote.
    // (The card's own title link is the one deliberate exception: it
    // points at the source itself, so the checks scope to the quote.)
    expect(text).not.toContain("案内ページ");
    expect(text).not.toContain("example.org/x");
    const quote = text.match(/『([^』]*)』/)?.[1] ?? "";
    expect(quote).toBe("定員は248人です。");
    expect(quote).not.toContain("](");
    expect(quote).not.toContain("http");
    expect(text).toContain("定員は248人です。");
  });

  it("still bounds the claim quote at 120 characters", () => {
    // PR-2: the bound applies to the packet quote. The long sentence
    // must carry a question key to be selected at all — a long
    // non-answering sentence is dropped by the packet instead of
    // being quoted — so the key and the number ride inside it.
    // Sources-display redesign (2026-11-20): the bound dropped from
    // 240 to 120 characters, and a mid-sentence cut is marked with
    // an ellipsis instead of ending silently.
    const long = [source({
      title: "長い資料",
      url: "https://example.com/long",
      excerpt: `${"あ".repeat(300)}定員は248人です。`,
    })];
    const text = buildGroundedResearchPartialAnswer(long, "ja", "定員は何人ですか？");
    expect(text).toContain(`『${"あ".repeat(120)}…』`);
    expect(text).not.toContain("あ".repeat(121));
  });

  it("keeps the title-only card when a source has no quotable excerpt", () => {
    const bare = [source({ title: "抜粋なし資料", url: "https://example.com/bare", excerpt: "" })];
    const text = buildGroundedResearchPartialAnswer(bare, "ja", "定員は何人ですか？");
    expect(text).toContain("### S1 · example.com");
    expect(text).toContain("[抜粋なし資料](https://example.com/bare)");
    expect(text).not.toContain("『");
    // The retrieval date is collected once under the section heading
    // instead of riding on the card.
    expect(text).toContain("取得日：2026年11月14日");
  });

  it("is deterministic and also works without a question (answer-bearing selection only)", () => {
    const first = buildGroundedResearchPartialAnswer(t3Sources, "ja");
    const second = buildGroundedResearchPartialAnswer(t3Sources, "ja");
    expect(first).toBe(second);
    expect(first).toContain("参議院の定数は248人です。");
  });
});

describe("sources-display redesign: card layout (2026-11-20)", () => {
  const cardSources: OriginResearchSource[] = [
    source({
      title: "首相についての資料",
      url: "https://example.com/pm",
      domain: "example.com",
      excerpt: "現在の首相は山田花子です。就任は2026年10月でした。",
      retrievedAt: "2026-11-20T01:00:00.000Z",
    }),
    source({
      title: "関連ニュース",
      url: "https://example.org/news",
      domain: "example.org",
      excerpt: "首相は本日、記者会見を開きました。",
      retrievedAt: "2026-11-20T02:00:00.000Z",
    }),
    source({
      title: "解説ページ",
      url: "https://example.net/explain",
      domain: "example.net",
      excerpt: "首相の経歴を解説します。",
      retrievedAt: "2026-11-19T02:00:00.000Z",
    }),
    source({
      title: "第四の出典",
      url: "https://example.info/fourth",
      domain: "example.info",
      excerpt: "首相に関する補足です。",
      retrievedAt: "2026-11-20T03:00:00.000Z",
    }),
  ];

  it("renders one card per source with domain heading and linked title, quotes only on the top three", () => {
    const text = buildGroundedResearchPartialAnswer(cardSources, "ja", "現在の首相は誰ですか？");
    expect(text).toContain("### S1 · example.com");
    expect(text).toContain("[首相についての資料](https://example.com/pm)");
    expect(text).toContain("### S4 · example.info");
    expect(text).toContain("[第四の出典](https://example.info/fourth)");
    // The fourth card carries no quote (quotes stay bounded to the
    // top three, as before the redesign).
    const s4Block = text.split("### S4")[1];
    expect(s4Block).not.toContain("『");
    expect(text).not.toContain("と示されています");
  });

  it("collects the retrieval dates into a single line, each distinct date once", () => {
    const text = buildGroundedResearchPartialAnswer(cardSources, "ja", "現在の首相は誰ですか？");
    expect(text.match(/取得日/g)).toHaveLength(1);
    expect(text).toContain("取得日：2026年11月20日、2026年11月19日");
  });

  it("drops site-chrome sentences from the quote instead of quoting the page furniture", () => {
    // The shape seen in production: the packet selects the page's
    // header run because it contains the question's keyword (首相).
    const chrome = [source({
      title: "首相官邸ホームページ",
      url: "https://example.com/kantei",
      domain: "example.com",
      excerpt:
        "首相官邸 サイトマップ お問い合わせ 新規ウィンドウが開きます メニュー ホーム 検索 English 中文 首相の動きはこちらです。首相は本日、外国を訪問しました。",
    })];
    const text = buildGroundedResearchPartialAnswer(chrome, "ja", "首相は今日何をしましたか？");
    expect(text).not.toContain("サイトマップ");
    expect(text).not.toContain("新規ウィンドウ");
    expect(text).toContain("首相は本日、外国を訪問しました。");
  });

  it("shows no quote when the whole quote is site chrome", () => {
    const chromeOnly = [source({
      title: "案内ページ",
      url: "https://example.com/nav",
      domain: "example.com",
      excerpt: "定員 サイトマップ お問い合わせ メニュー ログイン 会員登録 トップページ 検索 ヘルプ",
    })];
    const text = buildGroundedResearchPartialAnswer(chromeOnly, "ja", "定員は何人ですか？");
    expect(text).toContain("[案内ページ](https://example.com/nav)");
    expect(text).not.toContain("『");
  });

  it("ends a long quote at a sentence boundary inside the bound when one is available", () => {
    const sentence = "定員は248人です。";
    const long = [source({
      title: "長い資料",
      url: "https://example.com/long2",
      excerpt: sentence.repeat(30),
    })];
    const text = buildGroundedResearchPartialAnswer(long, "ja", "定員は何人ですか？");
    const quote = text.match(/『([^』]*)』/)?.[1] ?? "";
    expect(quote.length).toBeLessThanOrEqual(120);
    expect(quote.endsWith("。")).toBe(true);
    expect(quote).not.toContain("…");
  });

  it("mirrors the card layout in English", () => {
    const text = buildGroundedResearchPartialAnswer(cardSources, "en", "Who is the current prime minister?");
    expect(text).toContain("## What could be confirmed");
    expect(text).toContain("Retrieved: 2026-11-20, 2026-11-19");
    expect(text).toContain("### S1 · example.com");
    expect(text).toContain("[首相についての資料](https://example.com/pm)");
    expect(text).not.toContain("## Sources");
    expect(text).not.toContain("is titled");
  });
});

describe("PR-2 recovery packet partial-answer regression (round 5)", () => {
  it("quotes the 1.25% fact whole (F-03): the old splitter cut it into fragments", () => {
    // Round 5, F-03: the source body stated the September hike to
    // 1.25%, but the N-2b claim splitter cut "1.25%" into "1." and
    // "25%…", so the partial answer never quoted the current rate.
    const sources = [source({
      title: "日銀の金融政策について",
      url: "https://example.com/boj",
      domain: "example.com",
      excerpt:
        "2026年6月には1.0％へ引き上げていた。日本銀行は2026年9月に政策金利を1.00％から1.25％へ引き上げた。",
    })];
    const text = buildGroundedResearchPartialAnswer(
      sources, "ja", "現在の日本の政策金利は何％ですか？",
    );
    expect(text).toContain("1.25％");
    expect(text).not.toContain("1. 25％");
    expect(text).not.toContain("1. 0％");
    expect(text).toContain("2026年9月に政策金利を1.00％から1.25％へ引き上げた。");
  });

  it("quotes both validity periods (E-02): 5 years and 10 years", () => {
    const sources = [source({
      title: "パスポートの有効期間について",
      url: "https://example.com/passport",
      domain: "example.com",
      excerpt:
        "パスポートの申請方法はこちらです。パスポートの有効期間は、18歳以上の方は10年間、18歳未満の方は5年間です。",
    })];
    const text = buildGroundedResearchPartialAnswer(
      sources, "ja", "パスポートの有効期間は何年ですか？",
    );
    expect(text).toContain("10年間");
    expect(text).toContain("5年間");
  });
});
