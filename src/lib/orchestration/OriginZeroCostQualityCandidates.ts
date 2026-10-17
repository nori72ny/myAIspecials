export type OriginZeroCostCandidateStatus =
  | "production-audited"
  | "benchmark-candidate"
  | "blocked-cost-evidence"
  | "blocked-privacy-evidence"
  | "deprecated";

export type OriginZeroCostQualityFamily =
  | "general-answer"
  | "reasoning"
  | "coding"
  | "japanese"
  | "research"
  | "tool-use"
  | "long-context";

export interface OriginZeroCostQualityCandidate {
  readonly providerId: "openrouter-free" | "groq-free" | "cloudflare-workers-ai-free";
  readonly modelId: string;
  readonly status: OriginZeroCostCandidateStatus;
  readonly sourceUrl: string;
  readonly verifiedAt: string;
  readonly reviewAfter: string;
  readonly ownerSpendUsd: 0;
  readonly exactPerRequestZeroPriceProven: boolean;
  readonly privacyEvidenceAccepted: boolean;
  readonly productionAuthWithoutPaymentProven: boolean;
  readonly benchmarkStatus: "current" | "pending" | "not-qualified";
  readonly candidateFamilies: readonly OriginZeroCostQualityFamily[];
  readonly notes: string;
}

export const ORIGIN_ZERO_COST_QUALITY_CANDIDATES: readonly OriginZeroCostQualityCandidate[] = Object.freeze([
  Object.freeze({
    providerId: "openrouter-free",
    modelId: "inclusionai/ling-3.0-flash-sante:free",
    status: "production-audited",
    sourceUrl: "https://openrouter.ai/inclusionai/ling-3.0-flash-sante:free",
    verifiedAt: "2026-09-21T04:59:37.993Z",
    reviewAfter: "2026-10-01T04:59:37.992Z",
    ownerSpendUsd: 0,
    exactPerRequestZeroPriceProven: true,
    privacyEvidenceAccepted: true,
    productionAuthWithoutPaymentProven: true,
    benchmarkStatus: "current",
    candidateFamilies: ["general-answer", "reasoning", "coding", "japanese", "research", "tool-use"] as const,
    notes: "Current production route. Keep until a materially better zero-cost candidate is proven under the same privacy and runtime-cost gates.",
  }),
  Object.freeze({
    providerId: "openrouter-free",
    modelId: "openrouter/free",
    status: "blocked-privacy-evidence",
    sourceUrl: "https://openrouter.ai/openrouter/free/",
    verifiedAt: "2026-09-28T22:30:00.000Z",
    reviewAfter: "2026-10-05T22:30:00.000Z",
    ownerSpendUsd: 0,
    exactPerRequestZeroPriceProven: true,
    privacyEvidenceAccepted: false,
    productionAuthWithoutPaymentProven: true,
    benchmarkStatus: "pending",
    candidateFamilies: ["general-answer", "reasoning", "coding", "research", "tool-use"] as const,
    notes: "Free router selects among changing free models. Random/dynamic routing and model-specific privacy differences prevent production promotion until exact served-route privacy and comparative quality are bounded.",
  }),
  Object.freeze({
    providerId: "groq-free",
    modelId: "openai/gpt-oss-120b",
    status: "blocked-cost-evidence",
    sourceUrl: "https://console.groq.com/docs/rate-limits",
    verifiedAt: "2026-09-28T22:30:00.000Z",
    reviewAfter: "2026-10-05T22:30:00.000Z",
    ownerSpendUsd: 0,
    exactPerRequestZeroPriceProven: false,
    privacyEvidenceAccepted: false,
    productionAuthWithoutPaymentProven: true,
    benchmarkStatus: "pending",
    candidateFamilies: ["general-answer", "reasoning", "coding", "tool-use"] as const,
    notes: "Official Free Plan availability is useful candidate evidence, but free-plan quota is not by itself ORIGIN's required request-bound exact-$0 usage proof. Privacy qualification is also pending.",
  }),
  Object.freeze({
    providerId: "cloudflare-workers-ai-free",
    modelId: "free-allocation-only",
    status: "blocked-cost-evidence",
    sourceUrl: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
    verifiedAt: "2026-09-28T22:30:00.000Z",
    reviewAfter: "2026-10-05T22:30:00.000Z",
    ownerSpendUsd: 0,
    exactPerRequestZeroPriceProven: false,
    privacyEvidenceAccepted: false,
    productionAuthWithoutPaymentProven: true,
    benchmarkStatus: "not-qualified",
    candidateFamilies: ["general-answer", "reasoning", "coding"] as const,
    notes: "10,000-neuron daily free allocation exists, but usage-priced models and paid-plan-only models make provider-level free status insufficient for ORIGIN's exact-$0 per-request rule.",
  }),
]);

function validTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function originZeroCostCandidateIsPromotionEligible(
  candidate: OriginZeroCostQualityCandidate,
  nowMs: number,
): boolean {
  const verifiedAt = validTimestamp(candidate.verifiedAt);
  const reviewAfter = validTimestamp(candidate.reviewAfter);
  return Number.isFinite(nowMs)
    && verifiedAt !== null
    && reviewAfter !== null
    && nowMs >= verifiedAt
    && nowMs <= reviewAfter
    && candidate.ownerSpendUsd === 0
    && candidate.exactPerRequestZeroPriceProven
    && candidate.privacyEvidenceAccepted
    && candidate.productionAuthWithoutPaymentProven
    && candidate.benchmarkStatus === "current"
    && candidate.status === "production-audited";
}

export function listOriginZeroCostBenchmarkCandidates(
  family: OriginZeroCostQualityFamily,
  nowMs: number,
): readonly OriginZeroCostQualityCandidate[] {
  if (!Number.isFinite(nowMs)) return Object.freeze([]);
  return Object.freeze(ORIGIN_ZERO_COST_QUALITY_CANDIDATES.filter((candidate) => {
    const verifiedAt = validTimestamp(candidate.verifiedAt);
    const reviewAfter = validTimestamp(candidate.reviewAfter);
    return verifiedAt !== null
      && reviewAfter !== null
      && nowMs >= verifiedAt
      && nowMs <= reviewAfter
      && candidate.ownerSpendUsd === 0
      && candidate.productionAuthWithoutPaymentProven
      && candidate.candidateFamilies.includes(family)
      && candidate.status !== "deprecated";
  }));
}
