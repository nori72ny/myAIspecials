// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VoiceOutputSettings from './VoiceOutputSettings';
import { refreshVoiceOutputAvailability } from '../voice/voiceOutputAvailability';
import {
  voiceSpeech,
  VOICE_OUTPUT_RATE_STORAGE_KEY,
  VOICE_OUTPUT_VOICE_URI_STORAGE_KEY,
  type SpeechUtteranceLike,
  type SpeechVoiceLike,
} from '../voice/voiceSpeech';
import { VOICE_CONVERSATION_TONE_STORAGE_KEY } from '../voice/voiceConversationTone';

// Component tests for the "Orin's voice" settings section (VC-1): the
// section exists only when the server switch proved on, lists the
// device's Japanese voices as Orin's candidates with gender labels
// where the name carries one, persists the choice on-device, and
// previews the selected voice.

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
  constructor(private readonly voices: SpeechVoiceLike[]) {}
  speak(utterance: SpeechUtteranceLike): void {
    this.spoken.push(utterance as FakeUtterance);
  }
  cancel(): void {}
  getVoices(): SpeechVoiceLike[] {
    return this.voices;
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

const KYOKO: SpeechVoiceLike = { voiceURI: 'kyoko-uri', name: 'Kyoko', lang: 'ja-JP', localService: true };
const ICHIRO: SpeechVoiceLike = { voiceURI: 'ichiro-uri', name: 'Microsoft Ichiro', lang: 'ja-JP', localService: false };
const SAMANTHA: SpeechVoiceLike = { voiceURI: 'en-uri', name: 'Samantha', lang: 'en-US', localService: true };

let synthesis: FakeSynthesis;

function healthFetch(voiceOutputEnabled: boolean) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: 'ok', voiceOutputEnabled }),
  })) as unknown as typeof fetch;
}

function installSynthesis(voices: SpeechVoiceLike[]) {
  synthesis = new FakeSynthesis(voices);
  vi.stubGlobal('speechSynthesis', synthesis);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
}

beforeEach(() => {
  window.localStorage.clear();
  installSynthesis([KYOKO, ICHIRO, SAMANTHA]);
});

afterEach(() => {
  voiceSpeech.stop();
  cleanup();
  vi.unstubAllGlobals();
});

