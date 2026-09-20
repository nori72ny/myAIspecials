import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import McpConnectionsSettings from './McpConnectionsSettings';
const base = { configured: true, authenticated: true, servers: [{ id: 'docs', label: 'Documents' }], connections: [] };
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
  it('shows authentication required without requesting a secret', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ configured: true, authenticated: false }))); open();
    expect(await screen.findByText(/利用者認証が必要/)).toBeTruthy(); expect(document.querySelector('input[type="password"]')).toBeNull();
  });
  it('registers an approved service ID without browser credentials and refreshes the list', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(base)).mockResolvedValueOnce(json({ ok: true })).mockResolvedValueOnce(json({ ...base, connections: [connection] })); vi.stubGlobal('fetch', fetch); open();
    fireEvent.change(await screen.findByLabelText('接続するサービス'), { target: { value: 'docs' } });
    fireEvent.click(screen.getByRole('button', { name: '登録' }));
    expect(await screen.findByText('接続を登録しました。')).toBeTruthy();
    expect(fetch.mock.calls[1][1]).toMatchObject({ body: '{"serverId":"docs"}', credentials: 'same-origin', headers: { 'X-Origin-MCP-Intent': 'manage' } });
    expect(screen.getByText('未確認')).toBeTruthy();
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
  it('sanitizes server errors and reports a retry path', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ code: 'token=secret' }, false))); open();
    expect(await screen.findByText(/操作を完了できませんでした/)).toBeTruthy(); expect(screen.queryByText(/token=secret/)).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: '再読み込み' }).hasAttribute('disabled')).toBe(false));
  });
});
