// Fact slot type entries (SYNTHESIS_RECORDS_DESIGN_2026-11-14 §9.1,
// R-PR-6; composite field contract, R-PR-9c per
// RPR9_DESIGN_2026-11-15 §2 R9-C).
//
// §9.1 places the type entries on the high-volatility fact registry
// side: the registry provides, per fact type, the question pattern,
// the rendering templates (ja/en) and the shape of the answer. No
// such registry module exists in this repository yet (checked
// 2026-11-15: the only "registry" modules are the tool/plugin/service
// registries, and originChatResponsePolicy detects volatile topics
// for response policy, but neither carries fact-type templates or
// answer shapes). Per the R-PR-6 adjudication, the interface and the
// entries therefore live here, on the records side, in this separate
// module — pure data and string operations only, with no dependency
// on the records module — so the entries can move to the registry
// unchanged when it appears.
//
// Composite contract (R-PR-9c): a candidate is a SET OF FIELDS, not a
// single value. Each entry declares its fields as data (id, label,
// value shape, quote requirements, stated-answer extraction); each
// field of a candidate carries its own (value, src, quote) backing,
// every field is required, and a candidate missing any field is no
// candidate at all (fail closed). New value shapes are added by
// naming a shape here and adding its check below; new stated-answer
// extractions are added as field data (capture patterns or a named
// extractor the records module resolves). The two original entries
// (incumbent prime minister, product price) are single-field entries
// under this contract, with their §9.2 behaviour unchanged.
//
// Matching is deterministic pattern matching over the NFKC-normalized,
// lowercased query, and it is deliberately NARROW: a false match is
// the biggest danger (§9.1), because a matched question spends a
// generation on the slot and suppresses the records retry layer. Each
// entry requires ALL of its positive patterns and vetoes on ANY
// exclusion. Patterns are authored against the normalized query.

/**
 * The shape of one field's value; drives the §9.2(d) shape check.
 * The check for each shape lives in
 * checkGroundedResearchFactSlotFieldShape below — adding a field
 * with a new value shape means adding one member here and one case
 * there, never a new code path in the evaluation.
 */
export type GroundedResearchFactSlotFieldShape =
  | "person-name"
  | "currency-amount"
  | "man-yen-amount"
  | "yen-amount"
  | "salt-target"
  | "vaccine-name"
  | "start-timing";

/**
 * Named stated-answer extractors whose implementation needs the
 * records module's machinery (numeric tokens, the R-PR-8b assertion
 * extraction). The records module resolves the id; the declaration
 * stays data here.
 * - "incumbent-names": assertion-shape person names (R-PR-8b).
 * - "single-price": the excerpt's single stated currency amount
 *   (R-PR-8b).
 * - "anchored-timings": timing values stated in the same sentence
 *   as the anchor field's value (pair facts, e.g. vaccine × start).
 */
export type GroundedResearchFactSlotStatedAnswerExtractor =
  | "incumbent-names"
  | "single-price"
  | "anchored-timings";

export interface GroundedResearchFactSlotFieldDefinition {
  /** Stable field id within the entry; the template token is {<id>}. */
  id: string;
  /** Field label, used in multi-field evidence lines. */
  label: Readonly<{ ja: string; en: string }>;
  /** Human-readable shape of the value, for the generation prompt. */
  shapeDescription: Readonly<{ ja: string; en: string }>;
  /** The value shape; drives the §9.2(d) shape check. */
  shape: GroundedResearchFactSlotFieldShape;
  /**
   * Extra requirement on the field's quote (beyond containing the
   * value verbatim): the quote must also match this pattern — the
   * quote has to carry the context that ties the value to this
   * field (e.g. the self-burden definition for the hometown tax).
   * Authored WITHOUT the global flag (it is used with .test()).
   */
  quotePattern?: RegExp;
  /**
   * Extra requirement on the field's quote: it must contain the
   * value of the named sibling field verbatim (pair facts: the
   * quote backing a start timing must name its vaccine).
   */
  quoteIncludesFieldId?: string;
  /**
   * Stated-answer extraction for the conflict / tier material
   * (R-PR-8b/8c): regexes over the raw excerpt text whose single
   * capture group is a value the text STATES AS ITS ANSWER for this
   * field. Authored WITH the global flag (used with matchAll).
   * Mutually exclusive with statedAnswerExtractor; a field with
   * neither takes no part in stated-answer conflict or tier
   * weighing (verbatim agreement and the shape check still apply).
   */
  statedAnswerPatterns?: readonly RegExp[];
  /** Named stated-answer extractor (see the type above). */
  statedAnswerExtractor?: GroundedResearchFactSlotStatedAnswerExtractor;
  /**
   * For "anchored-timings": the sibling field whose value anchors
   * the extraction (only statements about that value count).
   */
  statedAnswerAnchorFieldId?: string;
}

