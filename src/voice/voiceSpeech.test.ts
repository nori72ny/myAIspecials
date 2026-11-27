import { describe, expect, it, vi } from 'vitest';
import {
  resolveVoiceSpeechRateStep,
  speechSettleWatchdogMs,
  splitSpeechSentences,
  toSpeechText,
  voiceGenderFromName,
  voiceSpeechRateForStep,
  VoiceSpeechController,
  VOICE_OUTPUT_RATE_STORAGE_KEY,
  VOICE_OUTPUT_VOICE_URI_STORAGE_KEY,
  VOICE_SPEECH_RATE_STEPS,
  type SpeechSynthesisLike,
  type SpeechUtteranceLike,
  type SpeechVoiceLike,
  type VoiceSpeechTimers,
  type VoiceStorageLike,
} from './voiceSpeech';

class FakeUtterance implements SpeechUtteranceLike {
  lang = '';
  rate = 1;
  pitch = 1;
  voice: SpeechVoiceLike | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}

class FakeSynthesis implements SpeechSynthesisLike {
  spoken: FakeUtterance[] = [];
  cancelCalls = 0;
  private voicesChangedListeners = new Set<() => void>();
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
  addEventListener(_type: 'voiceschanged', listener: () => void): void {
    this.voicesChangedListeners.add(listener);
  }
  removeEventListener(_type: 'voiceschanged', listener: () => void): void {
    this.voicesChangedListeners.delete(listener);
  }
  fireVoicesChanged(): void {
    this.voicesChangedListeners.forEach((listener) => listener());
  }
  get voicesChangedListenerCount(): number {
    return this.voicesChangedListeners.size;
  }
}

class FakeStorage implements VoiceStorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const KYOKO: SpeechVoiceLike = { voiceURI: 'kyoko-uri', name: 'Kyoko', lang: 'ja-JP', localService: true };
const ICHIRO: SpeechVoiceLike = { voiceURI: 'ichiro-uri', name: 'Microsoft Ichiro', lang: 'ja-JP', localService: false };
const GOOGLE_JA: SpeechVoiceLike = { voiceURI: 'google-ja-uri', name: 'Google 日本語', lang: 'ja-JP', localService: false };
const ENGLISH: SpeechVoiceLike = { voiceURI: 'en-uri', name: 'Samantha', lang: 'en-US', localService: true };

function makeController(voices: SpeechVoiceLike[] = [KYOKO, ICHIRO, GOOGLE_JA, ENGLISH]) {
  const synthesis = new FakeSynthesis(voices);
  const storage = new FakeStorage();
  const controller = new VoiceSpeechController({
    synthesis: () => synthesis,
    createUtterance: (text) => new FakeUtterance(text),
    storage: () => storage,
  });
  return { controller, synthesis, storage };
}

describe('toSpeechText', () => {
  it('flattens Markdown into speakable text', () => {
    const spoken = toSpeechText('## 見出し\n\n**大切**なのは[こちら](https://example.com)です。\n\n```ts\nconst x = 1;\n```\n\n- 項目1\n- 項目2');
    expect(spoken).toContain('見出し');
    expect(spoken).toContain('大切なのはこちらです。');
    expect(spoken).not.toContain('const x');
    expect(spoken).not.toContain('https://');
    expect(spoken).not.toContain('**');
    expect(spoken).toContain('項目1');
  });

  it('turns table pipes into pauses and drops separator rows', () => {
    const spoken = toSpeechText('| 項目 | 値 |\n| --- | --- |\n| 人口 | 1.25億 |');
    expect(spoken).not.toContain('|');
    expect(spoken).not.toContain('---');
    expect(spoken).toContain('人口 、 1.25億');
  });
});

