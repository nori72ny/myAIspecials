const PASSKEY_STORAGE_KEY = 'origin-passkey-credential-id-v1';
const PASSKEY_SALT_KEY = 'origin-passkey-prf-salt-v1';
const PBKDF2_ITERATIONS = 600_000;
const RP_NAME = 'ORIGIN Private Intelligence Workspace';

type PrfExtensionResults = {
  prf?: { enabled?: boolean; results?: { first?: BufferSource } };
};

type PublicKeyCredentialWithPrf = PublicKeyCredential & {
  getClientExtensionResults(): PrfExtensionResults;
};

const isBrowser = () =>
  typeof window !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  typeof window.crypto?.subtle !== 'undefined' &&
  typeof PublicKeyCredential !== 'undefined';

const base64UrlEncode = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const base64UrlDecode = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

function getStoredCredentialId(): Uint8Array | null {
  if (!isBrowser()) return null;
  const encoded = window.localStorage.getItem(PASSKEY_STORAGE_KEY);
  return encoded ? base64UrlDecode(encoded) : null;
}

function getOrCreateSalt(): Uint8Array {
  if (!isBrowser()) throw new Error('PASSKEY_BROWSER_REQUIRED');
  const existing = window.localStorage.getItem(PASSKEY_SALT_KEY);
  if (existing) return base64UrlDecode(existing);
  const salt = crypto.getRandomValues(new Uint8Array(32));
  window.localStorage.setItem(PASSKEY_SALT_KEY, base64UrlEncode(salt));
  return salt;
}

async function deriveAesKey(prfOutput: BufferSource, salt: BufferSource): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', prfOutput, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function supportsPrf(): Promise<boolean> {
  if (!isBrowser()) return false;
  try {
    const available = await (PublicKeyCredential as typeof PublicKeyCredential & {
      getClientCapabilities?: () => Promise<Record<string, boolean>>;
    }).getClientCapabilities?.();
    if (available && available.prf === false) return false;
  } catch {
    // Capability probing is optional; registration/get below remains authoritative.
  }
  return true;
}

/** Returns whether a passkey/PRF credential has been enrolled for ORIGIN. */
export function isPasskeyConfigured(): boolean {
  return getStoredCredentialId() !== null;
}

/**
 * Enrolls a discoverable WebAuthn credential and immediately verifies it through
 * the PRF extension. The PRF output is never persisted; only the public credential
 * id and a non-secret salt are retained.
 */
export async function registerPasskeyKey(): Promise<CryptoKey> {
  if (!(await supportsPrf())) throw new Error('PASSKEY_PRF_UNSUPPORTED');
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const salt = getOrCreateSalt();
  const previousCredentialId = window.localStorage.getItem(PASSKEY_STORAGE_KEY);
  const credential = await window.navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: RP_NAME },
      user: { id: userId, name: 'origin-local-user', displayName: 'ORIGIN User' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: 60_000,
      extensions: { prf: {} },
    } as PublicKeyCredentialCreationOptions & { extensions?: Record<string, unknown> },
  }) as PublicKeyCredentialWithPrf | null;
  if (!credential) throw new Error('PASSKEY_REGISTRATION_CANCELLED');

  window.localStorage.setItem(PASSKEY_STORAGE_KEY, base64UrlEncode(new Uint8Array(credential.rawId)));
  try {
    // Registration must verify the newly-created credential even when an older
    // unlocked key is cached; otherwise the new credential ID could be persisted
    // without ever proving that it derives a usable key.
    const key = await unlockPasskeyKey();
    unlockedPasskeyKey = key;
    return key;
  } catch (error: unknown) {
    if (previousCredentialId === null) {
      window.localStorage.removeItem(PASSKEY_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PASSKEY_STORAGE_KEY, previousCredentialId);
    }
    throw error;
  }
}

/**
 * Unlocks the existing passkey using WebAuthn PRF and derives a non-extractable
 * AES-GCM-256 key. This is the low-level derivation primitive and does not mutate
 * the module's unlocked-key state; callers that need shared state should use
 * unlockAndSetPasskeyKey().
 */
export async function unlockPasskeyKey(): Promise<CryptoKey> {
  if (!isBrowser()) throw new Error('PASSKEY_BROWSER_REQUIRED');
  const credentialId = getStoredCredentialId();
  if (!credentialId) throw new Error('PASSKEY_NOT_CONFIGURED');
  const salt = getOrCreateSalt();
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credential = await window.navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ type: 'public-key', id: credentialId }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: salt } } },
    } as PublicKeyCredentialRequestOptions & { extensions?: Record<string, unknown> },
  }) as PublicKeyCredentialWithPrf | null;
  if (!credential) throw new Error('PASSKEY_AUTH_CANCELLED');

  const prfOutput = credential.getClientExtensionResults().prf?.results?.first;
  if (!prfOutput || prfOutput.byteLength < 32) throw new Error('PASSKEY_PRF_UNAVAILABLE');
  return deriveAesKey(prfOutput, salt);
}

/**
 * Unlocks the existing passkey and atomically stores the derived key for subsequent
 * encrypted-store operations. Concurrent callers share one in-flight operation,
 * and a failed unlock never replaces an already-unlocked key.
 *
 * This function intentionally is not declared `async`: returning the exact
 * in-flight Promise is part of the concurrency contract and must preserve Promise
 * reference identity for callers that coalesce concurrent unlock attempts.
 */
let unlockedPasskeyKey: CryptoKey | null = null;
let activeUnlockPromise: Promise<CryptoKey> | null = null;

export function unlockAndSetPasskeyKey(): Promise<CryptoKey> {
  if (unlockedPasskeyKey !== null) return Promise.resolve(unlockedPasskeyKey);
  if (activeUnlockPromise !== null) return activeUnlockPromise;

  activeUnlockPromise = (async () => {
    try {
      const key = await unlockPasskeyKey();
      unlockedPasskeyKey = key;
      return key;
    } catch (error: unknown) {
      // Never log authentication payloads, CryptoKey instances, or derivation data.
      // Preserve the original public error contract and keep state unchanged because
      // assignment occurs only after complete success.
      throw error;
    } finally {
      activeUnlockPromise = null;
    }
  })();

  return activeUnlockPromise;
}

/** Sets or clears the in-memory passkey key. The CryptoKey remains non-extractable. */
export function setUnlockedPasskeyKey(key: CryptoKey | null): void {
  unlockedPasskeyKey = key;
}

/** Returns the currently unlocked in-memory passkey key, if any. */
export function getUnlockedPasskeyKey(): CryptoKey | null {
  return unlockedPasskeyKey;
}
