import { describe, expect, it } from 'vitest';
import {
  VOICE_WAKE_WAITING_STORAGE_KEY,
  getStoredWakeWaitingPreference,
  setStoredWakeWaitingPreference,
} from './voiceWakeWaitingPreference';
import type { VoiceStorageLike } from './voiceSpeech';

function memoryStorage(initial: Record<string, string> = {}): VoiceStorageLike {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

describe('voiceWakeWaitingPreference', () => {
  it('defaults to off when nothing is stored', () => {
    expect(getStoredWakeWaitingPreference(memoryStorage())).toBe(false);
    expect(getStoredWakeWaitingPreference(null)).toBe(false);
  });

  it('round-trips the owner toggle', () => {
    const storage = memoryStorage();
    setStoredWakeWaitingPreference(true, storage);
    expect(storage.getItem(VOICE_WAKE_WAITING_STORAGE_KEY)).toBe('on');
    expect(getStoredWakeWaitingPreference(storage)).toBe(true);
    setStoredWakeWaitingPreference(false, storage);
    expect(getStoredWakeWaitingPreference(storage)).toBe(false);
  });

  it('reads any stored value other than on as off', () => {
    expect(getStoredWakeWaitingPreference(memoryStorage({ [VOICE_WAKE_WAITING_STORAGE_KEY]: 'yes' }))).toBe(false);
  });
});
