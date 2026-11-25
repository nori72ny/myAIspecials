import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OriginMemoryItem,
  OriginProfileItem,
} from './activeContextGraph';

// Unit tests for the personal context assembly (Personalization Stage 1,
// PR P1-4, design §6.1/§6.2). They pin: profile-first selection without a
// relevance gate, explicit-before-inferred tiering, character 2-gram
// relevance with its threshold, the sendToModel enforcement point, the
// 800-char profile allocation and the 2,000-char total cap, and the
// formatted-text line shape. The storage harness mirrors
// activeContextGraph.test.ts (jsdom localStorage, Node webcrypto, minimal
// in-memory IndexedDB fake); every test loads a fresh module instance.

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
//
// A few assembly tests need several records with the SAME statement text in
// the store at once (tier ranking, item caps). Since PR P1-5 the upsert
// path treats a restated statement as a §8.2 duplicate and will not create
// it twice, so those fixtures seed the encrypted store directly — the same
// pattern as the bulk fixtures in activeContextGraph.test.ts. Assembly
// behavior is what those tests pin; how the records entered the store is
// not.

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

async function seedStore(store: { profile: OriginProfileItem[]; memory: OriginMemoryItem[] }): Promise<void> {
  const key = await seedEncryptionKey();
  window.localStorage.setItem(PERSONAL_KEY, await encryptPayload(key, { version: 1, ...store }));
}

// --- Fixtures ------------------------------------------------------------------