export interface GroundedResearchFactSlotEntry {
  /** Stable type id, recorded in the stage metrics (§11). */
  id: string;
  /** The fact's fields, in rendering / evaluation order. All required. */
  fields: readonly GroundedResearchFactSlotFieldDefinition[];
  /** Every pattern must match the normalized query. */
  patterns: readonly RegExp[];
  /** Any match vetoes the entry, even when all patterns match. */
  exclusions: readonly RegExp[];
  /** Type-provided label for the {role} template token ("" when unused). */
  roleLabel: Readonly<{ ja: string; en: string }>;
  /** §9.3 rendering templates; tokens: {date}, {role}, {<fieldId>}. */
  templates: Readonly<{ ja: string; en: string }>;
  /** What the generation is asked to extract (§9.2), per language. */
  factDescription: Readonly<{ ja: string; en: string }>;
}

/** The normalization slot matching runs on (NFKC, then lowercase). */
export function normalizeGroundedResearchFactSlotQuery(query: string): string {
  return query.normalize("NFKC").toLowerCase();
}

// (a) Incumbent office holder — first entry: the Prime Minister of
// Japan. The question must name the office and ask who holds it;
// anything historical, predictive, comparative, about a different
// office or a different country, or about the office itself (salary,
// term, how chosen) is vetoed.
const INCUMBENT_PRIME_MINISTER_ENTRY: GroundedResearchFactSlotEntry = {
  id: "incumbent-prime-minister-jp",
  fields: [
    {
      id: "holder",
      label: { ja: "氏名", en: "name" },
      shapeDescription: {
        ja: "人名のみ（役職・敬称・説明を含めない）",
        en: "a person's name only (no title, honorific, or explanation)",
      },
      shape: "person-name",
      statedAnswerExtractor: "incumbent-names",
    },
  ],
  patterns: [
    /内閣総理大臣|総理大臣|首相|prime minister/,
    /誰|どなた|氏名|名前|who/,
  ],
  exclusions: [
    // A deputy office (other ministers never contain the positive
    // office patterns, so they need no exclusion).
    /副総理|副首相/,
    // Historical, former, or speculative.
    /過去|歴代|初代|当時|かつて|昔|元総理|元首相|元職|\d{4}\s*年|次(の|期)|候補|予想|なる可能性|who was|former|previous|first prime|next prime|history/,
    // About the office, not the holder.
    /支持率|給与|給料|年収|任期|権限|出身|学歴|年齢|何歳|夫人|家族|官邸|決める|決ま|選ぶ|任命|なり方|一覧|リスト|最長|最短|何代目/,
    // Another country's prime minister.
    /イギリス|英国|フランス|ドイツ|アメリカ|米国|カナダ|オーストラリア|インド|韓国|中国|イタリア|スペイン|ロシア|ウクライナ|タイ|ベトナム|フィリピン|マレーシア|シンガポール|ニュージーランド|オランダ|スイス|スウェーデン|トルコ|イスラエル|ブラジル|メキシコ|台湾/,
  ],
  roleLabel: { ja: "内閣総理大臣", en: "Prime Minister of Japan" },
  templates: {
    ja: "{date}時点で、{role}は{holder}です。",
    en: "As of {date}, the {role} is {holder}.",
  },
  factDescription: {
    ja: "現在の日本の内閣総理大臣の氏名",
    en: "the name of the current Prime Minister of Japan",
  },
};

