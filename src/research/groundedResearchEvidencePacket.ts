import type { OriginResearchSource } from "../legacy/originResearchSource.js";
import { parseOriginOfficialEdition } from "../search/originOfficialEdition.js";
import {
  isRegionalOfficialSource,
  type OfficialMaterialSourceShape,
} from "../search/originRegionalOfficialSource.js";

/**
 * Recovery build Stage 1, PR-2: sentence-level evidence packet.
 *
 * The N-2b claim sentences (groundedResearchEvidenceCards.ts) select at
 * most two sentences per source from the 600-character compacted excerpt,
 * split by `splitGroundedResearchSentences` — at the time a splitter
 * that cut at every period, including the period inside a decimal
 * ("1.0%" becomes "1." + "0%…") and inside a URL. Round 5 showed the
 * cost: F-03's 1.25% fact sat in a source whose claim sentences never
 * carried it, and F-01's current-office statement was never quoted at
 * all. (The card side shares this module's protected splitter since
 * the 2026-11-26 remeasure diagnosis, measure 1-1.)
 *
 * The packet is a second, independent selection that runs on the RAW
 * source excerpt (before compactExcerpt) plus the source title:
 *  - `splitRecoverySentences` protects the period inside decimals,
 *    versions and URLs, and inside Japanese quotation marks, so a
 *    sentence carrying "1.25%" stays one complete sentence;
 *  - the title and heading-like lines are candidate sentences, so a
 *    fact stated only in a heading is selectable;
 *  - rule scoring ranks sentences by question-key overlap (with a
 *    bonus when two or more distinct keys meet in one sentence, the
 *    shape of an answer-bearing core), then by answer-bearing signals
 *    (a digit, a unit/term), and returns the top 8 in original order.
 *
 * The module is pure and deterministic: no model, no network, no
 * clock, no environment. It does not change the N-2a/N-2b cards; the
 * tier-T3 partial answer (groundedResearchV11.ts) prefers the packet's
 * sentences for its attribution quote and falls back to the card's
 * claim span when the packet has nothing for that source, so the
 * 240-character bound and the R-1 neutralization are unchanged.
 *
 * Follow-up measures B and C (ANSWER_SOURCES_ONLY_DIAGNOSIS_
 * 2026-11-26) extend the selection in two ways:
 *  - Label/value rejoin (B): official statistics pages (the ESRI
 *    shape) put a heading label and its value on separate lines —
 *    the label line carries the question keys but no value, the
 *    value line carries the number but no key, so neither half was
 *    quotable as the answer. When a line is a single heading
 *    fragment ending は/が/の/： and the next line opens with a
 *    number-bearing, key-less sentence, the two enter the packet as
 *    one joined candidate, replacing both halves.
 *  - Authority and edition in the ranking (C): a sentence from an
 *    official-tier source, and a sentence from the source carrying
 *    the pool's latest stated edition, score above an equally
 *    key-matching sentence from a secondary or older source, so a
 *    stale secondary value no longer outranks the current official
 *    one merely on digit/term signals.
 *  - Regional sub-ranking (remeasure measure 3-1,
 *    ANSWER_STATISTICS_REMEASURE_DIAGNOSIS_2026-11-26): the
 *    official bonus speaks for the publishing authority, and a
 *    regional (prefectural) publication is not the national
 *    authority — when a national official source is in the pool,
 *    a regional official source does not receive the bonus, so
 *    its local figure no longer ties with (and, on key overlap,
 *    beats) the national release's value sentence. The tier is
 *    unchanged; this is a sub-rank inside the official group,
 *    mirroring the pool selection in originSearchGrounding.
 */

export type RecoveryPacketSentenceOrigin = "title" | "excerpt";

export interface RecoveryPacketSentence {
  /**
   * Verbatim substring of the source title or excerpt. One
   * exception (measure B): a rejoined label/value candidate is the
   * concatenation of two adjacent excerpt lines — every character
   * is the source's own, only the line break between the label and
   * its value is dropped.
   */
  text: string;
  /** 0-based index into the sources array passed to the builder. */
  sourceIndex: number;
  /** Rule score; higher ranks first. */
  score: number;
  origin: RecoveryPacketSentenceOrigin;
}

