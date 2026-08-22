import { compressText, decompressText, isGzipCompressed } from '../../utils/compression';

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

export const ORIGIN_COMPRESSED_SNAPSHOT_TYPE = 'application/vnd.origin.snapshot+gzip';
export const ORIGIN_UNCOMPRESSED_SNAPSHOT_TYPE = 'application/vnd.origin.snapshot+json';

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isSnapshot = (value: unknown): value is OriginPersistedSnapshot => isRecord(value)
  && value.version === 1
  && Array.isArray(value.messages)
  && Array.isArray(value.sessions)
  && Array.isArray(value.artifacts)
  && typeof value.updatedAt === 'number';

const bytesFromStoredValue = async (value: unknown): Promise<Uint8Array | null> => {
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
};

export const encodeOriginSnapshot = async (snapshot: OriginPersistedSnapshot): Promise<Blob> => {
  const payload = await compressText(JSON.stringify(snapshot));
  const data = new Uint8Array(payload).buffer;
  return new Blob([data], {
    type: isGzipCompressed(payload) ? ORIGIN_COMPRESSED_SNAPSHOT_TYPE : ORIGIN_UNCOMPRESSED_SNAPSHOT_TYPE,
  });
};

export const decodeOriginSnapshot = async (value: unknown): Promise<OriginPersistedSnapshot | null> => {
  // Phase 21 and earlier stored the structured object directly. This branch is
  // intentionally retained so existing device-local histories migrate in place.
  if (isSnapshot(value)) return value;
  const bytes = await bytesFromStoredValue(value);
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(await decompressText(bytes)) as unknown;
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

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
      return await decodeOriginSnapshot(value);
    } catch {
      return null;
    } finally {
      database?.close();
    }
  },
  async save(snapshot) {
    let database: IDBDatabase | null = null;
    try {
      // Complete asynchronous compression before opening the transaction.
      // IndexedDB may auto-commit a transaction while no request is pending.
      const storedSnapshot = await encodeOriginSnapshot(snapshot);
      database = await openOriginDatabase();
      const transaction = database.transaction(ORIGIN_LOCAL_STORE, 'readwrite');
      await requestResult(transaction.objectStore(ORIGIN_LOCAL_STORE).put(storedSnapshot, ORIGIN_LOCAL_SNAPSHOT_KEY));
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('indexeddb-transaction-aborted'));
        transaction.onerror = () => reject(transaction.error ?? new Error('indexeddb-transaction-failed'));
      });
      return 'saved';
    } catch (error) {
      return isQuotaExceeded(error) ? 'quota' : typeof indexedDB === 'undefined' ? 'unavailable' : 'failed';
    } finally {
      database?.close();
    }
  },
};

export type OriginMigrationResult = { snapshot: OriginPersistedSnapshot | null; source: 'indexeddb' | 'migrated' | 'memory'; writeResult?: OriginStorageWriteResult };

export const migrateOriginLegacySnapshot = async (
  adapter: OriginStorageAdapter,
  legacySnapshot: OriginPersistedSnapshot,
  removeLegacy: () => void,
): Promise<OriginMigrationResult> => {
  const existing = await adapter.load();
  if (existing) return { snapshot: existing, source: 'indexeddb' };
  const writeResult = await adapter.save(legacySnapshot);
  if (writeResult === 'saved') {
    try { removeLegacy(); } catch { /* Persistence succeeded, so legacy cleanup is best effort only. */ }
    return { snapshot: legacySnapshot, source: 'migrated', writeResult };
  }
  return { snapshot: legacySnapshot, source: 'memory', writeResult };
};
