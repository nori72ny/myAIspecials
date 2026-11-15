import { describe, expect, it, vi } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import type {
  OriginProviderExecutionRequest,
  OriginProviderExecutionResult,
} from "../legacy/originProviderClient";
import {
  checkGroundedResearchFactSlotFieldShape,
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

// R-PR-6 (design §9, §11, §12): the fact slot layer at the head of
// the records path. Type entries live in
// groundedResearchFactSlotsV13.ts (the registry-side interface of
// §9.1, kept on the records side until a fact registry exists).
// R-PR-9c (RPR9_DESIGN_2026-11-15 §2 R9-C): the candidate contract
// is a composite field set — every field individually backed, all
// fields required — and four high-risk entries join the two
// originals. Fixtures reuse the prime-minister / product-price
// shapes of the R-PR-2..5 tests; all names, prices, and amounts
// are fixture data.

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
const NISA_ENTRY = GROUNDED_RESEARCH_FACT_SLOT_ENTRIES.find((entry) => entry.id === "nisa-limits")!;
const FURUSATO_ENTRY = GROUNDED_RESEARCH_FACT_SLOT_ENTRIES.find((entry) => entry.id === "furusato-nozei-self-burden")!;
const SALT_ENTRY = GROUNDED_RESEARCH_FACT_SLOT_ENTRIES.find((entry) => entry.id === "salt-intake-target")!;
const VACCINE_ENTRY = GROUNDED_RESEARCH_FACT_SLOT_ENTRIES.find((entry) => entry.id === "vaccination-start-jp")!;

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

const NISA_QUERY = "新NISAの年間投資枠と生涯上限を教えてください";
const NISA_UNIT_1 = "新NISAの年間投資枠は360万円です。";
const NISA_UNIT_2 = "生涯投資枠（非課税保有限度額）は1,800万円と定められています。";
const NISA2_UNIT_1 = "新NISAでは年間360万円まで投資でき、生涯の非課税保有限度額は1,800万円です。";

function nisaSources(): OriginResearchSource[] {
  return [
    makeSource({
      title: "新NISAの概要",
      url: "https://www.fsa.example.go.jp/nisa/",
      domain: "fsa.example.go.jp",
      excerpt: `${NISA_UNIT_1}${NISA_UNIT_2}`,
    }),
    makeSource({
      title: "新NISAガイド",
      url: "https://guide.example.jp/nisa",
      domain: "guide.example.jp",
      excerpt: NISA2_UNIT_1,
    }),
  ];
}

function nisaPacket(): GroundedResearchRecordsPacket {
  return buildGroundedResearchRecordsPacket(nisaSources());
}

const NISA_CANDIDATE = {
  fields: {
    annual: { value: "360万円", src: "S1", quote: NISA_UNIT_1 },
    lifetime: { value: "1,800万円", src: "S1", quote: NISA_UNIT_2 },
  },
};

const FURUSATO_QUERY = "ふるさと納税の仕組みを教えてください";
const FURUSATO_UNIT_1 = "ふるさと納税は、寄附金額のうち自己負担額2,000円を超える部分が税金から控除される仕組みです。";
const FURUSATO_UNIT_2 = "自己負担は2,000円のみで、寄附した金額から2,000円を差し引いた分が控除対象となります。";

function furusatoSources(): OriginResearchSource[] {
  return [
    makeSource({
      title: "ふるさと納税の仕組み",
      url: "https://www.soumu.example.go.jp/furusato/",
      domain: "soumu.example.go.jp",
      excerpt: FURUSATO_UNIT_1,
    }),
    makeSource({
      title: "ふるさと納税ガイド",
      url: "https://guide.example.jp/furusato",
      domain: "guide.example.jp",
      excerpt: FURUSATO_UNIT_2,
    }),
  ];
}

const SALT_QUERY = "1日の塩分摂取量の目安を教えてください";
const SALT_UNIT_1 = "食事摂取基準では、食塩相当量の目標量は男性7.5g/日未満、女性6.5g/日未満とされています。";
const SALT_UNIT_2 = "生活習慣病予防のため、塩分の目標量は男性7.5g/日未満、女性6.5g/日未満が目安とされています。";

function saltSources(): OriginResearchSource[] {
  return [
    makeSource({
      title: "食事摂取基準の概要",
      url: "https://www.mhlw.example.go.jp/shokuji/",
      domain: "mhlw.example.go.jp",
      excerpt: SALT_UNIT_1,
    }),
    makeSource({
      title: "塩分と健康",
      url: "https://guide.example.jp/salt",
      domain: "guide.example.jp",
      excerpt: SALT_UNIT_2,
    }),
  ];
}

const VACCINE_QUERY = "BCGの接種はいつから受けられますか";
const VACCINE_UNIT_1 = "BCGの定期接種は生後5か月から8か月が標準的な接種期間です。";
const VACCINE_UNIT_2 = "BCGワクチンは生後5か月から8か月に接種します。";
const VACCINE_UNIT_3 = "対象は生後1歳に至るまでの乳児です。";

function vaccineSources(): OriginResearchSource[] {
  return [
    makeSource({
      title: "BCGワクチンについて",
      url: "https://www.mhlw.example.go.jp/bcg/",
      domain: "mhlw.example.go.jp",
      excerpt: VACCINE_UNIT_1,
    }),
    makeSource({
      title: "予防接種の案内",
      url: "https://city.example.jp/yobou/",
      domain: "city.example.jp",
      excerpt: `${VACCINE_UNIT_2}${VACCINE_UNIT_3}`,
    }),
  ];
}

function vaccinePacket(): GroundedResearchRecordsPacket {
  return buildGroundedResearchRecordsPacket(vaccineSources());
}

const VACCINE_CANDIDATE = {
  fields: {
    vaccine: { value: "BCG", src: "S1", quote: VACCINE_UNIT_1 },
    start: { value: "生後5か月から8か月", src: "S1", quote: VACCINE_UNIT_1 },
  },
};

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

  it("matches new NISA limit questions for the nisa-limits entry (R-PR-9c)", () => {
    expect(matchGroundedResearchFactSlotEntry(NISA_QUERY)?.id).toBe("nisa-limits");
    expect(matchGroundedResearchFactSlotEntry("新NISAの年間投資枠はいくらですか")?.id).toBe("nisa-limits");
    expect(matchGroundedResearchFactSlotEntry("新NISAの生涯上限を教えてください")?.id).toBe("nisa-limits");
    expect(matchGroundedResearchFactSlotEntry("NISAの非課税枠の上限は？")?.id).toBe("nisa-limits");
  });

  it("does not match legacy NISA products or non-limit NISA questions (R-PR-9c)", () => {
    expect(matchGroundedResearchFactSlotEntry("つみたてNISAの年間上限はいくらですか")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("一般NISAの投資枠を教えてください")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("ジュニアNISAの上限は？")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("iDeCoの年間上限を教えてください")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("新NISAのおすすめ銘柄を教えてください")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("新NISAのメリットとデメリットは？")).toBeNull();
  });

  it("matches hometown-tax self-burden and mechanism questions (R-PR-9c)", () => {
    expect(matchGroundedResearchFactSlotEntry(FURUSATO_QUERY)?.id).toBe("furusato-nozei-self-burden");
    expect(matchGroundedResearchFactSlotEntry("ふるさと納税の自己負担額はいくらですか")?.id).toBe("furusato-nozei-self-burden");
    expect(matchGroundedResearchFactSlotEntry("ふるさと納税の自己負担について教えてください")?.id).toBe("furusato-nozei-self-burden");
  });

  it("does not match other hometown-tax facts (R-PR-9c)", () => {
    expect(matchGroundedResearchFactSlotEntry("ふるさと納税のおすすめ返礼品を教えてください")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("ふるさと納税の控除上限額はいくらですか")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("ふるさと納税の手続きを教えてください")).toBeNull();
  });

  it("matches salt target questions for the salt entry (R-PR-9c)", () => {
    expect(matchGroundedResearchFactSlotEntry(SALT_QUERY)?.id).toBe("salt-intake-target");
    expect(matchGroundedResearchFactSlotEntry("塩分の目安を教えてください")?.id).toBe("salt-intake-target");
    expect(matchGroundedResearchFactSlotEntry("1日の食塩の目標量はどれくらいですか")?.id).toBe("salt-intake-target");
  });

  it("does not match other standards or non-standard salt topics (R-PR-9c)", () => {
    expect(matchGroundedResearchFactSlotEntry("WHOの塩分基準を教えてください")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("減塩レシピを教えてください")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("塩分の多い食品は？")).toBeNull();
  });

  it("matches named-vaccine start questions for the vaccination entry (R-PR-9c)", () => {
    expect(matchGroundedResearchFactSlotEntry(VACCINE_QUERY)?.id).toBe("vaccination-start-jp");
    expect(matchGroundedResearchFactSlotEntry("B型肝炎ワクチンの接種開始時期を教えてください")?.id).toBe("vaccination-start-jp");
    expect(matchGroundedResearchFactSlotEntry("ヒブワクチンはいつから打てますか")?.id).toBe("vaccination-start-jp");
    expect(matchGroundedResearchFactSlotEntry("五種混合の接種スケジュールは？")?.id).toBe("vaccination-start-jp");
  });

  it("does not match general schedule, history, or other vaccine facts (R-PR-9c)", () => {
    expect(matchGroundedResearchFactSlotEntry("予防接種のスケジュールを教えてください")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("予防接種の歴史を教えてください")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("BCGの副反応を教えてください")).toBeNull();
    expect(matchGroundedResearchFactSlotEntry("アメリカのBCG接種時期は？")).toBeNull();
  });
});

