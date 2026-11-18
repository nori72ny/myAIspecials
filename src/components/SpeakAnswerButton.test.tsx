// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SpeakAnswerButton from './SpeakAnswerButton';
import { refreshVoiceOutputAvailability } from '../voice/voiceOutputAvailability';
import { voiceSpeech, type SpeechUtteranceLike, type SpeechVoiceLike } from '../voice/voiceSpeech';

// Component tests for the VC-1 read-aloud button: it must exist only
// when the server switch proved on AND the device can speak, and it
// must drive the shared speech controller (speak / stop) when used.

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
  cancelCalls = 0;
  constructor(private readonly voices: SpeechVoiceLike[]) {}
  speak(utterance: SpeechUtteranceLike): void {
    this.spoken.push(utterance as FakeUtterance);
  }
  cancel(): void {
    this.cancelCalls += 1;
  }
  getVoices(): SpeechVoiceLike[] {
    return this.voices;
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

const KYOKO: SpeechVoiceLike = { voiceURI: 'kyoko-uri', name: 'Kyoko', lang: 'ja-JP', localService: true };

let synthesis: FakeSynthesis;

function healthFetch(voiceOutputEnabled: boolean) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: 'ok', voiceOutputEnabled }),
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  window.localStorage.clear();
  synthesis = new FakeSynthesis([KYOKO]);
  vi.stubGlobal('speechSynthesis', synthesis);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
});

afterEach(() => {
  voiceSpeech.stop();
  cleanup();
  vi.unstubAllGlobals();
});

describe('SpeakAnswerButton', () => {
  it('renders nothing while the voice-output switch is off', async () => {
    await act(async () => { await refreshVoiceOutputAvailability(healthFetch(false)); });
    const { container } = render(<SpeakAnswerButton messageId="m1" text="こんにちは。" language="ja" />);
    expect(container.firstChild).toBeNull();
  });

  it('speaks the answer sentence by sentence and turns into a stop button', async () => {
    await act(async () => { await refreshVoiceOutputAvailability(healthFetch(true)); });
    render(<SpeakAnswerButton messageId="m1" text="一つ目です。二つ目です。" language="ja" />);
    const button = screen.getByTestId('speak-answer-button-m1');
    expect(button.textContent).toContain('読み上げ');

    fireEvent.click(button);
    expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual(['一つ目です。', '二つ目です。']);
    expect(synthesis.spoken[0]?.voice?.voiceURI).toBe('kyoko-uri');
    expect(screen.getByTestId('speak-answer-button-m1').textContent).toContain('停止');

    fireEvent.click(screen.getByTestId('speak-answer-button-m1'));
    expect(synthesis.cancelCalls).toBeGreaterThan(0);
    expect(screen.getByTestId('speak-answer-button-m1').textContent).toContain('読み上げ');
  });

  it('renders nothing when the device cannot speak', async () => {
    vi.unstubAllGlobals();
    await act(async () => { await refreshVoiceOutputAvailability(healthFetch(true)); });
    const { container } = render(<SpeakAnswerButton messageId="m1" text="こんにちは。" language="ja" />);
    expect(container.firstChild).toBeNull();
  });
});
