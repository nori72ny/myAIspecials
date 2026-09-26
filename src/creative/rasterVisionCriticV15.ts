import { createHash } from 'node:crypto';
import { ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY } from '../legacy/zeroCostRoutingPolicy.js';

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
export const ORIGIN_RASTER_VISION_CRITIC_MODEL_V15 = 'inclusionai/ling-3.0-flash-vl:free' as const;
const CANONICAL_SERVED_MODEL = ORIGIN_RASTER_VISION_CRITIC_MODEL_V15.replace(/:free$/, '');
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_PROMPT_CHARS = 2_000;
const MODEL_CHECK_TIMEOUT_MS = 8_000;
const CRITIC_TIMEOUT_MS = 22_000;

export type RasterVisionCriticResultV15 = {
  version: 'raster-vision-critic-v1';
  model: typeof ORIGIN_RASTER_VISION_CRITIC_MODEL_V15;
  passed: boolean;
  score: number;
  dimensions: {
    promptAdherence: number;
    composition: number;
    realism: number;
    artifactControl: number;
    textAccuracy: number;
  };
  issues: readonly string[];
  repairInstructions: readonly string[];
  actualCostUsd: 0;
  fallbackUsed: false;
  imageSha256: string;
};

export type RasterVisionCriticStatusV15 = {
  configured: boolean;
  ready: boolean;
  model: typeof ORIGIN_RASTER_VISION_CRITIC_MODEL_V15;
  zeroCostVerified: boolean;
  imageInputExpected: true;
  paidFallbackEnabled: false;
  reason: string | null;
};

type FetchLike = typeof fetch;

function exactZero(value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  if (typeof value === 'string' && !value.trim()) return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric === 0;
}

function servedModelAllowed(value: unknown): boolean {
  return value === ORIGIN_RASTER_VISION_CRITIC_MODEL_V15 || value === CANONICAL_SERVED_MODEL;
}

async function timedFetch(url: string, init: RequestInit, fetchImpl: FetchLike, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal, redirect: 'error' });
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyRasterVisionCriticModelV15(
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  try {
    const response = await timedFetch(
      OPENROUTER_MODELS_URL,
      { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'ORIGIN-Personal-Visual-Critic/1.0' }, cache: 'no-store' },
      fetchImpl,
      MODEL_CHECK_TIMEOUT_MS,
    );
    if (!response.ok) return false;
    const payload = await response.json() as unknown;
    const data = payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: Array<Record<string, unknown>> }).data
      : null;
    if (!data) return false;
    const matches = data.filter((entry) => entry.id === ORIGIN_RASTER_VISION_CRITIC_MODEL_V15);
    if (matches.length !== 1) return false;
    const pricing = matches[0].pricing;
    if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) return false;
    const record = pricing as Record<string, unknown>;
    return exactZero(record.prompt) && exactZero(record.completion);
  } catch {
    return false;
  }
}

export async function rasterVisionCriticStatusV15(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<RasterVisionCriticStatusV15> {
  if (!env.OPENROUTER_API_KEY?.trim()) {
    return {
      configured: false,
      ready: false,
      model: ORIGIN_RASTER_VISION_CRITIC_MODEL_V15,
      zeroCostVerified: false,
      imageInputExpected: true,
      paidFallbackEnabled: false,
      reason: 'VISION_CRITIC_KEY_NOT_CONFIGURED',
    };
  }
  const verified = await verifyRasterVisionCriticModelV15(fetchImpl);
  return {
    configured: true,
    ready: verified,
    model: ORIGIN_RASTER_VISION_CRITIC_MODEL_V15,
    zeroCostVerified: verified,
    imageInputExpected: true,
    paidFallbackEnabled: false,
    reason: verified ? null : 'VISION_CRITIC_ZERO_COST_NOT_VERIFIED',
  };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i)?.[1];
  if (fenced) candidates.push(fenced.trim());
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* try next bounded candidate */ }
  }
  return null;
}

function boundedScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? Math.round(value)
    : null;
}

function boundedStrings(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const normalized = item.normalize('NFKC').trim();
    if (!normalized || normalized.length > maxLength) return null;
    out.push(normalized);
  }
  return out;
}

function validateCriticPayload(
  payload: Record<string, unknown>,
  imageSha256: string,
): RasterVisionCriticResultV15 | null {
  const dimensionsSource = payload.dimensions;
  if (!dimensionsSource || typeof dimensionsSource !== 'object' || Array.isArray(dimensionsSource)) return null;
  const dimensionsRecord = dimensionsSource as Record<string, unknown>;
  const promptAdherence = boundedScore(dimensionsRecord.promptAdherence);
  const composition = boundedScore(dimensionsRecord.composition);
  const realism = boundedScore(dimensionsRecord.realism);
  const artifactControl = boundedScore(dimensionsRecord.artifactControl);
  const textAccuracy = boundedScore(dimensionsRecord.textAccuracy);
  if ([promptAdherence, composition, realism, artifactControl, textAccuracy].some((score) => score === null)) return null;
  const issues = boundedStrings(payload.issues, 6, 240);
  const repairs = boundedStrings(payload.repairInstructions, 4, 300);
  if (!issues || !repairs) return null;
  const score = Math.round(
    promptAdherence! * 0.30
    + composition! * 0.20
    + realism! * 0.15
    + artifactControl! * 0.20
    + textAccuracy! * 0.15,
  );
  const passed = score >= 82 && promptAdherence! >= 78 && artifactControl! >= 78;
  return {
    version: 'raster-vision-critic-v1',
    model: ORIGIN_RASTER_VISION_CRITIC_MODEL_V15,
    passed,
    score,
    dimensions: {
      promptAdherence: promptAdherence!,
      composition: composition!,
      realism: realism!,
      artifactControl: artifactControl!,
      textAccuracy: textAccuracy!,
    },
    issues,
    repairInstructions: repairs,
    actualCostUsd: 0,
    fallbackUsed: false,
    imageSha256,
  };
}

