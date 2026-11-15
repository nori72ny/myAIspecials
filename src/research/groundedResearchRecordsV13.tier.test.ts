import { describe, expect, it, vi } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import type {
  OriginProviderExecutionRequest,
  OriginProviderExecutionResult,
} from "../legacy/originProviderClient";
import { GROUNDED_RESEARCH_FACT_SLOT_ENTRIES } from "./groundedResearchFactSlotsV13";
import {
  assessGroundedResearchSlotValueTier,
  buildGroundedResearchFactSlotInstruction,
  buildGroundedResearchRecordsInstruction,
  buildGroundedResearchRecordsPacket,
  buildGroundedResearchSelectionInstruction,
  evaluateGroundedResearchFactSlot,
  evaluateGroundedResearchSelection,
  executeGroundedResearchRecordsSynthesis,
  formatGroundedResearchRecordsPacket,
  type GroundedResearchRecordsPacket,
} from "./groundedResearchRecordsV13";

// R-PR-8c (RPR8_DESIGN_2026-11-15 §8c): the search layer's source
// authority tier reaches the records packet through the grounding
// adapter, and tier + published-date freshness become decision
// material in the selection layer's cleanup and in the slot layer's
// agreement evaluation. The F-01 shape from the R-PR-7 measurement
// drives the fixtures: an official source states the current holder,
// a stale low-tier Q&A source states the former holder as its
// answer. All names, prices, and domains are fixture data.

function makeSource(overrides: Partial<OriginResearchSource> = {}): OriginResearchSource {
  return {
    title: "Source title",
    url: "https://example.com/article",
    excerpt: "これは十分な長さの最初の文です。次も十分な長さの文です。",
    sourceType: "web-search",
    domain: "example.com",
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-14T10:00:00.000Z",
    freshness: "recent",
    sourceAuthority: "unclassified",
    ...overrides,
  };
}

const PM_ENTRY = GROUNDED_RESEARCH_FACT_SLOT_ENTRIES.find((entry) => entry.id === "incumbent-prime-minister-jp")!;
const PRICE_ENTRY = GROUNDED_RESEARCH_FACT_SLOT_ENTRIES.find((entry) => entry.id === "product-price")!;
const PM_QUERY = "現在の内閣総理大臣は誰ですか？";

const PM_ASSERT_TAKAICHI = "高市早苗は、第105代内閣総理大臣に指名された。";
const PM_NEUTRAL = "内閣総理大臣は、国会の議決により指名される。";
const PM_ASSERT_ISHIBA = "石破茂は、第102代内閣総理大臣に指名された。";
const PM_MENTION_ISHIBA = "石破茂首相の在任中には、物価高対策が議論された。";

/** The F-01 packet: official states the incumbent, a stale general-tier Q&A states the former holder, a general blog merely mentions the former holder. */
function f01Sources(): OriginResearchSource[] {
  return [
    makeSource({
      title: "内閣総理大臣の指名について",
      url: "https://www.kantei.example.go.jp/souri/",
      domain: "kantei.example.go.jp",
      authorityTier: "official",
      revisionTimestamp: "2026-11-10T00:00:00.000Z",
      excerpt: `${PM_ASSERT_TAKAICHI}${PM_NEUTRAL}`,
    }),
    makeSource({
      title: "Q&A: 現在の総理大臣は？",
      url: "https://qa.example/ask",
      domain: "qa.example",
      authorityTier: "general",
      revisionTimestamp: "2024-12-01T00:00:00.000Z",
      excerpt: PM_ASSERT_ISHIBA,
    }),
    makeSource({
      title: "政局ブログ",
      url: "https://blog.example/seiji",
      domain: "blog.example",
      authorityTier: "general",
      revisionTimestamp: "2026-11-05T00:00:00.000Z",
      excerpt: PM_MENTION_ISHIBA,
    }),
  ];
}

describe("tier wiring into the packet (R-PR-8c)", () => {
  it("carries the source's authority tier, and null when the source has none", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({ authorityTier: "official" }),
      makeSource({ url: "https://other.example.org/x", domain: "other.example.org" }),
    ]);
    expect(packet.sources[0]?.authorityTier).toBe("official");
    expect(packet.sources[1]?.authorityTier).toBeNull();
  });

  it("renders the tier as packet metadata alongside sourceAuthority", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({ authorityTier: "official" }),
      makeSource({ url: "https://other.example.org/x", domain: "other.example.org" }),
    ]);
    const rendered = formatGroundedResearchRecordsPacket(packet);
    expect(rendered).toContain("authorityTier_json: \"official\"");
    expect(rendered).toContain("authorityTier_json: null");
  });

  it("never opposes a value when every packet tier is unknown", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({ excerpt: PM_ASSERT_TAKAICHI }),
      makeSource({
        url: "https://qa.example/ask",
        domain: "qa.example",
        excerpt: PM_ASSERT_ISHIBA,
      }),
    ]);
    const assessment = assessGroundedResearchSlotValueTier(packet, "person-name", "石破茂");
    expect(assessment.tierOpposed).toBe(false);
  });
});

