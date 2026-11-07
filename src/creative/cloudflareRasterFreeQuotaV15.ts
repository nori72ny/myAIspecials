/**
 * Cloudflare Workers AI — request-level $0.00 proof support for raster images.
 *
 * The Workers Free plan has no overage billing mechanism: once the daily free
 * allocation (10,000 Neurons) is exhausted, further operations fail with an
 * error instead of accruing a charge. That structural property is what makes a
 * per-request $0.00 guarantee possible, provided all three checks hold:
 *
 *   1. Plan proof (in cloudflareRasterImageProviderV15.verifyWorkersFreePlan):
 *      the account is verifiably on the bundled Workers Free allocation and no
 *      active paid Workers subscription exists.
 *   2. Pre-inference quota check (this module): today's measured Neuron usage
 *      plus a deterministic upper-bound estimate for this exact request must
 *      fit inside the remaining free allocation before any inference is sent.
 *   3. Post-generation reconciliation (this module): after generation, the
 *      consumption must be attributable to the free allocation that was
 *      reserved. The primary evidence is the usage each inference call of
 *      the request reported for itself (decideCloudflareUsageReconciliationV15):
 *      when every call reported and the reported total is positive and
 *      within the same reserved bound, the request is reconciled on its own
 *      reports. The measured account-level Neuron delta is only secondary
 *      evidence, consulted when the request's own reports are incomplete:
 *      Cloudflare's analytics aggregation lags by minutes and aggregates
 *      the whole account, so a delta that lands inside one request's
 *      polling window routinely carries the backlog of several earlier
 *      requests and exceeds a single request's reserve without anything
 *      being wrong (observed in production on 2026-11-07: in a 12-request
 *      quality batch the second half all failed reconciliation on exactly
 *      this). An aggregate delta therefore neither proves nor vetoes a
 *      single request's attribution; it can only carry a delivery when it
 *      is itself positive and within the reserved bound and the request's
 *      own reports could not.
 *
 * Any ambiguity (usage API errors, malformed payloads, stale pricing
 * evidence, deltas that cannot be reconciled) fails closed: no image is
 * delivered. Neuron prices/allocation below were rechecked against the
 * official pricing page on 2026-11-06 (see IMAGE_GEN_BENCHMARK_2026-11-06.md);
 * the evidence window mirrors the chat free-model catalog cadence, and
 * execution stops when the evidence goes stale instead of trusting old prices.
 */

const GRAPHQL_ORIGIN = 'https://api.cloudflare.com/client/v4/graphql';
const USAGE_QUERY_TIMEOUT_MS = 10_000;

export const CLOUDFLARE_WORKERS_AI_PRICING_SOURCE_V15 =
  'https://developers.cloudflare.com/workers-ai/platform/pricing/' as const;

export const CLOUDFLARE_FREE_DAILY_NEURONS_V15 = 10_000;

/** FLUX.2 Klein 4B published rates, Neurons per 512x512 tile. */
export const FLUX2_KLEIN_4B_INPUT_NEURONS_PER_TILE_V15 = 5.37;
export const FLUX2_KLEIN_4B_OUTPUT_NEURONS_PER_TILE_V15 = 26.05;
export const FLUX2_KLEIN_TILE_PIXELS_V15 = 512;

/**
 * FLUX.2 Klein 9B published rates, Neurons per megapixel. The first output
 * megapixel is a flat 1,363.64 Neurons (a 512x512 image costs the same as a
 * 1024x1024 one); subsequent output megapixels and input-image megapixels
 * are 181.82 Neurons each. Derived from the official USD prices on the same
 * pricing page ($0.015 first MP, $0.002 subsequent/input MP, at the published
 * $0.011 per 1,000 Neurons overage rate: 0.015/0.011*1000 = 1363.64,
 * 0.002/0.011*1000 = 181.82).
 */
export const FLUX2_KLEIN_9B_FIRST_OUTPUT_MP_NEURONS_V15 = 1_363.64;
export const FLUX2_KLEIN_9B_EXTRA_OUTPUT_MP_NEURONS_V15 = 181.82;
export const FLUX2_KLEIN_9B_INPUT_MP_NEURONS_V15 = 181.82;

