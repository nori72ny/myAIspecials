import { describe, expect, it, vi } from 'vitest';
import {
  CLOUDFLARE_RASTER_SEMANTIC_MODEL_V15,
  RASTER_SEMANTIC_AXES_V15,
  critiqueCloudflareRasterSemanticV15,
} from './cloudflareRasterSemanticCriticV15';

const ENV: NodeJS.ProcessEnv = {
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_API_TOKEN: `test-${'x'.repeat(40)}`,
};

function envelope(result: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
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
    headers: { 'content-type': 'application/json', ...extraHeaders },
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
function runEnvelope(answer: string, extraHeaders: Record<string, string> = {}) {
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
  }, 200, extraHeaders);
}

// Same nested run shape as runEnvelope but without any usage block, for
// exercising the cf-ai-neurons header fallback.
function runEnvelopeWithoutUsage(answer: string, extraHeaders: Record<string, string> = {}) {
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
  }, 200, extraHeaders);
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

// Every axis at exactly 0 — the shape the production critic returned when
// it echoed the prompt's old all-zero format example as its verdict.
function allZeroAnswer(overrides: Record<string, unknown> = {}) {
  return semanticAnswer({
    promptAdherence: 0,
    composition: 0,
    subjectIntegrity: 0,
    styleExecution: 0,
    textHandling: 0,
    artifactControl: 0,
    professionalUsefulness: 0,
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
    expect(body.max_tokens).toBe(1100);
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

  it('keeps the envelope usage as the primary report even when a cf-ai-neurons header is present', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(runEnvelope(semanticAnswer(), { 'cf-ai-neurons': '99.9' }));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '白い背景に高級腕時計の商品広告。文字は不要。',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.reportedNeurons).toBe(34.34);
  });

  it('falls back to the cf-ai-neurons header when the run envelope carries no usage block', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(runEnvelopeWithoutUsage(semanticAnswer(), { 'cf-ai-neurons': '36.50' }));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '白い背景に高級腕時計の商品広告。文字は不要。',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    expect(result.reportedNeurons).toBe(36.5);
  });

  it('reports null Neurons when the header is malformed or non-positive and the envelope has no usage', async () => {
    for (const headerValue of ['not-a-number', '0', '-1']) {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
        .mockResolvedValueOnce(envelope([]))
        .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
        .mockResolvedValueOnce(runEnvelopeWithoutUsage(semanticAnswer(), { 'cf-ai-neurons': headerValue }));

      const result = await critiqueCloudflareRasterSemanticV15({
        originalRequest: '白い背景に高級腕時計の商品広告。文字は不要。',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, fetchMock as unknown as typeof fetch);

      expect(result.reportedNeurons).toBeNull();
    }
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
      'subjectIntegrity-below-3',
      'professionalUsefulness-below-3',
    ]));
  });

  it('retries when a verdict lists defects yet scores every axis 4, then accepts the recalibrated verdict', async () => {
    // Parser policy (2026-11-10): a verdict that lists defects while
    // scoring every axis 4 contradicts the question's own calibration
    // rule — a found defect caps its axis at 3 — so the shape is a
    // format failure that rides the reminder retry instead of reaching
    // the gate; this exact verdict previously passed under diag16 §7 A.
    // That section still governs everything else: once the retry brings
    // the defect-bearing axes down to the calibration cap, the listed
    // defects remain diagnostic evidence, not a veto, and the verdict
    // passes on its scores.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const defects = [
        'left hand pinky joint bends at a slightly unnatural angle',
        'pagoda reflection in the pond is offset by a few pixels',
      ];
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
        .mockResolvedValueOnce(envelope([]))
        .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
        .mockResolvedValueOnce(runEnvelope(semanticAnswer({
          promptAdherence: 4,
          composition: 4,
          subjectIntegrity: 4,
          styleExecution: 4,
          textHandling: 4,
          artifactControl: 4,
          professionalUsefulness: 4,
          criticalIssues: defects,
        })))
        .mockResolvedValueOnce(runEnvelope(semanticAnswer({
          promptAdherence: 4,
          composition: 3,
          subjectIntegrity: 3,
          styleExecution: 4,
          textHandling: 4,
          artifactControl: 4,
          professionalUsefulness: 4,
          criticalIssues: defects,
        })));

      const result = await critiqueCloudflareRasterSemanticV15({
        originalRequest: '五重塔と池のある風景、手前に人物',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, fetchMock as unknown as typeof fetch);

      expect(result.passed).toBe(true);
      expect(result.safetyPassed).toBe(true);
      // The listed defects are retained verbatim as diagnostics.
      expect(result.issues).toEqual(defects);
      expect(result.checks).toHaveLength(7);
      expect(result.externalNetworkRequests).toBe(5);
      // The first answer failed format validation with the near-perfect
      // inconsistency detail — that failure is what fired the retry.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [tag, record] = errorSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(tag).toBe('[raster-semantic-critic] response failed validation');
      expect(record).toMatchObject({ detail: 'verdict-inconsistent:defects-with-near-perfect-scores', attempt: 1 });
      // The retry's reminder names the contradiction and its remedy.
      const retryInit = fetchMock.mock.calls[4]?.[1] as RequestInit;
      const retryBody = JSON.parse(String(retryInit.body));
      expect(retryBody.question).toContain('FORMAT REMINDER');
      expect(retryBody.question).toContain('lists defects while scoring every axis 4 also contradicts the scoring rules');
      expect(retryBody.question).toContain('a found defect caps its axis at 3');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('fails closed when the retry also lists defects with every axis at 4', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const nearPerfect = semanticAnswer({
        promptAdherence: 4,
        composition: 4,
        subjectIntegrity: 4,
        styleExecution: 4,
        textHandling: 4,
        artifactControl: 4,
        professionalUsefulness: 4,
        criticalIssues: ['the horizon line is visibly tilted'],
      });
      await expect(critiqueCloudflareRasterSemanticV15({
        originalRequest: '夕日の海辺の風景',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(nearPerfect) as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');

      expect(errorSpy).toHaveBeenCalledTimes(2);
      const records = errorSpy.mock.calls.map(call => call[1] as Record<string, unknown>);
      expect(records[0]).toMatchObject({ detail: 'verdict-inconsistent:defects-with-near-perfect-scores', attempt: 1 });
      expect(records[1]).toMatchObject({ detail: 'verdict-inconsistent:defects-with-near-perfect-scores', attempt: 2 });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('accepts a defects-with-perfect-scores verdict whose safety judgment fails, without the inconsistency check', async () => {
    // safetyPassed=false is exempt from the near-perfect consistency
    // check, exactly as it is from the all-zero one: the safety failure
    // is a real verdict the gate must see and reject on safety grounds,
    // not a format failure to retry away.
    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '架空の商品広告',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(semanticAnswer({
      promptAdherence: 4,
      composition: 4,
      subjectIntegrity: 4,
      styleExecution: 4,
      textHandling: 4,
      artifactControl: 4,
      professionalUsefulness: 4,
      safetyPassed: false,
      safetyIssues: ['graphic gore is visibly present'],
      criticalIssues: ['a visible open wound on the subject'],
    })) as unknown as typeof fetch);

    expect(result.passed).toBe(false);
    expect(result.safetyPassed).toBe(false);
    expect(result.issues).toContain('visible-output-safety-failed');
    // No format retry was consumed: the single critic call was accepted
    // as a verdict on the first attempt.
    expect(result.externalNetworkRequests).toBe(4);
  });

  it('accepts a differentiated verdict with defects in a single attempt', async () => {
    // A judged verdict with per-axis differences and defects whose axes
    // respect the calibration cap parses exactly as before: no format
    // error, no retry, and the gate verdict follows the scores (mean
    // 26/7 ≥ 3.5, every axis ≥ 3).
    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '五重塔と池のある風景',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(semanticAnswer({
      promptAdherence: 4,
      composition: 3,
      subjectIntegrity: 4,
      styleExecution: 3,
      textHandling: 4,
      artifactControl: 4,
      professionalUsefulness: 4,
      criticalIssues: ['pagoda reflection in the pond is offset by a few pixels'],
    })) as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    expect(result.issues).toEqual(['pagoda reflection in the pond is offset by a few pixels']);
    expect(result.externalNetworkRequests).toBe(4);
  });

  it('passes a verdict whose defect-bearing axis sits exactly at the floor of 3', async () => {
    // diag16 §7 D: the question's calibration rule caps a defect-bearing
    // axis at 3, so the gate floor is 3. One axis at exactly 3 with the
    // rest at 4 (mean 27/7 ≈ 3.86) is a deliverable verdict; the previous
    // 3.4/3.3 thresholds rejected it because an integer 3 is below both.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(runEnvelope(semanticAnswer({
        promptAdherence: 4,
        composition: 3,
        subjectIntegrity: 4,
        styleExecution: 4,
        textHandling: 4,
        artifactControl: 4,
        professionalUsefulness: 4,
        criticalIssues: ['horizon line tilts slightly to the right'],
      })));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '夕日の海辺の風景',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    expect(result.issues).toEqual(['horizon line tilts slightly to the right']);
  });

  it('fails on safety alone even with perfect scores and no listed defects', async () => {
    // The safety judgment is never relaxed by the gate realignment: a
    // safety failure fails closed no matter how high the quality scores
    // are and even when the critic lists no quality defects at all.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(runEnvelope(semanticAnswer({
        promptAdherence: 4,
        composition: 4,
        subjectIntegrity: 4,
        styleExecution: 4,
        textHandling: 4,
        artifactControl: 4,
        professionalUsefulness: 4,
        safetyPassed: false,
        safetyIssues: ['graphic gore is visibly present'],
        criticalIssues: [],
      })));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '安全な架空の商品広告',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(false);
    expect(result.safetyPassed).toBe(false);
    expect(result.issues).toContain('visible-output-safety-failed');
  });

  it('fails when the mean is below 3.5 even with no defects and every axis at or above the floor', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(runEnvelope(semanticAnswer({
        promptAdherence: 3.2,
        composition: 3.2,
        subjectIntegrity: 3.2,
        styleExecution: 3.2,
        textHandling: 3.2,
        artifactControl: 3.2,
        professionalUsefulness: 3.2,
        criticalIssues: [],
      })));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(false);
    expect(result.issues).toEqual([]);
    expect(result.safetyPassed).toBe(true);
  });

  it('fails when a serious defect pulls one axis below the floor, even with a passing mean', async () => {
    // Severity reaches the gate through the scores: under the calibration
    // rule a serious defect scores its axis low. Mean here is
    // (4*6 + 1) / 7 ≈ 3.57 ≥ 3.5, so only the axis floor rejects it.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(runEnvelope(semanticAnswer({
        promptAdherence: 4,
        composition: 4,
        subjectIntegrity: 1,
        styleExecution: 4,
        textHandling: 4,
        artifactControl: 4,
        professionalUsefulness: 4,
        criticalIssues: ['the watch face is melted and its hands are unreadable'],
      })));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '腕時計の商品広告',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'the watch face is melted and its hands are unreadable',
      'subjectIntegrity-below-3',
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
    const contradictory = semanticAnswer({
      safetyPassed: true,
      safetyIssues: ['unsafe visible content'],
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(runEnvelope(contradictory))
      // The format retry replays the same contradictory payload and the
      // safety-consistency check still rejects it.
      .mockResolvedValueOnce(runEnvelope(contradictory));

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
      .mockResolvedValueOnce(runEnvelope('Looks good to me.'))
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
      .mockResolvedValueOnce(runEnvelope(semanticAnswer(overrides)))
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
      .mockResolvedValueOnce(envelope({ result: { caption: null, finish_reason: 'stop' }, usage: {} }))
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
      .mockResolvedValueOnce(runEnvelope(answer))
      // A format-invalid first answer triggers the critic's single retry,
      // which replays the same answer here; acceptance-path tests simply
      // never consume this fifth response.
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
    // score math must not move. (The gate's axis floor was later realigned
    // from 3.4/3.3 to 3 by diag16 §7 D; this payload still fails either way
    // — two axes at 0 are below any floor and the mean is 20/7 < 3.5.)
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
      'textHandling-below-3',
      'artifactControl-below-3',
    ]));
    expect(result.safetyPassed).toBe(true);
  });

  it('instructs the critic to hunt for concrete defects before scoring', async () => {
    // Discrimination fix (2026-11-07 quality-inspection batch 1): the critic
    // saturated at 4/4 on every axis for all six delivered images while human
    // review found real defects — malformed piano-playing fingers, a pagoda
    // with four roof tiers instead of five, a slightly inconsistent mirror
    // reflection, garbled book-spine text. The generic scoring instructions
    // never made the model look for these, so the question must order an
    // active defect hunt with concrete checks and a calibrated scale.
    const fetchMock = criticFetch(semanticAnswer());

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: 'ピアノを弾く少女の手元と、五重塔のある風景',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    const init = fetchMock.mock.calls[3]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    // The hunt itself, before any scoring.
    expect(body.question).toContain('actively hunt for defects');
    expect(body.question).toContain('score only what you actually observed');
    // 1. Anatomy: count fingers and inspect joints, nails, faces.
    expect(body.question).toContain('a natural hand has exactly five fingers');
    expect(body.question).toContain('fused, missing, extra, duplicated, or unnaturally bent fingers');
    expect(body.question).toContain('facial features symmetric and coherent');
    // 2. Countable structures: actually count, compare against reality.
    expect(body.question).toContain('actually count them');
    expect(body.question).toContain('a five-story pagoda has exactly five roof tiers');
    // 3. Reflections: compare against the source, left-right reversal.
    expect(body.question).toContain('compare the reflection against its source');
    expect(body.question).toContain('left-right reversal must hold');
    // 4. Text: read it all, quote the garbled strings.
    expect(body.question).toContain('read every piece of visible text in the image');
    expect(body.question).toContain('Misspelled, garbled, or meaningless character strings are concrete defects');
    // 5. Calibration: a found defect caps its axis at 3 and must be listed.
    expect(body.question).toContain('score that axis 3 or lower and list the defect in criticalIssues');
    expect(body.question).toContain('Score from observed facts, not from how good the image feels overall');
    expect(body.question).toContain('criticalIssues must list every concrete visible defect found in the hunt above');
    expect(body.question).toContain('maximum 8 entries');
    // The pre-existing instructions stay in force.
    expect(body.question).toContain('For textHandling: score 4 when the image contains no text and no text was requested');
    expect(body.question).toContain('For artifactControl: score 4 when no artifacts');
    expect(body.question).toContain('Independently inspect visible output safety');
    expect(body.question).toContain('Return ONLY valid compact JSON');
  });

  it('states the output contract up front and again at the end of the question', async () => {
    const fetchMock = criticFetch(semanticAnswer());

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    expect(result.adjustments).toEqual([]);
    const init = fetchMock.mock.calls[3]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    // Up-front limits, matching the parser's bounds with headroom.
    expect(body.question).toContain('Output limits that bind your answer');
    expect(body.question).toContain('the summary must be at most 400 characters');
    expect(body.question).toContain('criticalIssues must contain at most 8 entries');
    expect(body.question).toContain('whenever safetyPassed is true, safetyIssues must be exactly an empty array');
    // Restated at the end: summary bound, then JSON-only as the final line.
    expect(body.question).toContain('The summary must be at most 400 characters — one or two sentences that state the verdict.');
    expect(body.question.trimEnd().endsWith('Answer with the JSON object only: no prose, no markdown code fences, and no text before or after the JSON.')).toBe(true);
    // The defect hunt itself is unchanged.
    expect(body.question).toContain('actively hunt for defects');
  });

  it('shows a type-only format template with no numeric score vector to copy', async () => {
    const fetchMock = criticFetch(semanticAnswer());

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    const init = fetchMock.mock.calls[3]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    // The template pins the exact key names and value types, and nothing
    // else: every axis value is a placeholder string, so there is no
    // score vector in the question that could be echoed back as a
    // verdict. (Both concrete examples that preceded this — all-zero,
    // then #1185's mixed 3/2/3/2/4/2/3 — were echoed verbatim in
    // production; changing the numbers only changed what was copied.)
    expect(body.question).toContain('{"promptAdherence":"<integer 0-4>","composition":"<integer 0-4>","subjectIntegrity":"<integer 0-4>","styleExecution":"<integer 0-4>","textHandling":"<integer 0-4>","artifactControl":"<integer 0-4>","professionalUsefulness":"<integer 0-4>"');
    expect(body.question).toContain('FORMAT TEMPLATE ONLY');
    // Stated around the template and again after it: no sample answer
    // exists and each score must come from judging this image alone.
    expect(body.question).toContain('There is no sample answer');
    expect(body.question).toContain('you choose by judging this image alone');
    expect(body.question).toContain('these instructions contain no sample scores');
    expect(body.question).toContain('the placeholders above are type labels, not values');
    // No axis is ever paired with a concrete number anywhere in the
    // question, in either of the retired example vectors' shapes.
    for (const axis of RASTER_SEMANTIC_AXES_V15) {
      expect(body.question).not.toMatch(new RegExp(`"${axis}":\\s*\\d`));
    }
    expect(body.question).not.toContain('FORMAT EXAMPLE ONLY');
  });

  it('rejects an answer that returns the template placeholders as scores', async () => {
    // A verbatim copy of the type template cannot become a verdict: the
    // placeholder strings are not numbers, so axis validation fails and
    // the answer rides the format-reminder retry, then fails closed.
    const templateCopy = JSON.stringify({
      promptAdherence: '<integer 0-4>',
      composition: '<integer 0-4>',
      subjectIntegrity: '<integer 0-4>',
      styleExecution: '<integer 0-4>',
      textHandling: '<integer 0-4>',
      artifactControl: '<integer 0-4>',
      professionalUsefulness: '<integer 0-4>',
      safetyPassed: true,
      safetyIssues: [],
      criticalIssues: [],
      summary: 'Copied template.',
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(critiqueCloudflareRasterSemanticV15({
        originalRequest: '静かな湖の写真',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(templateCopy) as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');

      expect(errorSpy).toHaveBeenCalledTimes(2);
      const records = errorSpy.mock.calls.map(call => call[1] as Record<string, unknown>);
      expect(records[0]).toMatchObject({ detail: 'axis-score-invalid:promptAdherence', attempt: 1 });
      expect(records[1]).toMatchObject({ detail: 'axis-score-invalid:promptAdherence', attempt: 2 });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('rejects an all-zero, defect-free, safety-passing verdict as inconsistent and retries with the reminder', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
        .mockResolvedValueOnce(envelope([]))
        .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
        .mockResolvedValueOnce(runEnvelope(allZeroAnswer({
          summary: 'The image could not be assessed on any axis.',
        })))
        .mockResolvedValueOnce(runEnvelope(semanticAnswer()));

      const result = await critiqueCloudflareRasterSemanticV15({
        originalRequest: '青い空と白い雲、緑の丘の風景',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, fetchMock as unknown as typeof fetch);

      expect(result.passed).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(result.externalNetworkRequests).toBe(5);
      // The first attempt failed format validation with the inconsistency
      // detail — that failure is what fired the retry.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [tag, record] = errorSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(tag).toBe('[raster-semantic-critic] response failed validation');
      expect(record).toMatchObject({ detail: 'verdict-inconsistent:all-zero-scores-without-issues', attempt: 1 });
      // The retry's reminder forbids returning the template placeholders
      // or an unexamined uniform score set, and names the all-zero
      // contradiction explicitly.
      const retryInit = fetchMock.mock.calls[4]?.[1] as RequestInit;
      const retryBody = JSON.parse(String(retryInit.body));
      expect(retryBody.question).toContain('FORMAT REMINDER');
      expect(retryBody.question).toContain('the template placeholders are type labels, not values');
      expect(retryBody.question).toContain('never return a uniform or patterned set of scores you did not derive from this image');
      expect(retryBody.question).toContain('every axis at 0 and no defects listed contradicts the scoring rules');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('fails closed when the retry also returns the all-zero, defect-free verdict', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(critiqueCloudflareRasterSemanticV15({
        originalRequest: '静かな湖の写真',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(allZeroAnswer({
        summary: 'The image could not be assessed on any axis.',
      })) as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');

      expect(errorSpy).toHaveBeenCalledTimes(2);
      const records = errorSpy.mock.calls.map(call => call[1] as Record<string, unknown>);
      expect(records[0]).toMatchObject({ detail: 'verdict-inconsistent:all-zero-scores-without-issues', attempt: 1 });
      expect(records[1]).toMatchObject({ detail: 'verdict-inconsistent:all-zero-scores-without-issues', attempt: 2 });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('accepts an all-zero verdict that lists defects, and the gate rejects it on scores', async () => {
    // All-zero scores WITH enumerated defects are self-consistent: the
    // image was observed to be unusable and the critic said why. The
    // payload parses normally — no format error — and the gate rejects
    // the candidate through the scores alone.
    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(allZeroAnswer({
      criticalIssues: ['the image is a blank gray rectangle with no visible subject'],
      summary: 'The image is unusable on every axis.',
    })) as unknown as typeof fetch);

    expect(result.passed).toBe(false);
    expect(result.safetyPassed).toBe(true);
    expect(result.score).toBe(0);
    expect(result.issues).toContain('the image is a blank gray rectangle with no visible subject');
    expect(result.issues).toContain('promptAdherence-below-3');
  });

  it('accepts an all-zero verdict whose safety judgment fails, without the inconsistency check', async () => {
    // safetyPassed=false is exempt from the all-zero consistency check:
    // the safety failure is a real verdict the gate must see and reject
    // on safety grounds, not a format failure to retry away.
    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '架空の商品広告',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(allZeroAnswer({
      safetyPassed: false,
      safetyIssues: ['graphic gore is visibly present'],
      summary: 'The image is unusable and unsafe.',
    })) as unknown as typeof fetch);

    expect(result.passed).toBe(false);
    expect(result.safetyPassed).toBe(false);
    expect(result.safetyIssues).toEqual(['graphic gore is visibly present']);
    expect(result.issues).toContain('visible-output-safety-failed');
  });

  it('truncates an over-limit summary instead of rejecting the verdict', async () => {
    // 601 characters: one over the parser bound of 600. The summary is
    // display text the verdict never consumes, so it is clipped to the
    // bound and the repair is recorded in adjustments.
    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '青い空と白い雲、緑の丘の風景',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(semanticAnswer({ summary: 'x'.repeat(601) })) as unknown as typeof fetch);

    expect(result.summary).toHaveLength(600);
    expect(result.adjustments).toEqual(['summary-truncated-from-601-to-600']);
    expect(result.passed).toBe(true);
  });

  it('truncates a ninth critical issue instead of rejecting the verdict', async () => {
    const nine = Array.from({ length: 9 }, (_, i) => `defect ${i + 1}`);
    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '五重塔のある風景',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(semanticAnswer({ criticalIssues: nine })) as unknown as typeof fetch);

    expect(result.issues).toEqual(nine.slice(0, 8));
    expect(result.adjustments).toEqual(['criticalIssues-truncated-from-9-to-8']);
    // The truncated list is preserved verbatim as diagnostic evidence. The
    // verdict itself follows the scores (diag16 §7 A): listed defects alone
    // no longer veto, and this fixture's scores clear the floor and the
    // mean, so the verdict passes. (Before the realignment this same
    // payload failed solely because the issues list was non-empty.)
    expect(result.passed).toBe(true);
  });

  it('truncates over-limit safety issues while keeping the safety judgment itself', async () => {
    const nine = Array.from({ length: 9 }, (_, i) => `safety reason ${i + 1}`);
    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '架空の商品広告',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(semanticAnswer({ safetyPassed: false, safetyIssues: nine })) as unknown as typeof fetch);

    expect(result.safetyPassed).toBe(false);
    expect(result.safetyIssues).toEqual(nine.slice(0, 8));
    expect(result.adjustments).toEqual(['safetyIssues-truncated-from-9-to-8']);
    expect(result.passed).toBe(false);
  });

  it('retries the critic call once with a format reminder when the first answer is unparseable prose', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
        .mockResolvedValueOnce(envelope([]))
        .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
        .mockResolvedValueOnce(runEnvelope('The image looks fine overall.'))
        .mockResolvedValueOnce(runEnvelope(semanticAnswer()));

      const result = await critiqueCloudflareRasterSemanticV15({
        originalRequest: '青い空と白い雲、緑の丘の風景',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, fetchMock as unknown as typeof fetch);

      expect(result.passed).toBe(true);
      expect(result.adjustments).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(5);
      // The retry counts toward the call's external requests honestly.
      expect(result.externalNetworkRequests).toBe(5);
      const retryInit = fetchMock.mock.calls[4]?.[1] as RequestInit;
      const retryBody = JSON.parse(String(retryInit.body));
      expect(retryBody.question).toContain('FORMAT REMINDER');
      expect(retryBody.question).toContain('Keep the summary at or below 400 characters');
      // The failed attempt was logged server-side with its sub-reason, and
      // the log record carries no raw answer text.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [tag, record] = errorSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(tag).toBe('[raster-semantic-critic] response failed validation');
      expect(record).toMatchObject({ detail: 'json-no-object-span', attempt: 1 });
      expect(Object.keys(record).sort()).toEqual([
        'answerChars', 'attempt', 'detail', 'finishReason', 'structure',
        'usageCompletionTokens', 'usageNeurons', 'usagePromptTokens', 'usageTotalTokens',
      ]);
      // The prose answer attempted no JSON at all: no opening brace, prose
      // lead-in. The envelope metadata rides along (runEnvelope carries
      // finish_reason 'stop' and the usage block).
      expect(record.structure).toEqual({
        hasOpeningBrace: false,
        firstBraceOffset: -1,
        braceClosed: false,
        maxBraceDepth: 0,
        startsWithProse: true,
        hasCodeFence: false,
      });
      expect(record).toMatchObject({
        finishReason: 'stop',
        usageNeurons: 34.34,
        usagePromptTokens: 836,
        usageCompletionTokens: 127,
        usageTotalTokens: 963,
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('logs the specific validation condition when both attempts fail validation', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const missingAxis = semanticAnswer({ composition: undefined });
      await expect(critiqueCloudflareRasterSemanticV15({
        originalRequest: '静かな湖の写真',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(missingAxis) as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');

      expect(errorSpy).toHaveBeenCalledTimes(2);
      const records = errorSpy.mock.calls.map(call => call[1] as Record<string, unknown>);
      expect(records[0]).toMatchObject({ detail: 'axis-score-invalid:composition', attempt: 1 });
      expect(records[1]).toMatchObject({ detail: 'axis-score-invalid:composition', attempt: 2 });
      expect(records[0]?.answerChars).toBe(missingAxis.length);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('records prose-only structure and never the answer text when no JSON is attempted', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const prose = 'XYZZY-UNIQUE-MARKER: the image looks fine overall and needs no changes.';
      await expect(critiqueCloudflareRasterSemanticV15({
        originalRequest: '静かな湖の写真',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(prose) as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');

      expect(errorSpy).toHaveBeenCalledTimes(2);
      const records = errorSpy.mock.calls.map(call => call[1] as Record<string, unknown>);
      for (const record of records) {
        expect(record.detail).toBe('json-no-object-span');
        // Case (i): the model attempted no JSON at all — no opening
        // brace anywhere, and the answer leads with prose.
        expect(record.structure).toEqual({
          hasOpeningBrace: false,
          firstBraceOffset: -1,
          braceClosed: false,
          maxBraceDepth: 0,
          startsWithProse: true,
          hasCodeFence: false,
        });
        // Classification only: no fragment of the answer reaches the log.
        expect(JSON.stringify(record)).not.toContain('XYZZY-UNIQUE-MARKER');
        expect(JSON.stringify(record)).not.toContain('needs no changes');
      }
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('records an unclosed object span when the JSON answer is cut off mid-object', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // The production shape of an output-token cutoff: the flat verdict
      // object starts, runs, and stops before its closing brace exists.
      const truncated = semanticAnswer().slice(0, 90);
      expect(truncated.startsWith('{')).toBe(true);
      expect(truncated).not.toContain('}');
      await expect(critiqueCloudflareRasterSemanticV15({
        originalRequest: '静かな湖の写真',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(truncated) as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');

      expect(errorSpy).toHaveBeenCalledTimes(2);
      const records = errorSpy.mock.calls.map(call => call[1] as Record<string, unknown>);
      for (const record of records) {
        expect(record.detail).toBe('json-no-object-span');
        // Case (ii): same detail as prose-only, told apart by the
        // structure alone — an object began at offset 0 and never closed.
        expect(record.structure).toEqual({
          hasOpeningBrace: true,
          firstBraceOffset: 0,
          braceClosed: false,
          maxBraceDepth: 1,
          startsWithProse: false,
          hasCodeFence: false,
        });
      }
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('records a closed span when a complete object still does not parse', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // The braces balance and close, so the structure alone rules out
      // the truncation hypothesis; the contents are simply not JSON.
      const unparseable = '{promptAdherence: 4, summary: "looks fine"}';
      await expect(critiqueCloudflareRasterSemanticV15({
        originalRequest: '静かな湖の写真',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(unparseable) as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');

      expect(errorSpy).toHaveBeenCalledTimes(2);
      const records = errorSpy.mock.calls.map(call => call[1] as Record<string, unknown>);
      for (const record of records) {
        expect(record.detail).toBe('json-unparseable');
        // Case (iii): a complete object span exists but is not valid
        // JSON — brace correspondence itself is intact.
        expect(record.structure).toMatchObject({
          hasOpeningBrace: true,
          firstBraceOffset: 0,
          braceClosed: true,
          maxBraceDepth: 1,
          startsWithProse: false,
          hasCodeFence: false,
        });
      }
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('logs the verdict numbers and failed conditions when the gate rejects on the mean alone', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Every axis exactly at the floor of 3: no axis condition fires and
      // safety passes, but the mean 3.0 is below 3.5, so the rejection is
      // attributable to the average alone.
      const allAxesThree = {
        promptAdherence: 3,
        composition: 3,
        subjectIntegrity: 3,
        styleExecution: 3,
        textHandling: 3,
        artifactControl: 3,
        professionalUsefulness: 3,
      };
      const result = await critiqueCloudflareRasterSemanticV15({
        originalRequest: '静かな湖の写真',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(semanticAnswer({ ...allAxesThree, criticalIssues: ['a minor visible defect'] })) as unknown as typeof fetch);

      expect(result.passed).toBe(false);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [tag, record] = errorSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(tag).toBe('[raster-semantic-critic] verdict rejected');
      expect(record).toMatchObject({
        passed: false,
        safetyPassed: true,
        safetyIssuesCount: 0,
        criticalIssuesCount: 1,
        failedConditions: ['average-below-3.5'],
        adjustments: [],
      });
      expect(record.average).toBeCloseTo(3, 10);
      expect(record.scores).toEqual(allAxesThree);
      expect(Object.keys(record).sort()).toEqual([
        'adjustments', 'average', 'criticalIssuesCount', 'failedConditions',
        'passed', 'safetyIssuesCount', 'safetyPassed', 'scores',
      ]);
      // Numbers and identifiers only: neither the summary text nor the
      // listed issue's text ever reaches the record.
      const serialized = JSON.stringify(record);
      expect(serialized).not.toContain('a minor visible defect');
      expect(serialized).not.toContain('professionally composed');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('logs each axis below the floor as its own failed condition', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // composition 2 with every other axis 4: the mean (26/7) clears 3.5,
      // so the floor breach is the only failing condition.
      const result = await critiqueCloudflareRasterSemanticV15({
        originalRequest: '静かな湖の写真',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(semanticAnswer({
        promptAdherence: 4,
        composition: 2,
        subjectIntegrity: 4,
        styleExecution: 4,
        textHandling: 4,
        artifactControl: 4,
        professionalUsefulness: 4,
      })) as unknown as typeof fetch);

      expect(result.passed).toBe(false);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [, record] = errorSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(record.failedConditions).toEqual(['axis-below-3:composition']);
      expect(record.average).toBeCloseTo(26 / 7, 10);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('logs the safety condition and only the count of safety reasons when safety fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Perfect axis scores cannot rescue a safety failure.
      const result = await critiqueCloudflareRasterSemanticV15({
        originalRequest: '架空の商品広告',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(semanticAnswer({
        promptAdherence: 4,
        composition: 4,
        subjectIntegrity: 4,
        styleExecution: 4,
        textHandling: 4,
        artifactControl: 4,
        professionalUsefulness: 4,
        safetyPassed: false,
        safetyIssues: ['graphic gore is visibly present'],
      })) as unknown as typeof fetch);

      expect(result.passed).toBe(false);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [, record] = errorSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(record).toMatchObject({
        passed: false,
        safetyPassed: false,
        safetyIssuesCount: 1,
        failedConditions: ['safety'],
      });
      // The reason's text itself is never recorded — only its count.
      expect(JSON.stringify(record)).not.toContain('graphic gore');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('records parser adjustments in the verdict log when a rejected answer needed repairs', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const nine = Array.from({ length: 9 }, (_, i) => `defect ${i + 1}`);
      const result = await critiqueCloudflareRasterSemanticV15({
        originalRequest: '五重塔のある風景',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(semanticAnswer({
        promptAdherence: 3,
        composition: 3,
        subjectIntegrity: 3,
        styleExecution: 3,
        textHandling: 3,
        artifactControl: 3,
        professionalUsefulness: 3,
        criticalIssues: nine,
      })) as unknown as typeof fetch);

      expect(result.passed).toBe(false);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [, record] = errorSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(record.adjustments).toEqual(['criticalIssues-truncated-from-9-to-8']);
      expect(record.criticalIssuesCount).toBe(8);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not log a verdict record when the candidate passes', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await critiqueCloudflareRasterSemanticV15({
        originalRequest: '静かな湖の写真',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(semanticAnswer()) as unknown as typeof fetch);

      expect(result.passed).toBe(true);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it.each([
    ['a non-string entry among nine critical issues', { criticalIssues: [...Array.from({ length: 8 }, (_, i) => `defect ${i + 1}`), 42] }],
    ['a blank entry among the safety issues', { safetyPassed: false, safetyIssues: ['graphic gore is visibly present', '   '] }],
  ])('still rejects a list with %s instead of repairing it', async (_label, overrides) => {
    await expect(critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(semanticAnswer(overrides)) as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  });

  it('still rejects safetyPassed=true with over-limit safety issues after truncation', async () => {
    // Truncation repairs the count, never the contradiction: nine listed
    // reasons clipped to eight still contradict a passing safety flag.
    const nine = Array.from({ length: 9 }, (_, i) => `reason ${i + 1}`);
    await expect(critiqueCloudflareRasterSemanticV15({
      originalRequest: '安全な架空の商品広告',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(semanticAnswer({ safetyPassed: true, safetyIssues: nine })) as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
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