describe("selection tier/freshness gate (R-PR-8c, design §8c)", () => {
  it("drops the stale Q&A unit that a higher-tier source contradicts (F-01 shape)", () => {
    const packet: GroundedResearchRecordsPacket = buildGroundedResearchRecordsPacket([
      ...f01Sources(),
      makeSource({
        title: "首相ニュース",
        url: "https://news.example.co.jp/pm",
        domain: "news.example.co.jp",
        authorityTier: "major-news",
        revisionTimestamp: "2026-11-12T00:00:00.000Z",
        excerpt: "内閣総理大臣は高市早苗氏である。高市氏は自由民主党の総裁を務めている。",
      }),
    ]);
    // The model borrows coverage from the official and news sources
    // while asserting the stale answer from the Q&A excerpt.
    const evaluation = evaluateGroundedResearchSelection(
      "{\"select\":[\"E2_1\",\"E1_1\",\"E4_2\"]}",
      packet,
    );
    expect(evaluation.tierDroppedIdCount).toBe(1);
    expect(evaluation.selectedUnits.map((unit) => unit.id)).toEqual(["E1_1", "E4_2"]);
    expect(evaluation.citedSourceCount).toBe(2);
    expect(evaluation.adopted).toBe(true);
  });

  it("is inert when no packet source carries a tier (unknown is neutral)", () => {
    const packet = buildGroundedResearchRecordsPacket(
      f01Sources().map((source) => ({ ...source, authorityTier: undefined })),
    );
    const evaluation = evaluateGroundedResearchSelection(
      "{\"select\":[\"E2_1\",\"E1_1\",\"E3_1\"]}",
      packet,
    );
    expect(evaluation.tierDroppedIdCount).toBe(0);
    expect(evaluation.selectedUnits.map((unit) => unit.id)).toEqual(["E2_1", "E1_1", "E3_1"]);
    expect(evaluation.adopted).toBe(true);
  });

  it("keeps both sides when the contradicting sources are equals (same tier, no dates)", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({ authorityTier: "general", excerpt: PM_ASSERT_TAKAICHI }),
      makeSource({
        url: "https://qa.example/ask",
        domain: "qa.example",
        authorityTier: "general",
        excerpt: PM_ASSERT_ISHIBA,
      }),
    ]);
    const evaluation = evaluateGroundedResearchSelection(
      "{\"select\":[\"E1_1\",\"E2_1\"]}",
      packet,
    );
    expect(evaluation.tierDroppedIdCount).toBe(0);
    expect(evaluation.selectedUnits).toHaveLength(2);
    expect(evaluation.adopted).toBe(true);
  });

  it("drops the older unit when an equal-tier but newer source contradicts it", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({
        authorityTier: "general",
        revisionTimestamp: "2023-04-01T00:00:00.000Z",
        excerpt: PM_ASSERT_ISHIBA,
      }),
      makeSource({
        url: "https://news.example.co.jp/pm",
        domain: "news.example.co.jp",
        authorityTier: "general",
        revisionTimestamp: "2026-11-01T00:00:00.000Z",
        excerpt: PM_ASSERT_TAKAICHI,
      }),
      makeSource({
        url: "https://diet.example/x",
        domain: "diet.example",
        authorityTier: "general",
        revisionTimestamp: "2026-11-02T00:00:00.000Z",
        excerpt: PM_NEUTRAL,
      }),
    ]);
    const evaluation = evaluateGroundedResearchSelection(
      "{\"select\":[\"E1_1\",\"E2_1\",\"E3_1\"]}",
      packet,
    );
    expect(evaluation.tierDroppedIdCount).toBe(1);
    expect(evaluation.selectedUnits.map((unit) => unit.id)).toEqual(["E2_1", "E3_1"]);
    expect(evaluation.adopted).toBe(true);
  });

  it("keeps a tier-opposed unit when two sources state its value (stated agreement)", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({
        title: "内閣総理大臣の指名について",
        url: "https://www.kantei.example.go.jp/souri/",
        domain: "kantei.example.go.jp",
        authorityTier: "official",
        revisionTimestamp: "2026-11-10T00:00:00.000Z",
        excerpt: PM_ASSERT_TAKAICHI,
      }),
      makeSource({
        url: "https://qa.example/ask",
        domain: "qa.example",
        authorityTier: "general",
        revisionTimestamp: "2024-12-01T00:00:00.000Z",
        excerpt: PM_ASSERT_ISHIBA,
      }),
      makeSource({
        url: "https://blog.example/seiji",
        domain: "blog.example",
        authorityTier: "general",
        revisionTimestamp: "2024-12-02T00:00:00.000Z",
        excerpt: "内閣総理大臣は石破茂氏である。",
      }),
    ]);
    const evaluation = evaluateGroundedResearchSelection(
      "{\"select\":[\"E2_1\",\"E1_1\"]}",
      packet,
    );
    expect(evaluation.tierDroppedIdCount).toBe(0);
    expect(evaluation.selectedUnits.map((unit) => unit.id)).toEqual(["E2_1", "E1_1"]);
    expect(evaluation.adopted).toBe(true);
  });
});

