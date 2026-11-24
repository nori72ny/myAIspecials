import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OriginMemoryItem } from './activeContextGraph';

// Fixed-set tests for the rebuilt conversation memory ingestion (PR P1-2).
// Every scenario runs the real path — ingestCompletedChatTurn ->
// extraction rules -> P1-1 CRUD -> encrypted store — and asserts on the
// stored items, so the acceptance conditions of the design §10 P1-2 are
// pinned end to end: A (explicit) scenarios have zero misses, B
// (sentence-pattern) scenarios extract the expected kind and nothing from
// the negative set, the §9.2 guard and the stage-2 topic exclusion keep
// protected values out, and ingestion performs no network requests.

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

// --- Module loading -------------------------------------------------------------

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

// --- A-1: explicit phrasing (zero misses on the fixed set) -----------------------

describe('A-1 explicit phrasing extraction', () => {
  it('remembers a stated fact after 覚えておいて', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '覚えておいて、私は自宅にPCを持っていません',
      answerText: PLAIN_ANSWER,
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('fact');
    expect(items[0].origin).toBe('explicit');
    expect(items[0].text).toContain('自宅にPCを持っていません');
    expect(items[0].status).toBe('active');
    expect(items[0].sendToModel).toBe(true);
  });

  it('takes the content from the previous sentence when the instruction stands alone', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '私の担当は福利厚生の提案資料です。覚えておいてください',
      answerText: PLAIN_ANSWER,
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('fact');
    expect(items[0].origin).toBe('explicit');
    expect(items[0].text).toContain('私の担当は福利厚生の提案資料です');
    expect(items[0].source.quote).toContain('私の担当は福利厚生の提案資料です');
  });

  it('classifies continuation phrasing by content: 次回も + format -> preference', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '次回も表ではなく文章でお願いします',
      answerText: PLAIN_ANSWER,
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('preference');
    expect(items[0].origin).toBe('explicit');
  });

  it('classifies continuation phrasing by content: 今後は + budget -> decision', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '今後は予算10万円以内で進めます',
      answerText: PLAIN_ANSWER,
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('decision');
    expect(items[0].origin).toBe('explicit');
  });

  it('classifies a remembered constraint as fact', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '覚えておいて、締め切りは毎週金曜です',
      answerText: PLAIN_ANSWER,
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('fact');
    expect(items[0].origin).toBe('explicit');
  });

  it('remembers an English explicit request', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: 'Remember that I prefer short answers',
      answerText: 'Understood.',
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('preference');
    expect(items[0].origin).toBe('explicit');
  });

  it('prefers the explicit reading when a sentence also matches B patterns', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '覚えておいて、予算は10万円以内で進めます',
      answerText: PLAIN_ANSWER,
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('decision');
    expect(items[0].origin).toBe('explicit');
  });

  it('does not memorize gratitude as a continuation', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: 'いつもありがとうございます',
      answerText: PLAIN_ANSWER,
    });
    await expect(storedItems(graph)).resolves.toEqual([]);
  });

  it('records the user message id in the source when provided', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '覚えておいて、私は自宅にPCを持っていません',
      answerText: PLAIN_ANSWER,
      userMessageId: 'u-42',
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].source.messageId).toBe('u-42');
  });
});

// --- B: sentence patterns (inferred) -----------------------------------------------

describe('B sentence-pattern extraction', () => {
  it('extracts a decision from a declarative budget statement', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '予算は10万円以内で進めることにします',
      answerText: PLAIN_ANSWER,
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('decision');
    expect(items[0].origin).toBe('inferred');
  });

  it('extracts a preference from a format statement', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '回答は箇条書きではなく文章でお願いします',
      answerText: PLAIN_ANSWER,
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('preference');
    expect(items[0].origin).toBe('inferred');
  });

  it('extracts a fact from a first-person statement', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '私は福利厚生の提案資料を担当しています',
      answerText: PLAIN_ANSWER,
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('fact');
    expect(items[0].origin).toBe('inferred');
  });

  it('extracts a durable request with a deadline', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '来週金曜までに進捗を確認しておいてください',
      answerText: PLAIN_ANSWER,
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('request');
    expect(items[0].origin).toBe('inferred');
  });

  it('extracts nothing from the negative fixed set', async () => {
    const { graph, ingestion } = await loadModules();
    const negatives = [
      '今日の天気は？',
      'この資料の要約をして',
      '彼は表が好きだと言っていました',
      '表と文章、どっちがいい？',
      'ありがとう、助かりました',
      '猫の写真を見せて',
    ];
    for (const userText of negatives) {
      await ingestion.ingestCompletedChatTurn({ userText, answerText: PLAIN_ANSWER });
    }
    await expect(storedItems(graph)).resolves.toEqual([]);
  });
});

