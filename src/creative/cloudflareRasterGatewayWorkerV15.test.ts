import { describe, expect, it, vi } from 'vitest';

import {
  createCloudflareRasterGatewayWorkerV15,
  type CloudflareRasterGatewayWorkerEnvV15,
} from './cloudflareRasterGatewayWorkerV15';

const SECRET = 's'.repeat(48);

type AiRun = NonNullable<CloudflareRasterGatewayWorkerEnvV15['AI']>['run'];

function readyEnv(aiRun: AiRun): CloudflareRasterGatewayWorkerEnvV15 {
  return {
    AI: { run: aiRun },
    ORIGIN_RASTER_GATEWAY_SECRET: SECRET,
    ORIGIN_RASTER_GATEWAY_ZERO_COST_VERIFIED: 'true',
    FREE_ONLY: 'true',
  };
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function request(path: string, form?: FormData, secret = SECRET): Request {
  return new Request(`https://origin-raster.example.workers.dev${path}`, {
    method: form ? 'POST' : 'GET',
    headers: { 'x-origin-gateway-secret': secret },
    body: form,
  });
}

describe('cloudflareRasterGatewayWorkerV15', () => {
  it('reports ready only when the AI binding, shared secret, free-only mode, and zero-cost verification are all present', async () => {
    const aiRun = vi.fn(async () => new Uint8Array([1]));
    const worker = createCloudflareRasterGatewayWorkerV15();

    const response = await worker.fetch(request('/status'), readyEnv(aiRun));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      provider: 'cloudflare-workers-ai-binding',
      model: '@cf/black-forest-labs/flux-2-klein-4b',
      aiBindingConfigured: true,
      secretConfigured: true,
      zeroCostVerified: true,
      freeOnly: true,
      paidFallbackEnabled: false,
    });

    const unverified = await worker.fetch(request('/status'), {
      ...readyEnv(aiRun),
      ORIGIN_RASTER_GATEWAY_ZERO_COST_VERIFIED: 'false',
    });
    expect(unverified.status).toBe(503);
    await expect(unverified.json()).resolves.toMatchObject({ ok: false, zeroCostVerified: false });
  });

  it('rejects an invalid shared secret before exposing readiness or invoking Workers AI', async () => {
    const aiRun = vi.fn(async () => new Uint8Array([1]));
    const worker = createCloudflareRasterGatewayWorkerV15();

    const response = await worker.fetch(request('/status', undefined, 'wrong-secret'), readyEnv(aiRun));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'UNAUTHORIZED' });
    expect(aiRun).not.toHaveBeenCalled();
  });

  it('sends only a sanitized multipart request to the exact FLUX.2 klein 4B binding', async () => {
    const aiRun = vi.fn(async (_model: Parameters<AiRun>[0], _input: Parameters<AiRun>[1]) => pngHeader(1024, 1024));
    const worker = createCloudflareRasterGatewayWorkerV15();
    const form = new FormData();
    form.append('prompt', 'A premium studio product photograph');
    form.append('width', '1024');
    form.append('height', '1024');

    const response = await worker.fetch(request('/generate', form), readyEnv(aiRun));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(aiRun).toHaveBeenCalledTimes(1);
    expect(aiRun.mock.calls[0]?.[0]).toBe('@cf/black-forest-labs/flux-2-klein-4b');
    expect(aiRun.mock.calls[0]?.[1]).toMatchObject({
      multipart: {
        body: expect.any(ReadableStream),
        contentType: expect.stringContaining('multipart/form-data'),
      },
    });
  });

  it('rejects an oversized multipart body even when Content-Length is absent', async () => {
    const aiRun = vi.fn(async () => pngHeader(1024, 1024));
    const worker = createCloudflareRasterGatewayWorkerV15();
    const oversized = new Uint8Array(4 * 1024 * 1024 + 1);
    const oversizedRequest = new Request('https://origin-raster.example.workers.dev/generate', {
      method: 'POST',
      headers: {
        'x-origin-gateway-secret': SECRET,
        'content-type': 'multipart/form-data; boundary=oversized',
      },
      body: oversized,
    });

    const response = await worker.fetch(oversizedRequest, readyEnv(aiRun));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INPUT_REQUEST_TOO_LARGE' });
    expect(aiRun).not.toHaveBeenCalled();
  });

  it('rejects reference images at 512px or larger before invoking Workers AI', async () => {
    const aiRun = vi.fn(async () => pngHeader(1024, 1024));
    const worker = createCloudflareRasterGatewayWorkerV15();
    const form = new FormData();
    form.append('prompt', 'Preserve the subject and change the background');
    form.append('width', '1024');
    form.append('height', '1024');
    form.append('input_image_0', new Blob([pngHeader(512, 128)], { type: 'image/png' }), 'source.png');

    const response = await worker.fetch(request('/edit', form), readyEnv(aiRun));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INPUT_REFERENCE_DIMENSIONS_UNSUPPORTED' });
    expect(aiRun).not.toHaveBeenCalled();
  });
});
