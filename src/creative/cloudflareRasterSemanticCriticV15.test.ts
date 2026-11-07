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
    // v2 plan proof requires a verifiably complete subscriptions read.
    ...(Array.isArray(result) ? {
      result_info: { count: result.length, page: 1, per_page: 20, total_count: result.length },
    } : {}),
    errors: [],
    messages: [],
  }), {
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

function png() {
  const bytes = Buffer.alloc(96);
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(bytes,0);
  return bytes;
}

// Live-verified run-response shape (production probe, 2026-11-07): the vision
// model's own output object is nested one level deeper, alongside a usage
// block — { result: { result: { answer, caption, ... }, usage } }.
function runEnvelope(answer: string) {
  return envelope({
    result: {
      answer,
      caption: null,
      finish_reason: 'stop',
      metrics: { decode_time_ms: 1422.28, input_tokens: 836, output_tokens: 127, prefill_time_ms: 69.71, ttft_ms: 105.32 },
      objects: null,
      points: null,
      reasoning: null,
    },
    usage: { prompt_tokens: 836, completion_tokens: 127, total_tokens: 963, neurons: 34.34 },
  });
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
    safetyPassed: true,
    safetyIssues: [],
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
      .mockResolvedValueOnce(runEnvelope(semanticAnswer()));

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
      costEvidence: 'free-allocation-preflight-only; per-request-usage-unverified',
      paidFallbackEnabled: false,
      secretDelivery: 'server-only',
      externalNetworkRequests: 4,
      safetyPassed: true,
      safetyIssues: [],
      // The live-verified envelope carries result.usage.neurons (34.34 in the
      // runEnvelope fixture); the critic surfaces it verbatim for the
      // caller's post-generation reconciliation.
      reportedNeurons: 34.34,
    });
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/ai/models/schema?model=%40cf%2Fmoondream%2Fmoondream3.1-9B-A2B');
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain('/ai/run/@cf/moondream/moondream3.1-9B-A2B');
    const init = fetchMock.mock.calls[3]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${ENV.CLOUDFLARE_API_TOKEN}`);
    const body = JSON.parse(String(init.body));
    expect(body.task).toBe('query');
    expect(body.reasoning).toBe(false);
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(900);
    expect(body.image).toMatch(/^data:image\/png;base64,/);
    expect(body.question).toContain('Return ONLY valid compact JSON');
    // Axis-semantics calibration (2026-11-07 production probe): the model had
    // answered textHandling/artifactControl as defect counts (0 = none found),
    // so the question must state explicitly that absence scores high.
    expect(body.question).toContain('For textHandling: score 4 when the image contains no text and no text was requested');
    expect(body.question).toContain('For artifactControl: score 4 when no artifacts');
  });

  it('reports null Neurons when the run response carries no usage block', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(envelope({ answer: semanticAnswer() }));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '白い背景に高級腕時計の商品広告。文字は不要。',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    expect(result.reportedNeurons).toBeNull();
  });

  it('does not invoke the critic when its exact model schema is unavailable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: null, output: null }));

    await expect(critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch)).rejects.toThrow('CLOUDFLARE_WORKERS_AI_MODEL_UNVERIFIED');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/ai/models/schema?model=%40cf%2Fmoondream%2Fmoondream3.1-9B-A2B');
  });

  it('fails semantic quality when material visible defects are reported', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(runEnvelope(semanticAnswer({
        subjectIntegrity: 2.2,
        professionalUsefulness: 2.5,
        criticalIssues: ['watch-face geometry is visibly distorted'],
      })));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '腕時計の商品広告',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'watch-face geometry is visibly distorted',
      'subjectIntegrity-below-3.4',
      'professionalUsefulness-below-3.4',
    ]));
  });

  it('fails closed when the visible-output safety judgment is negative', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(runEnvelope(semanticAnswer({
        safetyPassed: false,
        safetyIssues: ['graphic gore is visibly present'],
      })));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '安全な架空の商品広告',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(false);
    expect(result.safetyPassed).toBe(false);
    expect(result.safetyIssues).toEqual(['graphic gore is visibly present']);
    expect(result.issues).toContain('visible-output-safety-failed');
  });

  it('rejects contradictory safety payloads rather than guessing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(runEnvelope(semanticAnswer({
        safetyPassed: true,
        safetyIssues: ['unsafe visible content'],
      })));

    await expect(critiqueCloudflareRasterSemanticV15({
      originalRequest: '安全な架空の商品広告',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  });

  it('rejects malformed model output instead of guessing a score', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(runEnvelope('Looks good to me.'));

    await expect(critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  });

  it('parses the live double-nested run response whose answer is pretty-printed JSON', async () => {
    // Mirrors the production probe of 2026-11-07: the answer string carries
    // newline/indentation-formatted JSON, not compact JSON.
    const prettyAnswer = JSON.stringify(JSON.parse(semanticAnswer()), null, 2);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(runEnvelope(prettyAnswer));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '白い背景に高級腕時計の商品広告。文字は不要。',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    expect(result.scores.promptAdherence).toBe(3.8);
    expect(result.summary).toBe('The requested subject is coherent and professionally composed.');
  });

  it('still accepts the flat result.answer shape as a fallback', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(envelope({ answer: semanticAnswer() }));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    expect(result.model).toBe(CLOUDFLARE_RASTER_SEMANTIC_MODEL_V15);
  });

  it.each([
    ['a missing axis', { composition: undefined }],
    ['an out-of-range axis score', { promptAdherence: 4.5 }],
  ])('rejects a nested answer with %s instead of guessing', async (_label, overrides) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(runEnvelope(semanticAnswer(overrides)));

    await expect(critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  });

  it('fails closed when neither the nested nor the flat answer is a string', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(envelope({ result: { caption: null, finish_reason: 'stop' }, usage: {} }));

    await expect(critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  });

  function criticFetch(answer: string) {
    return vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(runEnvelope(answer));
  }

  it('accepts a JSON answer wrapped in a markdown code fence', async () => {
    const fenced = '```json\n' + semanticAnswer() + '\n```';

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '白い背景に高級腕時計の商品広告。文字は不要。',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(fenced) as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    expect(result.scores.promptAdherence).toBe(3.8);
    expect(result.summary).toBe('The requested subject is coherent and professionally composed.');
  });

  it('accepts a JSON answer preceded by prose by extracting the outermost object', async () => {
    const prefixed = 'Here is my evaluation of the image:\n' + semanticAnswer() + '\nThat concludes the review.';

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(prefixed) as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    expect(result.scores.composition).toBe(3.6);
  });

  it.each([
    ['a missing axis', { composition: undefined }],
    ['an out-of-range axis score', { promptAdherence: 4.5 }],
  ])('still rejects an extracted payload with %s instead of guessing', async (_label, overrides) => {
    const wrapped = 'Evaluation follows.\n```json\n' + semanticAnswer(overrides) + '\n```';

    await expect(critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(wrapped) as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  });

  it('parses the diag9 production payload unchanged (parsing and score math are not recalibrated)', async () => {
    // Mirrors the 2026-11-07 production probe for a genuinely good generated
    // image (red apple on a white background, studio photograph): every
    // content axis scored 4 with a laudatory summary, yet textHandling and
    // artifactControl came back 0 because the model answered those two axes
    // as defect counts. The payload must parse exactly as before and the
    // gate math must not move — the calibration fix lives in the question
    // wording, not in parsing, thresholds, or scoring.
    const diag9Answer = JSON.stringify({
      promptAdherence: 4,
      composition: 4,
      subjectIntegrity: 4,
      styleExecution: 4,
      textHandling: 0,
      artifactControl: 0,
      professionalUsefulness: 4,
      safetyPassed: true,
      safetyIssues: [],
      criticalIssues: [],
      summary: 'A clean studio photograph of a red apple on a white background, exactly as requested.',
    }, null, 2);

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '白背景の赤いリンゴ、スタジオ写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(diag9Answer) as unknown as typeof fetch);

    expect(result.scores).toEqual({
      promptAdherence: 4,
      composition: 4,
      subjectIntegrity: 4,
      styleExecution: 4,
      textHandling: 0,
      artifactControl: 0,
      professionalUsefulness: 4,
    });
    // (4+4+4+4+0+0+4) / 7 axes / 4 max * 100 = 71.4 -> 71, unchanged.
    expect(result.score).toBe(71);
    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'textHandling-below-3.3',
      'artifactControl-below-3.4',
    ]));
    expect(result.safetyPassed).toBe(true);
  });

  it.each([
    [429, 3036, 'CLOUDFLARE_FREE_ALLOCATION_EXHAUSTED'],
    [429, 3040, 'CLOUDFLARE_WORKERS_AI_CAPACITY_UNAVAILABLE'],
    [403, 5035, 'CLOUDFLARE_MODEL_REQUIRES_PAID_PLAN'],
  ] as const)('preserves semantic-critic Cloudflare failure semantics for HTTP %s / code %s', async (status, internalCode, expectedCode) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(failure(status, internalCode));

    await expect(critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch)).rejects.toThrow(expectedCode);
  });
});