describe('VoiceOutputSettings', () => {
  it('renders nothing while the voice-output switch is off', async () => {
    await act(async () => { await refreshVoiceOutputAvailability(healthFetch(false)); });
    const { container } = render(<VoiceOutputSettings language="ja" />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('orin-voice-section')).toBeNull();
  });

  it('lists Japanese voices as Orin candidates with gender labels, on-device first', async () => {
    await act(async () => { await refreshVoiceOutputAvailability(healthFetch(true)); });
    render(<VoiceOutputSettings language="ja" />);
    expect(screen.getByTestId('orin-voice-section')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'オリンの声' })).toBeTruthy();

    const kyoko = screen.getByTestId('orin-voice-option-kyoko-uri');
    const ichiro = screen.getByTestId('orin-voice-option-ichiro-uri');
    expect(kyoko.textContent).toContain('女性の声');
    expect(kyoko.textContent).toContain('この端末の声');
    expect(ichiro.textContent).toContain('男性の声');
    // Non-Japanese voices are not Orin candidates.
    expect(screen.queryByTestId('orin-voice-option-en-uri')).toBeNull();
    // The on-device voice is the default selection.
    expect(kyoko.getAttribute('aria-checked')).toBe('true');
    expect(ichiro.getAttribute('aria-checked')).toBe('false');
  });

  it('persists the chosen voice on the device and previews it', async () => {
    await act(async () => { await refreshVoiceOutputAvailability(healthFetch(true)); });
    render(<VoiceOutputSettings language="ja" />);
    fireEvent.click(screen.getByTestId('orin-voice-option-ichiro-uri'));
    expect(window.localStorage.getItem(VOICE_OUTPUT_VOICE_URI_STORAGE_KEY)).toBe('ichiro-uri');
    expect(screen.getByTestId('orin-voice-option-ichiro-uri').getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByTestId('orin-voice-preview-button'));
    expect(synthesis.spoken).toHaveLength(1);
    expect(synthesis.spoken[0]?.text).toContain('オリンです');
    expect(synthesis.spoken[0]?.voice?.voiceURI).toBe('ichiro-uri');
    expect(screen.getByTestId('orin-voice-preview-button').textContent).toContain('停止');

    fireEvent.click(screen.getByTestId('orin-voice-preview-button'));
    expect(screen.getByTestId('orin-voice-preview-button').textContent).toContain('試しに聞く');
  });

  it('offers the four conversation tone patterns and persists the choice on the device', async () => {
    await act(async () => { await refreshVoiceOutputAvailability(healthFetch(true)); });
    render(<VoiceOutputSettings language="ja" />);
    expect(screen.getByTestId('orin-voice-tone-strong').textContent).toContain('強い口調');
    expect(screen.getByTestId('orin-voice-tone-gentle').textContent).toContain('優しい口調');
    expect(screen.getByTestId('orin-voice-tone-polite').textContent).toContain('丁寧な口調');
    expect(screen.getByTestId('orin-voice-tone-everyday').textContent).toContain('日常の口調');
    expect(screen.getByTestId('orin-voice-tone-everyday').getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByTestId('orin-voice-tone-gentle'));
    expect(window.localStorage.getItem(VOICE_CONVERSATION_TONE_STORAGE_KEY)).toBe('gentle');
    expect(screen.getByTestId('orin-voice-tone-gentle').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('orin-voice-tone-everyday').getAttribute('aria-checked')).toBe('false');
  });

  it('offers the five speaking-speed steps and persists the choice as the stored rate', async () => {
    await act(async () => { await refreshVoiceOutputAvailability(healthFetch(true)); });
    render(<VoiceOutputSettings language="ja" />);
    expect(screen.getByRole('heading', { name: '声の速さ' })).toBeTruthy();
    expect(screen.getByTestId('orin-voice-speed-slow').textContent).toContain('ゆっくり');
    expect(screen.getByTestId('orin-voice-speed-slightly-slow').textContent).toContain('ややゆっくり');
    expect(screen.getByTestId('orin-voice-speed-normal').textContent).toContain('ふつう');
    expect(screen.getByTestId('orin-voice-speed-slightly-fast').textContent).toContain('ややはやい');
    expect(screen.getByTestId('orin-voice-speed-fast').textContent).toContain('はやい');
    // ふつう is the default step.
    expect(screen.getByTestId('orin-voice-speed-normal').getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByTestId('orin-voice-speed-fast'));
    expect(window.localStorage.getItem(VOICE_OUTPUT_RATE_STORAGE_KEY)).toBe('1.25');
    expect(screen.getByTestId('orin-voice-speed-fast').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('orin-voice-speed-normal').getAttribute('aria-checked')).toBe('false');

    // The chosen speed is what the preview speaks with.
    fireEvent.click(screen.getByTestId('orin-voice-preview-button'));
    expect(synthesis.spoken).toHaveLength(1);
    expect(synthesis.spoken[0]?.rate).toBe(1.25);
  });

  it('says so plainly when the device has no Japanese voice', async () => {
    installSynthesis([SAMANTHA]);
    await act(async () => { await refreshVoiceOutputAvailability(healthFetch(true)); });
    render(<VoiceOutputSettings language="ja" />);
    expect(screen.getByTestId('orin-voice-section')).toBeTruthy();
    expect(screen.getByText(/日本語の声がまだ見つかりませんでした/)).toBeTruthy();
    expect(screen.queryByTestId('orin-voice-preview-button')).toBeNull();
  });
});
