/**
 * Voice speech controller (VC-1, VOICE_CONVERSATION_DESIGN 2026-11-18).
 *
 * Read-aloud for assistant answers, built on the device's own speech
 * synthesis (Web Speech API `speechSynthesis`): no server cost, and
 * neither audio nor text ever leaves for an ORIGIN server — the voice
 * itself is the device / browser's Japanese voice, presented to the
 * owner as one of Orin's voice candidates.
 *
 * The controller is deliberately generic about its input: it accepts
 * any answer text, strips the Markdown dressing that would otherwise
 * be spoken literally, and queues the text sentence by sentence so
 * playback starts with the first sentence instead of waiting for the
 * whole answer to be prepared (the no-gap requirement). A short
 * spoken-style script — the shape the later conversation mode (VC-2)
 * will hand it — goes through the exact same path unchanged.
 *
 * Everything platform-specific is injected (synthesis, utterance
 * factory, storage), so the module is unit-testable with a mocked
 * speechSynthesis and never touches the network.
 */

export interface SpeechVoiceLike {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default?: boolean;
}

export interface SpeechUtteranceLike {
  text: string;
  lang: string;
  rate: number;
  /** Optional in the shape so existing utterance fakes stay valid;
   * the controller always sets it on real utterances. */
  pitch?: number;
  voice: SpeechVoiceLike | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

/**
 * Per-call speaking style. Rate falls back to the owner's stored
 * rate and pitch to DEFAULT_SPEECH_PITCH when a field is absent.
 * The voice conversation passes its style profile through here —
 * the connection point where a future owner-style profile (the
 * owner's own way of speaking, saved by the personal-profile track)
 * can shape how answers sound without touching playback mechanics.
 */
export interface SpeechStyleOptions {
  rate?: number;
  pitch?: number;
}

export const DEFAULT_SPEECH_PITCH = 1.0;
export const MIN_SPEECH_PITCH = 0.5;
export const MAX_SPEECH_PITCH = 2.0;

function clampPitch(pitch: number): number {
  if (!Number.isFinite(pitch)) return DEFAULT_SPEECH_PITCH;
  return Math.min(MAX_SPEECH_PITCH, Math.max(MIN_SPEECH_PITCH, pitch));
}

export interface SpeechSynthesisLike {
  speak(utterance: SpeechUtteranceLike): void;
  cancel(): void;
  getVoices(): SpeechVoiceLike[];
  /** Live playback flags (the real SpeechSynthesis exposes both).
   * Optional in the shape: the settle assurance below reads them
   * only when the platform actually reports booleans. */
  speaking?: boolean;
  pending?: boolean;
  addEventListener?(type: 'voiceschanged', listener: () => void): void;
  removeEventListener?(type: 'voiceschanged', listener: () => void): void;
}

/**
 * Timer surface for the settle assurance, injected so tests can
 * drive it deterministically. Defaults to the platform timers.
 */
export interface VoiceSpeechTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

const defaultTimers: VoiceSpeechTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

function unrefTimer(handle: unknown): void {
  // Node-style handles (tests, SSR) must not hold the process open
  // for a backstop that may legitimately be tens of seconds out.
  if (handle && typeof (handle as { unref?: unknown }).unref === 'function') {
    (handle as { unref: () => void }).unref();
  }
}

/** How often the settle assurance samples the synthesis flags. */
export const VOICE_SPEECH_SETTLE_POLL_MS = 300;
/** Two consecutive idle samples, and at least this many samples
 * overall, before the poll path settles a playback: a queued
 * utterance that has not started yet must never read as finished. */
const SETTLE_POLL_MIN_SAMPLES = 2;
const SETTLE_POLL_IDLE_STREAK = 2;
/** Conservative floor for Japanese TTS speed (characters per
 * second at rate 1.0) used only by the watchdog estimate. */
const SETTLE_MIN_CHARS_PER_SECOND = 4.5;
const SETTLE_WATCHDOG_SAFETY = 1.8;
const SETTLE_WATCHDOG_SLACK_MS = 2500;
const SETTLE_WATCHDOG_MIN_MS = 4000;

/**
 * The last-resort bound for one playback: how long the settle
 * assurance waits for utterance events / idle flags before it
 * concludes the platform dropped the end of the playback and
 * settles it itself. Deliberately generous — it exists to turn a
 * permanent stall into a bounded pause, never to cut real speech.
 */
export function speechSettleWatchdogMs(totalChars: number, rate: number): number {
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_SPEECH_RATE;
  const estimate = (totalChars / (safeRate * SETTLE_MIN_CHARS_PER_SECOND)) * 1000;
  return Math.max(SETTLE_WATCHDOG_MIN_MS, Math.ceil(estimate * SETTLE_WATCHDOG_SAFETY) + SETTLE_WATCHDOG_SLACK_MS);
}

export interface VoiceStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type VoiceGender = 'female' | 'male';

export interface OrinVoiceOption {
  voiceURI: string;
  name: string;
  lang: string;
  /** True when the voice is synthesized on the device itself. Local
   * voices are listed first (design: on-device voices take priority). */
  localService: boolean;
  /** Best-effort gender read from the voice's well-known name; null
   * when the name carries no reliable signal. Never guessed beyond
   * the known-name lists below. */
  gender: VoiceGender | null;
}

export const VOICE_OUTPUT_VOICE_URI_STORAGE_KEY = 'origin_voice_output_voice_uri';
export const VOICE_OUTPUT_RATE_STORAGE_KEY = 'origin_voice_output_rate';
export const DEFAULT_SPEECH_RATE = 1.0;
export const MIN_SPEECH_RATE = 0.5;
export const MAX_SPEECH_RATE = 2.0;

export function clampSpeechRate(rate: number): number {
  if (!Number.isFinite(rate)) return DEFAULT_SPEECH_RATE;
  return Math.min(MAX_SPEECH_RATE, Math.max(MIN_SPEECH_RATE, rate));
}

/**
 * The stored read-aloud rate from a storage handle: the plain rate
 * number under VOICE_OUTPUT_RATE_STORAGE_KEY, defaulted and clamped.
 * The controller's getRate() and the conversation-tone resolver both
 * read through here so the parsing rule lives in exactly one place.
 */
export function readStoredSpeechRate(storage: VoiceStorageLike | null): number {
  const raw = storage?.getItem(VOICE_OUTPUT_RATE_STORAGE_KEY);
  const parsed = raw === null || raw === undefined ? Number.NaN : Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_SPEECH_RATE;
  return clampSpeechRate(parsed);
}

/**
 * The owner's speaking-speed steps (owner instruction 2026-11-27,
 * VOICE_RATE_DESIGN 2026-11-27): five plain-language steps around
 * normal = 1.0, spaced by roughly equal ratios so each step feels
 * like the same size of change, and kept well inside the range
 * where Japanese speech stays easy to follow. A step is only a
 * named face on the stored rate: picking one writes its rate
 * through the existing rate setting, so the saved shape never
 * changes and nothing new is stored or sent anywhere.
 */
export type VoiceSpeechRateStep = 'slow' | 'slightly-slow' | 'normal' | 'slightly-fast' | 'fast';

export interface VoiceSpeechRateStepOption {
  id: VoiceSpeechRateStep;
  labelJa: string;
  labelEn: string;
  rate: number;
}

export const VOICE_SPEECH_RATE_STEPS: readonly VoiceSpeechRateStepOption[] = [
  { id: 'slow', labelJa: 'ゆっくり', labelEn: 'Slow', rate: 0.8 },
  { id: 'slightly-slow', labelJa: 'ややゆっくり', labelEn: 'A bit slow', rate: 0.9 },
  { id: 'normal', labelJa: 'ふつう', labelEn: 'Normal', rate: DEFAULT_SPEECH_RATE },
  { id: 'slightly-fast', labelJa: 'ややはやい', labelEn: 'A bit fast', rate: 1.1 },
  { id: 'fast', labelJa: 'はやい', labelEn: 'Fast', rate: 1.25 },
] as const;

export const DEFAULT_VOICE_SPEECH_RATE_STEP: VoiceSpeechRateStep = 'normal';

export function voiceSpeechRateForStep(step: VoiceSpeechRateStep): number {
  return VOICE_SPEECH_RATE_STEPS.find((option) => option.id === step)?.rate ?? DEFAULT_SPEECH_RATE;
}

/**
 * The step a rate belongs to: the nearest step's rate wins (ties go
 * to the slower step). A stored value that is not exactly a step —
 * possible from before the steps existed — still displays as the
 * step it is closest to, and picking a step then writes an exact
 * step rate.
 */
export function resolveVoiceSpeechRateStep(rate: number): VoiceSpeechRateStep {
  const clamped = clampSpeechRate(rate);
  let nearest = VOICE_SPEECH_RATE_STEPS[0]!;
  for (const option of VOICE_SPEECH_RATE_STEPS) {
    if (Math.abs(option.rate - clamped) < Math.abs(nearest.rate - clamped)) nearest = option;
  }
  return nearest.id;
}

/** Spoken when the owner previews a voice in settings. */
export const ORIN_VOICE_PREVIEW_TEXT = 'こんにちは、オリンです。この声でお話ししますね。';

/** The synthetic playback id used for settings previews, so a preview
 * never looks like an answer is being read. */
export const VOICE_PREVIEW_PLAYBACK_ID = 'orin-voice-preview';

const FEMALE_VOICE_NAME_TOKENS: readonly string[] = [
  'ayumi', 'haruka', 'sayaka', 'kyoko', 'nanami', 'aoi', 'yui', 'mizuki', 'sakura', 'hana',
];
const MALE_VOICE_NAME_TOKENS: readonly string[] = [
  'ichiro', 'otoya', 'takumi', 'kenji', 'daichi', 'ren',
];

/**
 * Reads the gender of a device voice from its name, for the well-known
 * Japanese voice names only (Microsoft Ayumi/Haruka/Ichiro, Apple
 * Kyoko/Otoya, Google's Japanese voice, …). Returns null when the
 * name gives no reliable signal — the settings list simply shows no
 * gender label for those, rather than guessing.
 */
export function voiceGenderFromName(name: string): VoiceGender | null {
  const normalized = name.normalize('NFKC').toLowerCase();
  if (normalized === 'google 日本語') return 'female';
  if (FEMALE_VOICE_NAME_TOKENS.some((token) => normalized.includes(token))) return 'female';
  if (MALE_VOICE_NAME_TOKENS.some((token) => normalized.includes(token))) return 'male';
  return null;
}

/**
 * Flattens Markdown answer text into plain speakable text: code blocks
 * are dropped (reading source code aloud is noise), links keep their
 * label, bare URLs and markup markers are removed, and table pipes
 * become pauses. Deterministic and total — any string is safe input.
 */
export function toSpeechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/[^\s)]+/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, ' ')
    .replace(/\|/g, '、')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*-{3,}\s*$/gm, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');
}

