import { expect, test } from '@playwright/test';

const viewports = [
  { name: 'mobile-320', width: 320, height: 568 },
  { name: 'mobile-360', width: 360, height: 800 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'desktop-1440', width: 1440, height: 900 },
] as const;

test.describe('ORIGIN continuous assistant reading surface', () => {
  for (const viewport of viewports) {
    test(`keeps assistant answers unboxed on ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.route('**/api/chat', async (route) => route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: '結論です。通常回答は会話面に自然につながり、必要な情報だけを読みやすく表示します。\n\n## 確認項目\n\n- 背景を大きなカードで囲まない\n- ユーザー発言との区別は保つ\n- モバイルでも横にはみ出さない',
      }));

      await page.goto('/');
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
});
