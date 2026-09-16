import {
  verifyVisualBlobSha256V15,
  type VisualRasterPresetV15,
} from './localVisualExportV15';

export const CREATIVE_HISTORY_DB_NAME_V15 = 'origin-creative-local-v1';
export const CREATIVE_HISTORY_LIMIT_V15 = 12;
const CREATIVE_HISTORY_DB_VERSION_V15 = 1;
const CREATIVE_HISTORY_STORE_V15 = 'artifacts';
const MAX_SVG_BYTES = 512 * 1024;
const MAX_TITLE_LENGTH = 240;
const MAX_FILENAME_LENGTH = 180;
const SHA256 = /^[a-f0-9]{64}$/i;
const SAFE_FILENAME = /^[^\\/\u0000-\u001f\u007f]{1,180}\.svg$/i;
const PRESETS = new Set<VisualRasterPresetV15>(['square', 'portrait', 'story', 'landscape']);

export type CreativeHistoryEntryV15 = {
  version: 1;
  id: string;
  sha256: string;
  title: string;
  preset: VisualRasterPresetV15;
  downloadName: string;
  createdAt: number;
  svgBlob: Blob;
};

export type CreativeHistorySaveInputV15 = {
  sha256: string;
  title: string;
  preset: VisualRasterPresetV15;
  downloadName: string;
  svgBlob: Blob;
  createdAt?: number;
};

export type CreativeHistoryLoadResultV15 = {
  status: 'ready' | 'unavailable' | 'failed';
  entries: CreativeHistoryEntryV15[];
};

export type CreativeHistorySaveResultV15 =
  | { status: 'saved'; entry: CreativeHistoryEntryV15 }
  | { status: 'unavailable' | 'quota' | 'failed' };

export type CreativeHistoryDeleteResultV15 = 'deleted' | 'unavailable' | 'failed';

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value);

const isQuotaExceeded = (error: unknown) => error instanceof DOMException
  && (error.name === 'QuotaExceededError'
    || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || error.code === 22
    || error.code === 1014);

export function isCreativeHistoryEntryShapeV15(value: unknown): value is CreativeHistoryEntryV15 {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (typeof value.id !== 'string' || !SHA256.test(value.id)) return false;
  if (typeof value.sha256 !== 'string' || !SHA256.test(value.sha256) || value.id.toLowerCase() !== value.sha256.toLowerCase()) return false;
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > MAX_TITLE_LENGTH) return false;
  if (typeof value.preset !== 'string' || !PRESETS.has(value.preset as VisualRasterPresetV15)) return false;
  if (typeof value.downloadName !== 'string' || value.downloadName.length > MAX_FILENAME_LENGTH || !SAFE_FILENAME.test(value.downloadName)) return false;
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt) || value.createdAt <= 0) return false;
  if (!(value.svgBlob instanceof Blob) || value.svgBlob.size <= 0 || value.svgBlob.size > MAX_SVG_BYTES) return false;
  return value.svgBlob.type.toLowerCase().includes('image/svg+xml');
}

export function selectNewestCreativeHistoryV15(
  entries: CreativeHistoryEntryV15[],
  limit = CREATIVE_HISTORY_LIMIT_V15,
): CreativeHistoryEntryV15[] {
  return [...entries]
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, Math.min(CREATIVE_HISTORY_LIMIT_V15, Math.floor(limit))));
}

function createHistoryEntry(input: CreativeHistorySaveInputV15): CreativeHistoryEntryV15 | null {
  const sha256 = input.sha256.toLowerCase();
  const title = input.title.normalize('NFKC').trim();
  const downloadName = input.downloadName.normalize('NFKC').trim();
  const candidate: CreativeHistoryEntryV15 = {
    version: 1,
    id: sha256,
    sha256,
    title,
    preset: input.preset,
    downloadName,
    createdAt: input.createdAt ?? Date.now(),
    svgBlob: input.svgBlob,
  };
  return isCreativeHistoryEntryShapeV15(candidate) ? candidate : null;
}

function openCreativeHistoryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb-unavailable'));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(CREATIVE_HISTORY_DB_NAME_V15, CREATIVE_HISTORY_DB_VERSION_V15);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CREATIVE_HISTORY_STORE_V15)) {
        database.createObjectStore(CREATIVE_HISTORY_STORE_V15, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('creative-history-open-failed'));
    request.onblocked = () => reject(new Error('creative-history-open-blocked'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('creative-history-request-failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('creative-history-transaction-failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('creative-history-transaction-aborted'));
  });
}

async function readRawEntries(database: IDBDatabase): Promise<unknown[]> {
  const transaction = database.transaction(CREATIVE_HISTORY_STORE_V15, 'readonly');
  const done = transactionDone(transaction);
  const values = await requestResult(transaction.objectStore(CREATIVE_HISTORY_STORE_V15).getAll());
  await done;
  return values as unknown[];
}

async function pruneRawHistory(database: IDBDatabase, keep: number): Promise<void> {
  const raw = await readRawEntries(database);
  const shaped = raw.filter(isCreativeHistoryEntryShapeV15);
  const retained = new Set(selectNewestCreativeHistoryV15(shaped, keep).map(entry => entry.id));
  const deleteIds = shaped.filter(entry => !retained.has(entry.id)).map(entry => entry.id);
  if (deleteIds.length === 0) return;
  const transaction = database.transaction(CREATIVE_HISTORY_STORE_V15, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(CREATIVE_HISTORY_STORE_V15);
  for (const id of deleteIds) store.delete(id);
  await done;
}

export async function loadCreativeHistoryV15(): Promise<CreativeHistoryLoadResultV15> {
  if (typeof indexedDB === 'undefined') return { status: 'unavailable', entries: [] };
  let database: IDBDatabase | null = null;
  try {
    database = await openCreativeHistoryDatabase();
    const raw = await readRawEntries(database);
    const shaped = raw.filter(isCreativeHistoryEntryShapeV15);
    const verified: CreativeHistoryEntryV15[] = [];
    for (const entry of shaped) {
      if (await verifyVisualBlobSha256V15(entry.svgBlob, entry.sha256)) verified.push(entry);
    }
    return { status: 'ready', entries: selectNewestCreativeHistoryV15(verified) };
  } catch {
    return { status: 'failed', entries: [] };
  } finally {
    database?.close();
  }
}

export async function saveCreativeHistoryV15(input: CreativeHistorySaveInputV15): Promise<CreativeHistorySaveResultV15> {
  if (typeof indexedDB === 'undefined') return { status: 'unavailable' };
  const entry = createHistoryEntry(input);
  if (!entry) return { status: 'failed' };
  try {
    if (!(await verifyVisualBlobSha256V15(entry.svgBlob, entry.sha256))) return { status: 'failed' };
  } catch {
    return { status: 'failed' };
  }

  let database: IDBDatabase | null = null;
  try {
    database = await openCreativeHistoryDatabase();
    const transaction = database.transaction(CREATIVE_HISTORY_STORE_V15, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(CREATIVE_HISTORY_STORE_V15).put(entry);
    await done;
    await pruneRawHistory(database, CREATIVE_HISTORY_LIMIT_V15);
    return { status: 'saved', entry };
  } catch (error) {
    return { status: isQuotaExceeded(error) ? 'quota' : 'failed' };
  } finally {
    database?.close();
  }
}

export async function deleteCreativeHistoryV15(id: string): Promise<CreativeHistoryDeleteResultV15> {
  if (typeof indexedDB === 'undefined') return 'unavailable';
  if (!SHA256.test(id)) return 'failed';
  let database: IDBDatabase | null = null;
  try {
    database = await openCreativeHistoryDatabase();
    const transaction = database.transaction(CREATIVE_HISTORY_STORE_V15, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(CREATIVE_HISTORY_STORE_V15).delete(id.toLowerCase());
    await done;
    return 'deleted';
  } catch {
    return 'failed';
  } finally {
    database?.close();
  }
}