const SENTENCE_TERMINATORS = new Set(['。', '！', '？', '!', '?', '\n']);
const MAX_UTTERANCE_CHARS = 180;

/**
 * Splits speakable text into whole sentences, without any further
 * chunking. ASCII periods between digits (decimals, versions) never
 * split. The spoken-summary builder uses this form: a summary must
 * only ever contain complete sentences from the source answer.
 */
export function splitSpeakableSentences(text: string): string[] {
  const sentences: string[] = [];
  let current = '';
  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) sentences.push(trimmed);
    current = '';
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    current += char;
    if (char === '.') {
      const previous = text[index - 1] ?? '';
      const next = text[index + 1] ?? '';
      const isDecimal = /\d/.test(previous) && /\d/.test(next);
      const isTrailing = next === '' || /\s/.test(next);
      if (!isDecimal && isTrailing) flush();
      continue;
    }
    if (SENTENCE_TERMINATORS.has(char)) flush();
  }
  flush();
  return sentences;
}

/**
 * Splits speakable text into sentence-sized chunks for queued
 * playback: the first chunk is ready immediately, which is what keeps
 * the gap before the first spoken words short. Over-long sentences
 * are broken further at Japanese commas so no single utterance
 * stalls.
 */
export function splitSpeechSentences(text: string): string[] {
  return splitSpeakableSentences(text).flatMap((sentence) => chunkLongSentence(sentence));
}

