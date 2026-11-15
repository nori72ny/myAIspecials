import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

// パーソナライズ第1段 P1-3（設計 §7）の通し確認：設定の「あなたについて」で
// プロフィールを追加→編集→削除し、全消去と主トグル off が再読み込みを
// またいで効くことを、実アプリの画面操作で固定する。記憶の抽出そのものは
// チャット経路が必要なため、ここでは管理画面の操作と永続化を対象にする
// （抽出と一覧の振る舞いはコンポーネントテストが実保存層で固定している）。

async function openPersonalSection(page: Page) {
  await page.getByRole('button', { name: '設定を開く', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'あなたについて' })).toBeVisible();
  return dialog;
}

async function reloadAndWait(page: Page) {
  await page.reload();
  await expect(page.getByTestId('origin-home-request')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-origin-storage-state', 'ready');
}

test('personalization settings: add, edit, delete, clear-all and toggle-off flow', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('origin-home-request')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-origin-storage-state', 'ready');

  const dialog = await openPersonalSection(page);
  const section = dialog.getByTestId('personalization-section');
  await expect(section.getByText('まだ何も書かれていません。')).toBeVisible();

  // 追加：カテゴリを選んで一文を書く。
  await section.getByLabel('カテゴリ', { exact: true }).selectOption('preference');
  await section.getByLabel('内容', { exact: true }).fill('短くまとめてほしい');
  await section.getByRole('button', { name: '追加する', exact: true }).click();
  await expect(section.getByText('短くまとめてほしい')).toBeVisible();

  // 編集：その場で書き換える。
  const firstRow = section.locator('[data-testid^="profile-item-"]').first();
  await firstRow.getByRole('button', { name: '編集', exact: true }).click();
  await firstRow.getByRole('textbox').fill('結論を先に知りたい');
  await firstRow.getByRole('button', { name: '保存', exact: true }).click();
  await expect(section.getByText('結論を先に知りたい')).toBeVisible();
  await expect(section.getByText('短くまとめてほしい')).toHaveCount(0);

  // 2件目を追加して削除する。
  await section.getByLabel('内容', { exact: true }).fill('表より文章が好き');
  await section.getByRole('button', { name: '追加する', exact: true }).click();
  await expect(section.getByText('表より文章が好き')).toBeVisible();
  const secondRow = section.locator('[data-testid^="profile-item-"]').nth(1);
  await secondRow.getByRole('button', { name: '消す', exact: true }).click();
  await expect(section.getByText('表より文章が好き')).toHaveCount(0);

  // 再読み込み：残した1件は残り、消した1件は復活しない。
  await page.getByTestId('close-settings-button').click();
  await reloadAndWait(page);
  const dialogAfterReload = await openPersonalSection(page);
  const sectionAfterReload = dialogAfterReload.getByTestId('personalization-section');
  await expect(sectionAfterReload.getByText('結論を先に知りたい')).toBeVisible();
  await expect(sectionAfterReload.getByText('表より文章が好き')).toHaveCount(0);

  // 全消去：プロフィールも一緒に消すと、覚えている内容が空になる。
  await sectionAfterReload.getByTestId('personal-clear-all-button').click();
  await expect(sectionAfterReload.getByText(/会話の履歴は消えません/)).toBeVisible();
  await sectionAfterReload.getByLabel('プロフィールも一緒に消す', { exact: true }).check();
  await sectionAfterReload.getByRole('button', { name: '全て消す', exact: true }).click();
  await expect(sectionAfterReload.getByText('覚えていることを全て消しました。')).toBeVisible();
  await expect(sectionAfterReload.getByText('結論を先に知りたい')).toHaveCount(0);
  await expect(sectionAfterReload.getByText('まだ何も書かれていません。')).toBeVisible();

  // 主トグル off：再読み込みしても off のままで、説明文が出る。
  await sectionAfterReload.getByRole('switch', { name: '覚えている内容を、回答に活かす' }).click();
  await expect(sectionAfterReload.getByText(/オフにすると、新しく覚えることも、回答に使うことも止まります/)).toBeVisible();
  await page.getByTestId('close-settings-button').click();
  await reloadAndWait(page);
  const dialogAfterToggle = await openPersonalSection(page);
  const sectionAfterToggle = dialogAfterToggle.getByTestId('personalization-section');
  await expect(sectionAfterToggle.getByRole('switch', { name: '覚えている内容を、回答に活かす' })).toHaveAttribute('aria-checked', 'false');
  await expect(sectionAfterToggle.getByText(/オフにすると、新しく覚えることも、回答に使うことも止まります/)).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});
