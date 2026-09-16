// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CreativeWorkspaceV15 from './CreativeWorkspaceV15';

const statusBody = {
  ok: true,
  ready: true,
  releaseStage: 'verified-vector-foundation',
  externalNetworkRequests: 0,
  providerExecutions: 0,
  costUsd: 0,
  freeOnly: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => body,
    clone() { return jsonResponse(body, status); },
  } as unknown as Response;
}

function svgResponse(options: { verified?: boolean; status?: number } = {}): Response {
  const status = options.status ?? 200;
  const headers = new Headers({
    'content-type': status === 200 ? 'image/svg+xml' : 'application/json',
    'content-disposition': "attachment; filename=\"origin-social-card-portrait.svg\"; filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E-portrait.svg",
    'x-origin-visual-verified': options.verified === false ? 'false' : 'true',
    'x-origin-visual-sha256': 'a'.repeat(64),
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    blob: async () => new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], { type: 'image/svg+xml' }),
    json: async () => ({ code: 'VISUAL_ARTIFACT_GENERATION_FAILED' }),
    clone() { return svgResponse(options); },
  } as unknown as Response;
}

describe('CreativeWorkspaceV15', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:origin-preview') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectURL });
  });

  it('checks the zero-cost capability, generates a verified SVG, previews it, and exposes download', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(statusBody))
      .mockResolvedValueOnce(svgResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<CreativeWorkspaceV15 />);
    await screen.findByText('検証済みローカル生成 · 外部通信 0 · Provider 0 · $0');

    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '日本語' } });
    fireEvent.click(screen.getByRole('button', { name: 'Visualを生成' }));

    const preview = await screen.findByAltText('生成済みVisual: 日本語') as HTMLImageElement;
    expect(preview.src).toContain('blob:origin-preview');
    const download = screen.getByRole('link', { name: '保存' }) as HTMLAnchorElement;
    expect(download.getAttribute('download')).toBe('日本語-portrait.svg');
    expect(screen.getByText(/SHA-256 aaaaaaaaaaaa…/)).toBeTruthy();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const request = fetchMock.mock.calls[1][1] as RequestInit;
    expect(request.method).toBe('POST');
    const sent = JSON.parse(String(request.body));
    expect(sent).toMatchObject({ kind: 'social-card', preset: 'portrait', layout: 'editorial', title: '日本語' });
  });

  it('does not enable generation when the capability cannot prove the zero-cost boundary', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ...statusBody, providerExecutions: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CreativeWorkspaceV15 />);
    await screen.findByText('Creative engine は現在利用できません');
    expect(screen.getByRole('button', { name: 'Visualを生成' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an artifact response without verified evidence', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(statusBody))
      .mockResolvedValueOnce(svgResponse({ verified: false }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CreativeWorkspaceV15 />);
    await screen.findByText('検証済みローカル生成 · 外部通信 0 · Provider 0 · $0');
    fireEvent.click(screen.getByRole('button', { name: 'Visualを生成' }));

    await screen.findByRole('alert');
    expect(screen.getByText('成果物の検証証拠を確認できませんでした。')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '保存' })).toBeNull();
  });

  it('updates the requested preset before generation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(statusBody))
      .mockResolvedValueOnce(svgResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<CreativeWorkspaceV15 />);
    await screen.findByText('検証済みローカル生成 · 外部通信 0 · Provider 0 · $0');
    fireEvent.change(screen.getByLabelText('サイズ'), { target: { value: 'story' } });
    fireEvent.click(screen.getByRole('button', { name: 'Visualを生成' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(request.body)).preset).toBe('story');
  });
});
