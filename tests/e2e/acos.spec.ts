import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('ORIGIN Personal Edition critical journey', () => {
  test('opens the personal dashboard and navigates to chat', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /考えがまとまる前から、始められます。|Start before your thoughts are fully formed\./i })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(50);

    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);

    await page.getByTestId('nav-chat').click();
    await expect(page.getByText(/こんにちは。やりたいことを|Hello\. Describe what you want to do/i)).toBeVisible({ timeout: 15_000 });

    const chatInput = page.getByRole('textbox', { name: /ORIGINへの依頼|Request to ORIGIN/i });
    await expect(chatInput).toBeVisible();
    await expect(chatInput).toBeEditable();
  });

  test('opens truthful, minimal release settings', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('main').getByRole('button', { name: /設定を開く|Open settings/i }).click();

    const settingsDialog = page.getByRole('dialog', { name: /設定|Settings/i });
    await expect(settingsDialog).toBeVisible();
    await expect(page.getByTestId('origin-execution-policy')).toContainText(/この版は無料AIだけを使います|This release uses free AI only/i);
    await expect(settingsDialog).toContainText('$0.00');
    await expect(settingsDialog).not.toContainText(/Developer|Retro|OLED|プロバイダーを選択|自動モデルルーター|応答を待つ時間|Maximum wait time/i);

    await page.getByTestId('close-settings-button').click();
    await expect(settingsDialog).toBeHidden();
  });

  test('starts a clean chat session from New request', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-chat').click();
    const chatInput = page.getByRole('textbox', { name: /ORIGINへの依頼|Request to ORIGIN/i });
    await chatInput.fill('This draft must be cleared');
    await expect(chatInput).toHaveValue('This draft must be cleared');

    await page.getByTestId('new-chat-button').click();
    await expect(chatInput).toHaveValue('');
    await expect(page.getByText(/こんにちは。やりたいことを|Hello\. Describe what you want to do/i)).toBeVisible();
  });

  test('keeps navigation and chat usable at 390 by 844', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const sidebar = page.getByRole('complementary', { name: /メインナビゲーション|Primary navigation/i });

    await expect(page.getByRole('heading', { name: /考えがまとまる前から、始められます。|Start before your thoughts are fully formed\./i })).toBeVisible();
    await expect(sidebar).toHaveAttribute('aria-hidden', 'true');
    await expect(sidebar).toHaveAttribute('inert', '');
    await expect(page.getByTestId('compact-home-button')).toBeVisible();
    await expect(page.getByTestId('compact-chat-button')).toBeVisible();
    await page.getByTestId('compact-chat-button').click();
    await expect(page.getByRole('textbox', { name: /ORIGINへの依頼|Request to ORIGIN/i })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
