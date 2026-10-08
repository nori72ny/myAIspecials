// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import WorldClassImageV16Panel from './WorldClassImageV16Panel';
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
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
  it('is disabled by a build-time flag until the owner explicitly exposes the UI', () => {
    const workspace = readFileSync(resolve(process.cwd(), 'src/components/CreativeWorkspaceV15.tsx'), 'utf8');
    expect(workspace).toContain("import.meta.env.VITE_WORLD_CLASS_IMAGE_UI_ENABLED === 'true'");
    expect(workspace).toContain('<WorldClassImageV16Panel />');
    expect(workspace).toContain("fetch('/api/creative/v1.5/status'");
  });
});
