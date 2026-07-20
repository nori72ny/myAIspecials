import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const INTERNAL_PROVIDER_IDS = [
  'ai-studio-primary',
  'external-review',
  'security-review-assistant',
  'research-assistant',
  'openrouter-free',
  'human-approval-gate',
];

async function openDelegationPlanner(page: import('@playwright/test').Page) {
  await page.getByTestId('multi-ai-planner-open').click();
  const dialog = page.getByRole('dialog', { name: 'AI作業振り分け' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('ORIGIN Personal Edition critical journey', () => {
  test('opens the personal dashboard and navigates to Unified Chat', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /何を実現したいですか？|What would you like to achieve\?/i })).toBeVisible({ timeout: 15_000 });

    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);

    await page.getByTestId('nav-chat').click();
    await expect(page.getByText(/こんにちは。ORIGIN Personalです|Hello! I am ORIGIN Personal/i)).toBeVisible({ timeout: 15_000 });

    const chatInput = page.getByPlaceholder(/ORIGINにメッセージを入力|Message ORIGIN/i);
    await expect(chatInput).toBeVisible();
    await expect(chatInput).toBeEditable();
  });

  test('opens the truthful ORIGIN execution-policy settings', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /ユーザー設定|User Settings/i }).click();
    const settingsDialog = page.getByRole('dialog', { name: /ORIGIN Personal 設定|ORIGIN Personal Settings/i });
    await expect(settingsDialog).toBeVisible();
    await expect(page.getByTestId('settings-modal')).toBeVisible();
    await expect(page.getByTestId('origin-execution-policy')).toContainText(/無料限定ルール内でORIGINが自動選択します|ORIGIN selects automatically within free-only rules/i);
    await expect(settingsDialog).toContainText('$0.00');
    await expect(settingsDialog).not.toContainText('GeminiとOpenAIが連動動作します。');
    await page.getByTestId('close-settings-button').click();
    await expect(settingsDialog).toBeHidden();
  });

  test('starts a clean Unified Chat session from New Chat', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-chat').click();
    const chatInput = page.getByPlaceholder(/ORIGINにメッセージを入力|Message ORIGIN/i);
    await chatInput.fill('This draft must be cleared');
    await expect(chatInput).toHaveValue('This draft must be cleared');
    await page.getByTestId('new-chat-button').click();
    await expect(chatInput).toHaveValue('');
    await expect(page.getByText(/こんにちは。ORIGIN Personalです|Hello! I am ORIGIN Personal/i)).toBeVisible();
  });

  test('shows the home screen first and keeps navigation usable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const sidebar = page.locator('aside').first();
    const openSidebarButton = page.getByRole('button', { name: /サイドバーを開く|Open sidebar/i });

    await expect(page.getByRole('heading', { name: /何を実現したいですか？|What would you like to achieve\?/i })).toBeVisible();
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
    await expect(openSidebarButton).toBeVisible();

    await openSidebarButton.click();
    await expect(sidebar).toHaveCSS('width', '260px');
    await expect(page.getByTestId('new-chat-button')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
    await expect(openSidebarButton).toBeVisible();

    await openSidebarButton.click();
    await expect(sidebar).toHaveCSS('width', '260px');
    await page.getByTestId('nav-chat').click();
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
    await expect(openSidebarButton).toBeVisible();
    await expect(page.getByPlaceholder(/ORIGINにメッセージを入力|Message ORIGIN/i)).toBeVisible();
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
    for (const providerId of INTERNAL_PROVIDER_IDS) await expect(dialog).not.toContainText(providerId);

    const instruction = dialog.locator('pre');
    await expect(instruction).toContainText('担当 (role): 実装・開発担当AI');
    await expect(instruction).toContainText('選定理由 (selection_reason):');
    await expect(instruction).toContainText('安全上の必須事項と禁止事項 (safety_mandates):');
    await expect(instruction).toHaveCSS('white-space', 'pre-wrap');

    const instructionText = await instruction.innerText();
    expect(instructionText.split('\n').length).toBeGreaterThanOrEqual(12);
    expect(instructionText).toContain('\n- コードをマージしないでください。\n');
    expect(instructionText).toContain('\n- コードやサービスをデプロイしないでください。\n');

    const providerName = dialog.getByText('AI Studio Primary', { exact: true });
    expect(Number.parseFloat(await providerName.evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    expect(Number.parseFloat(await dialog.getByTestId('selection-reason').evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);
    expect(Number.parseFloat(await instruction.evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);

    const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);

    await testInfo.attach('delegation-planner-desktop.png', { body: await dialog.screenshot(), contentType: 'image/png' });
  });

  test('redacts a secret-bearing goal from instructions and local audit history', async ({ page }, testInfo) => {
    const privateValue = ['sample', 'private', 'value'].join('-');
    const goal = `Authorization: Bearer ${privateValue}`;
    await page.goto('/');
    const dialog = await openDelegationPlanner(page);
    await page.getByLabel('依頼内容').fill(goal);
    await expect(dialog.getByTestId('secret-redaction-warning')).toBeVisible();
    await page.getByRole('button', { name: '担当AIと検証方法を判定' }).click();

    const instruction = dialog.locator('pre');
    await expect(instruction).toContainText('目的 (goal): [REDACTED]');
    await expect(instruction).not.toContainText(privateValue);

    const stored = await page.evaluate(() => window.localStorage.getItem('acos.multi-ai.delegation-audit.v1'));
    expect(stored).not.toContain(privateValue);
    expect(stored).toContain('[REDACTED]');

    await testInfo.attach('sprint-8-3-secret-redaction.png', { body: await dialog.screenshot(), contentType: 'image/png' });
  });

  test('continues planning and warns when local storage writes are denied', async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key: string, value: string) {
        if (key === 'acos.multi-ai.delegation-audit.v1') throw new DOMException('denied', 'SecurityError');
        return original.call(this, key, value);
      };
    });

    await page.goto('/');
    const dialog = await openDelegationPlanner(page);
    await page.getByLabel('依頼内容').fill('新しいAPIを実装してください');
    await page.getByRole('button', { name: '担当AIと検証方法を判定' }).click();

    await expect(dialog.getByText('AI Studio Primary', { exact: true })).toBeVisible();
    await expect(dialog.getByTestId('audit-storage-warning')).toContainText('監査履歴を保存できません');
    await expect(dialog.locator('pre')).toContainText('担当 (role): 実装・開発担当AI');

    await testInfo.attach('sprint-8-3-storage-denied.png', { body: await dialog.screenshot(), contentType: 'image/png' });
  });

  test('announces clipboard success accessibly', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => undefined },
      });
    });

    await page.goto('/');
    const dialog = await openDelegationPlanner(page);
    await page.getByLabel('依頼内容').fill('新しいAPIを実装してください');
    await page.getByRole('button', { name: '担当AIと検証方法を判定' }).click();
    await page.getByRole('button', { name: '指示をコピー' }).click();
    await expect(dialog.getByRole('status')).toContainText('委譲指示をコピーしました。');
  });
});
