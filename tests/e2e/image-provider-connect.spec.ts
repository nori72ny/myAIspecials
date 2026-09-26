import { expect, test } from '@playwright/test';

for (const width of [320, 1440]) {
  test(`image connection preserves the request at ${width}px (mock provider)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const prompts: string[] = [];
    await page.route('**/api/generate-image', async route => {
      prompts.push(route.request().postDataJSON().prompt);
      await route.fulfill({ status: 503, json: prompts.length === 1
        ? { code: 'POLLINATIONS_KEY_NOT_CONFIGURED' }
        : { code: 'PROVIDER_UNAVAILABLE', message: '画像サービスが利用できません。' } });
    });
    await page.route('**/api/creative/v1.5/raster/connect/start', route => route.fulfill({ json: {
      ok: true, userCode: 'ABCD-1234', verificationUri: 'https://enter.pollinations.ai/device', expiresIn: 600, interval: 1,
    } }));
    await page.route('**/api/creative/v1.5/raster/connect/complete', route => route.fulfill({ json: { ok: true, connected: true } }));
    await page.route('**/api/creative/v1.5/raster/status', route => route.fulfill({ json: {
      ready: true, zeroCostVerified: true, freeOnly: true, paidFallbackEnabled: false,
    } }));
    await page.goto('/');
    const prompt = '朝焼けの富士山の画像を作ってください';
    await page.getByTestId('origin-home-request').fill(prompt);
    await page.getByTestId('start-request-button').click();
    await page.getByRole('button', { name: '接続を開始', exact: true }).click();
    const card = page.getByRole('region', { name: '画像生成を有効にする' });
    await expect(card.getByText('ABCD-1234')).toBeVisible();
    await expect(card.getByRole('link', { name: '承認画面を開く' })).toHaveAttribute('href', 'https://enter.pollinations.ai/device');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    for (const button of await card.getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await testInfo.attach(`image-connect-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await card.getByRole('button', { name: '承認を確認して再開' }).click();
    await expect(page.getByText('画像サービスが利用できません。', { exact: true })).toBeVisible();
    expect(prompts).toEqual([prompt, prompt]);
    await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
    await expect(card).toHaveCount(0);
  });
}