describe("parseGroundedResearchFactSlotOutput (design §4.3, composite since R-PR-9c)", () => {
  it("parses the JSON composite form", () => {
    const parsed = parseGroundedResearchFactSlotOutput(
      JSON.stringify({ fields: { holder: { value: "高市早苗", src: "S1", quote: PM_UNIT_1 } } }),
    );
    expect(parsed.format).toBe("json");
    expect(parsed.candidate).toEqual({ fields: { holder: { value: "高市早苗", src: "S1", quote: PM_UNIT_1 } } });
  });

  it("parses a multi-field JSON candidate", () => {
    const parsed = parseGroundedResearchFactSlotOutput(JSON.stringify(NISA_CANDIDATE));
    expect(parsed.format).toBe("json");
    expect(parsed.candidate).toEqual(NISA_CANDIDATE);
  });

  it("parses the SLOT text form with F:/A:/S:/Q: field blocks", () => {
    const parsed = parseGroundedResearchFactSlotOutput(
      ["SLOT", "F: holder", "A: 高市早苗", "S: S2", `Q: ${PM2_UNIT_1}`, "END"].join("\n"),
    );
    expect(parsed.format).toBe("text");
    expect(parsed.candidate).toEqual({ fields: { holder: { value: "高市早苗", src: "S2", quote: PM2_UNIT_1 } } });
  });

  it("parses a multi-field SLOT text form", () => {
    const parsed = parseGroundedResearchFactSlotOutput(
      [
        "SLOT",
        "F: annual", "A: 360万円", "S: S1", `Q: ${NISA_UNIT_1}`,
        "F: lifetime", "A: 1,800万円", "S: S1", `Q: ${NISA_UNIT_2}`,
        "END",
      ].join("\n"),
    );
    expect(parsed.format).toBe("text");
    expect(parsed.candidate).toEqual(NISA_CANDIDATE);
  });

  it("yields no candidate for the null sentinel, the pre-composite flat form, a records-shaped JSON, or prose", () => {
    expect(parseGroundedResearchFactSlotOutput("{\"fields\":null}").candidate).toBeNull();
    // The R-PR-6 flat form is no longer the contract (R-PR-9c).
    expect(parseGroundedResearchFactSlotOutput(
      JSON.stringify({ answer: "高市早苗", src: "S1", quote: PM_UNIT_1 }),
    ).candidate).toBeNull();
    expect(parseGroundedResearchFactSlotOutput("{\"records\":[{\"evidence\":[\"E1_1\"]}]}").candidate).toBeNull();
    expect(parseGroundedResearchFactSlotOutput(
      JSON.stringify({ fields: { holder: { value: "高市早苗", src: "S1" } } }),
    ).candidate).toBeNull();
    const prose = parseGroundedResearchFactSlotOutput("よく分かりませんでした。");
    expect(prose.format).toBeNull();
    expect(prose.candidate).toBeNull();
  });
});

