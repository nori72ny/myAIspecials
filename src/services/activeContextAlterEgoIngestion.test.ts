import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OriginMemoryItem } from './activeContextGraph';

// Alter-ego 「覚えて」 ingestion (design ALTER_EGO_MODE_DESIGN_2026-11-27
// §5). The owner's spec says "覚えて" — the bare form — records a memory.
// The pre-existing A-1 extraction covers only fixed phrases
// (覚えておいて etc.), so the bare forms (prefix 「覚えて：X」, suffix
// 「Xを覚えて」, standalone 「覚えて」) are explicit memory ONLY while
// alter-ego mode is on; with the mode off, extraction is exactly as
// before. These tests run the real path — settings in localStorage ->
// ingestCompletedChatTurn -> extraction -> encrypted store.

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

// --- Module loading and settings seeding ---------------------------------------

type GraphModule = typeof import('./activeContextGraph');
type IngestionModule = typeof import('./activeContextDecisionIngestion');

async function loadModules(): Promise<{ graph: GraphModule; ingestion: IngestionModule }> {
  vi.resetModules();
  const graph = await import('./activeContextGraph');
  const ingestion = await import('./activeContextDecisionIngestion');
  return { graph, ingestion };
}

async function storedItems(graph: GraphModule): Promise<OriginMemoryItem[]> {
  return graph.listMemoryItems(graph.resolveActiveContextUserId());
}

function seedSettings(alterEgoEnabled: boolean): void {
  window.localStorage.setItem('origin_personal_settings', JSON.stringify({
    language: 'ja',
    selectedTheme: 'light',
    personalizationEnabled: true,
    alterEgoEnabled,
  }));
}

const PLAIN_ANSWER = 'はい、承知しました。';

beforeEach(() => {
  databases = new Map();
  window.localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('indexedDB', fakeIndexedDB);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('bare 「覚えて」 forms with alter-ego mode ON', () => {
  it('remembers the prefix form 「覚えて：X」 as explicit memory', async () => {
    seedSettings(true);
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '覚えて：合言葉は青い鳥です',
      answerText: PLAIN_ANSWER,
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].origin).toBe('explicit');
    expect(items[0].text).toContain('合言葉は青い鳥です');
  });

  it('remembers the suffix form 「Xを覚えて」 as explicit memory', async () => {
    seedSettings(true);
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '大阪出張の日程を覚えて',
      answerText: PLAIN_ANSWER,
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].origin).toBe('explicit');
    expect(items[0].text).toContain('大阪出張の日程');
  });

  it('takes the content from the previous sentence for the standalone 「覚えて」', async () => {
    seedSettings(true);
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '合言葉は青い鳥です。覚えて',
      answerText: PLAIN_ANSWER,
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].origin).toBe('explicit');
    expect(items[0].text).toContain('合言葉は青い鳥です');
  });

  it('does not treat a question about memory (「覚えてる？」) as a remember command', async () => {
    seedSettings(true);
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: 'この前の話、覚えてる？',
      answerText: PLAIN_ANSWER,
    });
    expect(await storedItems(graph)).toHaveLength(0);
  });

  it('still keeps credential-like content out through the §9.2 guard', async () => {
    seedSettings(true);
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '覚えて：カード番号は4111-1111-1111-1111です',
      answerText: PLAIN_ANSWER,
    });
    expect(await storedItems(graph)).toHaveLength(0);
  });
});

describe('bare 「覚えて」 forms with alter-ego mode OFF (unchanged behavior)', () => {
  // The fixture contents deliberately match no B sentence pattern
  // (締め切りは…, 担当は… and friends extract as inferred facts in BOTH
  // modes), so a zero here isolates the bare-form behavior: with the
  // mode off, nothing about these inputs is remembered at all.
  it('does not remember the prefix form', async () => {
    seedSettings(false);
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '覚えて：合言葉は青い鳥です',
      answerText: PLAIN_ANSWER,
    });
    expect(await storedItems(graph)).toHaveLength(0);
  });

  it('does not remember the suffix form', async () => {
    seedSettings(false);
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '大阪出張の日程を覚えて',
      answerText: PLAIN_ANSWER,
    });
    expect(await storedItems(graph)).toHaveLength(0);
  });

  it('does not remember the standalone form', async () => {
    seedSettings(false);
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '合言葉は青い鳥です。覚えて',
      answerText: PLAIN_ANSWER,
    });
    expect(await storedItems(graph)).toHaveLength(0);
  });
});