// (b) New NISA limits (R-PR-9c). A composite fact: the annual
// investment limit and the lifetime limit (tax-free holding limit)
// are only adoptable together — the R-PR-8 measurement's E-09 fatal
// was exactly a unit slip across this pair （年間3.6万円・累計12万円
// asserted from model memory). Legacy NISA products (the pre-2024
// 一般NISA・つみたてNISA・ジュニアNISA, whose limits differ) and
// other tax-advantaged systems are vetoed.
const NISA_LIMITS_ENTRY: GroundedResearchFactSlotEntry = {
  id: "nisa-limits",
  fields: [
    {
      id: "annual",
      label: { ja: "年間投資枠", en: "annual investment limit" },
      shapeDescription: {
        ja: "年間の投資上限額のみ（例: 360万円。万円単位・整数の金額のみ）",
        en: "the annual investment limit only (e.g. 360万円; an integer amount denominated in 万円)",
      },
      shape: "man-yen-amount",
      quotePattern: /年間/,
      statedAnswerPatterns: [
        /(?:年間投資枠|年間の投資枠|年間枠)(?:（[^）]*）)?(?:は|が|の上限は|の限度額は|：|:)?\s*(\d[\d,]*万円)/g,
        /年間(?:の)?(?:投資)?(?:上限|限度額)(?:は|が|：|:)?\s*(\d[\d,]*万円)/g,
        /年間(\d[\d,]*万円)(?:まで|以内|の投資枠|の枠)/g,
      ],
    },
    {
      id: "lifetime",
      label: { ja: "生涯投資枠", en: "lifetime investment limit" },
      shapeDescription: {
        ja: "生涯の投資上限額（非課税保有限度額）のみ（例: 1,800万円。万円単位・整数の金額のみ）",
        en: "the lifetime investment limit (tax-free holding limit) only (e.g. 1,800万円; an integer amount denominated in 万円)",
      },
      shape: "man-yen-amount",
      quotePattern: /生涯|非課税保有限度額|買付残高/,
      statedAnswerPatterns: [
        /(?:生涯投資枠|生涯の投資枠|非課税保有限度額|生涯上限額?)(?:（[^）]*）)?(?:は|が|の上限は|：|:)?\s*(\d[\d,]*万円)/g,
        /(\d[\d,]*万円)(?:の)?(?:生涯投資枠|非課税保有限度額)/g,
      ],
    },
  ],
  patterns: [
    /nisa/,
    /年間|生涯|上限|限度額|投資枠|非課税枠|いくらまで/,
  ],
  exclusions: [
    // Legacy NISA products and other systems (different limits).
    /旧nisa|一般nisa|つみたてnisa|ジュニアnisa|ideco|確定拠出年金|個人年金/,
    // Not a limits question.
    /メリット|デメリット|おすすめ|始め方|開設|銘柄|選び方|歴史|いつから始|とは何|シミュレーション|計算|運用益|増える/,
  ],
  roleLabel: { ja: "", en: "" },
  templates: {
    ja: "{date}時点で、新NISAの年間投資枠は{annual}、生涯投資枠（非課税保有限度額）は{lifetime}です。",
    en: "As of {date}, the new NISA annual investment limit is {annual}, and the lifetime limit (tax-free holding limit) is {lifetime}.",
  },
  factDescription: {
    ja: "新NISAの年間投資枠と生涯投資枠（非課税保有限度額）",
    en: "the new NISA annual investment limit and lifetime investment limit (tax-free holding limit)",
  },
};