describe('splitSpeechSentences', () => {
  it('splits on Japanese sentence terminators', () => {
    expect(splitSpeechSentences('一つ目です。二つ目です！三つ目ですか？'))
      .toEqual(['一つ目です。', '二つ目です！', '三つ目ですか？']);
  });

  it('never splits decimals or version numbers', () => {
    expect(splitSpeechSentences('金利は1.25%です。版は2.0です'))
      .toEqual(['金利は1.25%です。', '版は2.0です']);
    expect(splitSpeechSentences('The rate is 1.25 percent. Done.'))
      .toEqual(['The rate is 1.25 percent.', 'Done.']);
  });

  it('treats newlines as sentence boundaries', () => {
    expect(splitSpeechSentences('一行目\n二行目')).toEqual(['一行目', '二行目']);
  });

  it('breaks over-long sentences at commas', () => {
    const long = `あ${'、い'.repeat(150)}`;
    const chunks = splitSpeechSentences(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 180)).toBe(true);
    expect(chunks.join('')).toBe(long);
  });
});

describe('voiceGenderFromName', () => {
  it('labels only the well-known Japanese voice names', () => {
    expect(voiceGenderFromName('Kyoko')).toBe('female');
    expect(voiceGenderFromName('Microsoft Ayumi')).toBe('female');
    expect(voiceGenderFromName('Google 日本語')).toBe('female');
    expect(voiceGenderFromName('Microsoft Ichiro')).toBe('male');
    expect(voiceGenderFromName('Otoya')).toBe('male');
    expect(voiceGenderFromName('Samantha')).toBeNull();
    expect(voiceGenderFromName('Some Unknown Voice')).toBeNull();
  });
});

