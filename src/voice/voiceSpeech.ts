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
  addEventListener?(type: 'voiceschanged', listener: () => void): void;
  removeEventListener?(type: 'voiceschanged', listener: () => void): void;
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

  constructor(deps: VoiceSpeechDeps = {}) {
    this.deps = deps;
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
   * still exists on the device, otherwise the first Japanese voice in
   * catalogue order (on-device first). Null when the device has no
   * Japanese voice at all.
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
    return this.findVoice(japanese[0]!.voiceURI);
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
    const raw = this.storage()?.getItem(VOICE_OUTPUT_RATE_STORAGE_KEY);
    const parsed = raw === null || raw === undefined ? Number.NaN : Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_SPEECH_RATE;
    return Math.min(MAX_SPEECH_RATE, Math.max(MIN_SPEECH_RATE, parsed));
  }

  setRate(rate: number): void {
    if (!Number.isFinite(rate)) return;
    const clamped = Math.min(MAX_SPEECH_RATE, Math.max(MIN_SPEECH_RATE, rate));
    try {
      this.storage()?.setItem(VOICE_OUTPUT_RATE_STORAGE_KEY, String(clamped));
    } catch { /* best-effort, as above */ }
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
          this.setActiveId(null);
        }
      };
      utterance.onend = settle;
      utterance.onerror = settle;
      synthesis.speak(utterance);
    }
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
      this.setActiveId(null);
    };
    utterance.onend = settle;
    utterance.onerror = settle;
    synthesis.speak(utterance);
    return true;
  }

  /** Stops playback immediately and clears the queue. */
  stop(): void {
    this.session += 1;
    this.pendingUtterances = 0;
    this.setActiveId(null);
    try {
      this.synthesis()?.cancel();
    } catch { /* a failing cancel must not break the caller */ }
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
