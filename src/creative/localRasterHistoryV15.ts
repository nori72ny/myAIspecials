import type { VisualIntentPurposeV15, VisualIntentStyleV15 } from './visualIntentCompilerV15';

const DB_NAME = 'origin-raster-visual-local-v1';
const STORE_NAME = 'images';
const DB_VERSION = 1;
const MAX_ENTRIES = 12;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/i;
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const SAFE_FILE = /^[^\\/\u0000-\u001f\u007f]{1,180}\.(?:png|jpe?g|webp)$/i;

export type RasterAssetRelationV15 = 'generated' | 'variation' | 'edited-from';

export type RasterAssetEntryV15 = {
  version: 1;
  id: string;
  sha256: string;
  createdAt: number;
  prompt: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  downloadName: string;
  providerId: 'pollinations-zero-cost';
  model: string;
  generationId: string;
  relation: RasterAssetRelationV15;
  parentId?: string;
  width: number;
  height: number;
  purpose: VisualIntentPurposeV15;
  style: VisualIntentStyleV15;
  orientation: 'square' | 'portrait' | 'landscape';
  typographyOverlay: boolean;
  blob: Blob;
};

export type RasterAssetSaveInputV15 = Omit<RasterAssetEntryV15, 'version' | 'id'>;

export type RasterAssetLoadResultV15 =
  | { status: 'ready'; entry: RasterAssetEntryV15 | null }
  | { status: 'unavailable' | 'failed'; entry: null };

export type RasterAssetListResultV15 =
  | { status: 'ready'; entries: RasterAssetEntryV15[] }
  | { status: 'unavailable' | 'failed'; entries: [] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

async function sha256Blob(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('sha256-unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isRasterAssetEntryShapeV15(value: unknown): value is RasterAssetEntryV15 {
  if (!isRecord(value) || value.version !== 1) return false;
  if (typeof value.id !== 'string' || !SHA256.test(value.id)) return false;
  if (typeof value.sha256 !== 'string' || !SHA256.test(value.sha256) || value.id.toLowerCase() !== value.sha256.toLowerCase()) return false;
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt) || value.createdAt <= 0) return false;
  if (typeof value.prompt !== 'string' || value.prompt.length > 2_000) return false;
  if (typeof value.mimeType !== 'string' || !MIME_TYPES.has(value.mimeType)) return false;
  if (typeof value.downloadName !== 'string' || !SAFE_FILE.test(value.downloadName)) return false;
  if (value.providerId !== 'pollinations-zero-cost') return false;
  if (typeof value.model !== 'string' || !value.model || value.model.length > 180) return false;
  if (typeof value.generationId !== 'string' || !/^raster-[a-f0-9]{24}$/i.test(value.generationId)) return false;
  if (!['generated', 'variation', 'edited-from'].includes(String(value.relation))) return false;
  if (value.parentId !== undefined && (typeof value.parentId !== 'string' || !SHA256.test(value.parentId))) return false;
  if (typeof value.width !== 'number' || !Number.isInteger(value.width) || value.width < 256 || value.width > 1536) return false;
  if (typeof value.height !== 'number' || !Number.isInteger(value.height) || value.height < 256 || value.height > 1536) return false;
  if (!['portrait','product-ad','social-post','poster','thumbnail','infographic','landscape','illustration','general'].includes(String(value.purpose))) return false;
  if (!['photorealistic','editorial','cinematic','minimal','anime','manga','watercolor','oil-painting','3d','vector-like','unspecified'].includes(String(value.style))) return false;
  if (!['square','portrait','landscape'].includes(String(value.orientation))) return false;
  if (typeof value.typographyOverlay !== 'boolean') return false;
  if (!(value.blob instanceof Blob) || value.blob.size <= 0 || value.blob.size > MAX_IMAGE_BYTES) return false;
  return value.blob.type === value.mimeType;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('indexeddb-unavailable'));
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (error) { return reject(error); }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('raster-history-open-failed'));
    request.onblocked = () => reject(new Error('raster-history-open-blocked'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('raster-history-request-failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('raster-history-transaction-failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('raster-history-transaction-aborted'));
  });
}

async function readAll(database: IDBDatabase): Promise<RasterAssetEntryV15[]> {
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const done = transactionDone(transaction);
  const raw = await requestResult(transaction.objectStore(STORE_NAME).getAll());
  await done;
  return (raw as unknown[]).filter(isRasterAssetEntryShapeV15);
}

async function prune(database: IDBDatabase): Promise<void> {
  const entries = (await readAll(database)).sort((a, b) => b.createdAt - a.createdAt);
  const stale = entries.slice(MAX_ENTRIES);
  if (!stale.length) return;
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  for (const entry of stale) store.delete(entry.id);
  await done;
}

export async function saveRasterAssetV15(input: RasterAssetSaveInputV15): Promise<'saved' | 'unavailable' | 'failed'> {
  if (typeof indexedDB === 'undefined') return 'unavailable';
  const entry: RasterAssetEntryV15 = {
    ...input,
    version: 1,
    id: input.sha256.toLowerCase(),
    sha256: input.sha256.toLowerCase(),
    parentId: input.parentId?.toLowerCase(),
    prompt: input.prompt.normalize('NFKC').trim().slice(0, 2_000),
  };
  if (!isRasterAssetEntryShapeV15(entry)) return 'failed';
  try {
    if ((await sha256Blob(entry.blob)) !== entry.sha256) return 'failed';
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(STORE_NAME).put(entry);
      await done;
      await prune(database);
      return 'saved';
    } finally { database.close(); }
  } catch {
    return 'failed';
  }
}

export async function loadRasterAssetV15(id: string): Promise<RasterAssetLoadResultV15> {
  if (typeof indexedDB === 'undefined') return { status: 'unavailable', entry: null };
  if (!SHA256.test(id)) return { status: 'failed', entry: null };
  try {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const done = transactionDone(transaction);
      const raw = await requestResult(transaction.objectStore(STORE_NAME).get(id.toLowerCase()));
      await done;
      if (raw === undefined) return { status: 'ready', entry: null };
      if (!isRasterAssetEntryShapeV15(raw)) return { status: 'failed', entry: null };
      if ((await sha256Blob(raw.blob)) !== raw.sha256) return { status: 'failed', entry: null };
      return { status: 'ready', entry: raw };
    } finally { database.close(); }
  } catch {
    return { status: 'failed', entry: null };
  }
}

export async function listRasterAssetsV15(): Promise<RasterAssetListResultV15> {
  if (typeof indexedDB === 'undefined') return { status: 'unavailable', entries: [] };
  try {
    const database = await openDatabase();
    try {
      const entries = (await readAll(database)).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_ENTRIES);
      const verified: RasterAssetEntryV15[] = [];
      for (const entry of entries) {
        if ((await sha256Blob(entry.blob)) === entry.sha256) verified.push(entry);
      }
      return { status: 'ready', entries: verified };
    } finally { database.close(); }
  } catch {
    return { status: 'failed', entries: [] };
  }
}

export async function deleteRasterAssetV15(id: string): Promise<'deleted' | 'unavailable' | 'failed'> {
  if (typeof indexedDB === 'undefined') return 'unavailable';
  if (!SHA256.test(id)) return 'failed';
  try {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(STORE_NAME).delete(id.toLowerCase());
      await done;
      return 'deleted';
    } finally { database.close(); }
  } catch {
    return 'failed';
  }
}
