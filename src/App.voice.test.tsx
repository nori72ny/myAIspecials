// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { VOICE_PRIVACY_NOTICE_STORAGE_KEY } from './hooks/useVoiceInput';
import { refreshVoiceAvailability } from './voice/voiceAvailability';

class FakeMediaRecorder {
  static isTypeSupported(type: string): boolean {
    return type === 'audio/webm;codecs=opus' || type === 'audio/webm' || type === 'audio/mp4';
  }
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: unknown = null;
  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? '';
  }
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['fake-audio'], { type: this.mimeType }) });
    this.onstop?.();
  }
  pause(): void {}
  resume(): void {}
  requestData(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return true;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const TRANSCRIPT = '音声で入れた文章です';

function installFetch(probeCode: string) {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as { url?: string })?.url ?? '';
    if (url.includes('/api/voice/transcribe')) {
      const body = init?.body as Blob | undefined;
      if (!body || body.size === 0) {
        return jsonResponse({ ok: false, code: probeCode, message: 'probe' }, probeCode === 'VOICE_AUDIO_EMPTY' ? 400 : 503);
      }
      return jsonResponse({
        ok: true,
        code: 'VOICE_TRANSCRIPTION_READY',
        text: TRANSCRIPT,
        dailyUsed: 1,
        dailyLimit: 20,
      });
    }
    // Anything else behaves like the plain jsdom environment: the request
    // cannot be served. App code already tolerates that on mount.
    throw new Error(`unhandled fetch in test: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function installMediaDevices() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const getUserMedia = vi.fn(async () => stream);
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  return { getUserMedia, track };
}

describe('App voice input (PR-V3)', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('does not render the microphone button while the voice endpoint is disabled', async () => {
    const fetchMock = installFetch('VOICE_TRANSCRIBE_DISABLED');
    installMediaDevices();
    // The bootstrap probe (main.tsx) drives availability; run it here
    // through the same entry before rendering.
    await refreshVoiceAvailability(fetchMock as unknown as typeof fetch);
    render(<App language="ja" />);
    expect(screen.getByTestId('origin-home-request')).toBeTruthy();
    expect(screen.queryByTestId('voice-input-button')).toBeNull();
  });

  it('records, transcribes into the composer for review, and never sends the message', async () => {
    const fetchMock = installFetch('VOICE_AUDIO_EMPTY');
    const { getUserMedia } = installMediaDevices();
    await refreshVoiceAvailability(fetchMock as unknown as typeof fetch);
    render(<App language="ja" />);

    const micButton = await screen.findByTestId('voice-input-button');
    expect(micButton.className).toContain('h-11');
    expect(micButton.className).toContain('w-11');

    const input = screen.getByTestId('origin-home-request') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '先に書いた文' } });

    // First use: the privacy notice shows before any recording starts.
    fireEvent.click(micButton);
    expect(screen.getByTestId('voice-privacy-notice')).toBeTruthy();
    expect(screen.getByTestId('voice-privacy-notice').textContent).toContain('保存されません');
    expect(getUserMedia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'はじめる' }));
    await waitFor(() => expect(screen.getByTestId('voice-recording')).toBeTruthy());
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(VOICE_PRIVACY_NOTICE_STORAGE_KEY)).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: '文字にする' }));
    await waitFor(() => expect(input.value).toBe(`先に書いた文 ${TRANSCRIPT}`));

    // The transcription was inserted for review only: no chat request was
    // made and no conversation message exists.
    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calledUrls.every((url) => url.includes('/api/voice/transcribe'))).toBe(true);
    expect(calledUrls.some((url) => url.includes('/api/chat'))).toBe(false);
    expect(document.querySelector('[role="log"] article')).toBeNull();
    expect(screen.queryByTestId('voice-recording')).toBeNull();
  });

  it('shows the plain daily-limit notice when the server reports the cap', async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : '';
      if (url.includes('/api/voice/transcribe')) {
        const body = init?.body as Blob | undefined;
        if (!body || body.size === 0) return jsonResponse({ ok: false, code: 'VOICE_AUDIO_EMPTY' }, 400);
        return jsonResponse({ ok: false, code: 'VOICE_DAILY_LIMIT_REACHED', message: 'limit' }, 429);
      }
      throw new Error(`unhandled fetch in test: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    installMediaDevices();
    localStorage.setItem(VOICE_PRIVACY_NOTICE_STORAGE_KEY, '1');
    await refreshVoiceAvailability(fetchMock as unknown as typeof fetch);
    render(<App language="ja" />);

    const micButton = await screen.findByTestId('voice-input-button');
    fireEvent.click(micButton);
    await waitFor(() => expect(screen.getByTestId('voice-recording')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '文字にする' }));
    await waitFor(() => expect(screen.getByTestId('voice-notice')).toBeTruthy());
    expect(screen.getByTestId('voice-notice').textContent).toContain('今日の音声入力の上限に達しました');
  });
});