describe("slot tier-weighted agreement (R-PR-8c, design §8c)", () => {
  it("judges the stale candidate's agreement insufficient against official opposition (F-01 shape)", () => {
    const packet = buildGroundedResearchRecordsPacket(f01Sources());
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ answer: "石破茂", src: "S2", quote: PM_ASSERT_ISHIBA }),
      packet,
      PM_ENTRY,
    );
    // Verbatim agreement exists (the blog mentions the former holder),
    // but only one source STATES the stale answer, and the official
    // source states a different one: the tier rule decides here, so
    // the code is the agreement code, not the flat conflict code.
    expect(evaluation.agreementSourceCount).toBe(2);
    expect(evaluation.code).toBe("SLOT_INSUFFICIENT_AGREEMENT");
    expect(evaluation.conflictDetected).toBe(false);
  });

  it("adopts the incumbent the official source states, in a tiered packet", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({
        title: "内閣総理大臣の指名について",
        url: "https://www.kantei.example.go.jp/souri/",
        domain: "kantei.example.go.jp",
        authorityTier: "official",
        revisionTimestamp: "2026-11-10T00:00:00.000Z",
        excerpt: `${PM_ASSERT_TAKAICHI}${PM_NEUTRAL}`,
      }),
      makeSource({
        title: "首相ニュース",
        url: "https://news.example.co.jp/pm",
        domain: "news.example.co.jp",
        authorityTier: "major-news",
        revisionTimestamp: "2026-11-12T00:00:00.000Z",
        excerpt: "内閣総理大臣は高市早苗氏である。",
      }),
      makeSource({
        title: "Q&A: 歴代の総理大臣",
        url: "https://qa.example/ask",
        domain: "qa.example",
        authorityTier: "general",
        revisionTimestamp: "2024-12-01T00:00:00.000Z",
        excerpt: PM_MENTION_ISHIBA,
      }),
    ]);
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ answer: "高市早苗", src: "S1", quote: PM_ASSERT_TAKAICHI }),
      packet,
      PM_ENTRY,
    );
    expect(evaluation.code).toBeNull();
    expect(evaluation.agreementSourceCount).toBe(2);
  });

  it("keeps the flat stated-answer conflict among equal tiers (R-PR-8b unchanged)", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({ authorityTier: "general", excerpt: PM_ASSERT_TAKAICHI }),
      makeSource({
        url: "https://news.example.co.jp/pm",
        domain: "news.example.co.jp",
        authorityTier: "general",
        excerpt: "内閣総理大臣は高市早苗氏である。",
      }),
      makeSource({
        url: "https://qa.example/ask",
        domain: "qa.example",
        authorityTier: "general",
        excerpt: PM_ASSERT_ISHIBA,
      }),
    ]);
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ answer: "高市早苗", src: "S1", quote: PM_ASSERT_TAKAICHI }),
      packet,
      PM_ENTRY,
    );
    expect(evaluation.code).toBe("SLOT_SOURCE_CONFLICT");
    expect(evaluation.conflictDetected).toBe(true);
  });

  it("judges a stale price insufficient against the official store's stated price", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({
        title: "iPhone 18 - Apple Store",
        url: "https://www.apple.com/jp/shop/iphone18",
        domain: "apple.com",
        authorityTier: "official",
        revisionTimestamp: "2026-11-01T00:00:00.000Z",
        excerpt: "iPhone 18の価格は124,800円です。",
      }),
      makeSource({
        title: "iPhone 18 価格ブログ",
        url: "https://blog.example/iphone18",
        domain: "blog.example",
        authorityTier: "general",
        revisionTimestamp: "2026-08-01T00:00:00.000Z",
        excerpt: "iPhone 18は119,800円で販売されています。",
      }),
      makeSource({
        title: "価格比較まとめ",
        url: "https://price.example/iphone",
        domain: "price.example",
        authorityTier: "general",
        excerpt: "iPhone 18は119,800円、iPhone 18 Proは139,800円です。",
      }),
    ]);
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ answer: "119,800円", src: "S2", quote: "iPhone 18は119,800円で販売されています。" }),
      packet,
      PRICE_ENTRY,
    );
    // The comparison page makes the stale price verbatim-agree (2
    // sources), but it states no single price of its own; only the
    // blog states the stale price, and the official store states a
    // different one — the tier rule judges the agreement
    // insufficient.
    expect(evaluation.agreementSourceCount).toBe(2);
    expect(evaluation.code).toBe("SLOT_INSUFFICIENT_AGREEMENT");
  });

  it("adopts the price the official store states", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({
        title: "iPhone 18 - Apple Store",
        url: "https://www.apple.com/jp/shop/iphone18",
        domain: "apple.com",
        authorityTier: "official",
        revisionTimestamp: "2026-11-01T00:00:00.000Z",
        excerpt: "iPhone 18の価格は124,800円です。",
      }),
      makeSource({
        title: "iPhone 18 発表詳報",
        url: "https://impress.example/iphone18",
        domain: "impress.example",
        authorityTier: "specialist",
        revisionTimestamp: "2026-11-01T00:00:00.000Z",
        excerpt: "iPhone 18の価格は124,800円と発表されました。",
      }),
      makeSource({
        title: "価格比較まとめ",
        url: "https://price.example/iphone",
        domain: "price.example",
        authorityTier: "general",
        excerpt: "iPhone 18は119,800円、iPhone 18 Proは139,800円です。",
      }),
    ]);
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ answer: "124,800円", src: "S1", quote: "iPhone 18の価格は124,800円です。" }),
      packet,
      PRICE_ENTRY,
    );
    expect(evaluation.code).toBeNull();
    expect(evaluation.agreementSourceCount).toBe(2);
  });
});

