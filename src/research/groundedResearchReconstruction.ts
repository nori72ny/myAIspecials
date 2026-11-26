/**
 * Deterministic reconstruction of a research answer from already
 * retrieved evidence (K-06 案A, SOURCES_ONLY_FALLBACK_DIAGNOSIS_
 * 2026-11-25).
 *
 * When the model synthesis is not adopted (provider failure or
 * citation-validation rejection), the chat path used to land
 * directly on the sources-only partial answer — a failure notice
 * plus a source list — even when the retrieved sources themselves
 * already state the answer. This module assembles an answer from
 * the existing verified assets only, with no new generation:
 *
 *  (a) the evidence packet's answer-bearing sentences
 *      (groundedResearchEvidencePacket.ts), restricted to
 *      excerpt-origin sentences that carry the question's own keys
 *      AND an answer-bearing signal of their own (a number, a value
 *      term, or two distinct key matches — a sentence that merely
 *      restates the question's framing is not an answer), presented
 *      as verbatim source statements under the partial answer's R-1
 *      hygiene (prepareGroundedResearchVerbatimSentence) — never
 *      truncated, because a truncated sentence is no longer
 *      verbatim; and
 *  (b) the PR-3/PR-4 value-vote template
 *      (groundedResearchTemplateFallback.ts), computed in enforce
 *      form: a scalar value confirmed across independent sources,
 *      stated directly with its as-of date.
 *
 * Establishment discipline: the reconstruction is established only
 * when the vote fires or at least one sentence survives every gate
 * above. Anything less returns not-established and the caller falls
 * back to the standing partial answer — the reconstruction can only
 * ever replace the sources-only template, never an adopted
 * synthesis, and never make a landing worse. Numeric discipline
 * holds by construction: every number in the output comes from a
 * confirmed vote value or from inside a verbatim source sentence
 * cited to that source.
 */
import type { OriginResearchSource } from "../legacy/originResearchSource.js";
import {
  buildGroundedResearchEvidencePacket,
  extractPacketQuestionKeys,
  packetSentenceHasAnswerBearingSignal,
} from "./groundedResearchEvidencePacket.js";
import {
  tryRecoveryTemplateFallback,
  type RecoveryTemplateFallbackResult,
} from "./groundedResearchTemplateFallback.js";
import { prepareGroundedResearchVerbatimSentence } from "./groundedResearchV11.js";
import { originSourcePeriodAnnotation } from "../search/originOfficialEdition.js";

/** At most this many verbatim sentences ride the reconstruction. */
export const GROUNDED_RESEARCH_RECONSTRUCTION_MAX_SENTENCES = 5;

/**
 * A prepared sentence longer than this is skipped, not truncated:
 * past this length the "sentence" is a page run, not a statement.
 */
export const GROUNDED_RESEARCH_RECONSTRUCTION_SENTENCE_MAX_CHARS = 240;

export type GroundedResearchReconstructionVia = "value-vote" | "packet-sentences";

export interface GroundedResearchReconstructionAttempt {
  established: boolean;
  /** Which component carries the answer (the vote wins when both fire). */
  via: GroundedResearchReconstructionVia | null;
  /** The assembled answer body (present only when established). */
  text?: string;
  /** Verbatim sentences included in the body. */
  sentenceCount: number;
  /** The value-vote outcome, for observability (codes only). */
  voteFired: boolean;
  voteType: RecoveryTemplateFallbackResult["type"];
  voteReason?: string;
}

function sourceDomain(source: OriginResearchSource): string {
  if (source.domain) return source.domain;
  try {
    return new URL(source.url).hostname;
  } catch {
    return "";
  }
}

/**
 * The source's publication/revision date as a reader-facing
 * annotation (round-8 measure E: F_GROUP_ROUND8_PROBE_2026-11-26 /
 * ROUND8_AGGREGATION_2026-11-26, the F-03 shape). The packet-
 * sentences landing quotes sources of different vintages side by
 * side; without a date, a stale value ("現在 1.00%") reads as
 * current simply because it is quoted prominently. The annotation
 * sits OUTSIDE the quote, so the quoted sentence stays verbatim —
 * it labels the source's date, it does not edit its statement. A
 * source with no parseable date gets no annotation: an unknown
 * vintage is shown as unknown, never dressed up with a guessed
 * date. The vote line needs none — the template already states its
 * value with its as-of date.
 */
function sourceDateAnnotation(source: OriginResearchSource, language: "ja" | "en"): string {
  // Follow-up measure 3: the annotation names the source's
  // EDITION when its title states one （対象：令和○年○月分） —
  // a statistics release is current or stale by the period it
  // reports, not by the day its page was posted — and falls back
  // to the measure-E date rule otherwise. The shared reader
  // (originSourcePeriodAnnotation) keeps both landings on one
  // rule: edition first, stated date second, nothing when the
  // source states neither.
  return originSourcePeriodAnnotation(source, language);
}

/** The unified source list (all retrieved sources, grounded numbering). */
function buildReconstructionSourceList(
  sources: readonly OriginResearchSource[],
  language: "ja" | "en",
): string {
  const lines = sources.map((source, index) => {
    const id = `S${index + 1}`;
    const domain = sourceDomain(source);
    const head = language === "en"
      ? (domain ? `- ${id}: ${source.title} (${domain})` : `- ${id}: ${source.title}`)
      : (domain ? `- ${id}: ${source.title}（${domain}）` : `- ${id}: ${source.title}`);
    const annotation = sourceDateAnnotation(source, language);
    return `${annotation ? `${head} ${annotation}` : head}\n  ${source.url}`;
  });
  return `${language === "en" ? "## Sources" : "## 出典"}\n${lines.join("\n")}`;
}

