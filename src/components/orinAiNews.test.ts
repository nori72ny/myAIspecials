import { afterEach, describe, expect, it } from 'vitest';
import {
  clearOrinAiNewsCache,
  getOrinAiNewsCache,
  orinAiNewsDigestUpdatedText,
  orinAiNewsFetchedAtText,
  orinAiNewsRelativeTime,
  parseOrinAiNewsPayload,
  storeOrinAiNewsCache,
} from './orinAiNews';
import { ORIN_AI_NEWS_DIGEST } from './orinAiNewsDigest';

afterEach(() => {
  clearOrinAiNewsCache();
});

describe('orinAiNews payload parsing (expansion design §8.3)', () => {
  it('accepts the endpoint shape and drops malformed entries', () => {
    const payload = parseOrinAiNewsPayload({
      ok: true,
      fetchedAt: '2026-11-25T06:04:00.000Z',
      items: [
        { title: '見出し1', url: 'https://example.com/a', source: 'example.com', publishedAt: '2026-11-25T03:00:00.000Z' },
        { title: 'http は落とす', url: 'http://example.com/b', source: 'example.com' },
        { title: '', url: 'https://example.com/c', source: 'example.com' },
        { title: '見出し2', url: 'https://example.org/d', source: 'example.org', publishedAt: 'not-a-date' },
      ],
    });
    expect(payload?.items).toHaveLength(2);
    expect(payload?.items[0].title).toBe('見出し1');
    expect(payload?.items[1].publishedAt).toBeUndefined();
  });

  it('keeps headlines whose url is null (unresolved redirector, Q7-03) and drops other bad url shapes', () => {
    const payload = parseOrinAiNewsPayload({
      ok: true,
      fetchedAt: '2026-11-25T06:04:00.000Z',
      items: [
        { title: '解決できなかった見出し', url: null, source: 'ITmedia' },
        { title: '数値の url は落とす', url: 42, source: 'example.com' },
      ],
    });
    expect(payload?.items).toHaveLength(1);
    expect(payload?.items[0].title).toBe('解決できなかった見出し');
    expect(payload?.items[0].url).toBeNull();
  });

  it('rejects payloads that are not the ok shape', () => {
    expect(parseOrinAiNewsPayload({ ok: false, fetchedAt: '2026-11-25T06:04:00.000Z', items: [] })).toBeNull();
    expect(parseOrinAiNewsPayload(null)).toBeNull();
    expect(parseOrinAiNewsPayload({ ok: true, fetchedAt: 'nope', items: [] })).toBeNull();
  });

  it('caps the list at seven headlines', () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      title: `見出し${index}`, url: `https://example${index}.com/`, source: `example${index}.com`,
    }));
    expect(parseOrinAiNewsPayload({ ok: true, fetchedAt: '2026-11-25T06:04:00.000Z', items })?.items).toHaveLength(7);
  });
});

describe('orinAiNews session cache (§8.4: memory only, 30 minutes)', () => {
  const payload = { fetchedAt: '2026-11-25T06:00:00.000Z', items: [] };

  it('reuses a fetch within 30 minutes and expires it afterwards', () => {
    const fetched = new Date(payload.fetchedAt).getTime();
    storeOrinAiNewsCache(payload);
    expect(getOrinAiNewsCache(fetched + 29 * 60 * 1000)).toBe(payload);
    expect(getOrinAiNewsCache(fetched + 31 * 60 * 1000)).toBeNull();
  });

  it('is empty before any fetch', () => {
    expect(getOrinAiNewsCache(Date.now())).toBeNull();
  });
});

describe('orinAiNews time texts', () => {
  const now = new Date('2026-11-25T06:04:00.000Z').getTime();

  it('renders relative times in plain words', () => {
    expect(orinAiNewsRelativeTime('2026-11-25T06:02:00.000Z', now, true)).toBe('たった今');
    expect(orinAiNewsRelativeTime('2026-11-25T05:34:00.000Z', now, true)).toBe('30分前');
    expect(orinAiNewsRelativeTime('2026-11-25T03:04:00.000Z', now, true)).toBe('3時間前');
    expect(orinAiNewsRelativeTime('2026-11-23T06:04:00.000Z', now, true)).toBe('2日前');
    expect(orinAiNewsRelativeTime(undefined, now, true)).toBeNull();
    expect(orinAiNewsRelativeTime('not-a-date', now, true)).toBeNull();
  });

  it('renders the digest updated date and the fetch time', () => {
    expect(orinAiNewsDigestUpdatedText('2026-11-25', true)).toBe('11月25日更新');
    expect(orinAiNewsDigestUpdatedText('2026-11-25', false)).toBe('Updated Nov 25');
    expect(orinAiNewsDigestUpdatedText('25/11/2026', true)).toBeNull();
    const fetched = orinAiNewsFetchedAtText('2026-11-25T06:04:00.000Z', true);
    expect(fetched).toMatch(/^\d{2}:\d{2} 時点$/);
  });
});

describe('orinAiNewsDigest (expansion design §8.2)', () => {
  it('carries 3-5 items, every one with a primary-source link and a short summary', () => {
    expect(ORIN_AI_NEWS_DIGEST.items.length).toBeGreaterThanOrEqual(3);
    expect(ORIN_AI_NEWS_DIGEST.items.length).toBeLessThanOrEqual(5);
    for (const item of ORIN_AI_NEWS_DIGEST.items) {
      expect(item.sourceUrl).toMatch(/^https:\/\//);
      expect(item.sourceName.length).toBeGreaterThan(0);
      // 要約は2行まで（目安80〜110字）。大きく外れるものは置かない。
      expect(item.summary.ja.length).toBeGreaterThanOrEqual(60);
      expect(item.summary.ja.length).toBeLessThanOrEqual(120);
      expect(item.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(ORIN_AI_NEWS_DIGEST.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
