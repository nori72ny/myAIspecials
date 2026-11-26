import { getUnlockedPasskeyKey } from '../../security/passkeyKeyDerivation';

export const ORIGIN_LOCAL_DB_NAME = 'origin-personal-local';
export const ORIGIN_LOCAL_DB_VERSION = 1;
const ORIGIN_LOCAL_STORE = 'snapshots';
const ORIGIN_LOCAL_SNAPSHOT_KEY = 'primary';
const ORIGIN_LOCAL_KEY_RECORD = 'aes-gcm-256';
const ORIGIN_MIGRATION_STAGE_KEY = 'primary:migration';
const ORIGIN_MIGRATION_BACKUP_KEY = 'primary:legacy-backup';

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

const readRawRecord = async (key: string): Promise<unknown> => {
  let database: IDBDatabase | null = null;
  try {
    database = await openOriginDatabase();
    const transaction = database.transaction(ORIGIN_LOCAL_STORE, 'readonly');
    return await requestResult(transaction.objectStore(ORIGIN_LOCAL_STORE).get(key));
  } finally {
    database?.close?.();
  }
};

const writeRawRecord = async (value: unknown, key: string): Promise<void> => {
  let database: IDBDatabase | null = null;
  try {
    database = await openOriginDatabase();
    const transaction = database.transaction(ORIGIN_LOCAL_STORE, 'readwrite');
    await requestResult(transaction.objectStore(ORIGIN_LOCAL_STORE).put(value, key));
  } finally {
    database?.close?.();
  }
};

const deleteRawRecord = async (key: string): Promise<void> => {
  let database: IDBDatabase | null = null;
  try {
    database = await openOriginDatabase();
    const transaction = database.transaction(ORIGIN_LOCAL_STORE, 'readwrite');
    await requestResult(transaction.objectStore(ORIGIN_LOCAL_STORE).delete(key));
  } finally {
    database?.close?.();
  }
};

// --- History encryption (S3, SECURITY_CHECK_2026-11-25) -----------------------
//
// Conversation history is encrypted at rest with the same construction as the
// other on-device stores: AES-GCM 256 with a random IV per record, a
// non-extractable device key held in this database, and the unlocked passkey
// key preferred whenever one is available. Decryption tries the passkey key
// first and falls back to the device key, so records written before a passkey
// migration stay readable and records written during an unlocked session stay
// readable afterwards.

type OriginEncryptedPayload = {
  version: 1;
  iv: string;
  ciphertext: string;
};

const isEncryptedPayload = (value: unknown): value is OriginEncryptedPayload => isRecord(value)
  && value.version === 1
  && typeof value.iv === 'string'
  && typeof value.ciphertext === 'string';

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const subtleCrypto = (): SubtleCrypto => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('history-crypto-unavailable');
  return subtle;
};

let cachedLocalKey: CryptoKey | null = null;

async function loadOrCreateLocalKey(): Promise<CryptoKey> {
  if (cachedLocalKey) return cachedLocalKey;
  const existing = await readRawRecord(ORIGIN_LOCAL_KEY_RECORD);
  if (existing !== undefined && existing !== null) {
    if (typeof existing !== 'object' || typeof (existing as CryptoKey).type !== 'string') {
      // A present but unusable key record must never be silently rotated:
      // replacing it would orphan every record encrypted with it.
      throw new Error('history-key-invalid');
    }
    cachedLocalKey = existing as CryptoKey;
    return cachedLocalKey;
  }
  const key = await subtleCrypto().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await writeRawRecord(key, ORIGIN_LOCAL_KEY_RECORD);
  cachedLocalKey = key;
  return key;
}

