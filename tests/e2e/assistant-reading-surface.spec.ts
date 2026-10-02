import { expect, test, type Page } from '@playwright/test';

const viewports = [
  { name: 'mobile-320', width: 320, height: 568 },
  { name: 'mobile-360', width: 360, height: 800 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'desktop-1440', width: 1440, height: 900 },
] as const;

async function waitForVisualSurface(page: Page) {
  await expect(page.getByRole('status', { name: 'ORIGIN を起動しています' })).toBeHidden({ timeout: 5_000 });
}

test.describe('ORIGIN continuous assistant reading surface', () => {
  for (const viewport of viewports) {
    test(`keeps assistant answers unboxed on ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.route('**/api/chat', async (route) => route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: '結論です。通常回答は会話面に自然につながり、必要な情報だけを読みやすく表示します。\n\n## 確認項目\n\n- 背景を大きなカードで囲まない\n- ユーザー発言との区別は保つ\n- モバイルでも横にはみ出さない',
      }));

      await page.goto('/');
      await waitForVisualSurface(page);
      await page.getByTestId('origin-home-request').fill('通常回答の読みやすさを確認');
      await page.getByTestId('start-request-button').click();

      const assistant = page.locator('.origin-chat-assistant').last();
      const user = page.locator('.origin-chat-user').last();
      await expect(assistant).toBeVisible({ timeout: 15_000 });
      await expect(user).toBeVisible();
      await expect(assistant).toContainText('通常回答は会話面に自然につながり');

      const assistantStyle = await assistant.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          backgroundColor: style.backgroundColor,
          boxShadow: style.boxShadow,
          borderTopColor: style.borderTopColor,
          left: rect.left,
          right: rect.right,
        };
      });
      const userBackground = await user.evaluate((element) => getComputedStyle(element).backgroundColor);

      expect(assistantStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(assistantStyle.boxShadow).toBe('none');
      expect(assistantStyle.borderTopColor).toBe('rgba(0, 0, 0, 0)');
      expect(assistantStyle.left).toBeGreaterThanOrEqual(-1);
      expect(assistantStyle.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(userBackground).not.toBe('rgba(0, 0, 0, 0)');
      await expect(page.getByTestId('response-verification-details')).toBeVisible();

      await page.screenshot({ path: testInfo.outputPath(`assistant-reading-${viewport.name}.png`), fullPage: true });
    });
  }

  test('captures the quiet home, settings, and history surfaces on mobile-390', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByTestId('origin-home-request')).toBeVisible({ timeout: 15_000 });
    await waitForVisualSurface(page);
    await page.screenshot({ path: testInfo.outputPath('surface-home-mobile-390.png'), fullPage: true });

    await page.getByRole('button', { name: '設定を開く', exact: true }).click();
    const settings = page.getByRole('dialog', { name: /設定|Settings/i });
    const settingsPanel = page.getByTestId('settings-modal');
    await expect(settings).toBeVisible();
    await expect(settingsPanel).toHaveCSS('opacity', '1');
    await page.screenshot({ path: testInfo.outputPath('surface-settings-mobile-390.png'), fullPage: true });
    await page.getByRole('button', { name: '設定を閉じる' }).click();
    await expect(settings).toBeHidden();

    await page.getByTestId('history-drawer-toggle').click();
    const history = page.getByTestId('history-drawer');
    await expect(history).toBeVisible();
    const historyBox = await history.boundingBox();
    expect(historyBox).not.toBeNull();
    expect(historyBox!.x).toBeGreaterThanOrEqual(0);
    expect(historyBox!.y).toBeGreaterThanOrEqual(0);
    expect(historyBox!.x + historyBox!.width).toBeLessThanOrEqual(390);
    expect(historyBox!.y + Math.min(historyBox!.height, 1)).toBeLessThanOrEqual(844);
    const historyOnTop = await history.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
      const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + Math.min(rect.height / 2, 120)));
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && (hit === element || element.contains(hit)));
    });
    await page.screenshot({ path: testInfo.outputPath('surface-history-mobile-390.png'), fullPage: true });
    await history.screenshot({ path: testInfo.outputPath('surface-history-panel-mobile-390.png') });
    expect(historyOnTop).toBe(true);
  });

  test('captures the thinking state without changing the normal answer surface', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/chat', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: '処理が完了しました。' });
    });
    await page.goto('/');
    await waitForVisualSurface(page);
    await page.getByTestId('origin-home-request').fill('思考中の状態を確認');
    await page.getByTestId('start-request-button').click();
    const thinking = page.getByTestId('origin-thinking');
    await expect(thinking).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('surface-thinking-mobile-390.png'), fullPage: true });
    await expect(thinking).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('.origin-chat-assistant').last()).toContainText('処理が完了しました。');
  });

  test('captures the fail-closed zero-cost waiting state without leaking paid content', async ({ page }, testInfo) => {
    const model = 'inclusionai/ling-3.0-flash-sante:free';
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/chat', async (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        content: 'NEVER DISPLAY THIS PAID RESPONSE',
        model,
        usage: { costUsd: 1 },
        routing: {
          model: model,
          modelId: model,
          freeOnly: true,
          cost: 0,
          actualCostUsd: 1,
          estimatedCostUsd: 0,
          billingTier: 'free',
          usage: { costUsd: 1 },
          providerRouting: { requestedModel: model, servedModel: model, fallbackUsed: false },
        },
      }),
    }));
    await page.goto('/');
    await waitForVisualSurface(page);
    await page.getByTestId('origin-home-request').fill('無料条件の安全待機表示を確認');
    await page.getByTestId('start-request-button').click();
    const safeWaiting = page.getByTestId('origin-safe-waiting-state');
    await expect(safeWaiting).toContainText('$0.00');
    await expect(page.getByText('NEVER DISPLAY THIS PAID RESPONSE')).toHaveCount(0);
    await expect(page.getByTestId('origin-thinking')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('surface-safe-waiting-mobile-390.png'), fullPage: true });
  });
});
