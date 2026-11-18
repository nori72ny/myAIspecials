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
    const s1Line = text.split("\n").find((line) => line.startsWith("- S1"));
    // The answer-bearing sentence is quoted inside the attribution…
    expect(s1Line).toContain("参議院の定数は248人です。");
    // …and the unselected trailing sentence no longer rides along the
    // way the head-of-excerpt quote carried it.
    expect(text).not.toContain("関連リンク集");
    expect(text).toContain("## 確認できた範囲");
    expect(text).toContain("## 出典");
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
    expect(text).not.toContain("案内ページ");
    expect(text).not.toContain("example.org/x");
    expect(text).not.toContain("](");
    expect(text).toContain("定員は248人です。");
  });

  it("still bounds the claim quote at 240 characters", () => {
    // PR-2: the bound now applies to the packet quote. The long
    // sentence must carry a question key to be selected at all — a
    // long non-answering sentence is dropped by the packet instead of
    // being quoted — so the key and the number ride inside it.
    const long = [source({
      title: "長い資料",
      url: "https://example.com/long",
      excerpt: `${"あ".repeat(300)}定員は248人です。`,
    })];
    const text = buildGroundedResearchPartialAnswer(long, "ja", "定員は何人ですか？");
    expect(text).toContain(`『${"あ".repeat(240)}』`);
    expect(text).not.toContain("あ".repeat(241));
  });

  it("keeps the title-only attribution when a source has no quotable excerpt", () => {
    const bare = [source({ title: "抜粋なし資料", url: "https://example.com/bare", excerpt: "" })];
    const text = buildGroundedResearchPartialAnswer(bare, "ja", "定員は何人ですか？");
    expect(text).toContain("- S1（example.com）では『抜粋なし資料』と示されています。（取得日: 2026年11月14日）");
  });

  it("is deterministic and also works without a question (answer-bearing selection only)", () => {
    const first = buildGroundedResearchPartialAnswer(t3Sources, "ja");
    const second = buildGroundedResearchPartialAnswer(t3Sources, "ja");
    expect(first).toBe(second);
    expect(first).toContain("参議院の定数は248人です。");
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
