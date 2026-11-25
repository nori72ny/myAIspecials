// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckpointState } from '../agent/checkpointManager';
import type { OriginProfileItem } from '../services/activeContextGraph';

// Integration tests for the passkey migration orchestrator. Until this
// PR the passkey modules had no test coverage at all, and a successful
// migration left its pre-migration backups — ciphertexts readable with
// the weaker device-local key — behind forever. These tests pin the
// hardened behavior end to end against the real stores:
//   1. both stores migrate to the target (passkey) key,
//   2. the weaker-key backups are removed once migration succeeds,
//   3. rollback can no longer resurrect the weaker-key copies,
//   4. the migrated records open only with the passkey key,
//   5. running the migration again is a no-op success (idempotent).

const USER_ID = 'user-1';
const CHECKPOINT_DB_NAME = 'origin-agent-checkpoints-v1';
const CHECKPOINT_STORE_NAME = 'checkpoints';

// --- Minimal IndexedDB fake (get / put / delete, multiple databases) --------

class FakeRequest<T> {
  result!: T;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
}

class FakeObjectStore {
  constructor(
    private readonly data: Map<string, unknown>,
    private readonly tx: FakeTransaction,
  ) {}

  get(key: string): FakeRequest<unknown> {
    const request = new FakeRequest<unknown>();
    queueMicrotask(() => {
      request.result = this.data.get(key);
      request.onsuccess?.();
    });
    return request;
  }

  put(value: unknown, key: string): FakeRequest<undefined> {
    const request = new FakeRequest<undefined>();
    queueMicrotask(() => {
      this.data.set(key, value);
      request.onsuccess?.();
      queueMicrotask(() => this.tx.oncomplete?.());
    });
    return request;
  }

  delete(key: string): FakeRequest<undefined> {
    const request = new FakeRequest<undefined>();
    queueMicrotask(() => {
      this.data.delete(key);
      request.onsuccess?.();
      queueMicrotask(() => this.tx.oncomplete?.());
    });
    return request;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: unknown = null;

  constructor(private readonly db: FakeDb, private readonly storeName: string) {}

  objectStore(name: string): FakeObjectStore {
    return new FakeObjectStore(this.db.storeData(name), this);
  }
}

class FakeDb {
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

  transaction(storeName: string, _mode: string): FakeTransaction {
    return new FakeTransaction(this, storeName);
  }
}

let databases: Map<string, FakeDb>;

function getDb(name: string): FakeDb {
  let db = databases.get(name);
  if (!db) {
    db = new FakeDb();
    databases.set(name, db);
  }
  return db;
}

const fakeIndexedDB = {
  open(name: string, _version?: number): FakeRequest<FakeDb> {
    const request = new FakeRequest<FakeDb>();
    const db = getDb(name);
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

// --- Fixtures ------------------------------------------------------------------

function profileItem(overrides: Partial<OriginProfileItem> = {}): OriginProfileItem {
  return {
    id: 'profile-1',
    category: 'preference',
    text: '短くまとめてほしい',
    sendToModel: true,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function checkpointFixture(): CheckpointState {
  return {
    checkpointId: 'checkpoint-1',
    taskId: 'task-1',
    executionId: 'execution-1',
    version: 1,
    status: 'completed',
    artifact: '成果物',
    createdAt: 1_000,
  } as CheckpointState;
}

async function loadModules() {
  vi.resetModules();
  const graph = await import('../services/activeContextGraph');
  const checkpoints = await import('../agent/indexedDbCheckpointStore');
  const migration = await import('./passkeyKeyMigration');
  const derivation = await import('./passkeyKeyDerivation');
  return { graph, checkpoints, migration, derivation };
}

async function generateTargetKey(): Promise<CryptoKey> {
  return webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

beforeEach(() => {
  databases = new Map();
  window.localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('indexedDB', fakeIndexedDB);
});

// --- Tests -----------------------------------------------------------------------

describe('passkey migration hardening', () => {
  it('migrates both stores and removes the weaker-key backups', async () => {
    const { graph, checkpoints, migration, derivation } = await loadModules();
    await graph.upsertProfileItem(USER_ID, profileItem());
    await checkpoints.saveCheckpointToIndexedDB(checkpointFixture());

    const targetKey = await generateTargetKey();
    const result = await migration.migrateToPasskeyEncryption(targetKey);
    expect(result).toEqual({ checkpoints: true, activeContext: 1 });

    // The pre-migration backups — copies readable with the device-local
    // key — are gone from both stores.
    const localKeys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key) localKeys.push(key);
    }
    expect(localKeys.some((key) => key.includes('legacy-v1'))).toBe(false);
    const checkpointRecords = getDb(CHECKPOINT_DB_NAME).storeData(CHECKPOINT_STORE_NAME);
    expect(checkpointRecords.has('workspace:legacy-backup')).toBe(false);
    expect(checkpointRecords.has('workspace')).toBe(true);

    // Rollback can no longer resurrect the weaker-key copies.
    await checkpoints.rollbackCheckpointKeyMigration();
    await graph.rollbackActiveContextKeyMigration();

    // Without the passkey key the migrated records no longer open…
    expect(await checkpoints.loadCheckpointsFromIndexedDB()).toEqual([]);
    // …and with it unlocked they open exactly as before.
    derivation.setUnlockedPasskeyKey(targetKey);
    const loaded = await checkpoints.loadCheckpointsFromIndexedDB();
    expect(loaded.map((item) => item.checkpointId)).toEqual(['checkpoint-1']);
    const profile = await graph.listProfileItems(USER_ID);
    expect(profile.map((item) => item.id)).toEqual(['profile-1']);
  });

  it('keeps the migrated records closed to the local key after a fresh start', async () => {
    const { graph, checkpoints, migration } = await loadModules();
    await graph.upsertProfileItem(USER_ID, profileItem());
    await checkpoints.saveCheckpointToIndexedDB(checkpointFixture());

    const targetKey = await generateTargetKey();
    await migration.migrateToPasskeyEncryption(targetKey);

    // Fresh module instances (new page load): the in-memory passkey key
    // is gone, so only the device-local key remains — and it must not be
    // able to open the migrated personal memory any more.
    const fresh = await loadModules();
    expect(await fresh.graph.listProfileItems(USER_ID)).toEqual([]);

    fresh.derivation.setUnlockedPasskeyKey(targetKey);
    const profile = await fresh.graph.listProfileItems(USER_ID);
    expect(profile.map((item) => item.id)).toEqual(['profile-1']);
  });

  it('is idempotent: a second migration succeeds and changes nothing', async () => {
    const { graph, checkpoints, migration } = await loadModules();
    await graph.upsertProfileItem(USER_ID, profileItem());
    await checkpoints.saveCheckpointToIndexedDB(checkpointFixture());

    const targetKey = await generateTargetKey();
    await migration.migrateToPasskeyEncryption(targetKey);
    const again = await migration.migrateToPasskeyEncryption(targetKey);
    expect(again).toEqual({ checkpoints: false, activeContext: 0 });

    const localKeys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key) localKeys.push(key);
    }
    expect(localKeys.some((key) => key.includes('legacy-v1'))).toBe(false);
  });
});