export interface RecoveryEvidencePacket {
  /** At most 8 sentences, in original (source, then position) order. */
  sentences: RecoveryPacketSentence[];
}

/** Maximum sentences in one packet (design: the top 5-8). */
export const RECOVERY_EVIDENCE_PACKET_MAX_SENTENCES = 8;

const HALF_WIDTH_ALNUM = /[0-9A-Za-z]/;
const FULL_WIDTH_ALNUM = /[０-９Ａ-Ｚａ-ｚ]/;

function isAlphanumeric(char: string): boolean {
  return HALF_WIDTH_ALNUM.test(char) || FULL_WIDTH_ALNUM.test(char);
}

const QUOTE_OPEN = new Set(["「", "『", "“"]);
const QUOTE_CLOSE = new Set(["」", "』", "”"]);

/** A URL token: scheme or www. up to the next whitespace or closing bracket. */
const URL_TOKEN_PATTERN = /(?:https?:\/\/|www\.)[^\s\)）」』\]]+/g;

const SENTENCE_TERMINATORS = new Set(["。", "．", ".", "!", "?", "！", "？"]);
/** Periods only: protected inside quotes, URLs and alphanumeric tokens. */
const PERIODS = new Set([".", "．"]);

/**
 * Split text into sentences. A sentence is a verbatim substring ending
 * at an unprotected terminator (or at the end of a line). The period
 * ("." / "．") is protected when it sits inside a URL token, inside
 * Japanese quotation marks, or between alphanumeric characters — the
 * decimal / version / abbreviation cases ("1.25%", "v1.2", "U.S.A").
 * The Japanese full stop "。" always terminates, even inside quotes:
 * it closes the quoted sentence, and the design's protection is for
 * the period character. Newlines split first, so a heading line
 * (H1-H3 in the raw excerpt) is its own candidate sentence.
 */
export function splitRecoverySentences(value: string): string[] {
  const sentences: string[] = [];
  for (const line of value.split("\n")) {
    const urlSpans: Array<{ start: number; end: number }> = [];
    for (const match of line.matchAll(URL_TOKEN_PATTERN)) {
      urlSpans.push({ start: match.index, end: match.index + match[0].length });
    }
    const inUrl = (index: number): boolean =>
      urlSpans.some((span) => index >= span.start && index < span.end);

    let quoteDepth = 0;
    let start = 0;
    let index = 0;
    const flush = (end: number): void => {
      const sentence = line.slice(start, end).trim();
      if (sentence) sentences.push(sentence);
      start = end;
    };
    while (index < line.length) {
      const char = line[index];
      if (QUOTE_OPEN.has(char)) quoteDepth += 1;
      else if (QUOTE_CLOSE.has(char)) quoteDepth = Math.max(0, quoteDepth - 1);
      if (SENTENCE_TERMINATORS.has(char)) {
        const isPeriod = PERIODS.has(char);
        const protectedPeriod =
          isPeriod &&
          (quoteDepth > 0 ||
            inUrl(index) ||
            (index > 0 &&
              index + 1 < line.length &&
              isAlphanumeric(line[index - 1]) &&
              isAlphanumeric(line[index + 1])));
        if (!protectedPeriod) {
          // Consume a run of terminators ("。。" / "!?") with the sentence.
          let end = index + 1;
          while (end < line.length && SENTENCE_TERMINATORS.has(line[end])) end += 1;
          flush(end);
          index = end;
          continue;
        }
      }
      index += 1;
    }
    flush(line.length);
  }
  return sentences;
}

interface PacketQuestionKey {
  text: string;
  weight: number;
}

/**
 * Unit suffixes for a number-with-unit question key, in the same
 * order as the alternation they replace: the first suffix that
 * matches wins, so "m" wins over "mm" and "cm", exactly as the
 * alternation did.
 */
