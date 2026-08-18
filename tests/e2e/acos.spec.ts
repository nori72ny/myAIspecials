import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('ORIGIN Personal 2.0 critical journey', () => {
  test('renders the core identity, Personal 2.0 badge, and four starter cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('origin-core-logo')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('header').getByText('ORIGIN', { exact: true })).toBeVisible();
    await expect(page.getByText('Personal 2.0', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '何を実現したいですか？' })).toBeVisible();
    for (const [index, label] of ['整理する', '比較する', '文章にする', '計画する'].entries()) await expect(page.getByTestId(`starter-${index}`)).toContainText(label);
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
  });

  test('supports translated artifact controls and MIME-appropriate download', async ({ page }) => {
    await page.route('**/api/chat', async (route) => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: '成果物を作成しました。\n```html:preview.html\n<div id="artifact-preview">ORIGIN Personal 2.0 preview</div>\n```' }));
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('成果物を作成したい');
    await page.getByTestId('start-request-button').click();
    const workspace = page.getByTestId('artifact-workspace');
    await expect(workspace).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'プレビューを表示' }).click();
    await expect(workspace.getByTitle('Preview')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '成果物をダウンロード' }).click();
    await expect((await download).suggestedFilename()).toBe('preview.html');
    await page.getByRole('button', { name: '成果物ワークスペースを閉じる' }).click();
    await expect(workspace).toBeHidden();
  });

  test('accepts text drag-and-drop and rejects attachments over 5MB', async ({ page }) => {
    await page.route('**/api/chat', async (route) => route.fulfill({ status: 200, body: '' }));
    await page.goto('/');
    const homeRequest = page.getByTestId('origin-home-request');
    await homeRequest.evaluate((element) => { const transfer = new DataTransfer(); transfer.items.add(new File(['hello origin'], 'note.txt', { type: 'text/plain' })); element.parentElement?.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer })); });
    await expect(page.getByText(/添付: note.txt/)).toBeVisible();
    await homeRequest.evaluate((element) => { const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.txt', { type: 'text/plain' })); element.parentElement?.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer })); });
    await expect(page.getByRole('alert')).toContainText('5MB以下');
  });

  test('keeps settings, language, system theme, and history controls available', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '設定を開く' }).click();
    const settingsDialog = page.getByRole('dialog', { name: /設定|Settings/i });
    await expect(settingsDialog).toBeVisible();
    await page.getByRole('button', { name: 'システム設定' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/);
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible();
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
