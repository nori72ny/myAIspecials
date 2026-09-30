import { describe, expect, it, vi } from 'vitest';
import {
  generateCloudflareRasterImageV15,
  getCloudflareRasterStatusV15,
} from './cloudflareRasterImageProviderV15';

const TEST_TOKEN = `test-${'x'.repeat(40)}`;
const ENV: NodeJS.ProcessEnv = {
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_API_TOKEN: TEST_TOKEN,
};

function json(result: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status >= 200 && status < 300, result, errors: [], messages: [] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function failure(status: number, code: number) {
  return new Response(JSON.stringify({
    success: false,
    result: null,
    errors: [{ code, message: 'upstream failure' }],
    messages: [],
  }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function png(width: number, height: number) {
  const bytes = Buffer.alloc(64);
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(bytes,0);
  Buffer.from('IHDR','ascii').copy(bytes,12);
  bytes.writeUInt32BE(width,16);
  bytes.writeUInt32BE(height,20);
  return bytes;
}

function jpeg(width: number, height: number) {
  const bytes = Buffer.alloc(64, 0);
  bytes[0] = 0xff; bytes[1] = 0xd8;
  bytes[2] = 0xff; bytes[3] = 0xc0;
  bytes.writeUInt16BE(17, 4);
  bytes[6] = 8;
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  bytes[62] = 0xff; bytes[63] = 0xd9;
  return bytes;
}

function webp(width: number, height: number) {
  const bytes = Buffer.alloc(64, 0);
  Buffer.from('RIFF','ascii').copy(bytes,0);
  bytes.writeUInt32LE(56,4);
  Buffer.from('WEBP','ascii').copy(bytes,8);
  Buffer.from('VP8X','ascii').copy(bytes,12);
  bytes.writeUInt32LE(10,16);
  bytes.writeUIntLE(width - 1,24,3);
  bytes.writeUIntLE(height - 1,27,3);
  return bytes;
}

describe('cloudflareRasterImageProviderV15', () => {
  it('fails closed without server-only Cloudflare credentials', async () => {
    await expect(getCloudflareRasterStatusV15({})).resolves.toMatchObject({
      configured: false,
      ready: false,
      zeroCostVerified: false,
      providerId: 'cloudflare-workers-ai-free',
      reason: 'CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED',
      paidFallbackEnabled: false,
      paymentMethodRequired: false,
      secretDelivery: 'server-only',
    });
  });

  it('accepts only a non-paid Workers account state', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ input: {}, output: {} })) as unknown as typeof fetch;

    await expect(getCloudflareRasterStatusV15(ENV, fetchMock)).resolves.toMatchObject({
      configured: true,
      ready: true,
      model: '@cf/black-forest-labs/flux-2-klein-4b',
      zeroCostVerified: true,
      reason: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(['standard','unbound'])('rejects paid-capable Workers usage model %s before generation', async (usageModel) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ default_usage_model: usageModel })) as unknown as typeof fetch;
    await expect(getCloudflareRasterStatusV15(ENV, fetchMock)).resolves.toMatchObject({
      ready: false,
      zeroCostVerified: false,
      reason: 'CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an active paid Workers subscription even when the usage-model field is ambiguous', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json([{ state: 'Paid', rate_plan: { id: 'workers_paid', public_name: 'Workers Paid' } }])) as unknown as typeof fetch;

    await expect(getCloudflareRasterStatusV15(ENV, fetchMock)).resolves.toMatchObject({
      ready: false,
      reason: 'CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED',
    });
  });

  it('requires Billing Read evidence rather than assuming Free when subscription proof is unavailable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(json({}, 403)) as unknown as typeof fetch;

    await expect(getCloudflareRasterStatusV15(ENV, fetchMock)).resolves.toMatchObject({
      ready: false,
      reason: 'CLOUDFLARE_BILLING_READ_REQUIRED',
    });
  });

  it('requires Workers AI permission before reporting readiness', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({}, 403)) as unknown as typeof fetch;

    await expect(getCloudflareRasterStatusV15(ENV, fetchMock)).resolves.toMatchObject({
      configured: true,
      ready: false,
      zeroCostVerified: false,
      reason: 'CLOUDFLARE_WORKERS_AI_PERMISSION_REQUIRED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reports when the exact image model itself requires a paid plan', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(failure(403, 5035)) as unknown as typeof fetch;

    await expect(getCloudflareRasterStatusV15(ENV, fetchMock)).resolves.toMatchObject({
      ready: false,
      zeroCostVerified: false,
      reason: 'CLOUDFLARE_MODEL_REQUIRES_PAID_PLAN',
    });
  });

  it('rejects an invalid exact-model schema instead of claiming readiness', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ input: {} })) as unknown as typeof fetch;

    await expect(getCloudflareRasterStatusV15(ENV, fetchMock)).resolves.toMatchObject({
      ready: false,
      zeroCostVerified: false,
      reason: 'CLOUDFLARE_WORKERS_AI_MODEL_UNVERIFIED',
    });
  });

  it('generates only after re-verifying the free-plan boundary immediately before inference', async () => {
    const bytes = png(768,1024);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ input: {}, output: {} }))
      .mockResolvedValueOnce(json(bytes.toString('base64')));

    const result = await generateCloudflareRasterImageV15({
      prompt: '静かな湖と朝焼け',
      negativePrompt: 'text, watermark',
      width: 768,
      height: 1024,
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result).toMatchObject({
      providerId: 'cloudflare-workers-ai-free',
      model: '@cf/black-forest-labs/flux-2-klein-4b',
      mimeType: 'image/png',
      width: 768,
      height: 1024,
      costUsd: 0,
      freeOnly: true,
      externalNetworkRequests: 4,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const request = fetchMock.mock.calls[3];
    const init = request?.[1] as RequestInit;
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${TEST_TOKEN}`);
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(String(form.get('prompt'))).toContain('静かな湖と朝焼け');
    expect(String(form.get('prompt'))).toContain('Avoid these visual elements when possible: text, watermark');
    expect(String(form.get('width'))).toBe('768');
    expect(String(form.get('height'))).toBe('1024');
    expect(new Headers(init.headers).get('content-type')).toBeNull();
  });

  it('sends bounded reference images as indexed multipart inputs for editing', async () => {
    const output = png(768, 1024);
    const reference = png(320, 240);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ input: {}, output: {} }))
      .mockResolvedValueOnce(json(output.toString('base64')));

    const result = await generateCloudflareRasterImageV15({
      prompt: '画像0の腕時計を残し、背景だけを夜の高級ホテルに変更してください',
      width: 768,
      height: 1024,
      referenceImages: [{
        bytes: reference,
        mimeType: 'image/png',
        width: 320,
        height: 240,
      }],
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result).toMatchObject({
      providerId: 'cloudflare-workers-ai-free',
      width: 768,
      height: 1024,
      costUsd: 0,
      freeOnly: true,
      externalNetworkRequests: 4,
    });
    const form = fetchMock.mock.calls[3]?.[1]?.body as FormData;
    expect(String(form.get('prompt'))).toContain('Reference images are attached in index order starting at image 0.');
    expect(String(form.get('prompt'))).toContain('Preserve subjects');
    expect(form.get('input_image_0')).toBeInstanceOf(Blob);
    const blob = form.get('input_image_0') as Blob;
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(reference.length);
  });

  it('rejects out-of-bounds reference images before any external Cloudflare request', async () => {
    const reference = png(512, 320);
    const fetchMock = vi.fn();

    await expect(generateCloudflareRasterImageV15({
      prompt: '背景だけ変更してください',
      referenceImages: [{
        bytes: reference,
        mimeType: 'image/png',
        width: 512,
        height: 320,
      }],
    }, ENV, fetchMock as unknown as typeof fetch)).rejects.toThrow('REFERENCE_IMAGE_DIMENSION_OUT_OF_BOUNDS');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['image/jpeg', jpeg(768, 1024)],
    ['image/webp', webp(768, 1024)],
  ] as const)('accepts verified %s dimensions instead of assuming PNG-only output', async (mimeType, bytes) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ input: {}, output: {} }))
      .mockResolvedValueOnce(json(bytes.toString('base64')));

    const result = await generateCloudflareRasterImageV15({
      prompt: 'format compatibility check',
      width: 768,
      height: 1024,
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result).toMatchObject({ mimeType, width: 768, height: 1024, costUsd: 0, freeOnly: true });
  });

  it.each([
    [429, 3036, 'CLOUDFLARE_FREE_ALLOCATION_EXHAUSTED'],
    [429, 3040, 'CLOUDFLARE_WORKERS_AI_CAPACITY_UNAVAILABLE'],
    [403, 5035, 'CLOUDFLARE_MODEL_REQUIRES_PAID_PLAN'],
  ] as const)('preserves Cloudflare failure semantics for HTTP %s / code %s', async (status, internalCode, expectedCode) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ input: {}, output: {} }))
      .mockResolvedValueOnce(failure(status, internalCode)) as unknown as typeof fetch;

    await expect(generateCloudflareRasterImageV15({ prompt: 'test' }, ENV, fetchMock))
      .rejects.toThrow(expectedCode);
  });

  it('keeps an ambiguous 429 failure fail-closed instead of assuming it is transient capacity', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ input: {}, output: {} }))
      .mockResolvedValueOnce(json({}, 429)) as unknown as typeof fetch;

    await expect(generateCloudflareRasterImageV15({ prompt: 'test' }, ENV, fetchMock))
      .rejects.toThrow('CLOUDFLARE_FREE_OR_CAPACITY_UNAVAILABLE');
  });
});
