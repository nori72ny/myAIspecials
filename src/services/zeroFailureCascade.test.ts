import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPollinationsImageUrl, executeZeroFailureCascade, isAutonomousImagePrompt } from './zeroFailureCascade';

afterEach(() => { vi.unstubAllGlobals(); });

describe('zero failure cascade', () => {
  it('recognizes Japanese and English image requests', () => {
    expect(isAutonomousImagePrompt('海の画像を生成して')).toBe(true);
    expect(isAutonomousImagePrompt('Draw an image of the sea')).toBe(true);
    expect(isAutonomousImagePrompt('Explain ocean currents')).toBe(false);
  });

  it('creates an encoded Pollinations URL with a stable explicit seed', () => {
    const url = createPollinationsImageUrl('海と青空', 42);
    expect(url).toContain('https://image.pollinations.ai/prompt/');
    expect(url).toContain(encodeURIComponent('海と青空'));
    expect(url).toContain('seed=42');
  });

  it('returns a public text response when the keyless endpoint is available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('A grounded fallback answer.', { status: 200 })));
    const result = await executeZeroFailureCascade('What is a tidal current?');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe('pollinations-text');
      expect(result.content).toBe('A grounded fallback answer.');
    }
  });
});
