import { describe, expect, it, vi } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import type {
  OriginProviderExecutionRequest,
  OriginProviderExecutionResult,
} from "../legacy/originProviderClient";
import {
  checkGroundedResearchFactSlotAnswerShape,
  matchGroundedResearchFactSlotEntry,
  parseGroundedResearchFactSlotOutput,
  GROUNDED_RESEARCH_FACT_SLOT_ENTRIES,
} from "./groundedResearchFactSlotsV13";
import {
  buildGroundedResearchFactSlotInstruction,
  buildGroundedResearchFactSlotPrompt,
  buildGroundedResearchRecordsInstruction,
  buildGroundedResearchRecordsPacket,
  buildGroundedResearchSelectionInstruction,
  evaluateGroundedResearchFactSlot,
  executeGroundedResearchRecordsSynthesis,
  renderGroundedResearchFactSlotAnswer,
  renderGroundedResearchFactSlotSentence,
  type GroundedResearchRecordsPacket,
} from "./groundedResearchRecordsV13";

// R-PR-6 (design §9, §11, §12): the single-fact slot layer at the
// head of the records path. Type entries live in
// groundedResearchFactSlotsV13.ts (the registry-side interface of
// §9.1, kept on the records side until a fact registry exists).
// Fixtures reuse the prime-minister / product-price shapes of the
// R-PR-2..5 tests; all names and prices are fixture data.

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

const PM_UNIT_1 = "高市早苗は、第105代内閣総理大臣に指名された。";
const PM_UNIT_2 = "内閣総理大臣は、国会の議決により指名される。";
const PM2_UNIT_1 = "2026年11月現在、内閣総理大臣は高市早苗氏である。";
const PM2_UNIT_2 = "高市氏は自由民主党の総裁を務めている。";
const PM_QUERY = "現在の内閣総理大臣は誰ですか？";

function pmSources(): OriginResearchSource[] {
  return [
    makeSource({
      title: "内閣総理大臣の指名について",
      url: "https://www.kantei.example.go.jp/souri/",
      domain: "kantei.example.go.jp",
      excerpt: `${PM_UNIT_1}${PM_UNIT_2}`,
    }),
    makeSource({
      title: "首相ニュース",
      url: "https://news.example.co.jp/pm",
      domain: "news.example.co.jp",
      excerpt: `${PM2_UNIT_1}${PM2_UNIT_2}`,
    }),
  ];
}

function pmPacket(): GroundedResearchRecordsPacket {
  return buildGroundedResearchRecordsPacket(pmSources());
}

const PM_SOURCE_LIST = [
  "## 出典",
  "- S1: 内閣総理大臣の指名について（kantei.example.go.jp）／公開日: 公開日不明／取得日: 2026年11月14日 [S1](https://www.kantei.example.go.jp/souri/)",
  "- S2: 首相ニュース（news.example.co.jp）／公開日: 公開日不明／取得日: 2026年11月14日 [S2](https://news.example.co.jp/pm)",
];

const PM_ENTRY = GROUNDED_RESEARCH_FACT_SLOT_ENTRIES.find((entry) => entry.id === "incumbent-prime-minister-jp")!;
const PRICE_ENTRY = GROUNDED_RESEARCH_FACT_SLOT_ENTRIES.find((entry) => entry.id === "product-price")!;

const PRICE_UNIT_1 = "iPhone 18 Proは219,800円で、2026年9月18日に発売されます。";
const PRICE_UNIT_2 = "iPhone 18 Proの価格は219,800円と報じられています。";
const PRICE_QUERY = "iPhone 18 Pro の価格を教えてください";

function priceSources(): OriginResearchSource[] {
  return [
    makeSource({
      title: "iPhone 18 Pro 発表",
      url: "https://www.apple.com/jp/newsroom/iphone18",
      domain: "apple.com",
      excerpt: PRICE_UNIT_1,
      retrievedAt: "2026-11-07T00:00:00.000Z",
      revisionTimestamp: "2026-09-10T00:00:00.000Z",
    }),
    makeSource({
      title: "iPhone価格まとめ",
      url: "https://example.jp/iphone",
      domain: "example.jp",
      excerpt: PRICE_UNIT_2,
      retrievedAt: "2026-11-07T00:00:00.000Z",
    }),
  ];
}

