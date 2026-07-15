import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function openDelegationPlanner(page: import('@playwright/test').Page) {
  await page.getByTestId('multi-ai-planner-open').click();
  const dialog = page.getByRole('dialog', { name: 'AI作業振り分け' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('ACOS 2.0 Personal Edition critical journey', () => {
  test('opens the personal dashboard and navigates to Unified Chat', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'What can I help you with today?' })
    ).toBeVisible({ timeout: 15_000 });

    const accessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const blockingViolations = accessibility.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact ?? '')
    );
    expect(blockingViolations).toEqual([]);

    await page.getByTestId('nav-chat').click();

    await expect(
      page.getByText(/こんにちは！ACOS統合AIです|Hello! I am ACOS Unified AI/i)
    ).toBeVisible({ timeout: 15_000 });

    const chatInput = page.getByPlaceholder(/ACOSにメッセージを入力|Message ACOS/i);
    await expect(chatInput).toBeVisible();
    await expect(chatInput).toBeEditable();
  });

  test('opens and closes real settings from Personal Edition', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /ユーザー設定|User Settings/i }).click();

    const settingsDialog = page.getByRole('dialog', {
      name: /システム環境 & 各種AI設定管理|System Preferences & Hardware Config/i,
    });
    await expect(settingsDialog).toBeVisible();
    await expect(page.getByTestId('settings-modal')).toBeVisible();

    await page.getByTestId('close-settings-button').click();
    await expect(settingsDialog).toBeHidden();
  });

  test('starts a clean Unified Chat session from New Chat', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-chat').click();

    const chatInput = page.getByPlaceholder(/ACOSにメッセージを入力|Message ACOS/i);
    await chatInput.fill('This draft must be cleared');
    await expect(chatInput).toHaveValue('This draft must be cleared');

    await page.getByTestId('new-chat-button').click();

    await expect(chatInput).toHaveValue('');
    await expect(
      page.getByText(/こんにちは！ACOS統合AIです|Hello! I am ACOS Unified AI/i)
    ).toBeVisible();
  });

  test('keeps the primary navigation usable on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const sidebar = page.locator('aside').first();
    const newChatButton = page.getByTestId('new-chat-button');
    await expect(newChatButton).toBeVisible();
    await expect(sidebar).toHaveCSS('width', '260px');

    const closeSidebarButton = page.getByRole('button', {
      name: /サイドバーを閉じる|Close sidebar/i,
    });
    await closeSidebarButton.click();
    await expect
      .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
      .toBeLessThanOrEqual(1);

    const openSidebarButton = page.getByRole('button', {
      name: /サイドバーを開く|Open sidebar/i,
    });
    await expect(openSidebarButton).toBeVisible();
    await openSidebarButton.click();
    await expect(sidebar).toHaveCSS('width', '260px');
    await expect(newChatButton).toBeVisible();

    await page.keyboard.press('Escape');
    await expect
      .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
      .toBeLessThanOrEqual(1);
    await expect(openSidebarButton).toBeVisible();

    await openSidebarButton.click();
    await expect(sidebar).toHaveCSS('width', '260px');

    await page.getByTestId('nav-chat').click();
    await expect
      .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
      .toBeLessThanOrEqual(1);
    await expect(openSidebarButton).toBeVisible();
    await expect(
      page.getByPlaceholder(/ACOSにメッセージを入力|Message ACOS/i)
    ).toBeVisible();
  });
});

test.describe('Multi-AI delegation planner presentation', () => {
  test('shows an understandable primary selection and preserves instruction line breaks', async ({ page }, testInfo) => {
    await page.goto('/');
    const dialog = await openDelegationPlanner(page);

    await page.getByLabel('依頼内容').fill('新しいAPIを実装してください');
    await page.getByRole('button', { name: '担当AIと検証方法を判定' }).click();

    await expect(dialog.getByText('AI Studio Primary', { exact: true })).toBeVisible();
    await expect(dialog.getByTestId('selection-reason')).toHaveText('実装タスクの第一候補で、無料枠が利用可能なため選択しました。');
    await expect(dialog.getByText('実装', { exact: true })).toBeVisible();
    await expect(dialog.getByText('implementation', { exact: true })).toBeVisible();
    await expect(dialog.getByTestId('verification-provider')).toHaveText('External Review Assistant');
    await expect(dialog).not.toContainText('external-review');

    const instruction = dialog.locator('pre');
    await expect(instruction).toContainText('Role: AI Studio Primary');
    await expect(instruction).toContainText('Selection reason:');
    await expect(instruction).toContainText('SAFETY MANDATES & PROHIBITIONS:');
    await expect(instruction).toHaveCSS('white-space', 'pre-wrap');

    const instructionText = await instruction.innerText();
    expect(instructionText.split('\n').length).toBeGreaterThanOrEqual(12);
    expect(instructionText).toContain('\n- Do not merge code.\n');
    expect(instructionText).toContain('\n- Do not deploy code or services.\n');

    const providerName = dialog.getByText('AI Studio Primary', { exact: true });
    const providerFontSize = Number.parseFloat(await providerName.evaluate((element) => getComputedStyle(element).fontSize));
    const bodyFontSize = Number.parseFloat(await dialog.getByTestId('selection-reason').evaluate((element) => getComputedStyle(element).fontSize));
    const instructionFontSize = Number.parseFloat(await instruction.evaluate((element) => getComputedStyle(element).fontSize));
    expect(providerFontSize).toBeGreaterThanOrEqual(16);
    expect(bodyFontSize).toBeGreaterThanOrEqual(14);
    expect(instructionFontSize).toBeGreaterThanOrEqual(14);

    const accessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(accessibility.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);

    await testInfo.attach('delegation-planner-desktop.png', {
      body: await dialog.screenshot(),
      contentType: 'image/png',
    });
  });

  test('fits a 390px mobile viewport without horizontal clipping', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const dialog = await openDelegationPlanner(page);

    await page.getByLabel('依頼内容').fill('認証処理のセキュリティレビューをしてください');
    await page.getByRole('button', { name: '担当AIと検証方法を判定' }).click();
    await expect(dialog.getByText('Security Review Assistant', { exact: true })).toBeVisible();

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

    await testInfo.attach('delegation-planner-mobile.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('keeps text readable in dark mode', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    const dialog = await openDelegationPlanner(page);

    await page.getByLabel('依頼内容').fill('最新情報を調査してください');
    await page.getByRole('button', { name: '担当AIと検証方法を判定' }).click();
    await expect(dialog.getByText('Research Assistant', { exact: true })).toBeVisible();

    const dialogBackground = await dialog.evaluate((element) => getComputedStyle(element).backgroundColor);
    const headingColor = await dialog.getByText('AI作業振り分け', { exact: true }).evaluate((element) => getComputedStyle(element).color);
    expect(dialogBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(headingColor).not.toBe(dialogBackground);

    await testInfo.attach('delegation-planner-dark.png', {
      body: await dialog.screenshot(),
      contentType: 'image/png',
    });
  });
});
