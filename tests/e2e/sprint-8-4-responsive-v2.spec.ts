import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet-portrait', width: 834, height: 1112 },
  { name: 'tablet-landscape', width: 1194, height: 834 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`delegation v2 presents a localized usable result on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?delegationV2=1');

    await page.getByTestId('multi-ai-planner-v2-open').click();
    const dialog = page.getByRole('dialog', { name: 'AI作業振り分け' });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel('依頼内容')).toBeFocused();

    await page.getByLabel('依頼内容').fill('認証処理のセキュリティと権限設計を確認してください');
    await page.getByRole('button', { name: '担当と確認方法を判定' }).click();

    await expect(dialog.getByText('セキュリティレビュー担当AI', { exact: true })).toBeVisible();
    await expect(dialog.getByText('セキュリティ確認', { exact: true })).toBeVisible();
    await expect(dialog.getByText('独立レビュー担当AI', { exact: true })).toBeVisible();
    await expect(dialog.getByTestId('selection-reason-v2')).toContainText('認証・権限・秘密情報');
    await expect(dialog).not.toContainText('security-review-assistant');
    await expect(dialog).not.toContainText('Security Review Assistant');
    await expect(dialog).not.toContainText('>security<');

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);

    const accessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
  });
}

test('delegation v2 redacts synthetic secret-bearing input and restores focus', async ({ page }) => {
  await page.goto('/?delegationV2=1');
  const opener = page.getByTestId('multi-ai-planner-v2-open');
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'AI作業振り分け' });

  await page.getByLabel('依頼内容').fill('Authorization: Bearer sample-private-value');
  await expect(dialog.getByTestId('secret-redaction-warning-v2')).toBeVisible();
  await page.getByRole('button', { name: '担当と確認方法を判定' }).click();
  await expect(dialog.getByLabel('委譲指示')).toContainText('Goal: [REDACTED]');
  await expect(dialog.getByLabel('委譲指示')).not.toContainText('sample-private-value');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});
