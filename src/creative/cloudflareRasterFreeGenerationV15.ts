/**
 * Guarded Cloudflare raster generation: the only path by which the V1.5
 * raster router may deliver an AI-generated image.
 *
 * A request is delivered only when every $0.00 proof stage passes, in order:
 *   0. Pricing evidence (Neuron rates / free allocation) is inside its
 *      verified window — stale evidence stops execution.
 *   1. Plan proof: the account is verifiably on the Workers Free bundled
 *      allocation with no active paid Workers subscription, and the fixed
 *      model schema is available on that plan.
 *   2. Quota pre-check: today's measured Neuron usage plus a deterministic
 *      upper-bound reserve for this exact request fits in the remaining free
 *      allocation. The reserve covers the full quality layer up front:
 *      (planned candidates + at most one retry) x (generation estimate +
 *      semantic-critic reserve). Inference is never sent when the reserve
 *      does not fit; candidate count shrinks to what the quota affords.
 *   3. Generation via the existing Cloudflare provider (which repeats the
 *      plan proof internally before inference).
 *   4. Delivery gates per candidate: the structural critic (local) and the
 *      semantic critic (Moondream on the same Free allocation) must pass.
 *      With multiple candidates, the highest-scoring passing candidate is
 *      delivered (best-of-N). If none passes and a retry was budgeted, one
 *      revised attempt is made with the best failed candidate's critic
 *      findings folded into the prompt/negative prompt. The technical pixel
 *      critic has no server-side decoder available and keeps running
 *      client-side through the existing inspectRasterBlobV15 path; it is not
 *      silently dropped, it is simply not a server gate (see PR notes).
 *   5. Post-generation reconciliation: the measured account-level Neuron
 *      delta must be positive and within the reserved bound. Cloudflare's
 *      analytics aggregation lags minutes behind inference, so when the
 *      delta has not appeared inside the polling window the delivery may
 *      instead rest on the usage every inference call of this request
 *      reported for itself — complete reports only, total within the same
 *      reserved bound, and no contrary aggregate evidence (an over-bound
 *      or backwards-moving delta, or a window with no successful aggregate
 *      read, never falls back). Otherwise the generated image is withheld
 *      — a generated-but-unproven image is never delivered.
 *
 * Quality layer, all inside the same $0.00 proof:
 *   - Prompt enhancement (fail-soft): the user prompt is first rewritten by
 *     the free chat model for composition/texture/lighting. Any failure
 *     keeps the original prompt. See rasterPromptEnhancementV15.
 *   - Model choice: FLUX.2 Klein 4B is the default (~126 reserved Neurons
 *     per 1024x1024 candidate). FLUX.2 Klein 9B is an explicit opt-in via
 *     ORIGIN_CLOUDFLARE_IMAGE_MODEL (~1,373 Neurons per candidate, ~11x the
 *     cost for a higher-quality model). Models without published Neuron
 *     pricing encoded in the quota module fail closed.
 *   - Pollinations is never used: its credit system can draw from a paid
 *     balance, so a structural $0.00 proof is impossible there.
 */
import {
  generateCloudflareRasterImageV15,
  verifyCloudflareRasterFreeModelV15,
  type CloudflareRasterImageResultV15,
} from './cloudflareRasterImageProviderV15.js';
import { critiqueRasterStructureV15, type RasterStructuralCriticResultV15 } from './rasterImageCriticV15.js';
import {
  critiqueCloudflareRasterSemanticV15,
  type RasterSemanticCriticResultV15,
} from './cloudflareRasterSemanticCriticV15.js';
import type { RasterImageRequestV15, RasterImageResultV15 } from './rasterImageProviderV15.js';
import {
  assertCloudflareRasterPricingEvidenceCurrentV15,
  decideCloudflareUsageReconciliationV15,
  estimateCloudflareRasterGenerationNeuronsV15,
  fetchCloudflareDailyNeuronsUsedV15,
  reconcileCloudflareRasterUsageV15,
  CLOUDFLARE_FREE_DAILY_NEURONS_V15,
  CLOUDFLARE_RASTER_PRICED_MODELS_V15,
  RASTER_SEMANTIC_CRITIC_RESERVED_NEURONS_V15,
  type CloudflareRasterPricedModelV15,
  type CloudflareUsageReconciliationMethodV15,
  type CloudflareUsageReconciliationOptionsV15,
} from './cloudflareRasterFreeQuotaV15.js';
import { enhanceRasterPromptV15 } from './rasterPromptEnhancementV15.js';

export const CLOUDFLARE_RASTER_FREE_PROOF_DEFAULT_MODEL_V15 = '@cf/black-forest-labs/flux-2-klein-4b' as const;
const MAX_CANDIDATES_V15 = 2;

