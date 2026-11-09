/**
 * Evidence catalog for the Gemini *limited* (measurement/inspection-only) gate.
 *
 * This is NOT a normal-route provider catalog. It exists solely for the
 * isolated gate in this directory, which the owner approved on 2026-11-09 as a
 * scoped exception to the standing "no Gemini" policy, under the design in
 * ~/workspace/origin-fix/GEMINI_LIMITED_USE_DESIGN_2026-11-09.md:
 *
 * - Only two registered uses: judging a fixed question set, and critiquing
 *   images generated from fixed inspection prompts.
 * - Payloads may consist only of public information and repository-fixed
 *   templates. No user free text, no conversation history, no attachments, no
 *   personal information, and no confidential (work) information — the Gemini
 *   API Additional Terms of Service (effective 2026-03-23) themselves say, in
 *   bold, "Do not submit sensitive, confidential, or personal information to
 *   the Unpaid Services."
 * - On the unpaid (free) tier, Google DOES use submitted content and generated
 *   responses to improve its products, and human reviewers may read, annotate
 *   and process API input and output (the pricing page states "Used to improve
 *   our products: Yes" for the Free Tier). Those uncomfortable facts are pinned
 *   in the evidence type below so they cannot be quietly edited away: the gate
 *   is only acceptable because the registered payloads contain nothing private.
 * - The gate fails closed when this evidence passes `reviewAfter` without a
 *   fresh re-check of the terms/limits and a fresh owner approval.
 *
 * HONEST LIMITS (also recorded in the design document):
 * - The free-tier limits are NOT published by Google; they are only visible in
 *   the owner's own AI Studio rate-limit console. The Flash-Lite figures in the
 *   source description (10 RPM / 250,000 TPM input / 500 RPD, per project per
 *   model) come from secondary aggregation of console displays (2026-10) and
 *   are therefore a planning estimate only. The effective limits of the owner's
 *   own project are UNVERIFIED until checked in AI Studio during activation.
 * - If the effective limits are lower, requests simply fail with HTTP 429 and
 *   the measurement stops; nothing is charged, because the gate is only ever
 *   used with the owner's unpaid-tier API key and no billing account is
 *   attached to that project (activation must re-confirm that no billing
 *   account is attached: attaching one would turn this into a Paid Service,
 *   which is out of scope under the $0.00 rule).
 */

export const ORIGIN_GEMINI_LIMITED_PROVIDER_ID = "google-gemini-limited" as const;

/**
 * Flash-Lite is the only capacity-bearing free-tier family (Flash is ~20 RPD).
 * The model is pinned to this single ID; the gate never auto-selects models.
 */
export const ORIGIN_GEMINI_LIMITED_MODEL_ID = "gemini-3.5-flash-lite" as const;
export type OriginGeminiLimitedModelId = typeof ORIGIN_GEMINI_LIMITED_MODEL_ID;

export function isOriginGeminiLimitedModelId(value: unknown): value is OriginGeminiLimitedModelId {
  return value === ORIGIN_GEMINI_LIMITED_MODEL_ID;
}

export interface OriginGeminiLimitedEvidence {
  providerId: typeof ORIGIN_GEMINI_LIMITED_PROVIDER_ID;
  providerLabel: string;
  modelId: OriginGeminiLimitedModelId;
  /** Pinned fact: on the unpaid tier Google uses submitted content to improve its products. */
  freeTierDataUsedToImproveProducts: true;
  /** Pinned fact: on the unpaid tier human reviewers may read API input and output. */
  freeTierHumanReviewPossible: true;
  /** Pinned scope of the owner's 2026-11-09 approval. Anything wider needs a new approval. */
  approvedScope: "measurement-inspection-only";
  verifiedAt: string;
  reviewAfter: string;
  termsSourceUrl: string;
  pricingSourceUrl: string;
  sourceDescription: string;
}

const ORIGIN_GEMINI_LIMITED_TERMS_SOURCE = "https://ai.google.dev/gemini-api/terms" as const;
const ORIGIN_GEMINI_LIMITED_PRICING_SOURCE = "https://ai.google.dev/gemini-api/docs/pricing" as const;

