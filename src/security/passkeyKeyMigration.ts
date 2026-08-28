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

type MigrationStatus = 'pending' | 'complete';

const isBrowser = (): boolean => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export function isPasskeyMigrationComplete(): boolean {
  return isBrowser() && window.localStorage.getItem(PASSKEY_MIGRATION_STATUS_KEY) === 'complete';
}

function setMigrationStatus(status: MigrationStatus): void {
  if (isBrowser()) window.localStorage.setItem(PASSKEY_MIGRATION_STATUS_KEY, status);
}

/**
 * Migrates existing local-key encrypted checkpoints and Active Context records to the
 * currently unlocked WebAuthn-PRF-derived AES-GCM key. Both stores stage and verify
 * their new ciphertext before replacing the active record; a cross-store failure
 * triggers best-effort restoration of the legacy ciphertexts.
 */
export async function migrateToPasskeyEncryption(passkeyKey?: CryptoKey): Promise<{ checkpoints: boolean; activeContext: number }> {
  if (!isBrowser()) throw new Error('PASSKEY_MIGRATION_BROWSER_REQUIRED');
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
  }
}
