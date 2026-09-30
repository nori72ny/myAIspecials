import { describe, expect, it } from 'vitest';
import { classifyCloudflareWorkersAiFailureV15 } from './cloudflareWorkersAiErrorV15';

function response(status: number, code?: number | string) {
  return new Response(JSON.stringify({
    success: false,
    errors: code === undefined ? [] : [{ code, message: 'redacted upstream detail' }],
  }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('cloudflareWorkersAiErrorV15', () => {
  it.each([
    [429, 3036, 'CLOUDFLARE_FREE_ALLOCATION_EXHAUSTED', false],
    [429, 3040, 'CLOUDFLARE_WORKERS_AI_CAPACITY_UNAVAILABLE', true],
    [403, 5035, 'CLOUDFLARE_MODEL_REQUIRES_PAID_PLAN', false],
    [401, 10000, 'CLOUDFLARE_WORKERS_AI_AUTH_REQUIRED', false],
  ] as const)('classifies Cloudflare status %s / code %s', async (status, internalCode, code, retryable) => {
    await expect(classifyCloudflareWorkersAiFailureV15(response(status, internalCode))).resolves.toEqual({
      code,
      retryable,
      internalCode,
      httpStatus: status,
    });
  });

  it('keeps unknown 429 failures fail-closed instead of assuming transient capacity', async () => {
    await expect(classifyCloudflareWorkersAiFailureV15(response(429))).resolves.toEqual({
      code: 'CLOUDFLARE_FREE_OR_CAPACITY_UNAVAILABLE',
      retryable: false,
      internalCode: null,
      httpStatus: 429,
    });
  });

  it('distinguishes access and paid-path failures from generic HTTP errors', async () => {
    await expect(classifyCloudflareWorkersAiFailureV15(response(403, 9999))).resolves.toMatchObject({
      code: 'CLOUDFLARE_WORKERS_AI_ACCESS_DENIED',
      retryable: false,
    });
    await expect(classifyCloudflareWorkersAiFailureV15(response(402))).resolves.toMatchObject({
      code: 'CLOUDFLARE_PAID_PATH_BLOCKED',
      retryable: false,
    });
    await expect(classifyCloudflareWorkersAiFailureV15(response(500))).resolves.toMatchObject({
      code: 'CLOUDFLARE_WORKERS_AI_HTTP_500',
      retryable: true,
    });
  });
});
