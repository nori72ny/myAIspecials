import { describe, expect, it } from 'vitest';
import { calculateVisualViewportKeyboardInset } from './useVisualViewportKeyboardInset';

describe('visual viewport keyboard inset', () => {
  it('returns the keyboard occlusion while a text field is focused', () => {
    expect(calculateVisualViewportKeyboardInset(844, 500, 0, true)).toBe(344);
    expect(calculateVisualViewportKeyboardInset(844, 500, 20, true)).toBe(324);
  });

  it('ignores browser chrome changes and non-text focus', () => {
    expect(calculateVisualViewportKeyboardInset(844, 800, 0, true)).toBe(0);
    expect(calculateVisualViewportKeyboardInset(844, 500, 0, false)).toBe(0);
  });

  it('caps pathological viewport deltas instead of moving the composer offscreen', () => {
    expect(calculateVisualViewportKeyboardInset(800, 100, 0, true)).toBe(520);
  });

  it('fails safe for invalid geometry', () => {
    expect(calculateVisualViewportKeyboardInset(0, 500, 0, true)).toBe(0);
    expect(calculateVisualViewportKeyboardInset(844, Number.NaN, 0, true)).toBe(0);
  });
});
