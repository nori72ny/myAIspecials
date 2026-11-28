import type { VoiceStorageLike } from './voiceSpeech';

/**
 * Whether wake-phrase waiting (「ハイ、オリン」) is armed.
 *
 * The owner's model of the feature (2026-11-23, reaffirmed by the
 * 2026-11-28 device report): while the app is open, saying the
 * wake phrase starts a conversation. That only holds if the
 * standby survives the things that used to clear it silently —
 * ending a conversation, reloading the app — so the toggle's
 * state is stored on the device like every other voice setting
 * (a settings value, no content), and the conversation surface
 * re-arms standby from it. The default is off: the microphone
 * listener is armed only by the owner's explicit toggle.
 */

export const VOICE_WAKE_WAITING_STORAGE_KEY = 'origin_voice_wake_waiting';

function defaultStorage(): VoiceStorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getStoredWakeWaitingPreference(
  storage: VoiceStorageLike | null = defaultStorage(),
): boolean {
  try {
    return storage?.getItem(VOICE_WAKE_WAITING_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setStoredWakeWaitingPreference(
  enabled: boolean,
  storage: VoiceStorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(VOICE_WAKE_WAITING_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch { /* best-effort, like every device-side voice setting */ }
}