export const CLOUDFLARE_RASTER_PRICED_MODELS_V15 = [
  '@cf/black-forest-labs/flux-2-klein-4b',
  '@cf/black-forest-labs/flux-2-klein-9b',
] as const;
export type CloudflareRasterPricedModelV15 = (typeof CLOUDFLARE_RASTER_PRICED_MODELS_V15)[number];

/**
 * Conservative Neuron reserve for one Moondream 3.1 semantic-critic call.
 * The critic caps output at 900 tokens (published rate 90,909 Neurons per 1M
 * output tokens ~= 82 Neurons) and its image+question input is bounded by the
 * critic module's own size limits; 256 Neurons is a deliberate over-reserve.
 * The post-generation reconciliation enforces the *combined* reserved bound
 * against the measured delta, so an under-reserve is caught, never billed.
 */
export const RASTER_SEMANTIC_CRITIC_RESERVED_NEURONS_V15 = 256;

export interface CloudflareRasterPricingEvidenceV15 {
  providerId: 'cloudflare-workers-ai-free';
  modelId: '@cf/black-forest-labs/flux-2-klein-4b';
  verifiedAt: string;
  reviewAfter: string;
  sourceUrl: typeof CLOUDFLARE_WORKERS_AI_PRICING_SOURCE_V15;
  sourceDescription: string;
}

export const CLOUDFLARE_RASTER_PRICING_EVIDENCE_V15: CloudflareRasterPricingEvidenceV15 = {
  providerId: 'cloudflare-workers-ai-free',
  modelId: '@cf/black-forest-labs/flux-2-klein-4b',
  verifiedAt: '2026-11-06T00:00:00.000Z',
  reviewAfter: '2026-11-16T00:00:00.000Z',
  sourceUrl: CLOUDFLARE_WORKERS_AI_PRICING_SOURCE_V15,
  sourceDescription:
    'Cloudflare Workers AI official pricing page (updated 2026-10-20) rechecked on 2026-11-06: '
    + 'free allocation is 10,000 Neurons/day (00:00 UTC reset) for Workers Free and Paid; '
    + 'requests beyond the allocation fail with an error, and the Workers Free plan has no '
    + 'Neuron billing row at all (overage billing exists only on Workers Paid). '
    + 'FLUX.2 Klein 4B is priced at 5.37 Neurons input and 26.05 Neurons output per 512px tile '
    + '(about 110 Neurons per 1024x1024 image); FLUX.2 Klein 9B is priced at 1,363.64 Neurons '
    + 'for the first output megapixel plus 181.82 Neurons per subsequent output megapixel and '
    + 'per input-image megapixel (about 1,373 Neurons per 1024x1024 image, roughly 11x the 4B '
    + 'cost, for about 6-7 images per day). Both models are Apache 2.0. The 4B remains the '
    + 'default: the quality layer (prompt enhancement, best-of-N selection, one revised retry) '
    + 'buys more delivered quality per Neuron on the 4B than the 9B upgrade alone, and the 9B '
    + 'is available as an explicit opt-in via ORIGIN_CLOUDFLARE_IMAGE_MODEL. '
    + 'This catalog check does not by itself prove a live account is on Workers Free; the '
    + 'runtime additionally requires the per-request plan proof, quota pre-check, and '
    + 'post-generation usage reconciliation implemented alongside this catalog.',
};

function parseTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Throws a coded error when the pricing evidence is malformed or stale.
 * Mirroring the chat free-model catalog: stale evidence stops execution.
 */
export function assertCloudflareRasterPricingEvidenceCurrentV15(nowMs: number = Date.now()): void {
  const evidence = CLOUDFLARE_RASTER_PRICING_EVIDENCE_V15;
  const verifiedAt = parseTimestamp(evidence.verifiedAt);
  const reviewAfter = parseTimestamp(evidence.reviewAfter);
  if (
    !Number.isFinite(nowMs)
    || verifiedAt === null
    || reviewAfter === null
    || reviewAfter <= verifiedAt
    || evidence.sourceUrl !== CLOUDFLARE_WORKERS_AI_PRICING_SOURCE_V15
  ) {
    throw new Error('RASTER_PRICING_EVIDENCE_INVALID');
  }
  if (nowMs < verifiedAt || nowMs > reviewAfter) {
    throw new Error('RASTER_PRICING_EVIDENCE_STALE');
  }
}

