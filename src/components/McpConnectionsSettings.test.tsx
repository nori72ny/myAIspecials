import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import McpConnectionsSettings from './McpConnectionsSettings';
const base = { configured: true, authenticated: true, servers: [{ id: 'docs', label: 'Documents', authMode: 'broker' as const }], connections: [] };
const oauthBase = { configured: true, authenticated: true, servers: [{ id: 'docs', label: 'Documents', authMode: 'oauth' as const }], connections: [] };
const unauthenticated = { configured: true, authenticated: false };
const connection = { id: '11111111-1111-1111-1111-111111111111', serverId: 'docs', version: 1, status: 'registered', checkedAt: null };
const json = (body: unknown, ok = true) => ({ ok, json: async () => body });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function open() { render(<McpConnectionsSettings language="ja" />); fireEvent.click(screen.getByRole('button', { name: '外部サービス接続' })); }

describe('MCP settings', () => {
  it('loads only when expanded and shows configuration state honestly', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ configured: false, authenticated: false })); vi.stubGlobal('fetch', fetch);
    render(<McpConnectionsSettings language="ja" />); expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '外部サービス接続' }));
    expect(await screen.findByText(/外部サービス接続は準備中/)).toBeTruthy(); expect(screen.queryByRole('button', { name: '登録' })).toBeNull();
  });
  it('shows an owner login form only when MCP is configured but the verified session is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(unauthenticated))); open();
    expect(await screen.findByText(/オーナー認証が必要/)).toBeTruthy();
    expect(screen.getByLabelText('メールアドレス').getAttribute('type')).toBe('email');
    expect(screen.getByLabelText('パスワード').getAttribute('type')).toBe('password');
    expect(screen.getByText(/パスワードは保存されません/)).toBeTruthy();
  });
  it('signs in through the same-origin session endpoint, clears the password field immediately, then reloads verified status', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(unauthenticated)).mockResolvedValueOnce(json({ ok: true, authenticated: true })).mockResolvedValueOnce(json(base));
    vi.stubGlobal('fetch', fetch); open();
    const email = await screen.findByLabelText('メールアドレス');
    const password = screen.getByLabelText('パスワード') as HTMLInputElement;
    fireEvent.change(email, { target: { value: 'owner@example.com' } });
    fireEvent.change(password, { target: { value: 'fixture-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));
    expect(password.value).toBe('');
    expect(await screen.findByText('ログインしました。')).toBeTruthy();
    expect(fetch.mock.calls[1][0]).toBe('/api/mcp/session/login');
    expect(fetch.mock.calls[1][1]).toMatchObject({
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Origin-MCP-Intent': 'manage' },
      body: '{"email":"owner@example.com","password":"fixture-password"}',
    });
    expect(screen.queryByLabelText('パスワード')).toBeNull();
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeTruthy();
  });
  it('restores a rotated server session without asking for the password again', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(unauthenticated)).mockResolvedValueOnce(json({ ok: true, authenticated: true })).mockResolvedValueOnce(json(base));
    vi.stubGlobal('fetch', fetch); open();
    fireEvent.click(await screen.findByRole('button', { name: 'セッションを復元' }));
    expect(await screen.findByText('セッションを復元しました。')).toBeTruthy();
    expect(fetch.mock.calls[1][0]).toBe('/api/mcp/session/refresh');
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', body: '{}', credentials: 'same-origin' });
  });
  it('logs out through the server and returns to the owner login state', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(base)).mockResolvedValueOnce(json({ ok: true, authenticated: false })).mockResolvedValueOnce(json(unauthenticated));
    vi.stubGlobal('fetch', fetch); open();
    fireEvent.click(await screen.findByRole('button', { name: 'ログアウト' }));
    expect(await screen.findByText('ログアウトしました。')).toBeTruthy();
    expect(screen.getByText(/オーナー認証が必要/)).toBeTruthy();
    expect(fetch.mock.calls[1][0]).toBe('/api/mcp/session/logout');
  });
  it('registers an approved brokered service ID without browser credentials and refreshes the list', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(base)).mockResolvedValueOnce(json({ ok: true })).mockResolvedValueOnce(json({ ...base, connections: [connection] })); vi.stubGlobal('fetch', fetch); open();
    fireEvent.change(await screen.findByLabelText('接続するサービス'), { target: { value: 'docs' } });
    fireEvent.click(screen.getByRole('button', { name: '登録' }));
    expect(await screen.findByText('接続を登録しました。')).toBeTruthy();
    expect(fetch.mock.calls[1][1]).toMatchObject({ body: '{"serverId":"docs"}', credentials: 'same-origin', headers: { 'X-Origin-MCP-Intent': 'manage' } });
    expect(screen.getByText('未確認')).toBeTruthy();
  });
  it('starts reviewed OAuth without asking for a connector token and exposes only the validated authorization URL', async () => {
    const authorizationUrl = 'https://auth.example.com/authorize?state=public-state&code_challenge=challenge';
    const fetch = vi.fn().mockResolvedValueOnce(json(oauthBase)).mockResolvedValueOnce(json({ ok: true, authorizationUrl })); vi.stubGlobal('fetch', fetch); open();
    fireEvent.change(await screen.findByLabelText('接続するサービス'), { target: { value: 'docs' } });
    fireEvent.click(screen.getByRole('button', { name: '認証を開始' }));
    expect(await screen.findByText(/認証画面を開いて連携を完了/)).toBeTruthy();
    const link = screen.getByRole('link', { name: '公式の認証画面へ進む' });
    expect(link.getAttribute('href')).toBe(authorizationUrl);
    expect(fetch.mock.calls[1][0]).toBe('/api/mcp/oauth/docs/start');
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', body: '{}', credentials: 'same-origin', headers: { 'X-Origin-MCP-Intent': 'manage' } });
    expect(document.querySelector('input[type="password"]')).toBeNull(); expect(document.body.textContent).not.toContain('refresh_token');
  });
  it('rejects a non-HTTPS authorization URL from a compromised response', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(oauthBase)).mockResolvedValueOnce(json({ ok: true, authorizationUrl: 'http://unsafe.example.com/' })); vi.stubGlobal('fetch', fetch); open();
    fireEvent.change(await screen.findByLabelText('接続するサービス'), { target: { value: 'docs' } });
    fireEvent.click(screen.getByRole('button', { name: '認証を開始' }));
    expect(await screen.findByText(/操作を完了できませんでした/)).toBeTruthy(); expect(screen.queryByRole('link', { name: '公式の認証画面へ進む' })).toBeNull();
  });
  it('displays failed checks as failure, never as a verified connection', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ ...base, connections: [connection] })).mockResolvedValueOnce(json({ ok: true, verified: false })).mockResolvedValueOnce(json({ ...base, connections: [{ ...connection, status: 'failed', version: 2 }] })); vi.stubGlobal('fetch', fetch); open();
    fireEvent.click(await screen.findByRole('button', { name: '接続を確認' }));
    expect(await screen.findByText(/接続を確認できませんでした/)).toBeTruthy(); expect(screen.queryByText('接続確認済み')).toBeNull();
  });
  it('sends the version when disconnecting and removes the entry after success', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ ...base, connections: [connection] })).mockResolvedValueOnce(json({ ok: true, removed: true })).mockResolvedValueOnce(json(base)); vi.stubGlobal('fetch', fetch); open();
    fireEvent.click(await screen.findByRole('button', { name: '解除' }));
    expect(await screen.findByText('接続を解除しました。')).toBeTruthy(); expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'DELETE', body: '{"version":1}' });
    expect(screen.queryByRole('button', { name: '解除' })).toBeNull();
  });
  it('sanitizes server errors and reports a retry path without dropping an existing overview', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(base)).mockResolvedValueOnce(json({ code: 'token=secret' }, false));
    vi.stubGlobal('fetch', fetch); open();
    fireEvent.change(await screen.findByLabelText('接続するサービス'), { target: { value: 'docs' } });
    fireEvent.click(screen.getByRole('button', { name: '登録' }));
    expect(await screen.findByText(/操作を完了できませんでした/)).toBeTruthy(); expect(screen.queryByText(/token=secret/)).toBeNull();
    expect(screen.getByLabelText('接続するサービス')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: '再読み込み' }).hasAttribute('disabled')).toBe(false));
  });
});