export type CloudflareRasterFreeProofUsageV15 = {
  date: string;
  allocationNeurons: number;
  usedBeforeNeurons: number;
  reservedNeurons: number;
  estimatedGenerationNeurons: number;
  semanticCriticReservedNeurons: number;
  candidatesPlanned: number;
  candidatesGenerated: number;
  retryBudgeted: boolean;
  observedDeltaNeurons: number;
  usedAfterNeurons: number;
  /** Which evidence carried the delivery decision at Stage 5. */
  reconciliationMethod: CloudflareUsageReconciliationMethodV15;
  /**
   * Total Neurons the request's own inference calls reported for
   * themselves, or null when at least one call reported no usable number.
   * Informational on the aggregate path; the delivery basis on the
   * per-request path.
   */
  reportedNeurons: number | null;
};

export type CloudflareRasterFreeProofQualityV15 = {
  promptEnhancement: { applied: boolean; model: string | null; reason: string | null };
  candidates: readonly {
    index: number;
    retried: boolean;
    semanticScore: number | null;
    passed: boolean;
    selected: boolean;
  }[];
  retryUsed: boolean;
  selectedCandidateIndex: number;
};

export type CloudflareRasterFreeProofResultV15 = {
  result: RasterImageResultV15;
  structural: RasterStructuralCriticResultV15;
  semantic: RasterSemanticCriticResultV15;
  usage: CloudflareRasterFreeProofUsageV15;
  quality: CloudflareRasterFreeProofQualityV15;
  externalNetworkRequests: number;
};

export type CloudflareRasterFreeProofOptionsV15 = {
  now?: () => number;
  usageVerification?: CloudflareUsageReconciliationOptionsV15;
  /** Upper bound for best-of-N, already policy-decided by the caller (1-2). */
  maxCandidates?: number;
  /** Budget one revised retry when every candidate fails the gates. */
  allowRetry?: boolean;
};

function credentials(env: NodeJS.ProcessEnv): { accountId: string; apiToken: string } | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '';
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim() ?? '';
  if (!/^[a-f0-9]{32}$/i.test(accountId) || apiToken.length < 20 || apiToken.length > 4096) return null;
  return { accountId, apiToken };
}

function errorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^[A-Z0-9_]{3,80}$/.test(code) ? code : 'RASTER_GENERATION_FAILED';
}

type CandidateAttemptV15 = {
  index: number;
  retried: boolean;
  result: CloudflareRasterImageResultV15 | null;
  structural: RasterStructuralCriticResultV15 | null;
  semantic: RasterSemanticCriticResultV15 | null;
  errorCode: string | null;
  externalNetworkRequests: number;
};