function extractAssistantText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value
    .flatMap((part) => part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
      ? [(part as { text: string }).text.trim()]
      : [])
    .filter(Boolean)
    .join('\n')
    .trim();
}

export async function critiqueRasterWithVisionV15(
  input: {
    bytes: Buffer;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    prompt: string;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<RasterVisionCriticResultV15> {
  const key = env.OPENROUTER_API_KEY?.trim() ?? '';
  if (!key) throw new Error('VISION_CRITIC_KEY_NOT_CONFIGURED');
  if (input.bytes.length <= 0 || input.bytes.length > MAX_IMAGE_BYTES) throw new Error('VISION_CRITIC_IMAGE_SIZE_INVALID');
  const prompt = input.prompt.normalize('NFKC').trim();
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) throw new Error('VISION_CRITIC_PROMPT_INVALID');
  if (!(await verifyRasterVisionCriticModelV15(fetchImpl))) throw new Error('VISION_CRITIC_ZERO_COST_NOT_VERIFIED');

  const imageSha256 = createHash('sha256').update(input.bytes).digest('hex');
  const instruction = [
    'You are ORIGIN Visual Critic. Evaluate only the supplied generated image against the user request.',
    'Return one JSON object and no prose.',
    'Required schema:',
    '{"dimensions":{"promptAdherence":0,"composition":0,"realism":0,"artifactControl":0,"textAccuracy":0},"issues":[],"repairInstructions":[]}',
    'Every score must be an integer from 0 to 100.',
    'artifactControl penalizes malformed anatomy, duplicated objects, broken geometry, incoherent lighting, obvious generation artifacts, and accidental text.',
    'textAccuracy evaluates requested visible words/numbers; if the request contains no required visible text, score natural absence of accidental/gibberish text.',
    'issues: at most 6 concise concrete defects. repairInstructions: at most 4 precise visual corrections.',
    'Do not infer hidden context, identity, brand rules, or facts not present in the request/image.',
  ].join('\n');

  const response = await timedFetch(
    OPENROUTER_CHAT_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': 'https://origin-personal.vercel.app/',
        'X-OpenRouter-Title': 'ORIGIN Personal Visual Critic',
      },
      cache: 'no-store',
      body: JSON.stringify({
        model: ORIGIN_RASTER_VISION_CRITIC_MODEL_V15,
        messages: [
          { role: 'system', content: instruction },
          {
            role: 'user',
            content: [
              { type: 'text', text: `User request:\n${prompt}` },
              { type: 'image_url', image_url: { url: `data:${input.mimeType};base64,${input.bytes.toString('base64')}`, detail: 'high' } },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 700,
        stream: false,
        usage: { include: true },
        provider: ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY,
      }),
    },
    fetchImpl,
    CRITIC_TIMEOUT_MS,
  );
  if (!response.ok) {
    if (response.status === 402) throw new Error('VISION_CRITIC_PAID_PATH_BLOCKED');
    if (response.status === 429) throw new Error('VISION_CRITIC_RATE_LIMITED');
    throw new Error(`VISION_CRITIC_HTTP_${response.status}`);
  }
  const data = await response.json() as {
    model?: unknown;
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: { cost?: unknown; cost_details?: { upstream_inference_cost?: unknown }; is_byok?: unknown };
    pricing?: { prompt?: unknown; completion?: unknown };
    billing_tier?: unknown;
    is_free?: unknown;
  };
  if (!servedModelAllowed(data.model)) throw new Error('VISION_CRITIC_MODEL_MISMATCH');
  if (!exactZero(data.usage?.cost)) throw new Error('VISION_CRITIC_COST_UNVERIFIED');
  if (data.usage?.cost_details?.upstream_inference_cost !== undefined && !exactZero(data.usage.cost_details.upstream_inference_cost)) {
    throw new Error('VISION_CRITIC_UPSTREAM_COST_NONZERO');
  }
  if (data.usage?.is_byok === true) throw new Error('VISION_CRITIC_BYOK_BLOCKED');
  if (data.billing_tier !== undefined && String(data.billing_tier).toLowerCase() !== 'free') throw new Error('VISION_CRITIC_TIER_NOT_FREE');
  if (data.is_free === false) throw new Error('VISION_CRITIC_NOT_FREE');
  if (data.pricing?.prompt !== undefined && !exactZero(data.pricing.prompt)) throw new Error('VISION_CRITIC_PRICE_NONZERO');
  if (data.pricing?.completion !== undefined && !exactZero(data.pricing.completion)) throw new Error('VISION_CRITIC_PRICE_NONZERO');

  const raw = extractAssistantText(data.choices?.[0]?.message?.content);
  const parsed = raw ? parseJsonObject(raw) : null;
  const result = parsed ? validateCriticPayload(parsed, imageSha256) : null;
  if (!result) throw new Error('VISION_CRITIC_INVALID_RESPONSE');
  return result;
}
