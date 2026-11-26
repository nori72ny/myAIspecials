import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isQuotaExceeded, migrateOriginLegacySnapshot, originIndexedDbAdapter, type OriginPersistedSnapshot, type OriginStorageAdapter } from './OriginIndexedDb';

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

  it('recognizes platform quota errors without exposing them to the UI', () => {
    expect(isQuotaExceeded(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaExceeded(new Error('full'))).toBe(false);
  });
  it('fails closed with an explicit unavailable result when IndexedDB is absent', async () => {
    vi.stubGlobal('indexedDB', undefined);
    try {
      await expect(originIndexedDbAdapter.load()).rejects.toThrow('indexeddb-unavailable');
      await expect(originIndexedDbAdapter.save(snapshot)).resolves.toBe('unavailable');
    } finally {
      vi.unstubAllGlobals();
    }
  });

});

// --- S3: encrypted history storage -------------------------------------------
//
// Minimal in-memory IndexedDB fake covering exactly the surface the history
// store uses (open/upgrade, get/put/delete), modeled on the fake in
// activeContextGraph.test.ts. WebCrypto is Node's webcrypto. Every test
// loads a fresh module instance so the module-level key cache starts clean.

class S3FakeRequest<T> {
  result!: T;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
}

class S3FakeObjectStore {
  constructor(private readonly data: Map<string, unknown>) {}

  get(key: string): S3FakeRequest<unknown> {
    const request = new S3FakeRequest<unknown>();
    queueMicrotask(() => {
      request.result = this.data.get(key);
      request.onsuccess?.();
    });
    return request;
  }

  put(value: unknown, key: string): S3FakeRequest<undefined> {
    const request = new S3FakeRequest<undefined>();
    queueMicrotask(() => {
      this.data.set(key, value);
      request.onsuccess?.();
    });
    return request;
  }

  delete(key: string): S3FakeRequest<undefined> {
    const request = new S3FakeRequest<undefined>();
    queueMicrotask(() => {
      this.data.delete(key);
      request.onsuccess?.();
    });
    return request;
  }
}

class S3FakeDb {
  private readonly stores = new Map<string, Map<string, unknown>>();
  upgraded = false;
  readonly objectStoreNames = {
    contains: (name: string): boolean => this.stores.has(name),
  };

  createObjectStore(name: string): void {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
  }

  storeData(name: string): Map<string, unknown> {
    this.createObjectStore(name);
    return this.stores.get(name)!;
  }

  transaction(name: string): { objectStore: (store: string) => S3FakeObjectStore } {
    return { objectStore: (store: string) => new S3FakeObjectStore(this.storeData(store ?? name)) };
  }

  close(): void { /* no-op */ }
}

type S3Module = typeof import('./OriginIndexedDb');
type S3Derivation = typeof import('../../security/passkeyKeyDerivation');

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

async function decryptEnvelope(key: CryptoKey, payload: { iv: string; ciphertext: string }): Promise<string> {
  const plaintext = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(payload.iv) }, key, base64ToBytes(payload.ciphertext));
  return new TextDecoder().decode(plaintext);
}