// (c) Hometown tax (furusato nozei) self-burden (R-PR-9c). The
// R-PR-8 measurement's B-04 fatal inverted the mechanism
// （自己負担は寄付金額－2,000円） in free generation; the slot pins
// the one hard amount. The 仕組み cue is a positive pattern because
// B-04 was a mechanism question — adoption stays strict through the
// field's quote requirement: the quote must explicitly state the
// self-burden (its definition), not merely contain the amount
// somewhere in a hometown-tax article.
const FURUSATO_SELF_BURDEN_ENTRY: GroundedResearchFactSlotEntry = {
  id: "furusato-nozei-self-burden",
  fields: [
    {
      id: "amount",
      label: { ja: "自己負担額", en: "self-burden amount" },
      shapeDescription: {
        ja: "自己負担額のみ（例: 2,000円。円単位の金額のみ）",
        en: "the self-burden amount only (e.g. 2,000 yen; an amount denominated in yen)",
      },
      shape: "yen-amount",
      quotePattern: /自己負担/,
      statedAnswerPatterns: [
        /自己負担(?:額)?(?:は|が|分は|分が)?\s*(\d[\d,]*円)/g,
        /実質(?:的な)?自己負担(?:額)?(?:は|が)?\s*(\d[\d,]*円)/g,
        /(\d[\d,]*円)(?:の|だけ)?自己負担/g,
      ],
    },
  ],
  patterns: [
    /ふるさと納税/,
    /自己負担|仕組み|しくみ/,
  ],
  exclusions: [
    // Different facts about the scheme (the slot answers one amount).
    /返礼品|おすすめ|ランキング|手続き|申し込み|申込方法|ワンストップ|上限額|控除上限|いくらまで|計算方法|シミュレーション|確定申告のやり方|寄附の方法/,
  ],
  roleLabel: { ja: "", en: "" },
  templates: {
    ja: "{date}時点で、ふるさと納税の自己負担額は{amount}です。",
    en: "As of {date}, the hometown-tax (furusato nozei) self-burden amount is {amount}.",
  },
  factDescription: {
    ja: "ふるさと納税で寄附者が自己負担する額",
    en: "the amount a donor bears out of pocket under the hometown-tax (furusato nozei) scheme",
  },
};

// (d) Salt intake targets (R-PR-9c). A composite fact: the men's
// and women's daily targets from Japan's Dietary Reference Intakes
// are only adoptable together — the R-PR-8 measurement's B-06 fatal
// attributed a single foreign-style figure to the ministry. Other
// countries' standards (WHO etc.) are vetoed: this slot is the
// Japanese standard pair.
const SALT_INTAKE_TARGET_ENTRY: GroundedResearchFactSlotEntry = {
  id: "salt-intake-target",
  fields: [
    {
      id: "male",
      label: { ja: "男性の目標量", en: "target for men" },
      shapeDescription: {
        ja: "男性の1日の目標量のみ（例: 7.5g未満。g単位で「未満」まで含めた表記）",
        en: "the daily target for men only (e.g. 7.5g未満; in grams, including the 未満 'under' qualifier)",
      },
      shape: "salt-target",
      quotePattern: /男性/,
      // Gender-first patterns only: in the combined standard
      // phrasing （男性7.5g未満、女性6.5g未満) a value-first pattern
      // would misread the men's value as the women's.
      statedAnswerPatterns: [
        /男性[^。]{0,14}?(\d+(?:\.\d+)?g(?:\/日)?未満)/g,
      ],
    },
    {
      id: "female",
      label: { ja: "女性の目標量", en: "target for women" },
      shapeDescription: {
        ja: "女性の1日の目標量のみ（例: 6.5g未満。g単位で「未満」まで含めた表記）",
        en: "the daily target for women only (e.g. 6.5g未満; in grams, including the 未満 'under' qualifier)",
      },
      shape: "salt-target",
      quotePattern: /女性/,
      statedAnswerPatterns: [
        /女性[^。]{0,14}?(\d+(?:\.\d+)?g(?:\/日)?未満)/g,
      ],
    },
  ],
  patterns: [
    /塩分|食塩/,
    /目安|基準|目標量?|何g|何グラム|どれくらい|どのくらい|摂取量|上限/,
  ],
  exclusions: [
    // Other standards and non-standard topics.
    /who|世界保健機関|海外|アメリカ|米国|イギリス|レシピ|料理|献立|減塩|食品|食べ物|外食|メニュー|歴史|由来|血圧を下げ|治療法/,
  ],
  roleLabel: { ja: "", en: "" },
  templates: {
    ja: "{date}時点で、塩分（食塩相当量）の1日の目標量は、男性{male}、女性{female}です。",
    en: "As of {date}, the daily salt (salt-equivalent) intake target is {male} for men and {female} for women.",
  },
  factDescription: {
    ja: "日本の食事摂取基準における塩分（食塩相当量）の1日の目標量（男性分と女性分）",
    en: "the daily salt (salt-equivalent) intake targets for men and for women in Japan's Dietary Reference Intakes",
  },
};