const NUMBER_UNIT_SUFFIXES = [
  "円",
  "％",
  "%",
  "ドル",
  "人",
  "年",
  "月",
  "日",
  "回",
  "位",
  "票",
  "議席",
  "km",
  "kg",
  "m",
  "cm",
  "mm",
] as const;

/**
 * Number-with-unit keys, found without a combined regex: the old
 * `(\d[\d,.]*)\s*(unit)` pattern backtracked over the whole digit
 * run whenever no unit followed (CodeQL polynomial ReDoS on a
 * user-supplied question, e.g. a long run of "0"s), so the number
 * run and the unit suffix are matched separately with literal
 * string checks instead. The key text is identical to the old
 * match: number run + intervening whitespace + unit suffix.
 */
function addNumberUnitKeys(
  question: string,
  add: (text: string, weight: number) => void,
): void {
  for (const match of question.matchAll(/\d[\d,.]*/g)) {
    const numberText = match[0];
    const start = match.index ?? 0;
    let cursor = start + numberText.length;
    while (cursor < question.length && /\s/.test(question[cursor])) {
      cursor += 1;
    }
    for (const suffix of NUMBER_UNIT_SUFFIXES) {
      if (question.startsWith(suffix, cursor)) {
        add(question.slice(start, cursor + suffix.length), 2);
        break;
      }
    }
  }
}

/**
 * Question keys, mirroring N-2b's extractQuestionKeys (the same
 * definition of a "key", so the packet and the cards agree): date
 * expressions, numbers with a unit, bare numbers, katakana runs, and
 * kanji runs. Kept local so this module stays independent of the
 * evidence-card module (which shares a runtime import cycle with the
 * synthesis module).
 */
export function extractPacketQuestionKeys(question: string): PacketQuestionKey[] {
  const keys: PacketQuestionKey[] = [];
  const add = (text: string, weight: number): void => {
    const normalized = text.trim();
    if (normalized && !keys.some((key) => key.text === normalized)) {
      keys.push({ text: normalized, weight });
    }
  };
  for (const match of question.matchAll(
    /(\d{4}年\d{1,2}月\d{1,2}日|\d{4}年\d{1,2}月|\d{4}-\d{2}-\d{2}|\d{1,2}月\d{1,2}日)/g,
  )) {
    add(match[0], 2);
  }
  addNumberUnitKeys(question, add);
  for (const match of question.matchAll(/(\d[\d,.]*)/g)) add(match[0], 2);
  for (const match of question.matchAll(/[ァ-ヶー]{2,}/g)) add(match[0], 2);
  for (const match of question.matchAll(/[\u4e00-\u9faf]{2,}/g)) add(match[0], 1);
  return keys;
}

/** Same answer-bearing term signal as excerptSentenceScore. */
const ANSWER_BEARING_TERM_PATTERN =
  /円|％|%|パーセント|期間|対象|条件|ただし|例外|以降|以前|以上|以下|未満|上限|下限|最大|最小|ドル|ユーロ|usd|jpy/i;
const ANSWER_BEARING_NUMBER_PATTERN = /[0-9０-９]/;

/**
 * Whether a sentence carries an answer-bearing signal of its own —
 * a number or an answer-bearing term — beyond any question-key
 * overlap. Exported for the deterministic reconstruction
 * (groundedResearchReconstruction.ts), whose establishment gate
 * requires this signal (or two distinct key matches) so a sentence
 * that merely restates the question's framing ("現在確認できた
 * 公開情報です" for "今日の公開情報を調査してください") is never
 * presented as an answer.
 */
export function packetSentenceHasAnswerBearingSignal(text: string): boolean {
  return ANSWER_BEARING_NUMBER_PATTERN.test(text) || ANSWER_BEARING_TERM_PATTERN.test(text);
}

