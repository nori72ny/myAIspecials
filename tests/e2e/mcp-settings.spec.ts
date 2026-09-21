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

test('MCP settings performs owner login and logout without retaining the password in the DOM', async ({ page }) => {
  let authenticated = false;
  const writes: Array<{ path: string; body: unknown }> = [];
  await page.route('**/api/mcp/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'GET' && path === '/api/mcp/status') {
      return route.fulfill({ json: authenticated
        ? { configured: true, authenticated: true, servers: [{ id: 'docs', label: 'Documents', authMode: 'oauth' }], connections: [] }
        : { configured: true, authenticated: false } });
    }
    expect(req.headers()['x-origin-mcp-intent']).toBe('manage');
    writes.push({ path, body: req.postDataJSON() });
    if (path === '/api/mcp/session/login') {
      expect(req.postDataJSON()).toEqual({ email: 'owner@example.com', password: 'fixture-password' });
      authenticated = true;
      return route.fulfill({ json: { ok: true, authenticated: true } });
    }
    if (path === '/api/mcp/session/logout') {
      expect(req.postDataJSON()).toEqual({});
      authenticated = false;
      return route.fulfill({ json: { ok: true, authenticated: false } });
    }
    return route.abort();
  });
  await page.goto('/');
  await page.getByRole('button', { name: '設定を開く', exact: true }).click();
  await page.getByRole('button', { name: '外部サービス接続', exact: true }).click();
  await expect(page.getByText(/オーナー認証が必要/)).toBeVisible();
  await page.getByLabel('メールアドレス').fill('owner@example.com');
  await page.getByLabel('パスワード').fill('fixture-password');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByText('ログインしました。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ログアウト', exact: true })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(page.getByText('ログアウトしました。', { exact: true })).toBeVisible();
  await expect(page.getByText(/オーナー認証が必要/)).toBeVisible();
  await expect(page.getByLabel('パスワード')).toHaveValue('');
  expect(writes.map(write => write.path)).toEqual(['/api/mcp/session/login', '/api/mcp/session/logout']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('MCP settings handles register, check and disconnect with a simulated authenticated API', async ({ page }) => {
  const id = '11111111-1111-1111-1111-111111111111';
  let connections: Array<{ id: string; serverId: string; version: number; status: string; checkedAt: string | null }> = [];
  const writes: string[] = [];
  await page.route('**/api/mcp/**', async route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (req.method() === 'GET') return route.fulfill({ json: { configured: true, authenticated: true, servers: [{ id: 'docs', label: 'Documents', authMode: 'broker' }], connections } });
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

test('MCP settings starts reviewed OAuth without rendering service credentials', async ({ page }) => {
  const authorizationUrl = 'https://auth.example.com/authorize?state=public-state&code_challenge=challenge';
  await page.route('**/api/mcp/**', async route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (req.method() === 'GET') return route.fulfill({ json: { configured: true, authenticated: true, servers: [{ id: 'docs', label: 'Documents', authMode: 'oauth' }], connections: [] } });
    expect(path).toBe('/api/mcp/oauth/docs/start'); expect(req.headers()['x-origin-mcp-intent']).toBe('manage'); expect(req.postDataJSON()).toEqual({});
    return route.fulfill({ json: { ok: true, authorizationUrl } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '設定を開く', exact: true }).click();
  await page.getByRole('button', { name: '外部サービス接続', exact: true }).click();
  await page.getByLabel('接続するサービス').selectOption('docs');
  await page.getByRole('button', { name: '認証を開始', exact: true }).click();
  const link = page.getByRole('link', { name: '公式の認証画面へ進む', exact: true });
  await expect(link).toHaveAttribute('href', authorizationUrl);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole('dialog')).not.toContainText('refresh_token');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