describe("checkGroundedResearchFactSlotFieldShape (design §9.2(d))", () => {
  const holderField = PM_ENTRY.fields[0]!;
  const priceField = PRICE_ENTRY.fields[0]!;

  it("person-name: no numeric token; full-width digits count too", () => {
    expect(checkGroundedResearchFactSlotFieldShape(holderField, "高市早苗")).toBe(true);
    expect(checkGroundedResearchFactSlotFieldShape(holderField, "第105代")).toBe(false);
    expect(checkGroundedResearchFactSlotFieldShape(holderField, "219,800円")).toBe(false);
  });

  it("currency-amount: a currency-marked numeric token is required (a bare number is not a price)", () => {
    expect(checkGroundedResearchFactSlotFieldShape(priceField, "219,800円")).toBe(true);
    expect(checkGroundedResearchFactSlotFieldShape(priceField, "２１９，８００円")).toBe(true);
    expect(checkGroundedResearchFactSlotFieldShape(priceField, "$189")).toBe(true);
    expect(checkGroundedResearchFactSlotFieldShape(priceField, "iPhone 18 Pro")).toBe(false);
    expect(checkGroundedResearchFactSlotFieldShape(priceField, "219800")).toBe(false);
  });

  it("man-yen-amount: an integer 万円 amount only — the E-09 decimal slip fails", () => {
    const annualField = NISA_ENTRY.fields[0]!;
    expect(checkGroundedResearchFactSlotFieldShape(annualField, "360万円")).toBe(true);
    expect(checkGroundedResearchFactSlotFieldShape(annualField, "1,800万円")).toBe(true);
    expect(checkGroundedResearchFactSlotFieldShape(annualField, "3.6万円")).toBe(false);
    expect(checkGroundedResearchFactSlotFieldShape(annualField, "360")).toBe(false);
    expect(checkGroundedResearchFactSlotFieldShape(annualField, "360,000円")).toBe(false);
  });

  it("yen-amount: an amount denominated in yen", () => {
    const burdenField = FURUSATO_ENTRY.fields[0]!;
    expect(checkGroundedResearchFactSlotFieldShape(burdenField, "2,000円")).toBe(true);
    expect(checkGroundedResearchFactSlotFieldShape(burdenField, "2000円")).toBe(true);
    expect(checkGroundedResearchFactSlotFieldShape(burdenField, "2,000")).toBe(false);
    expect(checkGroundedResearchFactSlotFieldShape(burdenField, "2万円")).toBe(false);
  });

  it("salt-target: a gram target with the 未満 qualifier, with or without /日", () => {
    const maleField = SALT_ENTRY.fields[0]!;
    expect(checkGroundedResearchFactSlotFieldShape(maleField, "7.5g未満")).toBe(true);
    expect(checkGroundedResearchFactSlotFieldShape(maleField, "7.5g/日未満")).toBe(true);
    expect(checkGroundedResearchFactSlotFieldShape(maleField, "6g以下")).toBe(false);
    expect(checkGroundedResearchFactSlotFieldShape(maleField, "7.5g")).toBe(false);
  });

  it("vaccine-name and start-timing shapes", () => {
    const vaccineField = VACCINE_ENTRY.fields[0]!;
    const startField = VACCINE_ENTRY.fields[1]!;
    expect(checkGroundedResearchFactSlotFieldShape(vaccineField, "BCG")).toBe(true);
    expect(checkGroundedResearchFactSlotFieldShape(vaccineField, "ヒブ")).toBe(true);
    expect(checkGroundedResearchFactSlotFieldShape(vaccineField, "2,000円")).toBe(false);
    expect(checkGroundedResearchFactSlotFieldShape(startField, "生後2か月")).toBe(true);
    expect(checkGroundedResearchFactSlotFieldShape(startField, "生後5か月から8か月")).toBe(true);
    expect(checkGroundedResearchFactSlotFieldShape(startField, "出生時")).toBe(true);
    expect(checkGroundedResearchFactSlotFieldShape(startField, "来月から")).toBe(false);
  });
});

