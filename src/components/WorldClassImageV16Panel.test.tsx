// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorldClassImageV16Panel from './WorldClassImageV16Panel';
import { readVerifiedWorldClassImageBlobV16 } from '../creative/worldClassImageClientDeliveryV16';
import { prepareRasterReferenceDataUrlV15 } from '../creative/rasterReferenceEditClientV15';
vi.mock('../creative/rasterReferenceEditClientV15', () => ({
  prepareRasterReferenceDataUrlV15: vi.fn(),
}));
vi.mock('../creative/worldClassImageClientDeliveryV16', () => ({
  readVerifiedWorldClassImageBlobV16: vi.fn(),
}));
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function status(body: Record<string, unknown>, ok = true): Response {
  return { ok, status: ok ? 200 : 503, json: async () => body } as Response;
}
const SHA = 'a'.repeat(40);
const READY = {
  ready: true, qualified: true, primaryReady: true,
  provider: 'cloudflare-workers-ai-free', model: '@cf/black-forest-labs/flux-2-klein-9b',
  releaseSha: SHA, qualifiedSha: SHA,
  freeOnly: true, costUsd: 0, paidFallbackEnabled: false, paymentMethodRequired: false,
};
const oldObjectUrl = URL.createObjectURL;
const oldRevokeUrl = URL.revokeObjectURL;
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: oldObjectUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: oldRevokeUrl });
});
describe('world-class image release-gated UI', () => {
  it('keeps generation controls inaccessible without an approved production status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(status({ ...READY, qualified: false }, false));
    vi.stubGlobal('fetch', fetchMock);
    render(<WorldClassImageV16Panel />);
    await screen.findByText('現在、承認済みの高品質画像機能を利用できません。');
    expect(screen.queryByRole('button', { name: '画像を生成' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('denies a different model even if it is marked as ready', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(status({
      ...READY, model: '@cf/black-forest-labs/flux-2-klein-4b',
    })));
    render(<WorldClassImageV16Panel />);
    await screen.findByText('現在、承認済みの高品質画像機能を利用できません。');
    expect(screen.queryByRole('button', { name: '画像を生成' })).toBeNull();
  });
  it('requires external-model privacy consent before sending prompts/images', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(status(READY));
    vi.stubGlobal('fetch', fetchMock);
    render(<WorldClassImageV16Panel />);
    const generate = await screen.findByRole('button', { name: '画像を生成' }) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
  it('only sends an approved image-generation request after explicit Cloudflare consent', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(status(READY))
      .mockResolvedValueOnce({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);
    render(<WorldClassImageV16Panel />);
    const button = await screen.findByRole('button', { name: '画像を生成' }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText('高品質画像の指示'), {
      target: { value: 'プロ品質の製品写真' },
    });
    expect(button.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await screen.findByRole('alert');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/creative/v1.6/world-class/generate');
    const options = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(options.body))).toMatchObject({
      prompt: 'プロ品質の製品写真', width: 768, height: 768,
    });
    expect(options.credentials).toBe('same-origin');
    expect(screen.queryByRole('link', { name: '検証済み画像を保存' })).toBeNull();
  });

  it('checks exact V1.6 delivery headers before publishing the verified image link', async () => {
    const imageSha = 'b'.repeat(64);
    const headers = new Headers({
      'content-type': 'image/png',
      'x-origin-visual-sha256': imageSha,
      'x-origin-visual-verified': 'true',
      'x-origin-visual-provider': 'cloudflare-workers-ai-free',
      'x-origin-visual-model': '@cf/black-forest-labs/flux-2-klein-9b',
      'x-origin-visual-task': 'generate',
      'x-origin-visual-reference-count': '0',
      'x-origin-visual-semantic-verified': 'true',
      'x-origin-visual-quality-tier': 'world-class-free',
      'x-origin-free-only': 'true',
      'x-origin-cost-usd': '0',
      'x-origin-paid-fallback': 'false',
      'x-origin-secret-delivery': 'server-only',
      'x-origin-release-sha': SHA,
      'x-origin-world-class-qualified-sha': SHA,
    });
    const response = { ok: true, headers } as Response;
    vi.mocked(readVerifiedWorldClassImageBlobV16)
      .mockResolvedValue(new Blob(['verified'], { type: 'image/png' }));
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true, value: vi.fn(() => 'blob:origin-verified'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(status(READY))
      .mockResolvedValueOnce(response));
    render(<WorldClassImageV16Panel />);
    await screen.findByRole('button', { name: '画像を生成' });
    fireEvent.change(screen.getByLabelText('高品質画像の指示'), {
      target: { value: '製品広告写真' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '画像を生成' }));
    const download = await screen.findByRole('link', { name: '検証済み画像を保存' }) as HTMLAnchorElement;
    expect(download.getAttribute('download')).toBe('origin-world-class-generate.png');
    expect(download.getAttribute('href')).toBe('blob:origin-verified');
    expect(readVerifiedWorldClassImageBlobV16)
      .toHaveBeenCalledWith(response, 'image/png', imageSha);
  });

  it('rejects mismatched delivery model even if the underlying image is valid', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(status(READY))
      .mockResolvedValueOnce({ ok: true, headers: new Headers({
        'content-type': 'image/png',
        'x-origin-visual-sha256': 'b'.repeat(64),
        'x-origin-visual-model': '@cf/black-forest-labs/flux-2-klein-4b',
      }) }));
    render(<WorldClassImageV16Panel />);
    await screen.findByRole('button', { name: '画像を生成' });
    fireEvent.change(screen.getByLabelText('高品質画像の指示'), { target: { value: '製品広告写真' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '画像を生成' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('link', { name: '検証済み画像を保存' })).toBeNull();
    expect(readVerifiedWorldClassImageBlobV16).not.toHaveBeenCalled();
  });

  it('only submits a resized reference image through the edit endpoint after consent', async () => {
    const compressedUrl = 'data:image/webp;base64,' + 'A'.repeat(120);
    vi.mocked(prepareRasterReferenceDataUrlV15).mockResolvedValue({
      dataUrl: compressedUrl, mimeType: 'image/webp', width: 320, height: 320, bytes: 90,
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(status(READY))
      .mockResolvedValueOnce({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);
    render(<WorldClassImageV16Panel />);
    await screen.findByRole('button', { name: '画像を生成' });
    const file = new File([new Uint8Array(100)], 'reference.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('編集用参照画像'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('高品質画像の指示'), {
      target: { value: '背景だけ青く変更してください' },
    });
    const editButton = screen.getByRole('button', { name: '参照画像を編集' }) as HTMLButtonElement;
    expect(editButton.disabled).toBe(true);
    expect(prepareRasterReferenceDataUrlV15).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(editButton);
    await screen.findByRole('alert');
    expect(prepareRasterReferenceDataUrlV15).toHaveBeenCalledWith(file);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/creative/v1.6/world-class/edit');
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toMatchObject({
      prompt: '背景だけ青く変更してください', referenceImages: [compressedUrl],
      width: 768, height: 768,
    });
  });

  it('never sends image bytes externally when reference preparation fails locally', async () => {
    vi.mocked(prepareRasterReferenceDataUrlV15)
      .mockRejectedValue(new Error('REFERENCE_IMAGE_CLIENT_PREP_FAILED'));
    const fetchMock = vi.fn().mockResolvedValueOnce(status(READY));
    vi.stubGlobal('fetch', fetchMock);
    render(<WorldClassImageV16Panel />);
    await screen.findByRole('button', { name: '画像を生成' });
    const file = new File([new Uint8Array(64)], 'too-large.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('編集用参照画像'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('高品質画像の指示'), {
      target: { value: '背景の変更' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '参照画像を編集' }));
    await screen.findByRole('alert');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readVerifiedWorldClassImageBlobV16).not.toHaveBeenCalled();
  });

  it('is disabled by a build-time flag until the owner explicitly exposes the UI', () => {
    const workspace = readFileSync(resolve(process.cwd(), 'src/components/CreativeWorkspaceV15.tsx'), 'utf8');
    expect(workspace).toContain("import.meta.env.VITE_WORLD_CLASS_IMAGE_UI_ENABLED === 'true'");
    expect(workspace).toContain('<WorldClassImageV16Panel />');
    expect(workspace).toContain("fetch('/api/creative/v1.5/status'");
  });
});
