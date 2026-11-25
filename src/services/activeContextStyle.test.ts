import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OriginStyleTrait } from './activeContextGraph';
import { analyzeSpeakingStyleTurn } from './activeContextStyle';

// Unit tests for the speaking-style layer (owner persona follow-up,
// 2026-11-25). They pin: the deterministic per-turn analysis (politeness,
// scope, conclusion order, curated phrases — counts only, never text),
// the evidence thresholds (a single utterance establishes nothing), the
// scope-bucket selection at assembly time, the sendToModel enforcement
// point for traits, the owner's edit being definitive and guard-checked,
// and the ingestion hook feeding the same accumulation. The storage
// harness mirrors activeContextReflection.test.ts (jsdom localStorage,
// Node webcrypto, minimal in-memory IndexedDB fake); every test loads
// fresh module instances.

const USER_ID = 'user-1';
// Midday UTC so the formatted month/day is the 16th in UTC and JST alike.
const NOV16 = Date.UTC(2026, 10, 16, 12, 0, 0);

type GraphModule = typeof import('./activeContextGraph');
type StyleModule = typeof import('./activeContextStyle');

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

async function seedStore(store: Record<string, unknown>): Promise<void> {
  const key = await seedEncryptionKey();
  window.localStorage.setItem(PERSONAL_KEY, await encryptPayload(key, { version: 1, ...store }));
}

// --- Fixtures ------------------------------------------------------------------

function styleTrait(overrides: Partial<OriginStyleTrait> = {}): OriginStyleTrait {
  return {
    id: 'style:politeness:general',
    dimension: 'politeness',
    scope: 'general',
    value: 'polite',
    stats: { polite: 20, plain: 2, other: 0 },
    evidenceTurns: 5,
    status: 'established',
    ownerEdited: false,
    sendToModel: true,
    createdAt: NOV16,
    updatedAt: NOV16,
    ...overrides,
  };
}

async function loadGraph(): Promise<GraphModule> {
  vi.resetModules();
  const mod = await import('./activeContextGraph');
  mod.setActiveContextUserId(USER_ID);
  return mod;
}

async function loadStyle(): Promise<{ graph: GraphModule; style: StyleModule }> {
  const graph = await loadGraph();
  const style = await import('./activeContextStyle');
  return { graph, style };
}

beforeEach(() => {
  databases = new Map();
  window.localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('indexedDB', fakeIndexedDB);
});

// --- Analyzer (pure) -------------------------------------------------------------

describe('speaking-style analyzer', () => {
  it('classifies sentence endings and counts only', () => {
    const delta = analyzeSpeakingStyleTurn('今日は天気が良かったです。外に出ました。気持ちが良かったです。');
    expect(delta).not.toBeNull();
    expect(delta!.politeness).toEqual({ polite: 3, plain: 0, other: 0 });
    expect(delta!.length).toEqual({ sentences: 3, chars: 28 });
    expect(delta!.scope).toBe('general');
  });

  it('classifies the turn scope from work and private cues', () => {
    expect(analyzeSpeakingStyleTurn('明日の会議の資料を確認しました。')!.scope).toBe('work');
    expect(analyzeSpeakingStyleTurn('家族で旅行に行きます。')!.scope).toBe('private');
    expect(analyzeSpeakingStyleTurn('今日は天気が良かったです。')!.scope).toBe('general');
  });

  it('votes conclusion-first and reason-first from marker order', () => {
    const conclusionFirst = analyzeSpeakingStyleTurn('結論は進めることです。理由は予算が合うからです。');
    expect(conclusionFirst!.order).toEqual({ conclusionFirst: 1, reasonFirst: 0 });
    const reasonFirst = analyzeSpeakingStyleTurn('理由は予算が合うからです。結論は進めることです。');
    expect(reasonFirst!.order).toEqual({ conclusionFirst: 0, reasonFirst: 1 });
  });

  it('observes curated opener and set phrases once per turn, fillers included', () => {
    const delta = analyzeSpeakingStyleTurn('えー、そうですね。えー、進めますね。');
    expect(delta!.phrases).toContain('えー');
    expect(delta!.phrases).toContain('ですね');
    expect(delta!.phrases!.filter((phrase) => phrase === 'えー')).toHaveLength(1);
  });

  it('does not mistake なかなか for the かな ending', () => {
    const delta = analyzeSpeakingStyleTurn('なかなか良い結果でした。');
    expect(delta!.phrases).not.toContain('かな');
    const kana = analyzeSpeakingStyleTurn('明日は晴れるかな。');
    expect(kana!.phrases).toContain('かな');
  });

  it('returns null for a turn without a usable sentence', () => {
    expect(analyzeSpeakingStyleTurn('')).toBeNull();
    expect(analyzeSpeakingStyleTurn('あ')).toBeNull();
  });
});

