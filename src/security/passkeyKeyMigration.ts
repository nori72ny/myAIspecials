import {
  migrateActiveContextToEncryptionKey,
  rollbackActiveContextKeyMigration,
} from '../services/activeContextGraph';
import {
  migrateCheckpointsToEncryptionKey,
  rollbackCheckpointKeyMigration,
} from '../agent/indexedDbCheckpointStore';
import {
  getUnlockedPasskeyKey,
  unlockAndSetPasskeyKey,
} from './passkeyKeyDerivation';

export const PASSKEY_MIGRATION_STATUS_KEY = 'origin-passkey-migration-v1';
export const PASSKEY_MIGRATION_STATUS_EVENT = 'origin:passkey-migration-status';

type MigrationStatus = 'pending' | 'complete';

const isBrowser = (): boolean => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

let activeMigrationPromise: Promise<{ checkpoints: boolean; activeContext: number }> | null = null;

export function isPasskeyMigrationComplete(): boolean {
  return isBrowser() && window.localStorage.getItem(PASSKEY_MIGRATION_STATUS_KEY) === 'complete';
}

function setMigrationStatus(status: MigrationStatus): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(PASSKEY_MIGRATION_STATUS_KEY, status);
  window.dispatchEvent(new CustomEvent(PASSKEY_MIGRATION_STATUS_EVENT, { detail: status }));
}

/**
 * Migrates existing local-key encrypted checkpoints and Active Context records to the
 * currently unlocked WebAuthn-PRF-derived AES-GCM key. Both stores stage and verify
 * their new ciphertext before replacing the active record; a cross-store failure
 * triggers best-effort restoration of the legacy ciphertexts.
 *
 * Concurrent migration callers share one in-flight transaction. This prevents one
 * caller from observing or modifying the stores while another caller is between the
 * checkpoint and Active Context migration stages.
 */
export function migrateToPasskeyEncryption(passkeyKey?: CryptoKey): Promise<{ checkpoints: boolean; activeContext: number }> {
  if (!isBrowser()) return Promise.reject(new Error('PASSKEY_MIGRATION_BROWSER_REQUIRED'));
  if (activeMigrationPromise !== null) return activeMigrationPromise;

  activeMigrationPromise = (async () => {
    const key = passkeyKey ?? getUnlockedPasskeyKey() ?? await unlockAndSetPasskeyKey();
    setMigrationStatus('pending');

    let checkpointsMigrated = false;
    let activeContextMigrated = 0;
    try {
      const checkpointResult = await migrateCheckpointsToEncryptionKey(key);
      checkpointsMigrated = checkpointResult.migrated;

      const activeContextResult = await migrateActiveContextToEncryptionKey(key);
      activeContextMigrated = activeContextResult.migrated;

      setMigrationStatus('complete');
      return { checkpoints: checkpointsMigrated, activeContext: activeContextMigrated };
    } catch (error) {
      await Promise.allSettled([
        checkpointsMigrated ? rollbackCheckpointKeyMigration() : Promise.resolve(),
        activeContextMigrated > 0 ? rollbackActiveContextKeyMigration() : Promise.resolve(),
      ]);
      setMigrationStatus('pending');
      throw error;
    } finally {
      activeMigrationPromise = null;
    }
  })();

  return activeMigrationPromise;
}
