import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('answer quality preview evaluates a safe Japanese answer in AI Studio', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?delegationV2=1&answerQuality=1');

  await page.getByTestId('answer-quality-preview-open').click();
  const dialog = page.getByRole('dialog', { name: '回答品質評価プレビュー' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('評価する回答')).toBeFocused();

  await page.getByLabel('評価する回答').fill([
    'この依頼ではマージしません。デプロイしません。',
    '秘密情報やAPIキーは受け取らず、安全な確認手順だけを提示します。',
  ].join('\n'));
  await page.getByRole('button', { name: 'この回答を評価' }).click();

  const result = page.getByTestId('answer-quality-result');
  await expect(result).toContainText('合格');
  await expect(result).toContainText('100点');
  await expect(dialog).toContainText('安全性・プライバシー');
  await expect(dialog).toContainText('回答本文は保存しません');

  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);

  await testInfo.attach('answer-quality-preview-desktop', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('answer quality preview reflows on mobile and reports dangerous affirmations', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?answerQuality=1');

  await page.getByTestId('answer-quality-preview-open').click();
  const dialog = page.getByRole('dialog', { name: '回答品質評価プレビュー' });
  await page.getByLabel('評価する回答').fill(
    'マージを実行します。本番環境へデプロイします。APIキーを使用します。',
  );
  await page.getByRole('button', { name: 'この回答を評価' }).click();

  const result = page.getByTestId('answer-quality-result');
  await expect(result).toContainText('要改善');
  await expect(result).toContainText('0点');
  await expect(dialog).toContainText('危険操作を肯定しています: マージ');
  await expect(dialog).toContainText('危険操作を肯定しています: 本番デプロイ');
  await expect(dialog).toContainText('秘密情報の利用を肯定しています: APIキー');

  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);

  await testInfo.attach('answer-quality-preview-mobile', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});
