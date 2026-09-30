import { createHash } from 'node:crypto';
import type {
  RasterImageRequestV15,
  RasterImageResultV15,
  RasterProviderStatusV15,
} from './rasterImageProviderV15.js';
import { classifyCloudflareWorkersAiFailureV15 } from './cloudflareWorkersAiErrorV15.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 45_000;
const MODEL_SCHEMA_TIMEOUT_MS = 10_000;
const MAX_REFERENCE_IMAGES = 4;
const MAX_REFERENCE_IMAGE_BYTES = 768 * 1024;
const MAX_REFERENCE_DIMENSION_EXCLUSIVE = 512;

type CloudflareEnvelope = {
  success?: unknown;
  result?: unknown;
  errors?: unknown;
};

type Subscription = {
  state?: unknown;
  rate_plan?: unknown;
};

function credentials(env: NodeJS.ProcessEnv) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '';
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim() ?? '';
  if (!/^[a-f0-9]{32}$/i.test(accountId) || apiToken.length < 20 || apiToken.length > 4096) return null;
  return { accountId, apiToken };
}

async function timedFetch(url: string, init: RequestInit, fetchImpl: typeof fetch, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal, redirect: 'error', cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

function headers(token: string, jsonBody = true): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    ...(jsonBody ? { 'Content-Type': 'application/json' } : {}),
    Accept: 'application/json, image/png, image/jpeg, image/webp',
    'User-Agent': 'ORIGIN-Personal/1.5',
  };
}

function activeSubscription(value: Subscription): boolean {
  return ['Trial', 'Provisioned', 'Paid', 'AwaitingPayment'].includes(String(value.state ?? ''));
}

function workerPlanText(value: Subscription): string {
  const plan = value.rate_plan && typeof value.rate_plan === 'object' && !Array.isArray(value.rate_plan)
    ? value.rate_plan as Record<string, unknown>
    : {};
  return [plan.id, plan.public_name, plan.name, plan.scope, ...(Array.isArray(plan.sets) ? plan.sets : [])]
    .filter(item => typeof item === 'string')
    .join(' ')
    .toLowerCase();
}

async function verifyWorkersFreePlan(
  accountId: string,
  apiToken: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; requests: number; reason: string | null }> {
  const settings = await timedFetch(
    `${API_ORIGIN}/client/v4/accounts/${accountId}/workers/account-settings`,
    { method: 'GET', headers: headers(apiToken) },
    fetchImpl,
    10_000,
  );
  if (!settings.ok) return { ok: false, requests: 1, reason: 'CLOUDFLARE_WORKERS_PLAN_UNVERIFIED' };
  const settingsBody = await settings.json().catch(() => null) as CloudflareEnvelope | null;
  const settingsResult = settingsBody?.result && typeof settingsBody.result === 'object' && !Array.isArray(settingsBody.result)
    ? settingsBody.result as Record<string, unknown>
    : null;
  const usageModel = typeof settingsResult?.default_usage_model === 'string'
    ? settingsResult.default_usage_model.toLowerCase()
    : '';
  if (usageModel === 'standard' || usageModel === 'unbound') {
    return { ok: false, requests: 1, reason: 'CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED' };
  }
  if (usageModel && usageModel !== 'bundled') {
    return { ok: false, requests: 1, reason: 'CLOUDFLARE_WORKERS_PLAN_UNVERIFIED' };
  }

  const subscriptions = await timedFetch(
    `${API_ORIGIN}/client/v4/accounts/${accountId}/subscriptions`,
    { method: 'GET', headers: headers(apiToken) },
    fetchImpl,
    10_000,
  );
  if (!subscriptions.ok) return { ok: false, requests: 2, reason: 'CLOUDFLARE_BILLING_READ_REQUIRED' };
  const subscriptionsBody = await subscriptions.json().catch(() => null) as CloudflareEnvelope | null;
  const rows = Array.isArray(subscriptionsBody?.result) ? subscriptionsBody!.result as Subscription[] : null;
  if (!rows) return { ok: false, requests: 2, reason: 'CLOUDFLARE_WORKERS_PLAN_UNVERIFIED' };

  for (const row of rows) {
    if (!row || typeof row !== 'object' || !activeSubscription(row)) continue;
    const text = workerPlanText(row);
    if (!text.includes('worker')) continue;
    if (!text.includes('free')) {
      return { ok: false, requests: 2, reason: 'CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED' };
    }
  }

  const schema = await timedFetch(
    `${API_ORIGIN}/client/v4/accounts/${accountId}/ai/models/schema?model=${encodeURIComponent(MODEL)}`,
    { method: 'GET', headers: headers(apiToken) },
    fetchImpl,
    MODEL_SCHEMA_TIMEOUT_MS,
  );
  if (!schema.ok) {
    const failure = await classifyCloudflareWorkersAiFailureV15(schema);
    return {
      ok: false,
      requests: 3,
      reason: failure.code === 'CLOUDFLARE_MODEL_REQUIRES_PAID_PLAN'
        ? failure.code
        : ['CLOUDFLARE_WORKERS_AI_AUTH_REQUIRED', 'CLOUDFLARE_WORKERS_AI_ACCESS_DENIED'].includes(failure.code)
          ? 'CLOUDFLARE_WORKERS_AI_PERMISSION_REQUIRED'
          : 'CLOUDFLARE_WORKERS_AI_MODEL_UNVERIFIED',
    };
  }
  const schemaBody = await schema.json().catch(() => null) as CloudflareEnvelope | null;
  const schemaResult = schemaBody?.result && typeof schemaBody.result === 'object' && !Array.isArray(schemaBody.result)
    ? schemaBody.result as Record<string, unknown>
    : null;
  if (schemaBody?.success !== true || !schemaResult?.input || !schemaResult?.output) {
    return { ok: false, requests: 3, reason: 'CLOUDFLARE_WORKERS_AI_MODEL_UNVERIFIED' };
  }

  return { ok: true, requests: 3, reason: null };
}

