import type { OriginResearchSource } from "../legacy/originResearchSource.js";
import { groundedResearchPacketDateForms } from "./groundedResearchSynthesisV12.js";

/**
 * Records-based grounded research synthesis (V13) — packet layer.
 *
 * Design canon: ~/workspace/origin-fix/SYNTHESIS_RECORDS_DESIGN_2026-11-14.md
 * This module is R-PR-1 of that design: evidence segmentation (E-IDs) and
 * records-packet construction (pre-selection + verbatim numeric list).
 * It is intentionally NOT wired into any router yet; the V12 text path
 * remains the only live synthesis path.
 *
 * Core invariant (design §3): the packet built here is the exact set the
 * validator will later judge against — the sources shown to the model, the
 * segmented evidence units, and the validation source map are one and the
 * same. The model never sees a URL: rendering and citation tokens are the
 * app's job in later PRs.
 *
 * Note on duplicated helpers: V12's `compactExcerpt` and `numericTokens`
 * are module-private, and R-PR-1 must not modify existing files, so the
 * identical rules are re-implemented below (`compactRecordsExcerpt`,
 * `recordsNumericTokens`). The rules must stay in lockstep with V12.
 */

export const RECORDS_PACKET_MAX_SOURCES = 4;
export const RECORDS_PACKET_EXCERPT_CHARS = 800;
export const RECORDS_MAX_UNITS_PER_SOURCE = 12;
export const RECORDS_NUMERIC_LIST_MAX_PER_SOURCE = 10;
export const RECORDS_MIN_UNIT_CHARS = 8;

type RecordsSource = Pick<
  OriginResearchSource,
  "title" | "url" | "excerpt" | "domain" | "evidenceLevel" | "freshness" | "sourceType" | "sourceAuthority" | "revisionTimestamp" | "retrievedAt"
>;

export interface GroundedResearchEvidenceUnit {
  /** E-ID in the form `E{sourceNumber}_{unitNumber}` (design §3.2). */
  id: string;
  /** Owning source ID (`S{sourceNumber}`), derived from the E-ID prefix. */
  sourceId: string;
  /** 1-based unit number within the source. */
  index: number;
  /** Verbatim slice of the packet excerpt (outer whitespace trimmed). */
  text: string;
}

export interface GroundedResearchRecordsPacketSource {
  id: string;
  /** 0-based position inside the packet. */
  index: number;
  title: string;
  /** App-side only: used for rendering and validation, never shown to the model. */
  url: string;
  domain: string;
  evidenceLevel: OriginResearchSource["evidenceLevel"];
  freshness: OriginResearchSource["freshness"];
  sourceAuthority: string;
  publishedDateForms: string[];
  retrievedDateForms: string[];
  /** The exact packet excerpt string (compacted, capped) that was segmented. */
  excerpt: string;
  units: GroundedResearchEvidenceUnit[];
  /** Verbatim numeric surface forms for the prompt (design §3.3). */
  numericTokens: string[];
}

export interface GroundedResearchRecordsPacket {
  sources: GroundedResearchRecordsPacketSource[];
  totalUnits: number;
  numericTokenCount: number;
}

function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Same compaction rule as V12's `compactExcerpt`, with the records cap (§3.1). */
function compactRecordsExcerpt(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, RECORDS_PACKET_EXCERPT_CHARS);
}

/**
 * Same numeric-token extraction as V12's `numericTokens` (NFKC, deduped in
 * appearance order, tokens need >= 2 digits or a semantic suffix). V12 also
 * strips citation tokens from its input first; packet text never contains
 * citation tokens, so that step is inapplicable here.
 */
function recordsNumericTokens(value: string): string[] {
  const matches = value.normalize("NFKC").match(/(?:[$¥€£]\s*)?\d[\d,]*(?:\.\d+)?(?:%|円|ドル|usd|jpy|eur|gbp|年|月|日|万|億|兆)?/gi) ?? [];
  return [...new Set(matches.map((token) => token.replace(/[\s,，]/g, "").toLowerCase()).filter((token) => {
    const digits = token.match(/\d/g)?.length ?? 0;
    const hasSemanticSuffix = /[%円ドル]|usd|jpy|eur|gbp|年|月|日|万|億|兆/i.test(token);
    return digits >= 2 || hasSemanticSuffix;
  }))];
}

// ---------------------------------------------------------------------------
// Evidence segmentation (design §3.2)
// ---------------------------------------------------------------------------