describe("matchGroundedResearchFactSlotEntry (design §9.1, narrow matching)", () => {
  it("matches the incumbent questions for the prime-minister entry", () => {
    expect(matchGroundedResearchFactSlotEntry(PM_QUERY)?.id).toBe("incumbent-prime-minister-jp");
    expect(matchGroundedResearchFactSlotEntry("日本の総理大臣は誰ですか")?.id).toBe("incumbent-prime-minister-jp");
    expect(matchGroundedResearchFactSlotEntry("今の首相はどなたですか？")?.id).toBe("incumbent-prime-minister-jp");
    expect(matchGroundedResearchFactSlotEntry("Who is the current Prime Minister of Japan?")?.id).toBe("incumbent-prime-minister-jp");
  });

  it("does not match historical, speculative, or other-office questions", () => {
    expect(matchGroundedResearchFactSlotEntry("歴代の内閣総理大臣を教えてください")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("初代の総理大臣は誰ですか")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("2010年の総理大臣は誰でしたか")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("次の総理大臣は誰になりそうですか")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("副総理は誰ですか")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("外務大臣は誰ですか")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("総理大臣は誰が決めるのですか")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("総理大臣の年収はいくらですか")).toBeNull();
  });

  it("does not match another country's prime minister", () => {
    expect(matchGroundedResearchFactSlotEntry("イギリスの首相は誰ですか")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("フランスの首相は誰ですか")).toBeNull();
  });

  it("matches single-product price questions for the price entry", () => {
    expect(matchGroundedResearchFactSlotEntry(PRICE_QUERY)?.id).toBe("product-price");
    expect(matchGroundedResearchFactSlotEntry("Google Pixel 10 はいくらですか")?.id).toBe("product-price");
    expect(matchGroundedResearchFactSlotEntry("ピクセル 10 の値段は？")?.id).toBe("product-price");
  });

  it("does not match compound, comparative, historical, or non-product price questions", () => {
    // Price AND release date (the research-router fixture shape).
    expect(matchGroundedResearchFactSlotEntry("iPhone の最新モデルの、日本での価格と発売日を教えてください")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("iPhone 18 Pro と Pixel 10 の価格を比較してください")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("2024年のiPhoneの価格はいくらでしたか")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("iPhone 18 Pro の発売日はいつですか")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("株価はいくらですか")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("この製品の特長を調査してください")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("公開情報の要点を調査してください")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("")).toBeNull();
  });
});

describe("parseGroundedResearchFactSlotOutput (design §4.3)", () => {
  it("parses the JSON form", () => {
    const parsed = parseGroundedResearchFactSlotOutput(
      JSON.stringify({ answer: "高市早苗", src: "S1", quote: PM_UNIT_1 }),
    );
    expect(parsed.format).toBe("json");
    expect(parsed.candidate).toEqual({ answer: "高市早苗", src: "S1", quote: PM_UNIT_1 });
  });

  it("parses the SLOT text form", () => {
    const parsed = parseGroundedResearchFactSlotOutput(
      ["SLOT", "A: 高市早苗", "S: S2", `Q: ${PM2_UNIT_1}`, "END"].join("\n"),
    );
    expect(parsed.format).toBe("text");
    expect(parsed.candidate).toEqual({ answer: "高市早苗", src: "S2", quote: PM2_UNIT_1 });
  });

  it("yields no candidate for the null sentinel, a records-shaped JSON, or prose", () => {
    expect(parseGroundedResearchFactSlotOutput("{\"answer\":null,\"src\":null,\"quote\":null}").candidate).toBeNull();
    expect(parseGroundedResearchFactSlotOutput("{\"records\":[{\"evidence\":[\"E1_1\"]}]}").candidate).toBeNull();
    const prose = parseGroundedResearchFactSlotOutput("よく分かりませんでした。");
    expect(prose.format).toBeNull();
    expect(prose.candidate).toBeNull();
  });
});

describe("checkGroundedResearchFactSlotAnswerShape (design §9.2(d))", () => {
  it("person-name: no numeric token; full-width digits count too", () => {
    expect(checkGroundedResearchFactSlotAnswerShape(PM_ENTRY, "高市早苗")).toBe(true);
    expect(checkGroundedResearchFactSlotAnswerShape(PM_ENTRY, "第105代")).toBe(false);
    expect(checkGroundedResearchFactSlotAnswerShape(PM_ENTRY, "219,800円")).toBe(false);
  });

  it("price: a currency-marked numeric token is required (a bare number is not a price)", () => {
    expect(checkGroundedResearchFactSlotAnswerShape(PRICE_ENTRY, "219,800円")).toBe(true);
    expect(checkGroundedResearchFactSlotAnswerShape(PRICE_ENTRY, "２１９，８００円")).toBe(true);
    expect(checkGroundedResearchFactSlotAnswerShape(PRICE_ENTRY, "$189")).toBe(true);
    expect(checkGroundedResearchFactSlotAnswerShape(PRICE_ENTRY, "iPhone 18 Pro")).toBe(false);
    expect(checkGroundedResearchFactSlotAnswerShape(PRICE_ENTRY, "219800")).toBe(false);
  });
});