// --- Accumulation and thresholds ---------------------------------------------------

const POLITE_TURN = '今日は天気が良かったです。外に出ました。気持ちが良かったです。';

describe('style accumulation', () => {
  it('establishes nothing from a single turn, however characteristic', async () => {
    const { graph, style } = await loadStyle();
    await style.observeSpeakingStyle(USER_ID, POLITE_TURN);
    const traits = await graph.listStyleTraits(USER_ID);
    expect(traits.length).toBeGreaterThan(0);
    expect(traits.every((trait) => trait.status === 'forming')).toBe(true);
    // A forming trait never reaches the model.
    await graph.setActiveContextUserId(USER_ID);
    expect(await graph.retrieveRelevantContext('今日の天気はどうですか')).toBe('');
  });

  it('establishes politeness after several agreeing turns and assembles it into the context', async () => {
    const { graph, style } = await loadStyle();
    for (let turn = 0; turn < 3; turn += 1) {
      await style.observeSpeakingStyle(USER_ID, POLITE_TURN);
    }
    const trait = (await graph.listStyleTraits(USER_ID)).find((entry) => entry.id === 'style:politeness:general');
    expect(trait?.status).toBe('established');
    expect(trait?.value).toBe('polite');
    expect(trait?.evidenceTurns).toBe(3);

    const block = await graph.retrieveRelevantContext('今日の天気はどうですか');
    expect(block).toContain('話し方・答え方の特徴:');
    expect(block).toContain('［話し方］ 丁寧な言い方（です・ます調）が中心');
    // The instruction that wraps the block carries the manner discipline.
    const instruction = graph.buildActiveContextInstruction(block);
    expect(instruction).toContain('Speaking style');
    expect(instruction).toContain('mirror that manner naturally');
  });

  it('establishes a frequent phrase only after four turns', async () => {
    const { graph, style } = await loadStyle();
    const text = 'そうですね、確認しました。問題ありませんでした。';
    for (let turn = 0; turn < 2; turn += 1) await style.observeSpeakingStyle(USER_ID, text);
    let trait = (await graph.listStyleTraits(USER_ID)).find((entry) => entry.id === 'style:phrase:general:ですね');
    expect(trait?.status).toBe('forming');
    for (let turn = 0; turn < 2; turn += 1) await style.observeSpeakingStyle(USER_ID, text);
    trait = (await graph.listStyleTraits(USER_ID)).find((entry) => entry.id === 'style:phrase:general:ですね');
    expect(trait?.status).toBe('established');
    const block = await graph.retrieveRelevantContext('進み具合を教えてください');
    expect(block).toContain('「ですね」をよく使う');
  });

  it('stores counts only: a tier-3 value in the text leaves no trace in any trait', async () => {
    const { graph, style } = await loadStyle();
    await style.observeSpeakingStyle(USER_ID, 'カード番号は1234567890123です。よろしくお願いします。');
    const traits = await graph.listStyleTraits(USER_ID);
    expect(JSON.stringify(traits)).not.toContain('1234567890123');
    expect(JSON.stringify(traits)).not.toContain('カード番号');
  });
});

// --- Assembly selection --------------------------------------------------------------

describe('style assembly selection', () => {
  it('prefers the prompt scope bucket and never leaks the other specific bucket', async () => {
    const graph = await loadGraph();
    await seedStore({
      profile: [],
      memory: [],
      proposals: [],
      blockNotices: [],
      styleTraits: [
        styleTrait(),
        styleTrait({
          id: 'style:politeness:work',
          scope: 'work',
          value: 'plain',
          stats: { polite: 2, plain: 20, other: 0 },
        }),
      ],
    });
    const workBlock = await graph.retrieveRelevantContext('会議の進め方を教えてください');
    expect(workBlock).toContain('［話し方（仕事）］ 常体の言い方（だ・である調）が中心');
    expect(workBlock).not.toContain('丁寧な言い方（です・ます調）が中心');

    const privateBlock = await graph.retrieveRelevantContext('家族旅行の計画を立てたいです');
    expect(privateBlock).toContain('［話し方］ 丁寧な言い方（です・ます調）が中心');
    expect(privateBlock).not.toContain('常体の言い方');
  });

  it('excludes traits whose sendToModel flag is off (the enforcement point)', async () => {
    const graph = await loadGraph();
    await seedStore({
      profile: [],
      memory: [],
      proposals: [],
      blockNotices: [],
      styleTraits: [styleTrait({ sendToModel: false })],
    });
    expect(await graph.retrieveRelevantContext('今日の天気はどうですか')).toBe('');
  });

  it('loads a pre-style payload (no styleTraits field) as an empty trait list', async () => {
    const graph = await loadGraph();
    await seedStore({ profile: [], memory: [], proposals: [], blockNotices: [] });
    expect(await graph.listStyleTraits(USER_ID)).toEqual([]);
  });
});

