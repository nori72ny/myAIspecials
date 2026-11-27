import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlterEgoProfile } from './activeContextGraph';

// Alter-ego profile storage and context assembly (design
// ALTER_EGO_MODE_DESIGN_2026-11-27 §2/§3). The owner's alter-ego fields
// live in the same encrypted on-device store as every other personal
// record; these tests pin the round-trip, encryption at rest, the §9.2
// pre-save guard, and the assembly rule that the alter-ego section
// appears only when the caller opts in — with the option absent (every
// pre-existing caller) the assembled context is exactly as before.

// --- Minimal IndexedDB fake (same shape as activeContextGraph.test.ts) -------

class FakeRequest<T> {
  result!: T;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
}

class FakeObjectStore {
  constructor(
    private readonly data: Map<string, unknown>,
    private readonly tx: FakeTransaction,
  ) {}

  get(key: string): FakeRequest<unknown> {
    const request = new FakeRequest<unknown>();
    queueMicrotask(() => {
      request.result = this.data.get(key);
      request.onsuccess?.();
    });
    return request;
  }

  put(value: unknown, key: string): FakeRequest<undefined> {
    const request = new FakeRequest<undefined>();
    queueMicrotask(() => {
      this.data.set(key, value);
      request.onsuccess?.();
      queueMicrotask(() => this.tx.oncomplete?.());
    });
    return request;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: unknown = null;

  constructor(
    private readonly db: FakeDb,
    private readonly storeName: string,
  ) {}

  objectStore(name: string): FakeObjectStore {
    return new FakeObjectStore(this.db.storeData(name), this);
  }
}

class FakeDb {
  private readonly stores = new Map<string, Map<string, unknown>>();
  upgraded = false;
  readonly objectStoreNames = {
    contains: (name: string): boolean => this.stores.has(name),
  };

  createObjectStore(name: string): void {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
  }

  storeData(name: string): Map<string, unknown> {
    this.createObjectStore(name);
    return this.stores.get(name)!;
  }

  transaction(storeName: string, _mode: string): FakeTransaction {
    return new FakeTransaction(this, storeName);
  }
}

let databases: Map<string, FakeDb>;

function getDb(name: string): FakeDb {
  let db = databases.get(name);
  if (!db) {
    db = new FakeDb();
    databases.set(name, db);
  }
  return db;
}

const fakeIndexedDB = {
  open(name: string, _version?: number): FakeRequest<FakeDb> {
    const request = new FakeRequest<FakeDb>();
    const db = getDb(name);
    queueMicrotask(() => {
      request.result = db;
      if (!db.upgraded) {
        db.upgraded = true;
        request.onupgradeneeded?.();
      }
      request.onsuccess?.();
    });
    return request;
  },
};

// --- Fixtures ------------------------------------------------------------------

const USER_ID = 'user-1';
const PERSONAL_KEY = `origin-personal-memory:v1:${USER_ID}`;

type Module = typeof import('./activeContextGraph');

async function loadFreshModule(): Promise<Module> {
  vi.resetModules();
  return import('./activeContextGraph');
}

function alterEgoProfile(mod: Module, overrides: Partial<Record<string, { text: string; sendToModel: boolean }>> = {}): AlterEgoProfile {
  const profile = mod.emptyAlterEgoProfile();
  for (const [key, field] of Object.entries(overrides)) {
    (profile.fields as Record<string, { text: string; sendToModel: boolean }>)[key] = field;
  }
  profile.updatedAt = 1_000;
  return profile;
}

beforeEach(() => {
  databases = new Map();
  window.localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('indexedDB', fakeIndexedDB);
});

describe('alter-ego profile storage', () => {
  it('reads as an empty eight-field profile before anything is saved', async () => {
    const mod = await loadFreshModule();
    const profile = await mod.getAlterEgoProfile(USER_ID);
    expect(Object.keys(profile.fields)).toHaveLength(8);
    expect(profile.fields.nickname).toEqual({ text: '', sendToModel: true });
    expect(profile.fields.memoryMemo).toEqual({ text: '', sendToModel: true });
    expect(profile.updatedAt).toBe(0);
  });

  it('round-trips through the encrypted store without plaintext at rest', async () => {
    const mod = await loadFreshModule();
    const profile = alterEgoProfile(mod, {
      values: { text: '自分らしさを大切にする', sendToModel: true },
      memoryMemo: { text: '青い鳥が合言葉', sendToModel: false },
    });
    const result = await mod.setAlterEgoProfile(USER_ID, profile);
    expect(result.saved).toBe(true);

    const stored = await mod.getAlterEgoProfile(USER_ID);
    expect(stored.fields.values).toEqual({ text: '自分らしさを大切にする', sendToModel: true });
    expect(stored.fields.memoryMemo).toEqual({ text: '青い鳥が合言葉', sendToModel: false });
    expect(stored.updatedAt).toBe(1_000);

    const rawPayload = window.localStorage.getItem(PERSONAL_KEY) ?? '';
    expect(rawPayload).not.toContain('自分らしさ');
    expect(rawPayload).not.toContain('青い鳥');
  });

  it('refuses the whole record when a field carries a credential-like value (§9.2 guard)', async () => {
    const mod = await loadFreshModule();
    const profile = alterEgoProfile(mod, {
      memoryMemo: { text: 'カード番号は4111-1111-1111-1111です', sendToModel: true },
    });
    const result = await mod.setAlterEgoProfile(USER_ID, profile);
    expect(result.saved).toBe(false);
    expect(result.reason).toBe('blocked-sensitive-content');

    const stored = await mod.getAlterEgoProfile(USER_ID);
    expect(stored.updatedAt).toBe(0);
    expect(stored.fields.memoryMemo.text).toBe('');
  });
});

describe('alter-ego context assembly', () => {
  it('adds the alter-ego section only with the option, and only sendToModel fields', async () => {
    const mod = await loadFreshModule();
    mod.setActiveContextUserId(USER_ID);
    await mod.upsertProfileItem(USER_ID, {
      id: 'profile-1',
      category: 'preference',
      text: '短くまとめてほしい',
      sendToModel: true,
      createdAt: 1_000,
      updatedAt: 1_000,
    });

    const baseline = await mod.retrieveRelevantContext('今日の予定を教えて');
    expect(baseline).toContain('短くまとめてほしい');

    await mod.setAlterEgoProfile(USER_ID, alterEgoProfile(mod, {
      values: { text: '自分らしさを大切にする', sendToModel: true },
      memoryMemo: { text: '青い鳥が合言葉', sendToModel: false },
    }));

    // Without the option the assembled context is exactly the baseline:
    // the stored alter-ego record changes nothing for existing callers.
    const withoutOption = await mod.retrieveRelevantContext('今日の予定を教えて');
    expect(withoutOption).toBe(baseline);
    expect(withoutOption).not.toContain('分身プロフィール');

    const withOption = await mod.retrieveRelevantContext('今日の予定を教えて', { alterEgo: true });
    expect(withOption).toContain('分身プロフィール（本人が設定した分身用の情報）:');
    expect(withOption).toContain('自分らしさを大切にする');
    // A field flagged device-only never leaves the device, even in
    // alter-ego mode.
    expect(withOption).not.toContain('青い鳥');
    // The ordinary personal context is still assembled alongside.
    expect(withOption).toContain('短くまとめてほしい');
  });
});
