import {
  ORIGIN_CLOUDFLARE_VOICE_MODEL,
  ORIGIN_CLOUDFLARE_VOICE_MODEL_NEURONS_PER_AUDIO_MINUTE,
  selectCurrentOriginCloudflareVoiceModel,
  type OriginCloudflareVoiceModelCatalogFailureCode,
  type OriginCloudflareVoiceModelEvidence,
} from '../lib/orchestration/OriginCloudflareVoiceModelCatalog.js';
import {
  CLOUDFLARE_FREE_DAILY_NEURONS_V15,
  fetchCloudflareDailyNeuronsUsedV15,
} from '../creative/cloudflareRasterFreeQuotaV15.js';
import { classifyCloudflareWorkersAiFailureV15 } from '../creative/cloudflareWorkersAiErrorV15.js';

/**
 * Voice transcription runtime (PR-V2, design: VOICE_INPUT_RECON_2026-11-12).
 *
 * Server endpoint core for POST /api/voice/transcribe. The flow is fail
 * closed at every stage, in this order:
 *
 *   1. Kill switch (env ORIGIN_VOICE_TRANSCRIBE_ENABLED, default OFF):
 *      while OFF the endpoint refuses every request and never touches the
 *      network. Activation is a separate, owner-approved step.
 *   2. Input bounds: non-empty audio, at most 2 MB on the wire, and a
 *      declared duration of at most 60 seconds. (The byte bound is also
 *      the physical duration bound for the negotiated recording formats;
 *      sample-accurate duration cannot be derived from bytes without an
 *      audio decoder, and no decoder dependency is introduced.)
 *   3. Evidence gate: the PR-V1 voice model catalog must hold current
 *      evidence for the Whisper model, in the same style as every other
 *      free-model catalog. Stale or invalid evidence stops execution.
 *   4. Credentials: the image route's production-registered Cloudflare
 *      pair (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN). No new secret
 *      is introduced for voice.
 *   5. Shared-pool pre-check: today's measured account Neuron usage plus
 *      this request's worst-case estimate (one full minute at the
 *      catalogued rate) must fit inside the 10,000 Neurons/day free
 *      allocation before any inference is sent.
 *   6. Daily cap: at most 20 transcriptions per UTC day, reserved before
 *      the provider call so failed calls cannot multiply Neuron spend.
 *   7. Provider call: the Workers AI REST API is called DIRECTLY
 *      (never through AI Gateway, whose logging/caching is a documented
 *      exception to Cloudflare's zero-retention statement).
 *
 * The audio bytes live only in memory for the duration of the call: they
 * are never written to disk, a database, or a log, and only the
 * transcription text is returned. Cost stays $0.00 structurally: the
 * account is on Workers Free, whose daily allocation fails with an error
 * instead of billing, and there is no paid fallback anywhere in this path.
 */

const API_ORIGIN = 'https://api.cloudflare.com';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export const ORIGIN_VOICE_TRANSCRIBE_ENABLED_ENV = 'ORIGIN_VOICE_TRANSCRIBE_ENABLED';
export const ORIGIN_VOICE_MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const ORIGIN_VOICE_MAX_DURATION_MS = 60_000;
export const ORIGIN_VOICE_DAILY_LIMIT = 20;
export const ORIGIN_VOICE_LANGUAGE = 'ja';

export function isOriginVoiceTranscribeEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[ORIGIN_VOICE_TRANSCRIBE_ENABLED_ENV] === 'true';
}

function credentials(env: NodeJS.ProcessEnv): { accountId: string; apiToken: string } | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '';
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim() ?? '';
  if (!/^[a-f0-9]{32}$/i.test(accountId) || apiToken.length < 20 || apiToken.length > 4096) return null;
  return { accountId, apiToken };
}

export interface OriginVoiceDailyLimiter {
  tryReserve(nowMs: number): { ok: boolean; date: string; used: number; limit: number };
}

/**
 * In-memory per-day counter, keyed by the UTC date (the free allocation
 * resets at 00:00 UTC). Deterministic and dependency-free, in the same
 * spirit as the chat rate limiter's in-process buckets.
 *
 * HONEST CONSTRAINT: the counter is per server process. On serverless
 * hosting each instance keeps its own count and a cold start resets it,
 * so this is a per-instance cap on this feature's spend, not a global
 * ledger. The hard backstop is structural and account-wide: the Workers
 * Free daily allocation (10,000 Neurons) errors instead of billing, and
 * the pre-check above refuses to send inference that would not fit in
 * the measured remainder.
 */