describe("buildGroundedResearchFactSlotInstruction / Prompt (design §9.2)", () => {
  it("asks for the single fact in the §4.3 composite JSON form, with the null sentinel", () => {
    const instruction = buildGroundedResearchFactSlotInstruction(PM_ENTRY, "ja");
    expect(instruction).toContain("現在の日本の内閣総理大臣の氏名");
    expect(instruction).toContain("{\"fields\"");
    expect(instruction).toContain("\"holder\"");
    expect(instruction).toContain("{\"fields\":null}");
  });

  it("names every field of a composite entry in the skeleton", () => {
    const instruction = buildGroundedResearchFactSlotInstruction(NISA_ENTRY, "ja");
    expect(instruction).toContain("新NISAの年間投資枠と生涯投資枠（非課税保有限度額）");
    expect(instruction).toContain("\"annual\"");
    expect(instruction).toContain("\"lifetime\"");
    expect(instruction).toContain("{\"fields\":null}");
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
  const adoptable = JSON.stringify({ fields: { holder: { value: "高市早苗", src: "S1", quote: PM_UNIT_1 } } });

  it("adopts a candidate with verbatim quote, shape, and two-source agreement", () => {
    const evaluation = evaluateGroundedResearchFactSlot(adoptable, pmPacket(), PM_ENTRY);
    expect(evaluation.code).toBeNull();
    expect(evaluation.candidate).toEqual({ fields: { holder: { value: "高市早苗", src: "S1", quote: PM_UNIT_1 } } });
    expect(evaluation.source?.id).toBe("S1");
    expect(evaluation.agreementSourceCount).toBe(2);
    expect(evaluation.supportSourceIds).toEqual(["S1", "S2"]);
    expect(evaluation.conflictDetected).toBe(false);
  });

  it("(a) rejects a source id outside the packet", () => {
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ fields: { holder: { value: "高市早苗", src: "S9", quote: PM_UNIT_1 } } }),
      pmPacket(),
      PM_ENTRY,
    );
    expect(evaluation.code).toBe("SLOT_SOURCE_NOT_IN_PACKET");
  });

  it("(b) rejects a quote that is not a verbatim substring of the excerpt", () => {
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ fields: { holder: { value: "高市早苗", src: "S1", quote: "高市早苗は総理大臣です。" } } }),
      pmPacket(),
      PM_ENTRY,
    );
    expect(evaluation.code).toBe("SLOT_QUOTE_NOT_SUBSTRING");
  });

  it("(c) rejects an answer that does not appear verbatim in the quote", () => {
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ fields: { holder: { value: "石破茂", src: "S1", quote: PM_UNIT_1 } } }),
      pmPacket(),
      PM_ENTRY,
    );
    expect(evaluation.code).toBe("SLOT_ANSWER_NOT_IN_QUOTE");
  });

  it("(d) rejects an answer that fails the type shape check", () => {
    const pmEvaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ fields: { holder: { value: "第105代", src: "S1", quote: PM_UNIT_1 } } }),
      pmPacket(),
      PM_ENTRY,
    );
    expect(pmEvaluation.code).toBe("SLOT_ANSWER_SHAPE_MISMATCH");
    const priceEvaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ fields: { amount: { value: "iPhone 18 Pro", src: "S1", quote: PRICE_UNIT_1 } } }),
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
      JSON.stringify({ fields: { amount: { value: "219,800円", src: "S1", quote: PRICE_UNIT_1 } } }),
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
      JSON.stringify({ fields: { amount: { value: "219,800円", src: "S1", quote: PRICE_UNIT_1 } } }),
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
      JSON.stringify({ fields: { amount: { value: "219,800円", src: "S1", quote: PRICE_UNIT_1 } } }),
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
      JSON.stringify({ fields: { holder: { value: "Sanae Takaichi", src: "S1", quote: "Sanae Takaichi is the Prime Minister of Japan." } } }),
      packet,
      PM_ENTRY,
    );
    expect(evaluation.code).toBeNull();
    expect(evaluation.agreementSourceCount).toBe(1);
  });

  it("yields SLOT_NO_CANDIDATE for prose and for the null sentinel", () => {
    expect(evaluateGroundedResearchFactSlot("よく分かりませんでした。", pmPacket(), PM_ENTRY).code).toBe("SLOT_NO_CANDIDATE");
    expect(evaluateGroundedResearchFactSlot("{\"fields\":null}", pmPacket(), PM_ENTRY).code).toBe("SLOT_NO_CANDIDATE");
  });
});