describe("buildGroundedResearchFactSlotInstruction / Prompt (design §9.2)", () => {
  it("asks for the single fact in the §4.3 JSON form, with the null sentinel", () => {
    const instruction = buildGroundedResearchFactSlotInstruction(PM_ENTRY, "ja");
    expect(instruction).toContain("現在の日本の内閣総理大臣の氏名");
    expect(instruction).toContain("{\"answer\"");
    expect(instruction).toContain("{\"answer\":null,\"src\":null,\"quote\":null}");
  });

  it("carries the same E-ID packet as the records stage, but no packet URL", () => {
    const prompt = buildGroundedResearchFactSlotPrompt(PM_QUERY, pmPacket(), PM_ENTRY, "ja");
    expect(prompt).toContain(PM_QUERY);
    expect(prompt).toContain("[E1_1] 高市早苗は、第105代内閣総理大臣に指名された。");
    expect(prompt).not.toContain("https://www.kantei.example.go.jp/souri/");
    expect(prompt).not.toContain("citation_token");
  });
});

describe("evaluateGroundedResearchFactSlot (design §9.2)", () => {
  const adoptable = JSON.stringify({ answer: "高市早苗", src: "S1", quote: PM_UNIT_1 });

  it("adopts a candidate with verbatim quote, shape, and two-source agreement", () => {
    const evaluation = evaluateGroundedResearchFactSlot(adoptable, pmPacket(), PM_ENTRY);
    expect(evaluation.code).toBeNull();
    expect(evaluation.candidate).toEqual({ answer: "高市早苗", src: "S1", quote: PM_UNIT_1 });
    expect(evaluation.source?.id).toBe("S1");
    expect(evaluation.agreementSourceCount).toBe(2);
    expect(evaluation.supportSourceIds).toEqual(["S1", "S2"]);
    expect(evaluation.conflictDetected).toBe(false);
  });

  it("(a) rejects a source id outside the packet", () => {
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ answer: "高市早苗", src: "S9", quote: PM_UNIT_1 }),
      pmPacket(),
      PM_ENTRY,
    );
    expect(evaluation.code).toBe("SLOT_SOURCE_NOT_IN_PACKET");
  });

  it("(b) rejects a quote that is not a verbatim substring of the excerpt", () => {
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ answer: "高市早苗", src: "S1", quote: "高市早苗は総理大臣です。" }),
      pmPacket(),
      PM_ENTRY,
    );
    expect(evaluation.code).toBe("SLOT_QUOTE_NOT_SUBSTRING");
  });

  it("(c) rejects an answer that does not appear verbatim in the quote", () => {
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ answer: "石破茂", src: "S1", quote: PM_UNIT_1 }),
      pmPacket(),
      PM_ENTRY,
    );
    expect(evaluation.code).toBe("SLOT_ANSWER_NOT_IN_QUOTE");
  });

  it("(d) rejects an answer that fails the type shape check", () => {
    const pmEvaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ answer: "第105代", src: "S1", quote: PM_UNIT_1 }),
      pmPacket(),
      PM_ENTRY,
    );
    expect(pmEvaluation.code).toBe("SLOT_ANSWER_SHAPE_MISMATCH");
    const priceEvaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ answer: "iPhone 18 Pro", src: "S1", quote: PRICE_UNIT_1 }),
      buildGroundedResearchRecordsPacket(priceSources()),
      PRICE_ENTRY,
    );
    expect(priceEvaluation.code).toBe("SLOT_ANSWER_SHAPE_MISMATCH");
  });

  it("falls through when only one source supports the answer (agreement)", () => {
    const packet = buildGroundedResearchRecordsPacket([
      pmSources()[0]!,
      makeSource({
        title: "首相ニュース",
        url: "https://news.example.co.jp/pm",
        domain: "news.example.co.jp",
        excerpt: "首相は国会の議決により指名されます。内閣の顔ぶれも発表されました。",
      }),
    ]);
    const evaluation = evaluateGroundedResearchFactSlot(adoptable, packet, PM_ENTRY);
    expect(evaluation.code).toBe("SLOT_INSUFFICIENT_AGREEMENT");
    expect(evaluation.agreementSourceCount).toBe(1);
  });

  it("falls through on a conflicting incumbent named by another source", () => {
    const packet = buildGroundedResearchRecordsPacket([
      pmSources()[0]!,
      makeSource({
        title: "首相ニュース",
        url: "https://news.example.co.jp/pm",
        domain: "news.example.co.jp",
        excerpt: "石破茂は、第102代内閣総理大臣に指名された。高市早苗氏は自由民主党の総裁を務めている。",
      }),
    ]);
    const evaluation = evaluateGroundedResearchFactSlot(adoptable, packet, PM_ENTRY);
    expect(evaluation.code).toBe("SLOT_SOURCE_CONFLICT");
    expect(evaluation.conflictDetected).toBe(true);
    expect(evaluation.agreementSourceCount).toBe(2);
  });

  it("adopts when another source names a different model's price alongside the same price (R-PR-8b)", () => {
    // R-PR-8b: a source that states several amounts (the asked
    // product's price among them) states no single competing answer;
    // the R-PR-6 rule conflicted on the other model's amount alone.
    const packet = buildGroundedResearchRecordsPacket([
      priceSources()[0]!,
      makeSource({
        title: "iPhone価格まとめ",
        url: "https://example.jp/iphone",
        domain: "example.jp",
        excerpt: "iPhone 18 Proの価格は219,800円。iPhone 18は169,800円で販売されている。",
        retrievedAt: "2026-11-07T00:00:00.000Z",
      }),
    ]);
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ answer: "219,800円", src: "S1", quote: PRICE_UNIT_1 }),
      packet,
      PRICE_ENTRY,
    );
    expect(evaluation.code).toBeNull();
    expect(evaluation.conflictDetected).toBe(false);
    expect(evaluation.agreementSourceCount).toBe(2);
  });

  it("falls through when a source states a single, different price as its answer (R-PR-8b)", () => {
    const packet = buildGroundedResearchRecordsPacket([
      ...priceSources(),
      makeSource({
        title: "価格改定の報道",
        url: "https://news.example.jp/iphone-price",
        domain: "news.example.jp",
        excerpt: "iPhone 18 Proの価格は199,800円に改定されたと報じられています。",
        retrievedAt: "2026-11-07T00:00:00.000Z",
      }),
    ]);
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ answer: "219,800円", src: "S1", quote: PRICE_UNIT_1 }),
      packet,
      PRICE_ENTRY,
    );
    expect(evaluation.code).toBe("SLOT_SOURCE_CONFLICT");
    expect(evaluation.conflictDetected).toBe(true);
    expect(evaluation.agreementSourceCount).toBe(2);
  });

  it("adopts the prime minister on three-source agreement when a former holder is only mentioned (R-PR-8b)", () => {
    // The production shape behind R-PR-8b: the former holder's name
    // appears in an excerpt only as a former-office reference
    // (前首相の石破茂氏) and as a title reference in running text
    // (石破茂首相の在任中) — never stated as the answer — while
    // three sources carry the incumbent's name.
    const packet = buildGroundedResearchRecordsPacket([
      ...pmSources(),
      makeSource({
        title: "政権交代の記録",
        url: "https://news.example.co.jp/seiken",
        domain: "news.example.co.jp",
        excerpt: "内閣総理大臣は高市早苗氏である。前首相の石破茂氏は退任後、講演活動を続けている。石破茂首相の在任中には、物価高対策が議論された。",
      }),
    ]);
    const evaluation = evaluateGroundedResearchFactSlot(adoptable, packet, PM_ENTRY);
    expect(evaluation.code).toBeNull();
    expect(evaluation.conflictDetected).toBe(false);
    expect(evaluation.agreementSourceCount).toBe(3);
    expect(evaluation.supportSourceIds).toEqual(["S1", "S2", "S3"]);
  });

  it("still falls through when another source identifies a different person as the prime minister (R-PR-8b)", () => {
    // Appositive identification (首相のNAME氏) IS an answer-position
    // statement, unlike a former-office reference.
    const packet = buildGroundedResearchRecordsPacket([
      pmSources()[0]!,
      makeSource({
        title: "首相ニュース",
        url: "https://news.example.co.jp/pm",
        domain: "news.example.co.jp",
        excerpt: "首相の石破茂氏は、記者会見で経済対策を説明した。高市早苗氏は自由民主党の総裁を務めている。",
      }),
    ]);
    const evaluation = evaluateGroundedResearchFactSlot(adoptable, packet, PM_ENTRY);
    expect(evaluation.code).toBe("SLOT_SOURCE_CONFLICT");
    expect(evaluation.conflictDetected).toBe(true);
    expect(evaluation.agreementSourceCount).toBe(2);
  });

  it("adopts the price candidate when both sources agree on the amount", () => {
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ answer: "219,800円", src: "S1", quote: PRICE_UNIT_1 }),
      buildGroundedResearchRecordsPacket(priceSources()),
      PRICE_ENTRY,
    );
    expect(evaluation.code).toBeNull();
    expect(evaluation.agreementSourceCount).toBe(2);
  });

  it("adopts from a single-source packet when that source supports the answer", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({
        title: "PM news",
        url: "https://news.example.com/pm",
        domain: "news.example.com",
        excerpt: "Sanae Takaichi is the Prime Minister of Japan. She leads the cabinet.",
      }),
    ]);
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ answer: "Sanae Takaichi", src: "S1", quote: "Sanae Takaichi is the Prime Minister of Japan." }),
      packet,
      PM_ENTRY,
    );
    expect(evaluation.code).toBeNull();
    expect(evaluation.agreementSourceCount).toBe(1);
  });

  it("yields SLOT_NO_CANDIDATE for prose and for the null sentinel", () => {
    expect(evaluateGroundedResearchFactSlot("よく分かりませんでした。", pmPacket(), PM_ENTRY).code).toBe("SLOT_NO_CANDIDATE");
    expect(evaluateGroundedResearchFactSlot("{\"answer\":null,\"src\":null,\"quote\":null}", pmPacket(), PM_ENTRY).code).toBe("SLOT_NO_CANDIDATE");
  });
});

