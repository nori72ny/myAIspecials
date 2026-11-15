import { describe, expect, it, vi } from 'vitest';
import {
  createOriginVoiceDailyLimiter,
  isOriginVoiceTranscribeEnabled,
  transcribeOriginVoiceAudio,
  ORIGIN_VOICE_DAILY_LIMIT,
  ORIGIN_VOICE_MAX_AUDIO_BYTES,
} from './cloudflareVoiceTranscription';

const ACCOUNT_ID = 'a'.repeat(32);
const API_TOKEN = 't'.repeat(40);
const DURING_MS = Date.parse('2026-11-20T12:00:00.000Z');
const AFTER_REVIEW_MS = Date.parse('2026-12-13T00:00:00.000Z');
const AUDIO = Buffer.from('fake-audio-bytes');

function enabledEnv(): NodeJS.ProcessEnv {
  return {
    ORIGIN_VOICE_TRANSCRIBE_ENABLED: 'true',
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: API_TOKEN,
  };
}

function usageResponse(usedNeurons: number): Response {
  return new Response(JSON.stringify({
    data: {
      viewer: {
        accounts: [{
          aiInferenceAdaptiveGroups: [{ count: 3, sum: { totalNeurons: usedNeurons } }],
        }],
      },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function transcriptionResponse(text: string): Response {
  return new Response(JSON.stringify({
    success: true,
    errors: [],
    messages: [],
    result: { text, word_count: 1 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function mockFetch(usedNeurons = 100, text = 'こんにちは、テストです。') {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });
    if (href.includes('/graphql')) return usageResponse(usedNeurons);
    return transcriptionResponse(text);
  });
  const runCalls = () => calls.filter((call) => call.url.includes('/ai/run/'));
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, runCalls };
}

describe('isOriginVoiceTranscribeEnabled', () => {
  it('is OFF unless the env value is exactly "true"', () => {
    expect(isOriginVoiceTranscribeEnabled({})).toBe(false);
    expect(isOriginVoiceTranscribeEnabled({ ORIGIN_VOICE_TRANSCRIBE_ENABLED: 'false' })).toBe(false);
    expect(isOriginVoiceTranscribeEnabled({ ORIGIN_VOICE_TRANSCRIBE_ENABLED: '1' })).toBe(false);
    expect(isOriginVoiceTranscribeEnabled({ ORIGIN_VOICE_TRANSCRIBE_ENABLED: 'true' })).toBe(true);
  });
});

describe('createOriginVoiceDailyLimiter', () => {
  it('caps reservations per UTC day and resets on the next UTC day', () => {
    const limiter = createOriginVoiceDailyLimiter(2);
    const day1 = Date.parse('2026-11-16T23:59:59.000Z');
    const day2 = Date.parse('2026-11-17T00:00:00.000Z');
    expect(limiter.tryReserve(day1)).toMatchObject({ ok: true, used: 1, limit: 2, date: '2026-11-16' });
    expect(limiter.tryReserve(day1)).toMatchObject({ ok: true, used: 2 });
    expect(limiter.tryReserve(day1)).toMatchObject({ ok: false, used: 2 });
    expect(limiter.tryReserve(day2)).toMatchObject({ ok: true, used: 1, date: '2026-11-17' });
  });

  it('defaults to the 20-per-day design cap', () => {
    expect(ORIGIN_VOICE_DAILY_LIMIT).toBe(20);
  });
});

describe('transcribeOriginVoiceAudio', () => {
  it('refuses everything while the kill switch is OFF and never calls fetch', async () => {
    const { fetchImpl, calls } = mockFetch();
    for (const env of [{}, { ORIGIN_VOICE_TRANSCRIBE_ENABLED: 'false' }, { ORIGIN_VOICE_TRANSCRIBE_ENABLED: '1' }]) {
      const result = await transcribeOriginVoiceAudio(
        { audio: AUDIO },
        { env, fetchImpl, nowMs: DURING_MS, limiter: createOriginVoiceDailyLimiter() },
      );
      expect(result).toMatchObject({ ok: false, code: 'VOICE_TRANSCRIBE_DISABLED', httpStatus: 503, retryable: false });
    }
    expect(calls).toHaveLength(0);
  });

  it('transcribes through the direct ai/run call when every gate passes', async () => {
    const { fetchImpl, calls, runCalls } = mockFetch();
    const result = await transcribeOriginVoiceAudio(
      { audio: AUDIO, declaredDurationMs: 60_000 },
      { env: enabledEnv(), fetchImpl, nowMs: DURING_MS, limiter: createOriginVoiceDailyLimiter() },
    );
    expect(result).toMatchObject({
      ok: true,
      text: 'こんにちは、テストです。',
      model: '@cf/openai/whisper-large-v3-turbo',
      language: 'ja',
      daily: { used: 1, limit: 20, date: '2026-11-20' },
    });
    // Exactly two external calls: the daily-usage read and the inference.
    expect(calls).toHaveLength(2);
    expect(runCalls()).toHaveLength(1);
    const run = runCalls()[0];
    expect(run.url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@cf/openai/whisper-large-v3-turbo`);
    expect(run.url).not.toContain('gateway');
    const headers = run.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_TOKEN}`);
    const body = JSON.parse(String(run.init?.body)) as Record<string, unknown>;
    expect(body.audio).toBe(AUDIO.toString('base64'));
    expect(body.language).toBe('ja');
    expect(body.task).toBe('transcribe');
  });

  it('fails closed on stale catalog evidence and never calls fetch', async () => {
    const { fetchImpl, calls } = mockFetch();
    const result = await transcribeOriginVoiceAudio(
      { audio: AUDIO },
      { env: enabledEnv(), fetchImpl, nowMs: AFTER_REVIEW_MS, limiter: createOriginVoiceDailyLimiter() },
    );
    expect(result).toMatchObject({ ok: false, code: 'VOICE_MODEL_EVIDENCE_STALE', httpStatus: 503 });
    expect(calls).toHaveLength(0);
  });

  it('rejects empty, oversize and over-length audio before any external call', async () => {
    const { fetchImpl, calls } = mockFetch();
    const base = { env: enabledEnv(), fetchImpl, nowMs: DURING_MS, limiter: createOriginVoiceDailyLimiter() };
    await expect(transcribeOriginVoiceAudio({ audio: Buffer.alloc(0) }, base))
      .resolves.toMatchObject({ ok: false, code: 'VOICE_AUDIO_EMPTY', httpStatus: 400 });
    await expect(transcribeOriginVoiceAudio({ audio: Buffer.alloc(ORIGIN_VOICE_MAX_AUDIO_BYTES + 1) }, base))
      .resolves.toMatchObject({ ok: false, code: 'VOICE_AUDIO_TOO_LARGE', httpStatus: 413 });
    await expect(transcribeOriginVoiceAudio({ audio: AUDIO, declaredDurationMs: 60_001 }, base))
      .resolves.toMatchObject({ ok: false, code: 'VOICE_AUDIO_TOO_LONG', httpStatus: 400 });
    expect(calls).toHaveLength(0);
  });

  it('refuses when the Cloudflare credentials are not configured', async () => {
    const { fetchImpl, calls } = mockFetch();
    const env = enabledEnv();
    delete env.CLOUDFLARE_API_TOKEN;
    const result = await transcribeOriginVoiceAudio(
      { audio: AUDIO },
      { env, fetchImpl, nowMs: DURING_MS, limiter: createOriginVoiceDailyLimiter() },
    );
    expect(result).toMatchObject({ ok: false, code: 'CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED', httpStatus: 503 });
    expect(calls).toHaveLength(0);
  });

  it('fails closed when the daily usage cannot be verified', async () => {
    const fetchImpl = vi.fn(async () => new Response('unavailable', { status: 500 })) as unknown as typeof fetch;
    const result = await transcribeOriginVoiceAudio(
      { audio: AUDIO },
      { env: enabledEnv(), fetchImpl, nowMs: DURING_MS, limiter: createOriginVoiceDailyLimiter() },
    );
    expect(result).toMatchObject({ ok: false, code: 'CLOUDFLARE_DAILY_USAGE_UNVERIFIED', httpStatus: 503 });
  });

  it('refuses before inference when the free allocation cannot fit this request', async () => {
    const { fetchImpl, runCalls } = mockFetch(9_990);
    const result = await transcribeOriginVoiceAudio(
      { audio: AUDIO },
      { env: enabledEnv(), fetchImpl, nowMs: DURING_MS, limiter: createOriginVoiceDailyLimiter() },
    );
    expect(result).toMatchObject({ ok: false, code: 'CLOUDFLARE_FREE_ALLOCATION_INSUFFICIENT', httpStatus: 503 });
    expect(runCalls()).toHaveLength(0);
  });

  it('enforces the daily cap: the 21st request never reaches the provider', async () => {
    const { fetchImpl, runCalls } = mockFetch();
    const limiter = createOriginVoiceDailyLimiter(2);
    const options = { env: enabledEnv(), fetchImpl, nowMs: DURING_MS, limiter };
    await expect(transcribeOriginVoiceAudio({ audio: AUDIO }, options)).resolves.toMatchObject({ ok: true });
    await expect(transcribeOriginVoiceAudio({ audio: AUDIO }, options)).resolves.toMatchObject({ ok: true });
    await expect(transcribeOriginVoiceAudio({ audio: AUDIO }, options))
      .resolves.toMatchObject({ ok: false, code: 'VOICE_DAILY_LIMIT_REACHED', httpStatus: 429, retryable: false });
    expect(runCalls()).toHaveLength(2);
  });

  it('classifies a provider 500 as a retryable voice failure', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes('/graphql')) return usageResponse(100);
      return new Response(JSON.stringify({ success: false, errors: [{ code: 9999, message: 'boom' }] }), { status: 500 });
    }) as unknown as typeof fetch;
    const result = await transcribeOriginVoiceAudio(
      { audio: AUDIO },
      { env: enabledEnv(), fetchImpl, nowMs: DURING_MS, limiter: createOriginVoiceDailyLimiter() },
    );
    expect(result).toMatchObject({ ok: false, code: 'CLOUDFLARE_VOICE_HTTP_500', httpStatus: 503, retryable: true });
  });

  it('classifies free-allocation exhaustion (3036) as non-retryable', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes('/graphql')) return usageResponse(100);
      return new Response(JSON.stringify({ success: false, errors: [{ code: 3036, message: 'exhausted' }] }), { status: 429 });
    }) as unknown as typeof fetch;
    const result = await transcribeOriginVoiceAudio(
      { audio: AUDIO },
      { env: enabledEnv(), fetchImpl, nowMs: DURING_MS, limiter: createOriginVoiceDailyLimiter() },
    );
    expect(result).toMatchObject({ ok: false, code: 'CLOUDFLARE_FREE_ALLOCATION_EXHAUSTED', httpStatus: 503, retryable: false });
  });

  it('reports an unreachable provider as retryable', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes('/graphql')) return usageResponse(100);
      throw new Error('socket hangup');
    }) as unknown as typeof fetch;
    const result = await transcribeOriginVoiceAudio(
      { audio: AUDIO },
      { env: enabledEnv(), fetchImpl, nowMs: DURING_MS, limiter: createOriginVoiceDailyLimiter() },
    );
    expect(result).toMatchObject({ ok: false, code: 'VOICE_PROVIDER_UNREACHABLE', httpStatus: 503, retryable: true });
  });

  it('rejects a malformed provider success envelope', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes('/graphql')) return usageResponse(100);
      return new Response(JSON.stringify({ success: true, result: { word_count: 0 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await transcribeOriginVoiceAudio(
      { audio: AUDIO },
      { env: enabledEnv(), fetchImpl, nowMs: DURING_MS, limiter: createOriginVoiceDailyLimiter() },
    );
    expect(result).toMatchObject({ ok: false, code: 'VOICE_TRANSCRIPTION_RESPONSE_INVALID', httpStatus: 503 });
  });
});
