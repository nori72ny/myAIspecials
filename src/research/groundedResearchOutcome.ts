import type { OriginResearchResult } from "../legacy/originResearchSource.js";
import { isAlterEgoMode } from "../lib/orchestration/alterEgoRequestStore.js";

/**
 * Degradation ladder for the grounded-research path (N-1,
 * CONSULT_ADOPTION_DESIGN_2026-11-17 §1). The ladder formalizes where a
 * research request lands when each stage succeeds or fails, so a request
 * always lands on exactly one tier and the landing is observable in
 * routing metadata and logs:
 *
 * - T0: the bounded synthesis stage produced an answer that passed the
 *   unchanged citation validator and was adopted (a salvaged adoption
 *   that passed the R-3 floor guard counts as T0).
 * - T1: re-synthesis on a compressed evidence packet. Reserved only —
 *   its firing conditions depend on the R-0 route attribution of the
 *   synthesis-unavailability failures, so no code path emits T1 yet.
 * - T3: the deterministic extractive partial answer (R-1): no model
 *   call, source attributions with verbatim excerpt quotes.
 * - T4: the grounded hold (abstain): no usable sources, or a terminal
 *   guard landing. The body states concretely why no answer can be
 *   given (see buildGroundedResearchAbstainAnswer).
 *
 * Tier T2 from the external consultation (a second provider route) is
 * deliberately NOT a tier: route failover already happens inside T0's
 * dispatch, so a route switch is recorded as an attempt of T0, never as
 * a ladder landing.
 */
export type OriginResearchTier = "T0" | "T1" | "T3" | "T4";

/**
 * The three-valued outcome of a research request (§1.2):
 * - ANSWERED: a T0 adopted synthesis answer.
 * - PARTIAL: a T3 extractive answer, or a T0 answer that delivers only
 *   the confirmed range (records-path partial).
 * - ABSTAIN: a T4 hold; always carries an abstain reason.
 */
export type OriginResearchOutcome = "ANSWERED" | "PARTIAL" | "ABSTAIN";

/**
 * Why a research request abstained. The first four values are the
 * search-grounding failure vocabulary; "budget-exhausted" is reserved
 * for a future pre-send budget landing (N-4) and for the terminal
 * guard, and "high-risk-insufficient-sources" for the risk-tier
 * routing landing (N-5). Reason codes are metadata and log vocabulary
 * only — they never appear in user-facing text.
 */
export type OriginResearchAbstainReason =
  | "no-sources"
  | "no-fresh-sources"
  | "provider-error"
  | "monthly-cap-reached"
  | "budget-exhausted"
  | "high-risk-insufficient-sources";

export interface OriginResearchLanding {
  tier: OriginResearchTier;
  outcome: OriginResearchOutcome;
  abstainReason?: OriginResearchAbstainReason;
}

/** Landing for an adopted synthesis answer (tier T0). */
export function researchLandingForAdopted(partial: boolean): OriginResearchLanding {
  return partial
    ? { tier: "T0", outcome: "PARTIAL" }
    : { tier: "T0", outcome: "ANSWERED" };
}

/** Landing for the deterministic extractive partial answer (tier T3). */
export function researchLandingForPartialAnswer(): OriginResearchLanding {
  return { tier: "T3", outcome: "PARTIAL" };
}

/** Landing for the grounded hold (tier T4). */
export function researchLandingForAbstain(reason: OriginResearchAbstainReason): OriginResearchLanding {
  return { tier: "T4", outcome: "ABSTAIN", abstainReason: reason };
}

/**
 * Map a research result that produced no usable sources onto the
 * abstain reason that describes what actually happened: the grounding
 * pipeline's own failure vocabulary when present, a provider error when
 * the executor itself failed, and no-sources otherwise (a completed
 * search with nothing usable).
 */
export function researchAbstainReasonForResearchResult(
  result: Pick<OriginResearchResult, "groundingFailure" | "failure">,
): OriginResearchAbstainReason {
  if (result.groundingFailure) return result.groundingFailure;
  if (result.failure) return "provider-error";
  return "no-sources";
}

/**
 * What was missing, per abstain reason — the middle of the hold's
 * three parts (display measure 4-C; ANSWER_DISPLAY_COMPARISON_
 * 2026-11-26 §4): what was tried and what fell short, in one short
 * statement. The lead already states that nothing could be
 * confirmed, so the former repeated tail ("確認できた情報は
 * ありませんでした" / "There is no information I could confirm")
 * is gone from every entry.
 */