/**
 * Try the deterministic reconstruction over the kept grounded
 * sources. Pure and deterministic: no model, no network; the only
 * clock read is the caller-supplied `nowMs` handed to the value
 * vote's freshness discipline.
 */
export function tryGroundedResearchReconstruction(input: {
  question: string;
  sources: readonly OriginResearchSource[];
  language: "ja" | "en";
  nowMs?: number;
}): GroundedResearchReconstructionAttempt {
  const { question, sources, language } = input;
  // (b) The value vote, in enforce form: this landing exists
  // precisely for the cases the synthesis could not answer, and a
  // confirmed multi-source scalar is the strongest deterministic
  // answer the retrieved evidence can carry. (The PR-4 router sites
  // keep their own env-mode discipline; when that mode is enforce
  // the router's template site fires first and this module is never
  // reached.)
  const vote: RecoveryTemplateFallbackResult = tryRecoveryTemplateFallback({
    question,
    sources,
    mode: "enforce",
    nowMs: input.nowMs,
    language,
  });

  // (a) Packet sentences: excerpt-origin only (a title is a label,
  // not a statement), carrying at least one of the question's own
  // keys (the relevance gate — a sentence the packet scored on
  // answer-bearing signals alone, like a stray digit, is not shown
  // to answer this question), hygienic and complete or skipped.
  // Bare-number keys (the "1" of a product name like "X1") are not
  // relevance evidence: they substring-match almost any sentence
  // that contains a digit ("17時"), so the gate only honors word
  // keys and number-with-unit keys.
  const keys = extractPacketQuestionKeys(question)
    .filter((key) => !/^[\d,.]+$/.test(key.text));
  const packet = buildGroundedResearchEvidencePacket(sources, question);
  const seenPrepared = new Set<string>();
  const sentences: { prepared: string; sourceIndex: number; score: number; order: number }[] = [];
  packet.sentences.forEach((sentence, order) => {
    if (sentence.origin !== "excerpt") return;
    // Substance gate: a single key match is not enough on its own —
    // the sentence must also carry an answer-bearing signal (a
    // number or a value term) or match two distinct keys. Without
    // this, a sentence that merely restates the question's framing
    // (現在確認できた公開情報です for 今日の公開情報を調査して
    // ください) would pose as an answer.
    const matchedKeys = keys.filter((key) => sentence.text.includes(key.text));
    if (matchedKeys.length === 0) return;
    if (matchedKeys.length < 2 && !packetSentenceHasAnswerBearingSignal(sentence.text)) return;
    const prepared = prepareGroundedResearchVerbatimSentence(sentence.text);
    if (!prepared) return;
    if (prepared.length > GROUNDED_RESEARCH_RECONSTRUCTION_SENTENCE_MAX_CHARS) return;
    if (seenPrepared.has(prepared)) return;
    seenPrepared.add(prepared);
    sentences.push({ prepared, sourceIndex: sentence.sourceIndex, score: sentence.score, order });
  });
  sentences.sort((a, b) => (b.score - a.score) || (a.order - b.order));
  const selected = sentences.slice(0, GROUNDED_RESEARCH_RECONSTRUCTION_MAX_SENTENCES);

  const base: GroundedResearchReconstructionAttempt = {
    established: false,
    via: null,
    sentenceCount: selected.length,
    voteFired: vote.fired,
    voteType: vote.type,
    ...(vote.reason ? { voteReason: vote.reason } : {}),
  };
  if (!vote.fired && selected.length === 0) return base;
  if (sources.length === 0) return base;

  const sentenceLines = selected.map((sentence) => {
    const source = sources[sentence.sourceIndex];
    const citation = `[S${sentence.sourceIndex + 1}](${source.url})`;
    // Measure E: the carrying source's date rides after the
    // citation, so a quoted value's vintage is visible at the
    // point where the value is read (see sourceDateAnnotation).
    const annotation = sourceDateAnnotation(source, language);
    const line = language === "en"
      ? `"${sentence.prepared}" ${citation}`
      : `「${sentence.prepared}」 ${citation}`;
    return annotation ? `${line} ${annotation}` : line;
  });

  // The vote's answer line carries no S-numbers (it names its
  // confirming domains in prose), so it composes safely with the
  // unified grounded numbering used by the sentence citations and
  // the source list. The template's own confirming-source list is
  // replaced by that unified list; if the template text ever loses
  // its source-section shape, the whole text is kept as-is instead
  // (defensive: never mangle a confirmed direct answer).
  let voteLine: string | null = null;
  if (vote.fired && vote.text) {
    const splitAt = vote.text.indexOf("\n\n## ");
    if (splitAt < 0) {
      // No recognizable source section to replace: keep the vote
      // text whole and let it stand alone rather than mixing two
      // numberings (or two source lists) into one body.
      return { ...base, established: true, via: "value-vote", text: vote.text, sentenceCount: 0 };
    }
    voteLine = vote.text.slice(0, splitAt);
  }

  const blocks: string[] = [];
  if (voteLine) {
    blocks.push(voteLine);
  } else {
    blocks.push(language === "en"
      ? "Here is what the retrieved sources themselves state on your question:"
      : "取得した出典の記述から、ご質問に関係する内容をそのままお伝えします。");
  }
  if (sentenceLines.length > 0) {
    blocks.push(sentenceLines.join("\n"));
  }
  blocks.push(buildReconstructionSourceList(sources, language));

  return {
    ...base,
    established: true,
    via: vote.fired ? "value-vote" : "packet-sentences",
    text: blocks.join("\n\n"),
  };
}
