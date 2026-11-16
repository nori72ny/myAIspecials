import { describe, expect, it, vi } from 'vitest';
import {
  getVoiceAvailability,
  refreshVoiceAvailability,
  subscribeVoiceAvailability,
} from './voiceAvailability';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('voice availability store', () => {
  it('publishes the probe result and notifies subscribers', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVoiceAvailability(listener);
    const disabled = vi.fn(async () => jsonResponse({ ok: false, code: 'VOICE_TRANSCRIBE_DISABLED' }, 503));
    await expect(refreshVoiceAvailability(disabled as unknown as typeof fetch)).resolves.toBe('unavailable');
    expect(getVoiceAvailability()).toBe('unavailable');
    expect(listener).toHaveBeenCalled();
    const enabled = vi.fn(async () => jsonResponse({ ok: false, code: 'VOICE_AUDIO_EMPTY' }, 400));
    await expect(refreshVoiceAvailability(enabled as unknown as typeof fetch)).resolves.toBe('available');
    expect(getVoiceAvailability()).toBe('available');
    unsubscribe();
  });

  it('fails closed when the probe cannot prove availability', async () => {
    const throwing = vi.fn(async () => { throw new Error('offline'); });
    await expect(refreshVoiceAvailability(throwing as unknown as typeof fetch)).resolves.toBe('unavailable');
    expect(getVoiceAvailability()).toBe('unavailable');
  });
});
