// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { verifyVisualBlobSha256V15 } from '../creative/localVisualExportV15';
import { saveCreativeHistoryV15 } from '../creative/localVisualHistoryV15';
import type { ArtifactBlock } from '../App';
import CreativeArtifactEditorV15 from './CreativeArtifactEditorV15';

vi.mock('../creative/localVisualExportV15', () => ({
  pngFilenameFromSvg: (filename: string) => filename.replace(/\.svg$/i, '.png'),
  rasterizeVerifiedSvgToPng: vi.fn(),
  verifyVisualBlobSha256V15: vi.fn(),
}));

vi.mock('../creative/localVisualHistoryV15', () => ({
  deleteCreativeHistoryV15: vi.fn(),
  loadCreativeHistoryV15: vi.fn(),
  saveCreativeHistoryV15: vi.fn(),
}));

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

function svgResponse(sha256 = 'e'.repeat(64)): Response {
  const headers = new Headers({
    'content-type': 'image/svg+xml',
    'content-disposition': "attachment; filename=\"origin-poster.svg\"; filename*=UTF-8''regenerated.svg",
    'x-origin-visual-verified': 'true',
    'x-origin-visual-sha256': sha256,
    'x-origin-free-only': 'true',
    'x-origin-cost-usd': '0',
    'x-origin-external-network': 'false',
    'x-origin-visual-brain': 'visual-brain-v1',
    'x-origin-visual-provider': 'origin-local-svg',
    'x-origin-visual-critic': 'deterministic-v1',
    'x-origin-visual-quality-score': '100',
    'x-origin-visual-plan-sha256': 'b'.repeat(64),
    'x-origin-visual-generation-id': `visual-${'d'.repeat(24)}`,
  });
  return {
    ok: true,
    status: 200,
    headers,
    blob: async () => new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><text>new</text></svg>'], { type: 'image/svg+xml' }),
    json: async () => ({}),
    clone() { return svgResponse(sha256); },
  } as unknown as Response;
}

function creativeArtifact(): ArtifactBlock {
  return {
    id: `creative-${'a'.repeat(64)}`,
    type: 'html',
    language: 'svg',
    title: '元のタイトル',
    content: '<svg xmlns="http://www.w3.org/2000/svg"><text>old</text></svg>',
    isComplete: true,
    creative: {
      version: 1,
      kind: 'social-card',
      preset: 'portrait',
      layout: 'editorial',
      subtitle: 'サブ',
      body: '元の内容',
      footer: '',
      theme: { background: '#F7F7F4', foreground: '#151515', accent: '#315CFF', muted: '#686868' },
      downloadName: 'origin-social-card-portrait.svg',
      sha256: 'a'.repeat(64),
      generationId: `visual-${'c'.repeat(24)}`,
      visualBrainVersion: 'visual-brain-v1',
      providerId: 'origin-local-svg',
      planSha256: 'b'.repeat(64),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyVisualBlobSha256V15).mockResolvedValue(true);
  vi.mocked(saveCreativeHistoryV15).mockResolvedValue({ status: 'failed' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CreativeArtifactEditorV15', () => {
  it('restores the structured fields from the artifact metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(statusBody)));
    render(<CreativeArtifactEditorV15 artifact={creativeArtifact()} onRegenerated={() => undefined} />);
    await screen.findByText('利用できます');

    expect((screen.getByLabelText('タイトル') as HTMLTextAreaElement).value).toBe('元のタイトル');
    expect((screen.getByLabelText('内容') as HTMLTextAreaElement).value).toBe('元の内容');
    expect((screen.getByLabelText('サブタイトル') as HTMLInputElement).value).toBe('サブ');
  });

  it('regenerates through the verified flow and appends a revision instead of replacing silently', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(statusBody))
      .mockResolvedValueOnce(svgResponse());
    vi.stubGlobal('fetch', fetchMock);
    const onRegenerated = vi.fn();
    const artifact = creativeArtifact();

    render(<CreativeArtifactEditorV15 artifact={artifact} onRegenerated={onRegenerated} />);
    await screen.findByText('利用できます');

    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '新しいタイトル' } });
    fireEvent.change(screen.getByLabelText('背景色'), { target: { value: '#112233' } });
    fireEvent.click(screen.getByTestId('creative-artifact-regenerate'));

    await screen.findByText('デザインを再作成しました。');
    expect(onRegenerated).toHaveBeenCalledOnce();
    const next = onRegenerated.mock.calls[0][0] as ArtifactBlock;
    expect(next.id).toBe(artifact.id);
    expect(next.title).toBe('新しいタイトル');
    expect(next.content).toContain('<text>new</text>');
    expect(next.revision).toBe(2);
    expect(next.revisions).toHaveLength(2);
    expect(next.revisions?.[0].content).toBe(artifact.content);
    expect(next.revisions?.[1].source).toBe('generated');
    expect(next.creative).toMatchObject({ sha256: 'e'.repeat(64), downloadName: 'regenerated.svg' });
    expect(next.creative?.theme.background).toBe('#112233');

    const request = fetchMock.mock.calls[1][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.title).toBe('新しいタイトル');
    expect(payload.theme.background).toBe('#112233');
    expect(saveCreativeHistoryV15).toHaveBeenCalledWith(expect.objectContaining({ sha256: 'e'.repeat(64), title: '新しいタイトル' }));
  });

  it('does not touch the artifact when regeneration proof fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(statusBody))
      .mockResolvedValueOnce(svgResponse('not-a-sha'));
    vi.stubGlobal('fetch', fetchMock);
    const onRegenerated = vi.fn();

    render(<CreativeArtifactEditorV15 artifact={creativeArtifact()} onRegenerated={onRegenerated} />);
    await screen.findByText('利用できます');
    fireEvent.click(screen.getByTestId('creative-artifact-regenerate'));

    await screen.findByRole('alert');
    expect(screen.getByText('作成物のSHA-256証拠を確認できませんでした。')).toBeTruthy();
    expect(onRegenerated).not.toHaveBeenCalled();
    expect(saveCreativeHistoryV15).not.toHaveBeenCalled();
  });

  it('renders nothing for artifacts without creative metadata', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(statusBody)));
    const plain: ArtifactBlock = { id: 'art-1', type: 'markdown', language: 'markdown', title: '文書', content: '# A', isComplete: true };
    const { container } = render(<CreativeArtifactEditorV15 artifact={plain} onRegenerated={() => undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
