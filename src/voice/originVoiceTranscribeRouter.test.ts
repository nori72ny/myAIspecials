import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createOriginVoiceTranscribeRouter } from './originVoiceTranscribeRouter';
import { createOriginVoiceDailyLimiter } from './cloudflareVoiceTranscription';

const ACCOUNT_ID = 'a'.repeat(32);
const API_TOKEN = 't'.repeat(40);
const NOW_MS = Date.parse('2026-11-20T12:00:00.000Z');

function enabledEnv(): NodeJS.ProcessEnv {
  return {
    ORIGIN_VOICE_TRANSCRIBE_ENABLED: 'true',
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: API_TOKEN,
  };
}

function mockFetch() {
  const fetchImpl = vi.fn(async (url: string | URL) => {
    if (String(url).includes('/graphql')) {
      return new Response(JSON.stringify({
        data: { viewer: { accounts: [{ aiInferenceAdaptiveGroups: [{ count: 1, sum: { totalNeurons: 100 } }] }] } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      success: true,
      errors: [],
      messages: [],
      result: { text: 'ルーター経由の文字起こしです。', word_count: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return fetchImpl as unknown as typeof fetch;
}

// Mirrors the voice mounts in createOriginApp: the raw body parser is
// scoped to the transcribe path before the router.
function app(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch) {
  const instance = express();
  instance.use('/api/voice/transcribe', express.raw({ limit: '2mb', type: ['audio/*', 'application/octet-stream'] }));
  instance.use(createOriginVoiceTranscribeRouter(env, {
    fetchImpl,
    limiter: createOriginVoiceDailyLimiter(),
    now: () => NOW_MS,
  }));
  return instance;
}

describe('originVoiceTranscribeRouter', () => {
  it('returns VOICE_TRANSCRIBE_DISABLED while the kill switch is OFF, with zero external calls', async () => {
    const fetchImpl = mockFetch();
    const response = await request(app({}, fetchImpl))
      .post('/api/voice/transcribe')
      .set('Content-Type', 'audio/webm')
      .send(Buffer.from('audio-bytes'));
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ ok: false, code: 'VOICE_TRANSCRIBE_DISABLED', freeOnly: true, paidFallbackUsed: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns only the transcription text on success', async () => {
    const fetchImpl = mockFetch();
    const response = await request(app(enabledEnv(), fetchImpl))
      .post('/api/voice/transcribe')
      .set('Content-Type', 'audio/webm')
      .set('X-Origin-Audio-Duration-Ms', '45000')
      .send(Buffer.from('audio-bytes'));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      code: 'VOICE_TRANSCRIPTION_READY',
      text: 'ルーター経由の文字起こしです。',
      model: '@cf/openai/whisper-large-v3-turbo',
      language: 'ja',
      dailyUsed: 1,
      dailyLimit: 20,
      freeOnly: true,
      paidFallbackUsed: false,
    });
  });

  it('rejects a non-audio content type with 415', async () => {
    const fetchImpl = mockFetch();
    const response = await request(app(enabledEnv(), fetchImpl))
      .post('/api/voice/transcribe')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));
    expect(response.status).toBe(415);
    expect(response.body.code).toBe('VOICE_CONTENT_TYPE_UNSUPPORTED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a malformed duration header and an over-length duration before any external call', async () => {
    const fetchImpl = mockFetch();
    const malformed = await request(app(enabledEnv(), fetchImpl))
      .post('/api/voice/transcribe')
      .set('Content-Type', 'audio/webm')
      .set('X-Origin-Audio-Duration-Ms', 'abc')
      .send(Buffer.from('audio-bytes'));
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('VOICE_DURATION_INVALID');
    const tooLong = await request(app(enabledEnv(), fetchImpl))
      .post('/api/voice/transcribe')
      .set('Content-Type', 'audio/mp4')
      .set('X-Origin-Audio-Duration-Ms', '61000')
      .send(Buffer.from('audio-bytes'));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.code).toBe('VOICE_AUDIO_TOO_LONG');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an empty audio body', async () => {
    const fetchImpl = mockFetch();
    const response = await request(app(enabledEnv(), fetchImpl))
      .post('/api/voice/transcribe')
      .set('Content-Type', 'audio/webm')
      .send(Buffer.alloc(0));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VOICE_AUDIO_EMPTY');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin request before any external call', async () => {
    const fetchImpl = mockFetch();
    const response = await request(app(enabledEnv(), fetchImpl))
      .post('/api/voice/transcribe')
      .set('Content-Type', 'audio/webm')
      .set('Origin', 'https://evil.example.com')
      .send(Buffer.from('audio-bytes'));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('CROSS_ORIGIN_REQUEST_BLOCKED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
