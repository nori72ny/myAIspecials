import { expect, test } from '@playwright/test';

const waitForHome = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await expect(page.getByTestId('origin-core-logo')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('origin-home-request')).toBeVisible();
};

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
]) {
  test(`keeps the mobile composer low, spacious and balanced at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await waitForHome(page);

    const composer = page.locator('.origin-composer');
    const input = page.getByTestId('origin-home-request');
    const add = page.getByTestId('origin-add-menu-toggle');
    const send = page.getByTestId('start-request-button');

    const [composerBox, inputBox, addBox, sendBox] = await Promise.all([
      composer.boundingBox(),
      input.boundingBox(),
      add.boundingBox(),
      send.boundingBox(),
    ]);

    expect(composerBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(addBox).not.toBeNull();
    expect(sendBox).not.toBeNull();

    expect(composerBox!.width).toBeGreaterThanOrEqual(viewport.width - 30);
    expect(composerBox!.y).toBeGreaterThan(viewport.height * 0.55);
    expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(viewport.height);

    // The input owns the full first row instead of competing horizontally with + / send.
    expect(inputBox!.width).toBeGreaterThanOrEqual(composerBox!.width - 24);
    expect(inputBox!.y).toBeLessThan(addBox!.y);
    expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(addBox!.y + 6);

    // Progressive tools and send remain balanced on the lower control row.
    expect(Math.abs(addBox!.y - sendBox!.y)).toBeLessThanOrEqual(2);
    expect(addBox!.x - composerBox!.x).toBeLessThanOrEqual(12);
    expect((composerBox!.x + composerBox!.width) - (sendBox!.x + sendBox!.width)).toBeLessThanOrEqual(12);
    expect(addBox!.width).toBeGreaterThanOrEqual(44);
    expect(sendBox!.width).toBeGreaterThanOrEqual(44);

    await input.focus();
    const focusAppearance = await composer.evaluate((element) => {
      const style = getComputedStyle(element);
      return { borderWidth: style.borderWidth, boxShadow: style.boxShadow };
    });
    expect(focusAppearance.borderWidth).toBe('1px');
    expect(focusAppearance.boxShadow).not.toMatch(/0px 0px 0px 3px/);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await testInfo.attach(`mobile-composer-${viewport.width}px`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
}

test('keeps the conversation composer docked low after the first response', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/chat', route => route.fulfill({
    status: 200,
    contentType: 'text/plain; charset=utf-8',
    body: '入力欄の配置を確認しました。',
  }));
  await waitForHome(page);

  await page.getByTestId('origin-home-request').fill('入力欄の位置を確認');
  await page.getByTestId('start-request-button').click();
  await expect(page.getByText('入力欄の配置を確認しました。')).toBeVisible();

  const composer = page.locator('.origin-composer');
  const input = page.getByTestId('origin-chat-request');
  const add = page.getByTestId('origin-add-menu-toggle');
  const send = page.getByTestId('send-request-button');
  const [composerBox, inputBox, addBox, sendBox] = await Promise.all([
    composer.boundingBox(), input.boundingBox(), add.boundingBox(), send.boundingBox(),
  ]);

  expect(composerBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(addBox).not.toBeNull();
  expect(sendBox).not.toBeNull();
  expect(composerBox!.y).toBeGreaterThan(844 * 0.72);
  expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(844);
  expect(inputBox!.width).toBeGreaterThanOrEqual(composerBox!.width - 24);
  expect(Math.abs(addBox!.y - sendBox!.y)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await testInfo.attach('mobile-composer-390px-conversation', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});
