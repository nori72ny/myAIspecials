import { expect, test, type Page } from '@playwright/test';

const saved = {
  version: 1,
  messages: [{ id: 'durable-message', role: 'user', content: '保存済みの会話を保持' }],
  sessions: [{ id: 'durable-session', title: '保持対象セッション', createdAt: 1, messages: [{ id: 'session-message', role: 'user', content: '保存セッション本文' }] }],
  artifacts: [],
  updatedAt: 1,
};

async function readSnapshot(page: Page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
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

async function seed(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('origin-home-request')).toBeVisible();
  await expect(page.getByTestId('origin-storage-status')).toHaveCount(0);
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
      if (this.name === 'snapshots') (window as any).__storageWrites.push(value);
      return original.call(this, value, key);
    };
  });
  for (let reload = 0; reload < 2; reload++) {
    await page.reload();
    await expect(page.getByTestId('origin-storage-status')).toHaveCount(0);
    await expect(page.getByText('保存済みの会話を保持', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__storageWrites.length)).toBeGreaterThan(0);
    const writes = await page.evaluate(() => (window as any).__storageWrites);
    for (const write of writes) expect(write).toMatchObject({ messages: saved.messages, sessions: saved.sessions });
    await expect.poll(() => readSnapshot(page)).toMatchObject({ messages: saved.messages, sessions: saved.sessions });
    await page.getByTestId('history-drawer-toggle').click();
    await page.getByTestId('history-search-input').fill('保持対象');
    await expect(page.getByTestId('history-search-results')).toContainText('保持対象セッション');
  }
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
  await expect(page.getByTestId('origin-storage-status')).toContainText('メモリ上で継続');
  await page.getByTestId('origin-home-request').fill('メモリで継続');
  await page.getByTestId('start-request-button').click();
  await expect(page.getByText('メモリ上で回答を継続します。', { exact: true })).toBeVisible();
  // Wait beyond the persistence debounce to detect a forbidden delayed write.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__storageWrites)).toEqual([]);
  expect(await readSnapshot(page)).toEqual(saved);
  expect(await page.evaluate(() => localStorage.getItem('origin_personal_history'))).toBeNull();
});
