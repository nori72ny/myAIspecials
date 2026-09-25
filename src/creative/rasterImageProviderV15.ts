import { createHash } from 'node:crypto';

const POLLINATIONS_ORIGIN = 'https://gen.pollinations.ai';
const DEFAULT_MODEL = 'tomdacatto/sana';
const AUDITED_ZERO_COST_MODELS = new Set(['tomdacatto/sana']);
const MAX_PROMPT_CHARS = 2_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const IMAGE_GENERATION_TIMEOUT_MS = 45_000;
const MODEL_DISCOVERY_TIMEOUT_MS = 10_000;
const USAGE_VERIFY_ATTEMPTS = 7;
const USAGE_VERIFY_DELAY_MS = 7_000;
const USAGE_VERIFY_TOTAL_MS = 50_000;
const USAGE_VERIFY_REQUEST_TIMEOUT_MS = 4_000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export type RasterImageSizeV15 = {
  width: number;
  height: number;
};

export type RasterImageRequestV15 = {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  model?: string;
};

export type RasterProviderStatusV15 = {
  configured: boolean;
  ready: boolean;
  providerId: 'pollinations-zero-cost';
  model: string | null;
  zeroCostVerified: boolean;
  paidFallbackEnabled: false;
  paymentMethodRequired: false;
  secretDelivery: 'server-only';
  externalNetwork: true;
  reason: string | null;
};

export type RasterImageResultV15 = {
  bytes: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  sha256: string;
  model: string;
  providerId: 'pollinations-zero-cost';
  width: number;
  height: number;
  costUsd: 0;
  freeOnly: true;
  externalNetworkRequests: number;
};

type PollinationsImageModel = {
  name?: unknown;
  category?: unknown;
  pricing?: unknown;
  pricing_variants?: unknown;
  paid_only?: unknown;
  input_modalities?: unknown;
  output_modalities?: unknown;
};

function boundedInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.max(256, Math.min(1536, value));
}

function isZeroCostPricing(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.currency !== 'pollen') return false;
  const numeric = Object.entries(record)
    .filter(([key]) => key !== 'currency')
    .map(([, item]) => item)
    .filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
  return numeric.every((item) => item === 0);
}

function modelIsVerifiedZeroCost(model: PollinationsImageModel): boolean {
  if (model.category !== 'image' || model.paid_only === true) return false;
  if (!isZeroCostPricing(model.pricing)) return false;
  if (Array.isArray(model.pricing_variants) && model.pricing_variants.some((variant) => {
    if (!variant || typeof variant !== 'object') return true;
    return !isZeroCostPricing((variant as Record<string, unknown>).pricing);
  })) return false;
  const outputs = Array.isArray(model.output_modalities) ? model.output_modalities : [];
  return outputs.includes('image');
}

function modelName(model: PollinationsImageModel): string | null {
  return typeof model.name === 'string' && model.name.trim() ? model.name.trim() : null;
}

function imageBytesMatchMime(bytes: Buffer, mime: string): boolean {
  if (mime === 'image/png') {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mime === 'image/jpeg') {
    return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  }
  if (mime === 'image/webp') {
    return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function normalizePrompt(input: RasterImageRequestV15): string {
  const prompt = input.prompt.normalize('NFKC').trim();
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) throw new Error('INVALID_RASTER_PROMPT');
  const negative = input.negativePrompt?.normalize('NFKC').trim();
  return negative ? `${prompt}\n\nAvoid: ${negative.slice(0, 1_000)}` : prompt;
}

async function timedFetch(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs = IMAGE_GENERATION_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal, redirect: 'error' });
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    'User-Agent': 'ORIGIN-Personal/1.5',
    Accept: 'application/json',
  };
}

export async function discoverZeroCostPollinationsModelV15(
  apiKey: string,
  preferredModel = DEFAULT_MODEL,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!apiKey.trim()) return null;
  const response = await timedFetch(
    `${POLLINATIONS_ORIGIN}/image/models`,
    { method: 'GET', headers: authHeaders(apiKey), cache: 'no-store' },
    fetchImpl,
    MODEL_DISCOVERY_TIMEOUT_MS,
  );
  if (!response.ok) return null;
  const parsed = await response.json() as unknown;
  if (!Array.isArray(parsed)) return null;
  const zeroCostModels = parsed
    .filter((item): item is PollinationsImageModel => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .filter(modelIsVerifiedZeroCost)
    .map(modelName)
    .filter((name): name is string => Boolean(name) && AUDITED_ZERO_COST_MODELS.has(name));
  return zeroCostModels.includes(preferredModel) ? preferredModel : null;
}

