import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import McpGithubBootstrapSettings from './McpGithubBootstrapSettings';

const buttonClass = 'test-button';
const status = { configured: true, registered: false };
const manifest = JSON.stringify({
  name: 'ORIGIN Personal Read Only',
  url: 'https://origin.example.com',
  hook_attributes: { url: 'https://origin.example.com/api/mcp/github/webhook-disabled', active: false },
  redirect_url: 'https://origin.example.com/api/mcp/github/app/manifest/callback',
  callback_urls: ['https://origin.example.com/api/mcp/oauth/github/callback'],
  description: 'Owner-approved read-only GitHub repository connection for ORIGIN Personal.',
  public: false,
  default_events: [],
  default_permissions: { contents: 'read' },
  request_oauth_on_install: false,
});
const actionUrl = `https://github.com/settings/apps/new?state=${'a'.repeat(43)}`;
const json = (body: unknown, ok = true) => ({ ok, json: async () => body });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderControl(fetchImpl: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchImpl);
  render(<McpGithubBootstrapSettings language="ja" buttonClass={buttonClass} />);
}

describe('GitHub App owner approval control', () => {
  it('loads status without creating or starting an app', async () => {
    const fetch = vi.fn().mockResolvedValue(json(status));
    renderControl(fetch);
    expect(await screen.findByRole('button', { name: 'GitHub承認を準備' })).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/api/mcp/github/app/status');
    expect(screen.queryByRole('button', { name: 'GitHubで内容を確認して作成' })).toBeNull();
  });

  it('prepares a single-use manifest and renders only a GitHub POST form for explicit owner approval', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(status)).mockResolvedValueOnce(json({ ok: true, actionUrl, manifest }));
    renderControl(fetch);
    fireEvent.click(await screen.findByRole('button', { name: 'GitHub承認を準備' }));
    const approve = await screen.findByRole('button', { name: 'GitHubで内容を確認して作成' });
    const form = approve.closest('form');
    expect(form?.getAttribute('method')).toBe('post');
    expect(form?.getAttribute('action')).toBe(actionUrl);
    const hidden = form?.querySelector('input[name="manifest"]') as HTMLInputElement;
    expect(hidden.value).toBe(manifest);
    expect(fetch.mock.calls[1][0]).toBe('/api/mcp/github/app/manifest/start');
    expect(fetch.mock.calls[1][1]).toMatchObject({
      method: 'POST', credentials: 'same-origin', body: '{}',
      headers: { 'Content-Type': 'application/json', 'X-Origin-MCP-Intent': 'manage' },
    });
  });

  it.each([
    ['https://evil.example/settings/apps/new?state=' + 'a'.repeat(43), manifest],
    ['https://github.com/settings/apps/new?state=' + 'a'.repeat(43) + '&extra=1', manifest],
    [actionUrl, JSON.stringify({ ...JSON.parse(manifest), default_permissions: { contents: 'write' } })],
    [actionUrl, JSON.stringify({ ...JSON.parse(manifest), default_permissions: { contents: 'read', issues: 'read' } })],
    [actionUrl, JSON.stringify({ ...JSON.parse(manifest), default_events: ['push'] })],
    [actionUrl, JSON.stringify({ ...JSON.parse(manifest), hook_attributes: { active: true } })],
  ])('fails closed on an unsafe approval payload %#', async (unsafeAction, unsafeManifest) => {
    const fetch = vi.fn().mockResolvedValueOnce(json(status)).mockResolvedValueOnce(json({ ok: true, actionUrl: unsafeAction, manifest: unsafeManifest }));
    renderControl(fetch);
    fireEvent.click(await screen.findByRole('button', { name: 'GitHub承認を準備' }));
    expect(await screen.findByText(/初期設定を準備できませんでした/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'GitHubで内容を確認して作成' })).toBeNull();
    expect(document.querySelector('form[action^="https://github.com/settings/apps/new"]')).toBeNull();
  });

  it('does not offer creation again after server-side registration exists', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ configured: true, registered: true, appSlug: 'origin-personal-read-only' }));
    renderControl(fetch);
    expect(await screen.findByText(/GitHub Appは登録済み/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'GitHub承認を準備' })).toBeNull();
  });
});