function chunkLongSentence(sentence: string): string[] {
  if (sentence.length <= MAX_UTTERANCE_CHARS) return [sentence];
  const chunks: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_UTTERANCE_CHARS) {
    const cut = rest.lastIndexOf('、', MAX_UTTERANCE_CHARS);
    if (cut < MAX_UTTERANCE_CHARS / 2) {
      chunks.push(rest.slice(0, MAX_UTTERANCE_CHARS));
      rest = rest.slice(MAX_UTTERANCE_CHARS);
    } else {
      chunks.push(rest.slice(0, cut + 1));
      rest = rest.slice(cut + 1);
    }
  }
  if (rest.trim()) chunks.push(rest);
  return chunks;
}

export interface VoiceSpeechDeps {
  synthesis?: () => SpeechSynthesisLike | null;
  createUtterance?: (text: string) => SpeechUtteranceLike;
  storage?: () => VoiceStorageLike | null;
  timers?: VoiceSpeechTimers;
}

export class VoiceSpeechController {
  private readonly deps: VoiceSpeechDeps;
  private readonly listeners = new Set<() => void>();
  private readonly voiceListeners = new Set<() => void>();
  private activeId: string | null = null;
  private session = 0;
  private pendingUtterances = 0;
  private voicesChangedHandler: (() => void) | null = null;
  private voicesChangedTarget: SpeechSynthesisLike | null = null;
  private settlePollHandle: unknown = null;
  private settleWatchdogHandle: unknown = null;

