import { expect, test, type Page } from '@playwright/test';

const saved = {
  version: 1,
  messages: [{ id: 'durable-message', role: 'user', content: '保存済みの会話を保持' }],
  sessions: [{ id: 'durable-session', title: '保持対象セッション', createdAt: 1, messages: [{ id: 'session-message', role: 'user', content: '保存セッション本文' }] }],
  artifacts: [],
  updatedAt: 1,
};

// S3（会話履歴の端末内暗号化）以降、保存レコードは暗号化エンベロープ
// { version, iv, ciphertext } で IndexedDB に入る。検証は端末内キー
// （同じ DB の 'aes-gcm-256' レコード）で復号してから行い、検証の強度は
// 平文時代と変えない。平文の旧レコードはそのまま返す。
async function readSnapshot(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('origin-personal-local', 1);
      request.onerror = () => reject(new Error('open failed'));
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const get = (key: string) => new Promise<unknown>((resolve, reject) => {
        const read = db.transaction('snapshots', 'readonly').objectStore('snapshots').get(key);
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(new Error('read failed'));
      });
      const raw = await get('primary');
      if (!raw || typeof raw !== 'object') return raw;
      const payload = raw as { iv?: unknown; ciphertext?: unknown };
      if (typeof payload.iv !== 'string' || typeof payload.ciphertext !== 'string') return raw;
      const key = await get('aes-gcm-256');
      if (!key) return raw;
      const decode = (value: string) => Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0));
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(payload.iv) }, key as CryptoKey, decode(payload.ciphertext));
      return JSON.parse(new TextDecoder().decode(plain)) as unknown;
    } finally {
      db.close();
    }
  });
}

async function readRawSnapshotRecord(page: Page) {
  return page.evaluate(() => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open('origin-personal-local', 1);
    request.onerror = () => reject(new Error('open failed'));
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('snapshots', 'readonly').objectStore('snapshots').get('primary');
      read.onsuccess = () => { resolve(read.result); db.close(); };
      read.onerror = () => { reject(new Error('read failed')); db.close(); };
    };
  }));
}

// 傍受した保存書き込み（暗号化エンベロープ）を端末内キーで復号する。
// 平文のままの値はそのまま返す。
async function decryptSnapshotWrites(page: Page, writes: unknown[]) {
  return page.evaluate(async (values) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('origin-personal-local', 1);
      request.onerror = () => reject(new Error('open failed'));
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const key = await new Promise<unknown>((resolve, reject) => {
        const read = db.transaction('snapshots', 'readonly').objectStore('snapshots').get('aes-gcm-256');
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(new Error('read failed'));
      });
      const decode = (value: string) => Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0));
      const decrypted: unknown[] = [];
      for (const value of values) {
        const payload = value as { iv?: unknown; ciphertext?: unknown } | null;
        if (!payload || typeof payload !== 'object' || typeof payload.iv !== 'string' || typeof payload.ciphertext !== 'string' || !key) {
          decrypted.push(value);
          continue;
        }
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(payload.iv) }, key as CryptoKey, decode(payload.ciphertext));
        decrypted.push(JSON.parse(new TextDecoder().decode(plain)) as unknown);
      }
      return decrypted;
    } finally {
      db.close();
    }
  }, writes);
}

// toMatchObject と同じ部分一致（平文の JSON 形状専用）。復号した書き込みが
// 許容形のどれかに当たるかの振り分けに使う。
function matchesObject(received: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(received)
      && received.length === expected.length
      && expected.every((item, index) => matchesObject(received[index], item));
  }
  if (expected !== null && typeof expected === 'object') {
    if (received === null || typeof received !== 'object') return false;
    return Object.entries(expected as Record<string, unknown>)
      .every(([key, value]) => matchesObject((received as Record<string, unknown>)[key], value));
  }
  return Object.is(received, expected);
}

async function seed(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('origin-home-request')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-origin-storage-state', 'ready');
  // Let the initial empty-state save complete before installing the durable fixture.
  await expect.poll(() => readSnapshot(page)).toMatchObject({ version: 1 });
  await page.evaluate((snapshot) => new Promise<void>((resolve, reject) => {
    localStorage.removeItem('origin_personal_history');
    localStorage.removeItem('origin_personal_sessions');
    const request = indexedDB.open('origin-personal-local', 1);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('snapshots', 'readwrite');
      tx.objectStore('snapshots').put(snapshot, 'primary');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(new Error('seed failed')); };
    };
  }), saved);
}

