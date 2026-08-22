import { describe, expect, it, vi } from 'vitest';
import { decodeOriginSnapshot, encodeOriginSnapshot, isQuotaExceeded, migrateOriginLegacySnapshot, ORIGIN_COMPRESSED_SNAPSHOT_TYPE, ORIGIN_UNCOMPRESSED_SNAPSHOT_TYPE, type OriginPersistedSnapshot, type OriginStorageAdapter } from './OriginIndexedDb';

const snapshot: OriginPersistedSnapshot = { version: 1, messages: [{ id: 'm-1', role: 'user', content: 'persist me' }], sessions: [], artifacts: [{ id: 'a-1', content: '<main>artifact</main>' }], updatedAt: 1 };

describe('OriginIndexedDb migration boundary', () => {
  it('compresses a complete snapshot and restores artifacts, revisions, and messages transparently', async () => {
    const largeSnapshot: OriginPersistedSnapshot = {
      ...snapshot,
      messages: [{ id: 'm-1', role: 'user', content: '履歴'.repeat(2_000) }],
      artifacts: [{ id: 'a-1', content: '<main>' + '成果物'.repeat(5_000) + '</main>', revisions: [{ content: '1つ前の版'.repeat(500) }] }],
    };
    const stored = await encodeOriginSnapshot(largeSnapshot);
    expect([ORIGIN_COMPRESSED_SNAPSHOT_TYPE, ORIGIN_UNCOMPRESSED_SNAPSHOT_TYPE]).toContain(stored.type);
    await expect(decodeOriginSnapshot(stored)).resolves.toEqual(largeSnapshot);
  });

  it('loads legacy uncompressed structured snapshots without rewriting them', async () => {
    await expect(decodeOriginSnapshot(snapshot)).resolves.toBe(snapshot);
  });

  it('accepts uncompressed UTF-8 binary records from fallback browsers', async () => {
    const raw = new TextEncoder().encode(JSON.stringify(snapshot));
    await expect(decodeOriginSnapshot(raw)).resolves.toEqual(snapshot);
  });

  it('rejects corrupt or schema-invalid binary storage fail-closed', async () => {
    await expect(decodeOriginSnapshot(new TextEncoder().encode('{broken'))).resolves.toBeNull();
    await expect(decodeOriginSnapshot(new TextEncoder().encode(JSON.stringify({ version: 1 })))).resolves.toBeNull();
  });

  it('uses a durable IndexedDB snapshot without mutating legacy data', async () => {
    const existing = { ...snapshot, updatedAt: 2 };
    const adapter: OriginStorageAdapter = { load: vi.fn(async () => existing), save: vi.fn(async () => 'saved' as const) };
    const removeLegacy = vi.fn();
    await expect(migrateOriginLegacySnapshot(adapter, snapshot, removeLegacy)).resolves.toEqual({ snapshot: existing, source: 'indexeddb' });
    expect(adapter.save).not.toHaveBeenCalled();
    expect(removeLegacy).not.toHaveBeenCalled();
  });

  it('removes localStorage legacy keys only after IndexedDB confirms a durable write', async () => {
    const adapter: OriginStorageAdapter = { load: vi.fn(async () => null), save: vi.fn(async () => 'saved' as const) };
    const removeLegacy = vi.fn();
    await expect(migrateOriginLegacySnapshot(adapter, snapshot, removeLegacy)).resolves.toMatchObject({ snapshot, source: 'migrated', writeResult: 'saved' });
    expect(removeLegacy).toHaveBeenCalledOnce();
  });

  it('keeps the legacy source intact and continues in memory when quota prevents persistence', async () => {
    const adapter: OriginStorageAdapter = { load: vi.fn(async () => null), save: vi.fn(async () => 'quota' as const) };
    const removeLegacy = vi.fn();
    await expect(migrateOriginLegacySnapshot(adapter, snapshot, removeLegacy)).resolves.toMatchObject({ snapshot, source: 'memory', writeResult: 'quota' });
    expect(removeLegacy).not.toHaveBeenCalled();
  });

  it('recognizes platform quota errors without exposing them to the UI', () => {
    expect(isQuotaExceeded(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaExceeded(new Error('full'))).toBe(false);
  });
});
