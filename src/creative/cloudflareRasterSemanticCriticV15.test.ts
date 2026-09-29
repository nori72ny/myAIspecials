import { describe, expect, it, vi } from 'vitest';
import {
  CLOUDFLARE_RASTER_SEMANTIC_MODEL_V15,
  critiqueCloudflareRasterSemanticV15,
} from './cloudflareRasterSemanticCriticV15';

const ENV: NodeJS.ProcessEnv = {
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_API_TOKEN: `test-${'x'.repeat(40)}`,
};

function envelope(result: unknown, status = 200) {
  return new Response(JSON.stringify({
    success: status >= 200 && status < 300,
    result,
    errors: [],
    messages: [],
  }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function png() {
  const bytes = Buffer.alloc(96);
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(bytes,0);
  return bytes;
}

function semanticAnswer(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    promptAdherence: 3.8,
    composition: 3.6,
    subjectIntegrity: 3.7,
    styleExecution: 3.5,
    textHandling: 3.4,
    artifactControl: 3.8,
    professionalUsefulness: 3.6,
    criticalIssues: [],
    summary: 'The requested subject is coherent and professionally composed.',
    ...overrides,
  });
}

describe('cloudflareRasterSemanticCriticV15', () => {
  it('fails closed without server-only credentials', async () => {
    await expect(critiqueCloudflareRasterSemanticV15({
      originalRequest: '高級感のある商品広告',
      bytes: png(),
      mimeType: 'image/png',
    }, {})).rejects.toThrow('CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED');
  });

  it('re-verifies Workers Free before vision judgment and returns bounded semantic scores', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(envelope({ answer: semanticAnswer() }));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '白い背景に高級腕時計の商品広告。文字は不要。',
      exactText: [],
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result).toMatchObject({
      version: 'raster-semantic-critic-v1',
      passed: true,
      model: CLOUDFLARE_RASTER_SEMANTIC_MODEL_V15,
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      secretDelivery: 'server-only',
      externalNetworkRequests: 4,
    });
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain('/ai/run/@cf/moondream/moondream3.1-9B-A2B');
    const init = fetchMock.mock.calls[3]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${ENV.CLOUDFLARE_API_TOKEN}`);
    const body = JSON.parse(String(init.body));
    expect(body.task).toBe('query');
    expect(body.reasoning).toBe(false);
    expect(body.temperature).toBe(0);
    expect(body.image).toMatch(/^data:image\/png;base64,/);
    expect(body.question).toContain('Return ONLY valid compact JSON');
  });

  it('fails semantic quality when material visible defects are reported', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(envelope({
        answer: semanticAnswer({
          subjectIntegrity: 2.2,
          professionalUsefulness: 2.5,
          criticalIssues: ['watch-face geometry is visibly distorted'],
        }),
      }));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '腕時計の商品広告',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'watch-face geometry is visibly distorted',
      'subjectIntegrity-below-3',
      'professionalUsefulness-below-3',
    ]));
  });

  it('rejects malformed model output instead of guessing a score', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(envelope({ answer: 'Looks good to me.' }));

    await expect(critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  });

  it('treats paid-only access or exhausted free allocation as unavailable', async () => {
    for (const status of [402, 403, 429]) {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
        .mockResolvedValueOnce(envelope([]))
        .mockResolvedValueOnce(envelope({}, status));

      await expect(critiqueCloudflareRasterSemanticV15({
        originalRequest: '静かな湖の写真',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, fetchMock as unknown as typeof fetch)).rejects.toThrow('CLOUDFLARE_FREE_ALLOCATION_UNAVAILABLE');
    }
  });
});
