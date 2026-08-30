import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getUnlockedPasskeyKey, setUnlockedPasskeyKey } from './passkeyKeyDerivation';
import { migrateToPasskeyEncryption } from './passkeyKeyMigration';
import { migrateCheckpointsToEncryptionKey, rollbackCheckpointKeyMigration } from '../agent/indexedDbCheckpointStore';
import { migrateActiveContextToEncryptionKey, rollbackActiveContextKeyMigration } from '../services/activeContextGraph';

vi.mock('./passkeyKeyDerivation', () => ({
  getUnlockedPasskeyKey: vi.fn(),
  setUnlockedPasskeyKey: vi.fn(),
  unlockAndSetPasskeyKey: vi.fn(),
}));
vi.mock('../agent/indexedDbCheckpointStore', () => ({
  migrateCheckpointsToEncryptionKey: vi.fn(),
  rollbackCheckpointKeyMigration: vi.fn(),
}));
vi.mock('../services/activeContextGraph', () => ({
  migrateActiveContextToEncryptionKey: vi.fn(),
  rollbackActiveContextKeyMigration: vi.fn(),
}));

const keyA = { id: 'key-a' } as unknown as CryptoKey;
const keyB = { id: 'key-b' } as unknown as CryptoKey;

function installBrowser() {
  const values = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    },
    dispatchEvent: vi.fn(),
  });
}

describe('passkeyKeyMigration concurrency boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    installBrowser();
    vi.mocked(getUnlockedPasskeyKey).mockReturnValue(keyA);
    vi.mocked(migrateCheckpointsToEncryptionKey).mockResolvedValue({ migrated: true });
    vi.mocked(migrateActiveContextToEncryptionKey).mockResolvedValue({ migrated: 1 });
    vi.mocked(rollbackCheckpointKeyMigration).mockResolvedValue(undefined);
    vi.mocked(rollbackActiveContextKeyMigration).mockResolvedValue(undefined);
  });

  it('shares the exact in-flight Promise and executes migration once', async () => {
    let resolveCheckpoint!: (value: { migrated: boolean }) => void;
    const checkpoint = new Promise<{ migrated: boolean }>((resolve) => { resolveCheckpoint = resolve; });
    vi.mocked(migrateCheckpointsToEncryptionKey).mockReturnValue(checkpoint);

    const p1 = migrateToPasskeyEncryption();
    const p2 = migrateToPasskeyEncryption();
    expect(p1).toBe(p2);
    expect(migrateCheckpointsToEncryptionKey).toHaveBeenCalledTimes(1);

    resolveCheckpoint({ migrated: true });
    await Promise.all([p1, p2]);
    expect(migrateActiveContextToEncryptionKey).toHaveBeenCalledTimes(1);
  });

  it('does not let a concurrent migration silently switch to a different explicit key', async () => {
    let resolveCheckpoint!: (value: { migrated: boolean }) => void;
    const checkpoint = new Promise<{ migrated: boolean }>((resolve) => { resolveCheckpoint = resolve; });
    vi.mocked(migrateCheckpointsToEncryptionKey).mockReturnValue(checkpoint);

    const first = migrateToPasskeyEncryption(keyA);
    const second = migrateToPasskeyEncryption(keyB);
    expect(second).toBe(first);

    resolveCheckpoint({ migrated: true });
    await Promise.all([first, second]);
    expect(migrateCheckpointsToEncryptionKey).toHaveBeenCalledWith(keyA);
    expect(migrateCheckpointsToEncryptionKey).not.toHaveBeenCalledWith(keyB);
  });

  it('clears the in-flight transaction after failure so a later migration can retry', async () => {
    vi.mocked(migrateCheckpointsToEncryptionKey)
      .mockRejectedValueOnce(new Error('checkpoint-failed'))
      .mockResolvedValueOnce({ migrated: true });

    await expect(migrateToPasskeyEncryption()).rejects.toThrow('checkpoint-failed');
    await expect(migrateToPasskeyEncryption()).resolves.toEqual({ checkpoints: true, activeContext: 1 });
    expect(migrateCheckpointsToEncryptionKey).toHaveBeenCalledTimes(2);
  });

  it('keeps the migration status pending after failure', async () => {
    vi.mocked(migrateCheckpointsToEncryptionKey).mockRejectedValue(new Error('checkpoint-failed'));
    await expect(migrateToPasskeyEncryption()).rejects.toThrow('checkpoint-failed');
    expect(window.localStorage.getItem('origin-passkey-migration-v1')).toBe('pending');
  });

  it('uses the unlocked key when no explicit key is supplied', async () => {
    await migrateToPasskeyEncryption();
    expect(migrateCheckpointsToEncryptionKey).toHaveBeenCalledWith(keyA);
  });
});
