import { describe, expect, it, vi } from 'vitest';
import { awaitOriginIdbCommit, isQuotaExceeded, migrateOriginLegacySnapshot, originIndexedDbAdapter, type OriginPersistedSnapshot, type OriginStorageAdapter } from './OriginIndexedDb';

const snapshot: OriginPersistedSnapshot = { version: 1, messages: [{ id: 'm-1', role: 'user', content: 'persist me' }], sessions: [], artifacts: [{ id: 'a-1', content: '<main>artifact</main>' }], updatedAt: 1 };

describe('OriginIndexedDb migration boundary', () => {
  it('uses a durable IndexedDB snapshot and cleans the older legacy journal', async () => {
    const existing = { ...snapshot, updatedAt: 2 };
    const adapter: OriginStorageAdapter = { load: vi.fn(async () => existing), save: vi.fn(async () => 'saved' as const) };
    const removeLegacy = vi.fn();
    await expect(migrateOriginLegacySnapshot(adapter, snapshot, removeLegacy)).resolves.toEqual({ snapshot: existing, source: 'indexeddb' });
    expect(adapter.save).not.toHaveBeenCalled();
    expect(removeLegacy).toHaveBeenCalledOnce();
  });

  it('preserves an existing IndexedDB snapshot when no legacy storage exists', async () => {
    const existing = { ...snapshot, sessions: [{ id: 'saved-session' }], updatedAt: 5 };
    const adapter: OriginStorageAdapter = { load: vi.fn(async () => existing), save: vi.fn(async () => 'saved' as const) };
    const removeLegacy = vi.fn();
    await expect(migrateOriginLegacySnapshot(adapter, null, removeLegacy)).resolves.toEqual({ snapshot: existing, source: 'indexeddb' });
    expect(adapter.save).not.toHaveBeenCalled();
    expect(removeLegacy).not.toHaveBeenCalled();
  });

  it('does not synthesize or save an empty snapshot when neither storage source exists', async () => {
    const adapter: OriginStorageAdapter = { load: vi.fn(async () => null), save: vi.fn(async () => 'saved' as const) };
    const removeLegacy = vi.fn();
    await expect(migrateOriginLegacySnapshot(adapter, null, removeLegacy)).resolves.toEqual({ snapshot: null, source: 'memory' });
    expect(adapter.save).not.toHaveBeenCalled();
    expect(removeLegacy).not.toHaveBeenCalled();
  });

  it('removes localStorage legacy keys only after IndexedDB confirms a durable write', async () => {
    const adapter: OriginStorageAdapter = { load: vi.fn(async () => null), save: vi.fn(async () => 'saved' as const) };
    const removeLegacy = vi.fn();
    await expect(migrateOriginLegacySnapshot(adapter, snapshot, removeLegacy)).resolves.toMatchObject({ snapshot, source: 'migrated', writeResult: 'saved' });
    expect(removeLegacy).toHaveBeenCalledOnce();
  });

  it('prefers a newer synchronous journal over a stale IndexedDB snapshot', async () => {
    const stale = { ...snapshot, messages: [{ id: 'old', role: 'user', content: 'old' }], updatedAt: 1 };
    const journal = { ...snapshot, messages: [{ id: 'new', role: 'user', content: 'new' }], updatedAt: 2 };
    const adapter = { load: vi.fn(async () => stale), save: vi.fn(async () => 'saved' as const) };
    const removeLegacy = vi.fn();
    const result = await migrateOriginLegacySnapshot(adapter, journal, removeLegacy);
    expect(result.snapshot).toEqual(journal);
    expect(adapter.save).toHaveBeenCalledWith(journal);
    expect(removeLegacy).toHaveBeenCalledOnce();
  });

  it('keeps the legacy source intact and continues in memory when quota prevents persistence', async () => {
    const adapter: OriginStorageAdapter = { load: vi.fn(async () => null), save: vi.fn(async () => 'quota' as const) };
    const removeLegacy = vi.fn();
    await expect(migrateOriginLegacySnapshot(adapter, snapshot, removeLegacy)).resolves.toMatchObject({ snapshot, source: 'memory', writeResult: 'quota' });
    expect(removeLegacy).not.toHaveBeenCalled();
  });

  it.each([null, snapshot])('does not write or remove legacy data after a failed read (%j)', async (legacy) => {
    const adapter: OriginStorageAdapter = { load: vi.fn(async () => { throw new Error('read-failed'); }), save: vi.fn(async () => 'saved' as const) };
    const removeLegacy = vi.fn();
    await expect(migrateOriginLegacySnapshot(adapter, legacy, removeLegacy)).resolves.toEqual({ snapshot: legacy, source: 'memory', writeResult: 'failed', readFailed: true });
    expect(adapter.save).not.toHaveBeenCalled();
    expect(removeLegacy).not.toHaveBeenCalled();
  });

  it('the live adapter waits for transaction completion after put success', async () => {
    let started!: () => void;
    const start = new Promise<void>(resolve => { started = resolve; });
    const request = { onsuccess: null, onerror: null, result: 'primary', error: null } as unknown as IDBRequest;
    const transaction = {
      oncomplete: null, onabort: null, onerror: null, error: null,
      objectStore: () => ({ put: () => request }),
    } as unknown as IDBTransaction;
    const database = { transaction: () => { started(); return transaction; }, close: () => undefined };
    const openRequest = { result: database, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null } as unknown as IDBOpenDBRequest;
    vi.stubGlobal('indexedDB', {
      open: () => { queueMicrotask(() => openRequest.onsuccess?.call(openRequest, new Event('success'))); return openRequest; },
    });
    try {
      let resolved = false;
      const saving = originIndexedDbAdapter.save(snapshot).then(value => { resolved = true; return value; });
      await start;
      request.onsuccess?.call(request, new Event('success'));
      await Promise.resolve();
      expect(resolved).toBe(false);
      transaction.oncomplete?.call(transaction, new Event('complete'));
      await expect(saving).resolves.toBe('saved');
      expect(resolved).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('serializes overlapping saves so a stale snapshot cannot finish after a newer one', async () => {
    const opened: { request: IDBRequest; transaction: IDBTransaction; snapshot: OriginPersistedSnapshot | null }[] = [];
    vi.stubGlobal('indexedDB', {
      open: () => {
        let written: OriginPersistedSnapshot | null = null;
        const putRequest = { onsuccess: null, onerror: null, error: null } as unknown as IDBRequest;
        const transaction = {
          oncomplete: null, onabort: null, onerror: null, error: null,
          objectStore: () => ({ put: (value: OriginPersistedSnapshot) => { written = value; return putRequest; } }),
        } as unknown as IDBTransaction;
        const db = { transaction: () => transaction, close: () => undefined };
        const openRequest = { result: db, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null } as unknown as IDBOpenDBRequest;
        const item = { request: putRequest, transaction, get snapshot() { return written; } };
        opened.push(item);
        queueMicrotask(() => openRequest.onsuccess?.call(openRequest, new Event('success')));
        return openRequest;
      },
    });
    try {
      const earlier = { ...snapshot, updatedAt: 20 };
      const later = { ...snapshot, updatedAt: 21, messages: [{ id: 'newest' }] };
      const first = originIndexedDbAdapter.save(earlier);
      const second = originIndexedDbAdapter.save(later);
      await vi.waitFor(() => expect(opened[0]?.snapshot).toEqual(earlier));
      expect(opened).toHaveLength(1);
      opened[0].request.onsuccess?.call(opened[0].request, new Event('success'));
      await Promise.resolve();
      expect(opened).toHaveLength(1);
      opened[0].transaction.oncomplete?.call(opened[0].transaction, new Event('complete'));
      await expect(first).resolves.toBe('saved');
      await vi.waitFor(() => expect(opened[1]?.snapshot).toEqual(later));
      opened[1].request.onsuccess?.call(opened[1].request, new Event('success'));
      opened[1].transaction.oncomplete?.call(opened[1].transaction, new Event('complete'));
      await expect(second).resolves.toBe('saved');
      expect(opened).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not acknowledge persistence until the IndexedDB transaction completes', async () => {
    const tx = { oncomplete: null, onabort: null, onerror: null, error: null } as unknown as IDBTransaction;
    let completed = false;
    const saved = awaitOriginIdbCommit(tx).then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    tx.oncomplete?.call(tx, new Event('complete'));
    await saved;
    expect(completed).toBe(true);
  });

  it('treats a late transaction abort as a failed write, never a saved snapshot', async () => {
    const tx = { oncomplete: null, onabort: null, onerror: null, error: null } as unknown as IDBTransaction;
    const pending = awaitOriginIdbCommit(tx);
    tx.onabort?.call(tx, new Event('abort'));
    await expect(pending).rejects.toThrow('indexeddb-aborted');
  });

  it('recognizes platform quota errors without exposing them to the UI', () => {
    expect(isQuotaExceeded(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaExceeded(new Error('full'))).toBe(false);
  });
});