describe('OriginIndexedDb encrypted history (S3)', () => {
  let db: S3FakeDb;
  let mod: S3Module;
  let derivation: S3Derivation;

  const rawRecord = (key = 'primary') => db.storeData('snapshots').get(key);

  beforeEach(async () => {
    db = new S3FakeDb();
    const fakeIndexedDB = {
      open(): S3FakeRequest<S3FakeDb> {
        const request = new S3FakeRequest<S3FakeDb>();
        queueMicrotask(() => {
          request.result = db;
          if (!db.upgraded) {
            db.upgraded = true;
            request.onupgradeneeded?.();
          }
          request.onsuccess?.();
        });
        return request;
      },
    };
    vi.stubGlobal('indexedDB', fakeIndexedDB);
    vi.stubGlobal('crypto', webcrypto);
    vi.resetModules();
    mod = await import('./OriginIndexedDb');
    derivation = await import('../../security/passkeyKeyDerivation');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves the snapshot encrypted at rest and loads it back', async () => {
    await expect(mod.originIndexedDbAdapter.save(snapshot)).resolves.toBe('saved');
    const raw = rawRecord() as { version: number; iv: string; ciphertext: string };
    expect(typeof raw.iv).toBe('string');
    expect(typeof raw.ciphertext).toBe('string');
    expect(JSON.stringify(raw)).not.toContain('persist me');
    await expect(mod.originIndexedDbAdapter.load()).resolves.toEqual(snapshot);
  });

  it('returns null when nothing is stored', async () => {
    await expect(mod.originIndexedDbAdapter.load()).resolves.toBeNull();
  });

  it('migrates a legacy plaintext record to encryption on load', async () => {
    db.storeData('snapshots').set('primary', snapshot);
    await expect(mod.originIndexedDbAdapter.load()).resolves.toEqual(snapshot);
    const raw = rawRecord() as { iv: string; ciphertext: string };
    expect(typeof raw.ciphertext).toBe('string');
    expect(JSON.stringify(raw)).not.toContain('persist me');
  });

  it('rejects a record no available key can decrypt and leaves it untouched', async () => {
    const foreignKey = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, foreignKey, new TextEncoder().encode(JSON.stringify(snapshot)));
    const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
    const sealed = { version: 1, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
    db.storeData('snapshots').set('primary', sealed);
    await expect(mod.originIndexedDbAdapter.load()).rejects.toThrow();
    expect(rawRecord()).toEqual(sealed);
  });

  it('rejects an unrecognized stored value instead of treating it as empty', async () => {
    db.storeData('snapshots').set('primary', { unrelated: 'shape' });
    await expect(mod.originIndexedDbAdapter.load()).rejects.toThrow('history-format-unrecognized');
    expect(rawRecord()).toEqual({ unrelated: 'shape' });
  });

  it('round-trips journal text through the history encryption helpers', async () => {
    const text = JSON.stringify({ version: 1, messages: snapshot.messages, updatedAt: 7 });
    const encrypted = await mod.encryptHistoryText(text);
    expect(mod.isEncryptedHistoryText(encrypted)).toBe(true);
    expect(encrypted).not.toContain('persist me');
    await expect(mod.decryptHistoryText(encrypted)).resolves.toBe(text);
    expect(mod.isEncryptedHistoryText(text)).toBe(false);
  });

  it('never falls back to a plaintext save when WebCrypto is unavailable', async () => {
    vi.stubGlobal('crypto', {});
    await expect(mod.originIndexedDbAdapter.save(snapshot)).resolves.toBe('failed');
    expect(rawRecord()).toBeUndefined();
  });

  it('migrates a plaintext record to the passkey key with backup, rollback, and cleanup', async () => {
    const targetKey = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    db.storeData('snapshots').set('primary', snapshot);

    await expect(mod.migrateHistoryToEncryptionKey(targetKey)).resolves.toEqual({ migrated: true });
    expect(rawRecord('primary:migration')).toBeUndefined();
    const sealed = rawRecord() as { iv: string; ciphertext: string };
    await expect(decryptEnvelope(targetKey, sealed)).resolves.toBe(JSON.stringify(snapshot));
    expect(rawRecord('primary:legacy-backup')).toEqual(snapshot);

    // While the passkey is locked the migrated record cannot be read, and
    // the failed read leaves it untouched; once unlocked it loads again.
    await expect(mod.originIndexedDbAdapter.load()).rejects.toThrow();
    expect(rawRecord()).toEqual(sealed);
    derivation.setUnlockedPasskeyKey(targetKey);
    await expect(mod.originIndexedDbAdapter.load()).resolves.toEqual(snapshot);
    derivation.setUnlockedPasskeyKey(null);

    await mod.rollbackHistoryKeyMigration();
    expect(rawRecord()).toEqual(snapshot);

    await expect(mod.migrateHistoryToEncryptionKey(targetKey)).resolves.toEqual({ migrated: true });
    await mod.clearHistoryMigrationBackup();
    expect(rawRecord('primary:legacy-backup')).toBeUndefined();
  });

  it('migrates a device-key record to the passkey key and skips a repeated migration', async () => {
    const targetKey = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await expect(mod.originIndexedDbAdapter.save(snapshot)).resolves.toBe('saved');
    const localKey = db.storeData('snapshots').get('aes-gcm-256') as CryptoKey;
    expect(localKey).toBeTruthy();

    await expect(mod.migrateHistoryToEncryptionKey(targetKey)).resolves.toEqual({ migrated: true });
    const sealed = rawRecord() as { iv: string; ciphertext: string };
    await expect(decryptEnvelope(targetKey, sealed)).resolves.toBe(JSON.stringify(snapshot));
    await expect(decryptEnvelope(localKey, sealed)).rejects.toThrow();

    // Already readable only by the target key: a second migration is a
    // no-op and must not overwrite the backup of the original record.
    const backup = rawRecord('primary:legacy-backup');
    await expect(mod.migrateHistoryToEncryptionKey(targetKey)).resolves.toEqual({ migrated: false });
    expect(rawRecord()).toEqual(sealed);
    expect(rawRecord('primary:legacy-backup')).toEqual(backup);
  });

  it('reports no migration when no history is stored', async () => {
    const targetKey = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await expect(mod.migrateHistoryToEncryptionKey(targetKey)).resolves.toEqual({ migrated: false });
  });
});