describe("slot rendering (design §9.3)", () => {
  const SLOT_HEADLINE = "2026年11月14日時点で、内閣総理大臣は高市早苗です。";
  const PM_EVIDENCE_LINES = [
    "根拠の引用文：「高市早苗は、第105代内閣総理大臣に指名された。」 [S1](https://www.kantei.example.go.jp/souri/)",
    "この答えは、2件の出典で一致しています。 [S1](https://www.kantei.example.go.jp/souri/)",
  ];
  const EXPECTED_PM_RENDER = [`${SLOT_HEADLINE} [S1](https://www.kantei.example.go.jp/souri/)`, "", ...PM_EVIDENCE_LINES, "", ...PM_SOURCE_LIST].join("\n");

  it("renders the template with the retrieved date when no published date exists", () => {
    const packet = pmPacket();
    const sentence = renderGroundedResearchFactSlotSentence(
      PM_ENTRY,
      { fields: { holder: { value: "高市早苗", src: "S1", quote: PM_UNIT_1 } } },
      packet.sources[0]!,
      "ja",
    );
    expect(sentence).toBe(SLOT_HEADLINE);
  });

  it("renders the price template with the source's published date", () => {
    const packet = buildGroundedResearchRecordsPacket(priceSources());
    const sentence = renderGroundedResearchFactSlotSentence(
      PRICE_ENTRY,
      { fields: { amount: { value: "219,800円", src: "S1", quote: PRICE_UNIT_1 } } },
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
      { fields: { holder: { value: "Sanae Takaichi", src: "S1", quote: "Sanae Takaichi is the Prime Minister of Japan." } } },
      packet.sources[0]!,
      "en",
    );
    expect(sentence).toBe("As of 2026-11-14, the Prime Minister of Japan is Sanae Takaichi.");
  });

  it("renders the slot paragraph, the evidence block (quote + agreement count), then the source list (R-PR-8b)", () => {
    const packet = pmPacket();
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ fields: { holder: { value: "高市早苗", src: "S1", quote: PM_UNIT_1 } } }),
      packet,
      PM_ENTRY,
    );
    const rendered = renderGroundedResearchFactSlotAnswer(
      PM_ENTRY,
      SLOT_HEADLINE,
      evaluation,
      packet.sources[0]!,
      [],
      packet,
      "ja",
    );
    expect(rendered).toBe(EXPECTED_PM_RENDER);
  });

  it("renders a composite entry with one labelled evidence line per field (R-PR-9c)", () => {
    const packet = nisaPacket();
    const evaluation = evaluateGroundedResearchFactSlot(JSON.stringify(NISA_CANDIDATE), packet, NISA_ENTRY);
    expect(evaluation.code).toBeNull();
    const sentence = renderGroundedResearchFactSlotSentence(NISA_ENTRY, evaluation.candidate!, packet.sources[0]!, "ja");
    expect(sentence).toBe("2026年11月14日時点で、新NISAの年間投資枠は360万円、生涯投資枠（非課税保有限度額）は1,800万円です。");
    const rendered = renderGroundedResearchFactSlotAnswer(
      NISA_ENTRY,
      sentence!,
      evaluation,
      packet.sources[0]!,
      [],
      packet,
      "ja",
    );
    expect(rendered).toBe([
      "2026年11月14日時点で、新NISAの年間投資枠は360万円、生涯投資枠（非課税保有限度額）は1,800万円です。 [S1](https://www.fsa.example.go.jp/nisa/)",
      "",
      "根拠の引用文（年間投資枠）：「新NISAの年間投資枠は360万円です。」 [S1](https://www.fsa.example.go.jp/nisa/)",
      "根拠の引用文（生涯投資枠）：「生涯投資枠（非課税保有限度額）は1,800万円と定められています。」 [S1](https://www.fsa.example.go.jp/nisa/)",
      "この答えは、2件の出典で一致しています。 [S1](https://www.fsa.example.go.jp/nisa/)",
      "",
      "## 出典",
      "- S1: 新NISAの概要（fsa.example.go.jp）／公開日: 公開日不明／取得日: 2026年11月14日 [S1](https://www.fsa.example.go.jp/nisa/)",
      "- S2: 新NISAガイド（guide.example.jp）／公開日: 公開日不明／取得日: 2026年11月14日 [S2](https://guide.example.jp/nisa)",
    ].join("\n"));
  });
});

