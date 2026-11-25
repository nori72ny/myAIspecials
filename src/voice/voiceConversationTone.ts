import type { SpeechStyleOptions, VoiceStorageLike } from './voiceSpeech';

/**
 * Conversation tone presets (owner, 2026-11-25): Orin's reply voice
 * does not imitate the owner's tone; instead the owner picks one of
 * several tone patterns for how Orin sounds in conversation —
 * strong / gentle / polite / everyday — alongside the existing
 * choice of which device voice speaks (settings: "Orin's voice").
 *
 * A preset is prosody only: speech rate and pitch handed to the
 * speech controller. It never changes the words — what Orin says is
 * the gated final answer's summary, whatever the tone. (A tone of
 * WORD CHOICE would belong to answer generation, not to this
 * layer.) Presets that name a rate override the stored read-aloud
 * rate for conversation playback only; the stored rate itself is
 * never rewritten.
 *
 * The choice is stored on the device only (a settings value — no
 * content). Default: everyday.
 */

export type VoiceConversationTone = 'strong' | 'gentle' | 'polite' | 'everyday';

export const VOICE_CONVERSATION_TONE_STORAGE_KEY = 'origin_voice_conversation_tone';
export const DEFAULT_VOICE_CONVERSATION_TONE: VoiceConversationTone = 'everyday';

export interface VoiceConversationToneOption {
  id: VoiceConversationTone;
  labelJa: string;
  labelEn: string;
  profile: SpeechStyleOptions;
}

export const VOICE_CONVERSATION_TONES: readonly VoiceConversationToneOption[] = [
  { id: 'strong', labelJa: '強い口調', labelEn: 'Strong', profile: { rate: 1.05, pitch: 0.95 } },
  { id: 'gentle', labelJa: '優しい口調', labelEn: 'Gentle', profile: { rate: 0.95, pitch: 1.1 } },
  { id: 'polite', labelJa: '丁寧な口調', labelEn: 'Polite', profile: { rate: 0.95, pitch: 1.0 } },
  // Everyday names no rate: the owner's stored rate keeps applying.
  { id: 'everyday', labelJa: '日常の口調', labelEn: 'Everyday', profile: { pitch: 1.05 } },
] as const;

export function resolveVoiceConversationTone(value: string | null | undefined): VoiceConversationTone {
  return VOICE_CONVERSATION_TONES.some((tone) => tone.id === value)
    ? (value as VoiceConversationTone)
    : DEFAULT_VOICE_CONVERSATION_TONE;
}

export function voiceConversationToneProfile(tone: VoiceConversationTone): SpeechStyleOptions {
  return VOICE_CONVERSATION_TONES.find((option) => option.id === tone)?.profile ?? {};
}

function defaultStorage(): VoiceStorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getStoredVoiceConversationTone(
  storage: VoiceStorageLike | null = defaultStorage(),
): VoiceConversationTone {
  try {
    return resolveVoiceConversationTone(storage?.getItem(VOICE_CONVERSATION_TONE_STORAGE_KEY));
  } catch {
    return DEFAULT_VOICE_CONVERSATION_TONE;
  }
}

export function setStoredVoiceConversationTone(
  tone: VoiceConversationTone,
  storage: VoiceStorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(VOICE_CONVERSATION_TONE_STORAGE_KEY, tone);
  } catch { /* best-effort, like every device-side voice setting */ }
}

/** The style resolver the app-wide conversation controller uses:
 * reads the stored tone at each playback, so changing the tone in
 * settings takes effect from the next thing Orin says. */
export function resolveStoredVoiceConversationStyle(): SpeechStyleOptions {
  return voiceConversationToneProfile(getStoredVoiceConversationTone());
}
