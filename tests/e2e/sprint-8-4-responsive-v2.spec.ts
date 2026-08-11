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
  { name: 'compact-desktop-640', width: 640, height: 720 },
] as const;

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

for (const viewport of VIEWPORTS) {
  test(`Personal release reflows without clipping on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /考えがまとまる前から、始められます。|Start before your thoughts are fully formed\./i })).toBeVisible({ timeout: 15_000 });
    const homeInput = page.getByRole('textbox', { name: /やりたいことを入力|Describe what you want help with/i });
    await expect(homeInput).toBeVisible();
    const homeInputBox = await homeInput.boundingBox();
    expect(homeInputBox).not.toBeNull();
    expect(homeInputBox!.y).toBeLessThan(viewport.height - 44);
    await expectNoHorizontalOverflow(page);
    await page.waitForTimeout(250);
    await testInfo.attach(`personal-home-${viewport.name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    if (viewport.width < 1024) {
      await page.getByTestId('compact-chat-button').click();
    } else {
      await page.getByTestId('nav-chat').click();
    }

    const input = page.getByRole('textbox', { name: /ORIGINへの依頼|Request to ORIGIN/i });
    await expect(input).toBeVisible();
    await expect(page.getByRole('button', { name: /依頼を送信|Send request/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.waitForTimeout(250);
    await testInfo.attach(`personal-chat-${viewport.name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    await page.getByRole('main').getByRole('button', { name: /設定を開く|Open settings/i }).click();
    const dialog = page.getByRole('dialog', { name: /設定|Settings/i });
    const modal = dialog.getByTestId('settings-modal');
    const scrollRegion = dialog.getByTestId('settings-scroll-region');
    await expect(dialog).toBeVisible();
    await expect(modal).toHaveCSS('opacity', '1');

    const box = await modal.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

    await scrollRegion.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(dialog.getByText(/安全と費用|Safety and cost/)).toBeVisible();
    await expect(dialog.getByText(/リリースID|Release ID/)).toBeVisible();
    await expect(dialog.getByTestId('release-sha-value')).toContainText(`${E2E_RELEASE_SHA.slice(0, 12)}…`);
    await dialog.getByRole('button', { name: /全文を表示|Show full ID/i }).click();
    await expect(dialog.getByTestId('release-sha-value')).toHaveText(E2E_RELEASE_SHA);
    await expect(dialog.getByRole('button', { name: /^(閉じる|Close)$/ })).toBeVisible();

    const accessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(accessibility.violations.filter((item) => ['critical', 'serious', 'moderate'].includes(item.impact ?? ''))).toEqual([]);

    await testInfo.attach(`personal-release-${viewport.name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
}

test('Personal release remains usable with reduced motion requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  expect(await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await expect(page.getByRole('heading', { name: /考えがまとまる前から、始められます。|Start before your thoughts are fully formed\./i })).toBeVisible();
  await page.getByTestId('compact-chat-button').click();
  await expect(page.getByRole('textbox', { name: /ORIGINへの依頼|Request to ORIGIN/i })).toBeVisible();
});

test('Personal home keeps the C+ hierarchy in dark mode on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.getByRole('main').getByRole('button', { name: /設定を開く|Open settings/i }).click();
  const dialog = page.getByRole('dialog', { name: /設定|Settings/i });
  await dialog.getByRole('button', { name: /暗い|Dark/i }).click();
  await dialog.getByRole('button', { name: /設定を閉じる|Close settings/i }).click();
  await expect(dialog).toBeHidden();

  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByRole('heading', { name: /考えがまとまる前から、始められます。|Start before your thoughts are fully formed\./i })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await testInfo.attach('personal-home-mobile-390-dark', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});


const RESULT_VIEWPORTS = VIEWPORTS;

for (const viewport of RESULT_VIEWPORTS) {
  test(`Personal answer reads as a working document on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.route('**/api/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content: '比較結果を整理しました。',
          answer: {
            schemaVersion: 'origin.answer.v1',
            language: 'ja',
            conclusion: 'まずは条件を三つに絞ると、判断しやすくなります。',
            answer: '費用、使いやすさ、継続性の順で候補を比較してください。',
            evidence: [],
            verification: {
              status: 'not-required',
              independentReviewPerformed: false,
              summary: 'この回答では追加の独立確認を必須としていません。',
            },
            limitations: [],
            nextActions: ['候補ごとの条件を入力し、同じ基準で比較する。'],
            richOutputs: [],
          },
          routing: {
            model: 'ORIGIN 無料AI',
            reason: '無料条件を満たす固定モデルを使用しました。',
            timeMs: 85,
            actualCostUsd: 0,
            freeOnly: true,
            verificationStatus: 'not-required',
          },
        }),
      });
    });

    await page.goto('/');
    if (viewport.width < 1024) {
      await page.getByTestId('compact-chat-button').click();
    } else {
      await page.getByTestId('nav-chat').click();
    }

    const input = page.getByRole('textbox', { name: /ORIGINへの依頼|Request to ORIGIN/i });
    await input.fill('二つの候補を比較して、次にやることを決めたい');
    await page.getByRole('button', { name: /依頼を送信|Send request/i }).click();

    await expect(page.getByRole('article', { name: /ORIGINの回答|ORIGIN answer/i })).toBeVisible();
    await expect(page.getByTestId('answer-conclusion')).toBeInViewport();
    await expect(page.getByTestId('answer-next-actions')).toBeVisible();
    await expect(page.getByTestId('execution-details')).toContainText(/無料で回答しました|Answered for free/i);
    await expectNoHorizontalOverflow(page);
    await page.waitForTimeout(300);

    await testInfo.attach(`personal-answer-${viewport.name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
}