describe('VoiceSpeechController', () => {
  it('lists Japanese voices with on-device voices first and gender labels attached', () => {
    const { controller } = makeController();
    const voices = controller.listJapaneseVoices();
    expect(voices.map((voice) => voice.voiceURI)).toEqual(['kyoko-uri', 'google-ja-uri', 'ichiro-uri']);
    expect(voices[0]).toMatchObject({ gender: 'female', localService: true });
    expect(voices[1]).toMatchObject({ gender: 'female', localService: false });
    expect(voices[2]).toMatchObject({ gender: 'male', localService: false });
  });

  it('speaks sentence by sentence with the selected voice and stored rate', () => {
    const { controller, synthesis, storage } = makeController();
    controller.selectVoice('ichiro-uri');
    controller.setRate(1.25);
    expect(storage.getItem(VOICE_OUTPUT_VOICE_URI_STORAGE_KEY)).toBe('ichiro-uri');
    expect(storage.getItem(VOICE_OUTPUT_RATE_STORAGE_KEY)).toBe('1.25');

    expect(controller.speak('msg-1', '一つ目です。二つ目です。')).toBe(true);
    expect(controller.getActiveId()).toBe('msg-1');
    expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual(['一つ目です。', '二つ目です。']);
    expect(synthesis.spoken[0]?.voice?.voiceURI).toBe('ichiro-uri');
    expect(synthesis.spoken[0]?.rate).toBe(1.25);
    expect(synthesis.spoken[0]?.lang).toBe('ja-JP');

    synthesis.spoken[0]?.onend?.();
    expect(controller.getActiveId()).toBe('msg-1');
    synthesis.spoken[1]?.onend?.();
    expect(controller.getActiveId()).toBeNull();
  });

  it('defaults to the first known male Japanese voice and rate 1.0', () => {
    const { controller, synthesis } = makeController();
    expect(controller.getRate()).toBe(1.0);
    expect(controller.speak('msg-1', 'こんにちは。')).toBe(true);
    expect(synthesis.spoken[0]?.voice?.voiceURI).toBe('ichiro-uri');
    expect(synthesis.spoken[0]?.rate).toBe(1.0);
    expect(synthesis.spoken[0]?.pitch).toBe(1.0);
  });

  it('falls back to the first on-device Japanese voice when none is known male', () => {
    const { controller, synthesis } = makeController([KYOKO, GOOGLE_JA, ENGLISH]);
    expect(controller.speak('msg-1', 'こんにちは。')).toBe(true);
    expect(synthesis.spoken[0]?.voice?.voiceURI).toBe('kyoko-uri');
  });

  it('applies a per-call style override without touching stored settings', () => {
    const { controller, synthesis, storage } = makeController();
    controller.setRate(1.25);
    expect(controller.speak('msg-1', 'こんにちは。', { pitch: 1.05 })).toBe(true);
    expect(synthesis.spoken[0]?.rate).toBe(1.25); // stored rate still applies
    expect(synthesis.spoken[0]?.pitch).toBe(1.05);
    expect(controller.speak('msg-2', 'こんにちは。', { rate: 0.9, pitch: 0.95 })).toBe(true);
    expect(synthesis.spoken[1]?.rate).toBe(0.9);
    expect(synthesis.spoken[1]?.pitch).toBe(0.95);
    expect(storage.getItem(VOICE_OUTPUT_RATE_STORAGE_KEY)).toBe('1.25'); // unchanged
    expect(controller.speak('msg-3', 'こんにちは。', { pitch: 99 })).toBe(true);
    expect(synthesis.spoken[2]?.pitch).toBe(2.0); // clamped to the platform range
  });

  it('stop cancels synthesis and clears the active playback', () => {
    const { controller, synthesis } = makeController();
    controller.speak('msg-1', '読み上げます。');
    expect(controller.getActiveId()).toBe('msg-1');
    controller.stop();
    expect(synthesis.cancelCalls).toBeGreaterThan(0);
    expect(controller.getActiveId()).toBeNull();
    // A late onend from the cancelled playback must not disturb state.
    synthesis.spoken[0]?.onend?.();
    expect(controller.getActiveId()).toBeNull();
  });

  it('starting a new playback replaces the current one', () => {
    const { controller, synthesis } = makeController();
    controller.speak('msg-1', '前のです。');
    controller.speak('msg-2', '次です。');
    expect(controller.getActiveId()).toBe('msg-2');
    expect(synthesis.spoken.at(-1)?.text).toBe('次です。');
  });

  it('previews a voice with the fixed sample line', () => {
    const { controller, synthesis } = makeController();
    expect(controller.preview('ichiro-uri')).toBe(true);
    expect(synthesis.spoken).toHaveLength(1);
    expect(synthesis.spoken[0]?.text).toContain('オリンです');
    expect(synthesis.spoken[0]?.voice?.voiceURI).toBe('ichiro-uri');
    synthesis.spoken[0]?.onend?.();
    expect(controller.getActiveId()).toBeNull();
    expect(controller.preview('missing-uri')).toBe(false);
  });

  it('persists the voice choice and rate across controller instances', () => {
    const { controller, storage } = makeController();
    controller.selectVoice('google-ja-uri');
    controller.setRate(3);
    const next = new VoiceSpeechController({
      synthesis: () => null,
      createUtterance: (text) => new FakeUtterance(text),
      storage: () => storage,
    });
    expect(next.getSelectedVoiceURI()).toBe('google-ja-uri');
    expect(next.getRate()).toBe(2.0);
    controller.selectVoice(null);
    expect(next.getSelectedVoiceURI()).toBeNull();
  });

  it('notifies voice subscribers on voiceschanged and unsubscribes cleanly', () => {
    const { controller, synthesis } = makeController();
    const listener = vi.fn();
    const unsubscribe = controller.subscribeVoices(listener);
    expect(synthesis.voicesChangedListenerCount).toBe(1);
    synthesis.fireVoicesChanged();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(synthesis.voicesChangedListenerCount).toBe(0);
  });

  it('fails closed when speech synthesis is unavailable', () => {
    const controller = new VoiceSpeechController({
      synthesis: () => null,
      createUtterance: (text) => new FakeUtterance(text),
      storage: () => new FakeStorage(),
    });
    expect(controller.supported()).toBe(false);
    expect(controller.listJapaneseVoices()).toEqual([]);
    expect(controller.speak('msg-1', 'こんにちは。')).toBe(false);
    expect(controller.preview('kyoko-uri')).toBe(false);
  });

  it('returns false for text with nothing speakable', () => {
    const { controller } = makeController();
    expect(controller.speak('msg-1', '```\ncode only\n```')).toBe(false);
    expect(controller.getActiveId()).toBeNull();
  });
});

class FlaggedSynthesis extends FakeSynthesis {
  speaking = true;
  pending = false;
}