  constructor(deps: VoiceSpeechDeps = {}) {
    this.deps = deps;
  }

  private timers(): VoiceSpeechTimers {
    return this.deps.timers ?? defaultTimers;
  }

  private synthesis(): SpeechSynthesisLike | null {
    try {
      return this.deps.synthesis ? this.deps.synthesis() : null;
    } catch {
      return null;
    }
  }

  private storage(): VoiceStorageLike | null {
    try {
      return this.deps.storage ? this.deps.storage() : null;
    } catch {
      return null;
    }
  }

  /** True when this device/browser can speak at all. */
  supported(): boolean {
    return this.synthesis() !== null;
  }

  // -- Playback state (read via useSyncExternalStore in the UI) ------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The id passed to `speak` for the playback in progress, or null. */
  getActiveId(): string | null {
    return this.activeId;
  }

  private setActiveId(next: string | null) {
    if (this.activeId === next) return;
    this.activeId = next;
    this.listeners.forEach((listener) => listener());
  }

  // -- Voice catalogue ------------------------------------------------

  subscribeVoices(listener: () => void): () => void {
    this.voiceListeners.add(listener);
    if (this.voiceListeners.size === 1) this.attachVoicesChanged();
    return () => {
      this.voiceListeners.delete(listener);
      if (this.voiceListeners.size === 0) this.detachVoicesChanged();
    };
  }

  private attachVoicesChanged() {
    const synthesis = this.synthesis();
    if (!synthesis?.addEventListener) return;
    this.voicesChangedHandler = () => {
      this.voiceListeners.forEach((listener) => listener());
    };
    this.voicesChangedTarget = synthesis;
    synthesis.addEventListener('voiceschanged', this.voicesChangedHandler);
  }

  private detachVoicesChanged() {
    if (this.voicesChangedTarget?.removeEventListener && this.voicesChangedHandler) {
      this.voicesChangedTarget.removeEventListener('voiceschanged', this.voicesChangedHandler);
    }
    this.voicesChangedTarget = null;
    this.voicesChangedHandler = null;
  }

  /**
   * The Japanese voices on this device, offered as Orin's voice
   * candidates: on-device voices first, then the device default, then
   * by name — so the list order is stable and local voices lead.
   */
  listJapaneseVoices(): OrinVoiceOption[] {
    const synthesis = this.synthesis();
    if (!synthesis) return [];
    let voices: SpeechVoiceLike[];
    try {
      voices = synthesis.getVoices();
    } catch {
      return [];
    }
    return voices
      .filter((voice) => voice.lang.toLowerCase().replace('_', '-').startsWith('ja'))
      .map((voice) => ({
        voiceURI: voice.voiceURI,
        name: voice.name,
        lang: voice.lang,
        localService: voice.localService,
        gender: voiceGenderFromName(voice.name),
      }))
      .sort((a, b) => Number(b.localService) - Number(a.localService) || a.name.localeCompare(b.name));
  }

