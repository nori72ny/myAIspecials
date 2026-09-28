import { expect, test, type Locator, type Page } from '@playwright/test';

const VIEWPORTS = [320, 390, 1440] as const;
const AUTH_URI = 'https://enter.pollinations.ai/authorize?response_type=code&client_id=pk_test12345678&redirect_uri=https%3A%2F%2Forigin-personal.vercel.app%2Fapi%2Fcreative%2Fv1.5%2Fraster%2Fconnect%2Fcallback&scope=usage&models=tomdacatto%2Fsana&budget=0&expiry=7&state=abc&code_challenge=xyz&code_challenge_method=S256';

async function waitForBootTransition(page: Page) {
  await expect(page.getByTestId('origin-home-request')).toBeVisible();
  await expect(page.getByRole('status', { name: 'ORIGIN を起動しています' })).toBeHidden({ timeout: 5_000 });
}

async function expectInsideViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
}

async function expectAccessibleControls(card: Locator) {
  for (const control of await card.getByRole('button').all()) {
    expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  for (const control of await card.getByRole('link').all()) {
    expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
}

for (const width of VIEWPORTS) {
  test(`image PKCE connection preserves the request at ${width}px (mock provider)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const prompts: string[] = [];
    await page.route('**/api/generate-image', route => {
      prompts.push(route.request().postDataJSON().prompt);
      return route.fulfill({ status: 503, json: prompts.length === 1
        ? { code: 'POLLINATIONS_KEY_NOT_CONFIGURED' }
        : { code: 'PROVIDER_UNAVAILABLE', message: '画像サービスが利用できません。' } });
    });
    await page.route('**/api/creative/v1.5/raster/connect/start', route => route.fulfill({ json: {
      ok: true, authorizationUri: AUTH_URI, expiresIn: 600, model: 'tomdacatto/sana', budgetPollen: 0,
    } }));
    await page.route('**/api/creative/v1.5/raster/connect/status', route => route.fulfill({ json: { ok: true, connected: true } }));
    await page.route('**/api/creative/v1.5/raster/status', route => route.fulfill({ json: {
      ready: true, zeroCostVerified: true, freeOnly: true, paidFallbackEnabled: false,
    } }));

    await page.goto('/');
    await waitForBootTransition(page);
    const prompt = '朝焼けの富士山の画像を作ってください';
    await page.getByTestId('origin-home-request').fill(prompt);
    await page.getByTestId('start-request-button').click();

    await page.getByRole('button', { name: '安全な接続を開始', exact: true }).click();
    const card = page.getByRole('region', { name: '画像生成を有効にする' });
    const approval = card.getByRole('link', { name: '承認画面を開く' });
    await expect(approval).toHaveAttribute('href', AUTH_URI);
    expect((await approval.getAttribute('href')) ?? '').toContain('budget=0');
    expect((await approval.getAttribute('href')) ?? '').toContain('models=tomdacatto%2Fsana');

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expectInsideViewport(page, card);
    await expectAccessibleControls(card);
    await testInfo.attach(`image-connect-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    await card.getByRole('button', { name: '承認を確認して再開' }).click();
    await expect(page.getByText('画像サービスが利用できません。', { exact: true })).toBeVisible();
    expect(prompts).toEqual([prompt, prompt]);
    await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
    await expect(card).toHaveCount(0);
  });
}

for (const width of VIEWPORTS) {
  test(`approved image connection can recheck zero-cost readiness at ${width}px (mock provider)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    let starts = 0;
    let checks = 0;
    let requests = 0;

    await page.route('**/api/generate-image', route => {
      requests += 1;
      return route.fulfill({ status: 503, json: {
        code: requests === 1 ? 'POLLINATIONS_KEY_NOT_CONFIGURED' : 'PROVIDER_UNAVAILABLE',
        message: '画像サービスが利用できません。',
      } });
    });
    await page.route('**/api/creative/v1.5/raster/connect/start', route => {
      starts += 1;
      return route.fulfill({ json: { ok: true, authorizationUri: AUTH_URI, expiresIn: 600, model: 'tomdacatto/sana', budgetPollen: 0 } });
    });
    await page.route('**/api/creative/v1.5/raster/connect/status', route => route.fulfill({ json: { ok: true, connected: true } }));
    await page.route('**/api/creative/v1.5/raster/status', route => {
      checks += 1;
      return route.fulfill({ status: checks === 1 ? 503 : 200, json: {
        ready: checks > 1, zeroCostVerified: checks > 1, freeOnly: true, paidFallbackEnabled: false,
      } });
    });

    await page.goto('/');
    await waitForBootTransition(page);
    const prompt = '朝焼けの富士山の画像を作ってください';
    await page.getByTestId('origin-home-request').fill(prompt);
    await page.getByTestId('start-request-button').click();

    await page.getByRole('button', { name: '安全な接続を開始', exact: true }).click();
    await page.getByRole('button', { name: '承認を確認して再開' }).click();

    const card = page.getByRole('region', { name: '画像生成を有効にする' });
    await expect(page.getByText(/接続は承認済みですが/)).toBeVisible();
    await expect(page.getByRole('button', { name: '安全な接続を開始', exact: true })).toHaveCount(0);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expectInsideViewport(page, card);
    await expectAccessibleControls(card);
    await testInfo.attach(`image-connect-recovery-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    await page.getByRole('button', { name: '費用0円モデルを再確認' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
    expect(starts).toBe(1);
    expect(checks).toBe(2);
    expect(requests).toBe(2);
  });
}
