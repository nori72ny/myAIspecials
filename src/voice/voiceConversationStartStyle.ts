import type { VoiceStorageLike } from './voiceSpeech';

/**
 * How a voice conversation starts (owner instruction, 2026-11-28:
 * the greeting-first start "is not necessarily right" — the owner
 * chooses). Two styles:
 *
 * - 'greeting' (default): Orin speaks the fixed opening line
 *   first, then listens — the behaviour the conversation has
 *   always had.
 * - 'listen': no greeting; pressing the conversation button opens
 *   the microphone straight away.
 *
 * The choice is stored on the device only (a settings value — no
 * content), like every other voice setting. It governs starts
 * through startConversation (the conversation button, and wake
 * waiting being switched on). A conversation begun by the wake
 * phrase itself never had a greeting — hearing 「ハイ、オリン」
 * hands the floor straight to listening — so the wake-phrase path
 * is outside this choice by design.
 */

export type VoiceConversationStartStyle = 'greeting' | 'listen';

export const VOICE_CONVERSATION_START_STYLE_STORAGE_KEY = 'origin_voice_conversation_start_style';
export const DEFAULT_VOICE_CONVERSATION_START_STYLE: VoiceConversationStartStyle = 'greeting';

export interface VoiceConversationStartStyleOption {
  id: VoiceConversationStartStyle;
  labelJa: string;
  labelEn: string;
}

export const VOICE_CONVERSATION_START_STYLES: readonly VoiceConversationStartStyleOption[] = [
  { id: 'greeting', labelJa: '挨拶してから始める', labelEn: 'Start with a greeting' },
  { id: 'listen', labelJa: '挨拶なしですぐ聞き取る', labelEn: 'Start listening right away' },
];

export function resolveVoiceConversationStartStyle(value: string | null | undefined): VoiceConversationStartStyle {
  return value === 'listen' ? 'listen' : DEFAULT_VOICE_CONVERSATION_START_STYLE;
}

function defaultStorage(): VoiceStorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getStoredVoiceConversationStartStyle(
  storage: VoiceStorageLike | null = defaultStorage(),
): VoiceConversationStartStyle {
  try {
    return resolveVoiceConversationStartStyle(storage?.getItem(VOICE_CONVERSATION_START_STYLE_STORAGE_KEY));
  } catch {
    return DEFAULT_VOICE_CONVERSATION_START_STYLE;
  }
}

export function setStoredVoiceConversationStartStyle(
  style: VoiceConversationStartStyle,
  storage: VoiceStorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(VOICE_CONVERSATION_START_STYLE_STORAGE_KEY, style);
  } catch { /* best-effort, like every device-side voice setting */ }
}