export async function generateCloudflareRasterImageFreeProofV15(
  input: RasterImageRequestV15,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  options: CloudflareRasterFreeProofOptionsV15 = {},
): Promise<CloudflareRasterFreeProofResultV15> {
  const auth = credentials(env);
  if (!auth) throw new Error('CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED');

  const model = (env.ORIGIN_CLOUDFLARE_IMAGE_MODEL?.trim()
    || CLOUDFLARE_RASTER_FREE_PROOF_DEFAULT_MODEL_V15) as CloudflareRasterPricedModelV15;
  if (!(CLOUDFLARE_RASTER_PRICED_MODELS_V15 as readonly string[]).includes(model)) {
    throw new Error('CLOUDFLARE_MODEL_NOT_PRICED_FOR_FREE_PROOF');
  }
  if (input.model && input.model !== model) {
    throw new Error('CLOUDFLARE_MODEL_NOT_PRICED_FOR_FREE_PROOF');
  }

  const now = options.now ?? Date.now;
  assertCloudflareRasterPricingEvidenceCurrentV15(now());

  // Stage 1: plan proof (Workers Free, no paid subscription, model schema).
  const status = await verifyCloudflareRasterFreeModelV15(model, env, fetchImpl);
  if (
    !status.ready
    || status.freeAllocationEligible !== true
    || status.paidFallbackEnabled !== false
    || status.paymentMethodRequired !== false
    || status.secretDelivery !== 'server-only'
  ) {
    throw new Error(status.reason ?? 'CLOUDFLARE_WORKERS_PLAN_UNVERIFIED');
  }
  const planProofRequests = 3; // account settings + subscriptions + model schema, success path.

  const width = typeof input.width === 'number' ? input.width : 1024;
  const height = typeof input.height === 'number' ? input.height : 1024;

  // Quality layer (fail-soft): enhance the prompt with the free chat model.
  // Never throws; the original prompt is used whenever enhancement is
  // unavailable. Runs before the quota baseline because it consumes the
  // OpenRouter free pool, not the Cloudflare Neuron allocation.
  const enhancement = await enhanceRasterPromptV15(input.prompt, env, fetchImpl, now());
  const effectiveInput: RasterImageRequestV15 = { ...input, prompt: enhancement.prompt, width, height };

  // Stage 2: quota pre-check against today's measured usage. The reserve
  // covers every candidate and the possible retry up front.
  const baseline = await fetchCloudflareDailyNeuronsUsedV15(auth, fetchImpl, now());
  const estimatedGenerationNeurons = estimateCloudflareRasterGenerationNeuronsV15({
    width,
    height,
    model,
    referenceImages: (input.referenceImages ?? []).map(reference => ({
      width: reference.width,
      height: reference.height,
    })),
  });
  const perCandidateReserve = estimatedGenerationNeurons + RASTER_SEMANTIC_CRITIC_RESERVED_NEURONS_V15;
  const remainingNeurons = CLOUDFLARE_FREE_DAILY_NEURONS_V15 - baseline.usedNeurons;
  const requestedCandidates = Math.max(1, Math.min(MAX_CANDIDATES_V15, Math.floor(options.maxCandidates ?? 1)));
  const candidatesPlanned = Math.min(requestedCandidates, Math.floor(remainingNeurons / perCandidateReserve));
  if (candidatesPlanned < 1) throw new Error('CLOUDFLARE_FREE_ALLOCATION_INSUFFICIENT');
  const retryBudgeted = (options.allowRetry ?? true)
    && remainingNeurons - candidatesPlanned * perCandidateReserve >= perCandidateReserve;
  const reservedNeurons = (candidatesPlanned + (retryBudgeted ? 1 : 0)) * perCandidateReserve;

  const attempt = async (
    attemptInput: RasterImageRequestV15,
    index: number,
    retried: boolean,
  ): Promise<CandidateAttemptV15> => {
    try {
      const generated = await generateCloudflareRasterImageV15(attemptInput, env, fetchImpl);
      const structural = critiqueRasterStructureV15(generated.bytes, generated.mimeType, width, height);
      if (!structural.passed) {
        return {
          index, retried, result: generated, structural, semantic: null,
          errorCode: 'RASTER_STRUCTURAL_CRITIC_REJECTED',
          externalNetworkRequests: generated.externalNetworkRequests,
        };
      }
      const semantic = await critiqueCloudflareRasterSemanticV15({
        originalRequest: input.prompt,
        bytes: generated.bytes,
        mimeType: generated.mimeType,
      }, env, fetchImpl);
      return {
        index, retried, result: generated, structural, semantic,
        errorCode: semantic.passed ? null : 'RASTER_SEMANTIC_CRITIC_REJECTED',
        externalNetworkRequests: generated.externalNetworkRequests + semantic.externalNetworkRequests,
      };
    } catch (error) {
      return {
        index, retried, result: null, structural: null, semantic: null,
        errorCode: errorCode(error), externalNetworkRequests: 0,
      };
    }
  };

  // Stage 3+4: generate candidates and apply the delivery gates.
  const attempts: CandidateAttemptV15[] = [];
  for (let index = 0; index < candidatesPlanned; index += 1) {
    attempts.push(await attempt(effectiveInput, index, false));
  }

  const passing = attempts.filter(candidate => candidate.semantic?.passed);
  let winner: CandidateAttemptV15 | null = passing.length
    ? [...passing].sort((a, b) => (b.semantic?.score ?? 0) - (a.semantic?.score ?? 0))[0]!
    : null;

  // Quality layer: one revised retry when nothing passed and it was budgeted.
  let retryUsed = false;
  if (!winner && retryBudgeted) {
    const scored = attempts.filter(candidate => candidate.semantic);
    const reference = scored.length
      ? [...scored].sort((a, b) => (b.semantic?.score ?? 0) - (a.semantic?.score ?? 0))[0]!
      : attempts[0]!;
    const findings = reference.semantic
      ? [reference.semantic.summary, ...reference.semantic.issues].filter(Boolean).join('; ')
      : 'previous attempt failed the delivery gates';
    const retryInput: RasterImageRequestV15 = {
      ...effectiveInput,
      prompt: `${effectiveInput.prompt} (Revision: fix these problems from the previous attempt: ${findings})`.slice(0, 2048),
      negativePrompt: [input.negativePrompt, ...(reference.semantic?.issues ?? [])]
        .filter(Boolean)
        .join(', ')
        .slice(0, 1000) || undefined,
    };
    const retryAttempt = await attempt(retryInput, attempts.length, true);
    attempts.push(retryAttempt);
    retryUsed = true;
    if (retryAttempt.semantic?.passed) winner = retryAttempt;
  }

  if (!winner || !winner.result || !winner.structural || !winner.semantic) {
    // Nothing deliverable. Prefer the most informative failure: a semantic
    // rejection over a structural one over the first provider error.
    if (attempts.some(candidate => candidate.semantic)) throw new Error('RASTER_SEMANTIC_CRITIC_REJECTED');
    if (attempts.some(candidate => candidate.structural)) throw new Error('RASTER_STRUCTURAL_CRITIC_REJECTED');
    throw new Error(attempts[0]?.errorCode ?? 'RASTER_GENERATION_FAILED');
  }

  // Stage 5: post-generation usage reconciliation. Images exist at this
  // point but are withheld unless their consumption is attributable to the
  // reserved free allocation — primarily by the measured aggregate delta.
  // Cloudflare's analytics aggregation lags minutes behind inference, so a
  // delta that simply has not appeared yet may fall back to the usage each
  // inference call reported for itself; the decision function in the quota
  // module keeps every doubtful branch (over-bound or backwards delta, no
  // successful aggregate read, any unreported call, reports over the
  // reserve) fail-closed.
  const reconciliation = await reconcileCloudflareRasterUsageV15(
    auth,
    baseline.usedNeurons,
    reservedNeurons,
    fetchImpl,
    options.usageVerification,
  );
  // One entry per inference call this request actually made, across every
  // candidate and the retry: the generation call, plus the semantic-critic
  // call whenever one ran. A call whose usage is unknown is entered as
  // null, which keeps the per-request fallback closed.
  const reportedCallsNeurons: (number | null)[] = [];
  for (const candidate of attempts) {
    reportedCallsNeurons.push(candidate.result?.reportedNeurons ?? null);
    if (candidate.semantic) {
      reportedCallsNeurons.push(candidate.semantic.reportedNeurons);
    } else if (candidate.result && candidate.errorCode !== 'RASTER_STRUCTURAL_CRITIC_REJECTED') {
      // Generation produced an image but the semantic verdict (and its
      // usage report) is missing without a structural rejection to explain
      // the absence: count the critic call as unreported.
      reportedCallsNeurons.push(null);
    }
  }
  const decision = decideCloudflareUsageReconciliationV15(
    reconciliation,
    reservedNeurons,
    reportedCallsNeurons,
  );
  if (
    !decision.deliver
    || decision.method === null
    || reconciliation.observedDeltaNeurons === null
    || reconciliation.finalUsedNeurons === null
  ) {
    throw new Error('CLOUDFLARE_USAGE_RECONCILIATION_FAILED');
  }
  const reconciliationMethod = decision.method;
  const deliveryCostEvidence: RasterImageResultV15['costEvidence'] = reconciliationMethod === 'aggregate-delta'
    ? 'post-generation-usage-zero-confirmed'
    : 'per-request-usage-reported; aggregate-reconciliation-deferred';

  const attemptRequests = attempts.reduce((sum, candidate) => sum + candidate.externalNetworkRequests, 0);
  return {
    result: { ...winner.result, costEvidence: deliveryCostEvidence },
    structural: winner.structural,
    semantic: winner.semantic,
    usage: {
      date: baseline.date,
      allocationNeurons: CLOUDFLARE_FREE_DAILY_NEURONS_V15,
      usedBeforeNeurons: baseline.usedNeurons,
      reservedNeurons,
      estimatedGenerationNeurons,
      semanticCriticReservedNeurons: RASTER_SEMANTIC_CRITIC_RESERVED_NEURONS_V15,
      candidatesPlanned,
      candidatesGenerated: attempts.filter(candidate => candidate.result).length,
      retryBudgeted,
      observedDeltaNeurons: reconciliation.observedDeltaNeurons,
      usedAfterNeurons: reconciliation.finalUsedNeurons,
      reconciliationMethod,
      reportedNeurons: decision.totalReportedNeurons,
    },
    quality: {
      promptEnhancement: {
        applied: enhancement.applied,
        model: enhancement.model,
        reason: enhancement.reason,
      },
      candidates: attempts.map(candidate => ({
        index: candidate.index,
        retried: candidate.retried,
        semanticScore: candidate.semantic?.score ?? null,
        passed: Boolean(candidate.semantic?.passed),
        selected: candidate === winner,
      })),
      retryUsed,
      selectedCandidateIndex: winner.index,
    },
    externalNetworkRequests:
      planProofRequests
      + enhancement.externalNetworkRequests
      + 1 // quota baseline read
      + attemptRequests
      + reconciliation.requests,
  };
}
