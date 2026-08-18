import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { E2E_RELEASE_SHA } from './release-fixture';

const VIEWPORTS = [
  { name: 'mobile-320', width: 320, height: 568 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 834, height: 1112 },
  { name: 'large-phone-landscape', width: 844, height: 390 },
  { name: 'laptop', width: 1280, height: 720 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

for (const viewport of VIEWPORTS) {
  test(`Personal 2.0 home reflows without clipping on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');

    await expect(page.getByTestId('origin-core-logo')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Personal 2.0', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '何を実現したいですか？' })).toBeVisible();
    await expect(page.getByTestId('origin-home-request')).toBeVisible();
    await expect(page.getByTestId(/^starter-/)).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await testInfo.attach(`personal-2-home-${viewport.name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
}

test('Personal 2.0 opens a renderable artifact workspace without overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: '成果物を準備しました。\n```html:report.html\n<h1>ORIGIN report</h1><p>Preview content</p>\n```',
    });
  });
  await page.goto('/');
  await page.getByTestId('origin-home-request').fill('レポートを作成したい');
  await page.getByTestId('start-request-button').click();

  const workspace = page.getByTestId('artifact-workspace');
  await expect(workspace).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'プレビューを表示' }).click();
  await expect(workspace.getByTitle('プレビュー')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await testInfo.attach('personal-2-artifact-workspace', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('Personal 2.0 preserves the release settings dialog and SHA control', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '設定を開く' }).click();

  const dialog = page.getByRole('dialog', { name: /設定|Settings/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('release-sha-value')).toContainText(`${E2E_RELEASE_SHA.slice(0, 12)}…`);
  await dialog.getByRole('button', { name: /全文を表示|Show full ID/i }).click();
  await expect(dialog.getByTestId('release-sha-value')).toHaveText(E2E_RELEASE_SHA);

  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(accessibility.violations.filter((item) => ['critical', 'serious', 'moderate'].includes(item.impact ?? ''))).toEqual([]);
});