describe("slot rendering (design §9.3)", () => {
  it("renders the template with the retrieved date when no published date exists", () => {
    const packet = pmPacket();
    const sentence = renderGroundedResearchFactSlotSentence(
      PM_ENTRY,
      { answer: "高市早苗", src: "S1", quote: PM_UNIT_1 },
      packet.sources[0]!,
      "ja",
    );
    expect(sentence).toBe("2026年11月14日時点で、内閣総理大臣は高市早苗です。");
  });

  it("renders the price template with the source's published date", () => {
    const packet = buildGroundedResearchRecordsPacket(priceSources());
    const sentence = renderGroundedResearchFactSlotSentence(
      PRICE_ENTRY,
      { answer: "219,800円", src: "S1", quote: PRICE_UNIT_1 },
      packet.sources[0]!,
      "ja",
    );
    expect(sentence).toBe("2026年9月10日時点の価格は219,800円です。");
  });

  it("renders the en template with the ISO date form", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({
        title: "PM news",
        url: "https://news.example.com/pm",
        domain: "news.example.com",
        excerpt: "Sanae Takaichi is the Prime Minister of Japan. She leads the cabinet.",
      }),
    ]);
    const sentence = renderGroundedResearchFactSlotSentence(
      PM_ENTRY,
      { answer: "Sanae Takaichi", src: "S1", quote: "Sanae Takaichi is the Prime Minister of Japan." },
      packet.sources[0]!,
      "en",
    );
    expect(sentence).toBe("As of 2026-11-14, the Prime Minister of Japan is Sanae Takaichi.");
  });

  it("renders the slot paragraph, the evidence block (quote + agreement count), then the source list (R-PR-8b)", () => {
    const packet = pmPacket();
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ answer: "高市早苗", src: "S1", quote: PM_UNIT_1 }),
      packet,
      PM_ENTRY,
    );
    const rendered = renderGroundedResearchFactSlotAnswer(
      "2026年11月14日時点で、内閣総理大臣は高市早苗です。",
      evaluation,
      packet.sources[0]!,
      [],
      packet,
      "ja",
    );
    expect(rendered).toBe([
      "2026年11月14日時点で、内閣総理大臣は高市早苗です。 [S1](https://www.kantei.example.go.jp/souri/)",
      "",
      "根拠の引用文：「高市早苗は、第105代内閣総理大臣に指名された。」 [S1](https://www.kantei.example.go.jp/souri/)",
      "この答えは、2件の出典で一致しています。 [S1](https://www.kantei.example.go.jp/souri/)",
      "",
      ...PM_SOURCE_LIST,
    ].join("\n"));
  });

  it("renders the en evidence block with the quote and no agreement line for a single source (R-PR-8b)", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({
        title: "PM news",
        url: "https://news.example.com/pm",
        domain: "news.example.com",
        excerpt: "Sanae Takaichi is the Prime Minister of Japan. She leads the cabinet.",
      }),
    ]);
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ answer: "Sanae Takaichi", src: "S1", quote: "Sanae Takaichi is the Prime Minister of Japan." }),
      packet,
      PM_ENTRY,
    );
    expect(evaluation.agreementSourceCount).toBe(1);
    const rendered = renderGroundedResearchFactSlotAnswer(
      "As of 2026-11-14, the Prime Minister of Japan is Sanae Takaichi.",
      evaluation,
      packet.sources[0]!,
      [],
      packet,
      "en",
    );
    expect(rendered).toContain("As of 2026-11-14, the Prime Minister of Japan is Sanae Takaichi. [S1](https://news.example.com/pm)");
    expect(rendered).toContain("Supporting quote: \"Sanae Takaichi is the Prime Minister of Japan.\" [S1](https://news.example.com/pm)");
    expect(rendered).not.toContain("consistent across");
  });
});

