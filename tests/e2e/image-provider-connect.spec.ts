import { expect, test, type Page } from '@playwright/test';

const VIEWPORTS = [320, 390, 1440] as const;

async function waitForBootTransition(page: Page) {
  await expect(page.getByTestId('origin-home-request')).toBeVisible();
  await expect(page.getByRole('status', { name: 'ORIGIN を起動しています' })).toBeHidden({ timeout: 5_000 });
}

for (const width of VIEWPORTS) {
  test(`Cloudflare raster fails closed without exposing a dead provider-connect UI at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const prompts: string[] = [];

    await page.route('**/api/generate-image', async route => {
      prompts.push(route.request().postDataJSON().prompt);
      await route.fulfill({
        status: 503,
        json: {
          ok: false,
          code: 'CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED',
          message: '無料画像生成のCloudflare Workers AI接続がまだ構成されていません。',
          freeOnly: true,
          costUsd: 0,
          paidFallbackUsed: false,
          secretDelivery: 'server-only',
        },
      });
    });

    await page.goto('/');
    await waitForBootTransition(page);

    const prompt = '朝焼けの富士山の画像を作ってください';
    await page.getByTestId('origin-home-request').fill(prompt);
    await page.getByTestId('start-request-button').click();

    await expect(page.getByText('無料画像生成のCloudflare Workers AI接続がまだ構成されていません。', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '画像生成を有効にする' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /接続を開始|安全な接続を開始/ })).toHaveCount(0);
    await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
    expect(prompts).toEqual([prompt]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

for (const width of VIEWPORTS) {
  test(`Cloudflare paid-plan evidence is blocked without fallback at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let requests = 0;

    await page.route('**/api/generate-image', async route => {
      requests += 1;
      await route.fulfill({
        status: 503,
        json: {
          ok: false,
          code: 'CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED',
          message: '費用0円を事前保証できないため、画像生成を停止しました。',
          freeOnly: true,
          costUsd: 0,
          paidFallbackUsed: false,
          secretDelivery: 'server-only',
        },
      });
    });

    await page.goto('/');
    await waitForBootTransition(page);

    await page.getByTestId('origin-home-request').fill('文字なしで柴犬の正方形写真を生成してください');
    await page.getByTestId('start-request-button').click();

    await expect(page.getByText('費用0円を事前保証できないため、画像生成を停止しました。', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '画像生成を有効にする' })).toHaveCount(0);
    expect(requests).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
