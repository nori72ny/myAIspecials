import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOICE_CONVERSATION_STYLE,
  ORIN_CONVERSATION_ACK_PHRASES,
  ORIN_CONVERSATION_CLOSING_TEXT,
  ORIN_CONVERSATION_CLOSING_TEXT_ALTER_EGO,
  ORIN_CONVERSATION_OPENING_TEXT,
  ORIN_CONVERSATION_OPENING_TEXT_ALTER_EGO,
  VoiceConversationController,
  VOICE_CONVERSATION_ACK_ID,
  VOICE_CONVERSATION_CLOSING_ID,
  VOICE_CONVERSATION_DAILY_LIMIT,
  VOICE_CONVERSATION_DAILY_STORAGE_KEY,
  VOICE_CONVERSATION_MAX_TURN_SECONDS,
  VOICE_CONVERSATION_NEXT_TURN_DELAY_MS,
  VOICE_CONVERSATION_OPENING_ID,
  VOICE_CONVERSATION_TURN_START_RETRY_DELAYS_MS,
  type VoiceConversationSpeech,
} from './voiceConversation';
import type {
  SpeechRecognitionEventLike,
  SpeechRecognitionLike,
} from './voiceSpeechRecognition';
import type { VoiceConversationStartStyle } from './voiceConversationStartStyle';
import type { VoiceConversationTone } from './voiceConversationTone';
import type { VoiceStorageLike } from './voiceSpeech';

class FakeRecognition implements SpeechRecognitionLike {
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: SpeechRecognitionLike['onresult'] = null;
  onend: SpeechRecognitionLike['onend'] = null;
  onerror: SpeechRecognitionLike['onerror'] = null;
  started = false;
  stopCalls = 0;
  abortCalls = 0;

  start(): void { this.started = true; }
  stop(): void { this.stopCalls += 1; }
  abort(): void { this.abortCalls += 1; }

  emitResult(entries: Array<{ isFinal: boolean; transcript: string }>): void {
    const results = entries.map((entry) => {
      const result: { isFinal: boolean; length: number; [index: number]: { transcript: string } } = {
        isFinal: entry.isFinal,
        length: 1,
      };
      result[0] = { transcript: entry.transcript };
      return result;
    });
    const event: SpeechRecognitionEventLike = { resultIndex: 0, results };
    this.onresult?.(event);
  }

  emitEnd(): void { this.onend?.(); }
  emitError(error: string): void { this.onerror?.({ error }); }
}

class FakeSpeech implements VoiceConversationSpeech {
  spoken: Array<{ id: string; text: string; style?: { rate?: number; pitch?: number } }> = [];
  speakResult = true;
  private activeId: string | null = null;
  private listeners = new Set<() => void>();