test('preserves durable sessions across two reloads without legacy storage or empty writes', async ({ page }) => {
  await seed(page);
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).__storageWrites = [];
    IDBObjectStore.prototype.put = function(value, key) {
      // S3 以降は同じストアに端末キーや移行用レコードも書かれる。この
      // テストが見るのは履歴スナップショット本体（primary）への書き込み
      // だけなのでキーで絞る（平文時代の「全 put = 保存書き込み」と等価）。
      if (this.name === 'snapshots' && key === 'primary') (window as any).__storageWrites.push(value);
      return original.call(this, value, key);
    };
  });
  // 起動時は必ずトップ画面から始める（オーナー指示 2026-11-09）。保存されて
  // いた進行中会話は、空の状態で上書きされて消えるのではなく、履歴
  // セッションへ退避された形で保持されることが保証対象になる。
  const preserved = {
    messages: [],
    sessions: [
      { title: '保存済みの会話を保持', messages: [{ id: 'durable-message', content: '保存済みの会話を保持' }] },
      { id: 'durable-session', messages: [{ id: 'session-message', content: '保存セッション本文' }] },
    ],
  };
  for (let reload = 0; reload < 2; reload++) {
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-origin-storage-state', 'ready');
    await expect(page.getByTestId('origin-home-request')).toBeVisible();
    // 平文の旧レコードは読み取り時に暗号化へ移行されるため、初回の
    // リロードでは「シードした内容そのままの暗号化への書き換え」が
    // 先行しうる。それ以外の書き込みはすべて退避後の保存形でなければ
    // ならず、退避後の形の書き込みが実際に起きることもあわせて固定
    // する（空の書き込みや巻き戻しが無いことの検証は従来どおり）。
    await expect.poll(async () => {
      const current = await decryptSnapshotWrites(page, await page.evaluate(() => (window as any).__storageWrites));
      return current.length > 0
        && current.some((write) => matchesObject(write, preserved))
        && current.every((write) => matchesObject(write, preserved) || matchesObject(write, saved));
    }).toBe(true);
    await expect.poll(() => readSnapshot(page)).toMatchObject(preserved);
    await page.getByTestId('history-drawer-toggle').click();
    await page.getByTestId('history-search-input').fill('保持対象');
    await expect(page.getByTestId('history-search-results')).toContainText('保持対象セッション');
  }
  // 保存形そのものは暗号化エンベロープであり、平文の履歴フィールドを
  // 含まないこともあわせて固定する（S3 の保存契約）。
  const rawRecord = await readRawSnapshotRecord(page) as { iv?: unknown; ciphertext?: unknown } | null;
  expect(rawRecord).toMatchObject({ version: 1 });
  expect(typeof rawRecord?.iv).toBe('string');
  expect(typeof rawRecord?.ciphertext).toBe('string');
  expect(rawRecord).not.toHaveProperty('messages');
  // 退避された進行中会話は、履歴から明示的に選んで復元できる。
  await page.getByTestId('history-search-input').fill('保存済みの会話を保持');
  await expect(page.getByTestId('history-search-results')).toContainText('保存済みの会話を保持');
  await page.getByTestId('history-search-result-0').click();
  await expect(page.getByText('保存済みの会話を保持', { exact: true }).first()).toBeVisible();
});

test('continues in memory after a read failure without overwriting durable history', async ({ page }) => {
  await seed(page);
  await page.addInitScript(() => {
    const get = IDBObjectStore.prototype.get;
    const put = IDBObjectStore.prototype.put;
    let failNextRead = true;
    (window as any).__storageWrites = [];
    IDBObjectStore.prototype.get = function(key) {
      if (this.name === 'snapshots' && failNextRead) {
        failNextRead = false;
        throw new DOMException('simulated read failure', 'UnknownError');
      }
      return get.call(this, key);
    };
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === 'snapshots') (window as any).__storageWrites.push(value);
      return put.call(this, value, key);
    };
  });
  await page.route('**/api/chat', route => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: 'メモリ上で回答を継続します。' }));
  await page.reload();
  await expect(page.getByTestId('origin-storage-status')).toContainText('メモリ上だけで続けています');
  await page.getByTestId('origin-home-request').fill('メモリで継続');
  await page.getByTestId('start-request-button').click();
  await expect(page.getByText('メモリ上で回答を継続します。', { exact: true })).toBeVisible();
  // Wait beyond the persistence debounce to detect a forbidden delayed write.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__storageWrites)).toEqual([]);
  expect(await readSnapshot(page)).toEqual(saved);
  expect(await page.evaluate(() => localStorage.getItem('origin_personal_history'))).toBeNull();
});