const ABSTAIN_REASON_TEXT: Record<OriginResearchAbstainReason, { ja: string; en: string }> = {
  "no-sources": {
    ja: "関連する公開情報源を探しましたが、条件に合う出典が見つかりませんでした。",
    en: "I searched for relevant public sources, but none met the conditions.",
  },
  "no-fresh-sources": {
    ja: "情報源は見つかりましたが、いずれも必要な新しさを満たしていなかったため、古い情報を現在の情報として示すことはしませんでした。",
    en: "Sources were found, but none was fresh enough for this question, so older information was not presented as current.",
  },
  "provider-error": {
    ja: "情報源を取得する処理で問題が発生し、出典を確認できませんでした。",
    en: "Something went wrong while retrieving sources, so no source could be checked.",
  },
  "monthly-cap-reached": {
    ja: "今月の検索利用の上限に達しているため、今回は検索を実行できませんでした。",
    en: "This month's search limit has been reached, so no search could be run this time.",
  },
  "budget-exhausted": {
    ja: "制限時間内に裏付けの確認を終えることができませんでした。",
    en: "The verification could not be completed within the time budget.",
  },
  "high-risk-insufficient-sources": {
    ja: "重要な内容のため複数の独立した出典による裏付けが必要ですが、十分な出典が揃いませんでした。",
    en: "Because this is an important topic, backing from multiple independent sources is required, but not enough sources were available.",
  },
};

/**
 * Alter-ego mode (2026-11-28): the same reason statements in the
 * plain register, Japanese only. The hold body is fixed text — it
 * never passes through the model — so the register switch the mode
 * applies to generated answers (see groundedResearchSynthesisV12)
 * must be applied here deterministically, or a held answer would
 * stay polite while every other answer speaks plainly. Content and
 * honesty are unchanged: what was tried, what fell short, and the
 * refusal to guess are stated exactly as in the standard texts; no
 * first person and no persona traits are added. English has no
 * polite/plain register distinction in these texts, so the English
 * hold is identical in both modes.
 */
const ABSTAIN_REASON_TEXT_ALTER_EGO_JA: Record<OriginResearchAbstainReason, string> = {
  "no-sources": "関連する公開情報源を探したけど、条件に合う出典が見つからなかった。",
  "no-fresh-sources":
    "情報源は見つかったけど、いずれも必要な新しさを満たしていなかったから、古い情報を現在の情報として示すことはしなかった。",
  "provider-error": "情報源を取る処理で問題が起きて、出典を確認できなかった。",
  "monthly-cap-reached": "今月の検索利用の上限に達しているから、今回は検索を実行できなかった。",
  "budget-exhausted": "制限時間内に裏付けの確認を終えることができなかった。",
  "high-risk-insufficient-sources":
    "重要な内容だから複数の独立した出典による裏付けが必要だけど、十分な出典が揃わなかった。",
};

/**
 * Upper bound on a query that may be echoed in the hold text. The echo
 * exists so a person can recognize their own short question in the
 * hold; it is not a quotation channel. Text that was never written to
 * be displayed — an internal instruction sent as a message, a long
 * pasted passage — must never reappear in the answer body (P1,
 * WEEKLY_INSPECTION_P1_DIAGNOSIS_2026-11-23), so above this length the
 * hold falls back to its generic lead. The rule is all-or-nothing on
 * the whole query: merely truncating harder would still leak the head
 * of such a text. This builder is the single generator shared by
 * every tier-T4 landing (the grounded path, the terminal guard, and
 * the publication gate's hold on both chat routers), so this one
 * bound closes the echo on all of them. The alter-ego register
 * switch lives in this same builder, so it covers every landing
 * too; with the mode off the output is byte-identical.
 */
const MAX_ECHOED_QUERY_LENGTH = 40;