function tilesFor(width: number, height: number): number {
  return Math.ceil(width / FLUX2_KLEIN_TILE_PIXELS_V15) * Math.ceil(height / FLUX2_KLEIN_TILE_PIXELS_V15);
}

/**
 * Deterministic upper-bound Neuron estimate for one FLUX.2 Klein request.
 * 4B: every output tile is charged at input+output rates (the published ~110
 * Neurons per 1024x1024 image charges the input rate only once, so this is a
 * strict over-estimate), and every reference-image tile is charged the same
 * way. 9B: the flat first-output-megapixel charge plus per-megapixel rates
 * for the remaining output area and for reference images, with fractional
 * megapixels rounded up. Over-estimating is intentional: the pre-check must
 * never under-reserve, and reconciliation enforces the bound afterwards.
 */
export function estimateCloudflareRasterGenerationNeuronsV15(input: {
  width: number;
  height: number;
  referenceImages?: readonly { width: number; height: number }[];
  model?: CloudflareRasterPricedModelV15;
}): number {
  const model = input.model ?? '@cf/black-forest-labs/flux-2-klein-4b';
  if (model === '@cf/black-forest-labs/flux-2-klein-9b') {
    const outputMp = (input.width * input.height) / 1_000_000;
    const inputMp = (input.referenceImages ?? [])
      .reduce((sum, reference) => sum + (reference.width * reference.height) / 1_000_000, 0);
    return Math.ceil(
      FLUX2_KLEIN_9B_FIRST_OUTPUT_MP_NEURONS_V15
      + Math.max(0, outputMp - 1) * FLUX2_KLEIN_9B_EXTRA_OUTPUT_MP_NEURONS_V15
      + inputMp * FLUX2_KLEIN_9B_INPUT_MP_NEURONS_V15,
    );
  }
  const outputTiles = tilesFor(input.width, input.height);
  const referenceTiles = (input.referenceImages ?? [])
    .reduce((sum, reference) => sum + tilesFor(reference.width, reference.height), 0);
  const perTile = FLUX2_KLEIN_4B_INPUT_NEURONS_PER_TILE_V15 + FLUX2_KLEIN_4B_OUTPUT_NEURONS_PER_TILE_V15;
  return Math.ceil((outputTiles + referenceTiles) * perTile);
}

export type CloudflareDailyUsageV15 = {
  date: string;
  usedNeurons: number;
  requests: number | null;
};

const DAILY_USAGE_QUERY = `
  query OriginWorkersAiDailyUsage($accountTag: string, $date: Date) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        aiInferenceAdaptiveGroups(limit: 100, filter: { date_geq: $date, date_leq: $date }) {
          count
          sum { totalNeurons }
        }
      }
    }
  }
`;

function neuronValue(sum: Record<string, unknown>): number {
  // The live schema exposes exactly one Neuron total per group: the float64
  // sum.totalNeurons (verified by introspection on 2026-11-07; there is no
  // sum.neurons / sum.requestCount in the schema), and our query selects only
  // that field. A finite, non-negative totalNeurons is therefore required.
  // The retired `neurons` alias is still rejected when present with a
  // conflicting value, so shape ambiguity keeps failing closed.
  const total = sum.totalNeurons;
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) {
    throw new Error('CLOUDFLARE_DAILY_USAGE_UNVERIFIED');
  }
  const legacy = sum.neurons;
  if (legacy !== undefined && legacy !== total) {
    throw new Error('CLOUDFLARE_DAILY_USAGE_UNVERIFIED');
  }
  return total;
}

