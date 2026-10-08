import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  providerStatus: vi.fn(),
  generate: vi.fn(),
  critique: vi.fn(),
}));
vi.mock('./cloudflareRasterImageProviderV15.js', () => ({
  getCloudflareRasterStatusV15: mocks.providerStatus,
  generateCloudflareRasterImageV15: mocks.generate,
}));
vi.mock('./cloudflareRasterSemanticCriticV15.js', () => ({
  critiqueCloudflareRasterSemanticV15: mocks.critique,
}));
import { createWorldClassImageZeroCostRouter } from './worldClassImageZeroCostRouter.js';

const SHA = 'a'.repeat(40);
function app() {
  const instance = express();
  instance.use(express.json({ limit: '3mb' }));
  instance.use(createWorldClassImageZeroCostRouter({
    VERCEL_GIT_COMMIT_SHA: SHA,
    ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA: SHA,
    ORIGIN_IMAGE_ZERO_COST_MAX_ATTEMPTS: '1',
  }));
  return instance;
}
function image(seed: number): Buffer {
  const bytes = Buffer.alloc(160, seed);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes, 0);
  bytes.writeUInt32BE(256, 16);
  bytes.writeUInt32BE(256, 20);
  return bytes;
}
function result(bytes: Buffer) {
  return {
    bytes, mimeType: 'image/png', width: 256, height: 256,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    model: '@cf/black-forest-labs/flux-2-klein-9b',
    providerId: 'cloudflare-workers-ai-free',
    costUsd: 0, freeOnly: true, externalNetworkRequests: 4,
  };
}
function body(source: Buffer) {
  return {
    prompt: '広告画像の背景だけを青色に変更する',
    width: 256, height: 256,
    referenceImages: ['data:image/png;base64,' + source.toString('base64')],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.providerStatus.mockResolvedValue({
    configured: true, ready: true, zeroCostVerified: true,
    model: '@cf/black-forest-labs/flux-2-klein-9b',
    paidFallbackEnabled: false,
  });
  mocks.critique.mockResolvedValue({
    passed: true, safetyPassed: true, score: 94,
    issues: [], summary: 'good',
  });
});
describe('V1.6 image editing strict reference integrity', () => {
  it('blocks an unbenchmarked 4B model even if its Free plan is ready', async () => {
    mocks.providerStatus.mockResolvedValue({
      configured: true, ready: true, zeroCostVerified: true, paidFallbackEnabled: false,
      model: '@cf/black-forest-labs/flux-2-klein-4b',
    });
    const status = await request(app()).get('/api/creative/v1.6/world-class/status');
    expect(status.status).toBe(503);
    expect(status.body.primaryReady).toBe(false);
    const response = await request(app())
      .post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '高精細な商品写真', width: 256, height: 256 });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('ZERO_COST_WORLD_CLASS_PROVIDER_UNAVAILABLE');
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('rejects a 4B configuration even when provider status advertises 9B', async () => {
    const instance = express();
    instance.use(express.json({ limit: '3mb' }));
    instance.use(createWorldClassImageZeroCostRouter({
      VERCEL_GIT_COMMIT_SHA: SHA,
      ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA: SHA,
      ORIGIN_CLOUDFLARE_IMAGE_MODEL: '@cf/black-forest-labs/flux-2-klein-4b',
    }));
    const res = await request(instance).post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '建築物の高品質画像', width: 256, height: 256 });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('ZERO_COST_WORLD_CLASS_PROVIDER_UNAVAILABLE');
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('rejects a downgraded 4B response after valid 9B plan proof', async () => {
    mocks.generate.mockResolvedValue({
      ...result(image(27)), model: '@cf/black-forest-labs/flux-2-klein-4b',
    });
    const res = await request(app()).post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: 'スタジオ風の広告画像', width: 256, height: 256 });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('WORLD_CLASS_FREE_PROVIDER_IDENTITY_DRIFT');
    expect(mocks.critique).not.toHaveBeenCalled();
  });

  it('rejects a provider identity or nonzero-cost drift before trusting an image', async () => {
    for (const drift of [
      { providerId: 'paid-provider' },
      { costUsd: 0.01 },
      { freeOnly: false },
    ]) {
      mocks.generate.mockReset().mockResolvedValue({ ...result(image(28)), ...drift });
      const res = await request(app()).post('/api/creative/v1.6/world-class/generate')
        .send({ prompt: 'スタジオ風の商品写真', width: 256, height: 256 });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('WORLD_CLASS_FREE_PROVIDER_IDENTITY_DRIFT');
    }
    expect(mocks.critique).not.toHaveBeenCalled();
  });

  it('rejects spoofed reference-image MIME before provider calls or quota use', async () => {
    const source = image(31);
    const badMime = body(source);
    badMime.referenceImages = ['data:image/webp;base64,' + source.toString('base64')];
    const res = await request(app()).post('/api/creative/v1.6/world-class/edit')
      .send(badMime);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WORLD_CLASS_REFERENCE_MIME_MISMATCH');
    expect(mocks.providerStatus).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('rejects noncanonical reference base64 before any Cloudflare request', async () => {
    const source = image(41);
    const ref = 'data:image/png;base64,' + source.toString('base64').replace(/=+$/, '');
    const res = await request(app()).post('/api/creative/v1.6/world-class/edit')
      .send({ ...body(source), referenceImages: [ref] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_WORLD_CLASS_REFERENCE_IMAGE');
    expect(mocks.providerStatus).not.toHaveBeenCalled();
  });

  it('does not accept an unmodified source as a successful edit', async () => {
    const original = image(12);
    mocks.generate.mockResolvedValue(result(original));
    const res = await request(app()).post('/api/creative/v1.6/world-class/edit')
      .send(body(original));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('WORLD_CLASS_FREE_EDIT_UNCHANGED');
    expect(res.body.freeOnly).toBe(true);
    expect(res.body.costUsd).toBe(0);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.critique).not.toHaveBeenCalled();
    expect(res.headers['x-origin-visual-verified']).toBeUndefined();
  });

  it('preserves edit intent and authentic task metadata on a changed result', async () => {
    const original = image(15);
    const changed = image(25);
    mocks.generate.mockResolvedValue(result(changed));
    const res = await request(app()).post('/api/creative/v1.6/world-class/edit')
      .send(body(original));
    expect(res.status).toBe(200);
    expect(res.headers['x-origin-visual-task']).toBe('edit');
    expect(res.headers['x-origin-visual-reference-count']).toBe('1');
    expect(res.headers['x-origin-free-only']).toBe('true');
    expect(res.headers['x-origin-paid-fallback']).toBe('false');
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({ referenceImages: [
        expect.objectContaining({ bytes: original, width: 256, height: 256 }),
      ] }),
      expect.any(Object),
    );
    expect(mocks.critique).toHaveBeenCalledTimes(1);
  });

  it('keeps generation identified separately from editing', async () => {
    mocks.generate.mockResolvedValue(result(image(33)));
    const res = await request(app()).post('/api/creative/v1.6/world-class/generate')
      .send({ prompt: '夕景の都市イメージ', width: 256, height: 256 });
    expect(res.status).toBe(200);
    expect(res.headers['x-origin-visual-task']).toBe('generate');
    expect(res.headers['x-origin-visual-reference-count']).toBe('0');
  });
});