// --- K-24: questions and one-off requests are not attributes ----------------------

// Correction list K-24 (LIVE-7): a user question sentence had been stored
// in the management screen's item list as a 'preference'. The leak had
// three shapes, all pinned here: a one-off imperative whose wording hits
// a format keyword in PREFERENCE_PATTERNS, a question riding on an A-1
// continuation marker (which used to fall through to the 'preference'
// default), and question content attached to a remember phrase (stored
// as a 'fact'). Declarative preference statements and durable requests
// must keep working.

describe('K-24 question / one-off request guard', () => {
  it('extracts nothing from one-off imperatives that match format keywords', async () => {
    const { graph, ingestion } = await loadModules();
    const imperatives = [
      'この文章を箇条書きでまとめて',
      '短くまとめて',
      '表で見せて',
      '結論から教えて',
      '箇条書きでまとめてください',
      '辛いものは苦手なので、別の店にして',
    ];
    for (const userText of imperatives) {
      await ingestion.ingestCompletedChatTurn({ userText, answerText: PLAIN_ANSWER });
    }
    await expect(storedItems(graph)).resolves.toEqual([]);
  });

  it('extracts nothing from questions, with or without a question mark or marker', async () => {
    const { graph, ingestion } = await loadModules();
    const questions = [
      '次回も会議はありますか',
      '今後はどうなるか',
      'コーヒーは好きか',
      '覚えておいて、明日の天気はどうなるか',
    ];
    for (const userText of questions) {
      await ingestion.ingestCompletedChatTurn({ userText, answerText: PLAIN_ANSWER });
    }
    await expect(storedItems(graph)).resolves.toEqual([]);
  });

  it('still stores a declarative taste statement as a preference', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '辛いものは苦手です',
      answerText: PLAIN_ANSWER,
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('preference');
    expect(items[0].origin).toBe('inferred');
  });

  it('still stores a durable request as a request, not an attribute', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '来週金曜までに進捗を確認しておいてください',
      answerText: PLAIN_ANSWER,
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('request');
  });
});

// --- Commitment from the answer side ----------------------------------------------

describe('commitment extraction from the answer', () => {
  it('stores an undertaking with a weekday expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 16, 10, 0, 0)); // Monday 2026-11-16
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '金曜日に進捗を確認してください',
      answerText: '承知しました。金曜日に進捗を確認します。',
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('commitment');
    expect(items[0].origin).toBe('inferred');
    expect(items[0].expiresAt).toBe(new Date(2026, 10, 20, 23, 59, 59, 999).getTime());
  });

  it('does not treat an in-answer check as a commitment without a future anchor', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: 'この表を確認して',
      answerText: '以下で確認します。結果は次のとおりです。',
    });
    await expect(storedItems(graph)).resolves.toEqual([]);
  });
});

// --- Protective layers ----------------------------------------------------------------

describe('protective layers in ingestion', () => {
  it('never stores stage-2 topics or guarded values from user text', async () => {
    const { graph, ingestion } = await loadModules();
    const blockedTurns = [
      '覚えておいて、電話番号は090-1234-5678です',
      '私の電話番号は090-1234-5678です',
      '住所は東京都港区です',
      '私の生年月日は1990年5月3日です',
      'パスワードを変更しました',
      '覚えておいて、カード番号は4111-1111-1111-1111です',
    ];
    for (const userText of blockedTurns) {
      await ingestion.ingestCompletedChatTurn({ userText, answerText: PLAIN_ANSWER });
    }
    await expect(storedItems(graph)).resolves.toEqual([]);
  });
});

// --- Block-reason accumulation (design §5.3) ----------------------------------------------