class ManualTimers implements VoiceSpeechTimers {
  private timeouts = new Map<number, () => void>();
  private intervals = new Map<number, () => void>();
  private nextId = 1;
  setTimeout = (fn: () => void, _ms: number): unknown => {
    const id = this.nextId;
    this.nextId += 1;
    this.timeouts.set(id, fn);
    return id;
  };
  clearTimeout = (handle: unknown): void => { this.timeouts.delete(handle as number); };
  setInterval = (fn: () => void, _ms: number): unknown => {
    const id = this.nextId;
    this.nextId += 1;
    this.intervals.set(id, fn);
    return id;
  };
  clearInterval = (handle: unknown): void => { this.intervals.delete(handle as number); };
  fireTimeouts(): void {
    const pending = [...this.timeouts.values()];
    this.timeouts.clear();
    pending.forEach((fn) => fn());
  }
  tickIntervals(times = 1): void {
    for (let round = 0; round < times; round += 1) {
      [...this.intervals.values()].forEach((fn) => fn());
    }
  }
  get timeoutCount(): number { return this.timeouts.size; }
  get intervalCount(): number { return this.intervals.size; }
}

function makeAssuredController() {
  const synthesis = new FlaggedSynthesis([KYOKO, ICHIRO, GOOGLE_JA, ENGLISH]);
  const timers = new ManualTimers();
  const controller = new VoiceSpeechController({
    synthesis: () => synthesis,
    createUtterance: (text) => new FakeUtterance(text),
    storage: () => new FakeStorage(),
    timers,
  });
  return { controller, synthesis, timers };
}

describe('VoiceSpeechController settle assurance', () => {
  it('settles through the flag poll when utterance events never arrive', () => {
    const { controller, synthesis, timers } = makeAssuredController();
    const listener = vi.fn();
    controller.subscribe(listener);
    expect(controller.speak('msg-1', '答えです。')).toBe(true);
    expect(controller.getActiveId()).toBe('msg-1');
    // The platform finished the playback but dropped onend; it
    // reports itself idle instead. One idle sample is not enough
    // (a queued utterance may not have started yet)…
    synthesis.speaking = false;
    timers.tickIntervals(1);
    expect(controller.getActiveId()).toBe('msg-1');
    // …the second consecutive idle sample settles the playback
    // and notifies subscribers (the conversation floor handover
    // depends on that notification).
    timers.tickIntervals(1);
    expect(controller.getActiveId()).toBeNull();
    expect(listener).toHaveBeenCalled();
    expect(timers.intervalCount).toBe(0);
    expect(timers.timeoutCount).toBe(0);
  });

  it('does not settle while the platform reports playback or a queue', () => {
    const { controller, synthesis, timers } = makeAssuredController();
    controller.speak('msg-1', '答えです。');
    timers.tickIntervals(3);
    expect(controller.getActiveId()).toBe('msg-1');
    synthesis.speaking = false;
    synthesis.pending = true; // next sentence still queued
    timers.tickIntervals(3);
    expect(controller.getActiveId()).toBe('msg-1');
    synthesis.pending = false;
    timers.tickIntervals(2);
    expect(controller.getActiveId()).toBeNull();
  });

  it('watchdog settles a wedged playback whose flags lie (speaking stuck on)', () => {
    const { controller, synthesis, timers } = makeAssuredController();
    controller.speak('msg-1', '答えです。');
    const cancelsAfterSpeak = synthesis.cancelCalls;
    timers.tickIntervals(5);
    expect(controller.getActiveId()).toBe('msg-1');
    // No event, flags stuck at "speaking": the duration bound
    // concludes the playback is lost, cancels the wedge and
    // settles — a bounded pause instead of a permanent stall.
    timers.fireTimeouts();
    expect(controller.getActiveId()).toBeNull();
    expect(synthesis.cancelCalls).toBe(cancelsAfterSpeak + 1);
    expect(timers.intervalCount).toBe(0);
  });

  it('disarms once utterance events settle the playback normally', () => {
    const { controller, synthesis, timers } = makeAssuredController();
    controller.speak('msg-1', '答えです。');
    synthesis.spoken[0]?.onend?.();
    expect(controller.getActiveId()).toBeNull();
    expect(timers.intervalCount).toBe(0);
    expect(timers.timeoutCount).toBe(0);
    const cancels = synthesis.cancelCalls;
    timers.fireTimeouts();
    timers.tickIntervals(3);
    expect(synthesis.cancelCalls).toBe(cancels);
  });

  it('a forced settle of an old playback never disturbs a newer one', () => {
    const { controller, synthesis, timers } = makeAssuredController();
    controller.speak('msg-1', '前のです。');
    timers.fireTimeouts(); // watchdog settles msg-1 (events were lost)
    expect(controller.getActiveId()).toBeNull();
    controller.speak('msg-2', '次です。');
    expect(controller.getActiveId()).toBe('msg-2');
    // The lost onend of the old playback arrives late; it must
    // not decrement or clear the new playback.
    synthesis.spoken[0]?.onend?.();
    expect(controller.getActiveId()).toBe('msg-2');
    synthesis.spoken.at(-1)?.onend?.();
    expect(controller.getActiveId()).toBeNull();
  });

  it('bounds the watchdog by text length and rate, with a floor', () => {
    expect(speechSettleWatchdogMs(0, 1)).toBe(4000);
    expect(speechSettleWatchdogMs(160, 1)).toBeGreaterThan(speechSettleWatchdogMs(40, 1));
    expect(speechSettleWatchdogMs(160, 0.8)).toBeGreaterThan(speechSettleWatchdogMs(160, 1));
    expect(speechSettleWatchdogMs(160, 1.25)).toBeLessThan(speechSettleWatchdogMs(160, 1));
  });
});