describe("evaluateGroundedResearchFactSlot — NISA limits (R-PR-9c; E-09 shapes)", () => {
  it("adopts when both fields are backed and agree across two sources", () => {
    const evaluation = evaluateGroundedResearchFactSlot(JSON.stringify(NISA_CANDIDATE), nisaPacket(), NISA_ENTRY);
    expect(evaluation.code).toBeNull();
    expect(evaluation.agreementSourceCount).toBe(2);
    expect(evaluation.supportSourceIds).toEqual(["S1", "S2"]);
    expect(evaluation.conflictDetected).toBe(false);
  });

  it("adopts when a field is backed by a different source than the others", () => {
    const candidate = {
      fields: {
        annual: { value: "360万円", src: "S1", quote: NISA_UNIT_1 },
        lifetime: { value: "1,800万円", src: "S2", quote: NISA2_UNIT_1 },
      },
    };
    const evaluation = evaluateGroundedResearchFactSlot(JSON.stringify(candidate), nisaPacket(), NISA_ENTRY);
    expect(evaluation.code).toBeNull();
    expect(evaluation.agreementSourceCount).toBe(2);
  });

  it("falls through when a required field is missing (fail closed)", () => {
    const candidate = { fields: { annual: { value: "360万円", src: "S1", quote: NISA_UNIT_1 } } };
    const evaluation = evaluateGroundedResearchFactSlot(JSON.stringify(candidate), nisaPacket(), NISA_ENTRY);
    expect(evaluation.code).toBe("SLOT_NO_CANDIDATE");
  });

  it("E-09: the decimal slip 3.6万円 is rejected at (c) — it never appears verbatim in a quote", () => {
    const candidate = {
      fields: {
        annual: { value: "3.6万円", src: "S1", quote: NISA_UNIT_1 },
        lifetime: { value: "1,800万円", src: "S1", quote: NISA_UNIT_2 },
      },
    };
    const evaluation = evaluateGroundedResearchFactSlot(JSON.stringify(candidate), nisaPacket(), NISA_ENTRY);
    expect(evaluation.code).toBe("SLOT_ANSWER_NOT_IN_QUOTE");
  });

  it("E-09: a monthly amount (12万円) cannot stand in for the lifetime cap", () => {
    const candidate = {
      fields: {
        annual: { value: "360万円", src: "S1", quote: NISA_UNIT_1 },
        lifetime: { value: "12万円", src: "S1", quote: NISA_UNIT_2 },
      },
    };
    const evaluation = evaluateGroundedResearchFactSlot(JSON.stringify(candidate), nisaPacket(), NISA_ENTRY);
    expect(evaluation.code).toBe("SLOT_ANSWER_NOT_IN_QUOTE");
  });

  it("falls through when another source states a different lifetime cap", () => {
    const packet = buildGroundedResearchRecordsPacket([
      ...nisaSources(),
      makeSource({
        title: "旧制度の案内",
        url: "https://old.example.jp/nisa",
        domain: "old.example.jp",
        excerpt: "生涯投資枠（非課税保有限度額）は1,500万円です。",
      }),
    ]);
    const evaluation = evaluateGroundedResearchFactSlot(JSON.stringify(NISA_CANDIDATE), packet, NISA_ENTRY);
    expect(evaluation.code).toBe("SLOT_SOURCE_CONFLICT");
    expect(evaluation.conflictDetected).toBe(true);
    expect(evaluation.agreementSourceCount).toBe(2);
  });
});

describe("evaluateGroundedResearchFactSlot — hometown-tax self-burden (R-PR-9c; B-04 shapes)", () => {
  const candidate = { fields: { amount: { value: "2,000円", src: "S1", quote: FURUSATO_UNIT_1 } } };

  it("adopts when the quote ties the amount to the self-burden definition", () => {
    const packet = buildGroundedResearchRecordsPacket(furusatoSources());
    const evaluation = evaluateGroundedResearchFactSlot(JSON.stringify(candidate), packet, FURUSATO_ENTRY);
    expect(evaluation.code).toBeNull();
    expect(evaluation.agreementSourceCount).toBe(2);
    const sentence = renderGroundedResearchFactSlotSentence(FURUSATO_ENTRY, evaluation.candidate!, packet.sources[0]!, "ja");
    expect(sentence).toBe("2026年11月14日時点で、ふるさと納税の自己負担額は2,000円です。");
  });

  it("B-04: a different amount (3,000円) is rejected at (c)", () => {
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ fields: { amount: { value: "3,000円", src: "S1", quote: FURUSATO_UNIT_1 } } }),
      buildGroundedResearchRecordsPacket(furusatoSources()),
      FURUSATO_ENTRY,
    );
    expect(evaluation.code).toBe("SLOT_ANSWER_NOT_IN_QUOTE");
  });

  it("B-04: a quote where the amount is not tied to 自己負担 cannot establish the fact", () => {
    // The reversed-mechanism fatal: an unrelated 2,000円 in the same
    // excerpt must not be usable as the self-burden quote.
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({
        title: "ふるさと納税ポータル",
        url: "https://portal.example.jp/furusato",
        domain: "portal.example.jp",
        excerpt: "ふるさと納税のポータルサイト利用手数料は2,000円です。寄附の手続きはオンラインで完結します。",
      }),
      furusatoSources()[1]!,
    ]);
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ fields: { amount: { value: "2,000円", src: "S1", quote: "ふるさと納税のポータルサイト利用手数料は2,000円です。" } } }),
      packet,
      FURUSATO_ENTRY,
    );
    expect(evaluation.code).toBe("SLOT_QUOTE_REQUIREMENT_UNMET");
  });
});

