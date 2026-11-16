import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OriginMemoryItem,
  OriginProfileItem,
  OriginProposal,
} from './activeContextGraph';

// Scenario tests for the combination proposals (Personalization Stage 1,
// PR P1-6, design §6.4/§8.3/§10). They pin the appear / not-appear
// boundary of §10: a proposal appears when a request relates to
// accumulated items and combining them would change how it is carried
// out; it does not appear when the relevance is weak, when the request
// already states the items' content (content unchanged), or when the
// combination was already proposed — pending, approved or dismissed.
// They also pin that only an APPROVED combination influences the
// assembled context (inside the §6.2 proposal tier of at most three
// memory items), that a pending proposal's text never enters the
// context, and that approving a needs-check proposal resolves the group
// in favor of the newest statement. The storage harness mirrors
// activeContextReflection.test.ts.

const USER_ID = 'user-1';
// Midday UTC so the formatted month/day is the 16th in UTC and JST alike.
const NOV16 = Date.UTC(2026, 10, 16, 12, 0, 0);
const NOV15 = Date.UTC(2026, 10, 15, 12, 0, 0);
const NOV14 = Date.UTC(2026, 10, 14, 12, 0, 0);

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

// --- Store seeding -------------------------------------------------------------

const PERSONAL_KEY = `origin-personal-memory:v1:${USER_ID}`;
const KEY_DB_NAME = 'origin-active-context-key';
const KEY_STORE_NAME = 'keys';
const KEY_ID = 'aes-gcm-256';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function seedEncryptionKey(): Promise<CryptoKey> {
  const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  getDb(KEY_DB_NAME).storeData(KEY_STORE_NAME).set(KEY_ID, key);
  return key;
}

async function encryptPayload(key: CryptoKey, value: unknown): Promise<string> {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return JSON.stringify({ version: 1, iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) });
}

async function seedStore(store: { profile: OriginProfileItem[]; memory: OriginMemoryItem[]; proposals?: OriginProposal[] }): Promise<void> {
  const key = await seedEncryptionKey();
  window.localStorage.setItem(PERSONAL_KEY, await encryptPayload(key, { version: 1, ...store }));
}

// --- Fixtures ------------------------------------------------------------------

function profileItem(overrides: Partial<OriginProfileItem> = {}): OriginProfileItem {
  return {
    id: 'profile-1',
    category: 'goal',
    text: '予算の資料は短くまとめたい',
    sendToModel: true,
    createdAt: NOV16,
    updatedAt: NOV16,
    ...overrides,
  };
}

function memoryItem(overrides: Partial<OriginMemoryItem> = {}): OriginMemoryItem {
  return {
    id: 'memory-1',
    kind: 'decision',
    text: '予算の件は月末までに確定します',
    source: { quote: '予算の件は月末までに確定します', at: NOV16 },
    origin: 'explicit',
    status: 'active',
    sendToModel: true,
    createdAt: NOV16,
    updatedAt: NOV16,
    pinned: false,
    ...overrides,
  };
}

const BUDGET_PROMPT = '予算の件で相談があります';

/** Five relevant memories, one per kind (so the §8 save-time matching,
 * which only compares within a kind, cannot interfere), all sharing the
 * budget topic with the prompt at the same score; recency decides the
 * ranking, so the proposal tier is e, d, c. */
function budgetItems(): OriginMemoryItem[] {
  return [
    memoryItem({ id: 'm-a', kind: 'decision', text: '予算の件は月末までに確定します', source: { quote: '予算の件は月末までに確定します', at: NOV16 }, createdAt: NOV16 + 1, updatedAt: NOV16 + 1 }),
    memoryItem({ id: 'm-b', kind: 'preference', text: '予算の件は表より文章でまとめます', source: { quote: '予算の件は表より文章でまとめます', at: NOV16 }, createdAt: NOV16 + 2, updatedAt: NOV16 + 2 }),
    memoryItem({ id: 'm-c', kind: 'fact', text: '予算の件は経理部が担当します', source: { quote: '予算の件は経理部が担当します', at: NOV16 }, createdAt: NOV16 + 3, updatedAt: NOV16 + 3 }),
    memoryItem({ id: 'm-d', kind: 'request', text: '予算の件は金曜日に確認します', source: { quote: '予算の件は金曜日に確認します', at: NOV16 }, createdAt: NOV16 + 4, updatedAt: NOV16 + 4 }),
    memoryItem({ id: 'm-e', kind: 'commitment', text: '予算の件は来週中に報告します', source: { quote: '予算の件は来週中に報告します', at: NOV16 }, createdAt: NOV16 + 5, updatedAt: NOV16 + 5 }),
  ];
}

