import { expect, test, type Page } from '@playwright/test';

// 送信直後の進行中会話は、セッション化（「新規対話を開始」や次回起動時の
// 退避）を待たずに履歴ドロワーの一覧と検索へ出ることを固定する。
// 表示専用の合成セッションは永続化されないこともあわせて確認する。
const saved = {
  version: 1,
  messages: [],
  sessions: [{ id: 'past-session', title: '先週の旅行計画メモ', createdAt: 1, messages: [{ id: 'past-1', role: 'user', content: '先週の旅行計画メモ' }] }],
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
  await expect(page.locator('html')).toHaveAttribute('data-origin-storage-state', 'ready');
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
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-origin-storage-state', 'ready');
  await expect(page.getByTestId('origin-home-request')).toBeVisible();
}

test('shows the in-progress conversation in the history drawer list and search right after sending', async ({ page }) => {
  await page.route('**/api/chat', route => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: '応答の目印ぶどうを含みます。' }));
  await seed(page);

  await page.getByTestId('origin-home-request').fill('現在の会話の目印りんご');
  await page.getByTestId('start-request-button').click();
  await expect(page.getByText('応答の目印ぶどうを含みます。')).toBeVisible();

  // 初期表示の一覧に、現在の会話と過去セッションの両方が出る。
  await page.getByTestId('history-drawer-toggle').click();
  const list = page.getByTestId('history-session-list');
  await expect(list).toBeVisible();
  await expect(page.getByTestId('history-session-item-0')).toContainText('現在の会話');
  await expect(page.getByTestId('history-session-item-0')).toContainText('現在の会話の目印りんご');
  await expect(page.getByTestId('history-session-item-1')).toContainText('先週の旅行計画メモ');

  // 送信直後の会話本文（応答側の語）でも履歴検索に一致する。
  await page.getByTestId('history-search-input').fill('ぶどう');
  const results = page.getByTestId('history-search-results');
  await expect(results).toContainText('現在の会話');
  await expect(results).toContainText('現在の会話の目印りんご');
  await page.getByTestId('history-drawer-toggle').click();
  await expect(page.getByTestId('history-drawer')).toBeHidden();

  // 表示専用の合成セッションは保存されない（セッションは過去分のみ）。
  await expect.poll(async () => {
    const snapshot = await readSnapshot(page) as { messages?: unknown[]; sessions?: { id: string }[] } | undefined;
    return { messages: snapshot?.messages?.length ?? -1, sessionIds: (snapshot?.sessions ?? []).map((session) => session.id) };
  }).toEqual({ messages: 2, sessionIds: ['past-session'] });
});
