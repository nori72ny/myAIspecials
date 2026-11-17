import type { OriginResearchSource } from "../legacy/originResearchSource.js";
import {
  compactExcerpt,
  excerptSentenceScore,
  groundedResearchPacketDateForms,
  splitGroundedResearchSentences,
} from "./groundedResearchSynthesisV12.js";

/**
 * N-2 evidence cards (N2_N5_IMPLEMENTATION_DESIGN_2026-11-17 §1).
 *
 * Converts the already-selected research sources into a column of
 * "evidence cards": a presentation-layer structure that names, for
 * each source, the verbatim sentences that answer the question, so
 * later stages (packet presentation in N-2b, the tier-T3 extractive
 * body, the claims-JSON shadow experiment, and the §4 applicability
 * check) can work from stable evidence ids instead of re-deriving
 * sentence choices independently.
 *
 * Absolute invariant (§1.1): a card is a *presentation selection*, not
 * an evidence boundary. The synthesis validator's evidence set stays
 * exactly what it was — the full source side (title + excerpt + date
 * forms) — and nothing in this module is wired into verification,
 * synthesis, or routing. Card sentences are always verbatim substrings
 * of the card's excerpt; nothing here paraphrases, summarizes, or
 * calls a model. Every function is pure and deterministic.
 */

/**
 * Backing state of a card's claim sentences. N-2 only ever produces
 * "in-source" (the sentences exist verbatim in the source). Later
 * stages (the N-3 deterministic recalculation line) may add values
 * such as "numeric-verified"; N-2 never updates this field.
 */
export type GroundedResearchEvidenceCardSupportState = "in-source";

/**
 * Container for the §4 applicability check (対象時点で有効か). N-2a
 * prepares the container only: the deterministic extraction of period
 * signals and transitional-measure terms lands with the §4 PRs (A-1),
 * and the judgment itself with A-2/A-3. Until then both lists are
 * always empty — never guessed.
 */
export interface GroundedResearchEvidenceCardApplicability {
  /** Period expressions near the claim sentences (e.g. 「2022年7月25日まで」). */
  periodSignals: string[];
  /** Transitional-measure signal terms near the claim sentences （経過措置・暫定・改正・当時 等）. */
  transitionalSignalTerms: string[];
}

export interface GroundedResearchEvidenceCard {
  /**
   * `E1`..`En`, in the sources' presentation order. The order is the
   * same order the synthesis packet presents as `S1`..`Sn`, so E and S
   * numbers refer to the same source 1:1 (§1.2). Citations stay
   * S-based; the E id is the card-side handle.
   */
  evidenceId: string;
  /** Index of the source in the input column (log/validator cross-reference). */
  sourceIndex: number;
  title: string;
  url: string;
  domain: string;
  /**
   * The 1–2 verbatim sentences that answer the question, selected
   * deterministically by §1.3 scoring, in original excerpt order.
   */
  claimSentences: string[];
  /** The compacted excerpt, exactly as the synthesis packet shows it. */
  excerpt: string;
  /**
   * Which part of the page the excerpt came from. The current
   * `OriginResearchSource` carries no heading/section metadata
   * (§1.2 code check), so this is always empty in N-2 — never
   * fabricated. Whether to extend the fetch side or drop the field is
   * an open decision (§1.7 未決-4).
   */
  sectionHint: string;
  /** Publication-date forms (ISO + Japanese long form) as shown in the packet. */
  publishedDateForms: string[];
  /** Retrieval-date forms (ISO + Japanese long form) as shown in the packet. */
  retrievedDateForms: string[];
  applicability: GroundedResearchEvidenceCardApplicability;
  supportState: GroundedResearchEvidenceCardSupportState;
}

export type GroundedResearchCoverageKeyKind = "term" | "numeric-demand" | "date-demand";

export interface GroundedResearchCoverageEntry {
  kind: GroundedResearchCoverageKeyKind;
  /**
   * The question term itself for "term" entries; the matched demand
   * marker for "numeric-demand" / "date-demand" entries.
   */
  term: string;
  /**
   * Cards whose claim sentences or excerpt satisfy the key: verbatim
   * containment for terms, any numeric token for numeric demands, any
   * date expression for date demands (§1.4).
   */
  coveredByEvidenceIds: string[];
}

export interface GroundedResearchCoverageSelection {
  entries: GroundedResearchCoverageEntry[];
  /** Terms/markers with no covering card, in entry order. */
  uncoveredTerms: string[];
}

