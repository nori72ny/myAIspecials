import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOriginApp } from '../server/createOriginApp';
import { ORIGIN_VOICE_MAX_AUDIO_BYTES } from './cloudflareVoiceTranscription';

// End-to-end wiring checks through the real application: the raw body
// parser mount, the voice-specific oversize error, and the router itself.
const ACCOUNT_ID = 'a'.repeat(32);
const API_TOKEN = 't'.repeat(40);

describe('voice transcription route wiring in createOriginApp', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is mounted and refuses with VOICE_TRANSCRIBE_DISABLED while the switch is off (default)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await request(createOriginApp({ ...process.env }))
      .post('/api/voice/transcribe')
      .set('Content-Type', 'audio/webm')
      .send(Buffer.from('audio-bytes'));
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ ok: false, code: 'VOICE_TRANSCRIBE_DISABLED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an over-limit body with the voice-specific 413 code', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await request(createOriginApp({ ...process.env }))
      .post('/api/voice/transcribe')
      .set('Content-Type', 'audio/webm')
      .send(Buffer.alloc(ORIGIN_VOICE_MAX_AUDIO_BYTES + 1));
    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ ok: false, code: 'VOICE_AUDIO_TOO_LARGE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('transcribes end to end when the switch is on and the provider is mocked', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes('/graphql')) {
        return new Response(JSON.stringify({
          data: { viewer: { accounts: [{ aiInferenceAdaptiveGroups: [{ count: 1, sum: { totalNeurons: 100 } }] }] } },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        success: true,
        errors: [],
        messages: [],
        result: { text: 'アプリ経由の文字起こしです。', word_count: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await request(createOriginApp({
      ...process.env,
      ORIGIN_VOICE_TRANSCRIBE_ENABLED: 'true',
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN: API_TOKEN,
    }))
      .post('/api/voice/transcribe')
      .set('Content-Type', 'audio/webm')
      .send(Buffer.from('audio-bytes'));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, text: 'アプリ経由の文字起こしです。' });
  });
});