async function encryptTextWithKey(plaintext: string, key: CryptoKey): Promise<OriginEncryptedPayload> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await subtleCrypto().encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return { version: 1, iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

async function decryptTextWithKey(payload: OriginEncryptedPayload, key: CryptoKey): Promise<string> {
  const plaintext = await subtleCrypto().decrypt({ name: 'AES-GCM', iv: base64ToBytes(payload.iv) }, key, base64ToBytes(payload.ciphertext));
  return new TextDecoder().decode(plaintext);
}

function parseEncryptedPayload(raw: string): OriginEncryptedPayload {
  const parsed: unknown = JSON.parse(raw);
  if (!isEncryptedPayload(parsed)) throw new Error('history-payload-invalid');
  return parsed;
}

/** True when a stored journal string is an encrypted history envelope. */
export function isEncryptedHistoryText(raw: string): boolean {
  try {
    return isEncryptedPayload(JSON.parse(raw));
  } catch {
    return false;
  }
}

/**
 * Encrypts history text (the localStorage journal) with the store's key
 * selection: the unlocked passkey key when available, otherwise the device
 * key. Throws when encryption is unavailable; callers must never fall back
 * to writing plaintext.
 */
export async function encryptHistoryText(plaintext: string): Promise<string> {
  const key = getUnlockedPasskeyKey() ?? await loadOrCreateLocalKey();
  return JSON.stringify(await encryptTextWithKey(plaintext, key));
}

/**
 * Decrypts text produced by {@link encryptHistoryText}. The passkey key is
 * tried first and the device key second, mirroring the other on-device
 * stores. Throws when no available key can read the payload.
 */
export async function decryptHistoryText(raw: string): Promise<string> {
  const payload = parseEncryptedPayload(raw);
  const preferred = getUnlockedPasskeyKey();
  if (preferred) {
    try {
      return await decryptTextWithKey(payload, preferred);
    } catch {
      // A device-key record remains readable while a passkey is unlocked.
    }
  }
  return decryptTextWithKey(payload, await loadOrCreateLocalKey());
}

async function decryptSnapshotPayload(payload: OriginEncryptedPayload): Promise<OriginPersistedSnapshot> {
  const preferred = getUnlockedPasskeyKey();
  let text: string | null = null;
  if (preferred) {
    try {
      text = await decryptTextWithKey(payload, preferred);
    } catch {
      text = null;
    }
  }
  if (text === null) text = await decryptTextWithKey(payload, await loadOrCreateLocalKey());
  const parsed: unknown = JSON.parse(text);
  if (!isSnapshot(parsed)) throw new Error('history-snapshot-invalid');
  return parsed;
}

const loadSnapshot = async (): Promise<OriginPersistedSnapshot | null> => {
  const value = await readRawRecord(ORIGIN_LOCAL_SNAPSHOT_KEY);
  if (value === undefined || value === null) return null;
  if (isSnapshot(value)) {
    // Legacy plaintext record: return it as-is and migrate it in place.
    // A failed re-encryption leaves the plaintext untouched, so the history
    // is never lost by attempting the upgrade.
    try {
      await saveSnapshot(value);
    } catch {
      // saveSnapshot reports failures through its result; nothing to undo.
    }
    return value;
  }
  if (isEncryptedPayload(value)) return decryptSnapshotPayload(value);
  // An unrecognized non-empty record may still be history in a shape this
  // build does not understand. Refuse to treat it as empty so the caller's
  // read-failure path protects it from being overwritten.
  throw new Error('history-format-unrecognized');
};

const saveSnapshot = async (snapshot: OriginPersistedSnapshot): Promise<OriginStorageWriteResult> => {
  let database: IDBDatabase | null = null;
  try {
    const key = getUnlockedPasskeyKey() ?? await loadOrCreateLocalKey();
    const payload = await encryptTextWithKey(JSON.stringify(snapshot), key);
    database = await openOriginDatabase();
    const transaction = database.transaction(ORIGIN_LOCAL_STORE, 'readwrite');
    await requestResult(transaction.objectStore(ORIGIN_LOCAL_STORE).put(payload, ORIGIN_LOCAL_SNAPSHOT_KEY));
    return 'saved';
  } catch (error) {
    // Encryption or storage failure never falls back to a plaintext write.
    return isQuotaExceeded(error) ? 'quota' : typeof indexedDB === 'undefined' ? 'unavailable' : 'failed';
  } finally {
    database?.close?.();
  }
};

export const originIndexedDbAdapter: OriginStorageAdapter = {
  load: loadSnapshot,
  save: saveSnapshot,
};

// --- Passkey key migration ----------------------------------------------------

/**
 * Re-encrypts the history snapshot with the passkey key after staging and
 * verification, following the checkpoint store's pattern. Plaintext legacy
 * records are encrypted directly; records already readable only by the
 * target key are skipped so a repeated migration keeps the original backup.
 */
export async function migrateHistoryToEncryptionKey(targetKey: CryptoKey): Promise<{ migrated: boolean }> {
  if (typeof indexedDB === 'undefined') throw new Error('history-browser-required');
  const current = await readRawRecord(ORIGIN_LOCAL_SNAPSHOT_KEY);
  if (current === undefined || current === null) return { migrated: false };

  let snapshot: OriginPersistedSnapshot;
  if (isSnapshot(current)) {
    snapshot = current;
  } else if (isEncryptedPayload(current)) {
    let text: string | null = null;
    try {
      text = await decryptTextWithKey(current, await loadOrCreateLocalKey());
    } catch {
      text = null;
    }
    if (text === null) {
      // Not readable by the device key: either it already belongs to the
      // target key (migration already done — skip) or it is unreadable
      // altogether, in which case this throws and nothing is modified.
      const targetText = await decryptTextWithKey(current, targetKey);
      const parsed: unknown = JSON.parse(targetText);
      if (!isSnapshot(parsed)) throw new Error('history-snapshot-invalid');
      return { migrated: false };
    }
    const parsed: unknown = JSON.parse(text);
    if (!isSnapshot(parsed)) throw new Error('history-snapshot-invalid');
    snapshot = parsed;
  } else {
    throw new Error('history-format-unrecognized');
  }

  const staged = await encryptTextWithKey(JSON.stringify(snapshot), targetKey);
  await writeRawRecord(staged, ORIGIN_MIGRATION_STAGE_KEY);
  try {
    const stagedRead = await readRawRecord(ORIGIN_MIGRATION_STAGE_KEY);
    if (!isEncryptedPayload(stagedRead)) throw new Error('history-migration-stage-missing');
    const verified: unknown = JSON.parse(await decryptTextWithKey(stagedRead, targetKey));
    if (!isSnapshot(verified) || verified.updatedAt !== snapshot.updatedAt) throw new Error('history-migration-verify-failed');
    await writeRawRecord(current, ORIGIN_MIGRATION_BACKUP_KEY);
    await writeRawRecord(stagedRead, ORIGIN_LOCAL_SNAPSHOT_KEY);
    await deleteRawRecord(ORIGIN_MIGRATION_STAGE_KEY);
    return { migrated: true };
  } catch (error) {
    await deleteRawRecord(ORIGIN_MIGRATION_STAGE_KEY).catch(() => undefined);
    throw error;
  }
}

/** Restores the exact pre-migration history record, if one was staged. */
export async function rollbackHistoryKeyMigration(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const legacy = await readRawRecord(ORIGIN_MIGRATION_BACKUP_KEY);
  if (legacy === undefined || legacy === null) return;
  await writeRawRecord(legacy, ORIGIN_LOCAL_SNAPSHOT_KEY);
}

/** Deletes the pre-migration backup once the migration is confirmed complete. */
export async function clearHistoryMigrationBackup(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await deleteRawRecord(ORIGIN_MIGRATION_BACKUP_KEY);
}

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
