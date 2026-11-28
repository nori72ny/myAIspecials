// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  getStoredVoiceConversationStartStyle,
  resolveVoiceConversationStartStyle,
  setStoredVoiceConversationStartStyle,
  VOICE_CONVERSATION_START_STYLE_STORAGE_KEY,
} from './voiceConversationStartStyle';
import type { VoiceStorageLike } from './voiceSpeech';

function memoryStorage(): VoiceStorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

describe('voice conversation start style', () => {
  it('defaults to the greeting start for missing or unknown values', () => {
    expect(resolveVoiceConversationStartStyle(null)).toBe('greeting');
    expect(resolveVoiceConversationStartStyle(undefined)).toBe('greeting');
    expect(resolveVoiceConversationStartStyle('bogus')).toBe('greeting');
    expect(resolveVoiceConversationStartStyle('listen')).toBe('listen');
    expect(getStoredVoiceConversationStartStyle(memoryStorage())).toBe('greeting');
  });

  it('round-trips the stored choice', () => {
    const storage = memoryStorage();
    setStoredVoiceConversationStartStyle('listen', storage);
    expect(storage.map.get(VOICE_CONVERSATION_START_STYLE_STORAGE_KEY)).toBe('listen');
    expect(getStoredVoiceConversationStartStyle(storage)).toBe('listen');
    setStoredVoiceConversationStartStyle('greeting', storage);
    expect(getStoredVoiceConversationStartStyle(storage)).toBe('greeting');
  });
});
