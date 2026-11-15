import { describe, expect, it } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import {
  buildGroundedResearchRecordsPacket,
  checkGroundedResearchRenderedAnswer,
  evaluateGroundedResearchRecords,
  renderGroundedResearchRecordsAnswer,
  renderGroundedResearchRecomposedAnswer,
  type GroundedResearchAcceptedRecord,
  type GroundedResearchRecordsPacket,
} from "./groundedResearchRecordsV13";

// R-PR-9e (RPR9_DESIGN_2026-11-15 R9-E): the semantic duplicate layer
// of the rendering-stage claim dedup. The merge fixtures are the
// paraphrase pairs actually observed in the R-PR-8 measurement
// (A-02: resignation notice; B-01: tax-filing period, results files
// results-20261115-164232.json); the keep fixtures pin the false-kill
// guards — numeric substitution, one-sided numerics, identical dates
// on a different fact, and negation asymmetry. All names/values are
// fixture data.

function makeSource(overrides: Partial<OriginResearchSource> = {}): OriginResearchSource {
  return {
    title: "Source title",
    url: "https://example.com/article",
    excerpt: "これは十分な長さの最初の文です。次も十分な長さの文です。",
    sourceType: "web-search",
    domain: "example.com",
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-15T10:00:00.000Z",
    freshness: "recent",
    sourceAuthority: "unclassified",
    ...overrides,
  };
}

function packetOf(excerpt1: string, excerpt2: string): GroundedResearchRecordsPacket {
  return buildGroundedResearchRecordsPacket([
    makeSource({
      title: "出典1",
      url: "https://s1.example.jp/a",
      domain: "s1.example.jp",
      excerpt: excerpt1,
    }),
    makeSource({
      title: "出典2",
      url: "https://s2.example.jp/b",
      domain: "s2.example.jp",
      excerpt: excerpt2,
    }),
  ]);
}

function renderPair(
  excerpt1: string,
  excerpt2: string,
  quote1: string,
  quote2: string,
  text1: string = quote1,
  text2: string = quote2,
): { packet: GroundedResearchRecordsPacket; accepted: GroundedResearchAcceptedRecord[]; rendered: string } {
  const packet = packetOf(excerpt1, excerpt2);
  const evaluation = evaluateGroundedResearchRecords(
    JSON.stringify({
      records: [
        { evidence: ["E1_1"], quote: quote1, text: text1 },
        { evidence: ["E2_1"], quote: quote2, text: text2 },
      ],
    }),
    packet,
  );
  expect(evaluation.accepted).toHaveLength(2);
  return {
    packet,
    accepted: evaluation.accepted,
    rendered: renderGroundedResearchRecordsAnswer(evaluation.accepted, packet, "ja"),
  };
}

function bodyBullets(rendered: string): string[] {
  const listStart = rendered.indexOf("\n## 出典");
  const body = listStart >= 0 ? rendered.slice(0, listStart) : rendered;
  return body.split("\n").filter((line) => line.startsWith("- "));
}

const A02_QUOTE_1 = "法律上は退職の申し出を2週間前までにする必要があります。";
const A02_QUOTE_2 = "法律上は退職の申し出を2週間前までにすればよいとされています。";
const A02_EXCERPT_1 = `${A02_QUOTE_1}退職の手続きは就業規則にも定められています。`;
const A02_EXCERPT_2 = `${A02_QUOTE_2}民法627条がその根拠とされています。`;

const B01_QUOTE_1 = "所得税の確定申告期間は2027年（令和9年）2月16日（火）から3月15日（月）です。";
const B01_QUOTE_2 = "所得税の確定申告期間は2027年2月16日（火）から3月15日（月）です。";
const B01_EXCERPT_1 = `${B01_QUOTE_1}申告はe-Taxでも行うことができます。`;
const B01_EXCERPT_2 = `${B01_QUOTE_2}還付申告は1月から受け付けています。`;