function profileItem(overrides: Partial<OriginProfileItem> = {}): OriginProfileItem {
  return {
    id: 'profile-1',
    category: 'preference',
    text: '短くまとめてほしい',
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
    text: '予算の件は確定しました',
    source: { quote: '予算の件は確定しました', at: NOV16 },
    origin: 'explicit',
    status: 'active',
    sendToModel: true,
    createdAt: NOV16,
    updatedAt: NOV16,
    pinned: false,
    ...overrides,
  };
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

// --- Assembly --------------------------------------------------------------------

describe('personal context assembly (design §6)', () => {
  it('returns an empty block when the store is empty', async () => {
    const mod = await loadFreshModule();
    await expect(mod.retrieveRelevantContext('予算の件を確認します')).resolves.toBe('');
  });

  it('puts every flagged profile item first, without a relevance gate', async () => {
    const mod = await loadFreshModule();
    await mod.upsertProfileItem(USER_ID, profileItem({ id: 'p-goal', category: 'goal', text: '静かな場所で働きたい', createdAt: NOV15, updatedAt: NOV15 }));
    await mod.upsertProfileItem(USER_ID, profileItem({ id: 'p-pref', category: 'preference', text: '短くまとめてほしい' }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'm-1' }));

    const block = await mod.retrieveRelevantContext('予算の件を確認します');
    expect(block.startsWith('プロフィール:')).toBe(true);
    // The goal item shares nothing with the prompt, yet profile items are
    // always included (§6.1); category order puts preference before goal.
    expect(block.indexOf('短くまとめてほしい')).toBeGreaterThanOrEqual(0);
    expect(block.indexOf('静かな場所で働きたい')).toBeGreaterThan(block.indexOf('短くまとめてほしい'));
    expect(block.indexOf('予算の件は確定しました')).toBeGreaterThan(block.indexOf('静かな場所で働きたい'));
    expect(block).toContain('ORIGINが覚えていること:');
  });

  it('never includes items whose sendToModel flag is off (the enforcement point)', async () => {
    const mod = await loadFreshModule();
    await mod.upsertProfileItem(USER_ID, profileItem({ id: 'p-off', text: '渡さないプロフィール', sendToModel: false }));
    await mod.upsertProfileItem(USER_ID, profileItem({ id: 'p-on', text: '渡してよいプロフィール' }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'm-off', sendToModel: false }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'm-on', text: '予算の件は来週に決めます', source: { quote: '予算の件は来週に決めます', at: NOV16 } }));

    const block = await mod.retrieveRelevantContext('予算の件を確認します');
    expect(block).not.toContain('渡さないプロフィール');
    expect(block).not.toContain('予算の件は確定しました');
    expect(block).toContain('渡してよいプロフィール');
    expect(block).toContain('予算の件は来週に決めます');
  });

  it('orders explicit memories before inferred ones even when the inferred score is higher', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({
      id: 'm-inferred',
      origin: 'inferred',
      text: '予算について相談した内容を次回も使います',
      source: { quote: '予算について相談した内容を次回も使います', at: NOV16 },
    }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({
      id: 'm-explicit',
      origin: 'explicit',
      text: '予算は月末までに確定します',
      source: { quote: '予算は月末までに確定します', at: NOV16 },
    }));

    const block = await mod.retrieveRelevantContext('予算について相談します');
    expect(block.indexOf('予算は月末までに確定します')).toBeGreaterThanOrEqual(0);
    expect(block.indexOf('予算について相談した内容を次回も使います')).toBeGreaterThan(block.indexOf('予算は月末までに確定します'));
  });

  it('ranks migrated legacy records between explicit and inferred memories', async () => {
    // Seeded directly: all three records carry the same statement (that is
    // what equalizes their relevance), and the upsert path would treat the
    // restatements as §8.2 duplicates since PR P1-5.
    await seedStore({
      profile: [],
      memory: [
        memoryItem({ id: 'm-inferred', origin: 'inferred', source: { quote: '予算の件は確定しました', at: NOV16 }, createdAt: NOV16 }),
        memoryItem({ id: 'm-legacy', origin: 'legacy-acg', source: { quote: '予算の件は確定しました', at: NOV15 }, createdAt: NOV15 }),
        memoryItem({ id: 'm-explicit', origin: 'explicit', source: { quote: '予算の件は確定しました', at: NOV14 }, createdAt: NOV14 }),
      ],
    });
    const mod = await loadFreshModule();

    const block = await mod.retrieveRelevantContext('予算の件を確認します');
    expect(block.indexOf('11月14日')).toBeGreaterThanOrEqual(0);
    expect(block.indexOf('11月15日')).toBeGreaterThan(block.indexOf('11月14日'));
    expect(block.indexOf('11月16日')).toBeGreaterThan(block.indexOf('11月15日'));
  });

  it('matches Japanese by character 2-grams where the old token matching failed', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({
      id: 'm-style',
      kind: 'preference',
      text: '文章で書くのが好きです',
      source: { quote: '文章で書いてほしい', at: NOV16 },
    }));

    // The legacy tokenizer produced one long token for this spaceless prompt
    // and found no substring match; 2-gram overlap must find the item.
    const block = await mod.retrieveRelevantContext('企画書は文章で書いてください');
    expect(block).toContain('文章で書くのが好きです');
  });

  it('excludes memories below the relevance gate', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'm-budget' }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({
      id: 'm-near',
      text: '予算の件は分かります',
      source: { quote: '予算の件は分かります', at: NOV16 },
    }));

    // The prompt shares at most two 2-grams with either item and stays
    // under the score threshold for both: nothing is relevant.
    const block = await mod.retrieveRelevantContext('明日の天気を教えてください、傘が要りますか');
    expect(block).toBe('');
  });

  it('admits a borderline memory when it is pinned, and excludes the same item unpinned', async () => {
    const prompt = 'あしたの天気はどうですか、予算のことも聞きたいです';
    const borderline = {
      kind: 'fact' as const,
      text: '予算のみ',
      source: { quote: '予算のみ', at: NOV16 },
    };

    const unpinned = await loadFreshModule();
    await unpinned.upsertMemoryItem(USER_ID, memoryItem({ id: 'm-border', ...borderline, pinned: false }));
    await expect(unpinned.retrieveRelevantContext(prompt)).resolves.toBe('');

    const pinned = await loadFreshModule();
    await pinned.upsertMemoryItem(USER_ID, memoryItem({ id: 'm-border', ...borderline, pinned: true }));
    const block = await pinned.retrieveRelevantContext(prompt);
    expect(block).toContain('予算のみ');
  });

  it('admits a borderline commitment whose deadline is near, and excludes it without one', async () => {
    const prompt = 'あしたの天気はどうですか、予算のことも聞きたいです';
    const borderline = {
      kind: 'commitment' as const,
      text: '予算のみ',
      source: { quote: '予算のみ', at: NOV16 },
    };

    const noDeadline = await loadFreshModule();
    await noDeadline.upsertMemoryItem(USER_ID, memoryItem({ id: 'm-commit', ...borderline }));
    await expect(noDeadline.retrieveRelevantContext(prompt, { now: NOV16 })).resolves.toBe('');

    const nearDeadline = await loadFreshModule();
    await nearDeadline.upsertMemoryItem(USER_ID, memoryItem({
      id: 'm-commit',
      ...borderline,
      expiresAt: NOV16 + 3 * 24 * 60 * 60 * 1000,
    }));
    const block = await nearDeadline.retrieveRelevantContext(prompt, { now: NOV16 });
    expect(block).toContain('予算のみ');
  });

  it('excludes memories that are not active (superseded, done, archived, needs-check)', async () => {
    const mod = await loadFreshModule();
    for (const status of ['superseded', 'done', 'archived', 'needs-check'] as const) {
      await mod.upsertMemoryItem(USER_ID, memoryItem({ id: `m-${status}`, status }));
    }
    await expect(mod.retrieveRelevantContext('予算の件を確認します')).resolves.toBe('');
  });

  it('keeps at most five memory items in the block', async () => {
    // Seeded directly: the seven records share one statement text, which
    // the upsert path would deduplicate since PR P1-5 (§8.2).
    await seedStore({
      profile: [],
      memory: Array.from({ length: 7 }, (_, index) => memoryItem({
        id: `m-${index}`,
        text: '予算の件は月末までに対応します',
        source: { quote: '予算の件は月末までに対応します', at: NOV16 },
        createdAt: NOV16 + index,
      })),
    });
    const mod = await loadFreshModule();
    const block = await mod.retrieveRelevantContext('予算の件を確認します');
    expect(block.match(/［決めたこと］/g)).toHaveLength(5);
  });

  it('respects the 800-char profile allocation and the 2,000-char total cap', async () => {
    // The five memory records share one statement text and are seeded
    // directly (the upsert path would deduplicate them since PR P1-5);
    // the profile items are then upserted on top of the seeded store.
    await seedStore({
      profile: [],
      memory: Array.from({ length: 5 }, (_, index) => memoryItem({
        id: `m-${index}`,
        text: `予算の件は${'あ'.repeat(255)}`,
        source: { quote: '予算の件は', at: NOV16 },
        createdAt: NOV16 + index,
      })),
    });
    const mod = await loadFreshModule();
    // Each formatted profile line is 163 chars; the 800-char allocation
    // (plus its section header) fits exactly four of them.
    for (let index = 0; index < 10; index += 1) {
      await mod.upsertProfileItem(USER_ID, profileItem({ id: `p-${index}`, text: 'あ'.repeat(150), createdAt: NOV16 + index, updatedAt: NOV16 }));
    }
    // Each formatted memory line is 276 chars; after the profile section
    // (~664 chars of budget) and the memory header, four lines fit under
    // the 2,000-char total and the fifth is skipped whole.

    const block = await mod.retrieveRelevantContext('予算の件で相談があります');
    expect(block.match(/［好み］/g)).toHaveLength(4);
    expect(block.match(/［決めたこと］/g)).toHaveLength(4);
    expect(block.length).toBeLessThanOrEqual(2_000);
    const profileSection = block.split('ORIGINが覚えていること:')[0];
    expect(profileSection.length).toBeLessThanOrEqual(800);
  });

  it('formats lines as label, text and date, in Japanese and in English', async () => {
    const mod = await loadFreshModule();
    await mod.upsertProfileItem(USER_ID, profileItem({ id: 'p-1' }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({ id: 'm-1' }));

    const ja = await mod.retrieveRelevantContext('予算の件を確認します');
    expect(ja).toContain('［好み］ 短くまとめてほしい（11月16日）');
    expect(ja).toContain('［決めたこと］ 予算の件は確定しました（11月16日）');
    expect(ja).not.toContain('{');

    const en = await mod.retrieveRelevantContext('予算の件を確認します', { language: 'en' });
    expect(en).toContain('[Preferences] 短くまとめてほしい (November 16)');
    expect(en).toContain('[Decisions] 予算の件は確定しました (November 16)');
  });
});

