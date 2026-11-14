import type { OriginResearchSource } from "../legacy/originResearchSource.js";
import { groundedResearchPacketDateForms } from "./groundedResearchSynthesisV12.js";

/**
 * Records-based grounded research synthesis (V13) — packet layer.
 *
 * Design canon: ~/workspace/origin-fix/SYNTHESIS_RECORDS_DESIGN_2026-11-14.md
 * This module holds R-PR-1 of that design (evidence segmentation (E-IDs)
 * and records-packet construction: pre-selection + verbatim numeric list)
 * and R-PR-2 (the record parser for the JSON and text forms, and the
 * per-record validator with the set-level coverage re-check, design §4/§6).
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

// ---------------------------------------------------------------------------
// Record parsing (design §4.1, §4.2)
// ---------------------------------------------------------------------------

export const RECORDS_MAX_RECORDS = 8;
export const RECORDS_MAX_EVIDENCE_PER_RECORD = 3;
export const RECORDS_MAX_TEXT_CHARS = 200;
/**
 * Runaway guard (design §12): a quote longer than the packet excerpt cap
 * can never be a verbatim substring of a packet excerpt, so this cap
 * rejects nothing valid; it only bounds pathological outputs before the
 * substring scan.
 */
export const RECORDS_MAX_QUOTE_CHARS = RECORDS_PACKET_EXCERPT_CHARS;

export type GroundedResearchRecordsFormatKind = "json" | "text";

/**
 * A record as parsed, before schema judgement. Fields stay `unknown` on
 * purpose: the validator's format step (design §6.1 step 1) is the single
 * place that decides what a well-formed record is, for both input forms.
 */
export interface GroundedResearchRawRecord {
  evidence: unknown;
  quote: unknown;
  text: unknown;
  /** Optional model-supplied source ID (design §4.1); JSON form only. */
  src?: unknown;
}

export interface GroundedResearchRecordsParseResult {
  /** Which form the output was interpreted as; null when neither parsed. */
  format: GroundedResearchRecordsFormatKind | null;
  /** Structurally usable records, capped at RECORDS_MAX_RECORDS. */
  records: GroundedResearchRawRecord[];
  /** Records present in the output before the cap (incl. malformed ones). */
  totalRecords: number;
  /** Usable records dropped by the RECORDS_MAX_RECORDS cap (§4.1). */
  truncatedRecords: number;
  /**
   * Text-form blocks dropped during parsing itself (stray line, repeated
   * field, missing END). A format-stage count (design §11); the JSON form
   * never produces these.
   */
  malformedRecords: number;
}

function capParsedRecords(
  format: GroundedResearchRecordsFormatKind,
  usable: GroundedResearchRawRecord[],
  malformedRecords: number,
): GroundedResearchRecordsParseResult {
  const records = usable.slice(0, RECORDS_MAX_RECORDS);
  return {
    format,
    records,
    totalRecords: usable.length + malformedRecords,
    truncatedRecords: usable.length - records.length,
    malformedRecords,
  };
}

function tryParseJsonRecordEntries(output: string): unknown[] | null {
  let value: unknown;
  try {
    value = JSON.parse(output.trim());
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const records = (value as { records?: unknown }).records;
  return Array.isArray(records) ? records : null;
}

function rawRecordFromJsonEntry(entry: unknown): GroundedResearchRawRecord {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { evidence: undefined, quote: undefined, text: undefined, src: undefined };
  }
  const record = entry as { evidence?: unknown; quote?: unknown; text?: unknown; src?: unknown };
  return { evidence: record.evidence, quote: record.quote, text: record.text, src: record.src };
}

interface TextRecordFields {
  evidence?: string[];
  quote?: string;
  text?: string;
}

/**
 * Text form (design §4.2): REC / E: / Q: / T: / END blocks. Parsing is
 * record-local: a stray line, a repeated field, or a missing END drops
 * only the block that contains it; other blocks still parse. Blank lines
 * carry no content and are ignored. Lines outside any block are ignored.
 * Returns null when the output contains no REC block at all (the output
 * is then not in text form).
 */