export const DEFAULT_ORIGIN_GEMINI_LIMITED_CATALOG: readonly OriginGeminiLimitedEvidence[] = [
  {
    providerId: ORIGIN_GEMINI_LIMITED_PROVIDER_ID,
    providerLabel: "ORIGIN 測定専用AI (Gemini 限定利用)",
    modelId: ORIGIN_GEMINI_LIMITED_MODEL_ID,
    freeTierDataUsedToImproveProducts: true,
    freeTierHumanReviewPossible: true,
    approvedScope: "measurement-inspection-only",
    verifiedAt: "2026-11-09T00:00:00.000Z",
    reviewAfter: "2026-12-09T00:00:00.000Z",
    termsSourceUrl: ORIGIN_GEMINI_LIMITED_TERMS_SOURCE,
    pricingSourceUrl: ORIGIN_GEMINI_LIMITED_PRICING_SOURCE,
    sourceDescription:
      "Owner-approved scoped exception (2026-11-09) to the standing no-Gemini policy, limited to measurement/inspection payloads built only from public information and repository-fixed templates (design: GEMINI_LIMITED_USE_DESIGN_2026-11-09.md). Terms re-read directly on 2026-11-09: the Gemini API Additional Terms of Service (effective 2026-03-23) define the free quota as Unpaid Services; Google uses submitted content and generated responses to provide, improve and develop its products and machine-learning technologies, human reviewers may read, annotate and process API input and output, and the terms state in bold: 'Do not submit sensitive, confidential, or personal information to the Unpaid Services.' The pricing page (checked 2026-11-09) lists gemini-3.5-flash-lite as 'Free of charge' on the Free Tier with 'Used to improve our products: Yes'. The EEA/Switzerland/UK paid-terms exception does not apply to Japan. Free-tier numeric limits are NOT published by Google (the rate-limits page directs users to the AI Studio console) and the effective limits of the owner's own project are UNVERIFIED: secondary aggregation of AI Studio console displays (2026-10) reports Flash-Lite at 10 RPM / 250,000 input TPM / 500 RPD per project per model, resetting at midnight Pacific Time. If the effective limits are lower, requests error with HTTP 429 instead of charging, provided no billing account is attached to the project; activation must confirm in AI Studio both the effective limits and that no billing account is attached. Grounding with Google Search is prohibited for this gate (the terms add a 30-day retention for grounding). This evidence is deliberately short-lived (reviewAfter 2026-12-09, one month): the gate fails closed when it passes without a fresh re-check of the terms and limits plus a fresh owner approval.",
  },
] as const;

export type OriginGeminiLimitedCatalogFailureCode =
  | "GEMINI_LIMITED_CATALOG_INVALID"
  | "GEMINI_LIMITED_EVIDENCE_STALE";

export type OriginGeminiLimitedCatalogResult =
  | { ok: true; evidence: OriginGeminiLimitedEvidence }
  | { ok: false; code: OriginGeminiLimitedCatalogFailureCode; message: string };

function parseTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isOfficialGeminiEvidenceUrl(value: string): boolean {
  return value.startsWith("https://ai.google.dev/");
}

function isValidEvidence(entry: OriginGeminiLimitedEvidence): boolean {
  const verifiedAt = parseTimestamp(entry.verifiedAt);
  const reviewAfter = parseTimestamp(entry.reviewAfter);
  return entry.providerId === ORIGIN_GEMINI_LIMITED_PROVIDER_ID
    && isOriginGeminiLimitedModelId(entry.modelId)
    && entry.freeTierDataUsedToImproveProducts === true
    && entry.freeTierHumanReviewPossible === true
    && entry.approvedScope === "measurement-inspection-only"
    && isOfficialGeminiEvidenceUrl(entry.termsSourceUrl)
    && isOfficialGeminiEvidenceUrl(entry.pricingSourceUrl)
    && verifiedAt !== null
    && reviewAfter !== null
    && reviewAfter > verifiedAt;
}

export function selectCurrentOriginGeminiLimitedEvidence(
  catalog: readonly OriginGeminiLimitedEvidence[] = DEFAULT_ORIGIN_GEMINI_LIMITED_CATALOG,
  nowMs: number = Date.now(),
): OriginGeminiLimitedCatalogResult {
  if (!Number.isFinite(nowMs) || catalog.length === 0 || catalog.some((entry) => !isValidEvidence(entry))) {
    return {
      ok: false,
      code: "GEMINI_LIMITED_CATALOG_INVALID",
      message: "Gemini限定利用の証拠カタログが未設定または不正なため、実行を停止しました。",
    };
  }

  const current = catalog.find((entry) => {
    const verifiedAt = parseTimestamp(entry.verifiedAt);
    const reviewAfter = parseTimestamp(entry.reviewAfter);
    return verifiedAt !== null
      && reviewAfter !== null
      && nowMs >= verifiedAt
      && nowMs <= reviewAfter;
  });

  if (!current) {
    return {
      ok: false,
      code: "GEMINI_LIMITED_EVIDENCE_STALE",
      message: "Gemini限定利用の証拠が有効期間外です。規約と上限を再確認し、オーナーの再承認があるまで実行を停止します。",
    };
  }

  return { ok: true, evidence: current };
}
