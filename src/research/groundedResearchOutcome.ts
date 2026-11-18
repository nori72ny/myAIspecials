import type { OriginResearchResult } from "../legacy/originResearchSource.js";

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

const ABSTAIN_REASON_TEXT: Record<OriginResearchAbstainReason, { ja: string; en: string }> = {
  "no-sources": {
    ja: "関連する公開情報源を探しましたが、条件に合う出典が見つからず、確認できた情報はありませんでした。",
    en: "I searched for relevant public sources, but none met the conditions, so there is no information I could confirm.",
  },
  "no-fresh-sources": {
    ja: "情報源自体は見つかりましたが、いずれもこの質問に必要な新しさを満たしていなかったため、古い情報を現在の情報として示すことはしませんでした。確認できた情報はありませんでした。",
    en: "Sources were found, but none was fresh enough for this question, so older information was not presented as current. There is no information I could confirm.",
  },
  "provider-error": {
    ja: "情報源を取得する処理で問題が発生し、出典を確認できませんでした。確認できた情報はありませんでした。",
    en: "Something went wrong while retrieving sources, so no source could be checked. There is no information I could confirm.",
  },
  "monthly-cap-reached": {
    ja: "今月の検索利用の上限に達しているため、今回は検索を実行できませんでした。確認できた情報はありませんでした。",
    en: "This month's search limit has been reached, so no search could be run this time. There is no information I could confirm.",
  },
  "budget-exhausted": {
    ja: "制限時間内に裏付けの確認を終えることができませんでした。確認できた情報はありませんでした。",
    en: "The verification could not be completed within the time budget. There is no information I could confirm.",
  },
  "high-risk-insufficient-sources": {
    ja: "重要な内容のため複数の独立した出典による裏付けが必要ですが、十分な出典が揃いませんでした。確認できた情報はありませんでした。",
    en: "Because this is an important topic, backing from multiple independent sources is required, but not enough sources were available. There is no information I could confirm.",
  },
};

/** Query as it may be echoed back in the hold text: collapsed, bounded, quote-safe. */
function displayQueryTopic(query: string): string {
  return query
    .normalize("NFKC")
    .replace(/[\s「」『』"“”]+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * Tier-T4 hold body (§1.4): replaces the former fixed template. The
 * text says what was looked for, that nothing could be confirmed, and
 * the concrete reason — per abstain reason — in plain language. It
 * never contains internal vocabulary (no route names, error codes, or
 * tier labels) and never guesses at the answer.
 */
export function buildGroundedResearchAbstainAnswer(input: {
  query: string;
  language: "ja" | "en";
  reason: OriginResearchAbstainReason;
  /**
   * Whether a source search was actually performed before landing
   * here. The research path always searches, so the default (true)
   * keeps its wording unchanged. The direct path's publication gate
   * (N-5b) lands on this same tier-T4 hold without having searched,
   * and passes false so the lead does not claim a search that never
   * happened; the reason text and the closing are shared.
   */
  searched?: boolean;
}): string {
  const topic = displayQueryTopic(input.query);
  const reasonText = ABSTAIN_REASON_TEXT[input.reason][input.language];
  const searched = input.searched !== false;
  if (input.language === "en") {
    const lead = searched
      ? topic
        ? `I searched public sources for "${topic}", but could not verify reliable backing, so I will not guess an answer.`
        : "I searched public sources, but could not verify reliable backing, so I will not guess an answer."
      : topic
        ? `I could not verify reliable backing for "${topic}", so I will not guess an answer.`
        : "I could not verify reliable backing, so I will not guess an answer.";
    return `${lead}\n\n${reasonText}\n\nPlease try again later, or provide a public source you would like checked.`;
  }
  const lead = searched
    ? topic
      ? `「${topic}」について公開情報を調べましたが、裏付けが取れなかったため、推測で回答しません。`
      : "公開情報を調べましたが、裏付けが取れなかったため、推測で回答しません。"
    : topic
      ? `「${topic}」について、出典による裏付けが取れなかったため、推測で回答しません。`
      : "出典による裏付けが取れなかったため、推測で回答しません。";
  return `${lead}\n\n${reasonText}\n\n時間をおいて再度お試しいただくか、確認したい公開情報源があれば提示してください。`;
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
