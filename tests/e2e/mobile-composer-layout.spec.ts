import { expect, test } from '@playwright/test';

test.describe('mobile composer layout', () => {
  test('keeps the first-screen composer low, wide, and visually quiet at 390px', async ({ page }) => {
    const viewport = { width: 390, height: 844 };
    await page.setViewportSize(viewport);
    await page.goto('/');

    const composer = page.locator('.origin-composer');
    const input = page.getByTestId('origin-home-request');
    const add = page.getByTestId('origin-add-menu-toggle');
    const send = page.getByTestId('start-request-button');

    await expect(input).toBeVisible();
    await expect(add).toBeVisible();
    await expect(send).toBeVisible();

    const composerBox = await composer.boundingBox();
    const inputBox = await input.boundingBox();
    const addBox = await add.boundingBox();
    const sendBox = await send.boundingBox();

    expect(composerBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(addBox).not.toBeNull();
    expect(sendBox).not.toBeNull();

    expect(composerBox!.width).toBeGreaterThanOrEqual(360);
    expect(inputBox!.width).toBeGreaterThanOrEqual(composerBox!.width - 24);
    expect(composerBox!.y + composerBox!.height).toBeGreaterThanOrEqual(viewport.height - 90);
    expect(inputBox!.y).toBeLessThan(addBox!.y);
    expect(inputBox!.y).toBeLessThan(sendBox!.y);
    expect(Math.abs(addBox!.y - sendBox!.y)).toBeLessThanOrEqual(2);
    expect(addBox!.width).toBeGreaterThanOrEqual(44);
    expect(addBox!.height).toBeGreaterThanOrEqual(44);
    expect(sendBox!.width).toBeGreaterThanOrEqual(44);
    expect(sendBox!.height).toBeGreaterThanOrEqual(44);
    expect(addBox!.x - composerBox!.x).toBeLessThanOrEqual(14);
    expect((composerBox!.x + composerBox!.width) - (sendBox!.x + sendBox!.width)).toBeLessThanOrEqual(14);

    await input.focus();
    const focusedStyle = await composer.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderWidth: style.borderTopWidth,
        boxShadow: style.boxShadow,
      };
    });
    expect(focusedStyle.borderWidth).toBe('1px');
    expect(focusedStyle.boxShadow).not.toContain('0px 0px 0px 3px');

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('preserves typing width and touch targets at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');

    const composer = page.locator('.origin-composer');
    const input = page.getByTestId('origin-home-request');
    const add = page.getByTestId('origin-add-menu-toggle');
    const send = page.getByTestId('start-request-button');
    await expect(input).toBeVisible();

    const composerBox = await composer.boundingBox();
    const inputBox = await input.boundingBox();
    const addBox = await add.boundingBox();
    const sendBox = await send.boundingBox();

    expect(composerBox?.width).toBeGreaterThanOrEqual(290);
    expect(inputBox && composerBox ? inputBox.width >= composerBox.width - 24 : false).toBe(true);
    expect(addBox?.width).toBeGreaterThanOrEqual(44);
    expect(sendBox?.width).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 390, height: 560 }]) {
  test(`keeps the add menu above long input at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const input = page.getByTestId('origin-home-request');
    await input.fill('長文でも入力と操作を確認します。\n'.repeat(20));
    await page.getByTestId('origin-add-menu-toggle').click();
    const menu = page.getByRole('menu', { name: '追加機能' });
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    const composerBox = await page.locator('.origin-composer').boundingBox();
    expect(menuBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width);
    expect(menuBox!.y).toBeGreaterThanOrEqual(0);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(composerBox!.y - 4);
    expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
  });
}
