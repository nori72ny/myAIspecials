import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet-portrait', width: 834, height: 1112 },
  { name: 'tablet-landscape', width: 1194, height: 834 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

const EXTENDED_VIEWPORTS = [
  { name: 'mobile-320', width: 320, height: 568 },
  { name: 'mobile-375', width: 375, height: 667 },
  { name: 'large-phone-landscape', width: 844, height: 390 },
  { name: 'laptop-1280', width: 1280, height: 720 },
  { name: 'full-hd', width: 1920, height: 1080 },
  { name: 'zoom-200-equivalent', width: 640, height: 720 },
] as const;

const PROVIDER_CREDENTIAL_SAMPLES = [
  { name: 'aws', value: ['AKIA', '1234567890ABCDEF'].join('') },
  { name: 'github', value: ['ghp_', 'abcdefghijklmnopqrstuvwx'].join('') },
  { name: 'google', value: ['AIza', 'abcdefghijklmnopqrstuvwxyz123456'].join('') },
  { name: 'slack', value: ['xoxb-', '1234567890-abcdefghijkl'].join('') },
  { name: 'stripe', value: ['sk_live_', 'abcdefghijklmnop1234'].join('') },
] as const;

async function openV2Planner(page: import('@playwright/test').Page) {
  await page.goto('/?delegationV2=1');
  await page.getByTestId('multi-ai-planner-v2-open').click();
  const dialog = page.getByRole('dialog', { name: 'AI作業振り分け' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function createSecurityDecision(page: import('@playwright/test').Page) {
  await page.getByLabel('依頼内容').fill('認証処理の脆弱性、秘密情報の露出、権限昇格リスクを確認してください');
  await page.getByRole('button', { name: '担当と確認方法を判定' }).click();
}

async function expectNoSeriousAccessibilityViolations(page: import('@playwright/test').Page) {
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
}

for (const viewport of VIEWPORTS) {
  test(`delegation v2 presents a localized usable result on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const dialog = await openV2Planner(page);
    await expect(page.getByLabel('依頼内容')).toBeFocused();

    await createSecurityDecision(page);

    const decisionSummary = dialog.getByTestId('delegation-decision-summary');
    await expect(decisionSummary.getByText('セキュリティレビュー担当AI', { exact: true })).toBeVisible();
    await expect(decisionSummary.getByText('セキュリティ確認', { exact: true })).toBeVisible();
    await expect(decisionSummary.getByText('独立レビュー担当AI', { exact: true })).toBeVisible();
    await expect(decisionSummary.getByTestId('selection-reason')).toContainText('認証・権限・秘密情報');
    await expect(decisionSummary).not.toContainText('security-review-assistant');
    await expect(decisionSummary).not.toContainText('Security Review Assistant');
    await expect(decisionSummary).not.toContainText('>security<');

    const instruction = dialog.getByLabel('委譲指示');
    await expect(instruction).toContainText('担当 (role): セキュリティレビュー担当AI');
    await expect(instruction).toContainText('タスク種別 (task_type): セキュリティ確認');
    await expect(instruction).toContainText('安全上の必須事項と禁止事項');
    await expect(instruction).not.toContainText('Security Review Assistant');
    await expect(instruction).not.toContainText('Task type: security');

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);

    await expectNoSeriousAccessibilityViolations(page);

    await testInfo.attach(`delegation-v2-${viewport.name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    if (viewport.name === 'mobile') {
      const copyButton = dialog.getByRole('button', { name: '指示をコピー' });
      await copyButton.scrollIntoViewIfNeeded();
      await expect(copyButton).toBeVisible();
      await expect(dialog.getByRole('button', { name: /ローカル監査履歴/ })).toBeVisible();
      await testInfo.attach('delegation-v2-mobile-actions', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    }
  });
}

for (const viewport of EXTENDED_VIEWPORTS) {
  test(`delegation v2 reflows without clipping on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const dialog = await openV2Planner(page);
    await createSecurityDecision(page);

    await expect(dialog.getByLabel('委譲指示')).toContainText('担当 (role): セキュリティレビュー担当AI');
    await expect(dialog.getByLabel('委譲指示')).not.toContainText('Security Review Assistant');

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

    const copyButton = dialog.getByRole('button', { name: '指示をコピー' });
    await copyButton.scrollIntoViewIfNeeded();
    await expect(copyButton).toBeVisible();
    await expect(dialog.getByRole('button', { name: /ローカル監査履歴/ })).toBeVisible();

    await expectNoSeriousAccessibilityViolations(page);

    await testInfo.attach(`delegation-v2-${viewport.name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
}

test('delegation v2 traps forward and reverse tab navigation inside the dialog', async ({ page }) => {
  const dialog = await openV2Planner(page);
  const closeButton = dialog.getByRole('button', { name: '閉じる' });
  const historyButton = dialog.getByRole('button', { name: /ローカル監査履歴/ });

  await closeButton.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(historyButton).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(closeButton).toBeFocused();
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
});

test('delegation v2 remains usable with reduced motion requested', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await openV2Planner(page);
  expect(await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

  await createSecurityDecision(page);
  await expect(dialog.getByTestId('delegation-decision-summary')).toBeVisible();
  const copyButton = dialog.getByRole('button', { name: '指示をコピー' });
  await copyButton.scrollIntoViewIfNeeded();
  await expect(copyButton).toBeVisible();
  await expect(dialog.getByRole('button', { name: /ローカル監査履歴/ })).toBeVisible();

  await testInfo.attach('delegation-v2-reduced-motion', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('delegation v2 records result, verification, and elapsed time', async ({ page }) => {
  const dialog = await openV2Planner(page);

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
  const dialog = await openV2Planner(page);

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
  await expect(dialog.getByLabel('委譲指示')).toContainText('目的 (goal): [REDACTED]');
  await expect(dialog.getByLabel('委譲指示')).not.toContainText('sample-private-value');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

for (const sample of PROVIDER_CREDENTIAL_SAMPLES) {
  test(`delegation v2 removes ${sample.name} credential values from instructions and audit storage`, async ({ page }) => {
    const dialog = await openV2Planner(page);
    await page.getByLabel('依頼内容').fill(sample.value);
    await expect(dialog.getByTestId('secret-redaction-warning-v2')).toBeVisible();

    await page.getByRole('button', { name: '担当と確認方法を判定' }).click();
    const instruction = dialog.getByLabel('委譲指示');
    await expect(instruction).toContainText('目的 (goal): [REDACTED]');
    await expect(instruction).not.toContainText(sample.value);

    const storedHistory = await page.evaluate(() => window.localStorage.getItem('acos.multi-ai.delegation-audit.v1') ?? '');
    expect(storedHistory).toContain('[REDACTED]');
    expect(storedHistory).not.toContain(sample.value);
  });
}

test('delegation v2 stays hidden on the normal URL until explicitly enabled', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('multi-ai-planner-open')).toBeVisible();
  await expect(page.getByTestId('multi-ai-planner-v2-open')).toHaveCount(0);
});
