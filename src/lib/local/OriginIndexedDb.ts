export const ORIGIN_LOCAL_DB_NAME = 'origin-personal-local';
export const ORIGIN_LOCAL_DB_VERSION = 1;
const ORIGIN_LOCAL_STORE = 'snapshots';
const ORIGIN_LOCAL_SNAPSHOT_KEY = 'primary';

export type OriginPersistedSnapshot = {
  version: 1;
  messages: unknown[];
  sessions: unknown[];
  artifacts: unknown[];
  updatedAt: number;
};

export type OriginStorageWriteResult = 'saved' | 'unavailable' | 'quota' | 'failed';
export type OriginStorageAdapter = {
  load: () => Promise<OriginPersistedSnapshot | null>;
  save: (snapshot: OriginPersistedSnapshot) => Promise<OriginStorageWriteResult>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isSnapshot = (value: unknown): value is OriginPersistedSnapshot => isRecord(value)
  && value.version === 1
  && Array.isArray(value.messages)
  && Array.isArray(value.sessions)
  && Array.isArray(value.artifacts)
  && typeof value.updatedAt === 'number';

export const isQuotaExceeded = (error: unknown) => {
  if (!(error instanceof DOMException)) return false;
  return error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22 || error.code === 1014;
};

const openOriginDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  if (typeof indexedDB === 'undefined') { reject(new Error('indexeddb-unavailable')); return; }
  let request: IDBOpenDBRequest;
  try { request = indexedDB.open(ORIGIN_LOCAL_DB_NAME, ORIGIN_LOCAL_DB_VERSION); }
  catch (error) { reject(error); return; }
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(ORIGIN_LOCAL_STORE)) database.createObjectStore(ORIGIN_LOCAL_STORE);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('indexeddb-open-failed'));
  request.onblocked = () => reject(new Error('indexeddb-blocked'));
});

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('indexeddb-request-failed'));
});

export const originIndexedDbAdapter: OriginStorageAdapter = {
  async load() {
    let database: IDBDatabase | null = null;
    try {
      database = await openOriginDatabase();
      const transaction = database.transaction(ORIGIN_LOCAL_STORE, 'readonly');
      const value = await requestResult(transaction.objectStore(ORIGIN_LOCAL_STORE).get(ORIGIN_LOCAL_SNAPSHOT_KEY));
      return isSnapshot(value) ? value : null;
    } finally {
      database?.close();
    }
  },
  async save(snapshot) {
    let database: IDBDatabase | null = null;
    try {
      database = await openOriginDatabase();
      const transaction = database.transaction(ORIGIN_LOCAL_STORE, 'readwrite');
      await requestResult(transaction.objectStore(ORIGIN_LOCAL_STORE).put(snapshot, ORIGIN_LOCAL_SNAPSHOT_KEY));
      return 'saved';
    } catch (error) {
      return isQuotaExceeded(error) ? 'quota' : typeof indexedDB === 'undefined' ? 'unavailable' : 'failed';
    } finally {
      database?.close();
    }
  },
};

export type OriginMigrationResult = { snapshot: OriginPersistedSnapshot | null; source: 'indexeddb' | 'migrated' | 'memory'; writeResult?: OriginStorageWriteResult; readFailed?: boolean };

export const migrateOriginLegacySnapshot = async (
  adapter: OriginStorageAdapter,
  legacySnapshot: OriginPersistedSnapshot | null,
  removeLegacy: () => void,
): Promise<OriginMigrationResult> => {
  let existing: OriginPersistedSnapshot | null;
  try {
    existing = await adapter.load();
  } catch {
    // An unreadable database may still contain history. Keep the legacy data
    // and prohibit later writes until a new page load successfully restores it.
    return { snapshot: legacySnapshot, source: 'memory', writeResult: 'failed', readFailed: true };
  }
  // Absence of legacy storage means "nothing to migrate", not "an empty, newer snapshot".
  // Returning the durable snapshot without writing prevents reload hydration from erasing history.
  if (!legacySnapshot) return existing ? { snapshot: existing, source: 'indexeddb' } : { snapshot: null, source: 'memory' };
  // A synchronous localStorage journal may be newer than the last completed
  // IndexedDB transaction when a tab is reloaded immediately after a message.
  // Prefer and durably migrate that newer journal instead of restoring stale data.
  if (existing && existing.updatedAt >= legacySnapshot.updatedAt) {
    // A validated durable snapshot that is at least as recent makes the legacy
    // journal redundant. Cleaning it here also makes concurrent StrictMode
    // migration attempts converge on IndexedDB instead of leaving stale keys.
    try { removeLegacy(); } catch { /* Durable IndexedDB data remains authoritative. */ }
    return { snapshot: existing, source: 'indexeddb' };
  }
  const writeResult = await adapter.save(legacySnapshot);
  if (writeResult === 'saved') {
    try { removeLegacy(); } catch { /* Persistence succeeded, so legacy cleanup is best effort only. */ }
    return { snapshot: legacySnapshot, source: 'migrated', writeResult };
  }
  return { snapshot: legacySnapshot, source: 'memory', writeResult };
};
