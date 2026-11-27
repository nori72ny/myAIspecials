import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOICE_CONVERSATION_STYLE,
  ORIN_CONVERSATION_CLOSING_TEXT,
  ORIN_CONVERSATION_OPENING_TEXT,
  VoiceConversationController,
  VOICE_CONVERSATION_CLOSING_ID,
  VOICE_CONVERSATION_DAILY_LIMIT,
  VOICE_CONVERSATION_DAILY_STORAGE_KEY,
  VOICE_CONVERSATION_MAX_TURN_SECONDS,
  VOICE_CONVERSATION_NEXT_TURN_DELAY_MS,
  VOICE_CONVERSATION_OPENING_ID,
  type VoiceConversationSpeech,
} from './voiceConversation';
import type {
  SpeechRecognitionEventLike,
  SpeechRecognitionLike,
} from './voiceSpeechRecognition';
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

function setup() {
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
  ctx.controller.notifyAnswerReady('a1', '明日は晴れです。気温は20度です。');
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
    // The 20th turn: heard under the cap, so it is sent and answered.
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

  it('stops wake waiting on a recognizer network failure instead of looping', () => {
    const ctx = setup();
    startToWakeWaiting(ctx);
    ctx.recognitions.at(-1)!.emitError('network');
    expect(ctx.controller.getState().wakeWaiting).toBe(false);
    expect(ctx.controller.getState().notice).toBe('failed');
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