  speak(id: string, text: string, style?: { rate?: number; pitch?: number }): boolean {
    this.spoken.push({ id, text, style });
    if (!this.speakResult) return false;
    // The real controller passes through a momentary "no active id"
    // state while replacing playback; reproduce that sequence.
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

function createManualScheduler() {
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextId = 1;
  return {
    schedule: (fn: () => void, ms: number) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { fn, ms });
      return id;
    },
    cancel: (handle: unknown) => { timers.delete(handle as number); },
    fireByMs: (ms: number) => {
      for (const [id, timer] of [...timers]) {
        if (timer.ms === ms) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    pendingMs: () => [...timers.values()].map((timer) => timer.ms),
  };
}

function createMemoryStorage(): VoiceStorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

const FIXED_NOW = new Date(2026, 10, 25, 12, 0, 0).getTime();

function setup(extraDeps: {
  alterEgoActive?: () => boolean;
  startStyle?: VoiceConversationStartStyle | (() => VoiceConversationStartStyle | null);
  conversationTone?: () => VoiceConversationTone | null;
  wakeWaitingPreferred?: () => boolean;
  onWakeWaitingChange?: (enabled: boolean) => void;
} = {}) {
  const recognitions: FakeRecognition[] = [];
  const speech = new FakeSpeech();
  const scheduler = createManualScheduler();
  const storage = createMemoryStorage();
  const sent: string[] = [];
  const controller = new VoiceConversationController({
    createRecognition: () => {
      const recognition = new FakeRecognition();
      recognitions.push(recognition);
      return recognition;
    },
    speech,
    storage: () => storage,
    now: () => FIXED_NOW,
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
    onUtterance: (text) => { sent.push(text); return true; },
    ...extraDeps,
  });
  return { controller, recognitions, speech, scheduler, storage, sent };
}

/** Starts the conversation and plays the opening to its end, so the
 * first listening turn is open. */
function startToListening(ctx: ReturnType<typeof setup>): void {
  ctx.controller.startConversation();
  ctx.speech.finishPlayback();
  ctx.scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
}

/** Drives one full turn: opening, utterance (sent at once by the
 * controller), the chat surface confirming the send, answer. */
function driveTurnToSpeaking(ctx: ReturnType<typeof setup>): void {
  startToListening(ctx);
  const recognition = ctx.recognitions.at(-1)!;
  recognition.emitResult([{ isFinal: true, transcript: '明日の天気は？' }]);
  recognition.emitEnd();
  ctx.controller.notifyUserSent();
  ctx.controller.notifyAnswerReady('a1', '明日は晴れです。 気温は20度です。');
}

/** From a fresh start, burns the silent restarts until the
 * conversation rests at idle with a wake session running. */
function startToWakeWaiting(ctx: ReturnType<typeof setup>): void {
  ctx.controller.setWakeWaiting(true);
  // Opening greeting first, then the first listening turn.
  ctx.speech.finishPlayback();
  ctx.scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
  for (let round = 0; round < 6; round += 1) {
    ctx.recognitions.at(-1)!.emitEnd();
    ctx.scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
  }
}

describe('VoiceConversationController opening', () => {
  it('starts with Orin speaking the opening line, then opens the microphone', () => {
    const { controller, recognitions, speech, scheduler } = setup();
    controller.startConversation();
    expect(controller.getState().mode).toBe('on');
    expect(controller.getState().phase).toBe('speaking');
    expect(speech.spoken).toEqual([{
      id: VOICE_CONVERSATION_OPENING_ID,
      text: ORIN_CONVERSATION_OPENING_TEXT,
      style: DEFAULT_VOICE_CONVERSATION_STYLE,
    }]);
    expect(recognitions).toHaveLength(1); // the probe, not yet started
    expect(recognitions[0]!.started).toBe(false);

    speech.finishPlayback();
    scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    expect(controller.getState().phase).toBe('listening');
    expect(recognitions[0]!.started).toBe(true);
    expect(recognitions[0]!.lang).toBe('ja-JP');
    expect(recognitions[0]!.interimResults).toBe(true);
  });

  it('barges in on the opening: pressing the main button listens at once', () => {
    const { controller, recognitions, speech } = setup();
    controller.startConversation();
    controller.pressMainButton();
    expect(speech.getActiveId()).toBeNull();
    expect(controller.getState().phase).toBe('listening');
    expect(recognitions.at(-1)!.started).toBe(true);
  });

  it('falls back to listening when the opening cannot be spoken', () => {
    const ctx = setup();
    ctx.speech.speakResult = false;
    ctx.controller.startConversation();
    expect(ctx.controller.getState().mode).toBe('on');
    expect(ctx.controller.getState().phase).toBe('listening');
    expect(ctx.recognitions.at(-1)!.started).toBe(true);
  });

  it('does not count the opening toward the daily cap', () => {
    const ctx = setup();
    startToListening(ctx);
    expect(ctx.controller.getState().turnsUsedToday).toBe(0);
  });
});

describe('VoiceConversationController speaking style', () => {
  it('passes a resolver-provided style profile to answer playback', () => {
    const speech = new FakeSpeech();
    const scheduler = createManualScheduler();
    const recognitions: FakeRecognition[] = [];
    const controller = new VoiceConversationController({
      createRecognition: () => {
        const recognition = new FakeRecognition();
        recognitions.push(recognition);
        return recognition;
      },
      speech,
      storage: () => null,
      now: () => FIXED_NOW,
      schedule: scheduler.schedule,
      cancelSchedule: scheduler.cancel,
      styleProfile: () => ({ rate: 1.1, pitch: 0.95 }),
      onUtterance: () => true,
    });
    controller.startConversation();
    expect(speech.spoken.at(-1)?.style).toEqual({ rate: 1.1, pitch: 0.95 });
    speech.finishPlayback();
    scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    recognitions.at(-1)!.emitResult([{ isFinal: true, transcript: '質問です' }]);
    recognitions.at(-1)!.emitEnd();
    controller.notifyUserSent();
    controller.notifyAnswerReady('a1', '答えです。');
    expect(speech.spoken.at(-1)?.style).toEqual({ rate: 1.1, pitch: 0.95 });
    controller.dispose();
  });

  it('falls back to the default profile when the resolver has none yet', () => {
    const speech = new FakeSpeech();
    const controller = new VoiceConversationController({
      createRecognition: () => new FakeRecognition(),
      speech,
      storage: () => null,
      now: () => FIXED_NOW,
      styleProfile: () => null,
    });
    controller.startConversation();
    expect(speech.spoken.at(-1)?.style).toEqual(DEFAULT_VOICE_CONVERSATION_STYLE);
    controller.dispose();
  });
});

describe('VoiceConversationController turn-taking', () => {
  it('sends the final transcript at once and rests until the send is confirmed', () => {
    const ctx = setup();
    startToListening(ctx);
    const recognition = ctx.recognitions.at(-1)!;
    recognition.emitResult([{ isFinal: false, transcript: '明日の' }]);
    expect(ctx.controller.getState().interimText).toBe('明日の');
    recognition.emitResult([{ isFinal: true, transcript: '明日の天気は？' }]);
    recognition.emitEnd();
    // No composer, no send tap: the utterance went straight to the
    // send pipeline, and the floor passes to the answer only when
    // the chat surface confirms (notifyUserSent).
    expect(ctx.sent).toEqual(['明日の天気は？']);
    expect(ctx.controller.getState().phase).toBe('idle');
    expect(ctx.controller.getState().turnsUsedToday).toBe(1);
    ctx.controller.notifyUserSent();
    expect(ctx.controller.getState().phase).toBe('thinking');
  });

  it('speaks the summary of the final answer once the send is confirmed', () => {
    const ctx = setup();
    driveTurnToSpeaking(ctx);
    expect(ctx.controller.getState().phase).toBe('speaking');
    expect(ctx.speech.spoken.at(-1)).toEqual({
      id: 'a1',
      text: '明日は晴れです。 気温は20度です。',
      style: DEFAULT_VOICE_CONVERSATION_STYLE,
    });
  });

  it('keeps the spoken answer short: only the two lead sentences are spoken', () => {
    const ctx = setup();
    startToListening(ctx);
    const recognition = ctx.recognitions.at(-1)!;
    recognition.emitResult([{ isFinal: true, transcript: '詳しく教えて' }]);
    recognition.emitEnd();
    ctx.controller.notifyUserSent();
    ctx.controller.notifyAnswerReady('a9', '結論は晴れです。理由は高気圧です。詳しい予報は本文に書きました。');
    expect(ctx.speech.spoken.at(-1)?.text).toBe('結論は晴れです。 理由は高気圧です。');
  });

  it('hands the floor back shortly after playback ends', () => {
    const ctx = setup();
    driveTurnToSpeaking(ctx);
    const before = ctx.recognitions.length;
    ctx.speech.finishPlayback();
    expect(ctx.controller.getState().phase).toBe('speaking');
    ctx.scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    expect(ctx.controller.getState().phase).toBe('listening');
    expect(ctx.recognitions).toHaveLength(before + 1);
  });

  it('does not mistake the speak() setup transient for finished playback', () => {
    const ctx = setup();
    driveTurnToSpeaking(ctx);
    expect(ctx.scheduler.pendingMs()).toEqual([]);
    expect(ctx.controller.getState().phase).toBe('speaking');
  });

  it('barges in: pressing the main button while speaking stops playback and listens at once', () => {
    const ctx = setup();
    driveTurnToSpeaking(ctx);
    const before = ctx.recognitions.length;
    ctx.controller.pressMainButton();
    expect(ctx.speech.getActiveId()).toBeNull();
    expect(ctx.controller.getState().phase).toBe('listening');
    expect(ctx.recognitions).toHaveLength(before + 1);
    ctx.scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    expect(ctx.recognitions).toHaveLength(before + 1);
  });

  it('finishes listening when the main button is pressed while listening', () => {
    const ctx = setup();
    startToListening(ctx);
    const recognition = ctx.recognitions.at(-1)!;
    recognition.emitResult([{ isFinal: true, transcript: 'ありがとう' }]);
    ctx.controller.pressMainButton();
    expect(recognition.stopCalls).toBe(1);
    recognition.emitEnd();
    expect(ctx.sent).toEqual(['ありがとう']);
    expect(ctx.controller.getState().phase).toBe('idle');
  });

  it('stops the listening turn at the 60 second cap', () => {
    const ctx = setup();
    startToListening(ctx);
    ctx.scheduler.fireByMs(VOICE_CONVERSATION_MAX_TURN_SECONDS * 1000);
    expect(ctx.recognitions.at(-1)!.stopCalls).toBe(1);
  });

  it('reopens the microphone after silence a few times, then rests at idle', () => {
    const ctx = setup();
    startToListening(ctx);
    const sessionsBefore = ctx.recognitions.length;
    for (let round = 0; round < 6; round += 1) {
      ctx.recognitions.at(-1)!.emitEnd();
      ctx.scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    }
    expect(ctx.controller.getState().phase).toBe('idle');
    expect(ctx.recognitions.length).toBe(sessionsBefore + 5); // 5 restarts, then rest
  });

  it('ignores an answer that completes outside the thinking phase', () => {
    const ctx = setup();
    startToListening(ctx);
    const recognition = ctx.recognitions.at(-1)!;
    recognition.emitResult([{ isFinal: true, transcript: '質問です' }]);
    recognition.emitEnd();
    const spokenBefore = ctx.speech.spoken.length;
    ctx.controller.notifyAnswerReady('a1', '答えです。'); // still idle, not thinking
    expect(ctx.speech.spoken).toHaveLength(spokenBefore);
  });

  it('stops everything when the conversation is stopped', () => {
    const ctx = setup();
    driveTurnToSpeaking(ctx);
    ctx.controller.stopConversation();
    expect(ctx.controller.getState().mode).toBe('off');
    expect(ctx.controller.getState().phase).toBe('idle');
    expect(ctx.speech.getActiveId()).toBeNull();
  });
});

describe('VoiceConversationController direct-send loop', () => {
  it('runs turn after turn with no button press anywhere in the loop', () => {
    const ctx = setup();
    startToListening(ctx);
    // Turn 1: speak, and the utterance is sent the moment the turn
    // ends — no pressMainButton, no composer.
    ctx.recognitions.at(-1)!.emitResult([{ isFinal: true, transcript: '明日の天気は？' }]);
    ctx.recognitions.at(-1)!.emitEnd();
    expect(ctx.sent).toEqual(['明日の天気は？']);
    ctx.controller.notifyUserSent(); // the chat surface's glue
    ctx.controller.notifyAnswerReady('a1', '明日は晴れです。');
    expect(ctx.controller.getState().phase).toBe('speaking');
    // Playback ends: the next listening turn opens on its own.
    ctx.speech.finishPlayback();
    ctx.scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    expect(ctx.controller.getState().phase).toBe('listening');
    // Turn 2, exactly the same shape.
    ctx.recognitions.at(-1)!.emitResult([{ isFinal: true, transcript: 'あさっては？' }]);
    ctx.recognitions.at(-1)!.emitEnd();
    expect(ctx.sent).toEqual(['明日の天気は？', 'あさっては？']);
    expect(ctx.controller.getState().turnsUsedToday).toBe(2);
  });

  it('drops the utterance and rests with a notice when the send surface refuses it', () => {
    const recognitions: FakeRecognition[] = [];
    const speech = new FakeSpeech();
    const scheduler = createManualScheduler();
    const attempts: string[] = [];
    const controller = new VoiceConversationController({
      createRecognition: () => {
        const recognition = new FakeRecognition();
        recognitions.push(recognition);
        return recognition;
      },
      speech,
      storage: () => null,
      now: () => FIXED_NOW,
      schedule: scheduler.schedule,
      cancelSchedule: scheduler.cancel,
      onUtterance: (text) => { attempts.push(text); return false; },
    });
    controller.startConversation();
    speech.finishPlayback();
    scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    recognitions.at(-1)!.emitResult([{ isFinal: true, transcript: '聞こえますか' }]);
    recognitions.at(-1)!.emitEnd();
    expect(attempts).toEqual(['聞こえますか']);
    // Not wedged in 'thinking': the conversation rests, tells the
    // owner, and the main button opens the microphone again.
    expect(controller.getState().phase).toBe('idle');
    expect(controller.getState().notice).toBe('failed');
    controller.pressMainButton();
    expect(controller.getState().phase).toBe('listening');
    expect(controller.getState().notice).toBeNull();
    controller.dispose();
  });

  it('never sends when no utterance handler is registered', () => {
    const recognitions: FakeRecognition[] = [];
    const speech = new FakeSpeech();
    const scheduler = createManualScheduler();
    const controller = new VoiceConversationController({
      createRecognition: () => {
        const recognition = new FakeRecognition();
        recognitions.push(recognition);
        return recognition;
      },
      speech,
      storage: () => null,
      now: () => FIXED_NOW,
      schedule: scheduler.schedule,
      cancelSchedule: scheduler.cancel,
    });
    controller.startConversation();
    speech.finishPlayback();
    scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    recognitions.at(-1)!.emitResult([{ isFinal: true, transcript: '質問です' }]);
    recognitions.at(-1)!.emitEnd();
    expect(controller.getState().phase).toBe('idle');
    expect(controller.getState().notice).toBe('failed');
    controller.dispose();
  });
});

describe('VoiceConversationController caps and failures', () => {
  it('refuses to start when the daily limit is already reached', () => {
    const ctx = setup();
    ctx.storage.map.set(
      VOICE_CONVERSATION_DAILY_STORAGE_KEY,
      JSON.stringify({ date: '2026-11-25', count: VOICE_CONVERSATION_DAILY_LIMIT }),
    );
    const controller = new VoiceConversationController({
      createRecognition: () => new FakeRecognition(),
      speech: ctx.speech,
      storage: () => ctx.storage,
      now: () => FIXED_NOW,
      schedule: ctx.scheduler.schedule,
      cancelSchedule: ctx.scheduler.cancel,
    });
    controller.startConversation();
    expect(controller.getState().mode).toBe('off');
    expect(controller.getState().notice).toBe('daily-limit');
    expect(ctx.speech.spoken).toEqual([]);
  });

  it('reports unsupported when the browser has no recognition', () => {
    const controller = new VoiceConversationController({
      createRecognition: () => null,
      speech: new FakeSpeech(),
      storage: () => null,
      now: () => FIXED_NOW,
    });
    controller.startConversation();
    expect(controller.getState().mode).toBe('off');
    expect(controller.getState().notice).toBe('unsupported');
  });

  it('ends the conversation on microphone permission denial', () => {
    const ctx = setup();
    startToListening(ctx);
    ctx.recognitions.at(-1)!.emitError('not-allowed');
    expect(ctx.controller.getState().mode).toBe('off');
    expect(ctx.controller.getState().notice).toBe('permission-denied');
  });

  it('counts only transcript-producing turns toward the daily cap', () => {
    const ctx = setup();
    startToListening(ctx);
    ctx.recognitions.at(-1)!.emitEnd(); // silence
    ctx.scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    expect(ctx.controller.getState().turnsUsedToday).toBe(0);
    ctx.recognitions.at(-1)!.emitResult([{ isFinal: true, transcript: 'はい' }]);
    ctx.recognitions.at(-1)!.emitEnd();
    expect(ctx.controller.getState().turnsUsedToday).toBe(1);
  });

  it('sends the cap-reaching utterance, speaks its answer, then stops reopening the microphone', () => {
    const storage = createMemoryStorage();
    storage.map.set(
      VOICE_CONVERSATION_DAILY_STORAGE_KEY,
      JSON.stringify({ date: '2026-11-25', count: VOICE_CONVERSATION_DAILY_LIMIT - 1 }),
    );
    const recognitions: FakeRecognition[] = [];
    const speech = new FakeSpeech();
    const scheduler = createManualScheduler();
    const sent: string[] = [];
    const controller = new VoiceConversationController({
      createRecognition: () => {
        const recognition = new FakeRecognition();
        recognitions.push(recognition);
        return recognition;
      },
      speech,
      storage: () => storage,
      now: () => FIXED_NOW,
      schedule: scheduler.schedule,
      cancelSchedule: scheduler.cancel,
      onUtterance: (text) => { sent.push(text); return true; },
    });
    controller.startConversation();
    speech.finishPlayback();
    scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    expect(controller.getState().phase).toBe('listening');
    // The 40th turn: heard under the cap, so it is sent and answered.
    recognitions.at(-1)!.emitResult([{ isFinal: true, transcript: '最後の質問です' }]);
    recognitions.at(-1)!.emitEnd();
    expect(sent).toEqual(['最後の質問です']);
    expect(controller.getState().turnsUsedToday).toBe(VOICE_CONVERSATION_DAILY_LIMIT);
    expect(controller.getState().dailyLimitReached).toBe(true);
    controller.notifyUserSent();
    controller.notifyAnswerReady('a1', '答えです。');
    expect(controller.getState().phase).toBe('speaking');
    // After playback, the loop tries to reopen the microphone and
    // is refused: the conversation rests with the limit notice and
    // no new recognition session is started.
    const sessionsBefore = recognitions.length;
    speech.finishPlayback();
    scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    expect(controller.getState().phase).toBe('idle');
    expect(controller.getState().notice).toBe('daily-limit');
    expect(recognitions).toHaveLength(sessionsBefore);
    controller.dispose();
  });
});

/** A setup whose recognizer start() can be made to throw for the
 * next N attempts — the Android shape where the audio path is
 * still busy with the playback that just ended. */
function setupWithStartControl() {
  const recognitions: FakeRecognition[] = [];
  const speech = new FakeSpeech();
  const scheduler = createManualScheduler();
  const sent: string[] = [];
  const control = { failuresQueued: 0, attempts: 0 };
  const controller = new VoiceConversationController({
    createRecognition: () => {
      const recognition = new FakeRecognition();
      const originalStart = recognition.start.bind(recognition);
      recognition.start = () => {
        control.attempts += 1;
        if (control.failuresQueued > 0) {
          control.failuresQueued -= 1;
          throw new Error('InvalidStateError');
        }
        originalStart();
      };
      recognitions.push(recognition);
      return recognition;
    },
    speech,
    storage: () => null,
    now: () => FIXED_NOW,
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
    onUtterance: (text) => { sent.push(text); return true; },
  });
  return { controller, recognitions, speech, scheduler, sent, control };
}

describe('VoiceConversationController turn-start resilience', () => {
  it('recovers when recognizer start() throws right after playback ends (the real-device stall)', () => {
    const ctx = setupWithStartControl();
    ctx.controller.startConversation();
    ctx.speech.finishPlayback();
    ctx.scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    expect(ctx.controller.getState().phase).toBe('listening');
    ctx.recognitions.at(-1)!.emitResult([{ isFinal: true, transcript: '明日の天気は？' }]);
    ctx.recognitions.at(-1)!.emitEnd();
    ctx.controller.notifyUserSent();
    ctx.controller.notifyAnswerReady('a1', '明日は晴れです。');
    expect(ctx.controller.getState().phase).toBe('speaking');
    // Playback ends; the recognizer start for the next turn hits
    // the contended audio path and throws once.
    ctx.control.failuresQueued = 1;
    ctx.speech.finishPlayback();
    ctx.scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    expect(ctx.controller.getState().phase).toBe('listening'); // still claiming the floor
    expect(ctx.recognitions.at(-1)!.started).toBe(false);
    // After the backoff the retry opens the turn and the loop
    // continues hands-free.
    ctx.scheduler.fireByMs(VOICE_CONVERSATION_TURN_START_RETRY_DELAYS_MS[0]);
    expect(ctx.recognitions.at(-1)!.started).toBe(true);
    expect(ctx.controller.getState().phase).toBe('listening');
    ctx.recognitions.at(-1)!.emitResult([{ isFinal: true, transcript: 'あさっては？' }]);
    ctx.recognitions.at(-1)!.emitEnd();
    expect(ctx.sent).toEqual(['明日の天気は？', 'あさっては？']);
    ctx.controller.dispose();
  });

  it('rests with a notice after the start-retry budget is spent instead of looping forever', () => {
    const ctx = setupWithStartControl();
    ctx.controller.startConversation();
    ctx.control.failuresQueued = 99;
    ctx.speech.finishPlayback();
    ctx.scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    for (const delay of VOICE_CONVERSATION_TURN_START_RETRY_DELAYS_MS) {
      ctx.scheduler.fireByMs(delay);
    }
    expect(ctx.controller.getState().phase).toBe('idle');
    expect(ctx.controller.getState().notice).toBe('failed');
    // 1 initial attempt + one per retry delay, then it stops.
    expect(ctx.control.attempts).toBe(1 + VOICE_CONVERSATION_TURN_START_RETRY_DELAYS_MS.length);
    const sessions = ctx.recognitions.length;
    for (const delay of VOICE_CONVERSATION_TURN_START_RETRY_DELAYS_MS) {
      ctx.scheduler.fireByMs(delay);
    }
    expect(ctx.recognitions).toHaveLength(sessions);
    ctx.controller.dispose();
  });

  it('retries a turn session after a transient audio-capture error and keeps what was heard', () => {
    const ctx = setup();
    startToListening(ctx);
    const first = ctx.recognitions.at(-1)!;
    first.emitResult([{ isFinal: true, transcript: '明日の' }]);
    first.emitError('audio-capture');
    // Not failed closed: the floor is still the owner's, and a
    // retry is scheduled instead of a dead 'idle'.
    expect(ctx.controller.getState().phase).toBe('listening');
    expect(ctx.controller.getState().notice).toBeNull();
    ctx.scheduler.fireByMs(VOICE_CONVERSATION_TURN_START_RETRY_DELAYS_MS[0]);
    const retried = ctx.recognitions.at(-1)!;
    expect(retried).not.toBe(first);
    expect(retried.started).toBe(true);
    retried.emitResult([{ isFinal: true, transcript: '天気は？' }]);
    retried.emitEnd();
    expect(ctx.sent).toEqual(['明日の天気は？']);
  });

  it('never retries a permission error: it ends the conversation at once', () => {
    const ctx = setup();
    startToListening(ctx);
    ctx.recognitions.at(-1)!.emitError('not-allowed');
    expect(ctx.controller.getState().mode).toBe('off');
    expect(ctx.controller.getState().notice).toBe('permission-denied');
    expect(ctx.scheduler.pendingMs()).not.toContain(VOICE_CONVERSATION_TURN_START_RETRY_DELAYS_MS[0]);
  });

  it('settles an unspoken answer (research / error) back to listening', () => {
    const ctx = setup();
    startToListening(ctx);
    const recognition = ctx.recognitions.at(-1)!;
    recognition.emitResult([{ isFinal: true, transcript: '調べて教えて' }]);
    recognition.emitEnd();
    ctx.controller.notifyUserSent();
    expect(ctx.controller.getState().phase).toBe('thinking');
    const sessionsBefore = ctx.recognitions.length;
    // The glue reports the completed answer as not speakable:
    // the floor returns instead of 'thinking' holding it forever.
    // Since the speed program (2026-11-28) the return waits for
    // the turn's acknowledgment to finish playing — the microphone
    // never reopens over Orin's own voice — so finish it first.
    ctx.controller.notifyAnswerSettled();
    expect(ctx.controller.getState().phase).toBe('thinking');
    ctx.speech.finishPlayback();
    expect(ctx.controller.getState().phase).toBe('listening');
    expect(ctx.recognitions).toHaveLength(sessionsBefore + 1);
    expect(ctx.recognitions.at(-1)!.started).toBe(true);
  });

  it('ignores a settle outside the thinking phase', () => {
    const ctx = setup();
    startToListening(ctx);
    const sessionsBefore = ctx.recognitions.length;
    ctx.controller.notifyAnswerSettled();
    expect(ctx.controller.getState().phase).toBe('listening');
    expect(ctx.recognitions).toHaveLength(sessionsBefore);
  });
});

describe('VoiceConversationController multi-turn loop', () => {
  it('speaks the summary on the second and third turns too, returning to listening each time', () => {
    const ctx = setup();
    // Turn 1.
    driveTurnToSpeaking(ctx);
    expect(ctx.speech.spoken.at(-1)?.text).toBe('明日は晴れです。 気温は20度です。');
    ctx.speech.finishPlayback();
    ctx.scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    expect(ctx.controller.getState().phase).toBe('listening');
    // Turn 2: a fresh recognition session serves the next turn.
    const second = ctx.recognitions.at(-1)!;
    second.emitResult([{ isFinal: true, transcript: '明後日は？' }]);
    second.emitEnd();
    ctx.controller.notifyUserSent();
    ctx.controller.notifyAnswerReady('a2', '明後日は雨です。気温は18度です。');
    expect(ctx.controller.getState().phase).toBe('speaking');
    expect(ctx.speech.spoken.at(-1)?.text).toBe('明後日は雨です。 気温は18度です。');
    ctx.speech.finishPlayback();
    ctx.scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    expect(ctx.controller.getState().phase).toBe('listening');
    // Turn 3.
    const third = ctx.recognitions.at(-1)!;
    third.emitResult([{ isFinal: true, transcript: '週末は？' }]);
    third.emitEnd();
    ctx.controller.notifyUserSent();
    ctx.controller.notifyAnswerReady('a3', '週末は曇りです。気温は15度です。');
    expect(ctx.speech.spoken.at(-1)?.text).toBe('週末は曇りです。 気温は15度です。');
  });
});

describe('VoiceConversationController tone phrasing', () => {
  /** One full turn ending with the given answer; returns the
   * spoken summary text. */
  function spokenSummaryFor(ctx: ReturnType<typeof setup>, answer: string): string {
    startToListening(ctx);
    const recognition = ctx.recognitions.at(-1)!;
    recognition.emitResult([{ isFinal: true, transcript: '明日の天気は？' }]);
    recognition.emitEnd();
    ctx.controller.notifyUserSent();
    ctx.controller.notifyAnswerReady('a1', answer);
    return ctx.speech.spoken.at(-1)!.text;
  }

  it('speaks the summary in the strong tone\u2019s phrasing', () => {
    const ctx = setup({ conversationTone: () => 'strong' });
    expect(spokenSummaryFor(ctx, '明日は晴れです。 気温は20度です。'))
      .toBe('明日は晴れだ。 気温は20度だ。');
  });

  it('speaks the summary in the gentle tone\u2019s phrasing', () => {
    const ctx = setup({ conversationTone: () => 'gentle' });
    expect(spokenSummaryFor(ctx, '明日は晴れです。'))
      .toBe('明日は晴れですよ。');
  });

  it('alter-ego mode outranks the tone phrasing: the persona\u2019s own words are spoken as-is', () => {
    const ctx = setup({ conversationTone: () => 'strong', alterEgoActive: () => true });
    expect(spokenSummaryFor(ctx, '明日は晴れです。 気温は20度です。'))
      .toBe('明日は晴れです。 気温は20度です。');
  });

  it('without a tone resolver the summary keeps the answer\u2019s phrasing', () => {
    const ctx = setup();
    expect(spokenSummaryFor(ctx, '明日は晴れです。 気温は20度です。'))
      .toBe('明日は晴れです。 気温は20度です。');
  });
});

describe('VoiceConversationController start style', () => {
  it('listen style: no greeting — the microphone opens at once', () => {
    const ctx = setup({ startStyle: 'listen' });
    ctx.controller.startConversation();
    expect(ctx.controller.getState().mode).toBe('on');
    expect(ctx.controller.getState().phase).toBe('listening');
    expect(ctx.speech.spoken).toEqual([]);
    expect(ctx.recognitions[0]!.started).toBe(true);
  });

  it('greeting style stays the default when the resolver returns null', () => {
    const ctx = setup({ startStyle: () => null });
    ctx.controller.startConversation();
    expect(ctx.controller.getState().phase).toBe('speaking');
    expect(ctx.speech.spoken[0]?.text).toBe(ORIN_CONVERSATION_OPENING_TEXT);
  });

  it('consults the choice at each start: switching to listen drops the greeting next time', () => {
    let style: VoiceConversationStartStyle = 'greeting';
    const ctx = setup({ startStyle: () => style });
    ctx.controller.startConversation();
    expect(ctx.speech.spoken[0]?.text).toBe(ORIN_CONVERSATION_OPENING_TEXT);
    ctx.controller.stopConversation();
    style = 'listen';
    ctx.controller.startConversation();
    expect(ctx.controller.getState().phase).toBe('listening');
    expect(ctx.speech.spoken).toHaveLength(1); // still only the first greeting
  });

  it('listen style with wake waiting: rests into wake sessions without a greeting', () => {
    const ctx = setup({ startStyle: 'listen' });
    ctx.controller.setWakeWaiting(true);
    expect(ctx.controller.getState().mode).toBe('on');
    expect(ctx.controller.getState().wakeWaiting).toBe(true);
    expect(ctx.controller.getState().phase).toBe('idle');
    expect(ctx.speech.spoken).toEqual([]);
    expect(ctx.recognitions.at(-1)!.started).toBe(true); // a wake session
  });
});

describe('VoiceConversationController alter-ego fixed lines', () => {
  it('speaks the alter-ego opening and closing while the mode is on', () => {
    const ctx = setup({ alterEgoActive: () => true });
    startToListening(ctx);
    expect(ctx.speech.spoken[0]).toEqual({
      id: VOICE_CONVERSATION_OPENING_ID,
      text: ORIN_CONVERSATION_OPENING_TEXT_ALTER_EGO,
      style: DEFAULT_VOICE_CONVERSATION_STYLE,
    });
    const recognition = ctx.recognitions.at(-1)!;
    recognition.emitResult([{ isFinal: true, transcript: 'バイバイ、オリン' }]);
    recognition.emitEnd();
    expect(ctx.controller.getState().mode).toBe('off');
    expect(ctx.speech.spoken.at(-1)).toEqual({
      id: VOICE_CONVERSATION_CLOSING_ID,
      text: ORIN_CONVERSATION_CLOSING_TEXT_ALTER_EGO,
      style: DEFAULT_VOICE_CONVERSATION_STYLE,
    });
  });

  it('consults the mode at each playback: a toggle flipped mid-conversation changes the closing line', () => {
    let alterEgo = false;
    const ctx = setup({ alterEgoActive: () => alterEgo });
    startToListening(ctx);
    expect(ctx.speech.spoken[0]?.text).toBe(ORIN_CONVERSATION_OPENING_TEXT);
    alterEgo = true;
    const recognition = ctx.recognitions.at(-1)!;
    recognition.emitResult([{ isFinal: true, transcript: 'バイバイ、オリン' }]);
    recognition.emitEnd();
    expect(ctx.speech.spoken.at(-1)?.text).toBe(ORIN_CONVERSATION_CLOSING_TEXT_ALTER_EGO);
  });

  it('keeps the default lines while the mode is off', () => {
    const ctx = setup({ alterEgoActive: () => false });
    startToListening(ctx);
    expect(ctx.speech.spoken[0]?.text).toBe(ORIN_CONVERSATION_OPENING_TEXT);
    const recognition = ctx.recognitions.at(-1)!;
    recognition.emitResult([{ isFinal: true, transcript: 'バイバイ、オリン' }]);
    recognition.emitEnd();
    expect(ctx.speech.spoken.at(-1)?.text).toBe(ORIN_CONVERSATION_CLOSING_TEXT);
  });
});

describe('VoiceConversationController end phrase', () => {
  it('ends the conversation on the end phrase: nothing sent, nothing counted, closing line spoken', () => {
    const ctx = setup();
    startToListening(ctx);
    const recognition = ctx.recognitions.at(-1)!;
    recognition.emitResult([{ isFinal: true, transcript: 'バイバイ、オリン' }]);
    recognition.emitEnd();
    expect(ctx.sent).toEqual([]);
    expect(ctx.controller.getState().turnsUsedToday).toBe(0);
    expect(ctx.controller.getState().mode).toBe('off');
    expect(ctx.controller.getState().phase).toBe('idle');
    expect(ctx.controller.getState().wakeWaiting).toBe(false);
    expect(ctx.speech.spoken.at(-1)).toEqual({
      id: VOICE_CONVERSATION_CLOSING_ID,
      text: ORIN_CONVERSATION_CLOSING_TEXT,
      style: DEFAULT_VOICE_CONVERSATION_STYLE,
    });
  });

  it('does not reopen the microphone when the closing line finishes playing', () => {
    const ctx = setup();
    startToListening(ctx);
    const sessionsBefore = ctx.recognitions.length;
    ctx.recognitions.at(-1)!.emitResult([{ isFinal: true, transcript: 'バイバイ、オリン' }]);
    ctx.recognitions.at(-1)!.emitEnd();
    ctx.speech.finishPlayback();
    ctx.scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    expect(ctx.recognitions).toHaveLength(sessionsBefore);
    expect(ctx.controller.getState().mode).toBe('off');
  });

  it('ends on spelling variants of the phrase', () => {
    for (const heard of ['バイバイ オリン', 'ばいばいおりん', 'バイバイ、オリン。']) {
      const ctx = setup();
      startToListening(ctx);
      ctx.recognitions.at(-1)!.emitResult([{ isFinal: true, transcript: heard }]);
      ctx.recognitions.at(-1)!.emitEnd();
      expect(ctx.sent).toEqual([]);
      expect(ctx.controller.getState().mode).toBe('off');
      ctx.controller.dispose();
    }
  });

  it('ends when a short farewell follows the phrase', () => {
    const ctx = setup();
    startToListening(ctx);
    ctx.recognitions.at(-1)!.emitResult([{ isFinal: true, transcript: 'バイバイ、オリン、ありがとう' }]);
    ctx.recognitions.at(-1)!.emitEnd();
    expect(ctx.sent).toEqual([]);
    expect(ctx.controller.getState().turnsUsedToday).toBe(0);
    expect(ctx.controller.getState().mode).toBe('off');
  });

  it('sends the shorter 「バイ、オリン」 as an ordinary utterance', () => {
    const ctx = setup();
    startToListening(ctx);
    ctx.recognitions.at(-1)!.emitResult([{ isFinal: true, transcript: 'バイ、オリン' }]);
    ctx.recognitions.at(-1)!.emitEnd();
    expect(ctx.sent).toEqual(['バイ、オリン']);
    expect(ctx.controller.getState().mode).toBe('on');
    expect(ctx.controller.getState().turnsUsedToday).toBe(1);
  });

  it('sends an utterance that merely mentions the phrase, as usual', () => {
    const ctx = setup();
    startToListening(ctx);
    ctx.recognitions.at(-1)!.emitResult([{ isFinal: true, transcript: 'バイバイ、オリンってどういう意味？' }]);
    ctx.recognitions.at(-1)!.emitEnd();
    expect(ctx.sent).toEqual(['バイバイ、オリンってどういう意味？']);
    expect(ctx.controller.getState().mode).toBe('on');
    expect(ctx.controller.getState().turnsUsedToday).toBe(1);
  });

  it('ignores the end phrase heard outside a conversation (wake waiting)', () => {
    const ctx = setup();
    startToWakeWaiting(ctx);
    expect(ctx.controller.getState().phase).toBe('idle');
    const spokenBefore = ctx.speech.spoken.length;
    ctx.recognitions.at(-1)!.emitResult([{ isFinal: true, transcript: 'バイバイ、オリン' }]);
    ctx.recognitions.at(-1)!.emitEnd();
    expect(ctx.sent).toEqual([]);
    expect(ctx.controller.getState().mode).toBe('on');
    expect(ctx.controller.getState().wakeWaiting).toBe(true);
    expect(ctx.speech.spoken).toHaveLength(spokenBefore); // no closing line
  });
});

describe('VoiceConversationController wake phrase', () => {
  it('greets first even with wake waiting on, then waits for the phrase at rest', () => {
    const ctx = setup();
    ctx.controller.setWakeWaiting(true);
    expect(ctx.controller.getState().mode).toBe('on');
    expect(ctx.controller.getState().wakeWaiting).toBe(true);
    // Orin opens; wake waiting does not hold the start back.
    expect(ctx.controller.getState().phase).toBe('speaking');
    expect(ctx.speech.spoken.at(-1)?.id).toBe(VOICE_CONVERSATION_OPENING_ID);
    ctx.speech.finishPlayback();
    ctx.scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    expect(ctx.controller.getState().phase).toBe('listening');
  });

  it('discards non-wake speech at rest and starts a turn on the phrase', () => {
    const ctx = setup();
    startToWakeWaiting(ctx);
    expect(ctx.controller.getState().phase).toBe('idle');
    const wakeSession = ctx.recognitions.at(-1)!;

    wakeSession.emitResult([{ isFinal: true, transcript: '今日はいい天気ですね' }]);
    wakeSession.emitEnd();
    expect(ctx.sent).toEqual([]);
    ctx.scheduler.fireByMs(300);
    const nextWakeSession = ctx.recognitions.at(-1)!;
    expect(nextWakeSession).not.toBe(wakeSession);

    nextWakeSession.emitResult([{ isFinal: true, transcript: 'ハイ、オリン、明日の天気を教えて' }]);
    expect(ctx.controller.getState().phase).toBe('listening');
    ctx.recognitions.at(-1)!.emitEnd();
    expect(ctx.sent).toEqual(['明日の天気を教えて']);
    expect(ctx.controller.getState().phase).toBe('idle');
  });

  it('keeps wake waiting across a recognizer network failure and reopens with backoff', () => {
    const ctx = setup();
    startToWakeWaiting(ctx);
    const failedSession = ctx.recognitions.at(-1)!;
    failedSession.emitError('network');
    // Standby stays armed (the former fail-closed disarm silently
    // killed the wake phrase on the owner's device); the reopen
    // waits out the first backoff step instead of hot-looping.
    expect(ctx.controller.getState().wakeWaiting).toBe(true);
    expect(ctx.controller.getState().notice).toBeNull();
    expect(ctx.recognitions.at(-1)).toBe(failedSession);
    // The reopen is scheduled at the first backoff step (1000ms),
    // not fired by the shorter wake restart delay.
    expect(ctx.scheduler.pendingMs()).toContain(1000);
    ctx.scheduler.fireByMs(300);
    expect(ctx.recognitions.at(-1)).toBe(failedSession);
    ctx.scheduler.fireByMs(1000);
    const reopened = ctx.recognitions.at(-1)!;
    expect(reopened).not.toBe(failedSession);
    expect(reopened.started).toBe(true);
    // A second consecutive failure widens the backoff; a normal
    // end resets it, and the phrase still starts a turn.
    reopened.emitError('audio-capture');
    ctx.scheduler.fireByMs(1000);
    expect(ctx.recognitions.at(-1)).toBe(reopened);
    ctx.scheduler.fireByMs(3000);
    const third = ctx.recognitions.at(-1)!;
    expect(third).not.toBe(reopened);
    third.emitResult([{ isFinal: true, transcript: 'ハイ、オリン' }]);
    expect(ctx.controller.getState().phase).toBe('listening');
  });

  it('surfaces a notice after repeated wake failures but keeps standby armed', () => {
    const ctx = setup();
    startToWakeWaiting(ctx);
    ctx.recognitions.at(-1)!.emitError('network');
    ctx.scheduler.fireByMs(1000);
    ctx.recognitions.at(-1)!.emitError('network');
    ctx.scheduler.fireByMs(3000);
    ctx.recognitions.at(-1)!.emitError('network');
    expect(ctx.controller.getState().wakeWaiting).toBe(true);
    expect(ctx.controller.getState().notice).toBe('failed');
    // Still retrying at the capped delay — recovery needs no touch.
    ctx.scheduler.fireByMs(10000);
    expect(ctx.recognitions.at(-1)!.started).toBe(true);
  });

  it('reopens the wake session when its start throws instead of sitting armed but dead', () => {
    const ctx = setupWithStartControl();
    ctx.controller.setWakeWaiting(true);
    ctx.speech.finishPlayback();
    ctx.scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    for (let round = 0; round < 6; round += 1) {
      ctx.recognitions.at(-1)!.emitEnd();
      ctx.scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    }
    expect(ctx.controller.getState().phase).toBe('idle');
    // The next wake opening throws once: standby must schedule a
    // retry rather than die with the toggle still on.
    ctx.control.failuresQueued = 1;
    ctx.recognitions.at(-1)!.emitEnd();
    const attemptsBefore = ctx.control.attempts;
    ctx.scheduler.fireByMs(300); // normal wake restart: start throws
    expect(ctx.controller.getState().wakeWaiting).toBe(true);
    ctx.scheduler.fireByMs(1000); // backoff retry: start succeeds
    expect(ctx.control.attempts).toBeGreaterThan(attemptsBefore);
    expect(ctx.recognitions.at(-1)!.started).toBe(true);
  });

  it('persists the wake toggle through the change callback', () => {
    const changes: boolean[] = [];
    const ctx = setup({ onWakeWaitingChange: (enabled) => { changes.push(enabled); } });
    ctx.controller.setWakeWaiting(true);
    ctx.controller.setWakeWaiting(false);
    expect(changes).toEqual([true, false]);
  });

  it('a microphone permission failure disarms standby and clears the stored preference', () => {
    const changes: boolean[] = [];
    const ctx = setup({ onWakeWaitingChange: (enabled) => { changes.push(enabled); } });
    startToWakeWaiting(ctx);
    ctx.recognitions.at(-1)!.emitError('not-allowed');
    expect(ctx.controller.getState().wakeWaiting).toBe(false);
    expect(ctx.controller.getState().notice).toBe('permission-denied');
    expect(changes).toEqual([true, false]);
  });

  it('ending a conversation rests back into standby while the preference is on', () => {
    const ctx = setup({ wakeWaitingPreferred: () => true });
    startToListening(ctx);
    ctx.controller.stopConversation();
    expect(ctx.controller.getState().mode).toBe('on');
    expect(ctx.controller.getState().wakeWaiting).toBe(true);
    expect(ctx.controller.getState().phase).toBe('idle');
    expect(ctx.recognitions.at(-1)!.started).toBe(true); // a wake session
  });

  it('restoreWakeWaiting arms standby silently (no greeting) and is idempotent', () => {
    const ctx = setup();
    ctx.controller.restoreWakeWaiting();
    expect(ctx.controller.getState().mode).toBe('on');
    expect(ctx.controller.getState().wakeWaiting).toBe(true);
    expect(ctx.controller.getState().phase).toBe('idle');
    expect(ctx.speech.spoken).toEqual([]);
    const session = ctx.recognitions.at(-1)!;
    expect(session.started).toBe(true);
    ctx.controller.restoreWakeWaiting();
    expect(ctx.recognitions.at(-1)).toBe(session);
  });

  it('turning wake waiting off aborts the wake session', () => {
    const ctx = setup();
    startToWakeWaiting(ctx);
    const wakeSession = ctx.recognitions.at(-1)!;
    ctx.controller.setWakeWaiting(false);
    expect(wakeSession.abortCalls).toBe(1);
    expect(ctx.controller.getState().wakeWaiting).toBe(false);
  });
});
describe('immediate acknowledgment (speed program 2026-11-28)', () => {
  function setupAck(options: { accepted?: boolean; ackPhrases?: readonly string[] } = {}) {
    const recognitions: FakeRecognition[] = [];
    const speech = new FakeSpeech();
    const scheduler = createManualScheduler();
    const storage = createMemoryStorage();
    const sent: string[] = [];
    const controller = new VoiceConversationController({
      createRecognition: () => {
        const recognition = new FakeRecognition();
        recognitions.push(recognition);
        return recognition;
      },
      speech,
      storage: () => storage,
      now: () => FIXED_NOW,
      schedule: scheduler.schedule,
      cancelSchedule: scheduler.cancel,
      onUtterance: (text) => { sent.push(text); return options.accepted ?? true; },
      ...(options.ackPhrases !== undefined ? { ackPhrases: options.ackPhrases } : {}),
    });
    return { controller, recognitions, speech, scheduler, storage, sent };
  }

  function speakTurn(ctx: ReturnType<typeof setupAck>, transcript = '明日の天気は？'): void {
    startToListening(ctx);
    const recognition = ctx.recognitions.at(-1)!;
    recognition.emitResult([{ isFinal: true, transcript }]);
    recognition.emitEnd();
  }

  it('speaks a fixed acknowledgment the moment a turn is accepted, before the answer', () => {
    const ctx = setupAck();
    speakTurn(ctx);
    const ack = ctx.speech.spoken.find((entry) => entry.id === VOICE_CONVERSATION_ACK_ID);
    expect(ack?.text).toBe(ORIN_CONVERSATION_ACK_PHRASES[0]);
    ctx.controller.notifyUserSent();
    ctx.controller.notifyAnswerReady('a1', '明日は晴れです。気温は20度です。');
    expect(ctx.speech.spoken.some((entry) => entry.id === 'a1')).toBe(true);
    expect(ctx.controller.getState().phase).toBe('speaking');
  });

  it('rotates the acknowledgment lines across turns', () => {
    const ctx = setupAck();
    speakTurn(ctx);
    ctx.speech.finishPlayback();
    ctx.controller.notifyUserSent();
    ctx.controller.notifyAnswerReady('a1', '明日は晴れです。');
    ctx.speech.finishPlayback();
    ctx.scheduler.fireByMs(VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
    const recognition = ctx.recognitions.at(-1)!;
    recognition.emitResult([{ isFinal: true, transcript: 'ありがとう' }]);
    recognition.emitEnd();
    const acks = ctx.speech.spoken.filter((entry) => entry.id === VOICE_CONVERSATION_ACK_ID);
    expect(acks.map((entry) => entry.text)).toEqual([ORIN_CONVERSATION_ACK_PHRASES[0], ORIN_CONVERSATION_ACK_PHRASES[1]]);
  });

  it('does not acknowledge a refused utterance', () => {
    const ctx = setupAck({ accepted: false });
    speakTurn(ctx);
    expect(ctx.speech.spoken.some((entry) => entry.id === VOICE_CONVERSATION_ACK_ID)).toBe(false);
  });

  it('does not acknowledge the end phrase', () => {
    const ctx = setupAck();
    speakTurn(ctx, 'バイバイ、オリン');
    expect(ctx.speech.spoken.some((entry) => entry.id === VOICE_CONVERSATION_ACK_ID)).toBe(false);
    expect(ctx.speech.spoken.some((entry) => entry.id === VOICE_CONVERSATION_CLOSING_ID)).toBe(true);
  });

  it('stays silent when the acknowledgment is disabled', () => {
    const ctx = setupAck({ ackPhrases: [] });
    speakTurn(ctx);
    expect(ctx.speech.spoken.some((entry) => entry.id === VOICE_CONVERSATION_ACK_ID)).toBe(false);
  });

  it('defers the floor return until the acknowledgment finishes', () => {
    const ctx = setupAck();
    speakTurn(ctx);
    ctx.controller.notifyUserSent();
    const sessionsBefore = ctx.recognitions.length;
    ctx.controller.notifyAnswerSettled();
    // The acknowledgment is still playing: the microphone must not
    // reopen over Orin's own voice.
    expect(ctx.recognitions.length).toBe(sessionsBefore);
    expect(ctx.controller.getState().phase).toBe('thinking');
    ctx.speech.finishPlayback();
    expect(ctx.recognitions.length).toBe(sessionsBefore + 1);
    expect(ctx.controller.getState().phase).toBe('listening');
  });
});
