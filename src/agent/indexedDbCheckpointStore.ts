import type { CheckpointState } from './checkpointManager';

const DB_NAME = 'origin-agent-checkpoints-v1';
const STORE_NAME = 'checkpoints';
const KEY_NAME = 'aes-gcm-256';
const RECORD_KEY = 'workspace';
const MAX_CHECKPOINTS = 100;
const MAX_PAYLOAD_BYTES = 2_000_000;

type EncryptedRecord = {
  version: 1;
  iv: string;
  ciphertext: string;
};

const isBrowser = () =>
  typeof window !== 'undefined' &&
  typeof indexedDB !== 'undefined' &&
  !!window.crypto?.subtle;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('CHECKPOINT_DB_OPEN_FAILED'));
  });
}

async function loadOrCreateKey(): Promise<CryptoKey> {
  const db = await openDb();
  const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(KEY_NAME);
    request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
    request.onerror = () => reject(request.error ?? new Error('CHECKPOINT_KEY_READ_FAILED'));
  });
  if (existing) return existing;

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(key, KEY_NAME);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('CHECKPOINT_KEY_WRITE_FAILED'));
  });
  return key;
}

async function encrypt(checkpoints: CheckpointState[]): Promise<EncryptedRecord> {
  const encoded = new TextEncoder().encode(JSON.stringify(checkpoints.slice(-MAX_CHECKPOINTS)));
  if (encoded.byteLength > MAX_PAYLOAD_BYTES) throw new Error('CHECKPOINT_PAYLOAD_TOO_LARGE');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await loadOrCreateKey(),
    encoded,
  );
  return { version: 1, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

async function decrypt(record: EncryptedRecord): Promise<CheckpointState[]> {
  if (record.version !== 1) throw new Error('CHECKPOINT_VERSION_UNSUPPORTED');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(record.iv) },
    await loadOrCreateKey(),
    fromBase64(record.ciphertext),
  );
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  if (!Array.isArray(parsed)) throw new Error('CHECKPOINT_PAYLOAD_INVALID');
  return parsed.filter((value): value is CheckpointState => {
    if (!value || typeof value !== 'object') return false;
    const item = value as Partial<CheckpointState>;
    return typeof item.checkpointId === 'string' &&
      typeof item.taskId === 'string' &&
      typeof item.version === 'number' &&
      typeof item.status === 'string' &&
      typeof item.artifact === 'string' &&
      typeof item.createdAt === 'number';
  });
}

async function readRecord(): Promise<EncryptedRecord | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(RECORD_KEY);
    request.onsuccess = () => resolve(request.result as EncryptedRecord | undefined);
    request.onerror = () => reject(request.error ?? new Error('CHECKPOINT_READ_FAILED'));
  });
}

async function writeRecord(record: EncryptedRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record, RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('CHECKPOINT_WRITE_FAILED'));
  });
}

/** Persists checkpoint history locally. Encryption failures are surfaced to the caller. */
export async function saveCheckpointToIndexedDB(checkpoint: CheckpointState): Promise<void> {
  if (!isBrowser()) return;
  const current = await loadCheckpointsFromIndexedDB();
  const next = [...current.filter((item) => item.checkpointId !== checkpoint.checkpointId), checkpoint]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-MAX_CHECKPOINTS);
  await writeRecord(await encrypt(next));
}

/** Restores checkpoint history; corrupted/undecryptable state fails closed to an empty history. */
export async function loadCheckpointsFromIndexedDB(): Promise<CheckpointState[]> {
  if (!isBrowser()) return [];
  try {
    const record = await readRecord();
    if (!record) return [];
    return await decrypt(record);
  } catch {
    return [];
  }
}

export async function clearCheckpointsFromIndexedDB(): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('CHECKPOINT_CLEAR_FAILED'));
  });
}
