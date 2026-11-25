// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  getStoredVoiceConversationTone,
  resolveStoredVoiceConversationStyle,
  resolveVoiceConversationTone,
  setStoredVoiceConversationTone,
  VOICE_CONVERSATION_TONES,
  VOICE_CONVERSATION_TONE_STORAGE_KEY,
  voiceConversationToneProfile,
} from './voiceConversationTone';
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

describe('voice conversation tones', () => {
  it('offers the four owner-named patterns', () => {
    expect(VOICE_CONVERSATION_TONES.map((tone) => tone.id)).toEqual(['strong', 'gentle', 'polite', 'everyday']);
    expect(VOICE_CONVERSATION_TONES.map((tone) => tone.labelJa)).toEqual(['強い口調', '優しい口調', '丁寧な口調', '日常の口調']);
  });

  it('gives every tone a distinct prosody profile', () => {
    const profiles = VOICE_CONVERSATION_TONES.map((tone) => JSON.stringify(tone.profile));
    expect(new Set(profiles).size).toBe(profiles.length);
    expect(voiceConversationToneProfile('strong')).toEqual({ rate: 1.05, pitch: 0.95 });
    expect(voiceConversationToneProfile('gentle')).toEqual({ rate: 0.95, pitch: 1.1 });
    expect(voiceConversationToneProfile('polite')).toEqual({ rate: 0.95, pitch: 1.0 });
    // Everyday leaves the rate to the owner's stored setting.
    expect(voiceConversationToneProfile('everyday').rate).toBeUndefined();
    expect(voiceConversationToneProfile('everyday').pitch).toBe(1.05);
  });

  it('defaults to everyday for missing or unknown values', () => {
    expect(resolveVoiceConversationTone(null)).toBe('everyday');
    expect(resolveVoiceConversationTone('bogus')).toBe('everyday');
    expect(resolveVoiceConversationTone('gentle')).toBe('gentle');
    expect(getStoredVoiceConversationTone(memoryStorage())).toBe('everyday');
  });

  it('round-trips the stored choice and resolves its style', () => {
    const storage = memoryStorage();
    setStoredVoiceConversationTone('strong', storage);
    expect(storage.map.get(VOICE_CONVERSATION_TONE_STORAGE_KEY)).toBe('strong');
    expect(getStoredVoiceConversationTone(storage)).toBe('strong');
  });

  it('resolves the style from the live stored tone (browser storage)', () => {
    window.localStorage.clear();
    expect(resolveStoredVoiceConversationStyle()).toEqual({ pitch: 1.05 });
    setStoredVoiceConversationTone('gentle');
    expect(resolveStoredVoiceConversationStyle()).toEqual({ rate: 0.95, pitch: 1.1 });
    window.localStorage.clear();
  });
});