async function seedBudgetItems(mod: Module): Promise<void> {
  for (const item of budgetItems()) await mod.upsertMemoryItem(USER_ID, item);
}

/** A needs-check pair of the word-order-reversal shape PR P1-5 detects
 * (same frame, small local difference). Stored directly in needs-check
 * status, as the save-time matching would have left them. */
function needsCheckPair(): OriginMemoryItem[] {
  return [
    memoryItem({
      id: 'nc-old',
      kind: 'preference',
      text: '表より文章が好き',
      source: { quote: '文章で書いてほしい', at: NOV15 },
      origin: 'inferred',
      status: 'needs-check',
      createdAt: NOV15,
      updatedAt: NOV15,
    }),
    memoryItem({
      id: 'nc-new',
      kind: 'preference',
      text: '文章より表が好き',
      source: { quote: '表で書いてほしい', at: NOV16 },
      origin: 'inferred',
      status: 'needs-check',
      createdAt: NOV16,
      updatedAt: NOV16,
    }),
  ];
}

async function seedNeedsCheckPair(mod: Module): Promise<void> {
  for (const item of needsCheckPair()) await mod.upsertMemoryItem(USER_ID, item);
}

async function loadFreshModule(): Promise<Module> {
  vi.resetModules();
  const mod = await import('./activeContextGraph');
  mod.setActiveContextUserId(USER_ID);
  return mod;
}

beforeEach(() => {
  databases = new Map();
  window.localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('indexedDB', fakeIndexedDB);
});

// --- Generation: combination proposals -----------------------------------------

describe('combination proposal generation (design §6.4)', () => {
  it('proposes the top three relevant memories as one combination', async () => {
    const mod = await loadFreshModule();
    await seedBudgetItems(mod);

    const created = await mod.generateProposalsForPrompt(BUDGET_PROMPT, { now: NOV16 + 100 });
    expect(created).toHaveLength(1);
    expect(created[0].kind).toBe('combination');
    expect(created[0].status).toBe('pending');
    // The §6.2 proposal quota: at most three memory items, ranked order.
    expect(created[0].memoryItemIds).toEqual(['m-e', 'm-d', 'm-c']);
    expect(created[0].profileItemIds).toEqual([]);
    expect(created[0].promptExcerpt).toBe(BUDGET_PROMPT);

    const stored = await mod.listProposals(USER_ID);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(created[0].id);
  });

  it('cites a relevant profile item as part of the basis', async () => {
    const mod = await loadFreshModule();
    await mod.upsertProfileItem(USER_ID, profileItem({ id: 'p-goal' }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'm-a' }));

    const created = await mod.generateProposalsForPrompt(BUDGET_PROMPT, { now: NOV16 });
    expect(created).toHaveLength(1);
    expect(created[0].memoryItemIds).toEqual(['m-a']);
    expect(created[0].profileItemIds).toEqual(['p-goal']);
  });

  it('makes no proposal from profile items alone (they are always in context already)', async () => {
    const mod = await loadFreshModule();
    await mod.upsertProfileItem(USER_ID, profileItem({ id: 'p-goal' }));

    await expect(mod.generateProposalsForPrompt(BUDGET_PROMPT, { now: NOV16 })).resolves.toEqual([]);
    await expect(mod.listProposals(USER_ID)).resolves.toEqual([]);
  });

  it('makes no proposal when the relevance is weak, and none for a blank prompt', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({
      id: 'm-weather',
      kind: 'fact',
      text: '明日の天気は晴れです',
      source: { quote: '明日の天気は晴れです', at: NOV16 },
    }));

    await expect(mod.generateProposalsForPrompt(BUDGET_PROMPT, { now: NOV16 })).resolves.toEqual([]);
    await expect(mod.generateProposalsForPrompt('   ', { now: NOV16 })).resolves.toEqual([]);
    await expect(mod.listProposals(USER_ID)).resolves.toEqual([]);
  });

  it('makes no proposal for content the request already states, and drops only those items', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({
      id: 'm-stated',
      kind: 'preference',
      text: '短くまとめてほしい',
      source: { quote: '短くまとめてほしい', at: NOV16 },
    }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({
      id: 'm-fresh',
      kind: 'decision',
      text: '文章を直すときは結論から書きます',
      source: { quote: '文章を直すときは結論から書きます', at: NOV16 },
    }));

    // The request opens by restating the preference verbatim: combining
    // it in would change nothing (§10 "content unchanged"), while the
    // decision is not stated and still grounds a proposal on its own.
    const created = await mod.generateProposalsForPrompt('短くまとめてほしい。文章を直して', { now: NOV16 });
    expect(created).toHaveLength(1);
    expect(created[0].memoryItemIds).toEqual(['m-fresh']);
  });

  it('makes no proposal at all when every relevant item is already stated', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({
      id: 'm-stated',
      kind: 'preference',
      text: '短くまとめてほしい',
      source: { quote: '短くまとめてほしい', at: NOV16 },
    }));

    await expect(mod.generateProposalsForPrompt('短くまとめてほしい。文章を直して', { now: NOV16 })).resolves.toEqual([]);
    await expect(mod.listProposals(USER_ID)).resolves.toEqual([]);
  });

  it('never grounds a combination in an item the owner kept off the model', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'm-off', sendToModel: false }));

    await expect(mod.generateProposalsForPrompt(BUDGET_PROMPT, { now: NOV16 })).resolves.toEqual([]);
    await expect(mod.listProposals(USER_ID)).resolves.toEqual([]);
  });
});

