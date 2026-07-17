import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet-portrait', width: 834, height: 1112 },
  { name: 'tablet-landscape', width: 1194, height: 834 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`delegation v2 presents a localized usable result on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?delegationV2=1');

    await page.getByTestId('multi-ai-planner-v2-open').click();
    const dialog = page.getByRole('dialog', { name: 'AI作業振り分け' });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel('依頼内容')).toBeFocused();

    await page.getByLabel('依頼内容').fill('認証処理の脆弱性、秘密情報の露出、権限昇格リスクを確認してください');
    await page.getByRole('button', { name: '担当と確認方法を判定' }).click();

    const decisionSummary = dialog.getByTestId('delegation-decision-summary');
    await expect(decisionSummary.getByText('セキュリティレビュー担当AI', { exact: true })).toBeVisible();
    await expect(decisionSummary.getByText('セキュリティ確認', { exact: true })).toBeVisible();
    await expect(decisionSummary.getByText('独立レビュー担当AI', { exact: true })).toBeVisible();
    await expect(decisionSummary.getByTestId('selection-reason')).toContainText('認証・権限・秘密情報');
    await expect(decisionSummary).not.toContainText('security-review-assistant');
    await expect(decisionSummary).not.toContainText('Security Review Assistant');
    await expect(decisionSummary).not.toContainText('>security<');

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);

    const accessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);

    await testInfo.attach(`delegation-v2-${viewport.name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
}

test('delegation v2 records result, verification, and elapsed time', async ({ page }) => {
  await page.goto('/?delegationV2=1');
  await page.getByTestId('multi-ai-planner-v2-open').click();
  const dialog = page.getByRole('dialog', { name: 'AI作業振り分け' });

  await page.getByLabel('依頼内容').fill('認証処理のセキュリティレビューをしてください');
  await page.getByRole('button', { name: '担当と確認方法を判定' }).click();
  await dialog.getByRole('button', { name: /ローカル監査履歴/ }).click();
  await dialog.getByRole('button', { name: '結果・検証を記録' }).click();

  await dialog.getByLabel('結果').selectOption('changes-required');
  await dialog.getByLabel('検証').selectOption('failed');
  await dialog.getByLabel('所要時間（秒）').fill('42');
  await dialog.getByRole('button', { name: '結果を保存' }).click();

  await expect(dialog.getByText('結果: 要修正', { exact: true })).toBeVisible();
  await expect(dialog.getByText('検証失敗', { exact: true })).toBeVisible();
  await expect(dialog.getByText('42秒', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText('結果と検証状況を保存しました');

  await dialog.getByRole('button', { name: '結果・検証を記録' }).click();
  await expect(dialog.getByLabel('結果')).toHaveValue('changes-required');
  await expect(dialog.getByLabel('検証')).toHaveValue('failed');
  await expect(dialog.getByLabel('所要時間（秒）')).toHaveValue('42');
});

test('delegation v2 rejects invalid elapsed seconds without a persistence claim', async ({ page }) => {
  await page.goto('/?delegationV2=1');
  await page.getByTestId('multi-ai-planner-v2-open').click();
  const dialog = page.getByRole('dialog', { name: 'AI作業振り分け' });

  await page.getByLabel('依頼内容').fill('画面の使い勝手を確認してください');
  await page.getByRole('button', { name: '担当と確認方法を判定' }).click();
  await dialog.getByRole('button', { name: /ローカル監査履歴/ }).click();
  await dialog.getByRole('button', { name: '結果・検証を記録' }).click();
  await dialog.getByLabel('所要時間（秒）').fill('-1');
  await dialog.getByRole('button', { name: '結果を保存' }).click();

  await expect(dialog.getByRole('alert')).toHaveText('所要時間は0以上の整数秒で入力してください。');
  await expect(dialog.getByRole('button', { name: '結果を保存' })).toBeVisible();
});

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

test('delegation v2 stays hidden on the normal URL until explicitly enabled', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('multi-ai-planner-open')).toBeVisible();
  await expect(page.getByTestId('multi-ai-planner-v2-open')).toHaveCount(0);
});
