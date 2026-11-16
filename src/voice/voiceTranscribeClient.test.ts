import { describe, expect, it, vi } from 'vitest';
import {
  appendVoiceTranscript,
  formatVoiceElapsed,
  probeVoiceInputAvailability,
  requestVoiceTranscription,
  VOICE_TRANSCRIBE_ENDPOINT,
} from './voiceTranscribeClient';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('probeVoiceInputAvailability', () => {
  it('reports available only when the enabled endpoint rejects the empty probe body as empty', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: false, code: 'VOICE_AUDIO_EMPTY' }, 400));
    await expect(probeVoiceInputAvailability(fetchImpl as unknown as typeof fetch)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(VOICE_TRANSCRIBE_ENDPOINT);
    expect(init.method).toBe('POST');
    expect((init.body as Blob).size).toBe(0);
  });

  it('reports unavailable while the kill switch is off', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: false, code: 'VOICE_TRANSCRIBE_DISABLED' }, 503));
    await expect(probeVoiceInputAvailability(fetchImpl as unknown as typeof fetch)).resolves.toBe(false);
  });

  it('fails closed on unexpected shapes and network errors', async () => {
    const weird = vi.fn(async () => jsonResponse({ hello: 'world' }));
    await expect(probeVoiceInputAvailability(weird as unknown as typeof fetch)).resolves.toBe(false);
    const notJson = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }) as unknown as Response);
    await expect(probeVoiceInputAvailability(notJson as unknown as typeof fetch)).resolves.toBe(false);
    const throwing = vi.fn(async () => { throw new Error('offline'); });
    await expect(probeVoiceInputAvailability(throwing as unknown as typeof fetch)).resolves.toBe(false);
  });
});

describe('requestVoiceTranscription', () => {
  it('sends the recorded blob as the raw body with its type and declared duration', async () => {
    const audio = new Blob(['fake-audio'], { type: 'audio/webm;codecs=opus' });
    const fetchImpl = vi.fn(async () => jsonResponse({
      ok: true,
      code: 'VOICE_TRANSCRIPTION_READY',
      text: 'こんにちは',
      dailyUsed: 3,
      dailyLimit: 20,
    }));
    const outcome = await requestVoiceTranscription(audio, 12_345, fetchImpl as unknown as typeof fetch);
    expect(outcome).toEqual({ ok: true, text: 'こんにちは', dailyUsed: 3, dailyLimit: 20 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe(VOICE_TRANSCRIBE_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('audio/webm;codecs=opus');
    expect(init.headers['x-origin-audio-duration-ms']).toBe('12345');
    expect(init.body).toBe(audio);
  });

  it('maps the daily-limit response to the daily-limit notice', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: false, code: 'VOICE_DAILY_LIMIT_REACHED' }, 429));
    const outcome = await requestVoiceTranscription(new Blob(['x']), 1_000, fetchImpl as unknown as typeof fetch);
    expect(outcome).toEqual({ ok: false, notice: 'daily-limit' });
  });

  it('maps setup-side refusals to the unavailable notice', async () => {
    for (const code of ['VOICE_TRANSCRIBE_DISABLED', 'VOICE_MODEL_EVIDENCE_STALE', 'CLOUDFLARE_FREE_ALLOCATION_INSUFFICIENT']) {
      const fetchImpl = vi.fn(async () => jsonResponse({ ok: false, code }, 503));
      const outcome = await requestVoiceTranscription(new Blob(['x']), 1_000, fetchImpl as unknown as typeof fetch);
      expect(outcome).toEqual({ ok: false, notice: 'unavailable' });
    }
  });

  it('maps other failures and network errors to the generic failed notice', async () => {
    const unknown = vi.fn(async () => jsonResponse({ ok: false, code: 'VOICE_PROVIDER_UNREACHABLE' }, 503));
    await expect(requestVoiceTranscription(new Blob(['x']), 1_000, unknown as unknown as typeof fetch))
      .resolves.toEqual({ ok: false, notice: 'failed' });
    const throwing = vi.fn(async () => { throw new Error('offline'); });
    await expect(requestVoiceTranscription(new Blob(['x']), 1_000, throwing as unknown as typeof fetch))
      .resolves.toEqual({ ok: false, notice: 'failed' });
    const malformed = vi.fn(async () => jsonResponse({ ok: true, text: 42 }));
    await expect(requestVoiceTranscription(new Blob(['x']), 1_000, malformed as unknown as typeof fetch))
      .resolves.toEqual({ ok: false, notice: 'failed' });
  });
});

describe('appendVoiceTranscript', () => {
  it('fills an empty composer and appends to existing text with a separator', () => {
    expect(appendVoiceTranscript('', ' こんにちは ')).toBe('こんにちは');
    expect(appendVoiceTranscript('既存の文', '続きです')).toBe('既存の文 続きです');
    expect(appendVoiceTranscript('既存の文 ', '続きです')).toBe('既存の文 続きです');
    expect(appendVoiceTranscript('既存の文', '   ')).toBe('既存の文');
  });
});

describe('formatVoiceElapsed', () => {
  it('formats seconds as m:ss', () => {
    expect(formatVoiceElapsed(0)).toBe('0:00');
    expect(formatVoiceElapsed(9)).toBe('0:09');
    expect(formatVoiceElapsed(60)).toBe('1:00');
    expect(formatVoiceElapsed(65)).toBe('1:05');
  });
});
