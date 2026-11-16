// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OriginMemoryItem, OriginProfileItem } from '../services/activeContextGraph';

// Component tests for the "About you" management section (PR P1-3, design
// §7). They run against the real P1-1 storage layer (encrypted, on-device)
// with the same minimal IndexedDB fake as the storage tests, so add /
// edit / delete / clear-all / toggle behavior is pinned end to end,
// including "a deleted item never comes back".

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

  constructor(private readonly db: FakeDb, private readonly storeName: string) {}

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

// --- Loading / rendering helpers ------------------------------------------------

type GraphModule = typeof import('../services/activeContextGraph');
type ComponentModule = typeof import('./PersonalizationSettings');

const AT = new Date(2026, 10, 16, 12, 0, 0).getTime(); // 2026-11-16 local

async function loadModules(): Promise<{ graph: GraphModule; PersonalizationSettings: ComponentModule['default'] }> {
  vi.resetModules();
  const graph = await import('../services/activeContextGraph');
  const component = await import('./PersonalizationSettings');
  return { graph, PersonalizationSettings: component.default };
}

function renderSection(
  PersonalizationSettings: ComponentModule['default'],
  overrides: Partial<React.ComponentProps<ComponentModule['default']>> = {},
) {
  const onToggleEnabled = vi.fn();
  render(
    <PersonalizationSettings
      language="ja"
      enabled
      onToggleEnabled={onToggleEnabled}
      {...overrides}
    />,
  );
  return { onToggleEnabled };
}

function memoryItem(overrides: Partial<OriginMemoryItem> = {}): OriginMemoryItem {
  return {
    id: 'memory-1',
    kind: 'preference',
    text: '表より文章が好き',
    source: { quote: '表より文章でお願い', at: AT },
    origin: 'explicit',
    status: 'active',
    sendToModel: true,
    createdAt: AT,
    updatedAt: AT,
    pinned: false,
    ...overrides,
  };
}