/**
 * Reads today's (UTC) account-level Workers AI Neuron usage through the
 * Cloudflare GraphQL Analytics API. Any transport error, GraphQL error, or
 * shape ambiguity throws CLOUDFLARE_DAILY_USAGE_UNVERIFIED: unknown usage is
 * never treated as zero usage.
 *
 * Live-schema note: the dataset/field names used here were confirmed against
 * the live Cloudflare GraphQL Analytics schema by introspection on
 * 2026-11-07: the account-level dataset is `aiInferenceAdaptiveGroups` (the
 * previously assumed `workersAiRequestsAdaptiveGroups` does not exist), each
 * group carries a uint64 `count`, and `sum.totalNeurons` is the only Neuron
 * total (there are no `sum.neurons` / `sum.requestCount` fields). The reader
 * still fails closed on any shape mismatch.
 */
export async function fetchCloudflareDailyNeuronsUsedV15(
  auth: { accountId: string; apiToken: string },
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<CloudflareDailyUsageV15> {
  const date = new Date(nowMs).toISOString().slice(0, 10);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), USAGE_QUERY_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(GRAPHQL_ORIGIN, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.apiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'ORIGIN-Personal/1.5',
      },
      body: JSON.stringify({
        query: DAILY_USAGE_QUERY,
        variables: { accountTag: auth.accountId, date },
      }),
      signal: controller.signal,
      redirect: 'error',
      cache: 'no-store',
    });
  } catch {
    throw new Error('CLOUDFLARE_DAILY_USAGE_UNVERIFIED');
  } finally {
    clearTimeout(timer);
  }
  if (!response || !response.ok) throw new Error('CLOUDFLARE_DAILY_USAGE_UNVERIFIED');
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('CLOUDFLARE_DAILY_USAGE_UNVERIFIED');
  }
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    throw new Error('CLOUDFLARE_DAILY_USAGE_UNVERIFIED');
  }
  const data = body.data && typeof body.data === 'object' && !Array.isArray(body.data)
    ? body.data as Record<string, unknown>
    : null;
  const viewer = data?.viewer && typeof data.viewer === 'object' && !Array.isArray(data.viewer)
    ? data.viewer as Record<string, unknown>
    : null;
  const accounts = Array.isArray(viewer?.accounts) ? viewer.accounts : null;
  if (!accounts || accounts.length === 0) throw new Error('CLOUDFLARE_DAILY_USAGE_UNVERIFIED');
  const account = accounts[0] && typeof accounts[0] === 'object' && !Array.isArray(accounts[0])
    ? accounts[0] as Record<string, unknown>
    : null;
  const groups = Array.isArray(account?.aiInferenceAdaptiveGroups)
    ? account.aiInferenceAdaptiveGroups
    : null;
  if (!groups) throw new Error('CLOUDFLARE_DAILY_USAGE_UNVERIFIED');

  let usedNeurons = 0;
  let requests: number | null = 0;
  for (const group of groups) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      throw new Error('CLOUDFLARE_DAILY_USAGE_UNVERIFIED');
    }
    const sum = (group as Record<string, unknown>).sum;
    if (!sum || typeof sum !== 'object' || Array.isArray(sum)) {
      throw new Error('CLOUDFLARE_DAILY_USAGE_UNVERIFIED');
    }
    usedNeurons += neuronValue(sum as Record<string, unknown>);
    // The request count lives on the group itself (uint64 `count`); the live
    // schema has no count field inside `sum`.
    const count = (group as Record<string, unknown>).count;
    if (typeof count === 'number' && Number.isFinite(count) && count >= 0) {
      requests = (requests ?? 0) + count;
    } else {
      requests = null;
    }
  }
  return { date, usedNeurons: Math.round(usedNeurons * 1000) / 1000, requests };
}

export type CloudflareUsageReconciliationOptionsV15 = {
  attempts?: number;
  delayMs?: number;
  totalMs?: number;
};

export type CloudflareUsageReconciliationV15 = {
  reconciled: boolean;
  observedDeltaNeurons: number | null;
  finalUsedNeurons: number | null;
  requests: number;
};

