// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { refreshVoiceOutputAvailability } from './voice/voiceOutputAvailability';
import { voiceConversation } from './voice/voiceConversation';
import type { SpeechUtteranceLike, SpeechVoiceLike } from './voice/voiceSpeech';

// App-level tests for VC-2: with the voice-output switch proven on,
// the conversation bar appears; a spoken turn lands in the composer
// (never auto-sent); after the owner sends, the completed answer's
// summary is spoken. With the switch off, the bar never appears.

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

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  started = false;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start(): void { this.started = true; }
  stop(): void {}
  abort(): void {}
  emitFinal(transcript: string): void {
    const result: { isFinal: boolean; length: number; [index: number]: { transcript: string } } = {
      isFinal: true,
      length: 1,
    };
    result[0] = { transcript };
    this.onresult?.({ resultIndex: 0, results: [result] });
  }
  emitEnd(): void { this.onend?.(); }
}

let synthesis: FakeSynthesis;

function requestPath(input: unknown): string {
  if (typeof input === 'string') return input;
  return (input as { url?: string })?.url ?? '';
}

function installFetch(voiceOutputEnabled: boolean) {
  const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
    const path = requestPath(input);
    if (path.includes('/api/health')) {
      return new Response(JSON.stringify({ status: 'ok', voiceOutputEnabled }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (path.includes('/api/chat')) {
      return new Response(JSON.stringify({
        content: '明日は晴れです。気温は20度です。',
        routing: { modelId: 'google/gemma-4-31b-it:free', freeOnly: true, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, usage: { costUsd: 0 }, providerRouting: { requestedModel: 'google/gemma-4-31b-it:free', servedModel: 'google/gemma-4-31b-it:free', fallbackUsed: false } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  window.localStorage.clear();
  FakeRecognition.instances = [];
  synthesis = new FakeSynthesis();
  vi.stubGlobal('speechSynthesis', synthesis);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  vi.stubGlobal('SpeechRecognition', FakeRecognition);
});

afterEach(() => {
  voiceConversation.stopConversation();
  cleanup();
  vi.unstubAllGlobals();
});

describe('App voice conversation (VC-2)', () => {
  it('runs a full turn: Orin opens → speak → review in composer → send → summary is spoken', async () => {
    await act(async () => { await refreshVoiceOutputAvailability(installFetch(true)); });
    render(<App language="ja" />);

    const start = await screen.findByTestId('voice-conversation-start');
    expect(start.textContent).toContain('オリンと会話');
    fireEvent.click(start);

    // Orin opens the conversation with the greeting before the
    // microphone opens.
    await waitFor(() => {
      expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual([
        'こんにちは、オリンです。',
        '何をお手伝いしましょうか？',
      ]);
    });
    expect(FakeRecognition.instances.at(-1)!.started).toBe(false);
    act(() => {
      for (const utterance of synthesis.spoken) utterance.onend?.();
    });

    // After the greeting, the first listening turn opens.
    await waitFor(() => {
      expect(FakeRecognition.instances.at(-1)!.started).toBe(true);
    });
    const recognition = FakeRecognition.instances.at(-1)!;
    expect(recognition.lang).toBe('ja-JP');

    act(() => {
      recognition.emitFinal('明日の天気は？');
      recognition.emitEnd();
    });

    // The transcript waits in the composer for the owner's review —
    // nothing has been sent yet.
    const composer = screen.getByTestId('origin-home-request') as HTMLTextAreaElement;
    expect(composer.value).toContain('明日の天気は？');
    expect(screen.queryByText('明日は晴れです。気温は20度です。')).toBeNull();

    fireEvent.click(screen.getByTestId('start-request-button'));
    await screen.findByText('明日は晴れです。気温は20度です。');

    await waitFor(() => {
      expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual([
        'こんにちは、オリンです。',
        '何をお手伝いしましょうか？',
        '明日は晴れです。',
        '気温は20度です。',
      ]);
    });
    expect(voiceConversation.getState().phase).toBe('speaking');
  });

  it('shows no conversation bar when the switch is off', async () => {
    await act(async () => { await refreshVoiceOutputAvailability(installFetch(false)); });
    render(<App language="ja" />);
    expect(screen.queryByTestId('voice-conversation-bar')).toBeNull();
  });
});
