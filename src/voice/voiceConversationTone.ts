import { clampSpeechRate, readStoredSpeechRate } from './voiceSpeech';
import type { SpeechStyleOptions, VoiceStorageLike } from './voiceSpeech';

/**
 * Conversation tone presets (owner, 2026-11-25): Orin's reply voice
 * does not imitate the owner's tone; instead the owner picks one of
 * several tone patterns for how Orin sounds in conversation —
 * strong / gentle / polite / everyday — alongside the existing
 * choice of which device voice speaks (settings: "Orin's voice").
 *
 * A preset's prosody is speech rate and pitch handed to the
 * speech controller. The tone ALSO shapes the spoken summary's
 * sentence-final phrasing (voiceSpokenPhrasing.ts — the summary's
 * facts, numbers and sources are never touched; only how each
 * sentence ends). Until 2026-11-28 the preset was prosody only
 * with narrow spreads, and the owner could not hear the
 * difference; the spreads were widened and the phrasing layer
 * added on his instruction. A preset's rate is a factor on the
 * owner's stored speaking rate — the 声の速さ step
 * (VOICE_RATE_DESIGN 2026-11-27): at the default step the
 * composed conversation rate equals the factor itself, and when
 * the owner picks a faster or slower step the conversation
 * follows it, keeping each tone's character. The stored rate
 * itself is never rewritten here.
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
  // The spreads were widened on 2026-11-28 (owner's real-device
  // finding: the differences could not be told apart). The
  // composition rule is unchanged — each rate is a factor on the
  // owner's stored speaking-rate step — only the factors and
  // pitches moved, to values a device voice renders audibly
  // differently. The tone ALSO shapes the spoken summary's
  // sentence-final phrasing (voiceSpokenPhrasing.ts); the profile
  // here remains prosody only.
  { id: 'strong', labelJa: '強い口調', labelEn: 'Strong', profile: { rate: 1.15, pitch: 0.85 } },
  { id: 'gentle', labelJa: '優しい口調', labelEn: 'Gentle', profile: { rate: 0.88, pitch: 1.2 } },
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
 * reads the stored tone and the stored speaking rate at each
 * playback, so changing either in settings takes effect from the
 * next thing Orin says. The tone's rate factor is composed onto
 * the stored rate; when the composition lands exactly on the
 * stored rate (the everyday tone names no factor) the profile is
 * returned as-is and the speech controller's own fallback to the
 * stored rate applies — the same playback, with the profile shape
 * the tone has always resolved to. */
export function resolveStoredVoiceConversationStyle(): SpeechStyleOptions {
  const profile = voiceConversationToneProfile(getStoredVoiceConversationTone());
  const storedRate = readStoredSpeechRate(defaultStorage());
  const composed = clampSpeechRate(storedRate * (profile.rate ?? 1));
  if (composed === storedRate) return profile;
  return { ...profile, rate: composed };
}
