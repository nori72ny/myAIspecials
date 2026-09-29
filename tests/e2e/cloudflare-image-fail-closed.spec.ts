import { expect, test } from '@playwright/test';

const VIEWPORTS = [320, 390, 1440] as const;

async function waitForBoot(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('origin-home-request')).toBeVisible();
  await expect(page.getByRole('status', { name: 'ORIGIN を起動しています' })).toBeHidden({ timeout: 5_000 });
}

for (const width of VIEWPORTS) {
  test(`Cloudflare raster remains fail-closed when server provider is not configured at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    let imageRequests = 0;
    await page.route('**/api/generate-image', async route => {
      imageRequests += 1;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          code: 'CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED',
          message: '無料画像生成のCloudflare Workers AI接続がまだ構成されていません。',
          freeOnly: true,
          costUsd: 0,
          paidFallbackUsed: false,
          secretDelivery: 'server-only',
        }),
      });
    });

    await page.goto('/');
    await waitForBoot(page);

    const prompt = '青空の下で走る柴犬の写真風画像を文字なし・正方形で作ってください';
    await page.getByTestId('origin-home-request').fill(prompt);
    await page.getByTestId('start-request-button').click();

    await expect(page.getByText('無料画像生成のCloudflare Workers AI接続がまだ構成されていません。', { exact: true })).toBeVisible();
    await expect(page.getByAltText('ORIGINが生成した画像')).toHaveCount(0);
    await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
    expect(imageRequests).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });

  test(`Cloudflare free-allocation exhaustion never produces a paid or fake image at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await page.route('**/api/generate-image', route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        code: 'CLOUDFLARE_FREE_ALLOCATION_UNAVAILABLE',
        message: '費用0円を事前保証できないため、画像生成を停止しました。',
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
        secretDelivery: 'server-only',
      }),
    }));

    await page.goto('/');
    await waitForBoot(page);
    await page.getByTestId('origin-home-request').fill('海辺の夕焼けを写真風で生成してください');
    await page.getByTestId('start-request-button').click();

    await expect(page.getByText('費用0円を事前保証できないため、画像生成を停止しました。', { exact: true })).toBeVisible();
    await expect(page.getByAltText('ORIGINが生成した画像')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '画像を保存' })).toHaveCount(0);
  });
}