// --- Generation: suppression -----------------------------------------------------

describe('proposal suppression (design §6.4/§10)', () => {
  it('does not duplicate a pending proposal, and does not re-propose an approved one', async () => {
    const mod = await loadFreshModule();
    await seedBudgetItems(mod);

    const created = await mod.generateProposalsForPrompt(BUDGET_PROMPT, { now: NOV16 });
    expect(created).toHaveLength(1);
    await expect(mod.generateProposalsForPrompt(BUDGET_PROMPT, { now: NOV16 + 1 })).resolves.toEqual([]);

    await expect(mod.setProposalStatus(USER_ID, created[0].id, 'approved', { now: NOV16 + 2 })).resolves.toBe(true);
    // A resolved proposal cannot be resolved again.
    await expect(mod.setProposalStatus(USER_ID, created[0].id, 'dismissed', { now: NOV16 + 3 })).resolves.toBe(false);
    await expect(mod.generateProposalsForPrompt(BUDGET_PROMPT, { now: NOV16 + 4 })).resolves.toEqual([]);

    const stored = await mod.listProposals(USER_ID);
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe('approved');
  });

  it('never re-proposes a dismissed combination, even for a differently worded request', async () => {
    const mod = await loadFreshModule();
    await seedBudgetItems(mod);

    const created = await mod.generateProposalsForPrompt(BUDGET_PROMPT, { now: NOV16 });
    expect(created).toHaveLength(1);
    await expect(mod.setProposalStatus(USER_ID, created[0].id, 'dismissed', { now: NOV16 + 1 })).resolves.toBe(true);

    // Same items, new wording: the pair is identified by its item set,
    // so the dismissal still holds (§6.4: a declined combination is not
    // repeated).
    await expect(mod.generateProposalsForPrompt('予算の件を相談したいです', { now: NOV16 + 2 })).resolves.toEqual([]);
    await expect(mod.generateProposalsForPrompt(BUDGET_PROMPT, { now: NOV16 + 3 })).resolves.toEqual([]);

    const stored = await mod.listProposals(USER_ID);
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe('dismissed');
  });

  it('pauses generation while ten proposals already await the owner', async () => {
    const pending: OriginProposal[] = Array.from({ length: 10 }, (_, index) => ({
      id: `seed-${index}`,
      kind: 'combination',
      status: 'pending',
      memoryItemIds: [`other-${index}`],
      profileItemIds: [],
      promptExcerpt: '別の頼みごと',
      createdAt: NOV16,
      updatedAt: NOV16,
    }));
    await seedStore({ profile: [], memory: budgetItems(), proposals: pending });
    const mod = await loadFreshModule();

    await expect(mod.generateProposalsForPrompt(BUDGET_PROMPT, { now: NOV16 + 100 })).resolves.toEqual([]);
    await expect(mod.listProposals(USER_ID)).resolves.toHaveLength(10);
  });

  it('creates at most one proposal per request, preferring the needs-check confirmation', async () => {
    const mod = await loadFreshModule();
    await seedNeedsCheckPair(mod);
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'm-a' }));

    // The request touches both the disagreeing pair and an active
    // memory; only the confirmation is recorded this time.
    const created = await mod.generateProposalsForPrompt('予算の件は文章で書いてください', { now: NOV16 + 100 });
    expect(created).toHaveLength(1);
    expect(created[0].kind).toBe('needs-check');
  });
});