function profileItem(overrides: Partial<OriginProfileItem> = {}): OriginProfileItem {
  return {
    id: 'profile-1',
    category: 'preference',
    text: '短くまとめてほしい',
    sendToModel: true,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

beforeEach(() => {
  databases = new Map();
  window.localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('indexedDB', fakeIndexedDB);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// --- Profile -----------------------------------------------------------------

describe('PersonalizationSettings profile block', () => {
  it('adds, edits and deletes a profile item, and the deleted item never comes back', async () => {
    const { graph, PersonalizationSettings } = await loadModules();
    const userId = graph.resolveActiveContextUserId();
    renderSection(PersonalizationSettings);
    await screen.findByText('まだ何も書かれていません。');

    fireEvent.change(screen.getByLabelText('カテゴリ'), { target: { value: 'preference' } });
    fireEvent.change(screen.getByLabelText('内容'), { target: { value: '短くまとめてほしい' } });
    fireEvent.click(screen.getByRole('button', { name: '追加する' }));

    await screen.findByText('短くまとめてほしい');
    let stored = await graph.listProfileItems(userId);
    expect(stored).toHaveLength(1);
    expect(stored[0].category).toBe('preference');
    expect(stored[0].sendToModel).toBe(true);

    const row = screen.getByTestId(`profile-item-${stored[0].id}`);
    fireEvent.click(within(row).getByRole('button', { name: '編集' }));
    fireEvent.change(within(row).getByRole('textbox'), { target: { value: '結論を先に知りたい' } });
    fireEvent.click(within(row).getByRole('button', { name: '保存' }));

    // Poll the store itself: the edit textarea also carries the new text,
    // so a text query alone cannot prove the save landed.
    await waitFor(async () => {
      const items = await graph.listProfileItems(userId);
      expect(items[0]?.text).toBe('結論を先に知りたい');
    });
    await screen.findByText('結論を先に知りたい');
    expect(screen.queryByText('短くまとめてほしい')).toBeNull();
    stored = await graph.listProfileItems(userId);

    fireEvent.click(within(screen.getByTestId(`profile-item-${stored[0].id}`)).getByRole('button', { name: '消す' }));
    await waitFor(async () => {
      expect(await graph.listProfileItems(userId)).toHaveLength(0);
    });
    await screen.findByText('まだ何も書かれていません。');

    // Re-render against the same store: the deleted item stays deleted.
    cleanup();
    renderSection(PersonalizationSettings);
    await screen.findByText('まだ何も書かれていません。');
    expect(screen.queryByText('結論を先に知りたい')).toBeNull();
  });

  it('stops a profile save that hits the pre-save guard and explains why', async () => {
    const { graph, PersonalizationSettings } = await loadModules();
    const userId = graph.resolveActiveContextUserId();
    renderSection(PersonalizationSettings);
    await screen.findByText('まだ何も書かれていません。');

    fireEvent.change(screen.getByLabelText('内容'), { target: { value: 'カード番号は4111-1111-1111-1111です' } });
    fireEvent.click(screen.getByRole('button', { name: '追加する' }));

    await screen.findByText(/この内容は保存できませんでした/);
    expect(await graph.listProfileItems(userId)).toHaveLength(0);
    // The draft is kept so the owner can fix it.
    expect((screen.getByLabelText('内容') as HTMLInputElement).value).toContain('4111');
  });

  it('offers only the four stage-1 categories and no stage-2 fields', async () => {
    const { PersonalizationSettings } = await loadModules();
    renderSection(PersonalizationSettings);
    await screen.findByText('まだ何も書かれていません。');

    const select = screen.getByLabelText('カテゴリ') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'わたしについて', '性格・考え方', '好み', 'やりたいこと・目標',
    ]);
    const section = screen.getByTestId('personalization-section');
    expect(within(section).queryByLabelText(/住所/)).toBeNull();
    expect(within(section).queryByLabelText(/電話番号/)).toBeNull();
    expect(within(section).queryByLabelText(/生年月日/)).toBeNull();
    expect(within(section).getByText('住所・電話番号・生年月日・カード情報は書かないでください')).toBeTruthy();
  });

  it('keeps profile entry working while the master toggle is off', async () => {
    const { graph, PersonalizationSettings } = await loadModules();
    const userId = graph.resolveActiveContextUserId();
    renderSection(PersonalizationSettings, { enabled: false });

    expect(await screen.findByText(/オフにすると、新しく覚えることも、回答に使うことも止まります/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('内容'), { target: { value: '40代です' } });
    fireEvent.click(screen.getByRole('button', { name: '追加する' }));
    await screen.findByText('40代です');
    expect(await graph.listProfileItems(userId)).toHaveLength(1);
  });
});

// --- Master toggle -----------------------------------------------------------

describe('PersonalizationSettings master toggle', () => {
  it('reports toggle changes to the settings owner', async () => {
    const { PersonalizationSettings } = await loadModules();
    const { onToggleEnabled } = renderSection(PersonalizationSettings);
    await screen.findByText('まだ何も書かれていません。');

    fireEvent.click(screen.getByRole('switch', { name: '覚えている内容を、回答に活かす' }));
    expect(onToggleEnabled).toHaveBeenCalledWith(false);
  });
});

// --- Memory ------------------------------------------------------------------

describe('PersonalizationSettings memory block', () => {
  it('lists memory grouped by kind with origin and source, and edits, unshares and deletes', async () => {
    const { graph, PersonalizationSettings } = await loadModules();
    const userId = graph.resolveActiveContextUserId();
    await graph.upsertMemoryItem(userId, memoryItem());
    await graph.upsertMemoryItem(userId, memoryItem({
      id: 'memory-2',
      kind: 'fact',
      text: '自宅にPCを持っていません',
      origin: 'inferred',
      source: { quote: '自宅にPCはないです', at: AT },
    }));

    renderSection(PersonalizationSettings);
    await screen.findByText('表より文章が好き');
    expect(screen.getByText('いま 2 件を覚えています（上限は 500 件です）。')).toBeTruthy();

    const row = screen.getByTestId('memory-item-memory-1');
    expect(row.textContent).toContain('あなたが覚えさせた');
    expect(row.textContent).toContain('11月16日の会話から');
    const factRow = screen.getByTestId('memory-item-memory-2');
    expect(factRow.textContent).toContain('会話から');
    expect(factRow.textContent).toContain('11月16日の会話から');

    // Unshare: sendToModel off, with the device-only note.
    fireEvent.click(within(row).getByRole('switch', { name: /チャットのAIに渡す/ }));
    await waitFor(async () => {
      const items = await graph.listMemoryItems(userId);
      expect(items.find((item) => item.id === 'memory-1')?.sendToModel).toBe(false);
    });
    await within(row).findByText('この端末の中だけで使います');

    // Edit the text in place (polling the store, as the draft textarea
    // also carries the new text while the save is in flight).
    fireEvent.click(within(row).getByRole('button', { name: '編集' }));
    fireEvent.change(within(row).getByRole('textbox'), { target: { value: '文章だけでお願いしたい' } });
    fireEvent.click(within(row).getByRole('button', { name: '保存' }));
    await waitFor(async () => {
      const edited = (await graph.listMemoryItems(userId)).find((item) => item.id === 'memory-1');
      expect(edited?.text).toBe('文章だけでお願いしたい');
      expect(edited?.sendToModel).toBe(false);
    });
    await screen.findByText('文章だけでお願いしたい');

    // Delete: gone from the store and from a fresh render.
    fireEvent.click(within(screen.getByTestId('memory-item-memory-1')).getByRole('button', { name: '消す' }));
    await waitFor(async () => {
      const items = await graph.listMemoryItems(userId);
      expect(items.map((item) => item.id)).toEqual(['memory-2']);
    });
    cleanup();
    renderSection(PersonalizationSettings);
    await screen.findByText('自宅にPCを持っていません');
    expect(screen.queryByText('文章だけでお願いしたい')).toBeNull();
  });

  it('opens the source conversation only when it still exists', async () => {
    const { graph, PersonalizationSettings } = await loadModules();
    const userId = graph.resolveActiveContextUserId();
    await graph.upsertMemoryItem(userId, memoryItem({
      source: { sessionId: 'session-1', quote: '表より文章でお願い', at: AT },
    }));
    const onOpenSourceSession = vi.fn();
    renderSection(PersonalizationSettings, {
      sourceSessionIds: new Set(['session-1']),
      onOpenSourceSession,
    });

    const link = await screen.findByRole('button', { name: '11月16日の会話から' });
    fireEvent.click(link);
    expect(onOpenSourceSession).toHaveBeenCalledWith('session-1');

    cleanup();
    renderSection(PersonalizationSettings, { sourceSessionIds: new Set(), onOpenSourceSession });
    const rowAgain = await screen.findByTestId('memory-item-memory-1');
    await waitFor(() => expect(rowAgain.textContent).toContain('11月16日の会話から'));
    expect(screen.queryByRole('button', { name: '11月16日の会話から' })).toBeNull();
  });

  it('shows superseded items folded away as history, not in the main list', async () => {
    const { graph, PersonalizationSettings } = await loadModules();
    const userId = graph.resolveActiveContextUserId();
    await graph.upsertMemoryItem(userId, memoryItem({ id: 'old-1', text: '古い好みです', status: 'superseded' }));

    renderSection(PersonalizationSettings);
    const foldedText = await screen.findByText('古い好みです');
    expect(foldedText.closest('details')).not.toBeNull();
    expect(screen.getByText('まだ覚えていることはありません。')).toBeTruthy();
  });

  it('resolves needs-check items by choosing one, and can delete both', async () => {
    const { graph, PersonalizationSettings } = await loadModules();
    const userId = graph.resolveActiveContextUserId();
    await graph.upsertMemoryItem(userId, memoryItem({
      id: 'check-1', kind: 'decision', text: '予算は10万円以内', status: 'needs-check',
    }));
    await graph.upsertMemoryItem(userId, memoryItem({
      id: 'check-2', kind: 'decision', text: '予算は20万円以内', status: 'needs-check',
    }));

    renderSection(PersonalizationSettings);
    await screen.findByText('どちらが今の内容ですか');
    const chosenRow = screen.getByTestId('memory-item-check-1');
    fireEvent.click(within(chosenRow).getByRole('button', { name: 'こちらを使う' }));
    await waitFor(async () => {
      const items = await graph.listMemoryItems(userId);
      expect(items.find((item) => item.id === 'check-1')?.status).toBe('active');
      expect(items.find((item) => item.id === 'check-2')?.status).toBe('superseded');
    });

    // A second conflicting pair can be removed together.
    await graph.upsertMemoryItem(userId, memoryItem({
      id: 'check-3', kind: 'decision', text: '締め切りは金曜', status: 'needs-check',
    }));
    await graph.upsertMemoryItem(userId, memoryItem({
      id: 'check-4', kind: 'decision', text: '締め切りは月曜', status: 'needs-check',
    }));
    cleanup();
    renderSection(PersonalizationSettings);
    await screen.findByText('どちらが今の内容ですか');
    fireEvent.click(screen.getByRole('button', { name: '両方消す' }));
    await waitFor(async () => {
      const items = await graph.listMemoryItems(userId);
      expect(items.map((item) => item.id).sort()).toEqual(['check-1', 'check-2']);
    });
  });
});

// --- Clear all -----------------------------------------------------------------

describe('PersonalizationSettings clear all', () => {
  it('clears memory only by default, keeps the profile and never touches conversation history', async () => {
    const { graph, PersonalizationSettings } = await loadModules();
    const userId = graph.resolveActiveContextUserId();
    await graph.upsertProfileItem(userId, profileItem());
    await graph.upsertMemoryItem(userId, memoryItem());
    window.localStorage.setItem('origin_personal_sessions', '[{"id":"session-1"}]');

    renderSection(PersonalizationSettings);
    await screen.findByText('表より文章が好き');

    fireEvent.click(screen.getByTestId('personal-clear-all-button'));
    expect(await screen.findByText(/会話の履歴は消えません/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '全て消す' }));

    await screen.findByText('覚えていることを全て消しました。');
    expect(await graph.listMemoryItems(userId)).toHaveLength(0);
    expect(await graph.listProfileItems(userId)).toHaveLength(1);
    expect(window.localStorage.getItem('origin_personal_sessions')).toBe('[{"id":"session-1"}]');

    // With the profile included, everything goes.
    fireEvent.click(screen.getByTestId('personal-clear-all-button'));
    fireEvent.click(screen.getByLabelText('プロフィールも一緒に消す'));
    fireEvent.click(screen.getByRole('button', { name: '全て消す' }));
    await waitFor(async () => {
      expect(await graph.listProfileItems(userId)).toHaveLength(0);
    });
  });
});

// --- Proposals (design §6.4, PR P1-6) -------------------------------------------

describe('PersonalizationSettings proposals', () => {
  it('shows a pending combination proposal and approves it', async () => {
    const { graph, PersonalizationSettings } = await loadModules();
    const userId = graph.resolveActiveContextUserId();
    await graph.upsertMemoryItem(userId, memoryItem({ id: 'm-1' }));
    const created = await graph.generateProposalsForPrompt('文章で書いてください', { now: AT });
    expect(created).toHaveLength(1);

    renderSection(PersonalizationSettings);
    const card = await screen.findByTestId(`proposal-${created[0].id}`);
    expect(within(card).getByText('表より文章が好き')).toBeTruthy();
    expect(within(card).getByText(/「文章で書いてください」という頼みごとから/)).toBeTruthy();

    fireEvent.click(within(card).getByRole('button', { name: '合わせて進める' }));
    await waitFor(async () => {
      expect((await graph.listProposals(userId))[0].status).toBe('approved');
    });
    await waitFor(() => {
      expect(screen.queryByTestId(`proposal-${created[0].id}`)).toBeNull();
    });
  });

  it('dismisses a combination proposal, and the same combination is never proposed again', async () => {
    const { graph, PersonalizationSettings } = await loadModules();
    const userId = graph.resolveActiveContextUserId();
    await graph.upsertMemoryItem(userId, memoryItem({ id: 'm-1' }));
    const created = await graph.generateProposalsForPrompt('文章で書いてください', { now: AT });
    expect(created).toHaveLength(1);

    renderSection(PersonalizationSettings);
    const card = await screen.findByTestId(`proposal-${created[0].id}`);
    fireEvent.click(within(card).getByRole('button', { name: '今は使わない' }));
    await waitFor(async () => {
      expect((await graph.listProposals(userId))[0].status).toBe('dismissed');
    });
    await waitFor(() => {
      expect(screen.queryByTestId(`proposal-${created[0].id}`)).toBeNull();
    });

    // The dismissed pair stays dismissed: generating again records nothing.
    await expect(graph.generateProposalsForPrompt('文章で書いてください', { now: AT + 1 })).resolves.toEqual([]);
    expect(await graph.listProposals(userId)).toHaveLength(1);
  });

  it('approves a needs-check proposal in favor of the newest statement', async () => {
    const { graph, PersonalizationSettings } = await loadModules();
    const userId = graph.resolveActiveContextUserId();
    await graph.upsertMemoryItem(userId, memoryItem({
      id: 'nc-old', text: '表より文章が好き', origin: 'inferred', status: 'needs-check',
      source: { quote: '文章で書いてほしい', at: AT }, createdAt: AT - 1000, updatedAt: AT - 1000,
    }));
    await graph.upsertMemoryItem(userId, memoryItem({
      id: 'nc-new', text: '文章より表が好き', origin: 'inferred', status: 'needs-check',
      source: { quote: '表で書いてほしい', at: AT },
    }));
    const created = await graph.generateProposalsForPrompt('文章で書いてください', { now: AT });
    expect(created).toHaveLength(1);
    expect(created[0].kind).toBe('needs-check');

    renderSection(PersonalizationSettings);
    const card = await screen.findByTestId(`proposal-${created[0].id}`);
    expect(within(card).getByText('食い違っている内容の確認')).toBeTruthy();
    expect(within(card).getByText('表より文章が好き')).toBeTruthy();
    expect(within(card).getByText('文章より表が好き')).toBeTruthy();

    fireEvent.click(within(card).getByRole('button', { name: '新しい方を使う' }));
    await waitFor(async () => {
      const items = await graph.listMemoryItems(userId);
      expect(items.find((item) => item.id === 'nc-new')?.status).toBe('active');
      expect(items.find((item) => item.id === 'nc-old')?.status).toBe('superseded');
      expect((await graph.listProposals(userId))[0].status).toBe('approved');
    });
    await waitFor(() => {
      expect(screen.queryByTestId(`proposal-${created[0].id}`)).toBeNull();
    });
  });
});