/** Query as it may be echoed back in the hold text: collapsed, quote-safe, short queries only. */
function displayQueryTopic(query: string): string {
  const normalized = query
    .normalize("NFKC")
    .replace(/[\s「」『』"“”]+/g, " ")
    .trim();
  return normalized.length <= MAX_ECHOED_QUERY_LENGTH ? normalized : "";
}

/**
 * Tier-T4 hold body (§1.4): replaces the former fixed template.
 * Shortened under display measure 4-C (ANSWER_DISPLAY_COMPARISON_
 * 2026-11-26 §4) to three parts, the point first: (1) the lead —
 * nothing could be confirmed, so no answer is guessed; (2) the
 * reason — what was tried and what fell short, per abstain reason;
 * (3) the closing — where the definitive information can be
 * checked (the official announcement) and the remaining next
 * action (providing a source; retrying is the display's unified
 * もう一度試す button, so the text no longer repeats it). The
 * lead makes no claim about whether a search ran; what
 * was tried is stated by the reason text, so the direct path's
 * gate landing (searched: false, whose only reason is the
 * search-neutral high-risk one) stays truthful. The text never
 * contains internal vocabulary (no route names, error codes, or
 * tier labels) and never guesses at the answer.
 */
export function buildGroundedResearchAbstainAnswer(input: {
  query: string;
  language: "ja" | "en";
  reason: OriginResearchAbstainReason;
  /**
   * Whether a source search was actually performed before landing
   * here. The research path always searches; the direct path's
   * publication gate (N-5b) lands on this same tier-T4 hold without
   * having searched and passes false. Since the 4-C shortening the
   * text no longer depends on this flag: the lead claims no search
   * either way, and what was tried is stated by the reason text —
   * the only reason the gate landing uses
   * (high-risk-insufficient-sources) is search-neutral, so both
   * landings stay truthful. The flag remains part of the input so
   * call sites keep recording which landing produced the hold.
   */
  searched?: boolean;
}): string {
  const topic = displayQueryTopic(input.query);
  if (input.language === "en") {
    const reasonText = ABSTAIN_REASON_TEXT[input.reason].en;
    const lead = topic
      ? `For "${topic}", I have no confirmed information, so I will not guess an answer.`
      : "I have no confirmed information, so I will not guess an answer.";
    return `${lead}\n\n${reasonText}\n\nFor the definitive information, please check the official announcement, or provide a public source you would like checked.`;
  }
  // Alter-ego mode: the whole hold switches to the plain register
  // (lead, reason, closing), with the mode off the text below is
  // byte-identical to the standard hold.
  if (isAlterEgoMode()) {
    const lead = topic
      ? `「${topic}」については、確認できた情報がないから、推測では答えない。`
      : "確認できた情報がないから、推測では答えない。";
    return `${lead}\n\n${ABSTAIN_REASON_TEXT_ALTER_EGO_JA[input.reason]}\n\n正確な情報は、公式の発表などで確認してほしい。確認したい公開情報源があれば出して。`;
  }
  const reasonText = ABSTAIN_REASON_TEXT[input.reason].ja;
  const lead = topic
    ? `「${topic}」については、確認できた情報がないため、推測で回答しません。`
    : "確認できた情報がないため、推測で回答しません。";
  return `${lead}\n\n${reasonText}\n\n正確な情報は、公式の発表などでご確認ください。確認したい公開情報源があれば提示してください。`;
}

/**
 * Minimum length of a substantive unit, mirroring the R-3 salvage
 * floor guard (groundedResearchSynthesisV12): a unit whose text, with
 * citations and URLs removed, reaches this many characters counts as
 * substantive.
 */
export const RESEARCH_TERMINAL_MIN_SUBSTANTIVE_CHARS = 12;

/**
 * Whether a research answer body carries at least one substantive
 * unit: a line that still has real text once citation tokens, bare
 * URLs, and Markdown structure markers are removed. A body made only
 * of citation shells, links, or whitespace has none.
 */
export function hasSubstantiveResearchUnit(text: string): boolean {
  for (const rawLine of text.split("\n")) {
    const stripped = rawLine
      .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[S\d+\]/g, " ")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[-*・]\s*/, "")
      .trim();
    if (stripped.length >= RESEARCH_TERMINAL_MIN_SUBSTANTIVE_CHARS) return true;
  }
  return false;
}

/**
 * Terminal guarantee (§1.4): the research path's final assembly returns
 * the given body unchanged when it carries a substantive unit, and the
 * fallback body (the tier-T4 hold text) otherwise. An empty or
 * shell-only body can therefore never leave the final assembly.
 */
export function ensureGroundedResearchTerminalBody(
  body: string,
  buildFallback: () => string,
): { content: string; guardFired: boolean } {
  if (hasSubstantiveResearchUnit(body)) return { content: body, guardFired: false };
  return { content: buildFallback(), guardFired: true };
}