// --- Shared execution helper: layer wiring ----------------------------------

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

function helperOptions(overrides: Partial<Parameters<typeof executeGroundedResearchRecordsSynthesis>[1]> = {}) {
  return {
    plan: fakePlan,
    query: PM_QUERY,
    sources: pmSources(),
    language: "ja" as const,
    enabled: true,
    assertZeroCost: () => {},
    ...overrides,
  };
}

const SLOT_INSTRUCTION_JA = buildGroundedResearchFactSlotInstruction(PM_ENTRY, "ja");
const PRICE_SLOT_INSTRUCTION_JA = buildGroundedResearchFactSlotInstruction(PRICE_ENTRY, "ja");
const RECORDS_INSTRUCTION_JA = buildGroundedResearchRecordsInstruction("ja");
const SELECTION_INSTRUCTION_JA = buildGroundedResearchSelectionInstruction("ja");

/** Routes each execution by its instruction: slot vs records vs selection. */
function layeredExecute(outputs: { slot?: string; records?: string; selection?: string }) {
  return vi.fn(async (request: OriginProviderExecutionRequest) => {
    if (request.systemInstruction === SLOT_INSTRUCTION_JA || request.systemInstruction === PRICE_SLOT_INSTRUCTION_JA) {
      if (outputs.slot === undefined) throw new Error("slot execution failed");
      return executionResult(outputs.slot, 100);
    }
    if (request.systemInstruction === RECORDS_INSTRUCTION_JA) {
      if (outputs.records === undefined) throw new Error("records execution failed");
      return executionResult(outputs.records, 1234);
    }
    if (request.systemInstruction === SELECTION_INSTRUCTION_JA) {
      if (outputs.selection === undefined) throw new Error("selection execution failed");
      return executionResult(outputs.selection, 555);
    }
    throw new Error("unexpected instruction");
  });
}