function tryParseTextRecords(
  output: string,
): { records: GroundedResearchRawRecord[]; malformedRecords: number } | null {
  const lines = output.replace(/\r\n/g, "\n").split("\n");
  const records: GroundedResearchRawRecord[] = [];
  let malformedRecords = 0;
  let sawBlock = false;
  let current: { fields: TextRecordFields; seen: Set<string>; malformed: boolean } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "REC") {
      // A REC line inside an open block means that block never closed.
      if (current) malformedRecords += 1;
      sawBlock = true;
      current = { fields: {}, seen: new Set<string>(), malformed: false };
      continue;
    }
    if (!current) continue;
    if (line === "") continue;
    if (line === "END") {
      if (current.malformed) {
        malformedRecords += 1;
      } else {
        records.push({
          evidence: current.fields.evidence,
          quote: current.fields.quote,
          text: current.fields.text,
        });
      }
      current = null;
      continue;
    }
    const prefix = line.slice(0, 2);
    if (prefix === "E:" || prefix === "Q:" || prefix === "T:") {
      const key = prefix[0];
      if (current.seen.has(key)) {
        current.malformed = true;
        continue;
      }
      current.seen.add(key);
      const value = line.slice(2).trim();
      if (key === "E") {
        current.fields.evidence = value ? value.split(/[\s,]+/).filter(Boolean) : [];
      } else if (key === "Q") {
        current.fields.quote = value;
      } else {
        current.fields.text = value;
      }
      continue;
    }
    // Any other line inside a block (e.g. a field spilling onto a second
    // line) makes the whole block malformed (design §4.2).
    current.malformed = true;
  }
  if (current) malformedRecords += 1; // unterminated block at end of output
  if (!sawBlock) return null;
  return { records, malformedRecords };
}

/**
 * Parses model output into raw records (design §4). The JSON form is
 * tried first, then the text form; output that matches neither yields
 * zero records with format null (a format-stage failure, design §4.2).
 * No fuzzy recovery: malformed output fails deterministically.
 */
export function parseGroundedResearchRecords(output: string): GroundedResearchRecordsParseResult {
  const jsonEntries = tryParseJsonRecordEntries(output);
  if (jsonEntries) {
    return capParsedRecords("json", jsonEntries.map(rawRecordFromJsonEntry), 0);
  }
  const textParsed = tryParseTextRecords(output);
  if (textParsed) {
    return capParsedRecords("text", textParsed.records, textParsed.malformedRecords);
  }
  return { format: null, records: [], totalRecords: 0, truncatedRecords: 0, malformedRecords: 0 };
}

// ---------------------------------------------------------------------------
// Record validation (design §6)
// ---------------------------------------------------------------------------

export type GroundedResearchRecordRejectionCode =
  | "INVALID_RECORD_FORMAT"
  | "UNKNOWN_EVIDENCE_ID"
  | "SRC_EVIDENCE_MISMATCH"
  | "QUOTE_NOT_SUBSTRING"
  | "QUOTE_DOES_NOT_COVER_EVIDENCE"
  | "NUMERIC_NOT_IN_QUOTE"
  | "NAME_NOT_IN_QUOTE"
  | "TEXT_MULTI_SENTENCE"
  | "TEXT_HAS_BACK_REFERENCE"
  | "DUPLICATE_RECORD";

export interface GroundedResearchAcceptedRecord {
  /** Source ID derived from the evidence E-IDs (never from the model). */
  sourceId: string;
  /** 0-based position of the source inside the packet. */
  sourceIndex: number;
  evidenceIds: string[];
  quote: string;
  text: string;
  /** Start offset of the (normalized) quote in the normalized excerpt. */
  quoteStart: number;
}

export interface GroundedResearchRecordRejection {
  /** Index into the parsed records array the rejection belongs to. */
  recordIndex: number;
  code: GroundedResearchRecordRejectionCode;
}

export interface GroundedResearchRecordsCoverage {
  /** min(2, packet source count) — design §6.4. */
  requiredSourceCount: number;
  /** Distinct sources cited by the surviving records. */
  citedSourceCount: number;
  satisfied: boolean;
  code: "INSUFFICIENT_SOURCE_COVERAGE" | null;
}

export interface GroundedResearchRecordsValidation {
  accepted: GroundedResearchAcceptedRecord[];
  rejections: GroundedResearchRecordRejection[];
  /** Per-code rejection counts for the stage metrics (design §11). */
  rejectionCounts: Record<GroundedResearchRecordRejectionCode, number>;
  coverage: GroundedResearchRecordsCoverage;
}

export interface GroundedResearchRecordsEvaluation extends GroundedResearchRecordsValidation {
  parse: GroundedResearchRecordsParseResult;
}

/** Same normalization as V12's `normalizedEvidenceText` (design §6.2). */
function normalizedRecordsText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s,，]/g, "");
}