// (e) Vaccination start timing (R-PR-9c). A PAIR fact {vaccine,
// start}: the start field's quote must name the vaccine
// (quoteIncludesFieldId), agreement requires the pair to co-occur
// in one evidence unit, and stated-answer extraction for the start
// is anchored on the candidate's vaccine (only timings stated about
// that vaccine compete). The R-PR-8 measurement's B-10 fatal listed
// another country's schedule （出生時 BCG etc.) as Japan's; here the
// values can only come from packet excerpts, per vaccine. Matching
// requires a NAMED vaccine — a general schedule question names
// several pairs at once and is not this slot's single pair fact.
const VACCINATION_START_ENTRY: GroundedResearchFactSlotEntry = {
  id: "vaccination-start-jp",
  fields: [
    {
      id: "vaccine",
      label: { ja: "ワクチン名", en: "vaccine name" },
      shapeDescription: {
        ja: "ワクチン名のみ（抜粋に現れる表記のまま）",
        en: "the vaccine name only, in the surface form used in the excerpt",
      },
      shape: "vaccine-name",
    },
    {
      id: "start",
      label: { ja: "接種の開始時期", en: "vaccination start timing" },
      shapeDescription: {
        ja: "接種を始められる時期のみ（例: 生後2か月、生後5か月から8か月。抜粋に現れる表記のまま）",
        en: "the earliest vaccination timing only (e.g. 生後2か月; in the surface form used in the excerpt)",
      },
      shape: "start-timing",
      quoteIncludesFieldId: "vaccine",
      statedAnswerExtractor: "anchored-timings",
      statedAnswerAnchorFieldId: "vaccine",
    },
  ],
  patterns: [
    /bcg|ヒブ|hib|小児用肺炎球菌|肺炎球菌|b型肝炎|ロタウイルス|ロタ|四種混合|五種混合|三種混合|二種混合|ポリオ|mr|麻しん|風しん|水痘|みずぼうそう|日本脳炎|hpv|子宮頸がん|おたふくかぜ|a型肝炎|インフルエンザ/,
    /いつから|何か月から|何ヶ月から|何カ月から|何ヵ月から|開始|接種時期|打てる時期|受けられる時期|スケジュール|生後何/,
  ],
  exclusions: [
    // Other facts about vaccination, and other countries' schedules.
    /歴史|由来|海外|アメリカ|米国|イギリス|費用|料金|副反応|効果|回数|間隔|同時接種|成分/,
  ],
  roleLabel: { ja: "", en: "" },
  templates: {
    ja: "{date}時点で、{vaccine}の接種開始時期は{start}です。",
    en: "As of {date}, the vaccination start timing for {vaccine} is {start}.",
  },
  factDescription: {
    ja: "質問で指定されたワクチンの、日本の定期接種での接種開始時期",
    en: "the start timing of the named vaccine in Japan's routine immunization schedule",
  },
};

// (f) Product price. The question must carry a price cue AND a
// product identifier (a katakana name, a quoted name, a model-like
// alphanumeric token, or a known product word). Compound questions
// (price AND release date/specs/...), comparisons, historical prices,
// and non-product prices (stocks, rent, fees, fuel) are vetoed: the
// slot answers exactly one fact.
const PRODUCT_IDENTIFIER_PATTERN =
  /[ァ-ヶ][ァ-ヶー・]{1,}|「[^」]{2,}」|『[^』]{2,}』|[a-z]+\s?\d|\d\s?[a-z]+|iphone|pixel|galaxy|xperia|airpods|ipad|macbook|playstation|surface|thinkpad|kindle/;

