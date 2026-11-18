// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, type ConversationMessage } from './App';
import { refreshVoiceOutputAvailability } from './voice/voiceOutputAvailability';
import { voiceSpeech, type SpeechUtteranceLike, type SpeechVoiceLike } from './voice/voiceSpeech';

// App-level tests for VC-1: the read-aloud button appears on assistant
// answers in the real conversation surface only when the server
// switch proved on at probe time; with the switch off the surface is
// byte-for-byte the pre-VC-1 one.

class FakeUtterance {
  lang = '';
  rate = 1;
  voice: SpeechVoiceLike | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}

class FakeSynthesis {
  spoken: FakeUtterance[] = [];
  speak(utterance: SpeechUtteranceLike): void {
    this.spoken.push(utterance as FakeUtterance);
  }
  cancel(): void {}
  getVoices(): SpeechVoiceLike[] {
    return [{ voiceURI: 'kyoko-uri', name: 'Kyoko', lang: 'ja-JP', localService: true }];
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

let synthesis: FakeSynthesis;

function healthFetch(voiceOutputEnabled: boolean) {
  return vi.fn(async (input: unknown) => {
    const url = typeof input === 'string' ? input : '';
    if (url.includes('/api/health')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', voiceOutputEnabled }),
      } as Response;
    }
    throw new Error(`unhandled fetch in test: ${url}`);
  }) as unknown as typeof fetch;
}

const MESSAGES: ConversationMessage[] = [
  { id: 'u1', role: 'user', content: 'こんにちは' },
  { id: 'a1', role: 'assistant', content: 'こんにちは。お手伝いします。' },
];

beforeEach(() => {
  window.localStorage.clear();
  synthesis = new FakeSynthesis();
  vi.stubGlobal('speechSynthesis', synthesis);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  vi.stubGlobal('fetch', healthFetch(true));
});

afterEach(() => {
  voiceSpeech.stop();
  cleanup();
  vi.unstubAllGlobals();
});

describe('App voice output (VC-1)', () => {
  it('shows the read-aloud button on assistant answers when the switch is on', async () => {
    await act(async () => { await refreshVoiceOutputAvailability(healthFetch(true)); });
    render(<App messages={MESSAGES} />);
    const button = screen.getByTestId('speak-answer-button-a1');
    expect(button.textContent).toContain('読み上げ');
    fireEvent.click(button);
    expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual(['こんにちは。', 'お手伝いします。']);
  });

  it('shows no read-aloud button anywhere when the switch is off', async () => {
    await act(async () => { await refreshVoiceOutputAvailability(healthFetch(false)); });
    render(<App messages={MESSAGES} />);
    expect(screen.queryByTestId('speak-answer-button-a1')).toBeNull();
  });
});
