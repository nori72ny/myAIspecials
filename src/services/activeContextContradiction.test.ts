import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OriginMemoryItem } from './activeContextGraph';

// Dedicated tests for the save-time matching of PR P1-5 (design §8):
// substantive duplicates are not created twice, explicit statements
// supersede contradiction candidates, inferred-against-inferred conflicts
// become needs-check pairs for the owner to resolve, and pairs that are
// merely refinements / complements / different-time commitments are left
// alone. The storage harness mirrors activeContextGraph.test.ts (jsdom
// localStorage, Node webcrypto, minimal in-memory IndexedDB fake); every
// test loads a fresh module instance.

const USER_ID = 'user-1';

type Module = typeof import('./activeContextGraph');

// --- Minimal IndexedDB fake --------------------------------------------------

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

function memoryItem(overrides: Partial<OriginMemoryItem> = {}): OriginMemoryItem {
  return {
    id: 'memory-1',
    kind: 'preference',
    text: '表より文章が好き',
    source: { quote: '表より文章でお願い', at: 1_000 },
    origin: 'explicit',
    status: 'active',
    sendToModel: true,
    createdAt: 1_000,
    updatedAt: 1_000,
    pinned: false,
    ...overrides,
  };
}

async function loadFreshModule(): Promise<Module> {
  vi.resetModules();
  return import('./activeContextGraph');
}

async function storedById(mod: Module): Promise<Map<string, OriginMemoryItem>> {
  const items = await mod.listMemoryItems(USER_ID);
  return new Map(items.map((item) => [item.id, item]));
}

beforeEach(() => {
  databases = new Map();
  window.localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('indexedDB', fakeIndexedDB);
});

// --- Duplicates (design §8.2) ---------------------------------------------------

describe('save-time duplicate prevention', () => {
  it('does not create the same statement twice', async () => {
    const mod = await loadFreshModule();
    const first = await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'first' }));
    expect(first.saved).toBe(true);
    expect(first.duplicate).toBeUndefined();

    const second = await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'second', createdAt: 2_000 }));
    expect(second.saved).toBe(true);
    expect(second.duplicate).toBe(true);

    const items = await mod.listMemoryItems(USER_ID);
    expect(items.map((item) => item.id)).toEqual(['first']);
  });

  it('treats a politeness-suffix restatement as the same statement', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'first' }));
    const result = await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'second', text: '表より文章が好きです' }));
    expect(result.duplicate).toBe(true);
    await expect(mod.listMemoryItems(USER_ID)).resolves.toHaveLength(1);
  });

  it('scopes duplicates and contradictions to the same kind', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'pref', kind: 'preference' }));
    const decision = await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'dec', kind: 'decision' }));
    expect(decision.duplicate).toBeUndefined();

    // The reversed statement in a DIFFERENT kind is not a candidate either.
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'dec-2', kind: 'decision', text: '文章より表が好き' }));
    const byId = await storedById(mod);
    expect(byId.get('pref')?.status).toBe('active');
    expect(byId.get('dec-2')?.status).toBe('active');
    // (dec and dec-2 are same-kind reversals: dec was superseded by dec-2.)
    expect(byId.get('dec')?.status).toBe('superseded');
  });

  it('does not treat commitments at different times as duplicates', async () => {
    const mod = await loadFreshModule();
    const text = '金曜までに報告書を送ります';
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'c-1', kind: 'commitment', text, origin: 'inferred', expiresAt: 1_000 }));
    const otherTime = await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'c-2', kind: 'commitment', text, origin: 'inferred', expiresAt: 2_000 }));
    expect(otherTime.duplicate).toBeUndefined();

    const sameTime = await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'c-3', kind: 'commitment', text, origin: 'inferred', expiresAt: 2_000 }));
    expect(sameTime.duplicate).toBe(true);
    await expect(mod.listMemoryItems(USER_ID)).resolves.toHaveLength(2);
  });

  it('creates a statement again when its only twin is no longer active', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'old', status: 'superseded' }));
    const result = await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'new' }));
    expect(result.duplicate).toBeUndefined();
    const byId = await storedById(mod);
    expect(byId.get('new')?.status).toBe('active');
    expect(byId.get('old')?.status).toBe('superseded');
  });

  it('a duplicate save leaves every other record untouched', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'target' }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'other', text: '週末は家族と過ごしたい' }));
    const result = await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'copy', createdAt: 3_000 }));
    expect(result.duplicate).toBe(true);
    const byId = await storedById(mod);
    expect(byId.size).toBe(2);
    expect(byId.get('target')?.status).toBe('active');
    expect(byId.get('other')?.status).toBe('active');
  });
});

// --- Explicit supersession (design §8.2) -----------------------------------------

describe('explicit supersession', () => {
  it('supersedes the older explicit statement and keeps the chain traceable', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'old' }));
    const result = await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'new', text: '文章より表が好き', createdAt: 2_000 }));
    expect(result.saved).toBe(true);

    const byId = await storedById(mod);
    expect(byId.size).toBe(2); // history is kept, nothing is deleted
    expect(byId.get('old')?.status).toBe('superseded');
    expect(byId.get('new')?.status).toBe('active');
    expect(byId.get('new')?.supersedesId).toBe('old');
  });

  it('supersedes an inferred record when an explicit statement conflicts', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'old', origin: 'inferred' }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'new', text: '文章より表が好き', origin: 'explicit', createdAt: 2_000 }));
    const byId = await storedById(mod);
    expect(byId.get('old')?.status).toBe('superseded');
    expect(byId.get('new')?.status).toBe('active');
    expect(byId.get('new')?.supersedesId).toBe('old');
  });

  it('supersedes a migrated legacy record the same way', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'old', origin: 'legacy-acg' }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'new', text: '文章より表が好き', origin: 'explicit', createdAt: 2_000 }));
    const byId = await storedById(mod);
    expect(byId.get('old')?.status).toBe('superseded');
    expect(byId.get('new')?.status).toBe('active');
  });
});