// --- Helper integration: the F-01 shape end to end ---------------------------

const fakePlan = { providerId: "openrouter", modelId: "google/gemma-4-31b-it:free" } as unknown as OriginProviderExecutionRequest["plan"];

function executionResult(text: string, durationMs: number): OriginProviderExecutionResult {
  return {
    text,
    transportRequestCount: 1,
    actualCostUsd: 0,
    providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
    routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary", provider: "OpenRouter", attempt: 1, fallbackUsed: false },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 },
    attempts: [{ providerId: "openrouter", modelId: "google/gemma-4-31b-it:free", outcome: "succeeded", durationMs }],
  } as OriginProviderExecutionResult;
}

const SLOT_INSTRUCTION_JA = buildGroundedResearchFactSlotInstruction(PM_ENTRY, "ja");
const RECORDS_INSTRUCTION_JA = buildGroundedResearchRecordsInstruction("ja");
const SELECTION_INSTRUCTION_JA = buildGroundedResearchSelectionInstruction("ja");

describe("helper: F-01 shape end to end (R-PR-8c)", () => {
  it("falls through the slot on the stale candidate and adopts records grounded in the official source", async () => {
    const slotJson = JSON.stringify({ answer: "石破茂", src: "S2", quote: PM_ASSERT_ISHIBA });
    const recordsJson = JSON.stringify({
      records: [
        { evidence: ["E1_1"], quote: PM_ASSERT_TAKAICHI, text: "現在の内閣総理大臣は高市早苗です。" },
        { evidence: ["E3_1"], quote: PM_MENTION_ISHIBA, text: "石破茂氏が首相だった時期には、物価高対策が議論されました。" },
      ],
    });
    const execute = vi.fn(async (request: OriginProviderExecutionRequest) => {
      if (request.systemInstruction === SLOT_INSTRUCTION_JA) return executionResult(slotJson, 100);
      if (request.systemInstruction === RECORDS_INSTRUCTION_JA) return executionResult(recordsJson, 200);
      if (request.systemInstruction === SELECTION_INSTRUCTION_JA) throw new Error("selection must not fire");
      throw new Error("unexpected instruction");
    });
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, {
      plan: fakePlan,
      query: PM_QUERY,
      sources: f01Sources(),
      language: "ja",
      enabled: true,
      assertZeroCost: () => {},
    });
    expect(outcome.adopted).toBe(true);
    expect(outcome.metrics).toMatchObject({
      slotAttempted: true,
      slotCode: "SLOT_INSUFFICIENT_AGREEMENT",
      finalForm: "records",
    });
    expect(outcome.text).toContain("現在の内閣総理大臣は高市早苗です。");
    expect(outcome.text).not.toContain(PM_ASSERT_ISHIBA);
  });
});
