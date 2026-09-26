import { createHash } from 'node:crypto';

const POLLINATIONS_ORIGIN = 'https://gen.pollinations.ai';
const DEFAULT_MODEL = 'tomdacatto/sana';
const AUDITED_ZERO_COST_MODELS = new Set(['tomdacatto/sana']);
const MAX_PROMPT_CHARS = 2_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_RESPONSE_BYTES = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 64 * 1024;
const IMAGE_GENERATION_TIMEOUT_MS = 45_000;
const MODEL_DISCOVERY_TIMEOUT_MS = 10_000;
const USAGE_VERIFY_ATTEMPTS = 7;
const USAGE_VERIFY_DELAY_MS = 7_000;
const USAGE_VERIFY_TOTAL_MS = 50_000;
const USAGE_VERIFY_REQUEST_TIMEOUT_MS = 4_000;

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
  const priceEntries = Object.entries(record).filter(([key]) => key !== 'currency');
  return priceEntries.every(([, item]) => typeof item === 'number' && Number.isFinite(item) && item === 0);
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

function detectImageMime(bytes: Buffer): RasterImageResultV15['mimeType'] | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function readRasterDimensionsV15(bytes: Buffer, mimeType: RasterImageResultV15['mimeType']): RasterImageSizeV15 | null {
  if (mimeType === 'image/png') {
    if (bytes.length < 24) return null;
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (mimeType === 'image/jpeg') {
    let offset = 2;
    const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 1 >= bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (sofMarkers.has(marker) && length >= 7) {
        const height = bytes.readUInt16BE(offset + 3);
        const width = bytes.readUInt16BE(offset + 5);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      offset += length;
    }
    return null;
  }

  if (mimeType === 'image/webp') {
    if (bytes.length < 30 || bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') return null;
    const chunk = bytes.subarray(12, 16).toString('ascii');
    if (chunk === 'VP8X' && bytes.length >= 30) {
      const width = 1 + bytes.readUIntLE(24, 3);
      const height = 1 + bytes.readUIntLE(27, 3);
      return { width, height };
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const b1 = bytes[21], b2 = bytes[22], b3 = bytes[23], b4 = bytes[24];
      const width = 1 + (((b2 & 0x3f) << 8) | b1);
      const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
      return { width, height };
    }
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      const width = bytes.readUInt16LE(26) & 0x3fff;
      const height = bytes.readUInt16LE(28) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
  }
  return null;
}

function decodeImageResponseBody(body: Buffer): { bytes: Buffer; mimeType: RasterImageResultV15['mimeType'] } {
  if (body.length <= 0 || body.length > MAX_IMAGE_RESPONSE_BYTES) throw new Error('RASTER_RESPONSE_SIZE_OUT_OF_BOUNDS');
  let parsed: unknown;
  try { parsed = JSON.parse(body.toString('utf8')); }
  catch { throw new Error('INVALID_RASTER_PROVIDER_JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_RASTER_PROVIDER_JSON');
  const data = (parsed as Record<string, unknown>).data;
  if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== 'object' || Array.isArray(data[0])) {
    throw new Error('INVALID_RASTER_PROVIDER_PAYLOAD');
  }
  const row = data[0] as Record<string, unknown>;
  const encoded = typeof row.b64_json === 'string' ? row.b64_json : '';
  if (!encoded || encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('INVALID_RASTER_BASE64');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length <= 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error('RASTER_IMAGE_SIZE_OUT_OF_BOUNDS');
  const detectedMime = detectImageMime(bytes);
  if (!detectedMime) throw new Error('RASTER_IMAGE_SIGNATURE_MISMATCH');
  if (typeof row.media_type === 'string' && row.media_type && row.media_type !== detectedMime) {
    throw new Error('RASTER_IMAGE_MIME_MISMATCH');
  }
  return { bytes, mimeType: detectedMime };
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

type PollinationsUsageRowV15 = Record<string, unknown>;

async function fetchKeyUsageRowsV15(
  apiKey: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<PollinationsUsageRowV15[] | null> {
  const response = await timedFetch(
    `${POLLINATIONS_ORIGIN}/account/key/usage?format=json&limit=10&days=1`,
    { method: 'GET', headers: authHeaders(apiKey), cache: 'no-store' },
    fetchImpl,
    timeoutMs,
  );
  if (!response.ok) return null;
  const parsed = await response.json() as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const usage = (parsed as Record<string, unknown>).usage;
  if (!Array.isArray(usage)) return null;
  return usage.filter((entry): entry is PollinationsUsageRowV15 =>
    Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry));
}

function usageEventId(row: PollinationsUsageRowV15): string | null {
  return typeof row.cursor_event_id === 'string' && row.cursor_event_id.trim()
    ? row.cursor_event_id.trim()
    : null;
}

async function captureUsageBaselineV15(
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<Set<string> | null> {
  const rows = await fetchKeyUsageRowsV15(apiKey, fetchImpl, USAGE_VERIFY_REQUEST_TIMEOUT_MS);
  if (!rows) return null;
  const ids = rows.map(usageEventId);
  if (ids.some((id) => id === null)) return null;
  return new Set(ids as string[]);
}

type UsageVerificationOptionsV15 = {
  attempts?: number;
  delayMs?: number;
  totalMs?: number;
};

async function verifyLatestZeroCostUsageV15(
  apiKey: string,
  model: string,
  baselineEventIds: ReadonlySet<string>,
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
    const rows = await fetchKeyUsageRowsV15(
      apiKey,
      fetchImpl,
      Math.min(USAGE_VERIFY_REQUEST_TIMEOUT_MS, remaining),
    );
    requests += 1;
    if (!rows) continue;
    const matching = rows.filter((row) => {
      const eventId = usageEventId(row);
      return eventId !== null
        && !baselineEventIds.has(eventId)
        && row.model === model
        && row.type === 'generate.image';
    });
    if (matching.length === 0) continue;
    return {
      verified: matching.every((row) =>
        Number(row.cost_usd) === 0
        && row.meter_source === 'tier'
        && Number(row.output_image_tokens) >= 1),
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

  const baselineEventIds = await captureUsageBaselineV15(apiKey, fetchImpl);
  if (!baselineEventIds) throw new Error('USAGE_BASELINE_UNAVAILABLE');

  const size: RasterImageSizeV15 = {
    width: boundedInt(input.width, 1024),
    height: boundedInt(input.height, 1024),
  };
  const response = await timedFetch(
    `${POLLINATIONS_ORIGIN}/v1/images/generations`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(apiKey),
        'Content-Type': 'application/json',
        'Pollinations-Safe': 'privacy,secrets,sexual,violence,shield',
      },
      body: JSON.stringify({
        prompt,
        model: verifiedModel,
        n: 1,
        size: `${size.width}x${size.height}`,
        quality: 'medium',
        response_format: 'b64_json',
        safe: 'privacy,secrets,sexual,violence,shield',
      }),
      cache: 'no-store',
    },
    fetchImpl,
  );
  if (!response.ok) {
    if (response.status === 402) throw new Error('PAID_OR_EXHAUSTED_PROVIDER_PATH_BLOCKED');
    if (response.status === 400) throw new Error('RASTER_PROVIDER_SAFETY_OR_REQUEST_BLOCKED');
    throw new Error(`RASTER_PROVIDER_HTTP_${response.status}`);
  }

  const responseType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (responseType !== 'application/json') throw new Error('UNEXPECTED_RASTER_CONTENT_TYPE');
  const decoded = decodeImageResponseBody(Buffer.from(await response.arrayBuffer()));
  const { bytes, mimeType: mime } = decoded;
  const actualSize = readRasterDimensionsV15(bytes, mime);
  if (!actualSize || actualSize.width !== size.width || actualSize.height !== size.height) {
    throw new Error('RASTER_IMAGE_DIMENSION_MISMATCH');
  }
  const usageVerificationResult = await verifyLatestZeroCostUsageV15(
    apiKey,
    verifiedModel,
    baselineEventIds,
    fetchImpl,
    usageVerification,
  );
  if (!usageVerificationResult.verified) throw new Error('ZERO_COST_USAGE_NOT_VERIFIED');

  return {
    bytes,
    mimeType: mime,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    model: verifiedModel,
    providerId: 'pollinations-zero-cost',
    width: actualSize.width,
    height: actualSize.height,
    costUsd: 0,
    freeOnly: true,
    externalNetworkRequests: 3 + usageVerificationResult.requests,
  };
}
