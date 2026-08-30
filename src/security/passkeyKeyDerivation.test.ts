import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getUnlockedPasskeyKey,
  isPasskeyConfigured,
  registerPasskeyKey,
  setUnlockedPasskeyKey,
  unlockAndSetPasskeyKey,
} from './passkeyKeyDerivation';

const credentialId = new Uint8Array([1, 2, 3, 4]);
const prfOutput = new Uint8Array(32).fill(7);
const keyA = { id: 'key-a' } as unknown as CryptoKey;
const keyB = { id: 'key-b' } as unknown as CryptoKey;

function createLocalStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    clear: vi.fn(() => values.clear()),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('passkeyKeyDerivation', () => {
  let localStorage: ReturnType<typeof createLocalStorage>;
  let credentialsGet: ReturnType<typeof vi.fn>;
  let credentialsCreate: ReturnType<typeof vi.fn>;
  let deriveKey: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage = createLocalStorage();
    credentialsGet = vi.fn();
    credentialsCreate = vi.fn();
    deriveKey = vi.fn().mockResolvedValue(keyA);

    const fakeCrypto = {
      getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
        if (array instanceof Uint8Array) array.fill(9);
        return array;
      },
      subtle: {
        importKey: vi.fn().mockResolvedValue({ id: 'base-key' } as unknown as CryptoKey),
        deriveKey,
      },
    };

    class FakePublicKeyCredential {}
    Object.assign(FakePublicKeyCredential, {
      getClientCapabilities: vi.fn().mockResolvedValue({ prf: true }),
    });

    vi.stubGlobal('crypto', fakeCrypto);
    vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential);
    vi.stubGlobal('navigator', { credentials: { get: credentialsGet, create: credentialsCreate } });
    vi.stubGlobal('window', {
      crypto: fakeCrypto,
      navigator: { credentials: { get: credentialsGet, create: credentialsCreate } },
      localStorage,
    });

    setUnlockedPasskeyKey(null);
  });

  afterEach(() => {
    setUnlockedPasskeyKey(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('UT-01: performs first unlock and commits the derived CryptoKey', async () => {
    localStorage.setItem('origin-passkey-credential-id-v1', 'AQIDBA');
    credentialsGet.mockResolvedValue({
      rawId: credentialId.buffer,
      getClientExtensionResults: () => ({ prf: { results: { first: prfOutput } } }),
    });

    const result = await unlockAndSetPasskeyKey();

    expect(result).toBe(keyA);
    expect(getUnlockedPasskeyKey()).toBe(keyA);
    expect(credentialsGet).toHaveBeenCalledTimes(1);
    expect(deriveKey).toHaveBeenCalledTimes(1);
  });

  it('GATE-04: cache short-circuits without invoking WebAuthn again', async () => {
    setUnlockedPasskeyKey(keyA);

    const result = await unlockAndSetPasskeyKey();

    expect(result).toBe(keyA);
    expect(credentialsGet).not.toHaveBeenCalled();
    expect(deriveKey).not.toHaveBeenCalled();
  });

  it('GATE-01: concurrent unlock calls share one exact in-flight Promise', async () => {
    localStorage.setItem('origin-passkey-credential-id-v1', 'AQIDBA');
    const deferred = createDeferred<CryptoKey>();
    credentialsGet.mockResolvedValue({
      rawId: credentialId.buffer,
      getClientExtensionResults: () => ({ prf: { results: { first: prfOutput } } }),
    });
    deriveKey.mockReturnValue(deferred.promise);

    const p1 = unlockAndSetPasskeyKey();
    const p2 = unlockAndSetPasskeyKey();
    const p3 = unlockAndSetPasskeyKey();

    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
    expect(credentialsGet).toHaveBeenCalledTimes(1);
    expect(deriveKey).toHaveBeenCalledTimes(1);

    deferred.resolve(keyB);
    const results = await Promise.all([p1, p2, p3]);

    expect(results[0]).toBe(keyB);
    expect(results[1]).toBe(keyB);
    expect(results[2]).toBe(keyB);
    expect(getUnlockedPasskeyKey()).toBe(keyB);
  });

  it('GATE-02: failed unlock preserves a null state', async () => {
    localStorage.setItem('origin-passkey-credential-id-v1', 'AQIDBA');
    credentialsGet.mockRejectedValue(new Error('NotAllowedError'));

    await expect(unlockAndSetPasskeyKey()).rejects.toThrow('NotAllowedError');
    expect(getUnlockedPasskeyKey()).toBeNull();
  });

  it('GATE-03: failed in-flight unlock cleans up and permits a retry', async () => {
    localStorage.setItem('origin-passkey-credential-id-v1', 'AQIDBA');
    credentialsGet
      .mockRejectedValueOnce(new Error('NotAllowedError'))
      .mockResolvedValueOnce({
        rawId: credentialId.buffer,
        getClientExtensionResults: () => ({ prf: { results: { first: prfOutput } } }),
      });

    const first = unlockAndSetPasskeyKey();
    await expect(first).rejects.toThrow('NotAllowedError');

    deriveKey.mockResolvedValueOnce(keyB);
    const second = unlockAndSetPasskeyKey();
    await expect(second).resolves.toBe(keyB);

    expect(credentialsGet).toHaveBeenCalledTimes(2);
    expect(getUnlockedPasskeyKey()).toBe(keyB);
  });

  it('UT-05: preserves the original public Error contract', async () => {
    localStorage.setItem('origin-passkey-credential-id-v1', 'AQIDBA');
    credentialsGet.mockResolvedValue({
      rawId: credentialId.buffer,
      getClientExtensionResults: () => ({ prf: { results: {} } }),
    });

    await expect(unlockAndSetPasskeyKey()).rejects.toThrow('PASSKEY_PRF_UNAVAILABLE');
  });

  it('UT-06: registration stores the credential id and uses the managed unlock path', async () => {
    credentialsCreate.mockResolvedValue({ rawId: credentialId.buffer });
    credentialsGet.mockResolvedValue({
      rawId: credentialId.buffer,
      getClientExtensionResults: () => ({ prf: { results: { first: prfOutput } } }),
    });
    deriveKey.mockResolvedValue(keyB);

    const result = await registerPasskeyKey();

    expect(result).toBe(keyB);
    expect(credentialsCreate).toHaveBeenCalledTimes(1);
    expect(credentialsGet).toHaveBeenCalledTimes(1);
    expect(getUnlockedPasskeyKey()).toBe(keyB);
    expect(isPasskeyConfigured()).toBe(true);
  });

  it('UT-06b: registration verifies a newly created credential even when an old key is cached', async () => {
    localStorage.setItem('origin-passkey-credential-id-v1', 'OLD-ID');
    setUnlockedPasskeyKey(keyA);
    credentialsCreate.mockResolvedValue({ rawId: credentialId.buffer });
    credentialsGet.mockResolvedValue({
      rawId: credentialId.buffer,
      getClientExtensionResults: () => ({ prf: { results: { first: prfOutput } } }),
    });
    deriveKey.mockResolvedValue(keyB);

    const result = await registerPasskeyKey();

    expect(result).toBe(keyB);
    expect(credentialsGet).toHaveBeenCalledTimes(1);
    expect(deriveKey).toHaveBeenCalledTimes(1);
    expect(getUnlockedPasskeyKey()).toBe(keyB);
    expect(localStorage.getItem('origin-passkey-credential-id-v1')).toBe('AQIDBA');
  });

  it('registration rolls back the new credential id when verification fails', async () => {
    credentialsCreate.mockResolvedValue({ rawId: credentialId.buffer });
    credentialsGet.mockRejectedValue(new Error('NotAllowedError'));

    await expect(registerPasskeyKey()).rejects.toThrow('NotAllowedError');

    expect(localStorage.removeItem).toHaveBeenCalledWith('origin-passkey-credential-id-v1');
    expect(isPasskeyConfigured()).toBe(false);
    expect(getUnlockedPasskeyKey()).toBeNull();
  });

  it('registration restores the previous credential id when replacement verification fails', async () => {
    localStorage.setItem('origin-passkey-credential-id-v1', 'OLD-ID');
    credentialsCreate.mockResolvedValue({ rawId: credentialId.buffer });
    credentialsGet.mockRejectedValue(new Error('NotAllowedError'));

    await expect(registerPasskeyKey()).rejects.toThrow('NotAllowedError');

    expect(localStorage.setItem).toHaveBeenCalledWith('origin-passkey-credential-id-v1', 'OLD-ID');
    expect(localStorage.getItem('origin-passkey-credential-id-v1')).toBe('OLD-ID');
    expect(getUnlockedPasskeyKey()).toBeNull();
  });

  it('does not emit authentication material or CryptoKey instances to console', async () => {
    localStorage.setItem('origin-passkey-credential-id-v1', 'AQIDBA');
    credentialsGet.mockRejectedValue(new Error('NotAllowedError'));
    const logs = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'info'),
    ];

    await expect(unlockAndSetPasskeyKey()).rejects.toThrow('NotAllowedError');

    for (const log of logs) {
      for (const call of log.mock.calls) {
        expect(call).not.toContain(keyA);
        expect(call).not.toContain(prfOutput);
      }
    }
  });
});