const SENTENCE_TERMINATORS = new Set(["。", "！", "？"]);
const BRACKET_OPENERS = new Set(["「", "『", "（", "〈", "《"]);
const BRACKET_CLOSERS = new Set(["」", "』", "）", "〉", "》"]);
const TRAILING_ABSORB_CHARS = new Set(["」", "』", "）", "〉", "》", "\"", "'", "”", "’"]);
const JAPANESE_CHAR_PATTERN = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

function isAsciiDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isAsciiUpper(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "A" && ch <= "Z";
}

function isJapaneseChar(ch: string | undefined): boolean {
  return ch !== undefined && JAPANESE_CHAR_PATTERN.test(ch);
}

function isWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch);
}

/**
 * Rule 1 for ASCII periods: a `.` ends a sentence only when it is not part
 * of a decimal (digit `.` digit) or of a whitespace-free token (domain,
 * version string), and what follows — after any closing brackets/quotes —
 * is end-of-text, a Japanese character, or whitespace followed by an
 * uppercase letter or a Japanese character.
 */
function asciiPeriodEndsSentence(text: string, dotIndex: number): boolean {
  if (isAsciiDigit(text[dotIndex - 1]) && isAsciiDigit(text[dotIndex + 1])) return false;
  let j = dotIndex + 1;
  while (j < text.length && TRAILING_ABSORB_CHARS.has(text[j])) j += 1;
  if (j >= text.length) return true;
  const next = text[j];
  if (isJapaneseChar(next)) return true;
  if (isWhitespace(next)) {
    let k = j;
    while (k < text.length && isWhitespace(text[k])) k += 1;
    if (k >= text.length) return true;
    return isAsciiUpper(text[k]) || isJapaneseChar(text[k]);
  }
  return false;
}

interface UnitSpan {
  start: number;
  end: number;
}

function splitEvidenceSpans(text: string): UnitSpan[] {
  const spans: UnitSpan[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (BRACKET_OPENERS.has(ch)) {
      depth += 1;
      i += 1;
      continue;
    }
    if (BRACKET_CLOSERS.has(ch)) {
      if (depth > 0) depth -= 1;
      i += 1;
      continue;
    }
    const isTerminator =
      depth === 0 &&
      (SENTENCE_TERMINATORS.has(ch) || (ch === "." && asciiPeriodEndsSentence(text, i)));
    if (isTerminator) {
      let end = i + 1;
      // Rule 3: a run of sentence-final punctuation and closing
      // brackets/quotes belongs to the sentence that just ended.
      while (end < text.length) {
        const tail = text[end];
        if (SENTENCE_TERMINATORS.has(tail) || TRAILING_ABSORB_CHARS.has(tail)) {
          end += 1;
          continue;
        }
        break;
      }
      spans.push({ start, end });
      start = end;
      i = end;
      continue;
    }
    i += 1;
  }
  if (start < text.length) spans.push({ start, end: text.length });
  return spans;
}

function spanText(text: string, span: UnitSpan): string {
  return text.slice(span.start, span.end).trim();
}

/**
 * Splits one source's packet excerpt into evidence units and assigns
 * E-IDs (`E{sourceNumber}_{unitNumber}`). Pure and deterministic: prompt
 * construction and validation share this exact function so the units the
 * model sees are the units quotes are judged against (design §3.2).
 */
