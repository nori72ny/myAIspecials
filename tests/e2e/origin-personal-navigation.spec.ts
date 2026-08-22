import { expect, test, type Page } from '@playwright/test';

const readCompressedOriginSnapshot = (page: Page) => page.evaluate(async () => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('origin-personal-local', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const stored = await new Promise<unknown>((resolve, reject) => {
    const request = database.transaction('snapshots', 'readonly').objectStore('snapshots').get('primary');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  if (!(stored instanceof Blob)) return { type: 'legacy', snapshot: stored };
  const bytes = new Uint8Array(await stored.arrayBuffer());
  const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = gzip
    ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(bytes);
  return { type: stored.type, snapshot: JSON.parse(text) as unknown };
});

test.describe('ORIGIN Personal 2.0 production surface', () => {
  test('shows the truthful first-release workspace without legacy navigation or sample data', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle('ORIGIN Personal');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await expect(page.getByTestId('origin-core-logo')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Personal 2.0', { exact: true })).toBeVisible();
    await expect(page.getByTestId('origin-home-request')).toBeEditable();
    await expect(page.getByTestId(/^starter-/)).toHaveCount(0);
    await expect(page.getByText(/最近のプロジェクト|Recent projects|ACOS Development|Sales Deck|Marketing|Memory Fragments/)).toHaveCount(0);
    await expect(page.getByTestId('nav-dashboard')).toHaveCount(0);
    await expect(page.getByTestId('nav-chat')).toHaveCount(0);
    await expect(page.getByTestId('nav-workspace')).toHaveCount(0);
    await expect(page.getByText(/無料AIのみを使用|uses free AI only/i)).toBeVisible();
  });

  test('submits a command-bar request within a compact viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/chat', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/plain', body: '最初の計画を整理しました。' });
    });
    await page.goto('/');

    await page.getByTestId('origin-home-request').fill('最初の計画を整理してください');
    await page.getByTestId('start-request-button').click();
    await expect(page.getByText('最初の計画を整理しました。')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('origin-chat-request')).toBeVisible();
    expect(await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
  });

  test('retries a transient transport failure exactly once before verifying its answer', async ({ page }) => {
    let attempts = 0;
    await page.route('**/api/chat', async (route) => {
      attempts += 1;
      await route.fulfill(attempts === 1
        ? { status: 503, contentType: 'text/plain', body: 'Temporary upstream failure' }
        : { status: 200, contentType: 'text/plain', body: '通信は自動的に復旧しました。' });
    });
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('一時的な通信障害から復旧');
    await page.getByTestId('start-request-button').click();

    await expect(page.getByText('通信は自動的に復旧しました。')).toBeVisible();
    await expect(page.getByTestId('response-verification-details')).toBeVisible();
    expect(attempts).toBe(2);
  });

  test('batches fragmented streamed output without losing Japanese characters or verification', async ({ page }) => {
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (!url.endsWith('/api/chat')) return originalFetch(input, init);

        const bytes = new TextEncoder().encode('結論：描画バッチで滑らかに表示します。');
        return new Response(new ReadableStream({
          start(controller) {
            for (let index = 0; index < bytes.length; index += 1) {
              controller.enqueue(bytes.slice(index, index + 1));
            }
            controller.close();
          },
        }), { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      };
    });
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('日本語の分割ストリームを検証');
    await page.getByTestId('start-request-button').click();

    await expect(page.getByText('結論：描画バッチで滑らかに表示します。')).toBeVisible();
    await expect(page.getByTestId('response-verification-details')).toBeVisible();
  });

  test('reloads the cached app offline, restores compressed artifacts, and exports locally without an API request', async ({ page, context }) => {
    await page.route('**/api/chat', async (route) => route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: '```html:offline-persisted.html\n<main><h1>Offline Persisted Artifact</h1></main>\n```',
    }));
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.getByTestId('origin-home-request').fill('オフライン保存用成果物を作成');
    await page.getByTestId('start-request-button').click();
    await expect(page.getByTestId('artifact-workspace')).toBeVisible();
    await expect.poll(() => readCompressedOriginSnapshot(page)).toMatchObject({
      type: 'application/vnd.origin.snapshot+gzip',
      snapshot: {
        artifacts: [expect.objectContaining({
          title: 'offline-persisted.html',
          content: expect.stringContaining('Offline Persisted Artifact'),
        })],
      },
    });

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: '何を実現したいですか？' })).toBeVisible();
    await page.getByTestId('history-drawer-toggle').click();
    await page.getByTestId('history-search-input').fill('Offline Persisted Artifact');
    await page.getByTestId('history-search-result-0').click();
    const workspace = page.getByTestId('artifact-workspace');
    await expect(workspace).toBeVisible();
    await page.getByRole('button', { name: 'プレビューを表示' }).click();
    await expect(workspace.getByTitle('プレビュー').contentFrame().getByText('Offline Persisted Artifact')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByTestId('artifact-action-save').click();
    await expect((await download).suggestedFilename()).toBe('offline-persisted.html');

    await page.getByRole('button', { name: '成果物を閉じる' }).click();
    let chatRequests = 0;
    page.on('request', (request) => { if (request.url().endsWith('/api/chat')) chatRequests += 1; });
    await page.getByTestId('origin-home-request').fill('オフライン中の新規送信');
    await page.getByTestId('start-request-button').click();
    await expect(page.getByText('現在オフラインです（保存済み成果物の閲覧・編集のみ可能です）')).toBeVisible();
    expect(chatRequests).toBe(0);
    await context.setOffline(false);
  });

  test('shows the zero-cost congestion notice without a verified trace after provider retries', async ({ page }) => {
    let attempts = 0;
    await page.route('**/api/chat', async (route) => {
      attempts += 1;
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'PROVIDER_RATE_LIMITED', retryable: true, retryAttempted: true }),
      });
    });
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('混雑時の安全案内を確認');
    await page.getByTestId('start-request-button').click();

    await expect(page.getByText('現在モデルが混雑しています。数十秒後に再試行してください（費用 $0.00 は維持されています）')).toBeVisible();
    await expect(page.getByTestId('response-verification-details')).toHaveCount(0);
    expect(attempts).toBe(1);
  });

  test('keeps the mobile header on one line with three 44px action targets', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');

    const header = page.locator('header.origin-header');
    const history = page.getByTestId('history-drawer-toggle');
    const settings = page.getByRole('button', { name: '設定を開く' });
    const newConversation = page.getByRole('button', { name: '新規対話を開始' });

    await expect(header).toContainText('ORIGIN');
    await expect(header).toContainText('Personal 2.0');
    await expect(header.getByRole('button')).toHaveCount(3);
    await expect(page.getByTestId('knowledge-map-toggle')).toHaveCount(0);
    for (const button of [history, settings, newConversation]) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(await button.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap');
      expect(await button.evaluate((element) => getComputedStyle(element).flexShrink)).toBe('0');
    }
    await expect(history).toContainText('☰');
    await expect(settings).toContainText('⚙️');
    await expect(newConversation).toContainText('＋');
    for (const brand of await header.locator(':scope > div:first-child > span').all()) {
      expect(await brand.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap');
      expect(await brand.evaluate((element) => getComputedStyle(element).flexShrink)).toBe('0');
    }
    const headerWidth = await header.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
    expect(headerWidth.scroll).toBeLessThanOrEqual(headerWidth.client);

    await history.click();
    await expect(page.getByTestId('knowledge-map-toggle')).toBeVisible();
  });
});
