import { expect, test } from '@playwright/test';

test.describe('ORIGIN Personal release navigation', () => {
  test('shows only usable first-release features and no sample data', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /何を手伝えばよいですか？|What can I help you with\?/ })).toBeVisible({
      timeout: 15_000,
    });

    await expect(page.getByText('ORIGIN', { exact: true })).toBeVisible();
    await expect(page.getByTestId('new-chat-button')).toHaveText(/新しい依頼|New request/);
    await expect(page.getByTestId('nav-dashboard')).toHaveText(/ホーム|Home/);
    await expect(page.getByTestId('nav-chat')).toHaveText(/チャット|Chat/);
    await expect(page.getByTestId('nav-workspace')).toHaveCount(0);
    await expect(page.getByTestId('nav-memory')).toHaveCount(0);
    await expect(page.locator('main h1')).toHaveText(/ホーム|Home/);

    await expect(page.getByText(/最近のプロジェクト|Recent projects/)).toHaveCount(0);
    await expect(page.getByText(/ACOS Development|Sales Deck|Marketing|Memory Fragments/)).toHaveCount(0);
    await expect(page.getByText(/Switch to Enterprise/i)).toHaveCount(0);
    await expect(page.getByText(/AIコア：|AI Core:/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /設定を開く|Open settings/ })).toBeVisible();
  });

  test('opens a fresh chat from the primary action', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('new-chat-button').click();

    await expect(page.locator('main h1')).toHaveText(/チャット|Chat/);
    await expect(page.getByRole('textbox', { name: /ORIGINへの依頼|Request to ORIGIN/ })).toBeVisible();
  });
});
