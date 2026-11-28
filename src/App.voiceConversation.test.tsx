// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { refreshVoiceOutputAvailability } from './voice/voiceOutputAvailability';
import { voiceConversation } from './voice/voiceConversation';
import type { SpeechUtteranceLike, SpeechVoiceLike } from './voice/voiceSpeech';

// App-level tests for VC-2: with the voice-output switch proven on,
// the conversation bar appears; a spoken turn is sent at once
// (never placed in the composer, no send tap); the completed
// answer's summary is spoken. With the switch off, the bar never
// appears.

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
  it('runs a full turn hands-free: Orin opens → speak → sent at once → summary is spoken', async () => {
    const fetchMock = installFetch(true);
    await act(async () => { await refreshVoiceOutputAvailability(fetchMock); });
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
    const composer = screen.getByTestId('origin-home-request') as HTMLTextAreaElement;

    act(() => {
      recognition.emitFinal('明日の天気は？');
      recognition.emitEnd();
    });

    // The utterance never lands in the composer…
    expect(composer.value).toBe('');
    // …and nobody taps send: the answer arrives on its own, and
    // the chat request carried the spoken text.
    await screen.findByText('明日は晴れです。気温は20度です。');
    const chatCall = fetchMock.mock.calls.find(([input]) => requestPath(input).includes('/api/chat'));
    expect(chatCall).toBeDefined();
    expect(String((chatCall![1] as RequestInit | undefined)?.body ?? '')).toContain('明日の天気は？');

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

  it('keeps the voice loop alive across turns: the second answer is spoken too', async () => {
    let chatCalls = 0;
    const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const path = requestPath(input);
      if (path.includes('/api/health')) {
        return new Response(JSON.stringify({ status: 'ok', voiceOutputEnabled: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.includes('/api/chat')) {
        chatCalls += 1;
        const content = chatCalls === 1 ? '明日は晴れです。気温は20度です。' : '明後日は雨です。気温は18度です。';
        return new Response(JSON.stringify({
          content,
          routing: { modelId: 'google/gemma-4-31b-it:free', freeOnly: true, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, usage: { costUsd: 0 }, providerRouting: { requestedModel: 'google/gemma-4-31b-it:free', servedModel: 'google/gemma-4-31b-it:free', fallbackUsed: false } },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => { await refreshVoiceOutputAvailability(fetchMock); });
    render(<App language="ja" />);

    fireEvent.click(await screen.findByTestId('voice-conversation-start'));
    await waitFor(() => {
      expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual([
        'こんにちは、オリンです。',
        '何をお手伝いしましょうか？',
      ]);
    });
    act(() => {
      for (const utterance of synthesis.spoken) utterance.onend?.();
    });
    await waitFor(() => {
      expect(FakeRecognition.instances.at(-1)!.started).toBe(true);
    });

    // Turn 1.
    const first = FakeRecognition.instances.at(-1)!;
    act(() => {
      first.emitFinal('明日の天気は？');
      first.emitEnd();
    });
    await screen.findByText('明日は晴れです。気温は20度です。');
    await waitFor(() => {
      expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual([
        'こんにちは、オリンです。',
        '何をお手伝いしましょうか？',
        '明日は晴れです。',
        '気温は20度です。',
      ]);
    });
    // The summary finishes; the loop reopens the microphone.
    const recognitionsBefore = FakeRecognition.instances.length;
    act(() => {
      for (const utterance of synthesis.spoken.slice(2)) utterance.onend?.();
    });
    await waitFor(() => {
      expect(FakeRecognition.instances.length).toBeGreaterThan(recognitionsBefore);
      expect(FakeRecognition.instances.at(-1)!.started).toBe(true);
    }, { timeout: 3000 });

    // Turn 2: the answer must be spoken again, not text-only.
    const second = FakeRecognition.instances.at(-1)!;
    act(() => {
      second.emitFinal('明後日は？');
      second.emitEnd();
    });
    await screen.findByText('明後日は雨です。気温は18度です。');
    await waitFor(() => {
      expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual([
        'こんにちは、オリンです。',
        '何をお手伝いしましょうか？',
        '明日は晴れです。',
        '気温は20度です。',
        '明後日は雨です。',
        '気温は18度です。',
      ]);
    }, { timeout: 3000 });
    expect(voiceConversation.getState().phase).toBe('speaking');
  });

  it('keeps the voice loop alive across STREAMED turns (the production chat path)', async () => {
    let chatCalls = 0;
    const model = 'google/gemma-4-31b-it:free';
    const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const path = requestPath(input);
      if (path.includes('/api/health')) {
        return new Response(JSON.stringify({ status: 'ok', voiceOutputEnabled: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.includes('/api/chat')) {
        chatCalls += 1;
        const text = chatCalls === 1 ? '明日は晴れです。気温は20度です。' : '明後日は雨です。気温は18度です。';
        const body = [
          `data: ${JSON.stringify({ type: 'delta', text })}`,
          `data: ${JSON.stringify({ type: 'complete', modelId: model, servedModel: model, costEvidenceStatus: 'NOT_MEASURED', fallbackUsed: false })}`,
          'data: [DONE]',
          '',
        ].join('\n\n');
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'upstream', 'X-Origin-Stream-Protocol': 'origin-verified-sse-v1' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => window.setTimeout(() => callback(0), 0));
    try {
      await act(async () => { await refreshVoiceOutputAvailability(fetchMock); });
      render(<App language="ja" />);
      fireEvent.click(await screen.findByTestId('voice-conversation-start'));
      await waitFor(() => {
        expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual([
          'こんにちは、オリンです。',
          '何をお手伝いしましょうか？',
        ]);
      });
      act(() => {
        for (const utterance of synthesis.spoken) utterance.onend?.();
      });
      await waitFor(() => {
        expect(FakeRecognition.instances.at(-1)!.started).toBe(true);
      });

      // Turn 1 (streamed).
      const first = FakeRecognition.instances.at(-1)!;
      act(() => {
        first.emitFinal('明日の天気は？');
        first.emitEnd();
      });
      await screen.findByText('明日は晴れです。気温は20度です。');
      await waitFor(() => {
        expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual([
          'こんにちは、オリンです。',
          '何をお手伝いしましょうか？',
          '明日は晴れです。',
          '気温は20度です。',
        ]);
      }, { timeout: 3000 });
      const recognitionsBefore = FakeRecognition.instances.length;
      act(() => {
        for (const utterance of synthesis.spoken.slice(2)) utterance.onend?.();
      });
      await waitFor(() => {
        expect(FakeRecognition.instances.length).toBeGreaterThan(recognitionsBefore);
        expect(FakeRecognition.instances.at(-1)!.started).toBe(true);
      }, { timeout: 3000 });

      // Turn 2 (streamed): the answer must be spoken again.
      const second = FakeRecognition.instances.at(-1)!;
      act(() => {
        second.emitFinal('明後日は？');
        second.emitEnd();
      });
      await screen.findByText('明後日は雨です。気温は18度です。');
      await waitFor(() => {
        expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual([
          'こんにちは、オリンです。',
          '何をお手伝いしましょうか？',
          '明日は晴れです。',
          '気温は20度です。',
          '明後日は雨です。',
          '気温は18度です。',
        ]);
      }, { timeout: 3000 });
    } finally {
      frame.mockRestore();
    }
  });

  it('speaks a research-mode answer in conversation mode, with the sources left unread', async () => {
    const researchPayload = {
      ok: true,
      version: '1.1',
      status: 'grounded',
      provider: 'DuckDuckGo',
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
      sourceCount: 1,
      distinctDomainCount: 1,
      confidence: 'moderate',
      confidenceScope: 'retrieval-evidence-only',
      semanticConflictDetection: 'conservative-structured-only',
      sources: [
        { id: 'S1', title: 'Primary source', url: 'https://example.com/a', domain: 'example.com', evidenceLevel: 'page-verified', freshness: 'recent', score: 85, scoreScope: 'retrieval-evidence-only', citation: '[S1](https://example.com/a)' },
      ],
      conflicts: [],
      report: '今日の東京は晴れです。最高気温は20度です。',
    };
    const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const path = requestPath(input);
      if (path.includes('/api/health')) {
        return new Response(JSON.stringify({ status: 'ok', voiceOutputEnabled: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.includes('/api/research/v1.1/query')) {
        return new Response(JSON.stringify(researchPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => { await refreshVoiceOutputAvailability(fetchMock); });
    render(<App language="ja" />);

    // Research mode on, then the conversation starts.
    fireEvent.click(screen.getByTestId('origin-add-menu-toggle'));
    fireEvent.click(screen.getByRole('menuitem', { name: '詳しく調べる' }));
    expect(screen.getByTestId('research-mode')).toBeTruthy();
    fireEvent.click(await screen.findByTestId('voice-conversation-start'));
    await waitFor(() => {
      expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual([
        'こんにちは、オリンです。',
        '何をお手伝いしましょうか？',
      ]);
    });
    act(() => {
      for (const utterance of synthesis.spoken) utterance.onend?.();
    });
    await waitFor(() => {
      expect(FakeRecognition.instances.at(-1)!.started).toBe(true);
    });
    const recognition = FakeRecognition.instances.at(-1)!;
    act(() => {
      recognition.emitFinal('今日の東京の天気は？');
      recognition.emitEnd();
    });
    // The research answer lands as text…
    await screen.findByText(/今日の東京は晴れです/);
    // …and its summary is spoken (the source list is not).
    await waitFor(() => {
      expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual([
        'こんにちは、オリンです。',
        '何をお手伝いしましょうか？',
        '今日の東京は晴れです。',
        '最高気温は20度です。',
      ]);
    }, { timeout: 3000 });
  });

  it('does not speak a held (could-not-confirm) answer, but the loop returns to listening', async () => {
    const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const path = requestPath(input);
      if (path.includes('/api/health')) {
        return new Response(JSON.stringify({ status: 'ok', voiceOutputEnabled: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.includes('/api/chat')) {
        const body = [
          `data: ${JSON.stringify({ type: 'phase', phase: 'searching' })}`,
          `data: ${JSON.stringify({ type: 'outcome', researchTier: 'T4', researchOutcome: 'ABSTAIN' })}`,
          `data: ${JSON.stringify({ type: 'delta', text: '裏付けが取れませんでした。' })}`,
          `data: ${JSON.stringify({ type: 'complete' })}`,
          'data: [DONE]',
          '',
        ].join('\n\n');
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'phased', 'X-Origin-Stream-Protocol': 'origin-phased-sse-v1' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => window.setTimeout(() => callback(0), 0));
    try {
      await act(async () => { await refreshVoiceOutputAvailability(fetchMock); });
      render(<App language="ja" />);
      fireEvent.click(await screen.findByTestId('voice-conversation-start'));
      await waitFor(() => {
        expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual([
          'こんにちは、オリンです。',
          '何をお手伝いしましょうか？',
        ]);
      });
      act(() => {
        for (const utterance of synthesis.spoken) utterance.onend?.();
      });
      await waitFor(() => {
        expect(FakeRecognition.instances.at(-1)!.started).toBe(true);
      });
      const recognition = FakeRecognition.instances.at(-1)!;
      act(() => {
        recognition.emitFinal('その噂は本当？');
        recognition.emitEnd();
      });
      await screen.findByText('裏付けが取れませんでした。');
      // Nothing beyond the greeting is spoken…
      await waitFor(() => {
        expect(voiceConversation.getState().phase).toBe('listening');
      }, { timeout: 3000 });
      expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual([
        'こんにちは、オリンです。',
        '何をお手伝いしましょうか？',
      ]);
    } finally {
      frame.mockRestore();
    }
  });

  it('shows no conversation bar when the switch is off', async () => {
    await act(async () => { await refreshVoiceOutputAvailability(installFetch(false)); });
    render(<App language="ja" />);
    expect(screen.queryByTestId('voice-conversation-bar')).toBeNull();
  });
});
