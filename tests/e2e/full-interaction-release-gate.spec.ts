import { expect, test } from '@playwright/test';

const widths = [
  { name: 'mobile-320', width: 320, height: 568 },
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 900 },
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

async function assertSurfaceContract(page: import('@playwright/test').Page, viewportWidth: number) {
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
    expect(item.right, `${item.name} right edge`).toBeLessThanOrEqual(viewportWidth + 1);
    if (viewportWidth <= 768 && item.tag === 'BUTTON') {
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
        { url: '/', heading: '今日は何をしますか？' },
        { url: '/?workspace=research', heading: '詳しく調べる' },
        { url: '/?workspace=coding', heading: 'コードの変更を依頼' },
        { url: '/?workspace=creative', heading: '作りたいものを入力' },
      ];

      for (const surface of surfaces) {
        await page.goto(surface.url);
        await expect(page.getByRole('heading', { name: surface.heading })).toBeVisible({ timeout: 15_000 });
        await assertSurfaceContract(page, viewport.width);

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

  for (const viewport of [
    { name: '320', width: 320, height: 568 },
    { name: '375', width: 375, height: 812 },
    { name: '390', width: 390, height: 844 },
    { name: '768', width: 768, height: 1024 },
  ] as const) {
    test(`home sheets, settings, and history remain fully usable at ${viewport.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installStableWorkspaceRoutes(page);
      await page.goto('/');

      const add = page.getByTestId('origin-add-menu-toggle');
      await add.click();
      const menu = page.getByRole('menu', { name: '追加機能' });
      await expect(menu).toBeVisible();
      const menuBox = await menu.boundingBox();
      expect(menuBox).not.toBeNull();
      expect(menuBox!.x).toBeGreaterThanOrEqual(-1);
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width + 1);
      for (const label of ['ファイルを添付', '詳しく調べる', 'コード', '成果物を作る']) {
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
      expect(settingsBox!.x + settingsBox!.width).toBeLessThanOrEqual(viewport.width + 1);
      await assertSurfaceContract(page, viewport.width);
      await page.getByRole('button', { name: '設定を閉じる' }).click();

      await page.getByTestId('history-drawer-toggle').click();
      const history = page.getByTestId('history-drawer');
      await expect(history).toBeVisible();
      const historyBox = await history.boundingBox();
      expect(historyBox).not.toBeNull();
      expect(historyBox!.x).toBeGreaterThanOrEqual(-1);
      expect(historyBox!.x + historyBox!.width).toBeLessThanOrEqual(viewport.width + 1);
      await assertSurfaceContract(page, viewport.width);
    });
  }

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
    await page.getByRole('button', { name: '調査する', exact: true }).click();
    await page.getByText('調査結果', { exact: true }).waitFor();
    await page.getByText('出典を見る', { exact: true }).click();
    const link = page.getByRole('link', { name: '原文を開く' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://example.com/evidence');
    await expect(link).toHaveAttribute('target', '_blank');
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await assertSurfaceContract(page, 390);
  });

  test('primary buttons produce observable effects instead of silent no-ops', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installStableWorkspaceRoutes(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async () => {
          (window as unknown as { __originShareInvoked?: boolean }).__originShareInvoked = true;
        },
      });
    });
    await page.goto('/');

    // Attachment action must actually invoke the native file chooser.
    await page.getByTestId('origin-add-menu-toggle').click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'ファイルを添付', exact: true }).click();
    await chooser;

    // Each workspace action must result in navigation, not a silent click.
    for (const [label, workspace] of [['詳しく調べる', 'research'], ['コード', 'coding'], ['成果物を作る', 'creative']] as const) {
      await page.getByTestId('origin-add-menu-toggle').click();
      await page.getByRole('menuitem', { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`workspace=${workspace}`));
      await page.getByRole('button', { name: '会話に戻る', exact: true }).click();
      await expect(page).not.toHaveURL(/workspace=/);
    }

    // Settings controls must change state and close visibly.
    await page.getByRole('button', { name: '設定を開く', exact: true }).click();
    const luxury = page.getByTestId('design-theme-luxury');
    await luxury.click();
    await expect(luxury).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('close-settings-button').click();
    await expect(page.getByRole('dialog', { name: /設定|Settings/i })).toBeHidden();

    // History control must open and close, with aria state matching the UI.
    const historyToggle = page.getByTestId('history-drawer-toggle');
    await historyToggle.click();
    await expect(historyToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('history-drawer')).toBeVisible();
    await historyToggle.click();
    await expect(historyToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('history-drawer')).toBeHidden();

    // Create a deterministic artifact and exercise actions that must have an observable result.
    await page.route('**/api/chat', route => route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: '完成しました。\n\n\`\`\`html:button-audit\n<main><h1>Button audit</h1><input aria-label="監査入力"><button type="button">追加</button></main>\n\`\`\`',
    }));
    await page.getByTestId('origin-home-request').fill('成果物ボタン監査');
    await page.getByTestId('start-request-button').click();
    await expect(page.getByTestId('artifact-workspace')).toBeVisible();

    const edit = page.getByTestId('artifact-action-edit');
    await edit.click();
    await expect(edit).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('artifact-direct-touch-status')).toBeVisible();
    const preview = page.getByTitle('プレビュー');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('data-origin-srcdoc', /data-origin-direct-touch-root/);
    await expect(preview).toHaveAttribute('data-origin-srcdoc', /ORIGIN_DIRECT_TOUCH/);
    const directTouchFrame = preview.contentFrame();
    await expect(directTouchFrame.locator('[contenteditable]').first()).toBeVisible();

    // The same Edit mode must expose source editing when the user explicitly opens Code.
    await page.getByRole('button', { name: 'コードを表示', exact: true }).click();
    await expect(page.getByTestId('artifact-code-editor')).toBeVisible();
    await page.getByRole('button', { name: 'プレビューを表示', exact: true }).click();
    await expect(page.getByTestId('artifact-direct-touch-status')).toBeVisible();

    await page.getByTestId('artifact-action-details').click();
    await expect(page.getByTestId('artifact-details-menu')).toBeVisible();
    await page.getByTestId('artifact-action-details').click();
    await expect(page.getByTestId('artifact-details-menu')).toBeHidden();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('artifact-action-save').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('button-audit');

    const closeWorkspace = page.getByTestId('artifact-close-workspace');
    await expect(closeWorkspace).toBeVisible();
    await closeWorkspace.click();
    await expect(page.getByTestId('artifact-workspace')).toBeHidden();
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
      'artifact-action-edit',
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

    await page.getByTestId('artifact-action-details').click();
    await expect(page.getByTestId('artifact-details-menu')).toBeVisible();
    await expect(page.getByTestId('artifact-action-copy')).toBeVisible();
    await expect(page.getByTestId('artifact-action-export-menu')).toBeVisible();
    await page.getByTestId('artifact-action-details').click();
    await expect(page.getByTestId('artifact-details-menu')).toBeHidden();
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

    await assertSurfaceContract(page, 390);
  });
});
