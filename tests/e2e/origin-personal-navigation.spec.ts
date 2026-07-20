import { expect, test } from '@playwright/test';

test.describe('ORIGIN Personal navigation', () => {
  test('uses clear user-facing names and removes misleading sample content', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /何を実現したいですか？|What would you like to achieve\?/ })).toBeVisible({
      timeout: 15_000,
    });

    await expect(page.getByText('ORIGIN', { exact: true })).toBeVisible();
    await expect(page.getByTestId('new-chat-button')).toHaveText(/新しい依頼|New request/);
    await expect(page.getByTestId('nav-dashboard')).toHaveText(/ホーム|Home/);
    await expect(page.getByTestId('nav-chat')).toHaveText(/チャット|Chat/);
    await expect(page.getByTestId('nav-workspace')).toHaveText(/プロジェクト|Projects/);
    await expect(page.getByTestId('nav-memory')).toHaveText(/記憶|Memory/);
    await expect(page.locator('main h1')).toHaveText(/ホーム|Home/);

    await expect(page.getByText(/まだプロジェクトはありません。|No projects yet\./)).toBeVisible();
    await expect(page.getByText(/ACOS Development|Sales Deck|Marketing/)).toHaveCount(0);
    await expect(page.getByText(/Switch to Enterprise/i)).toHaveCount(0);
    await expect(page.getByText(/AIコア：|AI Core:/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /ユーザー設定|User Settings/ })).toBeVisible();
  });
});
