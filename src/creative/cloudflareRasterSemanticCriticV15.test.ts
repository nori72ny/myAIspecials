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

// The current answer contract: the model returns no numbers — each axis
// carries the list of defects it observed on that axis (empty when it
// observed none), plus the safety judgment and an optional summary. The
// default fixture is a defect-free verdict, which derives to all axes 4.
function semanticAnswer(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    promptAdherence: [],
    composition: [],
    subjectIntegrity: [],
    styleExecution: [],
    textHandling: [],
    artifactControl: [],
    professionalUsefulness: [],
    safetyPassed: true,
    safetyIssues: [],
    summary: 'The requested subject is coherent and professionally composed.',
    ...overrides,
  });
}

function defectList(count: number, label: string) {
  return Array.from({ length: count }, (_, i) => `${label} ${i + 1}`);
}

describe('cloudflareRasterSemanticCriticV15', () => {
  it('fails closed without server-only credentials', async () => {
    await expect(critiqueCloudflareRasterSemanticV15({
      originalRequest: '高級感のある商品広告',
      bytes: png(),
      mimeType: 'image/png',
    }, {})).rejects.toThrow('CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED');
  });

  it('re-verifies Workers Free before vision judgment and returns a defect-free verdict', async () => {
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
    // No defects on any axis derives to a perfect score.
    expect(result.scores).toEqual({
      promptAdherence: 4,
      composition: 4,
      subjectIntegrity: 4,
      styleExecution: 4,
      textHandling: 4,
      artifactControl: 4,
      professionalUsefulness: 4,
    });
    expect(result.score).toBe(100);
    expect(result.issues).toEqual([]);
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
    // The question asks for defect lists, never numbers: an axis list
    // stays empty exactly when nothing is wrong on that axis.
    expect(body.question).toContain('You never return numeric scores');
    expect(body.question).toContain('For textHandling: list a defect only when visible text is garbled, unwanted, misspelled, or incorrect');
    expect(body.question).toContain('For artifactControl: list every artifact, distortion, warped geometry, or malformed detail that is actually visible');
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

  it('reports null Neurons when the usage block carries no neurons value and no header is present', async () => {
    // The envelope carries a usage block, but it reports only token
    // counts — there is no neurons figure to adopt, and the
    // cf-ai-neurons header is absent as well.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(envelope({
        result: {
          answer: semanticAnswer(),
          caption: null,
          finish_reason: 'stop',
        },
        usage: { prompt_tokens: 836, completion_tokens: 127, total_tokens: 963 },
      }));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '白い背景に高級腕時計の商品広告。文字は不要。',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    expect(result.reportedNeurons).toBeNull();
    expect(result.reportedCallsNeurons).toEqual([null]);
  });

  it('counts the format retry first call in reportedCallsNeurons', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      // First call: the answer is not the contracted JSON, but the
      // envelope still reports the call's own 30 Neurons.
      .mockResolvedValueOnce(envelope({
        result: {
          answer: 'this is not the contracted JSON',
          caption: null,
          finish_reason: 'stop',
        },
        usage: { prompt_tokens: 800, completion_tokens: 90, total_tokens: 890, neurons: 30 },
      }))
      // Retry call: a valid verdict reporting 34.34 Neurons.
      .mockResolvedValueOnce(runEnvelope(semanticAnswer()));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '白い背景に高級腕時計の商品広告。文字は不要。',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    expect(result.externalNetworkRequests).toBe(5);
    // reportedNeurons stays the final call's report; the per-call list
    // keeps the failed first call's consumption for reconciliation.
    expect(result.reportedNeurons).toBe(34.34);
    expect(result.reportedCallsNeurons).toEqual([30, 34.34]);
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
    expect(result.reportedCallsNeurons).toEqual([36.5]);
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
    // Three defects on an axis derive to 2 — below the gate floor. Two
    // such axes also pull the derived mean (24/7) below 3.5.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(runEnvelope(semanticAnswer({
        subjectIntegrity: [
          'watch-face geometry is visibly distorted',
          'the crown is fused into the case',
          'the strap stitching melts into the leather',
        ],
        professionalUsefulness: [
          'the product is partly cropped out of the frame',
          'a visible watermark-like smudge sits over the product',
          'the background clashes with the brand palette',
        ],
      })));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '腕時計の商品広告',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(false);
    expect(result.scores.subjectIntegrity).toBe(2);
    expect(result.scores.professionalUsefulness).toBe(2);
    // Flattened findings keep their axis attribution.
    expect(result.issues).toEqual(expect.arrayContaining([
      'subjectIntegrity: watch-face geometry is visibly distorted',
      'professionalUsefulness: the product is partly cropped out of the frame',
      'subjectIntegrity-below-3',
      'professionalUsefulness-below-3',
    ]));
  });

  it('accepts a defect-bearing verdict in a single attempt and derives its scores from the defect counts', async () => {
    // One defect each on composition and subjectIntegrity derives those
    // axes to 3; every other axis is clean (4). Mean 26/7 ≥ 3.5 and no
    // axis below the floor, so the verdict passes exactly as returned —
    // the derivation is the server's, not something the retry negotiates.
    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '五重塔と池のある風景、手前に人物',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(semanticAnswer({
      composition: ['pagoda reflection in the pond is offset by a few pixels'],
      subjectIntegrity: ['left hand pinky joint bends at a slightly unnatural angle'],
    })) as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    expect(result.safetyPassed).toBe(true);
    expect(result.scores).toEqual({
      promptAdherence: 4,
      composition: 3,
      subjectIntegrity: 3,
      styleExecution: 4,
      textHandling: 4,
      artifactControl: 4,
      professionalUsefulness: 4,
    });
    expect(result.issues).toEqual([
      'composition: pagoda reflection in the pond is offset by a few pixels',
      'subjectIntegrity: left hand pinky joint bends at a slightly unnatural angle',
    ]);
    expect(result.checks).toHaveLength(7);
    expect(result.externalNetworkRequests).toBe(4);
  });

  it('rejects a numeric axis value as a format error, retries, and accepts the corrected defect lists', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
        .mockResolvedValueOnce(envelope([]))
        .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
        // The retired contract's shape: a number where the defect list
        // belongs. There is no numeric field left to accept it as.
        .mockResolvedValueOnce(runEnvelope(semanticAnswer({ promptAdherence: 4 })))
        .mockResolvedValueOnce(runEnvelope(semanticAnswer()));

      const result = await critiqueCloudflareRasterSemanticV15({
        originalRequest: '静かな湖の写真',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, fetchMock as unknown as typeof fetch);

      expect(result.passed).toBe(true);
      expect(result.externalNetworkRequests).toBe(5);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [tag, record] = errorSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(tag).toBe('[raster-semantic-critic] response failed validation');
      expect(record).toMatchObject({ detail: 'axis-defects-not-a-list:promptAdherence', attempt: 1 });
      // The retry's reminder states the list contract and the numeric ban.
      const retryInit = fetchMock.mock.calls[4]?.[1] as RequestInit;
      const retryBody = JSON.parse(String(retryInit.body));
      expect(retryBody.question).toContain('FORMAT REMINDER');
      expect(retryBody.question).toContain('Every axis value must be an array of the defects you actually observed on that axis');
      expect(retryBody.question).toContain('a numeric axis value is a format error');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('fails closed when both attempts return numeric axis values', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(critiqueCloudflareRasterSemanticV15({
        originalRequest: '静かな湖の写真',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(semanticAnswer({ promptAdherence: 4 })) as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');

      expect(errorSpy).toHaveBeenCalledTimes(2);
      const records = errorSpy.mock.calls.map(call => call[1] as Record<string, unknown>);
      expect(records[0]).toMatchObject({ detail: 'axis-defects-not-a-list:promptAdherence', attempt: 1 });
      expect(records[1]).toMatchObject({ detail: 'axis-defects-not-a-list:promptAdherence', attempt: 2 });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('rejects a copied template placeholder as a format error, retries, and accepts real defect lists', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
        .mockResolvedValueOnce(envelope([]))
        .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
        // The template's placeholder entry, copied verbatim into the
        // axis list it was only meant to illustrate. It is type-label
        // text, not an observed defect — the model has echoed template
        // material as its answer before (#1185), so the parser must
        // not accept it as evidence.
        .mockResolvedValueOnce(runEnvelope(semanticAnswer({
          promptAdherence: ['<defect you actually observed on this axis>'],
        })))
        .mockResolvedValueOnce(runEnvelope(semanticAnswer()));

      const result = await critiqueCloudflareRasterSemanticV15({
        originalRequest: '静かな湖の写真',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, fetchMock as unknown as typeof fetch);

      expect(result.passed).toBe(true);
      expect(result.externalNetworkRequests).toBe(5);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [tag, record] = errorSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(tag).toBe('[raster-semantic-critic] response failed validation');
      expect(record).toMatchObject({ detail: 'axis-defect-placeholder:promptAdherence', attempt: 1 });
      // The retry's reminder names the placeholder copy itself as a
      // format error, not merely a style preference.
      const retryInit = fetchMock.mock.calls[4]?.[1] as RequestInit;
      const retryBody = JSON.parse(String(retryInit.body));
      expect(retryBody.question).toContain('FORMAT REMINDER');
      expect(retryBody.question).toContain('copying the placeholder text "<defect you actually observed on this axis>" into an axis list is itself a format error');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('fails closed when both attempts copy the template placeholder', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Mixed case on purpose: the placeholder match is
      // case-insensitive, so a case-shifted copy is still a copy.
      await expect(critiqueCloudflareRasterSemanticV15({
        originalRequest: '静かな湖の写真',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(semanticAnswer({
        composition: ['<Defect You Actually Observed On This Axis>'],
      })) as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');

      expect(errorSpy).toHaveBeenCalledTimes(2);
      const records = errorSpy.mock.calls.map(call => call[1] as Record<string, unknown>);
      expect(records[0]).toMatchObject({ detail: 'axis-defect-placeholder:composition', attempt: 1 });
      expect(records[1]).toMatchObject({ detail: 'axis-defect-placeholder:composition', attempt: 2 });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('accepts ordinary defect text that does not copy the placeholder phrase', async () => {
    // Real findings may share individual words with the template —
    // only the placeholder phrase itself is a copy. Japanese defect
    // text and a near-miss English phrasing both parse as defects.
    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '五重塔と池のある風景',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(semanticAnswer({
      promptAdherence: ['依頼された五重塔ではなく、四重の塔が描かれている'],
      composition: ['a defect you can actually see: the tower leans left of the frame center'],
    })) as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    expect(result.scores.promptAdherence).toBe(3);
    expect(result.scores.composition).toBe(3);
    expect(result.issues).toEqual([
      'promptAdherence: 依頼された五重塔ではなく、四重の塔が描かれている',
      'composition: a defect you can actually see: the tower leans left of the frame center',
    ]);
    expect(result.externalNetworkRequests).toBe(4);
  });

  it('accepts a defect-bearing verdict whose safety judgment fails, and the gate rejects it on safety alone', async () => {
    // A safety failure is a real verdict the gate must see, not a format
    // failure to retry away: the single critic call is accepted as a
    // verdict on the first attempt and rejected on safety grounds.
    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '架空の商品広告',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(semanticAnswer({
      safetyPassed: false,
      safetyIssues: ['graphic gore is visibly present'],
      subjectIntegrity: ['a visible open wound on the subject'],
    })) as unknown as typeof fetch);

    expect(result.passed).toBe(false);
    expect(result.safetyPassed).toBe(false);
    expect(result.issues).toContain('subjectIntegrity: a visible open wound on the subject');
    expect(result.issues).toContain('visible-output-safety-failed');
    expect(result.externalNetworkRequests).toBe(4);
  });

  it('passes a verdict whose only defect derives its axis to exactly the floor of 3', async () => {
    // One listed defect derives to 3 — exactly the gate floor — and the
    // remaining axes are clean (4), so the mean (27/7 ≈ 3.86) clears 3.5
    // and the verdict is deliverable with the defect kept as evidence.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(runEnvelope(semanticAnswer({
        composition: ['horizon line tilts slightly to the right'],
      })));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '夕日の海辺の風景',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    expect(result.scores.composition).toBe(3);
    expect(result.issues).toEqual(['composition: horizon line tilts slightly to the right']);
  });

  it('fails on safety alone even with no listed defects', async () => {
    // The safety judgment is never relaxed by the gate: a safety failure
    // fails closed no matter how clean the defect lists are.
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
    expect(result.scores.promptAdherence).toBe(4);
    expect(result.issues).toContain('visible-output-safety-failed');
  });

  it('fails when the mean is below 3.5 even though every derived axis sits at the floor', async () => {
    // One defect on every axis derives to all 3s: no axis breaches the
    // floor, but the derived mean 3.0 is below 3.5, so the average alone
    // rejects the candidate.
    const oneEach = Object.fromEntries(RASTER_SEMANTIC_AXES_V15.map(axis => [axis, ['a minor visible defect']]));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(runEnvelope(semanticAnswer(oneEach)));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(false);
    expect(result.safetyPassed).toBe(true);
    expect(result.scores).toEqual(Object.fromEntries(RASTER_SEMANTIC_AXES_V15.map(axis => [axis, 3])));
    expect(result.issues).toEqual(RASTER_SEMANTIC_AXES_V15.map(axis => `${axis}: a minor visible defect`));
  });

  it('fails when defects pull one axis below the floor, even with a passing mean', async () => {
    // Five defects on subjectIntegrity derive to 1. The derived mean
    // (4*6 + 1) / 7 = 25/7 ≈ 3.57 ≥ 3.5, so only the axis floor rejects.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ default_usage_model: 'bundled' }))
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope({ input: {}, output: {} }))
      .mockResolvedValueOnce(runEnvelope(semanticAnswer({
        subjectIntegrity: [
          'the watch face is melted and its hands are unreadable',
          ...defectList(4, 'further subject defect'),
        ],
      })));

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '腕時計の商品広告',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(false);
    expect(result.scores.subjectIntegrity).toBe(1);
    expect(result.issues).toEqual(expect.arrayContaining([
      'subjectIntegrity: the watch face is melted and its hands are unreadable',
      'subjectIntegrity-below-3',
    ]));
  });

  it('passes when three axes carry one defect each and the rest are clean', async () => {
    // The boundary passing shape for the derived gate: derived scores
    // 3,3,3,4,4,4,4 — every axis at or above the floor and the mean
    // 25/7 ≈ 3.57 at or above 3.5.
    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '五重塔と池のある風景',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(semanticAnswer({
      promptAdherence: ['a requested bench is missing from the scene'],
      composition: ['the pagoda sits slightly left of the visual center'],
      subjectIntegrity: ['one roof tile row is subtly warped'],
    })) as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    expect(result.scores).toEqual({
      promptAdherence: 3,
      composition: 3,
      subjectIntegrity: 3,
      styleExecution: 4,
      textHandling: 4,
      artifactControl: 4,
      professionalUsefulness: 4,
    });
    // (3+3+3+4+4+4+4) / 7 axes / 4 max * 100 = 89.28 -> 89.
    expect(result.score).toBe(89);
  });

  it('fails at the gate when one axis carries three defects', async () => {
    // Three defects derive to 2 — below the floor — even though the
    // derived mean (26/7) clears 3.5.
    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(semanticAnswer({
      composition: defectList(3, 'composition defect'),
    })) as unknown as typeof fetch);

    expect(result.passed).toBe(false);
    expect(result.scores.composition).toBe(2);
    expect(result.issues).toContain('composition-below-3');
  });

  it.each([
    [0, 4], [1, 3], [2, 3], [3, 2], [4, 2], [5, 1], [6, 1], [7, 0], [8, 0],
  ])('derives the composition score from its defect count: %i defects -> %i', async (count, expected) => {
    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(semanticAnswer({
      composition: defectList(count, 'composition defect'),
    })) as unknown as typeof fetch);

    expect(result.scores.composition).toBe(expected);
    // Untouched axes stay clean throughout the mapping.
    expect(result.scores.promptAdherence).toBe(4);
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
    expect(result.scores.promptAdherence).toBe(4);
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
    ['a numeric axis value', { promptAdherence: 4 }],
    ['a placeholder string as an axis value', { promptAdherence: '<integer 0-4>' }],
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
    expect(result.scores.promptAdherence).toBe(4);
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
    expect(result.scores.composition).toBe(4);
  });

  it.each([
    ['a missing axis', { composition: undefined }],
    ['a numeric axis value', { promptAdherence: 4 }],
  ])('still rejects an extracted payload with %s instead of guessing', async (_label, overrides) => {
    const wrapped = 'Evaluation follows.\n```json\n' + semanticAnswer(overrides) + '\n```';

    await expect(critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(wrapped) as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  });

  it('rejects the retired numeric-score payload shape (diag9) as a format error under the defect-list contract', async () => {
    // The 2026-11-07 production probe for a genuinely good image came
    // back in the old numeric contract (diag9). That contract is retired:
    // the payload's axis values are numbers, so it fails list validation
    // on the first axis, rides the reminder retry, and fails closed —
    // its content is never reinterpreted as defects or scores.
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
      summary: 'A clean studio photograph of a red apple on a white background, exactly as requested.',
    }, null, 2);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(critiqueCloudflareRasterSemanticV15({
        originalRequest: '白背景の赤いリンゴ、スタジオ写真',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(diag9Answer) as unknown as typeof fetch)).rejects.toThrow('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');

      expect(errorSpy).toHaveBeenCalledTimes(2);
      const records = errorSpy.mock.calls.map(call => call[1] as Record<string, unknown>);
      expect(records[0]).toMatchObject({ detail: 'axis-defects-not-a-list:promptAdherence', attempt: 1 });
      expect(records[1]).toMatchObject({ detail: 'axis-defects-not-a-list:promptAdherence', attempt: 2 });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('instructs the critic to hunt for concrete defects and file each one under its axis', async () => {
    // Discrimination fix (2026-11-07 quality-inspection batch 1): the critic
    // saturated at 4/4 on every axis for all six delivered images while human
    // review found real defects — malformed piano-playing fingers, a pagoda
    // with four roof tiers instead of five, a slightly inconsistent mirror
    // reflection, garbled book-spine text. The generic instructions never
    // made the model look for these, so the question must order an active
    // defect hunt with concrete checks, and (since the 2026-11-10 contract
    // change) each finding must be filed in the list of its own axis.
    const fetchMock = criticFetch(semanticAnswer());

    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: 'ピアノを弾く少女の手元と、五重塔のある風景',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, fetchMock as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    const init = fetchMock.mock.calls[3]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    // The hunt itself, before any answering.
    expect(body.question).toContain('actively hunt for defects');
    expect(body.question).toContain('report only what you actually observed');
    // 1. Anatomy: count fingers and inspect joints, nails, faces.
    expect(body.question).toContain('a natural hand has exactly five fingers');
    expect(body.question).toContain('fused, missing, extra, duplicated, or unnaturally bent fingers');
    expect(body.question).toContain('facial features symmetric and coherent');
    expect(body.question).toContain('Report every anomaly you find in the subjectIntegrity list');
    // 2. Countable structures: actually count, compare against reality.
    expect(body.question).toContain('actually count them');
    expect(body.question).toContain('a five-story pagoda has exactly five roof tiers');
    expect(body.question).toContain('name it in the list of the axis it belongs to');
    // 3. Reflections: compare against the source, left-right reversal.
    expect(body.question).toContain('compare the reflection against its source');
    expect(body.question).toContain('left-right reversal must hold');
    // 4. Text: read it all, quote the garbled strings.
    expect(body.question).toContain('read every piece of visible text in the image');
    expect(body.question).toContain('Misspelled, garbled, or meaningless character strings are concrete defects');
    expect(body.question).toContain('quote them in the textHandling list');
    // 5. Calibration: a found defect belongs in its axis list, and only
    // there — an empty list contradicted by the summary is not a verdict.
    expect(body.question).toContain('each axis list is the complete record of what your hunt found on that axis');
    expect(body.question).toContain('Report observed facts only, not how good the image feels overall');
    expect(body.question).toContain('Each axis list must contain every concrete visible defect found in the hunt above');
    expect(body.question).toContain('maximum 8 entries per axis');
    // The pre-existing instructions stay in force.
    expect(body.question).toContain('For textHandling: list a defect only when visible text is garbled');
    expect(body.question).toContain('For artifactControl: list every artifact');
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
    expect(body.question).toContain('each axis list must contain at most 8 entries');
    expect(body.question).toContain('whenever safetyPassed is true, safetyIssues must be exactly an empty array');
    // Restated at the end: the optional summary, then JSON-only as the
    // final line.
    expect(body.question).toContain('The summary is optional: you may omit it or leave it empty.');
    expect(body.question.trimEnd().endsWith('Answer with the JSON object only: no prose, no markdown code fences, and no text before or after the JSON.')).toBe(true);
    // The defect hunt itself is unchanged.
    expect(body.question).toContain('actively hunt for defects');
  });

  it('shows a type-only format template for defect lists, with no numeric score vector to copy', async () => {
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
    // else: one axis shows a single placeholder defect entry, the rest
    // show the empty list. No concrete defect text and no number appear
    // that could be echoed back as a verdict. (Both numeric examples
    // that preceded the list contract — all-zero, then #1185's mixed
    // 3/2/3/2/4/2/3 — were echoed verbatim in production; the list
    // contract removes the numeric channel itself.)
    expect(body.question).toContain('{"promptAdherence":["<defect you actually observed on this axis>"],"composition":[],"subjectIntegrity":[],"styleExecution":[],"textHandling":[],"artifactControl":[],"professionalUsefulness":[]');
    expect(body.question).toContain('FORMAT TEMPLATE ONLY');
    // Stated around the template and again after it: no sample answer
    // exists and each axis must carry this image's own findings.
    expect(body.question).toContain('There is no sample answer');
    expect(body.question).toContain('every axis value must be an array of the defect strings you observed on that axis');
    expect(body.question).toContain('never a number');
    expect(body.question).toContain('these instructions contain no sample verdict');
    // No axis is ever paired with a concrete number anywhere in the
    // question, and the retired flat criticalIssues key is gone.
    for (const axis of RASTER_SEMANTIC_AXES_V15) {
      expect(body.question).not.toMatch(new RegExp(`"${axis}":\\s*\\d`));
    }
    expect(body.question).not.toContain('criticalIssues');
    expect(body.question).not.toContain('FORMAT EXAMPLE ONLY');
  });

  it.each([
    ['missing entirely', { summary: undefined }],
    ['an empty string', { summary: '' }],
  ])('accepts a verdict whose summary is %s', async (_label, overrides) => {
    // The summary became optional with the list contract: it is display
    // text the verdict never consumes, and a missing summary was one of
    // the #1187 production format collapses. It now parses as empty.
    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '静かな湖の写真',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(semanticAnswer(overrides)) as unknown as typeof fetch);

    expect(result.passed).toBe(true);
    expect(result.summary).toBe('');
    expect(result.adjustments).toEqual([]);
    expect(result.externalNetworkRequests).toBe(4);
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

  it('truncates a ninth defect on one axis instead of rejecting the verdict', async () => {
    const nine = defectList(9, 'defect');
    const result = await critiqueCloudflareRasterSemanticV15({
      originalRequest: '五重塔のある風景',
      bytes: png(),
      mimeType: 'image/png',
    }, ENV, criticFetch(semanticAnswer({ promptAdherence: nine })) as unknown as typeof fetch);

    expect(result.issues).toEqual([
      ...nine.slice(0, 8).map(defect => `promptAdherence: ${defect}`),
      'promptAdherence-below-3',
    ]);
    expect(result.adjustments).toEqual(['promptAdherence-truncated-from-9-to-8']);
    // The truncated list is preserved as diagnostic evidence; the
    // derivation has long saturated (8 defects derive to 0, as 9 would),
    // so the repair does not move the verdict — the axis floor does.
    expect(result.scores.promptAdherence).toBe(0);
    expect(result.passed).toBe(false);
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
      expect(retryBody.question).toContain('Every axis value must be an array');
      expect(retryBody.question).toContain('the summary (optional) at or below 400 characters');
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
      expect(records[0]).toMatchObject({ detail: 'axis-defects-not-a-list:composition', attempt: 1 });
      expect(records[1]).toMatchObject({ detail: 'axis-defects-not-a-list:composition', attempt: 2 });
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

  it('logs the derived numbers, defect counts, and failed conditions when the gate rejects on the mean alone', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // One defect on every axis derives to all 3s: no axis condition
      // fires and safety passes, but the mean 3.0 is below 3.5, so the
      // rejection is attributable to the average alone.
      const oneEach = Object.fromEntries(RASTER_SEMANTIC_AXES_V15.map(axis => [axis, ['a minor visible defect']]));
      const result = await critiqueCloudflareRasterSemanticV15({
        originalRequest: '静かな湖の写真',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(semanticAnswer(oneEach)) as unknown as typeof fetch);

      expect(result.passed).toBe(false);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [tag, record] = errorSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(tag).toBe('[raster-semantic-critic] verdict rejected');
      expect(record).toMatchObject({
        passed: false,
        safetyPassed: true,
        safetyIssuesCount: 0,
        defectsTotal: 7,
        failedConditions: ['average-below-3.5'],
        adjustments: [],
      });
      expect(record.defectCounts).toEqual(Object.fromEntries(RASTER_SEMANTIC_AXES_V15.map(axis => [axis, 1])));
      expect(record.average).toBeCloseTo(3, 10);
      expect(record.scores).toEqual(Object.fromEntries(RASTER_SEMANTIC_AXES_V15.map(axis => [axis, 3])));
      expect(Object.keys(record).sort()).toEqual([
        'adjustments', 'average', 'defectCounts', 'defectsTotal', 'failedConditions',
        'passed', 'safetyIssuesCount', 'safetyPassed', 'scores',
      ]);
      // Numbers and identifiers only: neither the summary text nor any
      // listed defect's text ever reaches the record.
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
      // Three composition defects derive to 2 with every other axis
      // clean (4): the mean (26/7) clears 3.5, so the floor breach is
      // the only failing condition.
      const result = await critiqueCloudflareRasterSemanticV15({
        originalRequest: '静かな湖の写真',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(semanticAnswer({
        composition: defectList(3, 'composition defect'),
      })) as unknown as typeof fetch);

      expect(result.passed).toBe(false);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [, record] = errorSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(record.failedConditions).toEqual(['axis-below-3:composition']);
      expect(record.average).toBeCloseTo(26 / 7, 10);
      expect(record.defectCounts).toMatchObject({ composition: 3, promptAdherence: 0 });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('logs the safety condition and only the count of safety reasons when safety fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // A clean defect record cannot rescue a safety failure.
      const result = await critiqueCloudflareRasterSemanticV15({
        originalRequest: '架空の商品広告',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(semanticAnswer({
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
      const nine = defectList(9, 'defect');
      const result = await critiqueCloudflareRasterSemanticV15({
        originalRequest: '五重塔のある風景',
        bytes: png(),
        mimeType: 'image/png',
      }, ENV, criticFetch(semanticAnswer({
        promptAdherence: nine,
      })) as unknown as typeof fetch);

      expect(result.passed).toBe(false);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [, record] = errorSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(record.adjustments).toEqual(['promptAdherence-truncated-from-9-to-8']);
      expect(record.defectCounts).toMatchObject({ promptAdherence: 8 });
      expect(record.defectsTotal).toBe(8);
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
    ['a non-string entry among nine defects on one axis', { promptAdherence: [...defectList(8, 'defect'), 42] }],
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
