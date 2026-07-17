import { test, expect } from '@playwright/test';

async function openPlanner(page: import('@playwright/test').Page) {
  const opener = page.getByTestId('multi-ai-planner-open');
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'AI作業振り分け' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('依頼内容')).toBeFocused();
  return { opener, dialog };
}

test.describe('Sprint 8.3 external accessibility review regressions', () => {
  test('uses one assertive alert when clipboard access fails', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => { throw new DOMException('denied', 'NotAllowedError'); } },
      });
    });

    await page.goto('/');
    const { dialog } = await openPlanner(page);
    await page.getByLabel('依頼内容').fill('新しいAPIを実装してください');
    await page.getByRole('button', { name: '担当AIと検証方法を判定' }).click();
    await page.getByRole('button', { name: '指示をコピー' }).click();

    await expect(dialog.getByRole('alert')).toHaveCount(1);
    await expect(dialog.getByRole('alert')).toHaveText('クリップボードへのコピーに失敗しました。指示を選択して手動でコピーしてください。');
  });

  test('announces secret redaction as a polite status', async ({ page }) => {
    await page.goto('/');
    const { dialog } = await openPlanner(page);
    await page.getByLabel('依頼内容').fill('Authorization: Bearer sample-private-value');

    const warning = dialog.getByTestId('secret-redaction-warning');
    await expect(warning).toHaveAttribute('role', 'status');
    await expect(warning).toHaveAttribute('aria-live', 'polite');
  });

  test('traps Tab focus inside the dialog and restores the opener on Escape', async ({ page }) => {
    await page.goto('/');
    const { opener, dialog } = await openPlanner(page);

    const closeButton = dialog.getByRole('button', { name: '閉じる' });
    const historyButton = page.getByRole('button', { name: 'ローカル監査履歴 (0)' });

    await closeButton.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(historyButton).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(closeButton).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('distinguishes audit read failure from write failure wording', async ({ page }) => {
    await page.addInitScript(() => {
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function getItem(key: string) {
        if (key === 'acos.multi-ai.delegation-audit.v1') throw new DOMException('denied', 'SecurityError');
        return original.call(this, key);
      };
    });

    await page.goto('/');
    const { dialog } = await openPlanner(page);
    await expect(dialog.getByTestId('audit-storage-warning')).toContainText('監査履歴を読み込めませんでした');
    await expect(dialog.getByTestId('audit-storage-warning')).not.toContainText('保存できません');
  });
});
