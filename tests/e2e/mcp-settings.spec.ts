import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('MCP settings reports its actual disabled backend without breaking the mobile dialog', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '設定を開く', exact: true }).click();
  await page.getByRole('button', { name: '外部サービス接続', exact: true }).click();
  await expect(page.getByText('外部サービス接続は準備中です。認証と保存先の設定が完了すると利用できます。')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: '登録', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});

test('MCP settings handles register, check and disconnect with a simulated authenticated API', async ({ page }) => {
  const id = '11111111-1111-1111-1111-111111111111';
  let connections: Array<{ id: string; serverId: string; version: number; status: string; checkedAt: string | null }> = [];
  const writes: string[] = [];
  await page.route('**/api/mcp/**', async route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (req.method() === 'GET') return route.fulfill({ json: { configured: true, authenticated: true, servers: [{ id: 'docs', label: 'Documents' }], connections } });
    expect(req.headers()['x-origin-mcp-intent']).toBe('manage'); writes.push(req.method());
    if (path.endsWith('/check')) {
      expect(req.postDataJSON()).toEqual({ version: 1 });
      connections = [{ ...connections[0], version: 2, status: 'verified' }];
      return route.fulfill({ json: { ok: true, verified: true, connection: connections[0], toolCount: 2 } });
    }
    if (req.method() === 'DELETE') {
      expect(req.postDataJSON()).toEqual({ version: 2 }); connections = [];
      return route.fulfill({ json: { ok: true, removed: true } });
    }
    expect(req.postDataJSON()).toEqual({ serverId: 'docs' });
    connections = [{ id, serverId: 'docs', version: 1, status: 'registered', checkedAt: null }];
    return route.fulfill({ status: 201, json: { ok: true, connection: connections[0] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '設定を開く', exact: true }).click();
  await page.getByRole('button', { name: '外部サービス接続', exact: true }).click();
  await page.getByLabel('接続するサービス').selectOption('docs');
  await page.getByRole('button', { name: '登録', exact: true }).click();
  await expect(page.getByText('接続を登録しました。')).toBeVisible();
  await page.getByRole('button', { name: '接続を確認', exact: true }).click();
  await expect(page.getByText('接続確認済み', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '解除', exact: true }).click();
  await expect(page.getByText('接続を解除しました。')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(writes).toEqual(['POST', 'POST', 'DELETE']);
});
