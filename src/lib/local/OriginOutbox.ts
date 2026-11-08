/**
 * Durable send outbox for top-screen chat requests that could not start
 * because the device was offline.
 *
 * The outbox deliberately lives in its own IndexedDB database, separate from
 * the conversation snapshot store (OriginIndexedDb): pending sends have a
 * different lifecycle from history, and a failure here must never be able to
 * disturb history persistence. Only the request text is stored — a queued
 * entry means "the user asked for this, but the send pipeline has not taken
 * it yet". Once the existing send queue drains an entry into an actual send,
 * the entry is removed here and the normal in-flight/failure handling owns
 * the request from that point on.
 *
 * Every operation is fail-soft: when IndexedDB is unavailable (private mode,
 * unsupported browser, quota), loads resolve to an empty list and writes
 * report failure instead of throwing, so chat keeps working in memory.
 */
export const ORIGIN_OUTBOX_DB_NAME = 'origin-personal-outbox';
export const ORIGIN_OUTBOX_DB_VERSION = 1;
const ORIGIN_OUTBOX_STORE = 'pending';
/** Oldest-first retention cap; the outbox is a safety net, not an archive. */
export const ORIGIN_OUTBOX_MAX_ENTRIES = 10;

export type OriginOutboxEntry = {
  id: string;
  text: string;
  createdAt: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isOutboxEntry = (value: unknown): value is OriginOutboxEntry => isRecord(value)
  && typeof value.id === 'string' && value.id.length > 0
  && typeof value.text === 'string' && value.text.trim().length > 0
  && typeof value.createdAt === 'number' && Number.isFinite(value.createdAt);

/**
 * Validates raw stored values into queue-ready entries: malformed records
 * are dropped, duplicate ids keep their first occurrence, and the result is
 * sorted oldest-first (FIFO) and capped at ORIGIN_OUTBOX_MAX_ENTRIES.
 */
export const parseOriginOutboxEntries = (values: readonly unknown[]): OriginOutboxEntry[] => {
  const seen = new Set<string>();
  const entries: OriginOutboxEntry[] = [];
  for (const value of values) {
    if (!isOutboxEntry(value) || seen.has(value.id)) continue;
    seen.add(value.id);
    entries.push({ id: value.id, text: value.text, createdAt: value.createdAt });
  }
  entries.sort((a, b) => a.createdAt - b.createdAt);
  return entries.slice(0, ORIGIN_OUTBOX_MAX_ENTRIES);
};

const openOutboxDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  if (typeof indexedDB === 'undefined') { reject(new Error('indexeddb-unavailable')); return; }
  let request: IDBOpenDBRequest;
  try { request = indexedDB.open(ORIGIN_OUTBOX_DB_NAME, ORIGIN_OUTBOX_DB_VERSION); }
  catch (error) { reject(error); return; }
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(ORIGIN_OUTBOX_STORE)) database.createObjectStore(ORIGIN_OUTBOX_STORE);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('indexeddb-open-failed'));
  request.onblocked = () => reject(new Error('indexeddb-blocked'));
});

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('indexeddb-request-failed'));
});

export const loadOriginOutbox = async (): Promise<OriginOutboxEntry[]> => {
  let database: IDBDatabase | null = null;
  try {
    database = await openOutboxDatabase();
    const transaction = database.transaction(ORIGIN_OUTBOX_STORE, 'readonly');
    const values = await requestResult(transaction.objectStore(ORIGIN_OUTBOX_STORE).getAll());
    return parseOriginOutboxEntries(values);
  } catch {
    return [];
  } finally {
    database?.close();
  }
};

export const saveOriginOutboxEntry = async (entry: OriginOutboxEntry): Promise<boolean> => {
  if (!isOutboxEntry(entry)) return false;
  let database: IDBDatabase | null = null;
  try {
    database = await openOutboxDatabase();
    const transaction = database.transaction(ORIGIN_OUTBOX_STORE, 'readwrite');
    await requestResult(transaction.objectStore(ORIGIN_OUTBOX_STORE).put({ id: entry.id, text: entry.text, createdAt: entry.createdAt }, entry.id));
    return true;
  } catch {
    return false;
  } finally {
    database?.close();
  }
};

export const removeOriginOutboxEntry = async (id: string): Promise<void> => {
  let database: IDBDatabase | null = null;
  try {
    database = await openOutboxDatabase();
    const transaction = database.transaction(ORIGIN_OUTBOX_STORE, 'readwrite');
    await requestResult(transaction.objectStore(ORIGIN_OUTBOX_STORE).delete(id));
  } catch { /* Best effort: a stale entry is re-validated on the next load. */ } finally {
    database?.close();
  }
};

export const clearOriginOutbox = async (): Promise<void> => {
  let database: IDBDatabase | null = null;
  try {
    database = await openOutboxDatabase();
    const transaction = database.transaction(ORIGIN_OUTBOX_STORE, 'readwrite');
    await requestResult(transaction.objectStore(ORIGIN_OUTBOX_STORE).clear());
  } catch { /* Best effort, same rationale as removeOriginOutboxEntry. */ } finally {
    database?.close();
  }
};
