import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function openSettings(page: import('@playwright/test').Page) {
  const opener = page.getByRole('button', { name: /設定を開く|Open settings/i });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: /設定|Settings/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('settings-modal')).toHaveCSS('opacity', '1');
  await expect(page.getByTestId('close-settings-button')).toBeFocused();
  return { opener, dialog };
}

test.describe('ORIGIN Personal release accessibility', () => {
  test('settings dialog traps focus and restores the opener on Escape', async ({ page }) => {
    await page.goto('/');
    const { opener, dialog } = await openSettings(page);

    const iconClose = page.getByTestId('close-settings-button');
    const footerClose = dialog.getByRole('button', { name: /^(閉じる|Close)$/ });

    await iconClose.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(footerClose).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(iconClose).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('settings dialog has no serious automated WCAG violations', async ({ page }) => {
    await page.goto('/');
    const { dialog } = await openSettings(page);

    const accessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
    await expect(dialog).toContainText(/安全と費用|Safety and cost/);
  });

  test('chat input exposes keyboard and secret guidance programmatically', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-chat').click();

    const input = page.getByRole('textbox', { name: /ORIGINへの依頼|Request to ORIGIN/i });
    await expect(input).toHaveAttribute('aria-describedby', 'origin-chat-guidance');
    await expect(page.locator('#origin-chat-guidance')).toContainText(/Enterで送信|Enter to send/);
    await expect(page.locator('#origin-chat-guidance')).toContainText(/パスワードやAPIキー|passwords or API keys/i);
  });

  test('conversation log announces completion without reading the full answer automatically', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-chat').click();

    const log = page.getByRole('log', { name: /会話履歴|Conversation history/i });
    await expect(log).toHaveAttribute('aria-live', 'off');
    await expect(log).toHaveAttribute('aria-busy', 'false');

    const input = page.getByRole('textbox', { name: /ORIGINへの依頼|Request to ORIGIN/i });
    await input.fill('天気');
    await page.getByRole('button', { name: /依頼を送信|Send request/i }).click();

    await expect(page.getByTestId('response-announcement')).toContainText(
      /ORIGINの回答が届きました|ORIGIN’s answer is ready/i,
    );
    await expect(log).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('article', { name: /あなたの依頼|Your request/i })).toBeVisible();
  });

  test('language controls have pressed state and update the interface', async ({ page }) => {
    await page.goto('/');
    const { dialog } = await openSettings(page);

    const japanese = dialog.getByRole('button', { name: '日本語' });
    const english = dialog.getByRole('button', { name: 'English' });
    await expect(japanese).toHaveAttribute('aria-pressed', 'true');

    await english.click();
    await expect(english).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog).toContainText('Changes are saved automatically.');
  });
});
