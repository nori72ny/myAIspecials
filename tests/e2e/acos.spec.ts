import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('ACOS 2.0 Personal Edition critical journey', () => {
  test('opens the personal dashboard and navigates to Unified Chat', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'What can I help you with today?' })
    ).toBeVisible({ timeout: 15_000 });

    const accessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const blockingViolations = accessibility.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact ?? '')
    );
    expect(blockingViolations).toEqual([]);

    await page.getByTestId('nav-chat').click();

    await expect(
      page.getByText(/こんにちは！ACOS統合AIです|Hello! I am ACOS Unified AI/i)
    ).toBeVisible({ timeout: 15_000 });

    const chatInput = page.getByPlaceholder(/ACOSにメッセージを入力|Message ACOS/i);
    await expect(chatInput).toBeVisible();
    await expect(chatInput).toBeEditable();
  });

  test('opens and closes real settings from Personal Edition', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /ユーザー設定|User Settings/i }).click();

    const settingsDialog = page.getByRole('dialog', {
      name: /システム環境 & 各種AI設定管理|System Preferences & Hardware Config/i,
    });
    await expect(settingsDialog).toBeVisible();
    await expect(page.getByTestId('settings-modal')).toBeVisible();

    await page.getByTestId('close-settings-button').click();
    await expect(settingsDialog).toBeHidden();
  });

  test('starts a clean Unified Chat session from New Chat', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-chat').click();

    const chatInput = page.getByPlaceholder(/ACOSにメッセージを入力|Message ACOS/i);
    await chatInput.fill('This draft must be cleared');
    await expect(chatInput).toHaveValue('This draft must be cleared');

    await page.getByTestId('new-chat-button').click();

    await expect(chatInput).toHaveValue('');
    await expect(
      page.getByText(/こんにちは！ACOS統合AIです|Hello! I am ACOS Unified AI/i)
    ).toBeVisible();
  });

  test('keeps the primary navigation usable on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const sidebar = page.locator('aside').first();
    const newChatButton = page.getByTestId('new-chat-button');
    await expect(newChatButton).toBeVisible();
    await expect(sidebar).toHaveCSS('width', '260px');

    const closeSidebarButton = page.getByRole('button', {
      name: /サイドバーを閉じる|Close sidebar/i,
    });
    await closeSidebarButton.click();
    await expect
      .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
      .toBeLessThanOrEqual(1);

    const openSidebarButton = page.getByRole('button', {
      name: /サイドバーを開く|Open sidebar/i,
    });
    await expect(openSidebarButton).toBeVisible();
    await openSidebarButton.click();
    await expect(sidebar).toHaveCSS('width', '260px');
    await expect(newChatButton).toBeVisible();

    await page.keyboard.press('Escape');
    await expect
      .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
      .toBeLessThanOrEqual(1);
    await expect(openSidebarButton).toBeVisible();

    await openSidebarButton.click();
    await expect(sidebar).toHaveCSS('width', '260px');

    await page.getByTestId('nav-chat').click();
    await expect
      .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
      .toBeLessThanOrEqual(1);
    await expect(openSidebarButton).toBeVisible();
    await expect(
      page.getByPlaceholder(/ACOSにメッセージを入力|Message ACOS/i)
    ).toBeVisible();
  });
});