function packetSentenceScore(sentence: string, keys: readonly PacketQuestionKey[]): number {
  let score = 0;
  let matchedKeys = 0;
  for (const key of keys) {
    if (sentence.includes(key.text)) {
      score += key.weight;
      matchedKeys += 1;
    }
  }
  if (ANSWER_BEARING_NUMBER_PATTERN.test(sentence)) score += 2;
  if (ANSWER_BEARING_TERM_PATTERN.test(sentence)) score += 1;
  // Two or more distinct question keys meeting in one sentence is the
  // shape of an answer-bearing core, not a passing mention.
  if (matchedKeys >= 2) score += 3;
  return score;
}

/** A fragment with no terminator and at most 80 characters reads as a heading. */
function isHeadingLike(sentence: string): boolean {
  return (
    sentence.length <= 80 &&
    ![...sentence].some((char) => SENTENCE_TERMINATORS.has(char))
  );
}

/**
 * A heading fragment that grammatically continues into what follows
 * (measure B): a heading-like line ending は/が/の/： is a label whose
 * statement is completed by the next line, the layout official
 * statistics pages use for a value ("…の実質ＧＤＰの成長率は" /
 * "前期比−0.0%…"). Round-3 measure 2-4
 * (ANSWER_STATISTICS_ROUND3_DIAGNOSIS_2026-11-26): the same label
 * also appears with its topic particle followed by a comma —
 * ESRI's summary writes "…の成長率は、" — and that form escaped the
 * ending test, so the label and its value stayed separate
 * candidates and the value-only half then failed the
 * reconstruction's key gate. The comma forms （は、/が、/の、) are
 * admitted alongside the bare particles; the join keeps the comma,
 * so the rejoined candidate is the publisher's verbatim sentence
 * ("成長率は、▲0.0％…となった。"), not a rewritten one.
 */
const HEADING_FRAGMENT_ENDING = /(?:は、?|が、?|の、?|：|:)$/;

function isHeadingFragment(sentence: string): boolean {
  return isHeadingLike(sentence) && HEADING_FRAGMENT_ENDING.test(sentence);
}

/**
 * Measure C ranking bonuses, on the same scale as the existing
 * signals (a key match is 1-2, a digit is 2, the two-key core is 3):
 * large enough that the current official value sentence outranks a
 * stale secondary one with equal key overlap, small enough that a
 * secondary sentence matching strictly more of the question still
 * wins on substance.
 */
const PACKET_OFFICIAL_TIER_BONUS = 2;
const PACKET_LATEST_EDITION_BONUS = 2;

/**
 * File-description shape (round-5 measure 5-3b,
 * ANSWER_STATISTICS_ROUND5_DIAGNOSIS_2026-11-27 §2.3): a sentence
 * whose payload is a file guide — a format carrying a file size
 * ("印刷用PDF：148KB", "（Excel：15KB）", "CSV 2.3MB") — states no
 * statistic, yet it is compact and on-topic, so it scored into the
 * packet while the adopted pool for the September Labour Force
 * Survey was exactly such text (a census user-guide PDF and a
 * different survey's file page) and the answer landed value-less.
 * The test is conjunctive on purpose: the format-with-size marker
 * (or the print-PDF label) must be present AND the sentence must
 * carry no value token — a sentence that reports a figure AND
 * mentions a file is a value sentence, not a guide. (The size
 * expression itself is stripped before the value test, so a
 * decimal file size cannot pose as a statistic.) The value-token
 * shape mirrors OFFICIAL_VALUE_TOKEN_PATTERN in
 * originOfficialSourceRouting (kept local: this module does not
 * import the search layer). The predicate drives a DEMOTION only —
 * guide-shaped sentences rank after every non-guide sentence in
 * selection, but are never excluded, so a pool whose only
 * sentences are guide-shaped produces exactly the packet it did
 * before.
 */
const PACKET_FILE_FORMAT_SIZE_PATTERN =
  /(?:PDF|Excel|CSV|XLSX?|Word)[:：]?\s*\d+(?:\.\d+)?\s*(?:KB|MB)/i;