/** Same back-reference set as V12's BACK_REFERENCE_PATTERN (design §6.1 step 7). */
const RECORDS_BACK_REFERENCE_PATTERN = /上記|前述|先述|上述|以上のとおり|as noted above|as mentioned/i;

/**
 * Proper-name candidates in the classes design §6.3 makes decidable:
 * katakana runs (2+ chars), capitalized Latin runs, and strings bracketed
 * by 「」/『』. Kanji names are deliberately NOT gated in general records
 * (design §6.3); name-critical question types are covered by the slot
 * path (design §9). Returns normalized candidate forms.
 */
function recordsGatedNames(text: string): string[] {
  const candidates: string[] = [];
  for (const match of text.match(/[ァ-ヶー]{2,}/g) ?? []) candidates.push(match);
  for (const match of text.match(/\b[A-Z][A-Za-z]+\b/g) ?? []) candidates.push(match);
  for (const match of text.matchAll(/「([^」]+)」/g)) candidates.push(match[1]);
  for (const match of text.matchAll(/『([^』]+)』/g)) candidates.push(match[1]);
  return [...new Set(candidates.map((candidate) => normalizedRecordsText(candidate)))]
    .filter((candidate) => candidate.length > 0);
}

/**
 * Sentence count under the same boundary rules as evidence segmentation
 * (§3.2): terminators inside brackets do not end a sentence, and a
 * trailing fragment without a terminator still counts as one sentence.
 */
function recordsSentenceCount(text: string): number {
  return splitEvidenceSpans(text).filter((span) => spanText(text, span).length > 0).length;
}

/**
 * Validates parsed records against the records packet, one record at a
 * time, in the order of design §6.1. Each record is judged independently:
 * a rejected record never affects the others, and there is no cap on how
 * many records may be rejected (design §0.3). Numeric evidence is the
 * record's own quote only — narrower than the V12 cited-source union,
 * which is the intended strengthening (design §6.1 step 5). After
 * filtering, coverage is re-judged over the survivors (design §6.4).
 */