describe('block-reason accumulation in ingestion', () => {
  async function storedNotices(graph: GraphModule) {
    return graph.listBlockNotices(graph.resolveActiveContextUserId());
  }

  it('accumulates a notice when an explicit remember request hits the guard', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '覚えておいて、電話番号は090-1234-5678です',
      answerText: PLAIN_ANSWER,
    });
    await expect(storedItems(graph)).resolves.toEqual([]);
    const notices = await storedNotices(graph);
    expect(notices).toHaveLength(1);
    expect(notices[0].categories).toEqual(['phone-number']);
    // The blocked value itself is nowhere in the accumulated record.
    expect(JSON.stringify(notices)).not.toContain('090-1234-5678');
    expect(JSON.stringify(notices)).not.toContain('09012345678');
  });

  it('accumulates a notice with the classified kind for a B-pattern sentence', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '私は連絡先として090-1234-5678を使っています',
      answerText: PLAIN_ANSWER,
    });
    await expect(storedItems(graph)).resolves.toEqual([]);
    const notices = await storedNotices(graph);
    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe('fact');
    expect(notices[0].categories).toEqual(['phone-number']);
  });

  it('accumulates a payment-card notice from an explicit remember request', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '覚えておいて、カード番号は4111-1111-1111-1111です',
      answerText: PLAIN_ANSWER,
    });
    const notices = await storedNotices(graph);
    expect(notices).toHaveLength(1);
    expect(notices[0].categories).toEqual(['payment-card']);
    expect(JSON.stringify(notices)).not.toContain('4111');
  });

  it('accumulates a commitment notice when the answer side hits the guard', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: 'ありがとうございます',
      answerText: '明日、090-1234-5678へ確認します。',
    });
    await expect(storedItems(graph)).resolves.toEqual([]);
    const notices = await storedNotices(graph);
    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe('commitment');
    expect(notices[0].categories).toEqual(['phone-number']);
  });

  it('collapses repeated blocks of the same kind and reason within one turn', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '覚えておいて、電話番号は090-1234-5678です。覚えておいて、電話番号は080-9876-5432です。',
      answerText: PLAIN_ANSWER,
    });
    const notices = await storedNotices(graph);
    expect(notices).toHaveLength(1);
    expect(notices[0].categories).toEqual(['phone-number']);
  });

  it('records nothing for a drop caused only by the stage-2 topic rules', async () => {
    const { graph, ingestion } = await loadModules();
    // "住所は…" is excluded by the §3.3 topic rules; the §9.2 guard
    // patterns (which need a structured address form) do not match, so
    // §5.3 has nothing to report for this drop.
    await ingestion.ingestCompletedChatTurn({
      userText: '住所は東京都港区です',
      answerText: PLAIN_ANSWER,
    });
    await expect(storedItems(graph)).resolves.toEqual([]);
    await expect(storedNotices(graph)).resolves.toEqual([]);
  });

  it('records nothing while the master toggle is off', async () => {
    const { graph, ingestion } = await loadModules();
    window.localStorage.setItem('origin_personal_settings', JSON.stringify({
      language: 'ja', selectedTheme: 'light', personalizationEnabled: false,
    }));
    await ingestion.ingestCompletedChatTurn({
      userText: '覚えておいて、電話番号は090-1234-5678です',
      answerText: PLAIN_ANSWER,
    });
    await expect(storedNotices(graph)).resolves.toEqual([]);
  });

  it('keeps accumulating across turns and leaves stored items unaffected', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '覚えておいて、私は自宅にPCを持っていません',
      answerText: PLAIN_ANSWER,
    });
    await ingestion.ingestCompletedChatTurn({
      userText: '私は生年月日が1990年5月3日です',
      answerText: PLAIN_ANSWER,
    });
    expect(await storedItems(graph)).toHaveLength(1);
    const notices = await storedNotices(graph);
    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe('fact');
    expect(notices[0].categories).toEqual(['date-of-birth']);
  });
});

// --- A-2: explicit operation -------------------------------------------------------------

describe('A-2 explicit operation (saveExplicitMemory)', () => {
  it('saves the given text as an explicit item with a classified kind', async () => {
    const { graph, ingestion } = await loadModules();
    await expect(ingestion.saveExplicitMemory({ text: '表より文章が好きです' })).resolves.toBe(true);
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].origin).toBe('explicit');
    expect(items[0].kind).toBe('preference');
  });

  it('honors an explicit kind override', async () => {
    const { graph, ingestion } = await loadModules();
    await expect(ingestion.saveExplicitMemory({ text: '来週の出張は大阪です', kind: 'fact' })).resolves.toBe(true);
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('fact');
  });

  it('refuses guarded text', async () => {
    const { graph, ingestion } = await loadModules();
    await expect(ingestion.saveExplicitMemory({ text: '電話番号は090-1234-5678です' })).resolves.toBe(false);
    await expect(storedItems(graph)).resolves.toEqual([]);
  });
});