export function createOriginVoiceDailyLimiter(limit: number = ORIGIN_VOICE_DAILY_LIMIT): OriginVoiceDailyLimiter {
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : ORIGIN_VOICE_DAILY_LIMIT;
  let currentDate = '';
  let used = 0;
  return {
    tryReserve(nowMs: number) {
      const date = new Date(nowMs).toISOString().slice(0, 10);
      if (date !== currentDate) {
        currentDate = date;
        used = 0;
      }
      if (used >= safeLimit) return { ok: false, date, used, limit: safeLimit };
      used += 1;
      return { ok: true, date, used, limit: safeLimit };
    },
  };
}

export const originVoiceDailyLimiter = createOriginVoiceDailyLimiter();

export type OriginVoiceTranscriptionFailureCode =
  | 'VOICE_TRANSCRIBE_DISABLED'
  | 'VOICE_AUDIO_EMPTY'
  | 'VOICE_AUDIO_TOO_LARGE'
  | 'VOICE_AUDIO_TOO_LONG'
  | 'VOICE_DURATION_INVALID'
  | OriginCloudflareVoiceModelCatalogFailureCode
  | 'CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED'
  | 'CLOUDFLARE_DAILY_USAGE_UNVERIFIED'
  | 'CLOUDFLARE_FREE_ALLOCATION_INSUFFICIENT'
  | 'VOICE_DAILY_LIMIT_REACHED'
  | 'VOICE_PROVIDER_UNREACHABLE'
  | 'VOICE_TRANSCRIPTION_RESPONSE_INVALID'
  | string;

export type OriginVoiceTranscriptionResult =
  | {
      ok: true;
      text: string;
      model: typeof ORIGIN_CLOUDFLARE_VOICE_MODEL;
      language: string;
      daily: { date: string; used: number; limit: number };
    }
  | {
      ok: false;
      code: OriginVoiceTranscriptionFailureCode;
      httpStatus: number;
      retryable: boolean;
    };

export interface OriginVoiceTranscriptionInput {
  /** Raw audio bytes as received on the wire. Never persisted anywhere. */
  audio: Buffer;
  /**
   * Recording duration declared by the client (PR-V3 sends it from its
   * 60-second recording cap). Validated when present; the byte bound
   * applies regardless.
   */
  declaredDurationMs?: number | null;
}

export interface OriginVoiceTranscriptionOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  limiter?: OriginVoiceDailyLimiter;
  catalog?: readonly OriginCloudflareVoiceModelEvidence[];
}

function failure(code: OriginVoiceTranscriptionFailureCode, httpStatus: number, retryable: boolean): OriginVoiceTranscriptionResult {
  return { ok: false, code, httpStatus, retryable };
}

async function timedFetch(url: string, init: RequestInit, fetchImpl: typeof fetch, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal, redirect: 'error', cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(chunk);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks);
}