describe("evaluateGroundedResearchFactSlot — salt targets (R-PR-9c; B-06 shapes)", () => {
  const candidate = {
    fields: {
      male: { value: "7.5g/日未満", src: "S1", quote: SALT_UNIT_1 },
      female: { value: "6.5g/日未満", src: "S1", quote: SALT_UNIT_1 },
    },
  };

  it("adopts when both gender fields are backed and agree across two sources", () => {
    const packet = buildGroundedResearchRecordsPacket(saltSources());
    const evaluation = evaluateGroundedResearchFactSlot(JSON.stringify(candidate), packet, SALT_ENTRY);
    expect(evaluation.code).toBeNull();
    expect(evaluation.agreementSourceCount).toBe(2);
    const sentence = renderGroundedResearchFactSlotSentence(SALT_ENTRY, evaluation.candidate!, packet.sources[0]!, "ja");
    expect(sentence).toBe("2026年11月14日時点で、塩分（食塩相当量）の1日の目標量は、男性7.5g/日未満、女性6.5g/日未満です。");
  });

  it("falls through when only one gender field is present (fail closed)", () => {
    const partial = { fields: { male: { value: "7.5g/日未満", src: "S1", quote: SALT_UNIT_1 } } };
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify(partial),
      buildGroundedResearchRecordsPacket(saltSources()),
      SALT_ENTRY,
    );
    expect(evaluation.code).toBe("SLOT_NO_CANDIDATE");
  });

  it("B-06: swapping the women's value into the men's field conflicts with the stated answers", () => {
    const swapped = {
      fields: {
        male: { value: "6.5g/日未満", src: "S1", quote: SALT_UNIT_1 },
        female: { value: "6.5g/日未満", src: "S1", quote: SALT_UNIT_1 },
      },
    };
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify(swapped),
      buildGroundedResearchRecordsPacket(saltSources()),
      SALT_ENTRY,
    );
    expect(evaluation.code).toBe("SLOT_SOURCE_CONFLICT");
    expect(evaluation.conflictDetected).toBe(true);
  });
});