const PACKET_VALUE_TOKEN_PATTERN =
  /\d[\d,]*\.\d+|\d[\d,]*\s*(?:%|倍|円|万人|億円|兆円|ドル|ポイント|件)/;

export function packetSentenceIsFileDescription(text: string): boolean {
  const normalized = (text ?? "").normalize("NFKC");
  const guideShaped =
    PACKET_FILE_FORMAT_SIZE_PATTERN.test(normalized)
    || normalized.includes("印刷用PDF");
  if (!guideShaped) return false;
  // The file-size expression itself is removed before the value
  // test: a decimal size ("PDF：2.3MB") is digit-dot-digit shaped
  // and would otherwise read as a statistic value, exempting
  // exactly the guide sentences this predicate exists to demote.
  const withoutFileSizes = normalized.replace(
    new RegExp(PACKET_FILE_FORMAT_SIZE_PATTERN.source, "gi"),
    "",
  );
  return !PACKET_VALUE_TOKEN_PATTERN.test(withoutFileSizes);
}

type PacketSource = Pick<OriginResearchSource, "title" | "excerpt" | "authorityTier"> & {
  // Optional: some callers build packet sources from title +
  // excerpt alone (groundedResearchValueExtraction). The regional
  // sub-ranking simply cannot recognize such a source as regional.
  url?: string;
  domain?: string;
};

/** The regional predicate's input shape, filled from a packet source. */
function toRegionalShape(source: PacketSource): OfficialMaterialSourceShape {
  return {
    title: source.title ?? "",
    url: source.url ?? "",
    excerpt: source.excerpt ?? "",
    domain: source.domain ?? "",
    authorityTier: source.authorityTier ?? "",
  };
}

/**
 * Build the evidence packet for a list of sources and a question:
 * the top 8 scored sentences (title candidates included), in
 * original order. Sentences scoring 0 — no question key, no digit,
 * no answer-bearing term — are not evidence and are left out, so an
 * empty packet means "nothing in these sources answers the question"
 * and the caller falls back to the N-2b claim sentences.
 */