const PRODUCT_PRICE_ENTRY: GroundedResearchFactSlotEntry = {
  id: "product-price",
  fields: [
    {
      id: "amount",
      label: { ja: "価格", en: "price" },
      shapeDescription: {
        ja: "金額のみ（例: 219,800円。製品名・説明を含めない）",
        en: "an amount only (e.g. 219,800 yen; no product name or explanation)",
      },
      shape: "currency-amount",
      statedAnswerExtractor: "single-price",
    },
  ],
  patterns: [
    /価格|値段|定価|希望小売価格|お値段|いくら|price|cost|how much/,
    PRODUCT_IDENTIFIER_PATTERN,
  ],
  exclusions: [
    // Compound questions: the slot covers the price only.
    /発売日|発売|リリース|スペック|仕様|サイズ|重さ|重量|バッテリー|電池|カメラ|画素|容量|色|カラー|在庫|予約|レビュー|評価|release date|spec/,
    // Comparison or history.
    /比較|どっち|どちら|違い|vs\.?|当時|過去|歴代|予想|予測|今後|\d{4}\s*年|compared|versus/,
    // Not a product price.
    /株価|株式|相場|為替|金利|地価|家賃|賃料|ガソリン|原油|電気料金|ガス料金|月額|年会費|保険料|授業料|送料|手数料|中古|下取り|買取|最安|一覧|リスト|stock|rent/,
  ],
  roleLabel: { ja: "", en: "" },
  templates: {
    ja: "{date}時点の価格は{amount}です。",
    en: "As of {date}, the price is {amount}.",
  },
  factDescription: {
    ja: "質問で指定された製品の、日本での販売価格",
    en: "the price in Japan of the product named in the question",
  },
};

/** The registered slot type entries, in match order (§9.1). */
export const GROUNDED_RESEARCH_FACT_SLOT_ENTRIES: readonly GroundedResearchFactSlotEntry[] = [
  INCUMBENT_PRIME_MINISTER_ENTRY,
  NISA_LIMITS_ENTRY,
  FURUSATO_SELF_BURDEN_ENTRY,
  SALT_INTAKE_TARGET_ENTRY,
  VACCINATION_START_ENTRY,
  PRODUCT_PRICE_ENTRY,
];

/**
 * Deterministic question → type matching (§9.1). Returns the first
 * entry whose positive patterns all match and whose exclusions all
 * miss, or null when the question is not a registered fact question.
 * Pure and total: any string is a valid input.
 */
export function matchGroundedResearchFactSlotEntry(query: string): GroundedResearchFactSlotEntry | null {
  if (typeof query !== "string" || query.trim().length === 0) return null;
  const normalized = normalizeGroundedResearchFactSlotQuery(query);
  for (const entry of GROUNDED_RESEARCH_FACT_SLOT_ENTRIES) {
    if (!entry.patterns.every((pattern) => pattern.test(normalized))) continue;
    if (entry.exclusions.some((pattern) => pattern.test(normalized))) continue;
    return entry;
  }
  return null;
}

/**
 * §9.2(d) shape check for one field's value — a simple, deterministic
 * form test (the value itself is never rewritten), generated from
 * the field's declared shape:
 * - person-name: the value carries no numeric token;
 * - currency-amount: the value carries a currency-marked numeric
 *   token (an amount with a 円/ドル/usd/jpy/eur/gbp suffix or a
 *   $/¥/€/£ prefix). A bare number is not a price shape: a model
 *   number or a year must not pass as a price;
 * - man-yen-amount: an integer amount denominated in 万円 (the
 *   E-09 unit slip "3.6万円" is not an integer 万円 amount);
 * - yen-amount: an amount denominated in 円;
 * - salt-target: a gram target with the 未満 ("under") qualifier,
 *   with or without the /日 denominator the sources use;
 * - vaccine-name: a short name carrying no numeric or measure token;
 * - start-timing: the value carries a timing token (an age in
 *   months/years/weeks/days, or a birth-time expression).
 * Digits are read after NFKC normalization, so full-width digits
 * count the same as half-width ones.
 */
export function checkGroundedResearchFactSlotFieldShape(
  field: GroundedResearchFactSlotFieldDefinition,
  value: string,
): boolean {
  const normalized = value.normalize("NFKC");
  switch (field.shape) {
    case "person-name":
      return !/\d/.test(normalized);
    case "currency-amount":
      return /(?:[$¥€£]\s*)?\d[\d,]*(?:\.\d+)?\s*(?:円|ドル|usd|jpy|eur|gbp)|[$¥€£]\s*\d[\d,]*(?:\.\d+)?/i.test(normalized);
    case "man-yen-amount":
      return /^\d[\d,]*万円$/.test(normalized);
    case "yen-amount":
      return /^\d[\d,]*円$/.test(normalized);
    case "salt-target":
      return /^\d+(?:\.\d+)?g(?:\/日)?未満$/.test(normalized);
    case "vaccine-name":
      return normalized.length >= 1 && normalized.length <= 24 && !/\d/.test(normalized) && !/(円|万円|未満|か月|ヶ月)/.test(normalized);
    case "start-timing":
      return normalized.length <= 30
        && /(?:生後\s*)?\d+\s*(?:か月|ヶ月|カ月|ヵ月|歳|週|日)|出生時|出生直後|生後すぐ/.test(normalized);
  }
}