// --- Owner edits ------------------------------------------------------------------------

describe('style owner edits', () => {
  it('keeps the owner summary definitive: accumulation updates evidence, never the wording', async () => {
    const { graph, style } = await loadStyle();
    for (let turn = 0; turn < 3; turn += 1) await style.observeSpeakingStyle(USER_ID, POLITE_TURN);
    const trait = (await graph.listStyleTraits(USER_ID)).find((entry) => entry.id === 'style:politeness:general')!;
    const result = await graph.upsertStyleTrait(USER_ID, {
      ...trait,
      customSummary: '短く、はっきり話す',
      ownerEdited: true,
      status: 'established',
      updatedAt: NOV16,
    });
    expect(result.saved).toBe(true);

    await style.observeSpeakingStyle(USER_ID, POLITE_TURN);
    const after = (await graph.listStyleTraits(USER_ID)).find((entry) => entry.id === 'style:politeness:general')!;
    expect(after.customSummary).toBe('短く、はっきり話す');
    expect(after.evidenceTurns).toBe(4);
    expect(graph.describeStyleTrait(after, 'ja')).toBe('短く、はっきり話す');

    const block = await graph.retrieveRelevantContext('今日の天気はどうですか');
    expect(block).toContain('短く、はっきり話す');
  });

  it('refuses a tier-3 value as an owner-written summary (the guard applies to traits too)', async () => {
    const graph = await loadGraph();
    const byCard = await graph.upsertStyleTrait(USER_ID, styleTrait({
      customSummary: 'カードは1234 5678 9012 3456です',
      ownerEdited: true,
    }));
    expect(byCard.saved).toBe(false);
    expect(byCard.reason).toBe('blocked-sensitive-content');
    const byPassword = await graph.upsertStyleTrait(USER_ID, styleTrait({
      customSummary: 'パスワードはabc123です',
      ownerEdited: true,
    }));
    expect(byPassword.saved).toBe(false);
    expect(await graph.listStyleTraits(USER_ID)).toEqual([]);
  });

  it('deletes a trait and clears every trait with the memory', async () => {
    const graph = await loadGraph();
    await graph.upsertStyleTrait(USER_ID, styleTrait());
    expect(await graph.deleteStyleTrait(USER_ID, 'style:politeness:general')).toBe(true);
    expect(await graph.listStyleTraits(USER_ID)).toEqual([]);

    await graph.upsertStyleTrait(USER_ID, styleTrait());
    await graph.clearAll(USER_ID, 'memory');
    expect(await graph.listStyleTraits(USER_ID)).toEqual([]);
  });
});

// --- Ingestion integration ------------------------------------------------------------------

describe('style observation through chat ingestion', () => {
  it('feeds the accumulation from completed chat turns, under the master toggle', async () => {
    vi.resetModules();
    const graph = await import('./activeContextGraph');
    const ingestion = await import('./activeContextDecisionIngestion');
    for (let turn = 0; turn < 3; turn += 1) {
      await ingestion.ingestCompletedChatTurn({ userText: POLITE_TURN, answerText: '承知しました。' });
    }
    const userId = graph.resolveActiveContextUserId();
    const trait = (await graph.listStyleTraits(userId)).find((entry) => entry.id === 'style:politeness:general');
    expect(trait?.status).toBe('established');
    expect(trait?.value).toBe('polite');
  });

  it('observes nothing while the personalization toggle is off', async () => {
    window.localStorage.setItem('origin_personal_settings', JSON.stringify({
      language: 'ja', selectedTheme: 'light', personalizationEnabled: false,
    }));
    vi.resetModules();
    const graph = await import('./activeContextGraph');
    const ingestion = await import('./activeContextDecisionIngestion');
    await ingestion.ingestCompletedChatTurn({ userText: POLITE_TURN, answerText: '承知しました。' });
    const userId = graph.resolveActiveContextUserId();
    expect(await graph.listStyleTraits(userId)).toEqual([]);
  });
});