export async function transcribeOriginVoiceAudio(
  input: OriginVoiceTranscriptionInput,
  options: OriginVoiceTranscriptionOptions = {},
): Promise<OriginVoiceTranscriptionResult> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowMs = options.nowMs ?? Date.now();
  const limiter = options.limiter ?? originVoiceDailyLimiter;

  // 1. Kill switch (default OFF): refuse everything, touch nothing.
  if (!isOriginVoiceTranscribeEnabled(env)) {
    return failure('VOICE_TRANSCRIBE_DISABLED', 503, false);
  }

  // 2. Input bounds.
  if (!Buffer.isBuffer(input.audio) || input.audio.length === 0) {
    return failure('VOICE_AUDIO_EMPTY', 400, false);
  }
  // The router only ever passes a Buffer it constructed from the raw
  // request body, and the Buffer.isBuffer check directly above rejects
  // anything else before this line, so the length comparison cannot
  // observe a type-confused value (CodeQL does not model Buffer.isBuffer
  // as a type guard).
  // codeql[js/type-confusion-through-parameter-tampering]
  if (input.audio.length > ORIGIN_VOICE_MAX_AUDIO_BYTES) {
    return failure('VOICE_AUDIO_TOO_LARGE', 413, false);
  }
  if (
    input.declaredDurationMs !== undefined
    && input.declaredDurationMs !== null
    && (typeof input.declaredDurationMs !== 'number'
      || !Number.isFinite(input.declaredDurationMs)
      || input.declaredDurationMs < 0)
  ) {
    return failure('VOICE_DURATION_INVALID', 400, false);
  }
  if (
    typeof input.declaredDurationMs === 'number'
    && input.declaredDurationMs > ORIGIN_VOICE_MAX_DURATION_MS
  ) {
    return failure('VOICE_AUDIO_TOO_LONG', 400, false);
  }

  // 3. Evidence gate (PR-V1 catalog): no current evidence, no call.
  const evidence = selectCurrentOriginCloudflareVoiceModel(options.catalog, nowMs);
  if (evidence.ok === false) {
    return failure(evidence.code, 503, false);
  }
  const model = evidence.model.modelId;

  // 4. Credentials (the image route's production-registered pair).
  const auth = credentials(env);
  if (!auth) {
    return failure('CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED', 503, false);
  }

  // 5. Shared-pool pre-check against today's measured Neuron usage. The
  // estimate is the worst case this endpoint allows: one full minute.
  const estimateNeurons = ORIGIN_CLOUDFLARE_VOICE_MODEL_NEURONS_PER_AUDIO_MINUTE[model];
  let usedNeurons: number;
  try {
    const usage = await fetchCloudflareDailyNeuronsUsedV15(auth, fetchImpl, nowMs);
    usedNeurons = usage.usedNeurons;
  } catch {
    return failure('CLOUDFLARE_DAILY_USAGE_UNVERIFIED', 503, false);
  }
  if (usedNeurons + estimateNeurons > CLOUDFLARE_FREE_DAILY_NEURONS_V15) {
    return failure('CLOUDFLARE_FREE_ALLOCATION_INSUFFICIENT', 503, false);
  }

  // 6. Daily cap for this feature (20/day), reserved before dispatch so a
  // failing provider call cannot be retried into multiplied spend.
  const reservation = limiter.tryReserve(nowMs);
  if (!reservation.ok) {
    return failure('VOICE_DAILY_LIMIT_REACHED', 429, false);
  }

  // 7. Direct REST call to Workers AI (never AI Gateway). The audio is
  // sent as base64 inside the model's documented JSON input shape and is
  // held only in memory; nothing about it is logged.
  let response: Response;
  try {
    response = await timedFetch(
      `${API_ORIGIN}/client/v4/accounts/${auth.accountId}/ai/run/${model}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'ORIGIN-Personal/1.5',
        },
        body: JSON.stringify({
          audio: input.audio.toString('base64'),
          language: ORIGIN_VOICE_LANGUAGE,
          task: 'transcribe',
        }),
      },
      fetchImpl,
    );
  } catch {
    return failure('VOICE_PROVIDER_UNREACHABLE', 503, true);
  }

  if (!response.ok) {
    const classified = await classifyCloudflareWorkersAiFailureV15(response, 'CLOUDFLARE_VOICE_HTTP');
    return failure(classified.code, 503, classified.retryable);
  }

  const raw = await readBoundedBody(response, MAX_RESPONSE_BYTES);
  if (raw === null) {
    return failure('VOICE_TRANSCRIPTION_RESPONSE_INVALID', 503, false);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    return failure('VOICE_TRANSCRIPTION_RESPONSE_INVALID', 503, false);
  }
  const envelope = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const result = envelope?.result && typeof envelope.result === 'object' && !Array.isArray(envelope.result)
    ? envelope.result as Record<string, unknown>
    : null;
  if (envelope?.success !== true || typeof result?.text !== 'string') {
    return failure('VOICE_TRANSCRIPTION_RESPONSE_INVALID', 503, false);
  }

  return {
    ok: true,
    text: result.text,
    model,
    language: ORIGIN_VOICE_LANGUAGE,
    daily: { date: reservation.date, used: reservation.used, limit: reservation.limit },
  };
}
