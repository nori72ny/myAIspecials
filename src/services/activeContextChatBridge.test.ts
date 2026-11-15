import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OriginMemoryItem, OriginProfileItem } from './activeContextGraph';

// Route-level tests for the chat bridge (Personalization Stage 1, PR P1-4,
// design §6.3/§7.2). They pin what actually leaves the device:
//   - personalization ON:  /api/chat requests gain the assembled block;
//   - personalization OFF: the request goes out byte-identical, with no
//     context block at all (the reflection side of the master toggle);
//   - sendToModel:false items never appear in the forwarded body;
//   - non-chat routes (the grounded research API, agent/code flows) and
//     non-POST requests are never touched.
// The storage harness mirrors activeContextGraph.test.ts.

const KEY_DB_NAME = 'origin-active-context-key';
const KEY_STORE_NAME = 'keys';
const USER_ID_STORAGE_KEY = 'origin-active-context-user-id:v1';
const SETTINGS_KEY = 'origin_personal_settings';
const NOV16 = Date.UTC(2026, 10, 16, 12, 0, 0);

type GraphModule = typeof import('./activeContextGraph');
type BridgeModule = typeof import('./activeContextChatBridge');

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

// --- Harness ---------------------------------------------------------------------

interface ForwardedCall {
  input: unknown;
  init?: RequestInit;
}

let forwarded: ForwardedCall[];

async function loadBridge(): Promise<{ graph: GraphModule; bridge: BridgeModule }> {
  vi.resetModules();
  const graph = await import('./activeContextGraph');
  const bridge = await import('./activeContextChatBridge');
  return { graph, bridge };
}

function setSettings(settings: { language?: 'ja' | 'en'; personalizationEnabled: boolean }): void {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    language: settings.language ?? 'ja',
    selectedTheme: 'light',
    personalizationEnabled: settings.personalizationEnabled,
  }));
}

function storedUserId(): string {
  const id = window.localStorage.getItem(USER_ID_STORAGE_KEY);
  if (!id) throw new Error('bridge did not create a user id');
  return id;
}

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

function chatBody(prompt: string): string {
  return JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: prompt }] });
}

beforeEach(() => {
  databases = new Map();
  window.localStorage.clear();
  delete (window as unknown as Record<string, unknown>)['__originActiveContextChatBridgeInstalled'];
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('indexedDB', fakeIndexedDB);
  forwarded = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    forwarded.push({ input, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));
});

// --- Bridge behavior -----------------------------------------------------------------

describe('active context chat bridge (design §6.3/§7.2)', () => {
  it('attaches the assembled personal context block to /api/chat requests', async () => {
    const { graph, bridge } = await loadBridge();
    bridge.installActiveContextChatBridge();
    const userId = storedUserId();
    await graph.upsertProfileItem(userId, profileItem());
    await graph.upsertMemoryItem(userId, memoryItem());
    setSettings({ personalizationEnabled: true });

    await window.fetch('/api/chat', { method: 'POST', body: chatBody('予算の件を確認します') });

    expect(forwarded).toHaveLength(1);
    const body = JSON.parse(String(forwarded[0].init?.body)) as { activeContext?: string };
    expect(body.activeContext).toContain('［好み］ 短くまとめてほしい（11月16日）');
    expect(body.activeContext).toContain('［決めたこと］ 予算の件は確定しました（11月16日）');
    expect(body.activeContext!.length).toBeLessThanOrEqual(2_000);
  });

  it('forwards the request untouched while the master toggle is off', async () => {
    const { graph, bridge } = await loadBridge();
    bridge.installActiveContextChatBridge();
    const userId = storedUserId();
    await graph.upsertProfileItem(userId, profileItem());
    setSettings({ personalizationEnabled: false });

    const original = chatBody('予算の件を確認します');
    await window.fetch('/api/chat', { method: 'POST', body: original });

    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].init?.body).toBe(original);
    expect(JSON.parse(String(forwarded[0].init?.body))).not.toHaveProperty('activeContext');
  });

  it('never lets sendToModel:false items reach the request body', async () => {
    const { graph, bridge } = await loadBridge();
    bridge.installActiveContextChatBridge();
    const userId = storedUserId();
    await graph.upsertProfileItem(userId, profileItem({ id: 'p-off', text: '渡さないプロフィール', sendToModel: false }));
    await graph.upsertProfileItem(userId, profileItem({ id: 'p-on', text: '渡してよいプロフィール' }));
    await graph.upsertMemoryItem(userId, memoryItem({ id: 'm-off', sendToModel: false }));
    setSettings({ personalizationEnabled: true });

    await window.fetch('/api/chat', { method: 'POST', body: chatBody('予算の件を確認します') });

    const raw = String(forwarded[0].init?.body);
    expect(raw).not.toContain('渡さないプロフィール');
    expect(raw).not.toContain('予算の件は確定しました');
    expect(raw).toContain('渡してよいプロフィール');
  });

  it('labels the block in English when the stored language is English', async () => {
    const { graph, bridge } = await loadBridge();
    bridge.installActiveContextChatBridge();
    const userId = storedUserId();
    await graph.upsertProfileItem(userId, profileItem());
    setSettings({ language: 'en', personalizationEnabled: true });

    await window.fetch('/api/chat', { method: 'POST', body: chatBody('hello') });

    const body = JSON.parse(String(forwarded[0].init?.body)) as { activeContext?: string };
    expect(body.activeContext).toContain('[Preferences] 短くまとめてほしい (November 16)');
  });

  it('does not touch the grounded research route', async () => {
    const { graph, bridge } = await loadBridge();
    bridge.installActiveContextChatBridge();
    const userId = storedUserId();
    await graph.upsertProfileItem(userId, profileItem());
    setSettings({ personalizationEnabled: true });

    const original = JSON.stringify({ query: '予算の件を調べてください' });
    await window.fetch('/api/research/v1.1/query', { method: 'POST', body: original });

    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].init?.body).toBe(original);
  });

  it('does not touch non-POST requests to /api/chat', async () => {
    const { bridge } = await loadBridge();
    bridge.installActiveContextChatBridge();
    setSettings({ personalizationEnabled: true });

    await window.fetch('/api/chat', { method: 'GET' });

    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].init?.body).toBeUndefined();
  });
});