describe('speaking-speed steps （声の速さ）', () => {
  it('offers the five owner-facing steps around normal = 1.0', () => {
    expect(VOICE_SPEECH_RATE_STEPS.map((step) => step.id)).toEqual([
      'slow', 'slightly-slow', 'normal', 'slightly-fast', 'fast',
    ]);
    expect(VOICE_SPEECH_RATE_STEPS.map((step) => step.labelJa)).toEqual([
      'ゆっくり', 'ややゆっくり', 'ふつう', 'ややはやい', 'はやい',
    ]);
    expect(VOICE_SPEECH_RATE_STEPS.map((step) => step.rate)).toEqual([0.8, 0.9, 1.0, 1.1, 1.25]);
    expect(voiceSpeechRateForStep('normal')).toBe(1.0);
  });

  it('defaults to ふつう when nothing is stored', () => {
    const { controller } = makeController();
    expect(controller.getRateStep()).toBe('normal');
  });

  it('stores a step as the plain rate under the existing key and reads it back', () => {
    const { controller, storage } = makeController();
    controller.setRateStep('fast');
    expect(storage.getItem(VOICE_OUTPUT_RATE_STORAGE_KEY)).toBe('1.25');
    expect(controller.getRate()).toBe(1.25);
    expect(controller.getRateStep()).toBe('fast');
    controller.setRateStep('slow');
    expect(storage.getItem(VOICE_OUTPUT_RATE_STORAGE_KEY)).toBe('0.8');
    expect(controller.getRateStep()).toBe('slow');
  });

  it('reads a stored non-step rate as the nearest step', () => {
    const { controller } = makeController();
    controller.setRate(1.15);
    expect(controller.getRateStep()).toBe('slightly-fast');
    controller.setRate(2.0);
    expect(controller.getRateStep()).toBe('fast');
    controller.setRate(0.5);
    expect(controller.getRateStep()).toBe('slow');
    expect(resolveVoiceSpeechRateStep(1.0)).toBe('normal');
    expect(resolveVoiceSpeechRateStep(0.9)).toBe('slightly-slow');
  });

  it('applies the chosen step to read-aloud and preview playback', () => {
    const { controller, synthesis } = makeController();
    controller.setRateStep('slightly-slow');
    expect(controller.speak('msg-1', 'こんにちは。')).toBe(true);
    expect(synthesis.spoken[0]?.rate).toBe(0.9);
    expect(controller.preview('ichiro-uri')).toBe(true);
    expect(synthesis.spoken.at(-1)?.rate).toBe(0.9);
  });
});