// --- Generation and resolution: needs-check proposals ----------------------------

describe('needs-check proposals (design §8.3)', () => {
  it('proposes a confirmation when the request touches a disagreeing pair', async () => {
    const mod = await loadFreshModule();
    await seedNeedsCheckPair(mod);

    const created = await mod.generateProposalsForPrompt('企画書は文章で書いてください', { now: NOV16 + 100 });
    expect(created).toHaveLength(1);
    expect(created[0].kind).toBe('needs-check');
    expect(created[0].memoryItemIds).toEqual(['nc-old', 'nc-new']);
  });

  it('does not propose a confirmation for a request that does not touch the pair', async () => {
    const mod = await loadFreshModule();
    await seedNeedsCheckPair(mod);

    await expect(mod.generateProposalsForPrompt('明日の天気を教えてください、傘が要りますか', { now: NOV16 + 100 })).resolves.toEqual([]);
    await expect(mod.listProposals(USER_ID)).resolves.toEqual([]);
  });

  it('approving the confirmation keeps the newest statement and supersedes the older one', async () => {
    const mod = await loadFreshModule();
    await seedNeedsCheckPair(mod);

    const created = await mod.generateProposalsForPrompt('企画書は文章で書いてください', { now: NOV16 + 100 });
    await expect(mod.setProposalStatus(USER_ID, created[0].id, 'approved', { now: NOV16 + 200 })).resolves.toBe(true);

    const items = await mod.listMemoryItems(USER_ID);
    expect(items.find((item) => item.id === 'nc-new')?.status).toBe('active');
    expect(items.find((item) => item.id === 'nc-old')?.status).toBe('superseded');

    // The resolved statement can now be used; the replaced one cannot.
    const block = await mod.retrieveRelevantContext('企画書は文章で書いてください');
    expect(block).toContain('文章より表が好き');
    expect(block).not.toContain('表より文章が好き');
  });

  it('dismissing the confirmation leaves the pair untouched and is never proposed again', async () => {
    const mod = await loadFreshModule();
    await seedNeedsCheckPair(mod);

    const created = await mod.generateProposalsForPrompt('企画書は文章で書いてください', { now: NOV16 + 100 });
    await expect(mod.setProposalStatus(USER_ID, created[0].id, 'dismissed', { now: NOV16 + 200 })).resolves.toBe(true);

    const items = await mod.listMemoryItems(USER_ID);
    expect(items.find((item) => item.id === 'nc-new')?.status).toBe('needs-check');
    expect(items.find((item) => item.id === 'nc-old')?.status).toBe('needs-check');

    await expect(mod.generateProposalsForPrompt('企画書は文章で書いてください', { now: NOV16 + 300 })).resolves.toEqual([]);
    await expect(mod.listProposals(USER_ID)).resolves.toHaveLength(1);
  });
});

// --- Reflection: only approved combinations take effect --------------------------

