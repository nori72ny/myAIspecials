import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkPersonalMemoryText } from './personalMemoryGuard';

// Tests for the §9.2 pre-save guard (PR P1-2): pattern coverage per
// category, the safe texts that must pass, and the storage-layer wiring
// (upserts in activeContextGraph refuse blocked items). Storage tests use
// the same minimal IndexedDB fake as the P1-1 storage tests.

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

const USER_ID = 'guard-user-1';

async function loadGraph(): Promise<typeof import('./activeContextGraph')> {
  vi.resetModules();
  return import('./activeContextGraph');
}

beforeEach(() => {
  databases = new Map();
  window.localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('indexedDB', fakeIndexedDB);
});

// --- Pattern coverage -----------------------------------------------------------

describe('personal memory guard patterns', () => {
  it('blocks credentials in English and Japanese forms', () => {
    expect(checkPersonalMemoryText('APIキーは sk-abcdefgh12345678 です').categories).toContain('credential');
    expect(checkPersonalMemoryText('password: hunter2').categories).toContain('credential');
    expect(checkPersonalMemoryText('パスワードを変更しました').categories).toContain('credential');
    expect(checkPersonalMemoryText('-----BEGIN PRIVATE KEY-----').categories).toContain('credential');
    expect(checkPersonalMemoryText('アクセストークンは abc123 です').categories).toContain('credential');
  });

  it('blocks payment card numbers with separators or contiguous', () => {
    expect(checkPersonalMemoryText('4111-1111-1111-1111').categories).toEqual(['payment-card']);
    expect(checkPersonalMemoryText('カードは 4111 1111 1111 1111 です').categories).toContain('payment-card');
    expect(checkPersonalMemoryText('4111111111111111').categories).toContain('payment-card');
    expect(checkPersonalMemoryText('1234567890123').categories).toContain('payment-card');
  });

  it('blocks Japanese phone numbers and reports them as phone, not card', () => {
    expect(checkPersonalMemoryText('090-1234-5678').categories).toEqual(['phone-number']);
    expect(checkPersonalMemoryText('携帯は08012345678です').categories).toContain('phone-number');
    expect(checkPersonalMemoryText('03-1234-5678').categories).toContain('phone-number');
    const international = checkPersonalMemoryText('電話は+81-90-1234-5678です');
    expect(international.categories).toContain('phone-number');
    expect(international.categories).not.toContain('payment-card');
    // Full-width digits are canonicalized (NFKC) before matching.
    expect(checkPersonalMemoryText('電話番号は０９０-１２３４-５６７８です').categories).toContain('phone-number');
  });

  it('blocks dates of birth only when a date value accompanies the term', () => {
    expect(checkPersonalMemoryText('私の生年月日は1990年5月3日です').categories).toContain('date-of-birth');
    expect(checkPersonalMemoryText('誕生日は5月3日です').categories).toContain('date-of-birth');
    expect(checkPersonalMemoryText('生年月日：1990/05/03').categories).toContain('date-of-birth');
    expect(checkPersonalMemoryText('1990年生まれです').categories).toContain('date-of-birth');
    // The topic alone, without a date value, is not a guard hit (the
    // extraction rules exclude the topic; the guard protects values).
    expect(checkPersonalMemoryText('誕生日プレゼントを考えています').blocked).toBe(false);
    expect(checkPersonalMemoryText('締め切りは2026年5月3日です').blocked).toBe(false);
    expect(checkPersonalMemoryText('今日は5月3日です').blocked).toBe(false);
  });

  it('blocks PIN codes as term plus value, not the term alone', () => {
    expect(checkPersonalMemoryText('暗証番号は4821です').categories).toContain('pin-code');
    expect(checkPersonalMemoryText('PINコードは 123456 です').categories).toContain('pin-code');
    expect(checkPersonalMemoryText('暗証番号を忘れました').blocked).toBe(false);
  });

  it('blocks government ids, financial accounts, postal data, medical details, and emails', () => {
    const myNumber = checkPersonalMemoryText('マイナンバーは123456789012です');
    expect(myNumber.categories).toContain('government-id');
    expect(myNumber.categories).not.toContain('payment-card');
    expect(checkPersonalMemoryText('口座番号は1234567です').categories).toContain('financial-account');
    expect(checkPersonalMemoryText('住所：東京都港区1-2-3').categories).toContain('postal-address');
    expect(checkPersonalMemoryText('郵便番号は123-4567です').categories).toContain('postal-address');
    expect(checkPersonalMemoryText('診断名：適応障害').categories).toContain('medical-information');
    expect(checkPersonalMemoryText('連絡先は nori@example.com です').categories).toContain('email-address');
  });

  it('lets ordinary memory-worthy text pass', () => {
    const safeTexts = [
      '短くまとめてほしい',
      '表より文章が好き',
      '予算は10万円以内で進める',
      '来週の金曜に進捗を確認して',
      '注文番号は123456です',
      '合計は12345円です',
      '受付時間は9時から17時です',
      '締め切りは2026年11月16日です',
      '私は福利厚生の提案資料を担当しています',
    ];
    for (const text of safeTexts) {
      expect(checkPersonalMemoryText(text), text).toEqual({ blocked: false, categories: [] });
    }
  });
});

