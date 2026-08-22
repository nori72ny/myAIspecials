import { expect, test } from '@playwright/test';

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

  test('keeps the mobile header on one line with three 44px action targets', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');

    const header = page.locator('header.origin-header');
    const history = page.getByTestId('history-drawer-toggle');
    const settings = page.getByRole('button', { name: '設定を開く' });
    const newConversation = page.getByRole('button', { name: '新規対話を開始' });

    await expect(header).toContainText('ORIGIN');
    await expect(header).toContainText('Personal 2.0');
    for (const button of [history, settings, newConversation]) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(await button.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap');
    }
    const headerWidth = await header.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
    expect(headerWidth.scroll).toBeLessThanOrEqual(headerWidth.client);
  });
});
