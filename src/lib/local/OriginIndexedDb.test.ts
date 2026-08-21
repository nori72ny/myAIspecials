import { describe, expect, it, vi } from 'vitest';
import { isQuotaExceeded, migrateOriginLegacySnapshot, type OriginPersistedSnapshot, type OriginStorageAdapter } from './OriginIndexedDb';

const snapshot: OriginPersistedSnapshot = { version: 1, messages: [{ id: 'm-1', role: 'user', content: 'persist me' }], sessions: [], artifacts: [{ id: 'a-1', content: '<main>artifact</main>' }], updatedAt: 1 };

describe('OriginIndexedDb migration boundary', () => {
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