  private findVoice(voiceURI: string): SpeechVoiceLike | null {
    const synthesis = this.synthesis();
    if (!synthesis) return null;
    try {
      return synthesis.getVoices().find((voice) => voice.voiceURI === voiceURI) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * The voice playback will use: the owner's stored choice while it
   * still exists on the device, otherwise the default — the first
   * known male Japanese voice in catalogue order (on-device first),
   * because Orin's canonical voice is male; when no voice on the
   * device is known to be male, the catalogue head (on-device first).
   * Null when the device has no Japanese voice at all.
   */
  resolveVoice(): SpeechVoiceLike | null {
    const selected = this.getSelectedVoiceURI();
    if (selected) {
      const found = this.findVoice(selected);
      if (found) return found;
    }
    const synthesis = this.synthesis();
    if (!synthesis) return null;
    const japanese = this.listJapaneseVoices();
    if (japanese.length === 0) return null;
    const preferred = japanese.find((voice) => voice.gender === 'male') ?? japanese[0]!;
    return this.findVoice(preferred.voiceURI);
  }

  // -- Stored choice ----------------------------------------------------

  getSelectedVoiceURI(): string | null {
    const value = this.storage()?.getItem(VOICE_OUTPUT_VOICE_URI_STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  }

  selectVoice(voiceURI: string | null): void {
    const storage = this.storage();
    if (!storage) return;
    try {
      if (voiceURI) storage.setItem(VOICE_OUTPUT_VOICE_URI_STORAGE_KEY, voiceURI);
      else storage.removeItem(VOICE_OUTPUT_VOICE_URI_STORAGE_KEY);
    } catch { /* storage is best-effort; the in-memory choice still applies via re-render */ }
  }

  getRate(): number {
    return readStoredSpeechRate(this.storage());
  }

  setRate(rate: number): void {
    if (!Number.isFinite(rate)) return;
    const clamped = Math.min(MAX_SPEECH_RATE, Math.max(MIN_SPEECH_RATE, rate));
    try {
      this.storage()?.setItem(VOICE_OUTPUT_RATE_STORAGE_KEY, String(clamped));
    } catch { /* best-effort, as above */ }
  }

  /** The stored rate expressed as one of the five speed steps
   * (settings: 声の速さ). A stored value that is not exactly a step
   * reads as the nearest step. */
  getRateStep(): VoiceSpeechRateStep {
    return resolveVoiceSpeechRateStep(this.getRate());
  }

  /** Stores a speed step through the existing rate setting, so the
   * saved value stays the plain rate number it has always been. */
  setRateStep(step: VoiceSpeechRateStep): void {
    this.setRate(voiceSpeechRateForStep(step));
  }

  // -- Playback ---------------------------------------------------------

  /**
   * Reads `rawText` aloud under playback id `id` (the message id for
   * answers). Any current playback is replaced. Returns false when
   * speech is unavailable or the text has nothing speakable. The
   * optional style overrides the stored rate / default pitch for
   * this playback only; stored settings are never changed by it.
   */
  speak(id: string, rawText: string, style?: SpeechStyleOptions): boolean {
    const synthesis = this.synthesis();
    if (!synthesis || !this.deps.createUtterance) return false;
    const sentences = splitSpeechSentences(toSpeechText(rawText));
    if (sentences.length === 0) return false;
    this.stop();
    const session = ++this.session;
    const voice = this.resolveVoice();
    const rate = style?.rate !== undefined && Number.isFinite(style.rate)
      ? Math.min(MAX_SPEECH_RATE, Math.max(MIN_SPEECH_RATE, style.rate))
      : this.getRate();
    const pitch = clampPitch(style?.pitch ?? DEFAULT_SPEECH_PITCH);
    this.pendingUtterances = sentences.length;
    this.setActiveId(id);
    for (const sentence of sentences) {
      const utterance = this.deps.createUtterance(sentence);
      utterance.voice = voice;
      utterance.lang = voice?.lang ?? 'ja-JP';
      utterance.rate = rate;
      utterance.pitch = pitch;
      const settle = () => {
        if (session !== this.session) return;
        this.pendingUtterances -= 1;
        if (this.pendingUtterances <= 0) {
          this.pendingUtterances = 0;
          this.clearSettleAssurance();
          this.setActiveId(null);
        }
      };
      utterance.onend = settle;
      utterance.onerror = settle;
      synthesis.speak(utterance);
    }
    this.startSettleAssurance(session, sentences, rate);
    return true;
  }

  /** Speaks the settings preview line with the given voice candidate. */
  preview(voiceURI: string): boolean {
    const synthesis = this.synthesis();
    if (!synthesis || !this.deps.createUtterance) return false;
    const voice = this.findVoice(voiceURI);
    if (!voice) return false;
    this.stop();
    const session = ++this.session;
    this.pendingUtterances = 1;
    this.setActiveId(VOICE_PREVIEW_PLAYBACK_ID);
    const utterance = this.deps.createUtterance(ORIN_VOICE_PREVIEW_TEXT);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = this.getRate();
    utterance.pitch = DEFAULT_SPEECH_PITCH;
    const settle = () => {
      if (session !== this.session) return;
      this.pendingUtterances = 0;
      this.clearSettleAssurance();
      this.setActiveId(null);
    };
    utterance.onend = settle;
    utterance.onerror = settle;
    synthesis.speak(utterance);
    this.startSettleAssurance(session, [ORIN_VOICE_PREVIEW_TEXT], this.getRate());
    return true;
  }

  /** Stops playback immediately and clears the queue. */
  stop(): void {
    this.session += 1;
    this.pendingUtterances = 0;
    this.clearSettleAssurance();
    this.setActiveId(null);
    try {
      this.synthesis()?.cancel();
    } catch { /* a failing cancel must not break the caller */ }
  }

  // -- Settle assurance -------------------------------------------------
  //
  // Playback completion used to be known only through utterance
  // onend/onerror. On Android Chrome those events are not reliable:
  // they can be dropped entirely (most often with network voices),
  // and a queued utterance can fail to start without any event at
  // all. When that happened the active id never cleared and every
  // consumer waiting for "playback finished" — above all the voice
  // conversation's floor handover — stalled forever. Completion is
  // therefore assured on three independent paths:
  //
  //  1. utterance onend/onerror (the primary path, unchanged);
  //  2. a poll of the synthesis speaking/pending flags: when the
  //     platform itself reports nothing is playing or queued, the
  //     playback is over even if its events were lost;
  //  3. a duration watchdog (speechSettleWatchdogMs): if the flags
  //     also lie — synthesis wedged "speaking" forever — the
  //     playback is cancelled and settled once it has had far
  //     longer than the text could possibly take.
  //
  // Settling through path 2 or 3 invalidates the session first, so
  // a late real onend can never decrement a later playback.

  private startSettleAssurance(session: number, sentences: string[], rate: number): void {
    this.clearSettleAssurance();
    const timers = this.timers();
    let samples = 0;
    let idleStreak = 0;
    const pollHandle = timers.setInterval(() => {
      if (session !== this.session) return;
      samples += 1;
      const synthesis = this.synthesis();
      if (!synthesis || typeof synthesis.speaking !== 'boolean' || typeof synthesis.pending !== 'boolean') {
        idleStreak = 0;
        return;
      }
      if (synthesis.speaking || synthesis.pending) {
        idleStreak = 0;
        return;
      }
      idleStreak += 1;
      if (samples >= SETTLE_POLL_MIN_SAMPLES && idleStreak >= SETTLE_POLL_IDLE_STREAK) {
        this.forceSettle(session, false);
      }
    }, VOICE_SPEECH_SETTLE_POLL_MS);
    unrefTimer(pollHandle);
    this.settlePollHandle = pollHandle;
    const totalChars = sentences.reduce((sum, sentence) => sum + sentence.length, 0);
    const watchdogHandle = timers.setTimeout(() => {
      if (session !== this.session) return;
      this.forceSettle(session, true);
    }, speechSettleWatchdogMs(totalChars, rate));
    unrefTimer(watchdogHandle);
    this.settleWatchdogHandle = watchdogHandle;
  }

  private forceSettle(session: number, cancelSynthesis: boolean): void {
    if (session !== this.session) return;
    // Invalidate first: any utterance event that still arrives for
    // this playback is stale from here on.
    this.session += 1;
    this.pendingUtterances = 0;
    this.clearSettleAssurance();
    if (cancelSynthesis) {
      try {
        this.synthesis()?.cancel();
      } catch { /* a failing cancel must not break the settle */ }
    }
    this.setActiveId(null);
  }

  private clearSettleAssurance(): void {
    const timers = this.timers();
    if (this.settlePollHandle !== null) {
      timers.clearInterval(this.settlePollHandle);
      this.settlePollHandle = null;
    }
    if (this.settleWatchdogHandle !== null) {
      timers.clearTimeout(this.settleWatchdogHandle);
      this.settleWatchdogHandle = null;
    }
  }
}

function defaultSynthesis(): SpeechSynthesisLike | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as { speechSynthesis?: unknown }).speechSynthesis;
  return candidate ? (candidate as SpeechSynthesisLike) : null;
}

function defaultCreateUtterance(text: string): SpeechUtteranceLike {
  return new SpeechSynthesisUtterance(text) as unknown as SpeechUtteranceLike;
}

function defaultStorage(): VoiceStorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The app-wide controller, resolved lazily against the live window so
 * importing this module never touches browser globals. */
export const voiceSpeech = new VoiceSpeechController({
  synthesis: defaultSynthesis,
  createUtterance: defaultCreateUtterance,
  storage: defaultStorage,
});
