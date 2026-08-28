import type { CheckpointState } from './checkpointManager';
import { getUnlockedPasskeyKey } from '../security/passkeyKeyDerivation';

const DB_NAME = 'origin-agent-checkpoints-v1';
const STORE_NAME = 'checkpoints';
const KEY_NAME = 'aes-gcm-256';
const RECORD_KEY = 'workspace';
const MIGRATION_KEY = 'workspace:migration';
const LEGACY_BACKUP_KEY = 'workspace:legacy-backup';
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

async function loadOrCreateLocalKey(): Promise<CryptoKey> {
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

function getPreferredKey(): CryptoKey | null {
  return getUnlockedPasskeyKey();
}

async function encrypt(checkpoints: CheckpointState[], key: CryptoKey): Promise<EncryptedRecord> {
  const encoded = new TextEncoder().encode(JSON.stringify(checkpoints.slice(-MAX_CHECKPOINTS)));
  if (encoded.byteLength > MAX_PAYLOAD_BYTES) throw new Error('CHECKPOINT_PAYLOAD_TOO_LARGE');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return { version: 1, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

async function decrypt(record: EncryptedRecord, key: CryptoKey): Promise<CheckpointState[]> {
  if (record.version !== 1) throw new Error('CHECKPOINT_VERSION_UNSUPPORTED');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(record.iv) },
    key,
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

async function readRecord(key = RECORD_KEY): Promise<EncryptedRecord | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result as EncryptedRecord | undefined);
    request.onerror = () => reject(request.error ?? new Error('CHECKPOINT_READ_FAILED'));
  });
}

async function writeRecord(record: EncryptedRecord, key = RECORD_KEY): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('CHECKPOINT_WRITE_FAILED'));
  });
}

async function deleteRecord(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('CHECKPOINT_DELETE_FAILED'));
  });
}

async function decryptWithKeyFallback(record: EncryptedRecord): Promise<CheckpointState[]> {
  const preferred = getPreferredKey();
  if (preferred) {
    try {
      return await decrypt(record, preferred);
    } catch {
      // A legacy local-key record may exist; do not discard it merely because a passkey is locked.
    }
  }
  return decrypt(record, await loadOrCreateLocalKey());
}

/** Persists checkpoint history using the unlocked passkey key when available, otherwise the local non-extractable key. */
export async function saveCheckpointToIndexedDB(checkpoint: CheckpointState): Promise<void> {
  if (!isBrowser()) return;
  const current = await loadCheckpointsFromIndexedDB();
  const next = [...current.filter((item) => item.checkpointId !== checkpoint.checkpointId), checkpoint]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-MAX_CHECKPOINTS);
  const key = getPreferredKey() ?? await loadOrCreateLocalKey();
  await writeRecord(await encrypt(next, key));
}

/** Restores checkpoint history; corrupted/undecryptable state fails closed to an empty history. */
export async function loadCheckpointsFromIndexedDB(): Promise<CheckpointState[]> {
  if (!isBrowser()) return [];
  try {
    const record = await readRecord();
    if (!record) return [];
    return await decryptWithKeyFallback(record);
  } catch {
    return [];
  }
}

/**
 * Re-encrypts the current checkpoint history with a passkey-derived key.
 * The legacy ciphertext is retained as a recovery backup and the new ciphertext
 * is staged + verified before replacing the active record. Any failure leaves
 * the pre-migration record decryptable with the original local key.
 */
export async function migrateCheckpointsToEncryptionKey(targetKey: CryptoKey): Promise<{ migrated: boolean }> {
  if (!isBrowser()) throw new Error('CHECKPOINT_BROWSER_REQUIRED');
  const current = await readRecord(RECORD_KEY);
  if (!current) return { migrated: false };

  const localKey = await loadOrCreateLocalKey();
  const checkpoints = await decrypt(current, localKey);
  const migratedRecord = await encrypt(checkpoints, targetKey);

  await writeRecord(migratedRecord, MIGRATION_KEY);
  try {
    const staged = await readRecord(MIGRATION_KEY);
    if (!staged) throw new Error('CHECKPOINT_MIGRATION_STAGE_MISSING');
    const verified = await decrypt(staged, targetKey);
    if (verified.length !== checkpoints.length) throw new Error('CHECKPOINT_MIGRATION_VERIFY_FAILED');

    await writeRecord(current, LEGACY_BACKUP_KEY);
    await writeRecord(staged, RECORD_KEY);
    await deleteRecord(MIGRATION_KEY);
    return { migrated: true };
  } catch (error) {
    await deleteRecord(MIGRATION_KEY).catch(() => undefined);
    throw error;
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
