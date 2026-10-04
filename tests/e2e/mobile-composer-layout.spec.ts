import { expect, test } from '@playwright/test';

const cases = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 390, height: 560 },
] as const;

for (const viewport of cases) {
  test(`keeps the mobile composer low, spacious and unclipped at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');

    const composer = page.locator('.origin-composer');
    const input = page.getByTestId('origin-home-request');
    const add = page.getByTestId('origin-add-menu-toggle');
    const send = page.getByTestId('start-request-button');

    await expect(input).toBeVisible();
    await expect(composer).toBeVisible();

    const composerBox = await composer.boundingBox();
    const inputBox = await input.boundingBox();
    const addBox = await add.boundingBox();
    const sendBox = await send.boundingBox();

    expect(composerBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(addBox).not.toBeNull();
    expect(sendBox).not.toBeNull();

    expect(inputBox!.width).toBeGreaterThanOrEqual(composerBox!.width - 24);
    expect(inputBox!.x).toBeGreaterThanOrEqual(composerBox!.x + 6);
    expect(inputBox!.x + inputBox!.width).toBeLessThanOrEqual(composerBox!.x + composerBox!.width - 6);

    expect(addBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height - 2);
    expect(sendBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height - 2);
    expect(Math.abs(addBox!.y - sendBox!.y)).toBeLessThanOrEqual(2);
    expect(addBox!.x).toBeLessThan(inputBox!.x + 8);
    expect(sendBox!.x + sendBox!.width).toBeGreaterThan(inputBox!.x + inputBox!.width - 8);

    expect(composerBox!.y).toBeGreaterThan(viewport.height * 0.5);
    expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(viewport.height - 12);

    await input.focus();
    const focusMetrics = await composer.evaluate((element) => {
      const style = getComputedStyle(element);
      return { borderWidth: style.borderTopWidth, boxShadow: style.boxShadow };
    });
    expect(focusMetrics.borderWidth).toBe('1px');
    expect(focusMetrics.boxShadow).not.toContain('0px 0px 0px 3px');

    await input.fill('長文でも入力と操作を確認します。\n'.repeat(20));
    await add.click();
    const menu = page.getByRole('menu', { name: '追加機能' });
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width);
    expect(menuBox!.y).toBeGreaterThanOrEqual(0);
    const expandedComposerBox = await composer.boundingBox();
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(expandedComposerBox!.y - 4);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport.height);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