describe("semantic claim dedup — paraphrase pairs merge (R-PR-9e)", () => {
  it("merges the A-02 paraphrase pair into one bullet with both citations", () => {
    const { packet, accepted, rendered } = renderPair(A02_EXCERPT_1, A02_EXCERPT_2, A02_QUOTE_1, A02_QUOTE_2);
    const bullets = bodyBullets(rendered);
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toContain(A02_QUOTE_1.replace(/。$/u, ""));
    expect(bullets[0]).toContain("[S1](https://s1.example.jp/a)");
    expect(bullets[0]).toContain("[S2](https://s2.example.jp/b)");
    // Rendering stays deterministic and passes the post-render check.
    expect(renderGroundedResearchRecordsAnswer(accepted, packet, "ja")).toBe(rendered);
    expect(checkGroundedResearchRenderedAnswer(rendered, packet, accepted)).toEqual({ ok: true });
  });

  it("merges the B-01 paraphrase pair (era-year insertion) into one bullet with both citations", () => {
    const { packet, accepted, rendered } = renderPair(B01_EXCERPT_1, B01_EXCERPT_2, B01_QUOTE_1, B01_QUOTE_2);
    const bullets = bodyBullets(rendered);
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toContain("[S1](https://s1.example.jp/a)");
    expect(bullets[0]).toContain("[S2](https://s2.example.jp/b)");
    expect(checkGroundedResearchRenderedAnswer(rendered, packet, accepted)).toEqual({ ok: true });
  });

  it("applies through the recomposition renderer, which shares this dedup path (R-PR-9d)", () => {
    const packet = packetOf(A02_EXCERPT_1, A02_EXCERPT_2);
    const material: GroundedResearchAcceptedRecord[] = [
      { sourceId: "S1", sourceIndex: 0, evidenceIds: ["E1_1"], quote: A02_QUOTE_1, text: A02_QUOTE_1, quoteStart: 0 },
      { sourceId: "S2", sourceIndex: 1, evidenceIds: ["E2_1"], quote: A02_QUOTE_2, text: A02_QUOTE_2, quoteStart: 0 },
    ];
    const rendered = renderGroundedResearchRecomposedAnswer(material, packet, "ja");
    const bullets = bodyBullets(rendered);
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toContain("[S1](https://s1.example.jp/a)");
    expect(bullets[0]).toContain("[S2](https://s2.example.jp/b)");
  });
});

describe("semantic claim dedup — distinct facts are never merged (R-PR-9e guards)", () => {
  it("keeps both bullets when a numeric value is substituted (10% vs 8%)", () => {
    const { rendered } = renderPair(
      "消費税率は10%です。軽減税率の対象品目も定められています。",
      "消費税率は8%です。食品などの軽減税率の説明が続きます。",
      "消費税率は10%です。",
      "消費税率は8%です。",
    );
    expect(bodyBullets(rendered)).toHaveLength(2);
  });

  it("keeps both bullets for different frames of the same scheme (240万円 vs 120万円)", () => {
    const { rendered } = renderPair(
      "新NISAの成長投資枠の年間上限は240万円です。成長投資枠では株式にも投資できます。",
      "新NISAのつみたて投資枠の年間上限は120万円です。つみたて投資枠は投資信託が対象です。",
      "新NISAの成長投資枠の年間上限は240万円です。",
      "新NISAのつみたて投資枠の年間上限は120万円です。",
    );
    expect(bodyBullets(rendered)).toHaveLength(2);
  });

  it("keeps both bullets when only one claim carries the number (refinement)", () => {
    const { rendered } = renderPair(
      "金利は据え置かれました。記者会見で総裁が説明しました。",
      "金利は0.5%に据え置かれました。市場の予想どおりの結果でした。",
      "金利は据え置かれました。",
      "金利は0.5%に据え置かれました。",
    );
    expect(bodyBullets(rendered)).toHaveLength(2);
  });

  it("keeps both bullets for a different fact that happens to share the same dates", () => {
    const { rendered } = renderPair(
      "所得税の確定申告の期間は2月16日から3月15日です。期間を過ぎると延滞税がかかります。",
      "住民税の申告期間は2月16日から3月15日です。申告は市区町村の窓口で受け付けます。",
      "所得税の確定申告の期間は2月16日から3月15日です。",
      "住民税の申告期間は2月16日から3月15日です。",
    );
    expect(bodyBullets(rendered)).toHaveLength(2);
  });

  it("keeps both bullets when one claim negates the other (contradiction stays visible)", () => {
    const { rendered } = renderPair(
      "この制度は会社員も対象です。申請はオンラインで完結します。",
      "この制度は会社員は対象ではありません。自営業者が対象の制度です。",
      "この制度は会社員も対象です。",
      "この制度は会社員は対象ではありません。",
    );
    expect(bodyBullets(rendered)).toHaveLength(2);
  });
});
