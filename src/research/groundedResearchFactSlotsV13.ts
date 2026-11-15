// Single-fact slot type entries (SYNTHESIS_RECORDS_DESIGN_2026-11-14
// §9.1, R-PR-6).
//
// §9.1 places the type entries on the high-volatility fact registry
// side: the registry provides, per fact type, the question pattern,
// the rendering templates (ja/en) and the kind of the answer. No such
// registry module exists in this repository yet (checked 2026-11-15:
// the only "registry" modules are the tool/plugin/service registries,
// and originChatResponsePolicy detects volatile topics for response
// policy, but neither carries fact-type templates or answer kinds).
// Per the R-PR-6 adjudication, the interface and the first entries
// therefore live here, on the records side, in this separate module —
// pure data and string operations only, with no dependency on the
// records module — so the entries can move to the registry unchanged
// when it appears.
//
// Matching is deterministic pattern matching over the NFKC-normalized,
// lowercased query, and it is deliberately NARROW: a false match is
// the biggest danger (§9.1), because a matched question spends a
// generation on the slot and suppresses the records retry layer. Each
// entry requires ALL of its positive patterns and vetoes on ANY
// exclusion. Patterns are authored against the normalized query.

export type GroundedResearchFactSlotAnswerKind = "person-name" | "price";

export interface GroundedResearchFactSlotEntry {
  /** Stable type id, recorded in the stage metrics (§11). */
  id: string;
  /** The kind of the answer value; drives the §9.2(d) shape check. */
  answerKind: GroundedResearchFactSlotAnswerKind;
  /** Every pattern must match the normalized query. */
  patterns: readonly RegExp[];
  /** Any match vetoes the entry, even when all patterns match. */
  exclusions: readonly RegExp[];
  /** Type-provided label for the {role} template token ("" when unused). */
  roleLabel: Readonly<{ ja: string; en: string }>;
  /** §9.3 rendering templates; tokens: {date}, {role}, {answer}. */
  templates: Readonly<{ ja: string; en: string }>;
  /** What the generation is asked to extract (§9.2), per language. */
  factDescription: Readonly<{ ja: string; en: string }>;
  /** Human-readable shape of the answer, for the generation prompt. */
  answerShapeDescription: Readonly<{ ja: string; en: string }>;
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
  answerKind: "person-name",
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
    ja: "{date}時点で、{role}は{answer}です。",
    en: "As of {date}, the {role} is {answer}.",
  },
  factDescription: {
    ja: "現在の日本の内閣総理大臣の氏名",
    en: "the name of the current Prime Minister of Japan",
  },
  answerShapeDescription: {
    ja: "人名のみ（役職・敬称・説明を含めない）",
    en: "a person's name only (no title, honorific, or explanation)",
  },
};

// (b) Product price. The question must carry a price cue AND a
// product identifier (a katakana name, a quoted name, a model-like
// alphanumeric token, or a known product word). Compound questions
// (price AND release date/specs/...), comparisons, historical prices,
// and non-product prices (stocks, rent, fees, fuel) are vetoed: the
// slot answers exactly one fact.
const PRODUCT_IDENTIFIER_PATTERN =
  /[ァ-ヶ][ァ-ヶー・]{1,}|「[^」]{2,}」|『[^』]{2,}』|[a-z]+\s?\d|\d\s?[a-z]+|iphone|pixel|galaxy|xperia|airpods|ipad|macbook|playstation|surface|thinkpad|kindle/;

const PRODUCT_PRICE_ENTRY: GroundedResearchFactSlotEntry = {
  id: "product-price",
  answerKind: "price",
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
    ja: "{date}時点の価格は{answer}です。",
    en: "As of {date}, the price is {answer}.",
  },
  factDescription: {
    ja: "質問で指定された製品の、日本での販売価格",
    en: "the price in Japan of the product named in the question",
  },
  answerShapeDescription: {
    ja: "金額のみ（例: 219,800円。製品名・説明を含めない）",
    en: "an amount only (e.g. 219,800 yen; no product name or explanation)",
  },
};

