import {
  clearActiveContextMigrationBackups,
  migrateActiveContextToEncryptionKey,
  rollbackActiveContextKeyMigration,
} from '../services/activeContextGraph';
import {
  clearCheckpointMigrationBackup,
  migrateCheckpointsToEncryptionKey,
  rollbackCheckpointKeyMigration,
} from '../agent/indexedDbCheckpointStore';
import {
  clearHistoryMigrationBackup,
  migrateHistoryToEncryptionKey,
  rollbackHistoryKeyMigration,
} from '../lib/local/OriginIndexedDb';
import {
  getUnlockedPasskeyKey,
  unlockAndSetPasskeyKey,
} from './passkeyKeyDerivation';

export const PASSKEY_MIGRATION_STATUS_KEY = 'origin-passkey-migration-v1';
export const PASSKEY_MIGRATION_STATUS_EVENT = 'origin:passkey-migration-status';

type MigrationStatus = 'pending' | 'complete';

const isBrowser = (): boolean => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export function isPasskeyMigrationComplete(): boolean {
  return isBrowser() && window.localStorage.getItem(PASSKEY_MIGRATION_STATUS_KEY) === 'complete';
}

function setMigrationStatus(status: MigrationStatus): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(PASSKEY_MIGRATION_STATUS_KEY, status);
  window.dispatchEvent(new CustomEvent(PASSKEY_MIGRATION_STATUS_EVENT, { detail: status }));
}

/**
 * Migrates existing local-key encrypted checkpoints, Active Context records,
 * and the conversation history snapshot to the currently unlocked
 * WebAuthn-PRF-derived AES-GCM key. Every store stages and verifies its new
 * ciphertext before replacing the active record; a cross-store failure
 * triggers best-effort restoration of the legacy ciphertexts.
 */
export async function migrateToPasskeyEncryption(passkeyKey?: CryptoKey): Promise<{ checkpoints: boolean; activeContext: number; history: boolean }> {
  if (!isBrowser()) throw new Error('PASSKEY_MIGRATION_BROWSER_REQUIRED');
  const key = passkeyKey ?? getUnlockedPasskeyKey() ?? await unlockAndSetPasskeyKey();
  setMigrationStatus('pending');

  let checkpointsMigrated = false;
  let activeContextMigrated = 0;
  let historyMigrated = false;
  try {
    const checkpointResult = await migrateCheckpointsToEncryptionKey(key);
    checkpointsMigrated = checkpointResult.migrated;

    const activeContextResult = await migrateActiveContextToEncryptionKey(key);
    activeContextMigrated = activeContextResult.migrated;

    const historyResult = await migrateHistoryToEncryptionKey(key);
    historyMigrated = historyResult.migrated;

    // The history backup exists only to make a failed migration reversible;
    // once every store has migrated it would otherwise leave a device-key
    // copy of the history behind permanently (the S1 pattern). Cleanup is
    // best effort: the migrated record is already verified at this point.
    if (historyMigrated) {
      await clearHistoryMigrationBackup().catch(() => undefined);
    }

    setMigrationStatus('complete');
    // Both stores migrated and verified, so the pre-migration backups —
    // ciphertexts readable with the device-local key — are removed.
    // Keeping them would leave a weaker-key copy of every migrated
    // record behind indefinitely. Cleanup is best-effort: a failure
    // here does not undo the completed migration.
    await Promise.allSettled([
      Promise.resolve().then(() => clearActiveContextMigrationBackups()),
      clearCheckpointMigrationBackup(),
    ]);
    return { checkpoints: checkpointsMigrated, activeContext: activeContextMigrated, history: historyMigrated };
  } catch (error) {
    await Promise.allSettled([
      checkpointsMigrated ? rollbackCheckpointKeyMigration() : Promise.resolve(),
      activeContextMigrated > 0 ? rollbackActiveContextKeyMigration() : Promise.resolve(),
      historyMigrated ? rollbackHistoryKeyMigration() : Promise.resolve(),
    ]);
    setMigrationStatus('pending');
    throw error;
  }
}
