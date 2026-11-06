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
 *      measured account-level Neuron delta must be positive and no larger
 *      than the reserved upper bound, so the consumption is attributable to
 *      the free allocation that was reserved.
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
 * The critic caps output at 700 tokens (published rate 90,909 Neurons per 1M
 * output tokens ~= 64 Neurons) and its image+question input is bounded by the
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
        workersAiRequestsAdaptiveGroups(limit: 100, filter: { date: $date }) {
          sum { totalNeurons neurons requestCount }
        }
      }
    }
  }
`;

function neuronValue(sum: Record<string, unknown>): number {
  const total = sum.totalNeurons;
  const plain = sum.neurons;
  const hasTotal = typeof total === 'number' && Number.isFinite(total) && total >= 0;
  const hasPlain = typeof plain === 'number' && Number.isFinite(plain) && plain >= 0;
  if (hasTotal && hasPlain && total !== plain) throw new Error('CLOUDFLARE_DAILY_USAGE_UNVERIFIED');
  if (hasTotal) return total as number;
  if (hasPlain) return plain as number;
  throw new Error('CLOUDFLARE_DAILY_USAGE_UNVERIFIED');
}

/**
 * Reads today's (UTC) account-level Workers AI Neuron usage through the
 * Cloudflare GraphQL Analytics API. Any transport error, GraphQL error, or
 * shape ambiguity throws CLOUDFLARE_DAILY_USAGE_UNVERIFIED: unknown usage is
 * never treated as zero usage.
 *
 * Live-schema note: the exact adaptive-group dataset/field names must be
 * confirmed against a real account during live qualification; until then this
 * reader is exercised only against mocks and fails closed on any mismatch.
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
  const groups = Array.isArray(account?.workersAiRequestsAdaptiveGroups)
    ? account.workersAiRequestsAdaptiveGroups
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
    const count = (sum as Record<string, unknown>).requestCount;
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
 * Post-generation reconciliation: polls today's measured usage until the
 * delta over the pre-generation baseline is attributable to this request
 * (positive and within the reserved upper bound). Analytics lag is expected,
 * so a zero delta keeps polling; an over-bound delta can never shrink back
 * into bounds and fails immediately. Transport failures during polling are
 * read-only and never escape as generation errors; they simply leave the
 * request unreconciled, and the caller must withhold the image.
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
