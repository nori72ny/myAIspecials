import { describe, expect, it, vi } from 'vitest';
import {
  getVoiceOutputAvailability,
  refreshVoiceOutputAvailability,
  subscribeVoiceOutputAvailability,
} from './voiceOutputAvailability';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('voice output availability store', () => {
  it('publishes the probe result and notifies subscribers', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVoiceOutputAvailability(listener);
    const disabled = vi.fn(async () => jsonResponse({ status: 'ok', voiceOutputEnabled: false }));
    await expect(refreshVoiceOutputAvailability(disabled as unknown as typeof fetch)).resolves.toBe('unavailable');
    expect(getVoiceOutputAvailability()).toBe('unavailable');
    expect(listener).toHaveBeenCalled();
    const enabled = vi.fn(async () => jsonResponse({ status: 'ok', voiceOutputEnabled: true }));
    await expect(refreshVoiceOutputAvailability(enabled as unknown as typeof fetch)).resolves.toBe('available');
    expect(getVoiceOutputAvailability()).toBe('available');
    unsubscribe();
  });

  it('fails closed when the status cannot prove the switch is on', async () => {
    const missingField = vi.fn(async () => jsonResponse({ status: 'ok' }));
    await expect(refreshVoiceOutputAvailability(missingField as unknown as typeof fetch)).resolves.toBe('unavailable');
    const serverError = vi.fn(async () => jsonResponse({ voiceOutputEnabled: true }, 503));
    await expect(refreshVoiceOutputAvailability(serverError as unknown as typeof fetch)).resolves.toBe('unavailable');
    const throwing = vi.fn(async () => { throw new Error('offline'); });
    await expect(refreshVoiceOutputAvailability(throwing as unknown as typeof fetch)).resolves.toBe('unavailable');
    expect(getVoiceOutputAvailability()).toBe('unavailable');
  });
});
