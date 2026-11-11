import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const statusBody = JSON.stringify({
  ok: true,
  ready: true,
  version: '1.5',
  releaseStage: 'verified-vector-foundation',
  externalNetworkRequests: 0,
  providerExecutions: 0,
  costUsd: 0,
  freeOnly: true,
});

const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="#F7F7F4"/><text x="80" y="180">Creative E2E</text></svg>';
const svgSha256 = createHash('sha256').update(svg).digest('hex');

// 「作る」は画面構成の移行（第3段、2026-11-09）で専用画面から会話のそばの
// パネルに統合された。このスペックは統合後の経路を固定する：画面遷移
// （?workspace=creative）は発生せず、成果物はパネルで開き、会話の成果物
// としても残る。検証の強度（実バイト照合・ゼロコスト証拠・端末内履歴・
// PNGの実バイト）は専用画面時代から落としていない。
test.describe('V1.5 Creative panel beside the conversation', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/creative/v1.5/status', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: statusBody,
    }));
    await page.route('**/api/creative/v1.5/generate', route => route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      headers: {
        'Content-Disposition': "attachment; filename=\"origin-social-card-portrait.svg\"; filename*=UTF-8''creative-e2e-portrait.svg",
        'X-Origin-Visual-Verified': 'true',
        'X-Origin-Visual-Sha256': svgSha256,
        'X-Origin-Free-Only': 'true',
        'X-Origin-Cost-Usd': '0',
        'X-Origin-External-Network': 'false',
        'X-Origin-Visual-Brain': 'visual-brain-v1',
        'X-Origin-Visual-Provider': 'origin-local-svg',
        'X-Origin-Visual-Critic': 'deterministic-v1',
        'X-Origin-Visual-Quality-Score': '100',
        'X-Origin-Visual-Plan-Sha256': 'b'.repeat(64),
        'X-Origin-Visual-Generation-Id': `visual-${'d'.repeat(24)}`,
      },
      body: svg,
    }));
  });

  for (const width of [390, 1440]) {
    test(`opens the Create panel in place for an explicit Chat brief without provider generation at ${width}px`, async ({ page }) => {
      const providerRequests: string[] = [];
      page.on('request', request => {
        const url = request.url();
        if (url.includes('/api/chat')
          || url.includes('/api/generate-image')
          || url.includes('/api/creative/v1.5/raster/')) {
          providerRequests.push(url);
        }
      });

      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto('/');
      const request = 'Creativeワークスペースで新商品のSNSカードを作って';
      await page.getByTestId('origin-home-request').fill(request);
      await page.getByTestId('start-request-button').click();

      // 画面遷移はしない：URLに workspace=creative は付かず、パネルが開く。
      await expect(page.getByTestId('creative-panel')).toBeVisible();
      await expect(page).not.toHaveURL(/workspace=/);
      await expect(page.getByText('「作る」パネルを会話のそばに開きました')).toBeVisible();
      // 引き継ぎバナーは統合で廃止。依頼はパネルの下書きに反映される。
      await expect(page.getByTestId('creative-handoff-request')).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: 'タイトル', exact: true })).toHaveValue(/新商品のSNSカード/);
      await expect(page.getByRole('textbox', { name: '内容', exact: true })).toHaveValue(request);
      expect(providerRequests).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }

  for (const width of [390, 1440]) {
    test(`preserves multiline headlines and keeps expanded controls within ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto('/');
      await page.getByTestId('origin-add-menu-toggle').click();
      await page.getByRole('menuitem', { name: '作る', exact: true }).click();
      await expect(page.getByTestId('creative-panel')).toBeVisible();
      await expect(page).not.toHaveURL(/workspace=/);
      const title = '予約手数料を\n見直しませんか？';
      const titleInput = page.getByRole('textbox', { name: 'タイトル', exact: true });
      await titleInput.fill(title);
      await expect(titleInput).toHaveValue(title);
      await page.getByText('詳細設定', { exact: true }).click();
      await page.getByLabel('サブタイトル', { exact: true }).fill('200円/人 → 100円/人');
      await page.getByLabel('フッター', { exact: true }).fill('評価用の架空料金');
      expect(await titleInput.evaluate(element => getComputedStyle(element).fontSize)).toBe('16px');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const request = page.waitForRequest('**/api/creative/v1.5/generate');
      await page.getByRole('button', { name: '画像を作成', exact: true }).click();
      expect((await request).postDataJSON().title).toBe(title);
      await expect(page.getByRole('link', { name: 'SVG保存', exact: true })).toBeVisible();
    });
  }

  test('opens Create on mobile, verifies actual SVG bytes, persists history, and exports a real PNG locally', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await expect(page.getByRole('navigation', { name: 'Mode' })).toHaveCount(0);
    await page.getByTestId('origin-add-menu-toggle').click();
    await page.getByRole('menuitem', { name: '作る', exact: true }).click();
    await expect(page.getByTestId('creative-panel')).toBeVisible();
    await expect(page).not.toHaveURL(/workspace=/);
    await expect(page.getByText('利用できます · 無料 · 外部に送信しません')).toBeVisible();
    await expect(page.getByText('詳細設定', { exact: true })).toBeVisible();
    await expect(page.getByLabel('用途', { exact: true })).not.toBeVisible();
    await expect(page.getByRole('region', { name: '作成履歴' })).toHaveCount(0);
    // 初期値は標語文ではなく空欄（棚卸しで「無くす」）。
    await expect(page.getByRole('textbox', { name: 'タイトル', exact: true })).toHaveValue('');

    await page.getByRole('textbox', { name: 'タイトル', exact: true }).fill('モバイルCreative');
    await page.getByRole('button', { name: '画像を作成' }).click();

    await expect(page.getByRole('img', { name: '作成した画像: モバイルCreative' })).toBeVisible();
    const svgDownload = page.getByRole('link', { name: 'SVG保存' });
    await expect(svgDownload).toHaveAttribute('download', 'creative-e2e-portrait.svg');
    // 確認表示は「確認済み」の一言に圧縮され、検証の詳細は出ない。
    await expect(page.getByText('確認済み', { exact: true })).toBeVisible();
    await expect(page.getByText('検証の詳細', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '履歴を開く: モバイルCreative' })).toBeVisible();

    const requestsBeforePng = requests.length;
    await page.getByRole('button', { name: 'PNGを作成' }).click();
    const pngDownload = page.getByRole('link', { name: 'PNG保存' });
    await expect(pngDownload).toHaveAttribute('download', 'creative-e2e-portrait.png');
    expect(requests.length).toBe(requestsBeforePng);

    const downloadPromise = page.waitForEvent('download');
    await pngDownload.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('creative-e2e-portrait.png');
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('re-edits a generated deliverable from the artifact panel with the structured fields', async ({ page }) => {
    const generateRequests: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/api/creative/v1.5/generate')) generateRequests.push(request.url());
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByTestId('origin-add-menu-toggle').click();
    await page.getByRole('menuitem', { name: '作る', exact: true }).click();
    await page.getByRole('textbox', { name: 'タイトル', exact: true }).fill('編集Creative');
    await page.getByRole('button', { name: '画像を作成' }).click();
    await expect(page.getByRole('img', { name: '作成した画像: 編集Creative' })).toBeVisible();
    expect(generateRequests).toHaveLength(1);

    // パネルを閉じ、会話の成果物パネルから開き直すと、構造化フィールドで
    // 編集して再作成できる（作る画面の編集機能の移植先）。
    await page.getByRole('button', { name: '会話に戻る', exact: true }).click();
    await expect(page.getByTestId('creative-panel')).toHaveCount(0);
    await page.getByRole('tab', { name: '作成物', exact: true }).click();
    const editor = page.getByRole('region', { name: 'デザインを編集' });
    await expect(editor).toBeVisible();
    await expect(editor.getByRole('textbox', { name: 'タイトル', exact: true })).toHaveValue('編集Creative');
    await editor.getByRole('textbox', { name: 'タイトル', exact: true }).fill('編集Creative 改');
    await page.getByTestId('creative-artifact-regenerate').click();
    await expect(page.getByText('デザインを再作成しました。')).toBeVisible();
    await expect(page.getByText('更新あり', { exact: true })).toBeVisible();
    expect(generateRequests).toHaveLength(2);
  });

  test('restores the deliverable as a chat artifact and from IndexedDB history after reload without another generation request', async ({ page }) => {
    const generateRequests: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/api/creative/v1.5/generate')) generateRequests.push(request.url());
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByTestId('origin-add-menu-toggle').click();
    await page.getByRole('menuitem', { name: '作る', exact: true }).click();
    await page.getByRole('textbox', { name: 'タイトル', exact: true }).fill('履歴Creative');
    await page.getByRole('button', { name: '画像を作成' }).click();
    await expect(page.getByRole('button', { name: '履歴を開く: 履歴Creative' })).toBeVisible();
    expect(generateRequests).toHaveLength(1);
    // 生成物は会話の成果物としても登録される。
    await expect(page.getByRole('region', { name: '作成物' })).toContainText('履歴Creative');
    // リロード前に、成果物がアプリのスナップショットへ実際に保存された
    // ことを確認する（保存はデバウンスされるため、保存完了を待つ）。
    await expect.poll(() => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('origin-personal-local');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const rows = await new Promise<unknown[]>((resolve, reject) => {
        const getAll = db.transaction('snapshots', 'readonly').objectStore('snapshots').getAll();
        getAll.onsuccess = () => resolve(getAll.result as unknown[]);
        getAll.onerror = () => reject(getAll.error);
      });
      const snapshot = rows[0] as { artifacts?: Array<{ title?: string }> } | undefined;
      return snapshot?.artifacts?.some(artifact => artifact.title === '履歴Creative') ?? false;
    })).toBe(true);
    await page.getByRole('button', { name: '会話に戻る', exact: true }).click();

    await page.reload();
    // リロード後は必ずトップ画面から始まる（#1170仕様）。成果物は会話の
    // 記録として復元され、パネルの端末内履歴からも再生成なしで開ける。
    await expect(page.getByTestId('origin-home-request')).toBeVisible();
    await expect(page.getByRole('region', { name: '作成物' })).toContainText('履歴Creative');
    await page.getByTestId('origin-add-menu-toggle').click();
    await page.getByRole('menuitem', { name: '作る', exact: true }).click();
    const openHistory = page.getByRole('button', { name: '履歴を開く: 履歴Creative' });
    await expect(openHistory).toBeVisible();
    await openHistory.click();
    await expect(page.getByRole('img', { name: '作成した画像: 履歴Creative' })).toBeVisible();
    await expect(page.getByText('端末内履歴から確認済みの画像を開きました。')).toBeVisible();
    expect(generateRequests).toHaveLength(1);

    const requestsBeforePng = generateRequests.length;
    await page.getByRole('button', { name: 'PNGを作成' }).click();
    await expect(page.getByRole('link', { name: 'PNG保存' })).toBeVisible();
    expect(generateRequests.length).toBe(requestsBeforePng);
  });

  // 旧仕様「?workspace=creative で作る画面が開く」は、起動時は必ずトップ
  // 画面というオーナー指示（2026-11-09）と、作るのパネル統合で廃止された。
  // 直指定でもトップ画面に着地し、作るはURLを変えずにパネルとして開閉
  // できることを固定する（パネルはブラウザ履歴に積まない）。
  test('lands on the top screen for a direct Create URL and opens Create as a panel without touching the URL', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?workspace=creative');
    await expect(page.getByTestId('origin-home-request')).toBeVisible();
    await expect(page.getByTestId('creative-panel')).toHaveCount(0);

    // パネルの開閉はURLを一切変更しない（読み込まれたURLがそのまま残る）。
    const urlBefore = page.url();
    await page.getByTestId('origin-add-menu-toggle').click();
    await page.getByRole('menuitem', { name: '作る', exact: true }).click();
    await expect(page.getByTestId('creative-panel')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'カード・ポスターを作る' })).toBeVisible();
    expect(page.url()).toBe(urlBefore);

    await page.getByRole('button', { name: '会話に戻る', exact: true }).click();
    await expect(page.getByTestId('creative-panel')).toHaveCount(0);
    await expect(page.getByTestId('origin-home-request')).toBeVisible();
    expect(page.url()).toBe(urlBefore);
  });
});
