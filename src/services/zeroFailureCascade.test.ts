import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeZeroFailureCascade, isAutonomousImagePrompt, sanitizeWikipediaSnippet } from './zeroFailureCascade';

afterEach(() => { vi.unstubAllGlobals(); });

describe('zero failure cascade', () => {
  it('recognizes Japanese and English image requests', () => {
    expect(isAutonomousImagePrompt('海の画像を生成して')).toBe(true);
    expect(isAutonomousImagePrompt('Draw an image of the sea')).toBe(true);
    expect(isAutonomousImagePrompt('Explain ocean currents')).toBe(false);
  });

  it('fails closed for image prompts without calling any external image provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await executeZeroFailureCascade('海の画像');
    expect(result).toMatchObject({ ok: false, source: 'unavailable' });
    expect(result.content).not.toContain('pollinations.ai');
    expect(fetchMock).not.toHaveBeenCalled();
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

  it('escapes malformed HTML after removing Wikipedia snippet formatting', () => {
    expect(sanitizeWikipediaSnippet('safe <span class="searchmatch">result</span> <script')).toBe('safe result &lt;script');
    expect(sanitizeWikipediaSnippet('<img src=x onerror=alert(1)>')).toBe('');
  });
});