/** The registered slot type entries, in match order (§9.1). */
export const GROUNDED_RESEARCH_FACT_SLOT_ENTRIES: readonly GroundedResearchFactSlotEntry[] = [
  INCUMBENT_PRIME_MINISTER_ENTRY,
  PRODUCT_PRICE_ENTRY,
];

/**
 * Deterministic question → type matching (§9.1). Returns the first
 * entry whose positive patterns all match and whose exclusions all
 * miss, or null when the question is not a registered single-fact
 * question. Pure and total: any string is a valid input.
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
 * §9.2(d) shape check — a simple, deterministic form test on the
 * model's answer value (the value itself is never rewritten):
 * - person-name: the value carries no numeric token;
 * - price: the value carries a currency-marked numeric token
 *   (an amount with a 円/ドル/usd/jpy/eur/gbp suffix or a
 *   $/¥/€/£ prefix). A bare number is not a price shape: a model
 *   number or a year must not pass as a price.
 * Digits are read after NFKC normalization, so full-width digits
 * count the same as half-width ones.
 */
export function checkGroundedResearchFactSlotAnswerShape(
  entry: GroundedResearchFactSlotEntry,
  answer: string,
): boolean {
  const normalized = answer.normalize("NFKC");
  if (entry.answerKind === "price") {
    return /(?:[$¥€£]\s*)?\d[\d,]*(?:\.\d+)?\s*(?:円|ドル|usd|jpy|eur|gbp)|[$¥€£]\s*\d[\d,]*(?:\.\d+)?/i.test(normalized);
  }
  return !/\d/.test(normalized);
}

// --- Slot generation output (§4.3) ------------------------------------------

/** One slot candidate as generated: the value, its source, its quote. */
export interface GroundedResearchFactSlotCandidate {
  answer: string;
  /** The packet source id the model claims ("S1", "S2", ...). */
  src: string;
  /** A sentence copied verbatim from that source's excerpt. */
  quote: string;
}

export interface ParsedGroundedResearchFactSlotOutput {
  format: "json" | "text" | null;
  candidate: GroundedResearchFactSlotCandidate | null;
}

function slotCandidateFromFields(answer: unknown, src: unknown, quote: unknown): GroundedResearchFactSlotCandidate | null {
  if (typeof answer !== "string" || typeof src !== "string" || typeof quote !== "string") return null;
  const trimmed = { answer: answer.trim(), src: src.trim(), quote: quote.trim() };
  if (trimmed.answer.length === 0 || trimmed.src.length === 0 || trimmed.quote.length === 0) return null;
  // The generation contract's "cannot determine" sentinel.
  if (trimmed.answer === "null" || trimmed.src === "null" || trimmed.quote === "null") return null;
  return trimmed;
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
          return slotCandidateFromFields(record.answer, record.src, record.quote);
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
  let answer: string | undefined;
  let src: string | undefined;
  let quote: string | undefined;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "SLOT") {
      inBlock = true;
      answer = undefined;
      src = undefined;
      quote = undefined;
      continue;
    }
    if (!inBlock) continue;
    if (line === "END") {
      return slotCandidateFromFields(answer, src, quote);
    }
    if (line.startsWith("A:")) answer = line.slice(2).trim();
    else if (line.startsWith("S:")) src = line.slice(2).trim();
    else if (line.startsWith("Q:")) quote = line.slice(2).trim();
  }
  return null;
}

/**
 * Parses the slot generation output in the §4.3 forms: the JSON form
 * first, then the SLOT/A:/S:/Q:/END text form. Anything else — prose,
 * a records-shaped JSON, the null sentinel, missing fields — yields
 * no candidate, which the caller treats as a fall-through, never as
 * a request failure (§12).
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
