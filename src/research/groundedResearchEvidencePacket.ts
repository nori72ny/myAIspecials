import type { OriginResearchSource } from "../legacy/originResearchSource.js";

/**
 * Recovery build Stage 1, PR-2: sentence-level evidence packet.
 *
 * The N-2b claim sentences (groundedResearchEvidenceCards.ts) select at
 * most two sentences per source from the 600-character compacted excerpt,
 * split by `splitGroundedResearchSentences` — a splitter that cuts at
 * every period, including the period inside a decimal ("1.0%" becomes
 * "1." + "0%…") and inside a URL. Round 5 showed the cost: F-03's
 * 1.25% fact sat in a source whose claim sentences never carried it,
 * and F-01's current-office statement was never quoted at all.
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
 */

export type RecoveryPacketSentenceOrigin = "title" | "excerpt";

export interface RecoveryPacketSentence {
  /** Verbatim substring of the source title or excerpt. */
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

type PacketSource = Pick<OriginResearchSource, "title" | "excerpt">;

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
  const candidates: ScoredCandidate[] = [];
  sources.forEach((source, sourceIndex) => {
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
    splitRecoverySentences(excerpt).forEach((sentence, position) => {
      const base = packetSentenceScore(sentence, keys);
      if (base <= 0) return;
      candidates.push({
        text: sentence,
        sourceIndex,
        score: base + (isHeadingLike(sentence) ? 1 : 0),
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

  // Top 8 by score (earliest source, then earliest sentence, on ties).
  const ranked = [...unique].sort(
    (a, b) =>
      b.score - a.score || a.sourceIndex - b.sourceIndex || a.position - b.position,
  );
  const top = ranked.slice(0, RECOVERY_EVIDENCE_PACKET_MAX_SENTENCES);
  // Return in original order so the packet reads as the sources wrote it.
  top.sort((a, b) => a.sourceIndex - b.sourceIndex || a.position - b.position);
  return {
    sentences: top.map(({ position: _position, ...sentence }) => sentence),
  };
}