// --- Inferred conflicts (design §8.2 / §8.3) --------------------------------------

describe('inferred conflicts', () => {
  it('marks both inferred sides needs-check and keeps them out of the assembled context', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'first', origin: 'inferred' }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'second', origin: 'inferred', text: '文章より表が好き', createdAt: 2_000 }));

    const byId = await storedById(mod);
    expect(byId.get('first')?.status).toBe('needs-check');
    expect(byId.get('second')?.status).toBe('needs-check');

    // P1-4 assembles only `active` items, so a needs-check pair never
    // reaches the chat context while it waits for the owner.
    mod.setActiveContextUserId(USER_ID);
    await expect(mod.retrieveRelevantContext('表より文章が好き')).resolves.toBe('');
  });

  it('stores the inferred newcomer as superseded when an explicit record already states otherwise', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'explicit-old', origin: 'explicit' }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'inferred-new', origin: 'inferred', text: '文章より表が好き', createdAt: 2_000 }));
    const byId = await storedById(mod);
    expect(byId.get('explicit-old')?.status).toBe('active');
    expect(byId.get('inferred-new')?.status).toBe('superseded');
  });

  it('marks an inferred item and a migrated legacy record needs-check together', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'legacy', origin: 'legacy-acg' }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'inferred-new', origin: 'inferred', text: '文章より表が好き', createdAt: 2_000 }));
    const byId = await storedById(mod);
    expect(byId.get('legacy')?.status).toBe('needs-check');
    expect(byId.get('inferred-new')?.status).toBe('needs-check');
  });

  it('resolves through the management flow without the matching re-firing', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'first', origin: 'inferred' }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'second', origin: 'inferred', text: '文章より表が好き', createdAt: 2_000 }));

    // The management UI resolves a pair with same-id upserts: the chosen
    // one goes back to active, the other becomes superseded history.
    const items = await mod.listMemoryItems(USER_ID);
    const first = items.find((item) => item.id === 'first')!;
    const second = items.find((item) => item.id === 'second')!;
    await mod.upsertMemoryItem(USER_ID, { ...first, status: 'active', updatedAt: 3_000 });
    await mod.upsertMemoryItem(USER_ID, { ...second, status: 'superseded', updatedAt: 3_000 });

    const byId = await storedById(mod);
    expect(byId.get('first')?.status).toBe('active');
    expect(byId.get('second')?.status).toBe('superseded');
  });
});

// --- Pairs that must not be flagged (design §8.4) ----------------------------------

describe('pairs that are not contradictions', () => {
  it('keeps a refinement pair both active', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'vague', text: '文章が好き' }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'refined', createdAt: 2_000 }));
    const byId = await storedById(mod);
    expect(byId.get('vague')?.status).toBe('active');
    expect(byId.get('refined')?.status).toBe('active');
    expect(byId.get('refined')?.supersedesId).toBeUndefined();
  });

  it('keeps complementary facts both active', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'run', kind: 'fact', origin: 'inferred', text: '毎朝ランニングをしています' }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'read', kind: 'fact', origin: 'inferred', text: '毎朝読書をしています', createdAt: 2_000 }));
    const byId = await storedById(mod);
    expect(byId.get('run')?.status).toBe('active');
    expect(byId.get('read')?.status).toBe('active');
  });

  it('keeps compatible preferences both active despite a shared formulaic ending', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'short', origin: 'inferred', text: '短くまとめてほしい' }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'bullets', origin: 'inferred', text: '箇条書きでまとめてほしい', createdAt: 2_000 }));
    const byId = await storedById(mod);
    expect(byId.get('short')?.status).toBe('active');
    expect(byId.get('bullets')?.status).toBe('active');
  });

  it('never transitions a pinned record automatically', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'pinned', origin: 'inferred', pinned: true }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'new', origin: 'inferred', text: '文章より表が好き', createdAt: 2_000 }));
    const byId = await storedById(mod);
    expect(byId.get('pinned')?.status).toBe('active');
    expect(byId.get('new')?.status).toBe('active');
    expect(byId.get('new')?.supersedesId).toBeUndefined();
  });
});

// --- Ordering with the guard and with owner edits -----------------------------------

describe('ordering guarantees', () => {
  it('keeps the pre-save guard ahead of the matching', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'existing' }));
    const blocked = await mod.upsertMemoryItem(USER_ID, memoryItem({
      id: 'blocked',
      kind: 'fact',
      text: '連絡先は090-1234-5678です',
    }));
    expect(blocked.saved).toBe(false);
    expect(blocked.reason).toBe('blocked-sensitive-content');
    const byId = await storedById(mod);
    expect(byId.has('blocked')).toBe(false);
    expect(byId.get('existing')?.status).toBe('active');
  });

  it('does not re-run the matching on same-id updates (owner edits)', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'mine' }));
    // The owner rewrites the statement into its reversal: an edit, not a
    // new statement, so nothing is superseded or flagged.
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'mine', text: '文章より表が好き', updatedAt: 2_000 }));
    const items = await mod.listMemoryItems(USER_ID);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('文章より表が好き');
    expect(items[0].status).toBe('active');
    expect(items[0].supersedesId).toBeUndefined();
  });
});
