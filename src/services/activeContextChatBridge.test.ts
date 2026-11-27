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

function setSettings(settings: { language?: 'ja' | 'en'; personalizationEnabled: boolean; alterEgoEnabled?: boolean }): void {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    language: settings.language ?? 'ja',
    selectedTheme: 'light',
    personalizationEnabled: settings.personalizationEnabled,
    ...(settings.alterEgoEnabled !== undefined ? { alterEgoEnabled: settings.alterEgoEnabled } : {}),
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

describe('active context chat bridge proposals (design §6.4, PR P1-6)', () => {
  it('records a pending combination proposal for the owner to review, adding nothing to the request', async () => {
    const { graph, bridge } = await loadBridge();
    bridge.installActiveContextChatBridge();
    const userId = storedUserId();
    await graph.upsertMemoryItem(userId, memoryItem());
    setSettings({ personalizationEnabled: true });

    await window.fetch('/api/chat', { method: 'POST', body: chatBody('予算の件を確認します') });

    const proposals = await graph.listProposals(userId);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].kind).toBe('combination');
    expect(proposals[0].status).toBe('pending');
    expect(proposals[0].memoryItemIds).toEqual(['memory-1']);
    // The proposal itself never rides along with the request: the body
    // carries only the assembled context block, as in PR P1-4.
    const body = JSON.parse(String(forwarded[0].init?.body)) as { activeContext?: string };
    expect(body.activeContext).toContain('［決めたこと］ 予算の件は確定しました（11月16日）');
    expect(body.activeContext).not.toContain('提案');
  });

  it('records no proposal while the master toggle is off', async () => {
    const { graph, bridge } = await loadBridge();
    bridge.installActiveContextChatBridge();
    const userId = storedUserId();
    await graph.upsertMemoryItem(userId, memoryItem());
    setSettings({ personalizationEnabled: false });

    await window.fetch('/api/chat', { method: 'POST', body: chatBody('予算の件を確認します') });

    expect(forwarded).toHaveLength(1);
    await expect(graph.listProposals(userId)).resolves.toEqual([]);
  });
});

describe('active context chat bridge alter-ego mode (2026-11-27)', () => {
  async function seedAlterEgoProfile(graph: GraphModule, userId: string): Promise<void> {
    const profile = graph.emptyAlterEgoProfile();
    profile.fields.values = { text: '自分らしさを大切にする', sendToModel: true };
    profile.fields.memoryMemo = { text: '青い鳥が合言葉', sendToModel: false };
    profile.updatedAt = NOV16;
    await graph.setAlterEgoProfile(userId, profile);
  }

  it('adds the boolean marker and the alter-ego section while the mode is on', async () => {
    const { graph, bridge } = await loadBridge();
    bridge.installActiveContextChatBridge();
    const userId = storedUserId();
    await seedAlterEgoProfile(graph, userId);
    setSettings({ personalizationEnabled: true, alterEgoEnabled: true });

    await window.fetch('/api/chat', { method: 'POST', body: chatBody('今日の予定を教えて') });

    expect(forwarded).toHaveLength(1);
    const body = JSON.parse(String(forwarded[0].init?.body)) as { activeContext?: string; alterEgoMode?: unknown };
    // The marker is a boolean only — the persona lives in server code,
    // and the profile reaches the request only as context data.
    expect(body.alterEgoMode).toBe(true);
    expect(body.activeContext).toContain('分身プロフィール（本人が設定した分身用の情報）:');
    expect(body.activeContext).toContain('自分らしさを大切にする');
    // Device-only fields never leave the device, marker or not.
    expect(String(forwarded[0].init?.body)).not.toContain('青い鳥');
  });

  it('sends no marker key and no alter-ego section while the mode is off', async () => {
    const { graph, bridge } = await loadBridge();
    bridge.installActiveContextChatBridge();
    const userId = storedUserId();
    await seedAlterEgoProfile(graph, userId);
    setSettings({ personalizationEnabled: true });

    await window.fetch('/api/chat', { method: 'POST', body: chatBody('今日の予定を教えて') });

    expect(forwarded).toHaveLength(1);
    const body = JSON.parse(String(forwarded[0].init?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('alterEgoMode');
    expect(String(forwarded[0].init?.body)).not.toContain('分身プロフィール');
    expect(String(forwarded[0].init?.body)).not.toContain('自分らしさ');
  });

  it('never attaches the marker while the personalization master toggle is off', async () => {
    const { graph, bridge } = await loadBridge();
    bridge.installActiveContextChatBridge();
    const userId = storedUserId();
    await seedAlterEgoProfile(graph, userId);
    setSettings({ personalizationEnabled: false, alterEgoEnabled: true });

    const original = chatBody('今日の予定を教えて');
    await window.fetch('/api/chat', { method: 'POST', body: original });

    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].init?.body).toBe(original);
  });
});
