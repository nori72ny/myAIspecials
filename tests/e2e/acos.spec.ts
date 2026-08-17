import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('ORIGIN Personal 2.0 critical journey', () => {
  test('renders the core identity, Personal 2.0 badge, and four starter cards', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('origin-core-logo')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('header').getByText('ORIGIN', { exact: true })).toBeVisible();
    await expect(page.getByText('Personal 2.0', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '何を実現したいですか？' })).toBeVisible();
    await expect(page.getByTestId('starter-0')).toContainText('整理する');
    await expect(page.getByTestId('starter-1')).toContainText('比較する');
    await expect(page.getByTestId('starter-2')).toContainText('文章にする');
    await expect(page.getByTestId('starter-3')).toContainText('計画する');

    const accessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(accessibility.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
  });

  test('opens the artifact preview workspace for a structured HTML result', async ({ page }) => {
    await page.route('**/api/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: '成果物を作成しました。\n```html:preview.html\n<div id="artifact-preview">ORIGIN Personal 2.0 preview</div>\n```',
      });
    });
    await page.goto('/');

    await page.getByTestId('origin-home-request').fill('成果物を作成したい');
    await page.getByTestId('start-request-button').click();

    const workspace = page.getByTestId('artifact-workspace');
    await expect(workspace).toBeVisible({ timeout: 15_000 });
    await expect(workspace.getByRole('heading', { name: 'preview.html' })).toBeVisible();
    await page.getByRole('button', { name: 'プレビューを表示' }).click();
    await expect(workspace.getByTitle('Preview')).toBeVisible();
    await page.getByRole('button', { name: '成果物ワークスペースを閉じる' }).click();
    await expect(workspace).toBeHidden();
  });

  test('keeps settings available through the Personal 2.0 production wrapper', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '設定を開く' }).click();

    const settingsDialog = page.getByRole('dialog', { name: /設定|Settings/i });
    await expect(settingsDialog).toBeVisible();
    await expect(page.getByTestId('origin-execution-policy')).toContainText(/この版は無料AIだけを使います|This release uses free AI only/i);
    await page.getByTestId('close-settings-button').click();
    await expect(settingsDialog).toBeHidden();
  });

  test('reflows the Personal 2.0 workspace at mobile width without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await expect(page.getByTestId('origin-core-logo')).toBeVisible();
    await expect(page.getByTestId('origin-home-request')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
