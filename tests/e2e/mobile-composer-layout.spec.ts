import { expect, test, type Page } from '@playwright/test';

async function scrollViewportBottom(page: Page): Promise<number> {
  const scrollViewport = page.locator('.origin-app main > div.min-h-0.flex-1.overflow-y-auto').first();
  const box = await scrollViewport.boundingBox();
  if (!box) throw new Error('Mobile scroll viewport is not measurable.');
  return box.y + box.height;
}

async function scrollViewportBottomPadding(page: Page): Promise<number> {
  const scrollViewport = page.locator('.origin-app main > div.min-h-0.flex-1.overflow-y-auto').first();
  return scrollViewport.evaluate((element) => {
    const value = Number.parseFloat(getComputedStyle(element).paddingBottom);
    return Number.isFinite(value) ? value : 0;
  });
}

async function bottomSafeAreaInset(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom, 0px)';
    document.body.appendChild(probe);
    const inset = Number.parseFloat(getComputedStyle(probe).paddingBottom) || 0;
    probe.remove();
    return inset;
  });
}

test.describe('mobile composer layout', () => {
  test('keeps the first-screen composer low, wide, and visually quiet at 390px', async ({ page }) => {
    const viewport = { width: 390, height: 844 };
    await page.setViewportSize(viewport);
    await page.goto('/');
    const safeAreaBottom = await bottomSafeAreaInset(page);
    const scrollBottom = await scrollViewportBottom(page);
    const bottomOffset = safeAreaBottom + await scrollViewportBottomPadding(page);

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
    expect(inputBox!.width).toBeGreaterThanOrEqual(composerBox!.width - 140);
    expect(composerBox!.height).toBeLessThanOrEqual(84);
    expect(composerBox!.y + composerBox!.height).toBeGreaterThanOrEqual(scrollBottom - bottomOffset - 1);
    expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(scrollBottom - bottomOffset + 1);
    // Single-row contract: the add menu leads, the input sits between the
    // two controls, and all three share one bottom-aligned row.
    expect(addBox!.x).toBeLessThan(inputBox!.x);
    expect(inputBox!.x).toBeLessThan(sendBox!.x);
    const inputBottom = inputBox!.y + inputBox!.height;
    expect(Math.abs(inputBottom - (addBox!.y + addBox!.height))).toBeLessThanOrEqual(2);
    expect(Math.abs(inputBottom - (sendBox!.y + sendBox!.height))).toBeLessThanOrEqual(2);
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
    const safeAreaBottom = await bottomSafeAreaInset(page);
    const scrollBottom = await scrollViewportBottom(page);
    const bottomOffset = safeAreaBottom + await scrollViewportBottomPadding(page);

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
    expect(inputBox && composerBox ? inputBox.width >= composerBox.width - 140 : false).toBe(true);
    expect(addBox?.width).toBeGreaterThanOrEqual(44);
    expect(sendBox?.width).toBeGreaterThanOrEqual(44);
    expect(composerBox!.y + composerBox!.height).toBeGreaterThanOrEqual(scrollBottom - bottomOffset - 1);
    expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(scrollBottom - bottomOffset + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

  test('keeps the intro centered in the upper zone and pins the composer to the bottom at 390px', async ({ page }) => {
    const viewport = { width: 390, height: 844 };
    await page.setViewportSize(viewport);
    await page.goto('/');
    const safeAreaBottom = await bottomSafeAreaInset(page);
    const scrollBottom = await scrollViewportBottom(page);
    const bottomOffset = safeAreaBottom + await scrollViewportBottomPadding(page);

    const heading = page.locator('.origin-app main h1').first();
    const description = page.locator('.origin-app main h1 + p').first();
    const composer = page.locator('.origin-composer');

    await expect(page.getByTestId('origin-core-logo')).toHaveCount(0);
    await expect(heading).toBeVisible();
    await expect(description).toBeVisible();
    await expect(composer).toBeVisible();

    const headingBox = await heading.boundingBox();
    const descriptionBox = await description.boundingBox();
    const composerBox = await composer.boundingBox();

    expect(headingBox).not.toBeNull();
    expect(descriptionBox).not.toBeNull();
    expect(composerBox).not.toBeNull();

    expect(headingBox!.y).toBeGreaterThan(80);
    expect(headingBox!.y).toBeLessThan(viewport.height * 0.55);
    expect(descriptionBox!.y + descriptionBox!.height).toBeLessThan(composerBox!.y);
    expect(composerBox!.y - (descriptionBox!.y + descriptionBox!.height)).toBeLessThanOrEqual(viewport.height * 0.30);
    expect(composerBox!.y + composerBox!.height).toBeGreaterThanOrEqual(scrollBottom - bottomOffset - 1);
    expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(scrollBottom - bottomOffset + 1);
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