const RECONCILE_DEFAULT_ATTEMPTS = 6;
const RECONCILE_DEFAULT_DELAY_MS = 5_000;
const RECONCILE_DEFAULT_TOTAL_MS = 40_000;
const DELTA_EPSILON = 0.001;

/**
 * Post-generation aggregate observation: polls today's measured usage for
 * a delta over the pre-generation baseline that is positive and within the
 * reserved upper bound. Analytics lag is expected, so a zero delta keeps
 * polling; an over-bound delta ends the observation immediately (it can
 * never shrink back into bounds). Transport failures during polling are
 * read-only and never escape as generation errors; they simply leave the
 * aggregate unreconciled. Whether an unreconciled aggregate withholds the
 * image is the decision function's call (decideCloudflareUsageReconciliationV15):
 * the aggregate is secondary evidence behind the request's own usage
 * reports, so its absence or size alone no longer decides delivery.
 */
export async function reconcileCloudflareRasterUsageV15(
  auth: { accountId: string; apiToken: string },
  baselineUsedNeurons: number,
  maxDeltaNeurons: number,
  fetchImpl: typeof fetch = fetch,
  options: CloudflareUsageReconciliationOptionsV15 = {},
): Promise<CloudflareUsageReconciliationV15> {
  const attempts = Math.max(1, Math.min(10, options.attempts ?? RECONCILE_DEFAULT_ATTEMPTS));
  const delayMs = Math.max(0, Math.min(10_000, options.delayMs ?? RECONCILE_DEFAULT_DELAY_MS));
  const totalMs = Math.max(1_000, Math.min(55_000, options.totalMs ?? RECONCILE_DEFAULT_TOTAL_MS));
  const deadline = Date.now() + totalMs;
  let requests = 0;
  let lastUsed: number | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0 && delayMs > 0) {
      const remainingBeforeDelay = deadline - Date.now();
      if (remainingBeforeDelay <= delayMs) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (deadline - Date.now() <= 0) break;
    let snapshot: CloudflareDailyUsageV15;
    try {
      snapshot = await fetchCloudflareDailyNeuronsUsedV15(auth, fetchImpl);
    } catch {
      requests += 1;
      continue;
    }
    requests += 1;
    lastUsed = snapshot.usedNeurons;
    const delta = snapshot.usedNeurons - baselineUsedNeurons;
    if (delta > maxDeltaNeurons + DELTA_EPSILON) {
      return { reconciled: false, observedDeltaNeurons: delta, finalUsedNeurons: snapshot.usedNeurons, requests };
    }
    if (delta > DELTA_EPSILON) {
      return { reconciled: true, observedDeltaNeurons: delta, finalUsedNeurons: snapshot.usedNeurons, requests };
    }
  }

  return {
    reconciled: false,
    observedDeltaNeurons: lastUsed === null ? null : lastUsed - baselineUsedNeurons,
    finalUsedNeurons: lastUsed,
    requests,
  };
}

export type CloudflareUsageReconciliationMethodV15 = 'aggregate-delta' | 'per-request-reported';

export type CloudflareUsageReconciliationDecisionV15 = {
  deliver: boolean;
  method: CloudflareUsageReconciliationMethodV15 | null;
  /** Sum of the per-request usage reports, or null when any call did not report a usable number. */
  totalReportedNeurons: number | null;
  reason:
    | 'aggregate-reconciled'
    | 'per-request-reported-within-reserve'
    | 'aggregate-unobserved'
    | 'aggregate-over-reserve'
    | 'aggregate-moved-backwards'
    | 'aggregate-inconsistent'
    | 'per-request-usage-incomplete'
    | 'per-request-usage-implausible'
    | 'per-request-usage-over-reserve';
};