// --- Self-referential questions and summary assembly (2026-11-25) -------------
//
// The lexical relevance gate cannot connect "私の仕事は何ですか" with a
// stored "食品メーカーで商品開発を担当しています" — the two share no
// character 2-gram — yet answering questions about the owner from his own
// stored facts is the point of the store. Self-referential prompts bypass
// the gate for the owner's attributes, and a summary request assembles
// the whole active store instead of a five-item slice.

describe('self-referential and summary assembly (owner brain follow-up)', () => {
  it('detects self-referential prompts and summary requests', async () => {
    const mod = await loadFreshModule();
    expect(mod.isSelfReferentialPrompt('私の仕事は何ですか')).toBe(true);
    expect(mod.isSelfReferentialPrompt('私の目標を教えてください')).toBe(true);
    expect(mod.isSelfReferentialPrompt('明日の天気を教えてください')).toBe(false);
    expect(mod.isSelfReferentialPrompt('予算の件を確認します')).toBe(false);
    expect(mod.isMemorySummaryRequest('覚えていることを全部まとめてください')).toBe(true);
    expect(mod.isMemorySummaryRequest('私について覚えていることを教えてください')).toBe(true);
    expect(mod.isMemorySummaryRequest('私の仕事を覚えていますか')).toBe(false);
    expect(mod.isMemorySummaryRequest('予算の件をまとめてください')).toBe(false);
    expect(mod.isProxyAnswerRequest('私の代わりに答えてください')).toBe(true);
    expect(mod.isProxyAnswerRequest('私として返事してください')).toBe(true);
    expect(mod.isProxyAnswerRequest('この件に代わりに返信しておいてください')).toBe(true);
    expect(mod.isProxyAnswerRequest('私の仕事は何ですか')).toBe(false);
    expect(mod.isProxyAnswerRequest('明日の天気を教えてください')).toBe(false);
  });

  it('assembles the full store for a proxy-answer request and carries the proxy guards in the instruction', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({
      id: 'm-job',
      kind: 'fact',
      origin: 'inferred',
      text: '食品メーカーで商品開発を担当しています',
      source: { quote: '食品メーカーで商品開発を担当しています', at: NOV16 },
    }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({
      id: 'm-goal',
      kind: 'fact',
      origin: 'inferred',
      text: '目標は来年、独立することです',
      source: { quote: '目標は来年、独立することです', at: NOV16 },
    }));

    // Neither fact shares wording with the request; a proxy answer needs
    // the whole picture, so both are assembled.
    const block = await mod.retrieveRelevantContext('私の代わりに答えてください');
    expect(block).toContain('食品メーカーで商品開発を担当しています');
    expect(block).toContain('目標は来年、独立することです');

    // The instruction that wraps the block on the server carries the
    // proxy discipline: Orin is the owner's alter ego and answers as
    // him, in the first person (owner instruction 2026-11-25 20:20);
    // ground only in the records, admit the unknown, never finalize
    // commitments that affect other people.
    const instruction = mod.buildActiveContextInstruction(block);
    expect(instruction).toContain('Proxy answering');
    expect(instruction).toContain("you are the owner's alter ego");
    expect(instruction).toContain('answer as the owner himself, in the first person');
    expect(instruction).toContain('Do not speak about the owner in the third person');
    expect(instruction).toContain('say plainly that you do not know it');
    expect(instruction).toContain('Never finalize anything that affects other people');
    expect(instruction).toContain("subject to the owner's own confirmation");
  });

  it('answers a question about the owner from a fact that shares no wording with it', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({
      id: 'm-job',
      kind: 'fact',
      origin: 'inferred',
      text: '食品メーカーで商品開発を担当しています',
      source: { quote: '食品メーカーで商品開発を担当しています', at: NOV16 },
    }));

    const block = await mod.retrieveRelevantContext('私の仕事は何ですか');
    expect(block).toContain('食品メーカーで商品開発を担当しています');

    // The same fact stays out of an unrelated prompt: the bypass is tied
    // to the prompt being about the owner, not a global gate removal.
    const unrelated = await mod.retrieveRelevantContext('明日の天気を教えてください');
    expect(unrelated).not.toContain('食品メーカーで商品開発を担当しています');
  });

  it('keeps the gate for requests and commitments even on self-referential prompts', async () => {
    const mod = await loadFreshModule();
    await mod.upsertMemoryItem(USER_ID, memoryItem({
      id: 'm-request',
      kind: 'request',
      origin: 'inferred',
      text: '週報は金曜までに送る約束です',
      source: { quote: '週報は金曜までに送る約束です', at: NOV16 },
    }));
    await mod.upsertMemoryItem(USER_ID, memoryItem({
      id: 'm-commitment',
      kind: 'commitment',
      origin: 'inferred',
      text: '次回は金曜までに確認します',
      source: { quote: '次回は金曜までに確認します', at: NOV16 },
    }));

    const block = await mod.retrieveRelevantContext('私の仕事は何ですか');
    expect(block).not.toContain('週報は金曜までに送る約束です');
    expect(block).not.toContain('次回は金曜までに確認します');
  });

  it('assembles every active item for a summary request, in reading order, past the five-item cap', async () => {
    await seedStore({
      profile: [],
      memory: [
        memoryItem({ id: 's-req', kind: 'request', text: '月曜に週報を送ります', source: { quote: '月曜に週報を送ります', at: NOV16 } }),
        memoryItem({ id: 's-com', kind: 'commitment', text: '金曜までに結果を知らせます', source: { quote: '金曜までに結果を知らせます', at: NOV16 } }),
        memoryItem({ id: 's-fact', kind: 'fact', text: '食品メーカーで商品開発を担当しています', source: { quote: '食品メーカーで商品開発を担当しています', at: NOV16 } }),
        memoryItem({ id: 's-pref', kind: 'preference', text: '結論から話してほしい', source: { quote: '結論から話してほしい', at: NOV16 } }),
        memoryItem({ id: 's-dec', kind: 'decision', text: '新工場の件は来年まで見送ります', source: { quote: '新工場の件は来年まで見送ります', at: NOV16 } }),
        memoryItem({ id: 's-fact2', kind: 'fact', text: '趣味はキャンプです', source: { quote: '趣味はキャンプです', at: NOV16 }, createdAt: NOV16 + 10 }),
        memoryItem({ id: 's-check', kind: 'fact', status: 'needs-check', text: '未確定の事実です', source: { quote: '未確定の事実です', at: NOV16 } }),
        memoryItem({ id: 's-off', kind: 'fact', sendToModel: false, text: '渡さない事実です', source: { quote: '渡さない事実です', at: NOV16 } }),
      ],
    });
    const mod = await loadFreshModule();
    const block = await mod.retrieveRelevantContext('覚えていることを全部まとめてください');
    // All six shareable active items are present — more than the usual
    // five-item cap — while the unresolved and unflagged ones stay out.
    expect(block.match(/［/g)).toHaveLength(6);
    expect(block).not.toContain('未確定の事実です');
    expect(block).not.toContain('渡さない事実です');
    // Reading order: facts first, then preferences, decisions, requests,
    // commitments.
    expect(block.indexOf('食品メーカーで商品開発を担当しています')).toBeLessThan(block.indexOf('結論から話してほしい'));
    expect(block.indexOf('結論から話してほしい')).toBeLessThan(block.indexOf('新工場の件は来年まで見送ります'));
    expect(block.indexOf('新工場の件は来年まで見送ります')).toBeLessThan(block.indexOf('月曜に週報を送ります'));
    expect(block.indexOf('月曜に週報を送ります')).toBeLessThan(block.indexOf('金曜までに結果を知らせます'));
  });
});