// --- Zero network requests / no fetch interception -----------------------------------------

describe('network and installation behavior', () => {
  it('performs no fetch calls during ingestion', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network must not be used');
    });
    vi.stubGlobal('fetch', fetchMock);
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '覚えておいて、私は自宅にPCを持っていません。予算は10万円以内で進めることにします',
      answerText: '承知しました。金曜日に進捗を確認します。',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    const items = await storedItems(graph);
    expect(items.length).toBeGreaterThan(0);
  });

  it('installs no fetch interception on import', async () => {
    const before = window.fetch;
    await loadModules();
    expect(window.fetch).toBe(before);
    expect((window as unknown as Record<string, unknown>)['__originActiveContextDecisionIngestionInstalled']).toBeUndefined();
  });
});

// --- Fail-safe ------------------------------------------------------------------------------

describe('fail-safe behavior', () => {
  it('resolves quietly on empty or malformed turns', async () => {
    const { ingestion } = await loadModules();
    await expect(ingestion.ingestCompletedChatTurn({ userText: '', answerText: '' })).resolves.toBeUndefined();
    await expect(ingestion.ingestCompletedChatTurn({} as never)).resolves.toBeUndefined();
  });

  it('resolves quietly when storage is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const { ingestion } = await loadModules();
    await expect(ingestion.ingestCompletedChatTurn({
      userText: '覚えておいて、私は自宅にPCを持っていません',
      answerText: PLAIN_ANSWER,
    })).resolves.toBeUndefined();
  });
});

// --- Bridge compatibility -----------------------------------------------------------------------

describe('bridge compatibility', () => {
  it('keeps new-path decisions retrievable as context in the formatted shape', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn({
      userText: '予算は10万円以内で進めることにします',
      answerText: PLAIN_ANSWER,
    });
    const context = await graph.retrieveRelevantContext('予算 について相談します');
    expect(context).toContain('予算は10万円以内で進めることにします');
    // PR P1-4 (design §6.2): formatted text lines, not raw node JSON.
    expect(context).toContain('［決めたこと］');
    expect(context).not.toContain('"decision"');
  });
});

// --- Master toggle gate (design §7.2/§7.4, wired in PR P1-3) ---------------------

describe('personalization master toggle gate', () => {
  const TURN = {
    userText: '覚えておいて、私は自宅にPCを持っていません',
    answerText: PLAIN_ANSWER,
  };

  it('extracts nothing while the toggle is off, and resumes when it is back on', async () => {
    const { graph, ingestion } = await loadModules();
    window.localStorage.setItem('origin_personal_settings', JSON.stringify({
      language: 'ja', selectedTheme: 'light', personalizationEnabled: false,
    }));
    await ingestion.ingestCompletedChatTurn(TURN);
    expect(await storedItems(graph)).toHaveLength(0);

    window.localStorage.setItem('origin_personal_settings', JSON.stringify({
      language: 'ja', selectedTheme: 'light', personalizationEnabled: true,
    }));
    await ingestion.ingestCompletedChatTurn(TURN);
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].origin).toBe('explicit');
  });

  it('extracts when no settings are stored yet (default is on)', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn(TURN);
    expect(await storedItems(graph)).toHaveLength(1);
  });

  it('keeps already stored items untouched while the toggle is off', async () => {
    const { graph, ingestion } = await loadModules();
    await ingestion.ingestCompletedChatTurn(TURN);
    expect(await storedItems(graph)).toHaveLength(1);

    window.localStorage.setItem('origin_personal_settings', JSON.stringify({
      language: 'ja', selectedTheme: 'light', personalizationEnabled: false,
    }));
    await ingestion.ingestCompletedChatTurn({
      userText: '今後は予算10万円以内で進めます',
      answerText: PLAIN_ANSWER,
    });
    const items = await storedItems(graph);
    expect(items).toHaveLength(1);
    expect(items[0].text).toContain('自宅にPCを持っていません');
  });
});