const PM_SLOT_JSON = JSON.stringify({ answer: "高市早苗", src: "S1", quote: PM_UNIT_1 });
const PM_RECORDS_JSON = JSON.stringify({
  records: [
    { evidence: ["E1_1"], quote: PM_UNIT_1, text: "現在の内閣総理大臣は高市早苗です。" },
    { evidence: ["E2_1"], quote: PM2_UNIT_1, text: "2026年11月時点でも内閣総理大臣は高市早苗氏です。" },
  ],
});
const FABRICATED_RECORDS_JSON = JSON.stringify({
  records: [{ evidence: ["E1_1"], quote: "パケットに存在しない引用文です。", text: "現在の内閣総理大臣は高市早苗です。" }],
});
const SELECTION_JSON = "{\"select\":[\"E1_1\",\"E2_1\"]}";
const SLOT_HEADLINE = "2026年11月14日時点で、内閣総理大臣は高市早苗です。 [S1](https://www.kantei.example.go.jp/souri/)";
const PM_EVIDENCE_LINES = [
  `根拠の引用文：「${PM_UNIT_1}」 [S1](https://www.kantei.example.go.jp/souri/)`,
  "この答えは、2件の出典で一致しています。 [S1](https://www.kantei.example.go.jp/souri/)",
];
const EXPECTED_PM_RENDER = [
  "- 現在の内閣総理大臣は高市早苗です。 [S1](https://www.kantei.example.go.jp/souri/)",
  "- 2026年11月時点でも内閣総理大臣は高市早苗氏です。 [S2](https://news.example.co.jp/pm)",
  "",
  ...PM_SOURCE_LIST,
].join("\n");