export function buildGroundedResearchEvidencePacket(
  sources: readonly PacketSource[],
  question: string,
): RecoveryEvidencePacket {
  const keys = extractPacketQuestionKeys(question);
  interface ScoredCandidate extends RecoveryPacketSentence {
    /** Order within the source: -1 for the title, 0..n for excerpt sentences. */
    position: number;
  }
  // Measure C: the edition each source's title states (null when it
  // states none) and the pool's latest stated edition. Recency is
  // judged only among sources that state an edition at all — a
  // source with no stated edition is of unknown vintage, never old.
  const sourceEditionSortKeys: (number | null)[] = sources.map((source) => {
    const edition = parseOriginOfficialEdition(source.title ?? "");
    return edition ? edition.sortKey : null;
  });
  const latestEditionSortKey = sourceEditionSortKeys.reduce<number | null>(
    (latest, sortKey) =>
      sortKey !== null && (latest === null || sortKey > latest) ? sortKey : latest,
    null,
  );
  // Regional sub-ranking (measure 3-1): whether the pool holds a
  // national official source at all decides the regional official
  // sources' bonus below — a pool with only regional officials
  // keeps their bonus exactly as before.
  const hasNationalOfficial = sources.some(
    (source) =>
      source.authorityTier === "official" && !isRegionalOfficialSource(toRegionalShape(source)),
  );
  const candidates: ScoredCandidate[] = [];
  sources.forEach((source, sourceIndex) => {
    const editionSortKey = sourceEditionSortKeys[sourceIndex] ?? null;
    const officialBonus =
      source.authorityTier === "official"
      && !(hasNationalOfficial && isRegionalOfficialSource(toRegionalShape(source)))
        ? PACKET_OFFICIAL_TIER_BONUS
        : 0;
    const sourceBonus =
      officialBonus +
      (editionSortKey !== null && editionSortKey === latestEditionSortKey
        ? PACKET_LATEST_EDITION_BONUS
        : 0);
    const title = (source.title ?? "").trim();
    if (title) {
      const base = packetSentenceScore(title, keys);
      if (base > 0) {
        candidates.push({
          text: title,
          sourceIndex,
          score: base + 1,
          origin: "title",
          position: -1,
        });
      }
    }
    const excerpt = source.excerpt ?? "";
    // Sentences keep their line structure (splitRecoverySentences
    // splits on newlines first, so splitting line by line is the
    // same sentence stream with the boundaries still known): the
    // measure-B rejoin below needs to know which sentences were
    // separated by a line break.
    const lines: string[][] = excerpt
      .split("\n")
      .map((line) => splitRecoverySentences(line));
    const lineStarts: number[] = [];
    const flat: string[] = [];
    for (const lineSentences of lines) {
      lineStarts.push(flat.length);
      flat.push(...lineSentences);
    }
    // Measure B: label/value rejoin. A line that is a single
    // heading fragment (ending は/が/の/：, or the comma forms
    // は、/が、/の、 since round-3 measure 2-4) carrying a question key,
    // followed by a line opening with a number-bearing sentence
    // that matches no question key, states one fact across the two
    // lines. The pair enters as one joined candidate (the label's
    // position), replacing both halves: quoted alone, the label
    // asserts nothing and the value answers nothing.
    const joinedTextByLabelIndex = new Map<number, string>();
    const consumedValueIndexes = new Set<number>();
    for (let lineIndex = 0; lineIndex + 1 < lines.length; lineIndex += 1) {
      const labelLine = lines[lineIndex];
      const valueLine = lines[lineIndex + 1];
      if (!labelLine || !valueLine) continue;
      if (labelLine.length !== 1 || valueLine.length === 0) continue;
      const labelIndex = lineStarts[lineIndex] ?? 0;
      if (consumedValueIndexes.has(labelIndex)) continue;
      const label = labelLine[0] ?? "";
      const value = valueLine[0] ?? "";
      if (!isHeadingFragment(label)) continue;
      if (packetSentenceScore(label, keys) <= 0) continue;
      if (!ANSWER_BEARING_NUMBER_PATTERN.test(value)) continue;
      if (keys.some((key) => value.includes(key.text))) continue;
      joinedTextByLabelIndex.set(labelIndex, label + value);
      consumedValueIndexes.add(lineStarts[lineIndex + 1] ?? 0);
    }
    flat.forEach((sentence, position) => {
      if (consumedValueIndexes.has(position)) return;
      const joined = joinedTextByLabelIndex.get(position);
      const text = joined ?? sentence;
      const base = packetSentenceScore(text, keys);
      if (base <= 0) return;
      candidates.push({
        text,
        sourceIndex,
        score: base + (joined ? 1 : isHeadingLike(sentence) ? 1 : 0) + sourceBonus,
        origin: "excerpt",
        position,
      });
    });
  });

  // Deduplicate by normalized text, keeping the earliest occurrence.
  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    const normalized = candidate.text.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  // Top 8 by score (earliest source, then earliest sentence, on
  // ties). Round-5 measure 5-3b: file-description sentences
  // (packetSentenceIsFileDescription) sort after every non-guide
  // sentence regardless of score — the demotion is the primary key
  // because a guide sentence's score (official tier + edition
  // bonuses on an official file page) is exactly what let it crowd
  // the value sentences out of the top 8 in the measured pool.
  const ranked = [...unique].sort(
    (a, b) =>
      Number(packetSentenceIsFileDescription(a.text))
        - Number(packetSentenceIsFileDescription(b.text))
      || b.score - a.score
      || a.sourceIndex - b.sourceIndex
      || a.position - b.position,
  );
  const top = ranked.slice(0, RECOVERY_EVIDENCE_PACKET_MAX_SENTENCES);
  // Return in original order so the packet reads as the sources wrote it.
  top.sort((a, b) => a.sourceIndex - b.sourceIndex || a.position - b.position);
  return {
    sentences: top.map(({ position: _position, ...sentence }) => sentence),
  };
}
