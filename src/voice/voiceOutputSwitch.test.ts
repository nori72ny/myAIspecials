import { describe, expect, it } from 'vitest';
import { voiceOutputEnabled } from './voiceOutputSwitch';

describe('voiceOutputEnabled', () => {
  it('is on only for the exact string "true"', () => {
    expect(voiceOutputEnabled({ ORIGIN_VOICE_OUTPUT_ENABLED: 'true' })).toBe(true);
    expect(voiceOutputEnabled({ ORIGIN_VOICE_OUTPUT_ENABLED: '1' })).toBe(false);
    expect(voiceOutputEnabled({ ORIGIN_VOICE_OUTPUT_ENABLED: 'TRUE' })).toBe(false);
    expect(voiceOutputEnabled({ ORIGIN_VOICE_OUTPUT_ENABLED: 'false' })).toBe(false);
    expect(voiceOutputEnabled({})).toBe(false);
  });
});