describe("executeGroundedResearchRecordsSynthesis slot layer (design §9/§11/§12)", () => {
  it("adopts the slot and renders supporting records below it; retry and selection never fire", async () => {
    const execute = layeredExecute({ slot: PM_SLOT_JSON, records: PM_RECORDS_JSON });
    const executeRetry = vi.fn(async () => executionResult(PM_RECORDS_JSON, 777));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ executeRetry }));
    expect(outcome.adopted).toBe(true);
    expect(outcome.text).toBe(`${SLOT_HEADLINE}\n\n${PM_EVIDENCE_LINES.join("\n")}\n\n${EXPECTED_PM_RENDER}`);
    expect(outcome.usedSourceIds).toEqual(["S1", "S2"]);
    // The consumed result is the supporting records execution's.
    expect(outcome.result?.text).toBe(PM_RECORDS_JSON);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(executeRetry).not.toHaveBeenCalled();
    expect(outcome.metrics).toMatchObject({
      executionCount: 2,
      synthesisDurationMs: 100 + 1234,
      slotAttempted: true,
      slotTypeId: "incumbent-prime-minister-jp",
      slotAgreementSourceCount: 2,
      slotCode: "SLOT_ADOPTED",
      retryAttempted: false,
      selectionAttempted: false,
      acceptedRecordCount: 2,
      renderedRecordCount: 2,
      finalForm: "slot",
    });
    // The first execution was the slot request.
    expect(execute.mock.calls[0]?.[0].systemInstruction).toBe(SLOT_INSTRUCTION_JA);
  });

  it("keeps the slot sentence standing alone when the supporting records are rejected", async () => {
    const execute = layeredExecute({ slot: PM_SLOT_JSON, records: FABRICATED_RECORDS_JSON });
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(true);
    expect(outcome.text).toBe([SLOT_HEADLINE, "", ...PM_EVIDENCE_LINES, "", ...PM_SOURCE_LIST].join("\n"));
    // No support was adopted, so the consumed result is the slot's.
    expect(outcome.result?.text).toBe(PM_SLOT_JSON);
    expect(outcome.metrics).toMatchObject({
      executionCount: 2,
      slotCode: "SLOT_ADOPTED",
      acceptedRecordCount: 0,
      renderedRecordCount: 0,
      finalForm: "slot",
    });
  });

  it("adopts the slot on three-source agreement with a mention-only former holder, rendering quote and count (R-PR-8b)", async () => {
    const execute = layeredExecute({ slot: PM_SLOT_JSON, records: FABRICATED_RECORDS_JSON });
    const sources = [
      ...pmSources(),
      makeSource({
        title: "政権交代の記録",
        url: "https://news.example.co.jp/seiken",
        domain: "news.example.co.jp",
        excerpt: "内閣総理大臣は高市早苗氏である。前首相の石破茂氏は退任後、講演活動を続けている。石破茂首相の在任中には、物価高対策が議論された。",
      }),
    ];
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ sources }));
    // Adoption implies the post-render check passed on the new
    // evidence block (quote numerics + agreement count covered).
    expect(outcome.adopted).toBe(true);
    expect(outcome.text).toContain(`根拠の引用文：「${PM_UNIT_1}」 [S1](https://www.kantei.example.go.jp/souri/)`);
    expect(outcome.text).toContain("この答えは、3件の出典で一致しています。 [S1](https://www.kantei.example.go.jp/souri/)");
    expect(outcome.metrics).toMatchObject({
      slotAttempted: true,
      slotAgreementSourceCount: 3,
      slotCode: "SLOT_ADOPTED",
      finalForm: "slot",
    });
  });

  it("keeps the slot sentence standing alone when the supporting execution fails", async () => {
    const execute = layeredExecute({ slot: PM_SLOT_JSON });
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(true);
    expect(outcome.text).toBe([SLOT_HEADLINE, "", ...PM_EVIDENCE_LINES, "", ...PM_SOURCE_LIST].join("\n"));
    expect(outcome.metrics).toMatchObject({ executionCount: 2, finalForm: "slot" });
  });

  it("falls through to the records stage on no candidate, and the retry never fires", async () => {
    const execute = layeredExecute({ slot: "よく分かりませんでした。", records: PM_RECORDS_JSON });
    const executeRetry = vi.fn(async () => executionResult(PM_RECORDS_JSON, 777));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ executeRetry }));
    expect(outcome.adopted).toBe(true);
    expect(outcome.text).toBe(EXPECTED_PM_RENDER);
    expect(executeRetry).not.toHaveBeenCalled();
    expect(outcome.metrics).toMatchObject({
      executionCount: 2,
      slotAttempted: true,
      slotTypeId: "incumbent-prime-minister-jp",
      slotCode: "SLOT_NO_CANDIDATE",
      retryAttempted: false,
      selectionAttempted: false,
      finalForm: "records",
    });
  });

  it("falls through to the selection layer when the records fail after a slot attempt (3 executions, no retry)", async () => {
    const execute = layeredExecute({ slot: "よく分かりませんでした。", records: FABRICATED_RECORDS_JSON, selection: SELECTION_JSON });
    const executeRetry = vi.fn(async () => executionResult(PM_RECORDS_JSON, 777));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ executeRetry }));
    expect(outcome.adopted).toBe(true);
    expect(executeRetry).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(3);
    expect(outcome.metrics).toMatchObject({
      executionCount: 3,
      slotCode: "SLOT_NO_CANDIDATE",
      retryAttempted: false,
      selectionAttempted: true,
      selectionCode: "SELECTION_ADOPTED",
      finalForm: "selection",
    });
  });

  it("ends at the partial answer when slot, records, and selection all fail", async () => {
    const execute = layeredExecute({ slot: "よく分かりませんでした。", records: FABRICATED_RECORDS_JSON, selection: "{\"select\":[]}" });
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(false);
    expect(outcome.failureCode).toBe("NO_ACCEPTED_RECORDS");
    expect(outcome.metrics).toMatchObject({ executionCount: 3, finalForm: "partial" });
  });

  it("contains a slot execution failure inside the layer and proceeds to the records stage", async () => {
    const execute = layeredExecute({ records: PM_RECORDS_JSON });
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(true);
    expect(outcome.text).toBe(EXPECTED_PM_RENDER);
    expect(outcome.metrics).toMatchObject({
      executionCount: 2,
      slotAttempted: true,
      slotCode: "SLOT_EXECUTION_FAILED",
      finalForm: "records",
    });
  });

  it("records an agreement fall-through in the metrics and proceeds", async () => {
    // Records valid against THIS source set (the second source does
    // not mention the answer, which is what makes the slot fall
    // through on agreement while the records still cover both).
    const records = JSON.stringify({
      records: [
        { evidence: ["E1_1"], quote: PM_UNIT_1, text: "現在の内閣総理大臣は高市早苗です。" },
        { evidence: ["E2_1"], quote: "首相は国会の議決により指名されます。", text: "首相は国会の議決により指名されます。" },
      ],
    });
    const execute = layeredExecute({ slot: PM_SLOT_JSON, records });
    const sources = [
      pmSources()[0]!,
      makeSource({
        title: "首相ニュース",
        url: "https://news.example.co.jp/pm",
        domain: "news.example.co.jp",
        excerpt: "首相は国会の議決により指名されます。内閣の顔ぶれも発表されました。",
      }),
    ];
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ sources }));
    expect(outcome.adopted).toBe(true);
    expect(outcome.metrics).toMatchObject({
      slotAttempted: true,
      slotAgreementSourceCount: 1,
      slotCode: "SLOT_INSUFFICIENT_AGREEMENT",
      finalForm: "records",
    });
  });

  it("adopts the price slot with the published-date template sentence", async () => {
    const execute = layeredExecute({
      slot: JSON.stringify({ answer: "219,800円", src: "S1", quote: PRICE_UNIT_1 }),
      records: JSON.stringify({
        records: [
          { evidence: ["E1_1"], quote: PRICE_UNIT_1, text: "iPhone 18 Proの価格は219,800円です。" },
          { evidence: ["E2_1"], quote: PRICE_UNIT_2, text: "iPhone 18 Proの価格は219,800円と報じられています。" },
        ],
      }),
    });
    const outcome = await executeGroundedResearchRecordsSynthesis(
      execute,
      helperOptions({ query: PRICE_QUERY, sources: priceSources() }),
    );
    expect(outcome.adopted).toBe(true);
    expect(outcome.text).toContain("2026年9月10日時点の価格は219,800円です。 [S1](https://www.apple.com/jp/newsroom/iphone18)");
    expect(outcome.metrics).toMatchObject({
      slotAttempted: true,
      slotTypeId: "product-price",
      slotAgreementSourceCount: 2,
      slotCode: "SLOT_ADOPTED",
      finalForm: "slot",
    });
  });

  it("leaves the flow exactly as before when no slot type matches (retry still fires)", async () => {
    const execute = layeredExecute({ records: FABRICATED_RECORDS_JSON });
    const executeRetry = vi.fn(async () => executionResult(PM_RECORDS_JSON, 777));
    const outcome = await executeGroundedResearchRecordsSynthesis(
      execute,
      helperOptions({ query: "公開情報の要点を調査してください", executeRetry }),
    );
    expect(outcome.adopted).toBe(true);
    expect(executeRetry).toHaveBeenCalledTimes(1);
    expect(outcome.metrics).toMatchObject({
      executionCount: 2,
      slotAttempted: false,
      slotTypeId: null,
      slotCode: null,
      retryAttempted: true,
      finalForm: "records-after-retry",
    });
  });

  it("never executes at all when the kill switch is off, even for a slot-shaped question", async () => {
    const execute = layeredExecute({ slot: PM_SLOT_JSON, records: PM_RECORDS_JSON });
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ enabled: false }));
    expect(outcome.attempted).toBe(false);
    expect(outcome.adopted).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});