export interface GroundedResearchEvidenceCardSet {
  cards: GroundedResearchEvidenceCard[];
  coverage: GroundedResearchCoverageSelection;
}

// ---------------------------------------------------------------------------
// Question keys (§1.3 step 2a): deterministic extraction from the question.
// Numbers, dates, and unit-attached numbers are the heavy keys (weight 2),
// katakana runs are treated as proper-noun candidates (weight 2), and
// kanji runs as general noun candidates (weight 1).
// ---------------------------------------------------------------------------

type QuestionKeyKind = "date" | "unit-numeric" | "numeric" | "katakana-term" | "kanji-term";

interface QuestionKey {
  key: string;
  kind: QuestionKeyKind;
  weight: 1 | 2;
}

const QUESTION_DATE_PATTERN =
  /[0-9０-９]{4}年(?:[0-9０-９]{1,2}月(?:[0-9０-９]{1,2}日)?)?|[0-9０-９]{1,2}月[0-9０-９]{1,2}日/g;
const QUESTION_UNIT_NUMERIC_PATTERN =
  /[0-9０-９]+(?:[.,][0-9０-９]+)?\s*(?:円|％|%|パーセント|人|名|件|歳|か月|ヶ月|週間|時間|分|秒|日間|kg|km|ドル|ユーロ)/g;
const QUESTION_NUMERIC_PATTERN = /[0-9０-９]+(?:[.,][0-9０-９]+)?/g;
const QUESTION_KATAKANA_PATTERN = /[ァ-ヶー]{2,}/g;
const QUESTION_KANJI_PATTERN = /[一-龯々]{2,}/g;