export async function getRasterProviderStatusV15(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<RasterProviderStatusV15> {
  const apiKey = env.POLLINATIONS_API_KEY?.trim() ?? '';
  if (!apiKey) {
    return {
      configured: false,
      ready: false,
      providerId: 'pollinations-zero-cost',
      model: null,
      zeroCostVerified: false,
      paidFallbackEnabled: false,
      paymentMethodRequired: false,
      secretDelivery: 'server-only',
      externalNetwork: true,
      reason: 'POLLINATIONS_KEY_NOT_CONFIGURED',
    };
  }

  try {
    const model = await discoverZeroCostPollinationsModelV15(apiKey, env.ORIGIN_IMAGE_MODEL || DEFAULT_MODEL, fetchImpl);
    return {
      configured: true,
      ready: Boolean(model),
      providerId: 'pollinations-zero-cost',
      model,
      zeroCostVerified: Boolean(model),
      paidFallbackEnabled: false,
      paymentMethodRequired: false,
      secretDelivery: 'server-only',
      externalNetwork: true,
      reason: model ? null : 'NO_VERIFIED_ZERO_COST_RASTER_MODEL',
    };
  } catch {
    return {
      configured: true,
      ready: false,
      providerId: 'pollinations-zero-cost',
      model: null,
      zeroCostVerified: false,
      paidFallbackEnabled: false,
      paymentMethodRequired: false,
      secretDelivery: 'server-only',
      externalNetwork: true,
      reason: 'PROVIDER_DISCOVERY_FAILED',
    };
  }
}

type UsageVerificationOptionsV15 = {
  attempts?: number;
  delayMs?: number;
  totalMs?: number;
};

async function verifyLatestZeroCostUsageV15(
  apiKey: string,
  model: string,
  startedAtMs: number,
  fetchImpl: typeof fetch,
  options: UsageVerificationOptionsV15 = {},
): Promise<{ verified: boolean; requests: number }> {
  const attempts = Math.max(1, Math.min(10, options.attempts ?? USAGE_VERIFY_ATTEMPTS));
  const delayMs = Math.max(0, Math.min(10_000, options.delayMs ?? USAGE_VERIFY_DELAY_MS));
  const totalMs = Math.max(1_000, Math.min(55_000, options.totalMs ?? USAGE_VERIFY_TOTAL_MS));
  const deadline = Date.now() + totalMs;
  let requests = 0;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0 && delayMs > 0) {
      const remainingBeforeDelay = deadline - Date.now();
      if (remainingBeforeDelay <= delayMs) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const response = await timedFetch(
      `${POLLINATIONS_ORIGIN}/account/key/usage?format=json&limit=10&days=1`,
      { method: 'GET', headers: authHeaders(apiKey), cache: 'no-store' },
      fetchImpl,
      Math.min(USAGE_VERIFY_REQUEST_TIMEOUT_MS, remaining),
    );
    requests += 1;
    if (!response.ok) continue;
    const parsed = await response.json() as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const usage = (parsed as Record<string, unknown>).usage;
    if (!Array.isArray(usage)) continue;
    const floorMs = startedAtMs - 15_000;
    const matching = usage.filter((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
      const row = entry as Record<string, unknown>;
      const timestamp = typeof row.timestamp === 'string' ? Date.parse(row.timestamp.replace(' ', 'T') + 'Z') : Number.NaN;
      return row.model === model
        && row.type === 'generate.image'
        && Number.isFinite(timestamp)
        && timestamp >= floorMs;
    }) as Array<Record<string, unknown>>;
    if (matching.length === 0) continue;
    return {
      verified: matching.every((row) => Number(row.cost_usd) === 0 && row.meter_source === 'tier'),
      requests,
    };
  }

  return { verified: false, requests };
}

export async function generateRasterImageV15(
  input: RasterImageRequestV15,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  usageVerification: UsageVerificationOptionsV15 = {},
): Promise<RasterImageResultV15> {
  const apiKey = env.POLLINATIONS_API_KEY?.trim() ?? '';
  if (!apiKey) throw new Error('POLLINATIONS_KEY_NOT_CONFIGURED');

  const prompt = normalizePrompt(input);
  const requestedModel = input.model?.trim() || env.ORIGIN_IMAGE_MODEL || DEFAULT_MODEL;
  const verifiedModel = await discoverZeroCostPollinationsModelV15(apiKey, requestedModel, fetchImpl);
  if (!verifiedModel) throw new Error('NO_VERIFIED_ZERO_COST_RASTER_MODEL');
  if (requestedModel !== verifiedModel && input.model) throw new Error('REQUESTED_IMAGE_MODEL_NOT_ZERO_COST');

  const size: RasterImageSizeV15 = {
    width: boundedInt(input.width, 1024),
    height: boundedInt(input.height, 1024),
  };
  const url = new URL(`${POLLINATIONS_ORIGIN}/image/${encodeURIComponent(prompt)}`);
  url.searchParams.set('model', verifiedModel);
  url.searchParams.set('width', String(size.width));
  url.searchParams.set('height', String(size.height));
  url.searchParams.set('safe', 'true');

  const startedAtMs = Date.now();
  const response = await timedFetch(
    url.toString(),
    {
      method: 'GET',
      headers: {
        ...authHeaders(apiKey),
        Accept: 'image/png,image/jpeg,image/webp',
      },
      cache: 'no-store',
    },
    fetchImpl,
  );
  if (!response.ok) {
    if (response.status === 402) throw new Error('PAID_OR_EXHAUSTED_PROVIDER_PATH_BLOCKED');
    throw new Error(`RASTER_PROVIDER_HTTP_${response.status}`);
  }

  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.has(mime)) throw new Error('UNEXPECTED_RASTER_CONTENT_TYPE');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length <= 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error('RASTER_IMAGE_SIZE_OUT_OF_BOUNDS');
  if (!imageBytesMatchMime(bytes, mime)) throw new Error('RASTER_IMAGE_SIGNATURE_MISMATCH');
  const usageVerificationResult = await verifyLatestZeroCostUsageV15(
    apiKey,
    verifiedModel,
    startedAtMs,
    fetchImpl,
    usageVerification,
  );
  if (!usageVerificationResult.verified) throw new Error('ZERO_COST_USAGE_NOT_VERIFIED');

  return {
    bytes,
    mimeType: mime as RasterImageResultV15['mimeType'],
    sha256: createHash('sha256').update(bytes).digest('hex'),
    model: verifiedModel,
    providerId: 'pollinations-zero-cost',
    width: size.width,
    height: size.height,
    costUsd: 0,
    freeOnly: true,
    externalNetworkRequests: 2 + usageVerificationResult.requests,
  };
}
