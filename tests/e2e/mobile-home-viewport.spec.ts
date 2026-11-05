import { expect, test } from '@playwright/test';

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
  { name: '360x800', width: 360, height: 800 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`mobile home keeps the add button visible without scrolling at ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');

    await expect(page.getByTestId('origin-core-logo')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: '今日は何をしますか？' })).toBeVisible();
    const composer = page.locator('.origin-app main .origin-composer').last();
    const addButton = page.getByTestId('origin-add-menu-toggle');
    await expect(composer).toBeVisible();
    await expect(addButton).toBeVisible();
    await expect(addButton).toBeInViewport();

    const geometry = await page.evaluate(() => {
      const header = document.querySelector('.origin-header')?.getBoundingClientRect();
      const logo = document.querySelector('[data-testid="origin-core-logo"]')?.getBoundingClientRect();
      const form = document.querySelector('.origin-app main .origin-composer')?.getBoundingClientRect();
      const add = document.querySelector('[data-testid="origin-add-menu-toggle"]')?.getBoundingClientRect();
      return {
        viewportHeight: window.innerHeight,
        headerBottom: header?.bottom ?? 0,
        logoTop: logo?.top ?? 0,
        composerBottom: form?.bottom ?? Number.POSITIVE_INFINITY,
        addBottom: add?.bottom ?? Number.POSITIVE_INFINITY,
        scrollTop: document.querySelector('.origin-app main > div.min-h-0.flex-1.overflow-y-auto')?.scrollTop ?? -1,
      };
    });

    expect(geometry.logoTop).toBeGreaterThan(geometry.headerBottom + 40);
    expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.viewportHeight - 1);
    expect(geometry.addBottom).toBeLessThanOrEqual(geometry.viewportHeight - 1);
    expect(geometry.scrollTop).toBe(0);

    await testInfo.attach(`mobile-home-${viewport.name}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}