function extractQuestionKeys(question: string): QuestionKey[] {
  const spans: Array<{ start: number; end: number; key: QuestionKey }> = [];
  const claim = (pattern: RegExp, kind: QuestionKeyKind, weight: 1 | 2): void => {
    for (const match of question.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      // A span already claimed by a heavier key (e.g. the "2026" inside
      // a matched date) is not counted again as a bare numeric key.
      if (spans.some((span) => start < span.end && span.start < end)) continue;
      spans.push({ start, end, key: { key: match[0].replace(/\s+/g, ""), kind, weight } });
    }
  };
  claim(QUESTION_DATE_PATTERN, "date", 2);
  claim(QUESTION_UNIT_NUMERIC_PATTERN, "unit-numeric", 2);
  claim(QUESTION_NUMERIC_PATTERN, "numeric", 2);
  claim(QUESTION_KATAKANA_PATTERN, "katakana-term", 2);
  claim(QUESTION_KANJI_PATTERN, "kanji-term", 1);
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const seen = new Set<string>();
  const keys: QuestionKey[] = [];
  for (const span of spans) {
    if (seen.has(span.key.key)) continue;
    seen.add(span.key.key);
    keys.push(span.key);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Claim sentence selection (§1.3): question-overlap + the existing
// answer-bearing score + a small head-position bonus; ties keep the
// original order, so the result is fully deterministic.
// ---------------------------------------------------------------------------

function claimSentenceScore(sentence: string, index: number, keys: readonly QuestionKey[]): number {
  let score = excerptSentenceScore(sentence);
  for (const key of keys) {
    if (sentence.includes(key.key)) score += key.weight;
  }
  if (index < 3) score += 1;
  return score;
}

function selectClaimSentences(excerpt: string, keys: readonly QuestionKey[]): string[] {
  const sentences = splitGroundedResearchSentences(excerpt);
  if (sentences.length === 0) return [];
  const scored = sentences.map((sentence, index) => ({
    sentence,
    index,
    score: claimSentenceScore(sentence, index, keys),
  }));
  return [...scored]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.sentence);
}

// ---------------------------------------------------------------------------
// Coverage selection (§1.4): for each topic key the question raises
// deterministically — a term it names, a numeric demand, a date demand —
// record which cards cover it. In N-2a this is a result value only;
// the packet allocation / tier-T1 / tier-T3 uses land in N-2b.
// ---------------------------------------------------------------------------

const DATE_DEMAND_MARKERS: readonly string[] = [
  "いつ", "何年", "何月", "何日", "施行日", "公布日", "成立日", "開始日", "終了日", "期限", "締切", "期日",
];
const NUMERIC_DEMAND_MARKERS: readonly string[] = [
  "いくら", "何人", "何名", "何件", "何円", "何％", "何%", "何パーセント", "何歳",
  "何時間", "何分", "何秒", "何日間", "何か月", "何ヶ月", "何週間",
  "定数", "定員", "人数", "金額", "料金", "価格", "手数料", "給付額", "保険料", "上限", "下限", "税率", "割合",
];

const CARD_NUMERIC_PATTERN = /[0-9０-９]/;
const CARD_DATE_PATTERN =
  /[0-9０-９]{4}年|[0-9０-９]{1,2}月[0-9０-９]{1,2}日|[0-9]{4}-[0-9]{2}-[0-9]{2}|(?:令和|平成|昭和)[0-9０-９一二三四五六七八九十]+年/;

function extractDemandMarkers(
  question: string,
): Array<{ term: string; kind: "numeric-demand" | "date-demand"; start: number }> {
  const markers: Array<{ term: string; kind: "numeric-demand" | "date-demand" }> = [
    ...DATE_DEMAND_MARKERS.map((term) => ({ term, kind: "date-demand" as const })),
    ...NUMERIC_DEMAND_MARKERS.map((term) => ({ term, kind: "numeric-demand" as const })),
  // Longest first, so 何日間 (duration) is claimed as a numeric demand
  // before 何日 can claim its head as a date demand.
  ].sort((a, b) => b.term.length - a.term.length);
  const claimed: Array<{ start: number; end: number }> = [];
  const found: Array<{ term: string; kind: "numeric-demand" | "date-demand"; start: number }> = [];
  for (const marker of markers) {
    let from = 0;
    for (;;) {
      const start = question.indexOf(marker.term, from);
      if (start < 0) break;
      const end = start + marker.term.length;
      if (!claimed.some((span) => start < span.end && span.start < end)) {
        claimed.push({ start, end });
        found.push({ term: marker.term, kind: marker.kind, start });
      }
      from = end;
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

function selectCoverage(
  question: string,
  keys: readonly QuestionKey[],
  cards: readonly GroundedResearchEvidenceCard[],
): GroundedResearchCoverageSelection {
  const cardTexts = cards.map((card) => ({
    evidenceId: card.evidenceId,
    text: [...card.claimSentences, card.excerpt].join(" "),
  }));
  const covering = (predicate: (text: string) => boolean): string[] =>
    cardTexts.filter((card) => predicate(card.text)).map((card) => card.evidenceId);

  const entries: GroundedResearchCoverageEntry[] = [];
  for (const key of keys) {
    if (key.kind !== "katakana-term" && key.kind !== "kanji-term") continue;
    entries.push({
      kind: "term",
      term: key.key,
      coveredByEvidenceIds: covering((text) => text.includes(key.key)),
    });
  }
  for (const demand of extractDemandMarkers(question)) {
    entries.push({
      kind: demand.kind,
      term: demand.term,
      coveredByEvidenceIds:
        demand.kind === "numeric-demand"
          ? covering((text) => CARD_NUMERIC_PATTERN.test(text))
          : covering((text) => CARD_DATE_PATTERN.test(text)),
    });
  }
  return {
    entries,
    uncoveredTerms: entries
      .filter((entry) => entry.coveredByEvidenceIds.length === 0)
      .map((entry) => entry.term),
  };
}

// ---------------------------------------------------------------------------
// Card construction (§1.2).
// ---------------------------------------------------------------------------

function cardDomain(source: OriginResearchSource): string {
  if (source.domain) return source.domain;
  try {
    return new URL(source.url).hostname;
  } catch {
    return "unknown";
  }
}

/**
 * Builds the evidence-card column for the selected sources, in the
 * given order (the packet's S order). Pure and deterministic: the same
 * question and sources always produce the same cards and coverage.
 */
export function buildGroundedResearchEvidenceCards(
  question: string,
  sources: readonly OriginResearchSource[],
): GroundedResearchEvidenceCardSet {
  const keys = extractQuestionKeys(question);
  const cards: GroundedResearchEvidenceCard[] = sources.map((source, index) => {
    const excerpt = compactExcerpt(source.excerpt);
    return {
      evidenceId: `E${index + 1}`,
      sourceIndex: index,
      title: source.title,
      url: source.url,
      domain: cardDomain(source),
      claimSentences: selectClaimSentences(excerpt, keys),
      excerpt,
      sectionHint: "",
      publishedDateForms: groundedResearchPacketDateForms(source.revisionTimestamp),
      retrievedDateForms: groundedResearchPacketDateForms(source.retrievedAt),
      applicability: { periodSignals: [], transitionalSignalTerms: [] },
      supportState: "in-source",
    };
  });
  return { cards, coverage: selectCoverage(question, keys, cards) };
}