// --- Storage-layer wiring ---------------------------------------------------------

describe('personal memory guard wiring in the storage layer', () => {
  it('refuses a profile item whose text carries a card number', async () => {
    const graph = await loadGraph();
    const result = await graph.upsertProfileItem(USER_ID, {
      id: 'p-1',
      category: 'about',
      text: 'カードは4111-1111-1111-1111です',
      sendToModel: true,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    expect(result.saved).toBe(false);
    expect(result.reason).toBe('blocked-sensitive-content');
    await expect(graph.listProfileItems(USER_ID)).resolves.toEqual([]);
  });

  it('refuses a memory item whose source quote carries a phone number', async () => {
    const graph = await loadGraph();
    const result = await graph.upsertMemoryItem(USER_ID, {
      id: 'm-1',
      kind: 'fact',
      text: '連絡先を聞いた',
      source: { quote: '電話番号は090-1234-5678です', at: 1_000 },
      origin: 'explicit',
      status: 'active',
      sendToModel: true,
      createdAt: 1_000,
      updatedAt: 1_000,
      pinned: false,
    });
    expect(result.saved).toBe(false);
    expect(result.reason).toBe('blocked-sensitive-content');
    await expect(graph.listMemoryItems(USER_ID)).resolves.toEqual([]);
  });

  it('keeps the legacy saveDecisionNode path behind the same guard', async () => {
    const graph = await loadGraph();
    await graph.saveDecisionNode(USER_ID, { conclusion: 'カード番号は4111-1111-1111-1111です', reason: 'x' });
    await expect(graph.listMemoryItems(USER_ID)).resolves.toEqual([]);
  });

  it('still stores ordinary items (control)', async () => {
    const graph = await loadGraph();
    const profile = await graph.upsertProfileItem(USER_ID, {
      id: 'p-2',
      category: 'preference',
      text: '短くまとめてほしい',
      sendToModel: true,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    expect(profile.saved).toBe(true);
    const memory = await graph.upsertMemoryItem(USER_ID, {
      id: 'm-2',
      kind: 'preference',
      text: '表より文章が好き',
      source: { quote: '表より文章でお願い', at: 1_000 },
      origin: 'explicit',
      status: 'active',
      sendToModel: true,
      createdAt: 1_000,
      updatedAt: 1_000,
      pinned: false,
    });
    expect(memory.saved).toBe(true);
    await expect(graph.listProfileItems(USER_ID)).resolves.toHaveLength(1);
    await expect(graph.listMemoryItems(USER_ID)).resolves.toHaveLength(1);
  });
});