export function segmentEvidenceText(excerpt: string, sourceNumber: number): GroundedResearchEvidenceUnit[] {
  const sourceId = `S${sourceNumber}`;
  const rawSpans = splitEvidenceSpans(excerpt).filter((span) => spanText(excerpt, span).length > 0);

  // Rule 5: a unit shorter than RECORDS_MIN_UNIT_CHARS merges into the
  // previous unit (a short first unit has no predecessor and stays).
  const merged: UnitSpan[] = [];
  for (const span of rawSpans) {
    const previous = merged[merged.length - 1];
    if (previous && spanText(excerpt, span).length < RECORDS_MIN_UNIT_CHARS) {
      previous.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }

  // Unit cap (§3.2): overflow units merge into the last unit so no text
  // is dropped, only the number of addressable units is bounded.
  if (merged.length > RECORDS_MAX_UNITS_PER_SOURCE) {
    const overflowEnd = merged[merged.length - 1].end;
    merged.length = RECORDS_MAX_UNITS_PER_SOURCE;
    merged[RECORDS_MAX_UNITS_PER_SOURCE - 1].end = overflowEnd;
  }

  return merged.map((span, unitIndex) => ({
    id: `E${sourceNumber}_${unitIndex + 1}`,
    sourceId,
    index: unitIndex + 1,
    text: spanText(excerpt, span),
  }));
}

// ---------------------------------------------------------------------------
// Records packet construction (design §3.1, §3.3, §5.2)
// ---------------------------------------------------------------------------

/**
 * Verbatim numeric forms for one source (design §3.3). Extracted from the
 * title + packet excerpt + packet date forms with the validator's own
 * token rule. Time-of-day fragments (HH:MM[:SS]) and substrings that only
 * occur inside a URL are scrubbed from the haystack first so their tokens
 * never reach the list; the packet excerpt itself is never rewritten.
 */
function buildRecordsNumericList(
  source: RecordsSource,
  excerpt: string,
  publishedDateForms: string[],
  retrievedDateForms: string[],
): string[] {
  const haystack = [source.title, excerpt, ...publishedDateForms, ...retrievedDateForms].join(" ");
  const scrubbed = haystack
    .replace(/https?:\/\/[^\s]+/g, " ")
    .replace(/\d{1,2}:\d{2}(?::\d{2})?\b/g, " ");
  return recordsNumericTokens(scrubbed).slice(0, RECORDS_NUMERIC_LIST_MAX_PER_SOURCE);
}

/**
 * Builds the records packet from the grounding selection, in selection
 * order: sources with an unsafe URL or an empty (post-compaction) excerpt
 * are excluded, the survivors are renumbered S1.. and capped at
 * RECORDS_PACKET_MAX_SOURCES (design §3.1, §3.2 rule 6). The returned
 * packet is the single source of truth for prompt and validation alike.
 */
export function buildGroundedResearchRecordsPacket(
  sources: readonly RecordsSource[],
): GroundedResearchRecordsPacket {
  const packetSources: GroundedResearchRecordsPacketSource[] = [];
  for (const source of sources) {
    if (packetSources.length >= RECORDS_PACKET_MAX_SOURCES) break;
    const url = safeHttpsUrl(source.url);
    if (!url) continue;
    const excerpt = compactRecordsExcerpt(source.excerpt);
    if (!excerpt) continue;
    const index = packetSources.length;
    const domain = source.domain || (() => {
      try { return new URL(url).hostname; } catch { return "unknown"; }
    })();
    const publishedDateForms = groundedResearchPacketDateForms(source.revisionTimestamp);
    const retrievedDateForms = groundedResearchPacketDateForms(source.retrievedAt);
    packetSources.push({
      id: `S${index + 1}`,
      index,
      title: source.title,
      url,
      domain,
      evidenceLevel: source.evidenceLevel,
      freshness: source.freshness,
      sourceAuthority: source.sourceAuthority ?? (source.sourceType === "encyclopedia" ? "secondary-reference" : "unclassified"),
      publishedDateForms,
      retrievedDateForms,
      excerpt,
      units: segmentEvidenceText(excerpt, index + 1),
      numericTokens: buildRecordsNumericList(source, excerpt, publishedDateForms, retrievedDateForms),
    });
  }
  return {
    sources: packetSources,
    totalUnits: packetSources.reduce((sum, source) => sum + source.units.length, 0),
    numericTokenCount: packetSources.reduce((sum, source) => sum + source.numericTokens.length, 0),
  };
}

/**
 * Model-facing rendering of the packet's evidence section (design §5.2).
 * The model sees source IDs, domains, metadata, the verbatim numeric list,
 * and the E-ID unit lines — never a URL and never a citation token.
 * Verbatim excerpt text inside units is data and is passed through as-is.
 */
export function formatGroundedResearchRecordsPacket(packet: GroundedResearchRecordsPacket): string {
  return packet.sources.map((source) => [
    `S${source.index + 1}（${source.domain}）`,
    `title_json: ${JSON.stringify(source.title)}`,
    `domain_json: ${JSON.stringify(source.domain)}`,
    `evidenceLevel_json: ${JSON.stringify(source.evidenceLevel)}`,
    `freshness_json: ${JSON.stringify(source.freshness)}`,
    `publishedDate_json: ${JSON.stringify(source.publishedDateForms[0] ?? null)}`,
    `publishedDateJa_json: ${JSON.stringify(source.publishedDateForms[1] ?? null)}`,
    `retrievedDate_json: ${JSON.stringify(source.retrievedDateForms[0] ?? null)}`,
    `retrievedDateJa_json: ${JSON.stringify(source.retrievedDateForms[1] ?? null)}`,
    `sourceAuthority_json: ${JSON.stringify(source.sourceAuthority)}`,
    ...(source.numericTokens.length ? [`原文の数値表記: ${source.numericTokens.join("、")}`] : []),
    ...source.units.map((unit) => `[${unit.id}] ${unit.text}`),
  ].join("\n")).join("\n\n");
}