// --- Stated-answer extraction helpers (pure string operations) --------------

/**
 * Values a text STATES AS ITS ANSWER for a pattern-declared field:
 * the single capture group of each of the field's stated-answer
 * patterns, in appearance order, deduped. Raw surface forms — the
 * caller normalizes for comparison.
 */
export function extractGroundedResearchFactSlotStatedPatternValues(
  text: string,
  field: GroundedResearchFactSlotFieldDefinition,
): string[] {
  const values = new Set<string>();
  for (const pattern of field.statedAnswerPatterns ?? []) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (value !== undefined && value.length > 0) values.add(value);
    }
  }
  return [...values];
}

const SLOT_TIMING_TOKEN_PATTERN =
  /(?:生後\s*)?\d+\s*(?:か月|ヶ月|カ月|ヵ月)(?:\s*(?:から|〜|~)\s*(?:生後\s*)?\d+\s*(?:か月|ヶ月|カ月|ヵ月))?|(?:生後\s*)?\d+\s*(?:歳|週|日)|出生時|出生直後/g;

/**
 * Comparison form of a timing value: NFKC, lowercased, whitespace
 * and comma-class characters removed (the §6.2 form normalization),
 * with the month-unit variants （ヶ月/カ月/ヵ月） unified to か月 —
 * surface variants of the same timing compare equal here, while the
 * verbatim rules (quote substring, agreement) keep using the raw
 * surface forms.
 */
export function canonicalGroundedResearchFactSlotTiming(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s,，]/g, "").replace(/ヶ月|カ月|ヵ月/g, "か月");
}

/**
 * Timing values a text STATES for one anchor value (pair facts):
 * the timing tokens appearing in a sentence that also names the
 * anchor (e.g. the timings a schedule sentence states for one
 * vaccine), in canonical comparison form, deduped. Statements about
 * other anchors in other sentences never enter the set.
 */
export function extractGroundedResearchFactSlotAnchoredTimings(
  text: string,
  anchorValue: string,
): string[] {
  const anchor = anchorValue.normalize("NFKC").toLowerCase();
  if (anchor.length === 0) return [];
  const timings = new Set<string>();
  for (const sentence of text.split(/[。！？\n]/)) {
    if (!sentence.normalize("NFKC").toLowerCase().includes(anchor)) continue;
    for (const match of sentence.matchAll(SLOT_TIMING_TOKEN_PATTERN)) {
      timings.add(canonicalGroundedResearchFactSlotTiming(match[0]));
    }
  }
  return [...timings];
}

// --- Slot generation output (§4.3, composite form) --------------------------

/** One field of a slot candidate: the value, its source, its quote. */
export interface GroundedResearchFactSlotFieldCandidate {
  value: string;
  /** The packet source id the model claims ("S1", "S2", ...). */
  src: string;
  /** A sentence copied verbatim from that source's excerpt. */
  quote: string;
}

/**
 * One slot candidate as generated (composite contract, R-PR-9c): a
 * set of field candidates keyed by field id. Each field is backed
 * individually; the evaluation requires every field of the matched
 * entry to be present.
 */
export interface GroundedResearchFactSlotCandidate {
  fields: Readonly<Record<string, GroundedResearchFactSlotFieldCandidate>>;
}

export interface ParsedGroundedResearchFactSlotOutput {
  format: "json" | "text" | null;
  candidate: GroundedResearchFactSlotCandidate | null;
}

