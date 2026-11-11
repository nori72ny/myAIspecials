import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function openSettings(page: import('@playwright/test').Page) {
  const opener = page.getByRole('main').getByRole('button', { name: /設定を開く|Open settings/i });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: /設定|Settings/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('settings-modal')).toHaveCSS('opacity', '1');
  await expect(page.getByTestId('close-settings-button')).toBeFocused();
  return { opener, dialog };
}

async function openConversation(page: import('@playwright/test').Page) {
  await page.getByTestId('origin-home-request').fill('アクセシビリティを確認したい');
  await page.getByTestId('start-request-button').click();
  await expect(page.getByTestId('origin-chat-request')).toBeVisible();
}

test.describe('ORIGIN Personal 2.0 accessibility', () => {
  test('settings dialog traps focus and restores the opener on Escape', async ({ page }) => {
    // リリースIDが「ready」だと、閉じた details 内のボタンがトラップの
    // 末尾要素になり回り込みを決定的に検証できないため、このテストでは
    // 取得失敗（unavailable）の状態に固定する。MCP項目も未構成に固定し、
    // ダイアログ内のフォーカス可能要素を決定的にする。
    await page.route('**/api/health', route => route.abort());
    await page.route('**/api/mcp/status', route => route.fulfill({ json: { configured: false, authenticated: false } }));
    await page.goto('/');
    const { opener, dialog } = await openSettings(page);

    const iconClose = page.getByTestId('close-settings-button');
    // UI監査 #27：ダイアログ下部の重複「閉じる」ボタンは削除され、閉じる
    // 手段は × ボタンに一本化された。× にはアクセス可能な名前
    // （設定を閉じる / Close settings）がある。末尾のフォーカス可能要素は
    // 履歴セクションの「初期化」ボタンになる。
    await expect(iconClose).toHaveAccessibleName(/^(設定を閉じる|Close settings)$/);
    const lastControl = dialog.getByRole('button', { name: /^(初期化|Clear)$/ });

    await iconClose.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(lastControl).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(iconClose).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('settings dialog has no serious automated WCAG violations', async ({ page }) => {
    await page.goto('/');
    const { dialog } = await openSettings(page);

    const accessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
    await expect(dialog).toContainText(/安全と費用|Safety and cost/);
  });

  test('chat input exposes keyboard and secret guidance programmatically', async ({ page }) => {
    await page.route('**/api/chat', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/plain', body: '確認しました。' });
    });
    await page.goto('/');
    await openConversation(page);

    const input = page.getByTestId('origin-chat-request');
    await expect(input).toHaveAttribute('aria-describedby', 'origin-chat-guidance');
    // The guidance must name the primary send shortcut. Since the Enter-to-send
    // change (PR #1102), that is Enter (Shift+Enter inserts a newline);
    // Ctrl/Cmd+Enter remains supported as a legacy alternative.
    await expect(page.locator('#origin-chat-guidance')).toContainText(/Enter/);
    await expect(page.locator('#origin-chat-guidance')).not.toContainText(/パスワードやAPIキー/);
  });

  test('conversation log announces completion without reading the full answer automatically', async ({ page }) => {
    await page.route('**/api/chat', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/plain', body: '天気を確認しました。' });
    });
    await page.goto('/');
    await openConversation(page);

    const log = page.getByRole('log', { name: '会話履歴' });
    await expect(log).toHaveAttribute('aria-live', 'off');
    await expect(log).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByTestId('response-announcement')).toContainText('ORIGINの回答が届きました');
    await expect(page.getByRole('article', { name: 'あなたの依頼' })).toBeVisible();
  });

  test('personal data is blocked locally and announced without an API request', async ({ page }) => {
    let requests = 0;
    await page.route('**/api/chat', async (route) => {
      requests += 1;
      await route.abort();
    });
    await page.goto('/');

    const privateValue = ['nori', '@', 'example.invalid'].join('');
    await page.getByTestId('origin-home-request').fill(`連絡先は ${privateValue} です`);
    await page.getByTestId('start-request-button').click();

    await expect(page.getByText('入力内容は送信せず、履歴にも追加していません。個人・金融・医療・認証情報を削除してください。画像は個人情報が含まれないことを検証できないため、この版では端末外へ送信しません。')).toBeVisible();
    await expect(page.getByTestId('origin-safe-waiting-state')).toHaveAttribute('aria-live', 'assertive');
    await expect(page.getByTestId('origin-home-request')).toHaveValue(`連絡先は ${privateValue} です`);
    await expect(page.getByRole('article', { name: 'あなたの依頼' })).toHaveCount(0);
    expect(requests).toBe(0);
    const stored = await page.evaluate(() => window.localStorage.getItem('origin_chat_sessions_v1') ?? '');
    expect(stored).not.toContain(privateValue);
  });

  test('language controls have pressed state and update the interface', async ({ page }) => {
    await page.goto('/');
    const { dialog } = await openSettings(page);

    const japanese = dialog.getByRole('button', { name: '日本語' });
    const english = dialog.getByRole('button', { name: 'English' });
    await expect(japanese).toHaveAttribute('aria-pressed', 'true');

    await english.click();
    await expect(english).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog).toContainText('Changes are saved automatically.');
  });
});
