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

  it('uses only labelled Wikipedia excerpts and never calls a public text-generation provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      query: { search: [{ title: 'Tidal current', snippet: 'A <span>moving</span> body of water.' }] },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await executeZeroFailureCascade('What is a tidal current?');
    expect(result).toMatchObject({ ok: true, source: 'wikipedia' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('en.wikipedia.org');
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('pollinations.ai');
  });

  it('formats Wikipedia fallback excerpts with real line breaks', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      query: { search: [{ title: 'Tidal current', snippet: 'A <span>moving</span> body of water.' }] },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeZeroFailureCascade('What is a tidal current?');
    expect(result).toMatchObject({ ok: true, source: 'wikipedia' });
    if (result.ok) {
      expect(result.content).toContain('excerpts; verify before relying on them):\n\n');
      expect(result.content).toContain('Tidal current: A moving body of water.');
      expect(result.content).not.toContain('\\\\n');
    }
  });

  it('escapes malformed HTML after removing Wikipedia snippet formatting', () => {
    expect(sanitizeWikipediaSnippet('safe <span class="searchmatch">result</span> <script')).toBe('safe result &lt;script');
    expect(sanitizeWikipediaSnippet('<img src=x onerror=alert(1)>')).toBe('');
  });
});