function slotFieldCandidateFromFields(
  value: unknown,
  src: unknown,
  quote: unknown,
): GroundedResearchFactSlotFieldCandidate | null {
  if (typeof value !== "string" || typeof src !== "string" || typeof quote !== "string") return null;
  const trimmed = { value: value.trim(), src: src.trim(), quote: quote.trim() };
  if (trimmed.value.length === 0 || trimmed.src.length === 0 || trimmed.quote.length === 0) return null;
  // The generation contract's "cannot determine" sentinel.
  if (trimmed.value === "null" || trimmed.src === "null" || trimmed.quote === "null") return null;
  return trimmed;
}

function slotCandidateFromFieldsRecord(fields: unknown): GroundedResearchFactSlotCandidate | null {
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) return null;
  const collected: Record<string, GroundedResearchFactSlotFieldCandidate> = {};
  for (const [fieldId, rawField] of Object.entries(fields as Record<string, unknown>)) {
    if (typeof rawField !== "object" || rawField === null || Array.isArray(rawField)) return null;
    const record = rawField as Record<string, unknown>;
    const fieldCandidate = slotFieldCandidateFromFields(record.value, record.src, record.quote);
    if (fieldCandidate === null) return null;
    collected[fieldId] = fieldCandidate;
  }
  if (Object.keys(collected).length === 0) return null;
  return { fields: collected };
}

function parseSlotJson(text: string): GroundedResearchFactSlotCandidate | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const value: unknown = JSON.parse(text.slice(start, index + 1));
          if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
          const record = value as Record<string, unknown>;
          // The composite form only: {"fields": {...}} — and the
          // {"fields": null} sentinel yields no candidate, as does
          // any other shape (including the pre-R-PR-9c flat form).
          return slotCandidateFromFieldsRecord(record.fields);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function parseSlotTextForm(text: string): GroundedResearchFactSlotCandidate | null {
  const lines = text.split(/\r?\n/);
  let inBlock = false;
  const collected: Record<string, GroundedResearchFactSlotFieldCandidate> = {};
  let fieldId: string | undefined;
  let value: string | undefined;
  let src: string | undefined;
  let quote: string | undefined;
  const flushField = (): boolean => {
    if (fieldId === undefined) return true;
    const fieldCandidate = slotFieldCandidateFromFields(value, src, quote);
    if (fieldCandidate === null) return false;
    collected[fieldId] = fieldCandidate;
    return true;
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "SLOT") {
      inBlock = true;
      fieldId = undefined;
      value = undefined;
      src = undefined;
      quote = undefined;
      continue;
    }
    if (!inBlock) continue;
    if (line === "END") {
      if (!flushField()) return null;
      return Object.keys(collected).length > 0 ? { fields: collected } : null;
    }
    if (line.startsWith("F:")) {
      if (!flushField()) return null;
      fieldId = line.slice(2).trim();
      value = undefined;
      src = undefined;
      quote = undefined;
      continue;
    }
    if (fieldId === undefined) continue;
    if (line.startsWith("A:")) value = line.slice(2).trim();
    else if (line.startsWith("S:")) src = line.slice(2).trim();
    else if (line.startsWith("Q:")) quote = line.slice(2).trim();
  }
  return null;
}

/**
 * Parses the slot generation output in the §4.3 forms (composite
 * since R-PR-9c): the JSON form {"fields": {...}} first, then the
 * SLOT/F:/A:/S:/Q:/END text form. Anything else — prose, a
 * records-shaped JSON, the null sentinel, a field with a missing
 * value/src/quote — yields no candidate, which the caller treats as
 * a fall-through, never as a request failure (§12).
 */
export function parseGroundedResearchFactSlotOutput(text: string): ParsedGroundedResearchFactSlotOutput {
  if (typeof text !== "string" || text.trim().length === 0) return { format: null, candidate: null };
  // The text form announces itself with the SLOT marker; try it first
  // so a brace inside a quoted sentence cannot misroute the parse.
  if (text.trimStart().startsWith("SLOT")) {
    return { format: "text", candidate: parseSlotTextForm(text) };
  }
  const jsonCandidate = parseSlotJson(text);
  if (jsonCandidate !== null || text.includes("{")) return { format: "json", candidate: jsonCandidate };
  const textCandidate = parseSlotTextForm(text);
  if (textCandidate !== null) return { format: "text", candidate: textCandidate };
  return { format: null, candidate: null };
}