export function validateGroundedResearchRecords(
  records: readonly GroundedResearchRawRecord[],
  packet: GroundedResearchRecordsPacket,
): GroundedResearchRecordsValidation {
  const unitIndex = new Map<string, { unit: GroundedResearchEvidenceUnit; source: GroundedResearchRecordsPacketSource }>();
  const normalizedExcerptBySourceId = new Map<string, string>();
  const normalizedUnitTextById = new Map<string, string>();
  for (const source of packet.sources) {
    normalizedExcerptBySourceId.set(source.id, normalizedRecordsText(source.excerpt));
    for (const unit of source.units) {
      unitIndex.set(unit.id, { unit, source });
      normalizedUnitTextById.set(unit.id, normalizedRecordsText(unit.text));
    }
  }

  const accepted: GroundedResearchAcceptedRecord[] = [];
  const rejections: GroundedResearchRecordRejection[] = [];
  const rejectionCounts: Record<GroundedResearchRecordRejectionCode, number> = {
    INVALID_RECORD_FORMAT: 0,
    UNKNOWN_EVIDENCE_ID: 0,
    SRC_EVIDENCE_MISMATCH: 0,
    QUOTE_NOT_SUBSTRING: 0,
    QUOTE_DOES_NOT_COVER_EVIDENCE: 0,
    NUMERIC_NOT_IN_QUOTE: 0,
    NAME_NOT_IN_QUOTE: 0,
    TEXT_MULTI_SENTENCE: 0,
    TEXT_HAS_BACK_REFERENCE: 0,
    DUPLICATE_RECORD: 0,
  };
  const acceptedQuoteKeys = new Set<string>();
  const reject = (recordIndex: number, code: GroundedResearchRecordRejectionCode): void => {
    rejections.push({ recordIndex, code });
    rejectionCounts[code] += 1;
  };

  records.forEach((record, recordIndex) => {
    // Step 1 — format (design §6.1.1, §4.1).
    const { evidence, quote, text } = record;
    if (
      !Array.isArray(evidence) ||
      evidence.length < 1 ||
      evidence.length > RECORDS_MAX_EVIDENCE_PER_RECORD ||
      evidence.some((id) => typeof id !== "string") ||
      typeof quote !== "string" ||
      quote.length > RECORDS_MAX_QUOTE_CHARS ||
      typeof text !== "string" ||
      text.trim().length === 0 ||
      text.length > RECORDS_MAX_TEXT_CHARS
    ) {
      reject(recordIndex, "INVALID_RECORD_FORMAT");
      return;
    }
    const evidenceIds = evidence as string[];

    // Step 2 — evidence existence and single-source derivation (§6.1.2).
    const cited: { unit: GroundedResearchEvidenceUnit; source: GroundedResearchRecordsPacketSource }[] = [];
    let hasUnknownEvidence = false;
    for (const id of evidenceIds) {
      const entry = unitIndex.get(id);
      if (!entry) {
        hasUnknownEvidence = true;
        break;
      }
      cited.push(entry);
    }
    if (hasUnknownEvidence) {
      reject(recordIndex, "UNKNOWN_EVIDENCE_ID");
      return;
    }
    const derivedSource = cited[0].source;
    if (
      cited.some((entry) => entry.source.id !== derivedSource.id) ||
      (record.src !== undefined && record.src !== derivedSource.id)
    ) {
      reject(recordIndex, "SRC_EVIDENCE_MISMATCH");
      return;
    }

    // Step 3 — the quote is a verbatim substring of the packet excerpt
    // (form-only normalization, design §6.1.3, §6.2).
    const normalizedQuote = normalizedRecordsText(quote);
    const quoteStart = normalizedExcerptBySourceId.get(derivedSource.id)!.indexOf(normalizedQuote);
    if (quoteStart < 0) {
      reject(recordIndex, "QUOTE_NOT_SUBSTRING");
      return;
    }

    // Step 4 — the quote covers the cited evidence units and contains at
    // least one complete unit (design §6.1.4).
    const coversCitedUnits = evidenceIds.every((id) => normalizedQuote.includes(normalizedUnitTextById.get(id)!));
    const containsCompleteUnit = derivedSource.units.some((unit) => normalizedQuote.includes(normalizedUnitTextById.get(unit.id)!));
    if (!coversCitedUnits || !containsCompleteUnit) {
      reject(recordIndex, "QUOTE_DOES_NOT_COVER_EVIDENCE");
      return;
    }

    // Step 5 — every numeric token of the text appears in the quote
    // alone (design §6.1.5).
    if (recordsNumericTokens(text).some((token) => !normalizedQuote.includes(token))) {
      reject(recordIndex, "NUMERIC_NOT_IN_QUOTE");
      return;
    }

    // Step 6 — gated proper-name classes appear in the quote (§6.1.6, §6.3).
    if (recordsGatedNames(text).some((name) => !normalizedQuote.includes(name))) {
      reject(recordIndex, "NAME_NOT_IN_QUOTE");
      return;
    }

    // Step 7 — the text stands alone: one sentence, no back-reference
    // (design §6.1.7). General anaphora (それ・その…) is instruction-only
    // and is not gated here.
    if (recordsSentenceCount(text) > 1) {
      reject(recordIndex, "TEXT_MULTI_SENTENCE");
      return;
    }
    if (RECORDS_BACK_REFERENCE_PATTERN.test(text)) {
      reject(recordIndex, "TEXT_HAS_BACK_REFERENCE");
      return;
    }

    // Step 8 — duplicates: same source and same quote start, first wins
    // (design §6.1.8).
    const quoteKey = `${derivedSource.id}:${quoteStart}`;
    if (acceptedQuoteKeys.has(quoteKey)) {
      reject(recordIndex, "DUPLICATE_RECORD");
      return;
    }
    acceptedQuoteKeys.add(quoteKey);

    accepted.push({
      sourceId: derivedSource.id,
      sourceIndex: derivedSource.index,
      evidenceIds: [...evidenceIds],
      quote,
      text,
      quoteStart,
    });
  });

  // Coverage re-check over the survivors (design §6.4). No single-source
  // exception beyond min(2, packet size).
  const citedSourceCount = new Set(accepted.map((record) => record.sourceId)).size;
  const requiredSourceCount = Math.min(2, packet.sources.length);
  const satisfied = accepted.length > 0 && citedSourceCount >= requiredSourceCount;
  return {
    accepted,
    rejections,
    rejectionCounts,
    coverage: {
      requiredSourceCount,
      citedSourceCount,
      satisfied,
      code: satisfied ? null : "INSUFFICIENT_SOURCE_COVERAGE",
    },
  };
}

/**
 * Parse + validate in one call: the records-path counterpart of V12's
 * validate entry point, taking the raw model output and the packet
 * (design §6 preamble).
 */
export function evaluateGroundedResearchRecords(
  output: string,
  packet: GroundedResearchRecordsPacket,
): GroundedResearchRecordsEvaluation {
  const parse = parseGroundedResearchRecords(output);
  return { parse, ...validateGroundedResearchRecords(parse.records, packet) };
}