describe("evaluateGroundedResearchFactSlot — vaccination start (R-PR-9c; B-10 shapes)", () => {
  it("adopts the (vaccine, start) pair when both sources anchor the timing to the vaccine", () => {
    const evaluation = evaluateGroundedResearchFactSlot(JSON.stringify(VACCINE_CANDIDATE), vaccinePacket(), VACCINE_ENTRY);
    expect(evaluation.code).toBeNull();
    expect(evaluation.agreementSourceCount).toBe(2);
    const sentence = renderGroundedResearchFactSlotSentence(VACCINE_ENTRY, evaluation.candidate!, vaccinePacket().sources[0]!, "ja");
    expect(sentence).toBe("2026年11月14日時点で、BCGの接種開始時期は生後5か月から8か月です。");
  });

  it("B-10: a source anchoring a different start (出生時) to the vaccine conflicts", () => {
    const packet = buildGroundedResearchRecordsPacket([
      ...vaccineSources(),
      makeSource({
        title: "海外の接種記録",
        url: "https://overseas.example.com/bcg",
        domain: "overseas.example.com",
        excerpt: "BCGは出生時に接種します。",
      }),
    ]);
    const evaluation = evaluateGroundedResearchFactSlot(JSON.stringify(VACCINE_CANDIDATE), packet, VACCINE_ENTRY);
    expect(evaluation.code).toBe("SLOT_SOURCE_CONFLICT");
    expect(evaluation.conflictDetected).toBe(true);
  });

  it("B-10: the pair backed only by the disagreeing source cannot reach agreement", () => {
    const packet = buildGroundedResearchRecordsPacket([
      ...vaccineSources(),
      makeSource({
        title: "海外の接種記録",
        url: "https://overseas.example.com/bcg",
        domain: "overseas.example.com",
        excerpt: "BCGは出生時に接種します。",
      }),
    ]);
    const candidate = {
      fields: {
        vaccine: { value: "BCG", src: "S3", quote: "BCGは出生時に接種します。" },
        start: { value: "出生時", src: "S3", quote: "BCGは出生時に接種します。" },
      },
    };
    const evaluation = evaluateGroundedResearchFactSlot(JSON.stringify(candidate), packet, VACCINE_ENTRY);
    expect(evaluation.code).toBe("SLOT_INSUFFICIENT_AGREEMENT");
    expect(evaluation.agreementSourceCount).toBe(1);
  });

  it("does not count a source that names the vaccine and the timing in separate units", () => {
    const packet = buildGroundedResearchRecordsPacket([
      vaccineSources()[0]!,
      makeSource({
        title: "予防接種の案内",
        url: "https://city.example.jp/yobou/",
        domain: "city.example.jp",
        excerpt: "BCGワクチンの説明会を開催します。定期接種は生後5か月から8か月が標準的な接種期間です。",
      }),
    ]);
    const evaluation = evaluateGroundedResearchFactSlot(JSON.stringify(VACCINE_CANDIDATE), packet, VACCINE_ENTRY);
    expect(evaluation.code).toBe("SLOT_INSUFFICIENT_AGREEMENT");
    expect(evaluation.agreementSourceCount).toBe(1);
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
const NISA_INSTRUCTION_JA = buildGroundedResearchFactSlotInstruction(NISA_ENTRY, "ja");
const VACCINE_INSTRUCTION_JA = buildGroundedResearchFactSlotInstruction(VACCINE_ENTRY, "ja");
const RECORDS_INSTRUCTION_JA = buildGroundedResearchRecordsInstruction("ja");
const SELECTION_INSTRUCTION_JA = buildGroundedResearchSelectionInstruction("ja");
const SLOT_INSTRUCTIONS = new Set([SLOT_INSTRUCTION_JA, PRICE_SLOT_INSTRUCTION_JA, NISA_INSTRUCTION_JA, VACCINE_INSTRUCTION_JA]);

/** Routes each execution by its instruction: slot vs records vs selection. */
function layeredExecute(outputs: { slot?: string; records?: string; selection?: string }) {
  return vi.fn(async (request: OriginProviderExecutionRequest) => {
    if (request.systemInstruction !== undefined && SLOT_INSTRUCTIONS.has(request.systemInstruction)) {
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

const PM_SLOT_JSON = JSON.stringify({ fields: { holder: { value: "高市早苗", src: "S1", quote: PM_UNIT_1 } } });
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
const HELPER_SLOT_HEADLINE = "2026年11月14日時点で、内閣総理大臣は高市早苗です。 [S1](https://www.kantei.example.go.jp/souri/)";
const HELPER_PM_EVIDENCE_LINES = [
  `根拠の引用文：「${PM_UNIT_1}」 [S1](https://www.kantei.example.go.jp/souri/)`,
  "この答えは、2件の出典で一致しています。 [S1](https://www.kantei.example.go.jp/souri/)",
];
const HELPER_EXPECTED_RECORDS_RENDER = [
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
    expect(outcome.text).toBe(`${HELPER_SLOT_HEADLINE}\n\n${HELPER_PM_EVIDENCE_LINES.join("\n")}\n\n${HELPER_EXPECTED_RECORDS_RENDER}`);
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
    expect(outcome.text).toBe([HELPER_SLOT_HEADLINE, "", ...HELPER_PM_EVIDENCE_LINES, "", ...PM_SOURCE_LIST].join("\n"));
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
    expect(outcome.text).toBe([HELPER_SLOT_HEADLINE, "", ...HELPER_PM_EVIDENCE_LINES, "", ...PM_SOURCE_LIST].join("\n"));
    expect(outcome.metrics).toMatchObject({ executionCount: 2, finalForm: "slot" });
  });

  it("falls through to the records stage on no candidate, and the retry never fires", async () => {
    const execute = layeredExecute({ slot: "よく分かりませんでした。", records: PM_RECORDS_JSON });
    const executeRetry = vi.fn(async () => executionResult(PM_RECORDS_JSON, 777));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ executeRetry }));
    expect(outcome.adopted).toBe(true);
    expect(outcome.text).toBe(HELPER_EXPECTED_RECORDS_RENDER);
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
    expect(outcome.text).toBe(HELPER_EXPECTED_RECORDS_RENDER);
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
      slot: JSON.stringify({ fields: { amount: { value: "219,800円", src: "S1", quote: PRICE_UNIT_1 } } }),
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

  it("adopts the NISA slot with labelled per-field evidence lines (R-PR-9c)", async () => {
    const execute = layeredExecute({ slot: JSON.stringify(NISA_CANDIDATE), records: FABRICATED_RECORDS_JSON });
    const outcome = await executeGroundedResearchRecordsSynthesis(
      execute,
      helperOptions({ query: NISA_QUERY, sources: nisaSources() }),
    );
    expect(outcome.adopted).toBe(true);
    expect(outcome.text).toContain("2026年11月14日時点で、新NISAの年間投資枠は360万円、生涯投資枠（非課税保有限度額）は1,800万円です。 [S1](https://www.fsa.example.go.jp/nisa/)");
    expect(outcome.text).toContain(`根拠の引用文（年間投資枠）：「${NISA_UNIT_1}」 [S1](https://www.fsa.example.go.jp/nisa/)`);
    expect(outcome.text).toContain(`根拠の引用文（生涯投資枠）：「${NISA_UNIT_2}」 [S1](https://www.fsa.example.go.jp/nisa/)`);
    expect(outcome.metrics).toMatchObject({
      slotAttempted: true,
      slotTypeId: "nisa-limits",
      slotAgreementSourceCount: 2,
      slotCode: "SLOT_ADOPTED",
      finalForm: "slot",
    });
  });

  it("falls through to the records stage when the vaccination pair is not established (R-PR-9c)", async () => {
    const records = JSON.stringify({
      records: [
        { evidence: ["E1_1"], quote: VACCINE_UNIT_1, text: "BCGの定期接種は生後5か月から8か月が標準的な接種期間です。" },
        { evidence: ["E2_1"], quote: VACCINE_UNIT_2, text: "BCGワクチンは生後5か月から8か月に接種します。" },
      ],
    });
    const execute = layeredExecute({ slot: "分かりませんでした。", records });
    const executeRetry = vi.fn(async () => executionResult(records, 777));
    const outcome = await executeGroundedResearchRecordsSynthesis(
      execute,
      helperOptions({ query: VACCINE_QUERY, sources: vaccineSources(), executeRetry }),
    );
    expect(outcome.adopted).toBe(true);
    expect(executeRetry).not.toHaveBeenCalled();
    expect(outcome.metrics).toMatchObject({
      slotAttempted: true,
      slotTypeId: "vaccination-start-jp",
      slotCode: "SLOT_NO_CANDIDATE",
      retryAttempted: false,
      finalForm: "records",
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
