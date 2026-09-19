import { expect, test } from '@playwright/test';

const representativeAnswer = [
  '## 結論',
  '',
  '段階公開を基本にし、品質・利用率・撤退条件を同時に観測できる構成にします。',
  '',
  '## 判断基準',
  '',
  '- **品質**: 重大エラー率と問い合わせ増加を公開前後で比較します。',
  '- **価値**: 対象ユーザーの利用率と主要タスク完了率を確認します。',
  '- **可逆性**: 問題時に即時停止できるフラグと復旧手順を用意します。',
  '',
  '## トレードオフ',
  '',
  '段階公開は学習速度と安全性を両立しやすい一方、全ユーザーへの到達は遅くなります。一斉公開は到達が速い反面、障害時の影響範囲が大きくなります。',
  '',
  '## 実行手順',
  '',
  '1. 対象を限定して公開します。',
  '2. KPIとエラー指標を確認します。',
  '3. 基準を満たした場合だけ対象を拡大します。',
  '4. 悪化時は停止し、原因確認後に再評価します。',
  '',
  '## 完了条件',
  '',
  '主要KPIが事前基準を満たし、重大障害がなく、撤退条件と復旧手順が実地確認できた状態を完了とします。',
].join('\n');

test.describe('ORIGIN visual QA evidence', () => {
  for (const viewport of [
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'desktop-1440', width: 1440, height: 1000 },
  ]) {
    test(`captures readable home and long-answer evidence on ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.route('**/api/chat', route => route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: representativeAnswer,
      }));

      await page.goto('/');
      await expect(page.getByTestId('origin-home-request')).toBeVisible();
      await testInfo.attach(`origin-home-${viewport.name}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });

      await page.getByTestId('origin-home-request').fill('新機能の公開方法を実務レベルで判断してください');
      await page.getByTestId('start-request-button').click();

      const answer = page.getByRole('article', { name: 'ORIGINの回答' });
      await expect(answer.getByRole('heading', { name: '結論', level: 2 })).toBeVisible();
      await expect(answer.getByRole('heading', { name: '完了条件', level: 2 })).toBeVisible();
      await expect(page.getByRole('group', { name: '回答を調整' })).toBeVisible();
      await expect(page.getByTestId('response-verification-details')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

      await testInfo.attach(`origin-answer-${viewport.name}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    });
  }
});