/**
 * Delivery decision after the reconciliation polling window closes.
 *
 * Evidence priority (swapped on 2026-11-07 after the first production
 * quality batch): the request's OWN usage reports are the primary
 * evidence; the account-level aggregate delta is secondary.
 *
 * Why the swap: the aggregate is account-wide and lags by minutes, so
 * under sustained use the delta that lands inside one request's polling
 * window is usually the accumulated backlog of several earlier requests.
 * Judging that delta against a single request's reserved bound treats
 * unattributable consumption as this request's overage: in the batch,
 * single generations succeeded while the second half (B-02 onward) all
 * failed CLOUDFLARE_USAGE_RECONCILIATION_FAILED at 6/12. The aggregate
 * delta cannot attribute consumption to a request, so it can neither
 * prove nor veto one. What CAN attribute consumption is the usage every
 * inference call reported for itself (generation via the cf-ai-neurons
 * response header, the semantic critic via its run-response usage block).
 *
 *   - Primary: every inference call this request made (all generations
 *     and all semantic-critic calls, across candidates and the retry)
 *     reported its own Neurons, the reported total is positive (an
 *     all-zero report is not evidence of attribution), and the total fits
 *     the same reserved bound the pre-check enforced → deliver as
 *     'per-request-reported'. The aggregate's state — not yet landed,
 *     landed over-bound with backlog, moved backwards, never observed —
 *     does not block this: none of it is this request's consumption.
 *   - Secondary: only when the primary evidence is incomplete (a call
 *     reported nothing) or itself out of bounds may the aggregate carry
 *     the delivery, exactly as before: a measured delta that is positive
 *     and within the reserved bound delivers as 'aggregate-delta'.
 *   - Otherwise the image is withheld. The failure reason names the
 *     primary evidence's failure mode ('per-request-usage-incomplete',
 *     '-implausible', '-over-reserve'); the observed aggregate values
 *     travel with the failure usage snapshot for diagnosis. The former
 *     'aggregate-*' failure reasons are retained in the type for shape
 *     compatibility but are no longer produced: under this priority an
 *     aggregate state is never the operative blocker on its own.
 *
 * The $0.00 guarantee never rests on this decision alone: it rests on the
 * Workers Free plan proof, the pre-generation quota check with its
 * up-front reserve, and the plan's structural absence of overage billing.
 * The decision only decides whether already-generated, already-reserved
 * consumption may be delivered on the evidence that can attribute it.
 */
export function decideCloudflareUsageReconciliationV15(
  reconciliation: CloudflareUsageReconciliationV15,
  maxDeltaNeurons: number,
  reportedCallsNeurons: readonly (number | null)[],
): CloudflareUsageReconciliationDecisionV15 {
  const allReported = reportedCallsNeurons.length > 0
    && reportedCallsNeurons.every(
      (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0,
    );
  const totalReportedNeurons = allReported
    ? Math.round(reportedCallsNeurons.reduce((sum, value) => sum + (value as number), 0) * 1000) / 1000
    : null;

  // Primary evidence: the request's own complete, in-bounds usage reports.
  // The aggregate delta — whatever its size or absence — is account-level
  // backlog-inclusive data and cannot veto attribution this direct.
  if (allReported && totalReportedNeurons !== null
    && totalReportedNeurons > DELTA_EPSILON
    && totalReportedNeurons <= maxDeltaNeurons + DELTA_EPSILON) {
    return {
      deliver: true,
      method: 'per-request-reported',
      totalReportedNeurons,
      reason: 'per-request-reported-within-reserve',
    };
  }

  // Secondary evidence: the aggregate delta, only when the request's own
  // reports could not carry the delivery.
  if (
    reconciliation.reconciled
    && reconciliation.observedDeltaNeurons !== null
    && reconciliation.finalUsedNeurons !== null
  ) {
    return { deliver: true, method: 'aggregate-delta', totalReportedNeurons, reason: 'aggregate-reconciled' };
  }

  // Fail closed. The reason names why the primary evidence failed; the
  // aggregate observation (or its absence) is recorded on the failure
  // usage snapshot by the caller.
  if (!allReported || totalReportedNeurons === null) {
    return { deliver: false, method: null, totalReportedNeurons: null, reason: 'per-request-usage-incomplete' };
  }
  if (totalReportedNeurons <= DELTA_EPSILON) {
    return { deliver: false, method: null, totalReportedNeurons, reason: 'per-request-usage-implausible' };
  }
  return { deliver: false, method: null, totalReportedNeurons, reason: 'per-request-usage-over-reserve' };
}