describe('approved combinations in the assembled context (design §6.4/§6.2)', () => {
  const ASSEMBLY_PROMPT = '予算の件で相談があります';
  const PROPOSAL_PROMPT = '経理部の担当を確認します';

  function assemblyFixtures(): OriginMemoryItem[] {
    // Five fillers strongly relevant to the assembly prompt, plus one
    // item (m-x) that is relevant but ranks last: without an approved
    // proposal it falls outside the five-item context cap.
    const filler = (id: string, text: string, createdAt: number): OriginMemoryItem => memoryItem({
      id,
      kind: 'decision',
      text,
      source: { quote: text, at: createdAt },
      createdAt,
      updatedAt: createdAt,
    });
    return [
      memoryItem({
        id: 'm-x',
        kind: 'fact',
        text: '予算の件は経理部が担当します',
        source: { quote: '予算の件は経理部が担当します', at: NOV14 },
        createdAt: NOV14,
        updatedAt: NOV14,
      }),
      filler('m-f1', '予算の件で相談の進め方を決めます', NOV16 + 1),
      filler('m-f2', '予算の件で相談の資料を作ります', NOV16 + 2),
      filler('m-f3', '予算の件で相談の日程を決めます', NOV16 + 3),
      filler('m-f4', '予算の件で相談の回答を考えます', NOV16 + 4),
      filler('m-f5', '予算の件で相談の結果を聞きます', NOV16 + 5),
    ];
  }

  function memoryLines(block: string): string[] {
    return block.split('\n').filter((line) => line.startsWith('［'));
  }

  it('promotes an approved combination into the proposal tier; a pending one changes nothing', async () => {
    await seedStore({ profile: [], memory: assemblyFixtures() });
    const mod = await loadFreshModule();

    // Without any proposal, m-x ranks below the five-item cap.
    const before = await mod.retrieveRelevantContext(ASSEMBLY_PROMPT);
    expect(before).not.toContain('経理部が担当します');
    expect(memoryLines(before)).toHaveLength(5);

    // A different request, about the accounting owner, grounds a
    // combination on m-x alone.
    const created = await mod.generateProposalsForPrompt(PROPOSAL_PROMPT, { now: NOV16 + 100 });
    expect(created).toHaveLength(1);
    expect(created[0].memoryItemIds).toEqual(['m-x']);

    // While the proposal is pending, assembly is exactly as before, and
    // nothing about the proposal itself (its wording, the request that
    // triggered it) enters the context.
    const pending = await mod.retrieveRelevantContext(ASSEMBLY_PROMPT);
    expect(pending).not.toContain('経理部が担当します');
    expect(pending).not.toContain(PROPOSAL_PROMPT);
    expect(memoryLines(pending)).toHaveLength(5);

    // After approval, m-x is promoted to the head of the memory list,
    // inside the three-item proposal tier; the overall cap still holds.
    await expect(mod.setProposalStatus(USER_ID, created[0].id, 'approved', { now: NOV16 + 200 })).resolves.toBe(true);
    const after = await mod.retrieveRelevantContext(ASSEMBLY_PROMPT);
    expect(after).toContain('経理部が担当します');
    const lines = memoryLines(after);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('経理部が担当します');
  });

  it('never promotes an approved item whose share flag the owner turned off', async () => {
    await seedStore({ profile: [], memory: assemblyFixtures() });
    const mod = await loadFreshModule();

    const created = await mod.generateProposalsForPrompt(PROPOSAL_PROMPT, { now: NOV16 + 100 });
    await mod.setProposalStatus(USER_ID, created[0].id, 'approved', { now: NOV16 + 200 });
    const items = await mod.listMemoryItems(USER_ID);
    const target = items.find((item) => item.id === 'm-x');
    if (!target) throw new Error('fixture missing');
    await mod.upsertMemoryItem(USER_ID, { ...target, sendToModel: false, updatedAt: NOV16 + 300 });

    const block = await mod.retrieveRelevantContext(ASSEMBLY_PROMPT);
    expect(block).not.toContain('経理部が担当します');
  });
});

// --- Store behavior ----------------------------------------------------------------

describe('proposal records in the store', () => {
  it('reads stores written before proposals existed, and starts recording', async () => {
    // A pre-P1-6 payload has no proposals field at all.
    await seedStore({ profile: [], memory: [memoryItem({ id: 'm-a' })] });
    const mod = await loadFreshModule();

    await expect(mod.listProposals(USER_ID)).resolves.toEqual([]);
    const created = await mod.generateProposalsForPrompt(BUDGET_PROMPT, { now: NOV16 });
    expect(created).toHaveLength(1);
    await expect(mod.listProposals(USER_ID)).resolves.toHaveLength(1);
  });

  it('clears proposals together with the memory they were derived from', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'm-a' }));
    await mod.generateProposalsForPrompt(BUDGET_PROMPT, { now: NOV16 });
    await expect(mod.listProposals(USER_ID)).resolves.toHaveLength(1);

    await mod.clearAll(USER_ID);
    await expect(mod.listProposals(USER_ID)).resolves.toEqual([]);
    await expect(mod.listMemoryItems(USER_ID)).resolves.toEqual([]);
  });
});
