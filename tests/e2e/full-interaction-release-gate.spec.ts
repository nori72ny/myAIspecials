import { expect, test } from '@playwright/test';

const widths = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

async function installStableWorkspaceRoutes(page: import('@playwright/test').Page) {
  await page.route('**/api/coding/v1.4/status', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      ready: false,
      controlPlaneReady: false,
      authorizationMode: 'unconfigured',
      freeOnly: true,
      paidFallbackEnabled: false,
    }),
  }));
  await page.route('**/api/creative/v1.5/status', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ready: true,
      releaseStage: 'verified-vector-foundation',
      externalNetworkRequests: 0,
      providerExecutions: 0,
      costUsd: 0,
      freeOnly: true,
    }),
  }));
}

async function assertSurfaceContract(page: import('@playwright/test').Page, mobile: boolean) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const audit = await page.locator('button, a[href]').evaluateAll((elements) => elements
    .filter((element) => {
      const node = element as HTMLElement;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    })
    .map((element) => {
      const node = element as HTMLElement;
      const rect = node.getBoundingClientRect();
      const name = (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim();
      const href = element instanceof HTMLAnchorElement ? element.getAttribute('href') || '' : '';
      return {
        tag: element.tagName,
        name,
        href,
        disabled: element instanceof HTMLButtonElement ? element.disabled : false,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    }));

  expect(audit.length).toBeGreaterThan(0);
  for (const item of audit) {
    expect(item.name, `interactive control must have an accessible name: ${JSON.stringify(item)}`).not.toBe('');
    expect(item.left, `${item.name} left edge`).toBeGreaterThanOrEqual(-1);
    expect(item.right, `${item.name} right edge`).toBeLessThanOrEqual((mobile ? 390 : 1440) + 1);
    if (mobile && item.tag === 'BUTTON') {
      expect(item.height, `${item.name} mobile tap height`).toBeGreaterThanOrEqual(44);
    }
    if (item.tag === 'A') {
      expect(item.href, `${item.name} link destination`).not.toBe('');
      if (/^https?:/i.test(item.href)) expect(item.href.startsWith('https://'), `${item.name} external link must be HTTPS`).toBe(true);
    }
  }
}

test.describe('ORIGIN full interaction and visual-consistency release gate', () => {
  for (const viewport of widths) {
    test(`top-level surfaces keep navigation and controls production-grade on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installStableWorkspaceRoutes(page);

      const surfaces = [
        { url: '/', heading: '何をしたいですか？' },
        { url: '/?workspace=research', heading: '調べたいことを入力' },
        { url: '/?workspace=coding', heading: 'コードの変更を依頼' },
        { url: '/?workspace=creative', heading: '作りたいものを入力' },
      ];

      for (const surface of surfaces) {
        await page.goto(surface.url);
        await expect(page.getByRole('heading', { name: surface.heading })).toBeVisible({ timeout: 15_000 });
        await assertSurfaceContract(page, viewport.width <= 390);

        const main = page.locator('main').first();
        if (await main.count()) {
          const typography = await main.evaluate((element) => {
            const style = getComputedStyle(element);
            return { fontFamily: style.fontFamily, color: style.color };
          });
          expect(typography.fontFamily).not.toBe('');
          expect(typography.color).not.toBe('');
        }

        if (surface.url !== '/') {
          await page.getByRole('button', { name: '会話に戻る', exact: true }).click();
          await expect(page).not.toHaveURL(/workspace=/);
          await expect(page.getByTestId('origin-home-request')).toBeVisible();
        }
      }
    });
  }

  test('mobile home buttons, sheets, settings, and history remain fully inside the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installStableWorkspaceRoutes(page);
    await page.goto('/');

    const add = page.getByTestId('origin-add-menu-toggle');
    await add.click();
    const menu = page.getByRole('menu', { name: '追加機能' });
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(8);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(382);
    for (const label of ['ファイルを添付', '調べる', 'コード', '作る']) {
      const item = page.getByRole('menuitem', { name: label, exact: true });
      await expect(item).toBeVisible();
      expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await add.click();

    await page.getByRole('button', { name: '設定を開く', exact: true }).click();
    const settings = page.getByRole('dialog', { name: /設定|Settings/i });
    await expect(settings).toBeVisible();
    const settingsBox = await settings.boundingBox();
    expect(settingsBox).not.toBeNull();
    expect(settingsBox!.x).toBeGreaterThanOrEqual(-1);
    expect(settingsBox!.x + settingsBox!.width).toBeLessThanOrEqual(391);
    await assertSurfaceContract(page, true);
    await page.getByRole('button', { name: '設定を閉じる' }).click();

    await page.getByTestId('history-drawer-toggle').click();
    const history = page.getByTestId('history-drawer');
    await expect(history).toBeVisible();
    const historyBox = await history.boundingBox();
    expect(historyBox).not.toBeNull();
    expect(historyBox!.x).toBeGreaterThanOrEqual(-1);
    expect(historyBox!.x + historyBox!.width).toBeLessThanOrEqual(391);
    await assertSurfaceContract(page, true);
  });

  test('research result links are safe, named, touchable, and point to the returned evidence', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/research/v1.1/query', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        version: '1.1',
        status: 'grounded',
        provider: 'Wikipedia',
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
        sourceCount: 1,
        distinctDomainCount: 1,
        confidence: 'moderate',
        confidenceScope: 'retrieval-evidence-only',
        semanticConflictDetection: 'conservative-structured-only',
        conflicts: [],
        report: 'Verified test evidence.',
        sources: [{
          id: 'S1',
          title: 'Example evidence',
          url: 'https://example.com/evidence',
          domain: 'example.com',
          evidenceLevel: 'page-verified',
          freshness: 'recent',
          score: 80,
          scoreScope: 'retrieval-evidence-only',
          citation: '[S1]',
        }],
      }),
    }));
    await page.goto('/?workspace=research');
    await page.getByLabel('調べたいこと', { exact: true }).fill('検証用クエリ');
    await page.getByRole('button', { name: /調べる|Research/ }).last().click();
    const link = page.getByRole('link', { name: '原文を開く' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://example.com/evidence');
    await expect(link).toHaveAttribute('target', '_blank');
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await assertSurfaceContract(page, true);
  });

  test('artifact workspace exposes every primary action without clipping and keeps generated form controls touch-sized', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/chat', route => route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: '完成しました。\n\n\`\`\`html:操作監査\n<main><h1>簡単 ToDo</h1><input aria-label="タスクを入力" placeholder="タスクを入力"><button type="button">追加</button></main>\n\`\`\`',
    }));
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('操作監査用の成果物を作成');
    await page.getByTestId('start-request-button').click();

    const workspace = page.getByTestId('artifact-workspace');
    await expect(workspace).toBeVisible();
    for (const testId of [
      'preview-viewport-375',
      'preview-viewport-768',
      'preview-viewport-fluid',
      'artifact-action-edit',
      'artifact-action-share',
      'artifact-action-save',
      'artifact-action-details',
    ]) {
      const control = page.getByTestId(testId);
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(391);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    await page.getByTestId('preview-viewport-375').click();
    await page.getByTestId('preview-viewport-768').click();
    await page.getByTestId('preview-viewport-fluid').click();
    await page.getByRole('button', { name: 'コードを表示' }).click();
    await page.getByRole('button', { name: 'プレビューを表示' }).click();
    await page.getByTestId('artifact-action-details').click();
    await expect(page.getByTestId('artifact-details-menu')).toBeVisible();

    const preview = workspace.getByTitle('プレビュー');
    const frame = preview.contentFrame();
    await expect(frame.getByLabel('タスクを入力')).toBeVisible();
    const inputMetrics = await frame.getByLabel('タスクを入力').evaluate((element) => {
      const style = getComputedStyle(element as HTMLElement);
      const rect = (element as HTMLElement).getBoundingClientRect();
      return { height: rect.height, fontSize: Number.parseFloat(style.fontSize), width: rect.width };
    });
    expect(inputMetrics.height).toBeGreaterThanOrEqual(44);
    expect(inputMetrics.fontSize).toBeGreaterThanOrEqual(16);
    expect(inputMetrics.width).toBeGreaterThan(180);
    expect((await frame.getByRole('button', { name: '追加' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await assertSurfaceContract(page, true);
  });
});
