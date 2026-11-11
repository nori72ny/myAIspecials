// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  rasterizeVerifiedSvgToPng,
  verifyVisualBlobSha256V15,
} from '../creative/localVisualExportV15';
import {
  deleteCreativeHistoryV15,
  loadCreativeHistoryV15,
  saveCreativeHistoryV15,
  type CreativeHistoryEntryV15,
} from '../creative/localVisualHistoryV15';
import CreativePanelV15 from './CreativePanelV15';

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

function svgResponse(options: {
  verified?: boolean;
  status?: number;
  freeOnly?: boolean;
  costUsd?: string;
  externalNetwork?: boolean;
  sha256?: string;
} = {}): Response {
  const status = options.status ?? 200;
  const headers = new Headers({
    'content-type': status === 200 ? 'image/svg+xml' : 'application/json',
    'content-disposition': "attachment; filename=\"origin-social-card-portrait.svg\"; filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E-portrait.svg",
    'x-origin-visual-verified': options.verified === false ? 'false' : 'true',
    'x-origin-visual-sha256': options.sha256 ?? 'a'.repeat(64),
    'x-origin-free-only': options.freeOnly === false ? 'false' : 'true',
    'x-origin-cost-usd': options.costUsd ?? '0',
    'x-origin-external-network': options.externalNetwork === true ? 'true' : 'false',
    'x-origin-visual-brain': 'visual-brain-v1',
    'x-origin-visual-provider': 'origin-local-svg',
    'x-origin-visual-critic': 'deterministic-v1',
    'x-origin-visual-quality-score': '100',
    'x-origin-visual-plan-sha256': 'b'.repeat(64),
    'x-origin-visual-generation-id': `visual-${'d'.repeat(24)}`,
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

function historyEntry(title = '履歴Visual'): CreativeHistoryEntryV15 {
  return {
    version: 1,
    id: 'c'.repeat(64),
    sha256: 'c'.repeat(64),
    title,
    preset: 'portrait',
    downloadName: 'history-portrait.svg',
    createdAt: 1_789_565_000_000,
    svgBlob: new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], { type: 'image/svg+xml' }),
  };
}

describe('CreativePanelV15', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let objectUrlSequence = 0;

  beforeEach(() => {
    objectUrlSequence = 0;
    vi.clearAllMocks();
    vi.mocked(rasterizeVerifiedSvgToPng).mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    vi.mocked(verifyVisualBlobSha256V15).mockResolvedValue(true);
    vi.mocked(loadCreativeHistoryV15).mockResolvedValue({ status: 'ready', entries: [] });
    vi.mocked(saveCreativeHistoryV15).mockImplementation(async (input) => ({
      status: 'saved',
      entry: {
        version: 1,
        id: input.sha256.toLowerCase(),
        sha256: input.sha256.toLowerCase(),
        title: input.title,
        preset: input.preset,
        downloadName: input.downloadName,
        createdAt: 1_789_565_000_000,
        svgBlob: input.svgBlob,
        generationId: input.generationId,
        visualBrainVersion: input.visualBrainVersion,
        providerId: input.providerId,
        planSha256: input.planSha256,
        relation: input.relation,
        parentId: input.parentId,
      },
    }));
    vi.mocked(deleteCreativeHistoryV15).mockResolvedValue('deleted');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => `blob:origin-${++objectUrlSequence}`),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectURL });
  });

  it('opens beside the conversation with empty fields and no history dashboard', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse(statusBody)));

    render(<CreativePanelV15 onClose={() => undefined} />);
    await screen.findByText('利用できます');

    expect(screen.getByTestId('creative-panel')).toBeTruthy();
    // 初期値は標語文ではなく空欄＋プレースホルダ（棚卸しで「無くす」）。
    expect((screen.getByLabelText('タイトル') as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByLabelText('タイトル') as HTMLTextAreaElement).placeholder).toContain('例');
    expect((screen.getByLabelText('内容') as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByText('詳細設定')).toBeTruthy();
    expect(screen.queryByRole('region', { name: '作成履歴' })).toBeNull();
  });

  it('closes back to the conversation from the panel header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse(statusBody)));
    const onClose = vi.fn();
    render(<CreativePanelV15 onClose={onClose} />);
    await screen.findByText('利用できます');

    fireEvent.click(screen.getByRole('button', { name: '会話に戻る' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('pre-fills the draft from a chat request without a handoff banner and without generating', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(statusBody));
    vi.stubGlobal('fetch', fetchMock);
    const request = 'Creativeワークスペースで新商品のSNSカードを作って';

    render(<CreativePanelV15 initialRequest={request} onClose={() => undefined} />);
    await screen.findByText('利用できます');

    // 引き継ぎバナーは統合で廃止（依頼はチャット履歴と下書きに残る）。
    expect(screen.queryByTestId('creative-handoff-request')).toBeNull();
    expect((screen.getByLabelText('タイトル') as HTMLTextAreaElement).value).toContain('新商品のSNSカード');
    expect((screen.getByLabelText('内容') as HTMLTextAreaElement).value).toBe(request);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/creative/v1.5/status');
  });

  it('generates a verified artifact, shows a compact confirmation, persists history, and registers a chat artifact', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(statusBody))
      .mockResolvedValueOnce(svgResponse());
    vi.stubGlobal('fetch', fetchMock);
    const onArtifactCreated = vi.fn();

    render(<CreativePanelV15 onClose={() => undefined} onArtifactCreated={onArtifactCreated} />);
    await screen.findByText('利用できます');

    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '日本語' } });
    fireEvent.click(screen.getByRole('button', { name: '画像を作成' }));

    const preview = await screen.findByAltText('作成した画像: 日本語') as HTMLImageElement;
    expect(preview.src).toContain('blob:origin-1');
    const download = screen.getByRole('link', { name: 'SVG保存' }) as HTMLAnchorElement;
    expect(download.getAttribute('download')).toBe('日本語-portrait.svg');
    // 確認表示は「確認済み」の一言に圧縮し、検証の詳細は出さない（棚卸し）。
    expect(screen.getByText('確認済み')).toBeTruthy();
    expect(screen.queryByText('検証の詳細')).toBeNull();
    expect(screen.queryByText(/SHA-256/)).toBeNull();
    await screen.findByText('端末内履歴に保存しました。SVGは再読み込み後もこの端末から開けます。');

    expect(verifyVisualBlobSha256V15).toHaveBeenCalledWith(expect.any(Blob), 'a'.repeat(64));
    expect(saveCreativeHistoryV15).toHaveBeenCalledWith(expect.objectContaining({
      sha256: 'a'.repeat(64),
      title: '日本語',
      preset: 'portrait',
      downloadName: '日本語-portrait.svg',
      generationId: `visual-${'d'.repeat(24)}`,
      visualBrainVersion: 'visual-brain-v1',
      providerId: 'origin-local-svg',
      planSha256: 'b'.repeat(64),
      relation: 'generated',
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 成果物は会話の成果物（ArtifactBlock）としても登録される。
    expect(onArtifactCreated).toHaveBeenCalledOnce();
    const block = onArtifactCreated.mock.calls[0][0];
    expect(block).toMatchObject({
      id: `creative-${'a'.repeat(64)}`,
      type: 'html',
      language: 'svg',
      title: '日本語',
      isComplete: true,
    });
    expect(block.content).toContain('<svg');
    expect(block.creative).toMatchObject({
      version: 1,
      kind: 'social-card',
      preset: 'portrait',
      layout: 'editorial',
      sha256: 'a'.repeat(64),
      downloadName: '日本語-portrait.svg',
    });
  });

  it('rejects a response whose SVG bytes do not match the advertised SHA-256', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(statusBody))
      .mockResolvedValueOnce(svgResponse());
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(verifyVisualBlobSha256V15).mockResolvedValueOnce(false);
    const onArtifactCreated = vi.fn();

    render(<CreativePanelV15 onClose={() => undefined} onArtifactCreated={onArtifactCreated} />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '日本語' } });
    fireEvent.click(screen.getByRole('button', { name: '画像を作成' }));

    await screen.findByText('作成物の実バイトとSHA-256証拠が一致しませんでした。');
    expect(screen.queryByRole('link', { name: 'SVG保存' })).toBeNull();
    expect(saveCreativeHistoryV15).not.toHaveBeenCalled();
    expect(onArtifactCreated).not.toHaveBeenCalled();
  });

  it('creates PNG locally from the verified artifact snapshot without another fetch', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(statusBody))
      .mockResolvedValueOnce(svgResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<CreativePanelV15 onClose={() => undefined} />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '日本語' } });
    fireEvent.click(screen.getByRole('button', { name: '画像を作成' }));
    await screen.findByAltText('作成した画像: 日本語');

    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '次の下書き' } });
    fireEvent.change(screen.getByLabelText('サイズ'), { target: { value: 'story' } });
    expect(screen.getByAltText('作成した画像: 日本語')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'PNGを作成' }));
    const pngDownload = await screen.findByRole('link', { name: 'PNG保存' }) as HTMLAnchorElement;
    expect(pngDownload.getAttribute('download')).toBe('日本語-portrait.png');
    expect(pngDownload.href).toContain('blob:origin-2');
    expect(screen.getByText('縦長 1080×1350 · SVG + PNG')).toBeTruthy();
    expect(rasterizeVerifiedSvgToPng).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('loads a verified local-history entry without generating again', async () => {
    const entry = historyEntry();
    vi.mocked(loadCreativeHistoryV15).mockResolvedValueOnce({ status: 'ready', entries: [entry] });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(statusBody));
    vi.stubGlobal('fetch', fetchMock);

    render(<CreativePanelV15 onClose={() => undefined} />);
    const open = await screen.findByRole('button', { name: '履歴を開く: 履歴Visual' });
    fireEvent.click(open);

    await screen.findByAltText('作成した画像: 履歴Visual');
    expect(verifyVisualBlobSha256V15).toHaveBeenCalledWith(entry.svgBlob, entry.sha256);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('deletes a local-history entry without affecting current generation capability', async () => {
    const entry = historyEntry();
    vi.mocked(loadCreativeHistoryV15).mockResolvedValueOnce({ status: 'ready', entries: [entry] });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(statusBody));
    vi.stubGlobal('fetch', fetchMock);

    render(<CreativePanelV15 onClose={() => undefined} />);
    await screen.findByText('利用できます');
    // 生成可能な状態（タイトル入力済み）にしてから削除し、削除後も
    // 生成能力が保たれることを確認する。
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '日本語' } });
    expect((screen.getByRole('button', { name: '画像を作成' }) as HTMLButtonElement).disabled).toBe(false);
    const remove = await screen.findByRole('button', { name: '履歴から削除: 履歴Visual' });
    fireEvent.click(remove);
    await screen.findByText('端末内履歴から削除しました。');

    expect(deleteCreativeHistoryV15).toHaveBeenCalledWith(entry.id);
    expect(screen.queryByRole('button', { name: '履歴を開く: 履歴Visual' })).toBeNull();
    expect((screen.getByRole('button', { name: '画像を作成' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps verified SVG available if local PNG conversion fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(statusBody))
      .mockResolvedValueOnce(svgResponse());
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(rasterizeVerifiedSvgToPng).mockRejectedValueOnce(new Error('decode'));

    render(<CreativePanelV15 onClose={() => undefined} />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '日本語' } });
    fireEvent.click(screen.getByRole('button', { name: '画像を作成' }));
    await screen.findByRole('link', { name: 'SVG保存' });
    fireEvent.click(screen.getByRole('button', { name: 'PNGを作成' }));

    await screen.findByText('PNGの端末内変換に失敗しました。SVGはそのまま保存できます。');
    expect(screen.getByRole('link', { name: 'SVG保存' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'PNG保存' })).toBeNull();
  });

  it('does not enable generation when the capability cannot prove the zero-cost boundary', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ...statusBody, providerExecutions: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CreativePanelV15 onClose={() => undefined} />);
    await screen.findByText('現在利用できません');
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '日本語' } });
    expect((screen.getByRole('button', { name: '画像を作成' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an artifact response without verified evidence', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(statusBody))
      .mockResolvedValueOnce(svgResponse({ verified: false }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CreativePanelV15 onClose={() => undefined} />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '日本語' } });
    fireEvent.click(screen.getByRole('button', { name: '画像を作成' }));

    await screen.findByRole('alert');
    expect(screen.getByText('作成物の検証証拠を確認できませんでした。')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'SVG保存' })).toBeNull();
  });

  it('rejects an artifact response that cannot re-prove the zero-cost boundary', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(statusBody))
      .mockResolvedValueOnce(svgResponse({ costUsd: '0.01' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CreativePanelV15 onClose={() => undefined} />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '日本語' } });
    fireEvent.click(screen.getByRole('button', { name: '画像を作成' }));

    await screen.findByRole('alert');
    expect(screen.getByText('作成物のゼロコスト境界を確認できませんでした。')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'SVG保存' })).toBeNull();
  });

  it('rejects an artifact response without a valid SHA-256 proof', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(statusBody))
      .mockResolvedValueOnce(svgResponse({ sha256: 'not-a-sha' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CreativePanelV15 onClose={() => undefined} />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '日本語' } });
    fireEvent.click(screen.getByRole('button', { name: '画像を作成' }));

    await screen.findByRole('alert');
    expect(screen.getByText('作成物のSHA-256証拠を確認できませんでした。')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'SVG保存' })).toBeNull();
  });

  it('updates the requested preset before generation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(statusBody))
      .mockResolvedValueOnce(svgResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<CreativePanelV15 onClose={() => undefined} />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '日本語' } });
    fireEvent.change(screen.getByLabelText('サイズ'), { target: { value: 'story' } });
    fireEvent.click(screen.getByRole('button', { name: '画像を作成' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(request.body)).preset).toBe('story');
  });
});
