import { expect, test } from '@playwright/test';

const VIEWPORTS = [320, 390, 1440] as const;

async function waitForBoot(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('origin-home-request')).toBeVisible();
  await expect(page.getByRole('status', { name: 'ORIGIN を起動しています' })).toBeHidden({ timeout: 5_000 });
}

for (const width of VIEWPORTS) {
  test(`explicit procedural artwork produces a real PNG without requiring a configured server provider at ${width}px`, async ({ page }) => {
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

    const prompt = '手続き型のPNG画像を作ってください';
    await page.getByTestId('origin-home-request').fill(prompt);
    await page.getByTestId('start-request-button').click();

    const image = page.getByAltText('ORIGINが生成した画像');
    await expect(image).toHaveCount(1);
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
    expect(await image.evaluate((node: HTMLImageElement) => node.src.startsWith('blob:'))).toBe(true);
    await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
    expect(imageRequests).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });

  test(`explicit procedural artwork remains local when free allocation is unavailable at ${width}px`, async ({ page }) => {
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
    await page.getByTestId('origin-home-request').fill('手続き型のPNG画像を作ってください');
    await page.getByTestId('start-request-button').click();

    const image = page.getByAltText('ORIGINが生成した画像');
    await expect(image).toHaveCount(1);
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
    expect(await image.evaluate((node: HTMLImageElement) => node.src.startsWith('blob:'))).toBe(true);
    await expect(page.getByRole('link', { name: '画像を保存' })).toHaveCount(1);
  });
}
