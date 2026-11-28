// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VoiceConversationBar from './VoiceConversationBar';
import { refreshVoiceOutputAvailability } from '../voice/voiceOutputAvailability';
import {
  VoiceConversationController,
  type VoiceConversationSpeech,
} from '../voice/voiceConversation';
import type { SpeechRecognitionLike } from '../voice/voiceSpeechRecognition';

class FakeRecognition implements SpeechRecognitionLike {
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: SpeechRecognitionLike['onresult'] = null;
  onend: SpeechRecognitionLike['onend'] = null;
  onerror: SpeechRecognitionLike['onerror'] = null;
  start(): void {}
  stop(): void {}
  abort(): void {}
}

class FakeSpeech implements VoiceConversationSpeech {
  spoken: Array<{ id: string; text: string }> = [];
  private activeId: string | null = null;
  private listeners = new Set<() => void>();

  speak(id: string, text: string): boolean {
    this.spoken.push({ id, text });
    this.setActive(null);
    this.setActive(id);
    return true;
  }
  stop(): void { this.setActive(null); }
  getActiveId(): string | null { return this.activeId; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  supported(): boolean { return true; }
  finishPlayback(): void { this.setActive(null); }
  private setActive(id: string | null): void {
    this.activeId = id;
    this.listeners.forEach((listener) => listener());
  }
}

function healthFetch(enabled: boolean) {
  return vi.fn(async (input: unknown) => {
    const url = typeof input === 'string' ? input : '';
    if (url.includes('/api/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok', voiceOutputEnabled: enabled }) } as Response;
    }
    throw new Error(`unhandled fetch in test: ${url}`);
  }) as unknown as typeof fetch;
}

function makeController(recognitionSupported = true) {
  const speech = new FakeSpeech();
  const controller = new VoiceConversationController({
    createRecognition: recognitionSupported ? () => new FakeRecognition() : () => null,
    speech,
    storage: () => null,
    now: () => new Date(2026, 10, 25, 12, 0, 0).getTime(),
  });
  return { controller, speech };
}

/** Lets the opening greeting finish and the next-turn beat pass. */
async function finishOpening(speech: FakeSpeech): Promise<void> {
  await act(async () => {
    speech.finishPlayback();
    await new Promise((resolve) => { setTimeout(resolve, 450); });
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('VoiceConversationBar', () => {
  it('renders nothing while the voice-output switch is off', async () => {
    await act(async () => { await refreshVoiceOutputAvailability(healthFetch(false)); });
    const { controller } = makeController();
    render(<VoiceConversationBar language="ja" controller={controller} />);
    expect(screen.queryByTestId('voice-conversation-bar')).toBeNull();
  });

  it('renders nothing when the browser cannot recognize speech', async () => {
    await act(async () => { await refreshVoiceOutputAvailability(healthFetch(true)); });
    const { controller } = makeController(false);
    render(<VoiceConversationBar language="ja" controller={controller} />);
    expect(screen.queryByTestId('voice-conversation-bar')).toBeNull();
  });

  it('shows a single 「オリンと会話」 entry button that starts the conversation at once', async () => {
    await act(async () => { await refreshVoiceOutputAvailability(healthFetch(true)); });
    const { controller, speech } = makeController();
    render(<VoiceConversationBar language="ja" controller={controller} />);
    const start = screen.getByTestId('voice-conversation-start');
    expect(start.textContent).toContain('オリンと会話');
    expect(screen.queryByTestId('voice-conversation-wake-toggle')).toBeNull();

    fireEvent.click(start);
    expect(controller.getState().mode).toBe('on');
    // Orin opens: the greeting is spoken before any listening.
    expect(speech.spoken).toHaveLength(1);
    expect(screen.getByTestId('voice-conversation-bar').textContent).toContain('オリンが話しています');

    await finishOpening(speech);
    expect(controller.getState().phase).toBe('listening');
    expect(screen.getByTestId('voice-conversation-main').textContent).toContain('話し終える');
    expect(screen.getByTestId('voice-conversation-bar').textContent).toContain('聞き取り中です');
    controller.stopConversation();
  });

  it('tells the owner while listening that 「バイバイ、オリン」 ends the conversation', async () => {
    await act(async () => { await refreshVoiceOutputAvailability(healthFetch(true)); });
    const { controller, speech } = makeController();
    render(<VoiceConversationBar language="ja" controller={controller} />);
    fireEvent.click(screen.getByTestId('voice-conversation-start'));
    await finishOpening(speech);
    expect(controller.getState().phase).toBe('listening');
    expect(screen.getByTestId('voice-conversation-bar').textContent).toContain('バイバイ、オリン');
    controller.stopConversation();
  });

  it('re-arms wake waiting on mount when the stored preference is on, without a greeting', async () => {
    window.localStorage.setItem('origin_voice_wake_waiting', 'on');
    await act(async () => { await refreshVoiceOutputAvailability(healthFetch(true)); });
    const { controller, speech } = makeController();
    render(<VoiceConversationBar language="ja" controller={controller} />);
    expect(controller.getState().mode).toBe('on');
    expect(controller.getState().wakeWaiting).toBe(true);
    expect(controller.getState().phase).toBe('idle');
    expect(speech.spoken).toEqual([]);
    expect(screen.getByTestId('voice-conversation-bar').textContent).toContain('「ハイ、オリン」と呼びかけてください');
    controller.setWakeWaiting(false);
    controller.stopConversation();
  });

  it('arms wake waiting from the toggle inside conversation mode', async () => {
    await act(async () => { await refreshVoiceOutputAvailability(healthFetch(true)); });
    const { controller, speech } = makeController();
    render(<VoiceConversationBar language="ja" controller={controller} />);
    fireEvent.click(screen.getByTestId('voice-conversation-start'));
    await finishOpening(speech);
    const toggle = screen.getByTestId('voice-conversation-wake-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(controller.getState().wakeWaiting).toBe(true);
    controller.stopConversation();
  });
});
