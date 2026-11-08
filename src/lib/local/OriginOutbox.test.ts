import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ORIGIN_OUTBOX_MAX_ENTRIES,
  clearOriginOutbox,
  loadOriginOutbox,
  parseOriginOutboxEntries,
  removeOriginOutboxEntry,
  saveOriginOutboxEntry,
  type OriginOutboxEntry,
} from './OriginOutbox';

const entry = (id: string, createdAt: number, text = `request-${id}`): OriginOutboxEntry => ({ id, text, createdAt });

describe('parseOriginOutboxEntries', () => {
  it('keeps valid entries in FIFO (oldest-first) order regardless of storage order', () => {
    const parsed = parseOriginOutboxEntries([entry('b', 200), entry('a', 100), entry('c', 300)]);
    expect(parsed.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops malformed records instead of letting one bad value break the whole outbox', () => {
    const parsed = parseOriginOutboxEntries([
      entry('ok', 100),
      null,
      'junk',
      { id: 42, text: 'numeric id', createdAt: 100 },
      { id: 'no-text', createdAt: 100 },
      { id: 'blank', text: '   ', createdAt: 100 },
      { id: 'no-date', text: 'missing createdAt' },
      { id: 'nan-date', text: 'bad date', createdAt: Number.NaN },
      [],
    ]);
    expect(parsed.map((item) => item.id)).toEqual(['ok']);
  });

  it('keeps only the first occurrence of a duplicated id', () => {
    const parsed = parseOriginOutboxEntries([
      { id: 'dup', text: 'first', createdAt: 200 },
      { id: 'dup', text: 'second', createdAt: 100 },
    ]);
    expect(parsed).toEqual([{ id: 'dup', text: 'first', createdAt: 200 }]);
  });

  it('caps retention at the oldest ORIGIN_OUTBOX_MAX_ENTRIES entries', () => {
    const values = Array.from({ length: ORIGIN_OUTBOX_MAX_ENTRIES + 3 }, (_, index) => entry(`e-${index}`, index + 1));
    const parsed = parseOriginOutboxEntries(values);
    expect(parsed).toHaveLength(ORIGIN_OUTBOX_MAX_ENTRIES);
    expect(parsed[0]?.id).toBe('e-0');
    expect(parsed.at(-1)?.id).toBe(`e-${ORIGIN_OUTBOX_MAX_ENTRIES - 1}`);
  });

  it('returns an empty list for empty input', () => {
    expect(parseOriginOutboxEntries([])).toEqual([]);
  });
});

describe('OriginOutbox storage boundary (IndexedDB unavailable)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fails soft: load resolves empty, save reports false, remove/clear resolve without throwing', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(loadOriginOutbox()).resolves.toEqual([]);
    await expect(saveOriginOutboxEntry(entry('a', 1))).resolves.toBe(false);
    await expect(removeOriginOutboxEntry('a')).resolves.toBeUndefined();
    await expect(clearOriginOutbox()).resolves.toBeUndefined();
  });

  it('rejects saving a malformed entry without touching storage', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(saveOriginOutboxEntry({ id: '', text: 'x', createdAt: 1 })).resolves.toBe(false);
    await expect(saveOriginOutboxEntry({ id: 'a', text: '  ', createdAt: 1 })).resolves.toBe(false);
    await expect(saveOriginOutboxEntry({ id: 'a', text: 'x', createdAt: Number.POSITIVE_INFINITY })).resolves.toBe(false);
  });
});