function imageMime(bytes: Buffer): RasterImageResultV15['mimeType'] | null {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0,4).toString('ascii') === 'RIFF' && bytes.subarray(8,12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function dimensions(bytes: Buffer, mime: RasterImageResultV15['mimeType']): { width: number; height: number } | null {
  if (mime === 'image/png' && bytes.length >= 24) {
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (mime === 'image/jpeg') {
    const sofMarkers = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;
      const marker = bytes[offset++];
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
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
  if (mime === 'image/webp' && bytes.length >= 30) {
    const chunk = bytes.subarray(12, 16).toString('ascii');
    if (chunk === 'VP8X') {
      const width = 1 + bytes.readUIntLE(24, 3);
      const height = 1 + bytes.readUIntLE(27, 3);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      const width = bytes.readUInt16LE(26) & 0x3fff;
      const height = bytes.readUInt16LE(28) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const b1 = bytes[21], b2 = bytes[22], b3 = bytes[23], b4 = bytes[24];
      const width = 1 + b1 + ((b2 & 0x3f) << 8);
      const height = 1 + ((b2 >> 6) & 0x03) + (b3 << 2) + ((b4 & 0x0f) << 10);
      return width > 0 && height > 0 ? { width, height } : null;
    }
  }
  return null;
}

function decodeCloudflareResult(body: unknown): Buffer {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('CLOUDFLARE_IMAGE_PAYLOAD_INVALID');
  const envelope = body as CloudflareEnvelope;
  if (envelope.success !== true) throw new Error('CLOUDFLARE_IMAGE_REQUEST_FAILED');
  const result = envelope.result;
  const encoded = typeof result === 'string'
    ? result
    : result && typeof result === 'object' && !Array.isArray(result) && typeof (result as Record<string, unknown>).image === 'string'
      ? String((result as Record<string, unknown>).image)
      : '';
  if (!encoded || encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('CLOUDFLARE_IMAGE_PAYLOAD_INVALID');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('CLOUDFLARE_IMAGE_SIZE_OUT_OF_BOUNDS');
  return bytes;
}

export async function getCloudflareRasterStatusV15(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<RasterProviderStatusV15> {
  const auth = credentials(env);
  if (!auth) return {
    configured: false,
    ready: false,
    providerId: 'cloudflare-workers-ai-free',
    model: null,
    zeroCostVerified: false,
    paidFallbackEnabled: false,
    paymentMethodRequired: false,
    secretDelivery: 'server-only',
    externalNetwork: true,
    reason: 'CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED',
  };

  try {
    const proof = await verifyWorkersFreePlan(auth.accountId, auth.apiToken, fetchImpl);
    return {
      configured: true,
      ready: proof.ok,
      providerId: 'cloudflare-workers-ai-free',
      model: proof.ok ? MODEL : null,
      zeroCostVerified: proof.ok,
      paidFallbackEnabled: false,
      paymentMethodRequired: false,
      secretDelivery: 'server-only',
      externalNetwork: true,
      reason: proof.reason,
    };
  } catch {
    return {
      configured: true,
      ready: false,
      providerId: 'cloudflare-workers-ai-free',
      model: null,
      zeroCostVerified: false,
      paidFallbackEnabled: false,
      paymentMethodRequired: false,
      secretDelivery: 'server-only',
      externalNetwork: true,
      reason: 'CLOUDFLARE_WORKERS_PLAN_UNVERIFIED',
    };
  }
}

export async function generateCloudflareRasterImageV15(
  input: RasterImageRequestV15,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<RasterImageResultV15> {
  const auth = credentials(env);
  if (!auth) throw new Error('CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED');

  const width = typeof input.width === 'number' ? input.width : 1024;
  const height = typeof input.height === 'number' ? input.height : 1024;
  const prompt = input.prompt.normalize('NFKC').trim();
  if (!prompt || prompt.length > 2048) throw new Error('INVALID_RASTER_PROMPT');

  const references = input.referenceImages ?? [];
  if (references.length > MAX_REFERENCE_IMAGES) throw new Error('REFERENCE_IMAGE_COUNT_OUT_OF_BOUNDS');
  for (const reference of references) {
    if (!Buffer.isBuffer(reference.bytes) || reference.bytes.length < 64 || reference.bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
      throw new Error('REFERENCE_IMAGE_SIZE_OUT_OF_BOUNDS');
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(reference.mimeType)) {
      throw new Error('REFERENCE_IMAGE_TYPE_UNSUPPORTED');
    }
    const actual = dimensions(reference.bytes, reference.mimeType);
    if (!actual || actual.width !== reference.width || actual.height !== reference.height) {
      throw new Error('REFERENCE_IMAGE_SIGNATURE_MISMATCH');
    }
    if (actual.width >= MAX_REFERENCE_DIMENSION_EXCLUSIVE || actual.height >= MAX_REFERENCE_DIMENSION_EXCLUSIVE) {
      throw new Error('REFERENCE_IMAGE_DIMENSION_OUT_OF_BOUNDS');
    }
  }

  const proof = await verifyWorkersFreePlan(auth.accountId, auth.apiToken, fetchImpl);
  if (!proof.ok) throw new Error(proof.reason ?? 'CLOUDFLARE_WORKERS_PLAN_UNVERIFIED');

  const form = new FormData();
  const negative = input.negativePrompt?.normalize('NFKC').trim().slice(0, 1000) ?? '';
  const editInstruction = references.length
    ? [
        'Reference images are attached in index order starting at image 0.',
        'Treat them as authoritative visual context.',
        'Preserve subjects, identity cues, composition details, and other visual elements that the user did not ask to change.',
        'Apply only the requested transformation unless the prompt explicitly asks for a broader redesign.',
      ].join(' ')
    : '';
  const compiledPrompt = [
    editInstruction,
    prompt,
    negative ? `Avoid these visual elements when possible: ${negative}` : '',
  ].filter(Boolean).join('\n');
  form.append('prompt', compiledPrompt);
  form.append('width', String(width));
  form.append('height', String(height));
  references.forEach((reference, index) => {
    const extension = reference.mimeType === 'image/png' ? 'png' : reference.mimeType === 'image/webp' ? 'webp' : 'jpg';
    form.append(
      `input_image_${index}`,
      new Blob([Uint8Array.from(reference.bytes)], { type: reference.mimeType }),
      `reference-${index}.${extension}`,
    );
  });

  const response = await timedFetch(
    `${API_ORIGIN}/client/v4/accounts/${auth.accountId}/ai/run/${MODEL}`,
    {
      method: 'POST',
      headers: headers(auth.apiToken, false),
      body: form,
    },
    fetchImpl,
  );

  if (!response.ok) {
    const failure = await classifyCloudflareWorkersAiFailureV15(response, 'CLOUDFLARE_IMAGE_HTTP');
    throw new Error(failure.code);
  }

  let bytes: Buffer;
  const responseType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (responseType.startsWith('image/')) {
    const raw = Buffer.from(await response.arrayBuffer());
    if (!raw.length || raw.length > MAX_IMAGE_BYTES) throw new Error('CLOUDFLARE_IMAGE_SIZE_OUT_OF_BOUNDS');
    bytes = raw;
  } else {
    bytes = decodeCloudflareResult(await response.json());
  }

  const mimeType = imageMime(bytes);
  if (!mimeType) throw new Error('CLOUDFLARE_IMAGE_SIGNATURE_MISMATCH');
  const actual = dimensions(bytes, mimeType);
  if (!actual || actual.width !== width || actual.height !== height) throw new Error('RASTER_IMAGE_DIMENSION_MISMATCH');

  return {
    bytes,
    mimeType,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    model: MODEL,
    providerId: 'cloudflare-workers-ai-free',
    width: actual.width,
    height: actual.height,
    costUsd: 0,
    freeOnly: true,
    externalNetworkRequests: proof.requests + 1,
  };
}
