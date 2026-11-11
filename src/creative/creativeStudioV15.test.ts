// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyVisualBlobSha256V15 } from './localVisualExportV15';
import {
  creativeDraftFromMetaV15,
  creativeDraftFromRequestV15,
  creativeMetaFromVerifiedV15,
  EMPTY_CREATIVE_DRAFT_V15,
  fetchCreativeStatusV15,
  generateCreativeArtifactV15,
  isCreativeArtifactMetaV15,
  type CreativeDraftV15,
} from './creativeStudioV15';

vi.mock('./localVisualExportV15', () => ({
  pngFilenameFromSvg: (filename: string) => filename.replace(/\.svg$/i, '.png'),
  rasterizeVerifiedSvgToPng: vi.fn(),
  verifyVisualBlobSha256V15: vi.fn(),
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
  costUsd?: string;
  sha256?: string;
} = {}): Response {
  const status = options.status ?? 200;
  const headers = new Headers({
    'content-type': status === 200 ? 'image/svg+xml' : 'application/json',
    'content-disposition': "attachment; filename=\"origin-social-card-portrait.svg\"; filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E-portrait.svg",
    'x-origin-visual-verified': options.verified === false ? 'false' : 'true',
    'x-origin-visual-sha256': options.sha256 ?? 'a'.repeat(64),
    'x-origin-free-only': 'true',
    'x-origin-cost-usd': options.costUsd ?? '0',
    'x-origin-external-network': 'false',
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

const draft: CreativeDraftV15 = { ...EMPTY_CREATIVE_DRAFT_V15, title: '日本語', body: '内容です' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyVisualBlobSha256V15).mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('creativeDraftFromRequestV15', () => {
  it('starts empty without slogan-like prefilled copy', () => {
    expect(EMPTY_CREATIVE_DRAFT_V15.title).toBe('');
    expect(EMPTY_CREATIVE_DRAFT_V15.body).toBe('');
    expect(creativeDraftFromRequestV15('')).toEqual(EMPTY_CREATIVE_DRAFT_V15);
    expect(creativeDraftFromRequestV15('   ')).toEqual(EMPTY_CREATIVE_DRAFT_V15);
  });

  it('infers kind, preset, title, and body from a chat request', () => {
    const request = 'Creativeワークスペースで新商品のSNSカードを作って';
    const inferred = creativeDraftFromRequestV15(request);
    expect(inferred.kind).toBe('social-card');
    expect(inferred.title).toContain('新商品のSNSカード');
    expect(inferred.body).toBe(request);
  });

  it('infers poster kind and story preset from request keywords', () => {
    const inferred = creativeDraftFromRequestV15('ストーリー用のポスターを作って');
    expect(inferred.kind).toBe('poster');
    expect(inferred.preset).toBe('story');
  });

  it('honors an explicit title in the request', () => {
    const inferred = creativeDraftFromRequestV15('タイトル: 春のセール\nSNSカードを作って');
    expect(inferred.title).toBe('春のセール');
  });
});

describe('fetchCreativeStatusV15', () => {
  it('accepts only the fully proven zero-cost status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(statusBody)));
    await expect(fetchCreativeStatusV15()).resolves.toBe(true);
  });

  it('fails closed when any proof field is off', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ...statusBody, providerExecutions: 1 })));
    await expect(fetchCreativeStatusV15()).resolves.toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fetchCreativeStatusV15()).resolves.toBe(false);
  });
});

describe('generateCreativeArtifactV15', () => {
  it('verifies the evidence chain and the actual bytes, then returns the artifact', async () => {
    const fetchMock = vi.fn().mockResolvedValue(svgResponse());
    vi.stubGlobal('fetch', fetchMock);

    const verified = await generateCreativeArtifactV15(draft);
    expect(verified.sha256).toBe('a'.repeat(64));
    expect(verified.title).toBe('日本語');
    expect(verified.downloadName).toBe('日本語-portrait.svg');
    expect(verified.svgText).toContain('<svg');
    expect(verified.generationId).toBe(`visual-${'d'.repeat(24)}`);
    expect(verifyVisualBlobSha256V15).toHaveBeenCalledWith(expect.any(Blob), 'a'.repeat(64));

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload).toMatchObject({ kind: 'social-card', preset: 'portrait', title: '日本語', body: '内容です' });
  });

  it('rejects a response whose bytes do not match the advertised SHA-256', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(svgResponse()));
    vi.mocked(verifyVisualBlobSha256V15).mockResolvedValueOnce(false);
    await expect(generateCreativeArtifactV15(draft)).rejects.toThrow('作成物の実バイトとSHA-256証拠が一致しませんでした。');
  });

  it('rejects a response without verified evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(svgResponse({ verified: false })));
    await expect(generateCreativeArtifactV15(draft)).rejects.toThrow('作成物の検証証拠を確認できませんでした。');
  });

  it('rejects a response that cannot re-prove the zero-cost boundary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(svgResponse({ costUsd: '0.01' })));
    await expect(generateCreativeArtifactV15(draft)).rejects.toThrow('作成物のゼロコスト境界を確認できませんでした。');
  });

  it('rejects a response without a valid SHA-256 proof', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(svgResponse({ sha256: 'not-a-sha256' })));
    await expect(generateCreativeArtifactV15(draft)).rejects.toThrow('作成物のSHA-256証拠を確認できませんでした。');
  });
});

describe('creative artifact metadata', () => {
  it('round-trips between draft and meta and validates strictly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(svgResponse()));
    const verified = await generateCreativeArtifactV15(draft);
    const meta = creativeMetaFromVerifiedV15(verified, draft);
    expect(isCreativeArtifactMetaV15(meta)).toBe(true);
    expect(creativeDraftFromMetaV15(meta, draft.title)).toEqual(draft);

    expect(isCreativeArtifactMetaV15(null)).toBe(false);
    expect(isCreativeArtifactMetaV15({ ...meta, version: 2 })).toBe(false);
    expect(isCreativeArtifactMetaV15({ ...meta, kind: 'banner' })).toBe(false);
    expect(isCreativeArtifactMetaV15({ ...meta, sha256: 'xyz' })).toBe(false);
    expect(isCreativeArtifactMetaV15({ ...meta, theme: { ...meta.theme, accent: 'red' } })).toBe(false);
  });
});
