import { describe, expect, it, vi } from 'vitest';
import {
  generateCloudflareRasterImageFreeProofV15,
  CloudflareRasterUsageReconciliationErrorV15,
} from './cloudflareRasterFreeGenerationV15';

const ENV: NodeJS.ProcessEnv = {
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_API_TOKEN: `test-${'x'.repeat(40)}`,
};
const NOW_IN_WINDOW = () => Date.parse('2026-11-06T12:00:00.000Z');
const RECONCILE_FAST = { attempts: 2, delayMs: 0, totalMs: 1_000 };

function envelope(result: unknown, status = 200): Response {
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

function pngBytes(width: number, height: number, totalBytes = 96): Buffer {
  const bytes = Buffer.alloc(totalBytes);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  Buffer.from('IHDR', 'ascii').copy(bytes, 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

// Defect-list contract: the critic returns per-axis defect lists and the
// server derives scores from the counts (0 defects -> 4, 1-2 -> 3,
// 3-4 -> 2, 5-6 -> 1, 7+ -> 0).
const PASSING_CRITIC_ANSWER = JSON.stringify({
  promptAdherence: [],
  composition: [],
  subjectIntegrity: [],
  styleExecution: [],
  textHandling: [],
  artifactControl: [],
  professionalUsefulness: [],
  safetyPassed: true,
  safetyIssues: [],
  summary: '依頼どおりの画像です。',
});

// Defect counts 5/3/3/3/1/3/5 derive to axis scores 1/2/2/2/3/2/1 —
// axis mean 13/7, i.e. a 0-100 score of 46, same as the retired numeric
// fixture produced.
const FAILING_CRITIC_ANSWER = JSON.stringify({
  promptAdherence: ['主体が依頼と異なります', '依頼された要素が欠けています', '背景が依頼と異なります', 'ポーズが依頼と異なります', '小物が依頼と異なります'],
  composition: ['主体が画面端に寄りすぎています', '余白のバランスが崩れています', '視線誘導が弱いです'],
  subjectIntegrity: ['輪郭が崩れています', '質感が不自然です', '影の付き方が不整合です'],
  styleExecution: ['画風が依頼と異なります', '色調が統一されていません', '筆致が粗いです'],
  textHandling: ['文字が判読しにくいです'],
  artifactControl: ['ノイズが目立ちます', '圧縮アーティファクトがあります', '境界が滲んでいます'],
  professionalUsefulness: ['解像感が不足しています', '商用利用には不適です', '構図の完成度が低いです', '色再現が不正確です', '余白設計が不適切です'],
  safetyPassed: true,
  safetyIssues: [],
  summary: '依頼に沿っていません。',
});

type MockState = {
  usageModel?: string;
  subscriptions?: unknown[];
  usedNeurons: number;
  generationDelta: number;
  criticAnswer?: string;
  criticAnswers?: string[];
  imageBytes?: Buffer;
  imageRuns: number;
  criticRuns: number;
  graphqlBroken?: boolean;
  /** GraphQL reads succeed this many times, then return an error payload. */
  graphqlBrokenAfterCalls?: number;
  generationPrompts: string[];
  openRouterAnswer?: string;
  /** Analytics lag: the GraphQL total never reflects this request's runs. */
  lagUsage?: boolean;
  /** When set, the FLUX run envelope reports this many Neurons for itself. */
  generationReportedNeurons?: number;
  /** When set, the critic run envelope (live shape) reports this many Neurons. */
  criticReportedNeurons?: number;
  /** Per-call critic responses, consumed in call order before the defaults. */
  criticSequence?: { answer: string; neurons?: number }[];
  /** The first this many critic run calls fail with an HTTP 500 instead. */
  criticFailFirstCalls?: number;
};

function usageResponse(usedNeurons: number): Response {
  return new Response(JSON.stringify({
    data: {
      viewer: {
        accounts: [{
          aiInferenceAdaptiveGroups: [{ count: 1, sum: { totalNeurons: usedNeurons } }],
        }],
      },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function dispatchFetch(state: MockState) {
  // What the analytics GraphQL read reports. Generation moves it unless the
  // lag scenario pins it to the pre-generation baseline for the whole test.
  let graphqlUsedNeurons = state.usedNeurons;
  let graphqlCalls = 0;
  return vi.fn(async (url: string, init?: RequestInit) => {
    const target = String(url);
    if (target.includes('/workers/account-settings')) {
      return envelope({ default_usage_model: state.usageModel ?? 'bundled' });
    }
    if (target.includes('/subscriptions')) return envelope(state.subscriptions ?? []);
    if (target.includes('/ai/models/schema')) return envelope({ input: {}, output: {} });
    if (target.includes('/graphql')) {
      graphqlCalls += 1;
      if (state.graphqlBroken
        || (state.graphqlBrokenAfterCalls !== undefined && graphqlCalls > state.graphqlBrokenAfterCalls)) {
        return new Response(JSON.stringify({ errors: [{ message: 'bad field' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return usageResponse(graphqlUsedNeurons);
    }
    if (target.includes('openrouter.ai/api/v1/chat/completions')) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: state.openRouterAnswer ?? '' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target.includes('/ai/run/@cf/black-forest-labs/flux-2-klein-')) {
      state.imageRuns += 1;
      state.usedNeurons += state.generationDelta;
      if (!state.lagUsage) graphqlUsedNeurons += state.generationDelta;
      const form = init?.body as FormData | undefined;
      if (form && typeof form.get === 'function') {
        state.generationPrompts.push(String(form.get('prompt') ?? ''));
      }
      const bytes = state.imageBytes ?? pngBytes(256, 256);
      if (state.generationReportedNeurons !== undefined) {
        return envelope({ image: bytes.toString('base64'), usage: { neurons: state.generationReportedNeurons } });
      }
      return envelope(bytes.toString('base64'));
    }
    if (target.includes('/ai/run/@cf/moondream/')) {
      state.criticRuns += 1;
      if (state.criticRuns <= (state.criticFailFirstCalls ?? 0)) {
        return new Response(JSON.stringify({
          success: false,
          result: null,
          errors: [{ code: 5000, message: 'upstream failure' }],
          messages: [],
        }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
      const sequenced = state.criticSequence?.shift();
      if (sequenced) {
        return sequenced.neurons !== undefined
          ? envelope({ result: { answer: sequenced.answer }, usage: { neurons: sequenced.neurons } })
          : envelope({ answer: sequenced.answer });
      }
      const answer = state.criticAnswers?.length
        ? state.criticAnswers.shift()
        : state.criticAnswer ?? PASSING_CRITIC_ANSWER;
      if (state.criticReportedNeurons !== undefined) {
        // Live-verified envelope shape: the model's own output object nested
        // under result.result, with the usage block alongside it.
        return envelope({ result: { answer }, usage: { neurons: state.criticReportedNeurons } });
      }
      return envelope({ answer });
    }
    throw new Error(`unexpected fetch: ${target}`);
  });
}

function baseState(overrides: Partial<MockState> = {}): MockState {
  return {
    usedNeurons: 100,
    generationDelta: 140,
    imageRuns: 0,
    criticRuns: 0,
    generationPrompts: [],
    ...overrides,
  };
}

const INPUT = { prompt: '静かな湖と朝焼け', width: 256, height: 256 };

describe('cloudflareRasterFreeGenerationV15', () => {
  it('delivers only after plan proof, quota pre-check, critic gates, and reconciliation all pass', async () => {
    const state = baseState();
    const fetchMock = dispatchFetch(state);

    const delivery = await generateCloudflareRasterImageFreeProofV15(
      INPUT,
      ENV,
      fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
    );

    expect(state.imageRuns).toBe(1);
    expect(state.criticRuns).toBe(1);
    expect(delivery.result.providerId).toBe('cloudflare-workers-ai-free');
    expect(delivery.result.model).toBe('@cf/black-forest-labs/flux-2-klein-4b');
    expect(delivery.result.costEvidence).toBe('post-generation-usage-zero-confirmed');
    expect(delivery.structural.passed).toBe(true);
    expect(delivery.semantic.passed).toBe(true);
    expect(delivery.usage).toMatchObject({
      date: '2026-11-06',
      allocationNeurons: 10_000,
      usedBeforeNeurons: 100,
      estimatedGenerationNeurons: 32,
      semanticCriticReservedNeurons: 256,
      // 1 planned candidate + 1 budgeted retry, reserved up front.
      reservedNeurons: 576,
      candidatesPlanned: 1,
      candidatesGenerated: 1,
      retryBudgeted: true,
      observedDeltaNeurons: 140,
      usedAfterNeurons: 240,
      reconciliationMethod: 'aggregate-delta',
      // The mocks report no per-request usage; the aggregate delta alone
      // carries this delivery, so the reported total stays null.
      reportedNeurons: null,
    });
    expect(delivery.quality).toMatchObject({
      promptEnhancement: { applied: false, reason: 'PROMPT_ENHANCEMENT_NOT_CONFIGURED' },
      retryUsed: false,
      selectedCandidateIndex: 0,
    });
  });

  it('fails closed before any network call when credentials are absent', async () => {
    const fetchMock = vi.fn();
    await expect(generateCloudflareRasterImageFreeProofV15(INPUT, {}, fetchMock as unknown as typeof fetch))
      .rejects.toThrow('CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed before any network call when the model is not priced for the proof path', async () => {
    const fetchMock = vi.fn();
    await expect(generateCloudflareRasterImageFreeProofV15(
      INPUT,
      { ...ENV, ORIGIN_CLOUDFLARE_IMAGE_MODEL: '@cf/black-forest-labs/flux-1-schnell' },
      fetchMock as unknown as typeof fetch,
    )).rejects.toThrow('CLOUDFLARE_MODEL_NOT_PRICED_FOR_FREE_PROOF');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed before any network call when pricing evidence is stale', async () => {
    const fetchMock = vi.fn();
    await expect(generateCloudflareRasterImageFreeProofV15(
      INPUT,
      ENV,
      fetchMock as unknown as typeof fetch,
      { now: () => Date.parse('2026-12-01T00:00:00.000Z') },
    )).rejects.toThrow('RASTER_PRICING_EVIDENCE_STALE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks a paid Workers plan before inference', async () => {
    const state = baseState({ usageModel: 'standard' });
    const fetchMock = dispatchFetch(state);
    await expect(generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch, { now: NOW_IN_WINDOW },
    )).rejects.toThrow('CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED');
    expect(state.imageRuns).toBe(0);
  });

  it('blocks before inference when the remaining free allocation cannot cover the reserve', async () => {
    const state = baseState({ usedNeurons: 9_900 });
    const fetchMock = dispatchFetch(state);
    await expect(generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch, { now: NOW_IN_WINDOW },
    )).rejects.toThrow('CLOUDFLARE_FREE_ALLOCATION_INSUFFICIENT');
    expect(state.imageRuns).toBe(0);
    expect(state.criticRuns).toBe(0);
  });

  it('blocks before inference when daily usage cannot be verified', async () => {
    const state = baseState({ graphqlBroken: true });
    const fetchMock = dispatchFetch(state);
    await expect(generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch, { now: NOW_IN_WINDOW },
    )).rejects.toThrow('CLOUDFLARE_DAILY_USAGE_UNVERIFIED');
    expect(state.imageRuns).toBe(0);
  });

  it('withholds the image when the structural critic rejects it, even after the budgeted retry', async () => {
    // A 40-byte PNG header passes the provider's own dimension/signature
    // checks but is below the structural critic's nontrivial-payload floor.
    const state = baseState({ imageBytes: pngBytes(256, 256, 40) });
    const fetchMock = dispatchFetch(state);
    await expect(generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch, { now: NOW_IN_WINDOW },
    )).rejects.toThrow('RASTER_STRUCTURAL_CRITIC_REJECTED');
    expect(state.imageRuns).toBe(2); // initial attempt + budgeted retry
    expect(state.criticRuns).toBe(0);
  });

  it('withholds the image when the semantic critic rejects it, even after the budgeted retry', async () => {
    const state = baseState({ criticAnswer: FAILING_CRITIC_ANSWER });
    const fetchMock = dispatchFetch(state);
    await expect(generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch, { now: NOW_IN_WINDOW },
    )).rejects.toThrow('RASTER_SEMANTIC_CRITIC_REJECTED');
    expect(state.imageRuns).toBe(2); // initial attempt + budgeted retry
    expect(state.criticRuns).toBe(2);
  });

  it('logs the selection outcome when every candidate is rejected by the semantic gate', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const state = baseState({ criticAnswer: FAILING_CRITIC_ANSWER });
      const fetchMock = dispatchFetch(state);
      await expect(generateCloudflareRasterImageFreeProofV15(
        INPUT, ENV, fetchMock as unknown as typeof fetch, { now: NOW_IN_WINDOW },
      )).rejects.toThrow('RASTER_SEMANTIC_CRITIC_REJECTED');

      const selectionRecords = errorSpy.mock.calls
        .filter(call => call[0] === '[raster-free-generation] all candidates rejected')
        .map(call => call[1] as Record<string, unknown>);
      expect(selectionRecords).toHaveLength(1);
      expect(selectionRecords[0]).toMatchObject({
        rejection: 'semantic',
        candidatesPlanned: 1,
        candidatesAttempted: 2,
        retryUsed: true,
      });
      // FAILING_CRITIC_ANSWER: axis mean 13/7, i.e. a 0-100 score of 46.
      expect(selectionRecords[0]?.candidates).toEqual([
        { index: 0, retried: false, gate: 'semantic', semanticScore: 46, errorCode: 'RASTER_SEMANTIC_CRITIC_REJECTED' },
        { index: 1, retried: true, gate: 'semantic', semanticScore: 46, errorCode: 'RASTER_SEMANTIC_CRITIC_REJECTED' },
      ]);
      // Numbers and identifiers only: the critic's listed-issue text and
      // its summary never reach the record.
      const serialized = JSON.stringify(selectionRecords[0]);
      expect(serialized).not.toContain('主体が依頼と異なります');
      expect(serialized).not.toContain('依頼に沿っていません');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('logs the selection outcome when every candidate is rejected by the structural gate', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const state = baseState({ imageBytes: pngBytes(256, 256, 40) });
      const fetchMock = dispatchFetch(state);
      await expect(generateCloudflareRasterImageFreeProofV15(
        INPUT, ENV, fetchMock as unknown as typeof fetch, { now: NOW_IN_WINDOW },
      )).rejects.toThrow('RASTER_STRUCTURAL_CRITIC_REJECTED');

      const selectionRecords = errorSpy.mock.calls
        .filter(call => call[0] === '[raster-free-generation] all candidates rejected')
        .map(call => call[1] as Record<string, unknown>);
      expect(selectionRecords).toHaveLength(1);
      expect(selectionRecords[0]).toMatchObject({
        rejection: 'structural',
        candidatesPlanned: 1,
        candidatesAttempted: 2,
        retryUsed: true,
      });
      expect(selectionRecords[0]?.candidates).toEqual([
        { index: 0, retried: false, gate: 'structural', semanticScore: null, errorCode: 'RASTER_STRUCTURAL_CRITIC_REJECTED' },
        { index: 1, retried: true, gate: 'structural', semanticScore: null, errorCode: 'RASTER_STRUCTURAL_CRITIC_REJECTED' },
      ]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('logs a sanitized sub-reason when a generation attempt fails below the code layer', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const state = baseState();
      const inner = dispatchFetch(state);
      // The FLUX run itself fails at the fetch layer: no HTTP response
      // exists, so no classified code is produced and the attempt
      // collapses to the generic RASTER_GENERATION_FAILED. The coded
      // cause is the only sub-reason available, and it is an identifier,
      // not message or body text.
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('/ai/run/@cf/black-forest-labs/flux-')) {
          const failure = new TypeError('fetch failed');
          (failure as { cause?: unknown }).cause = Object.assign(
            new Error('read ECONNRESET'),
            { code: 'ECONNRESET' },
          );
          throw failure;
        }
        return inner(url, init);
      });
      await expect(generateCloudflareRasterImageFreeProofV15(
        INPUT, ENV, fetchMock as unknown as typeof fetch, { now: NOW_IN_WINDOW },
      )).rejects.toThrow('RASTER_GENERATION_FAILED');
      expect(state.criticRuns).toBe(0);

      const selectionRecords = errorSpy.mock.calls
        .filter(call => call[0] === '[raster-free-generation] all candidates rejected')
        .map(call => call[1] as Record<string, unknown>);
      expect(selectionRecords).toHaveLength(1);
      expect(selectionRecords[0]).toMatchObject({
        rejection: 'generation-error',
        candidatesPlanned: 1,
        candidatesAttempted: 2,
        retryUsed: true,
      });
      expect(selectionRecords[0]?.candidates).toEqual([
        { index: 0, retried: false, gate: 'none', semanticScore: null, errorCode: 'RASTER_GENERATION_FAILED', errorDetail: 'TypeError:ECONNRESET' },
        { index: 1, retried: true, gate: 'none', semanticScore: null, errorCode: 'RASTER_GENERATION_FAILED', errorDetail: 'TypeError:ECONNRESET' },
      ]);
      // Identifiers only: the prompt never reaches the record.
      expect(JSON.stringify(selectionRecords[0])).not.toContain('静かな湖と朝焼け');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not log a selection record when a candidate is delivered', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const state = baseState();
      const fetchMock = dispatchFetch(state);
      await generateCloudflareRasterImageFreeProofV15(
        INPUT, ENV, fetchMock as unknown as typeof fetch,
        { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
      );
      expect(errorSpy.mock.calls
        .filter(call => call[0] === '[raster-free-generation] all candidates rejected')).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('withholds the image when post-generation usage cannot be reconciled', async () => {
    const state = baseState({ generationDelta: 0 });
    const fetchMock = dispatchFetch(state);
    await expect(generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
    )).rejects.toThrow('CLOUDFLARE_USAGE_RECONCILIATION_FAILED');
    expect(state.imageRuns).toBe(1);
  });

  it('withholds the image when the measured delta exceeds the reserved bound', async () => {
    const state = baseState({ generationDelta: 5_000 });
    const fetchMock = dispatchFetch(state);
    await expect(generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
    )).rejects.toThrow('CLOUDFLARE_USAGE_RECONCILIATION_FAILED');
    expect(state.imageRuns).toBe(1);
  });

  it('delivers on per-request usage reports when the analytics aggregate lags behind the polling window', async () => {
    // Production shape (2026-11-07): generation and critic complete, the
    // daily aggregate does grow eventually, but never inside the window.
    // Complete reports skip the polling window entirely, so the aggregate
    // is recorded as unobserved (null) rather than as a lagged zero.
    const state = baseState({
      lagUsage: true,
      generationReportedNeurons: 140,
      criticReportedNeurons: 35,
    });
    const fetchMock = dispatchFetch(state);
    const delivery = await generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
    );
    expect(state.imageRuns).toBe(1);
    expect(state.criticRuns).toBe(1);
    expect(delivery.result.costEvidence).toBe('per-request-usage-reported; aggregate-reconciliation-deferred');
    expect(delivery.usage).toMatchObject({
      usedBeforeNeurons: 100,
      reservedNeurons: 576,
      observedDeltaNeurons: null,
      usedAfterNeurons: null,
      reconciliationMethod: 'per-request-reported',
      reportedNeurons: 175,
    });
  });

  it('counts every candidate and the retry in the per-request fallback accounting', async () => {
    const state = baseState({
      lagUsage: true,
      generationReportedNeurons: 140,
      criticReportedNeurons: 35,
      criticAnswers: [FAILING_CRITIC_ANSWER, PASSING_CRITIC_ANSWER],
    });
    const fetchMock = dispatchFetch(state);
    const delivery = await generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
    );
    expect(state.imageRuns).toBe(2); // failed candidate + budgeted retry
    expect(state.criticRuns).toBe(2);
    expect(delivery.quality.retryUsed).toBe(true);
    // (140 generation + 35 critic) x 2 attempts, all inside the 576 reserve.
    expect(delivery.usage.reportedNeurons).toBe(350);
    expect(delivery.usage.reconciliationMethod).toBe('per-request-reported');
  });

  it('counts the critic format retry first call in the per-request accounting', async () => {
    // The critic's first answer is not valid contract JSON, so the
    // critic repeats its call once with a format reminder. Both calls
    // consumed Neurons and both reported them (30, then 35); the
    // request's evidence must total all of them, not only the final
    // call's report.
    const state = baseState({
      lagUsage: true,
      generationReportedNeurons: 140,
      criticSequence: [
        { answer: 'this is not the contracted JSON', neurons: 30 },
        { answer: PASSING_CRITIC_ANSWER, neurons: 35 },
      ],
    });
    const fetchMock = dispatchFetch(state);
    const delivery = await generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
    );
    expect(state.imageRuns).toBe(1);
    expect(state.criticRuns).toBe(2);
    expect(delivery.usage.reconciliationMethod).toBe('per-request-reported');
    // 140 generation + 30 failed critic call + 35 retry critic call.
    expect(delivery.usage.reportedNeurons).toBe(205);
    expect(delivery.semantic.reportedNeurons).toBe(35);
    expect(delivery.semantic.reportedCallsNeurons).toEqual([30, 35]);
  });

  it('preserves a failed candidate generation report when its critic call throws, and still withholds', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      // Best-of-2: both generations report 140 Neurons for themselves.
      // One candidate's semantic-critic call fails at the provider (HTTP
      // 500); the other candidate passes with a 35-Neuron critic report
      // and wins. The aggregate lags past the polling window.
      const state = baseState({
        lagUsage: true,
        generationReportedNeurons: 140,
        criticReportedNeurons: 35,
        criticFailFirstCalls: 1,
      });
      const fetchMock = dispatchFetch(state);
      const error = await generateCloudflareRasterImageFreeProofV15(
        INPUT, ENV, fetchMock as unknown as typeof fetch,
        { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST, maxCandidates: 2 },
      ).catch((caught: unknown) => caught);
      expect(state.imageRuns).toBe(2);
      expect(state.criticRuns).toBe(2);
      // The failed candidate's generation report is preserved, but its
      // critic call reported nothing, so the evidence set is still
      // incomplete and the image is still withheld: preservation never
      // fills a missing report.
      expect(error).toBeInstanceOf(CloudflareRasterUsageReconciliationErrorV15);
      const failure = error as CloudflareRasterUsageReconciliationErrorV15;
      expect(failure.usage.reconciliationReason).toBe('per-request-usage-incomplete');
      expect(failure.usage.unreportedCalls).toHaveLength(1);
      expect(failure.usage.unreportedCalls[0]?.call).toBe('semantic-critic');
      const records = infoSpy.mock.calls
        .filter(call => call[0] === '[raster-free-generation] usage reconciliation failed')
        .map(call => call[1] as { reportedCalls: { call: string; reportedNeurons: number | null }[] });
      expect(records).toHaveLength(1);
      const reportedCalls = records[0]!.reportedCalls;
      // Both generation calls are present with their own reports — the
      // failed candidate's 140 was not discarded with its attempt.
      expect(reportedCalls.filter(call => call.call === 'generation')).toEqual([
        { candidateIndex: 0, retried: false, call: 'generation', reportedNeurons: 140 },
        { candidateIndex: 1, retried: false, call: 'generation', reportedNeurons: 140 },
      ]);
      const criticReports = reportedCalls
        .filter(call => call.call === 'semantic-critic')
        .map(call => call.reportedNeurons)
        .sort((a, b) => Number(a) - Number(b));
      expect(criticReports).toEqual([null, 35]);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('withholds the image under analytics lag when any single call reported no usage', async () => {
    // Critic reported, generation did not.
    const noGenerationReport = baseState({ lagUsage: true, criticReportedNeurons: 35 });
    await expect(generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, dispatchFetch(noGenerationReport) as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
    )).rejects.toThrow('CLOUDFLARE_USAGE_RECONCILIATION_FAILED');

    // Generation reported, critic did not.
    const noCriticReport = baseState({ lagUsage: true, generationReportedNeurons: 140 });
    await expect(generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, dispatchFetch(noCriticReport) as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
    )).rejects.toThrow('CLOUDFLARE_USAGE_RECONCILIATION_FAILED');
  });

  it('delivers on complete per-request reports when the aggregate delta lands far over the reserve', async () => {
    // Production batch repro (2026-11-07): under consecutive requests, the
    // delta that lands inside this request's polling window is the backlog
    // of earlier requests (here: a 5,000-Neuron jump against a 576
    // reserve). The aggregate cannot attribute it to this request, so the
    // request's own complete, in-bounds reports carry the delivery. With
    // complete reports the window is never even opened, so the backlog
    // delta is recorded as unobserved (null) instead of 5,000.
    const state = baseState({
      generationDelta: 5_000,
      generationReportedNeurons: 140,
      criticReportedNeurons: 35,
    });
    const fetchMock = dispatchFetch(state);
    const delivery = await generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
    );
    expect(state.imageRuns).toBe(1);
    expect(state.criticRuns).toBe(1);
    expect(delivery.result.costEvidence).toBe('per-request-usage-reported; aggregate-reconciliation-deferred');
    expect(delivery.usage).toMatchObject({
      usedBeforeNeurons: 100,
      reservedNeurons: 576,
      observedDeltaNeurons: null,
      usedAfterNeurons: null,
      reconciliationMethod: 'per-request-reported',
      reportedNeurons: 175,
    });
  });

  it('delivers on complete per-request reports when every aggregate read fails after the baseline', async () => {
    const state = baseState({
      // Baseline read (1st GraphQL call) succeeds; all polling reads fail,
      // so the aggregate stays unobserved for the whole window.
      graphqlBrokenAfterCalls: 1,
      generationReportedNeurons: 140,
      criticReportedNeurons: 35,
    });
    const fetchMock = dispatchFetch(state);
    const delivery = await generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
    );
    expect(state.imageRuns).toBe(1);
    expect(delivery.result.costEvidence).toBe('per-request-usage-reported; aggregate-reconciliation-deferred');
    expect(delivery.usage).toMatchObject({
      usedBeforeNeurons: 100,
      observedDeltaNeurons: null,
      usedAfterNeurons: null,
      reconciliationMethod: 'per-request-reported',
      reportedNeurons: 175,
    });
  });

  it('skips the aggregate polling window entirely when every call reported its usage', async () => {
    // The aggregate WOULD move inside the window (generation moves it by
    // 140), so a polling read would reconcile if one ran. With complete
    // per-request reports the window is skipped: the only GraphQL call in
    // the whole flow is the pre-generation baseline read.
    const state = baseState({
      generationReportedNeurons: 140,
      criticReportedNeurons: 35,
    });
    const fetchMock = dispatchFetch(state);
    const delivery = await generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
    );
    const graphqlCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url).includes('/graphql'),
    );
    expect(graphqlCalls).toHaveLength(1); // baseline read only; no polling
    expect(state.imageRuns).toBe(1);
    expect(state.criticRuns).toBe(1);
    expect(delivery.usage).toMatchObject({
      observedDeltaNeurons: null,
      usedAfterNeurons: null,
      reconciliationMethod: 'per-request-reported',
      reportedNeurons: 175,
    });
  });

  it('still polls the aggregate when any call reported no usage', async () => {
    // Generation reported its Neurons but the critic did not: the
    // per-request evidence is incomplete, so the polling window still
    // runs and the aggregate delta (140, moved by the generation itself)
    // carries the delivery on the first polling read.
    const state = baseState({ generationReportedNeurons: 140 });
    const fetchMock = dispatchFetch(state);
    const delivery = await generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
    );
    const graphqlCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url).includes('/graphql'),
    );
    expect(graphqlCalls).toHaveLength(2); // baseline read + one polling read
    expect(delivery.usage).toMatchObject({
      observedDeltaNeurons: 140,
      usedAfterNeurons: 240,
      reconciliationMethod: 'aggregate-delta',
      reportedNeurons: null,
    });
  });

  it('attaches the observed usage snapshot to a reconciliation failure', async () => {
    const state = baseState({ generationDelta: 0 });
    const fetchMock = dispatchFetch(state);
    const error = await generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CloudflareRasterUsageReconciliationErrorV15);
    const failure = error as CloudflareRasterUsageReconciliationErrorV15;
    expect(failure.message).toBe('CLOUDFLARE_USAGE_RECONCILIATION_FAILED');
    expect(failure.usage).toMatchObject({
      date: '2026-11-06',
      allocationNeurons: 10_000,
      usedBeforeNeurons: 100,
      reservedNeurons: 576,
      candidatesPlanned: 1,
      candidatesGenerated: 1,
      observedDeltaNeurons: 0,
      usedAfterNeurons: 100,
      reconciliationMethod: null,
      reportedNeurons: null,
      reconciliationReason: 'per-request-usage-incomplete',
    });
  });

  it('records the reconciliation snapshot in the server log when Stage 5 withholds the image', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      // Neither call reported its usage: the generation envelope is a
      // bare base64 string and the critic answer arrives in the flat
      // shape, so the primary evidence is incomplete and the aggregate
      // (delta 0) cannot carry the delivery either.
      const state = baseState({ generationDelta: 0 });
      const fetchMock = dispatchFetch(state);
      const error = await generateCloudflareRasterImageFreeProofV15(
        INPUT, ENV, fetchMock as unknown as typeof fetch,
        { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(CloudflareRasterUsageReconciliationErrorV15);
      const failure = error as CloudflareRasterUsageReconciliationErrorV15;
      // The failure snapshot names exactly which calls reported nothing:
      // the generation call and the semantic-critic call of candidate 0.
      expect(failure.usage.unreportedCalls).toEqual([
        { candidateIndex: 0, retried: false, call: 'generation' },
        { candidateIndex: 0, retried: false, call: 'semantic-critic' },
      ]);
      // The same snapshot is recorded in the server log, with every
      // call's own report, so the block stays triageable after the API
      // response is gone.
      const records = infoSpy.mock.calls
        .filter(call => call[0] === '[raster-free-generation] usage reconciliation failed')
        .map(call => call[1] as Record<string, unknown>);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        reconciliationReason: 'per-request-usage-incomplete',
        reconciliationMethod: null,
        reservedNeurons: 576,
        reportedNeurons: null,
        reportedCalls: [
          { candidateIndex: 0, retried: false, call: 'generation', reportedNeurons: null },
          { candidateIndex: 0, retried: false, call: 'semantic-critic', reportedNeurons: null },
        ],
        unreportedCalls: [
          { candidateIndex: 0, retried: false, call: 'generation' },
          { candidateIndex: 0, retried: false, call: 'semantic-critic' },
        ],
      });
      // Identifiers and numbers only: the prompt never reaches the record.
      expect(JSON.stringify(records[0])).not.toContain('静かな湖と朝焼け');
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('names only the unreported call in the failure snapshot when the other calls reported', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      // Generation reported 140 Neurons for itself; the critic reported
      // nothing, and the aggregate lags past the polling window, so the
      // delivery is withheld on the critic call alone.
      const state = baseState({ lagUsage: true, generationReportedNeurons: 140 });
      const fetchMock = dispatchFetch(state);
      const error = await generateCloudflareRasterImageFreeProofV15(
        INPUT, ENV, fetchMock as unknown as typeof fetch,
        { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(CloudflareRasterUsageReconciliationErrorV15);
      const failure = error as CloudflareRasterUsageReconciliationErrorV15;
      expect(failure.usage.reconciliationReason).toBe('per-request-usage-incomplete');
      expect(failure.usage.unreportedCalls).toEqual([
        { candidateIndex: 0, retried: false, call: 'semantic-critic' },
      ]);
      const records = infoSpy.mock.calls
        .filter(call => call[0] === '[raster-free-generation] usage reconciliation failed')
        .map(call => call[1] as Record<string, unknown>);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        reportedCalls: [
          { candidateIndex: 0, retried: false, call: 'generation', reportedNeurons: 140 },
          { candidateIndex: 0, retried: false, call: 'semantic-critic', reportedNeurons: null },
        ],
      });
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('withholds the image when the per-request reported total exceeds the reserve', async () => {
    const state = baseState({
      lagUsage: true,
      generationReportedNeurons: 400,
      criticReportedNeurons: 300,
    });
    const fetchMock = dispatchFetch(state);
    await expect(generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
    )).rejects.toThrow('CLOUDFLARE_USAGE_RECONCILIATION_FAILED');
    expect(state.imageRuns).toBe(1);
    // The reports are complete (700 > the 576 reserve), so the polling
    // window is skipped and decide fails closed on the primary evidence
    // alone: only the baseline GraphQL read happened.
    const graphqlCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url).includes('/graphql'),
    );
    expect(graphqlCalls).toHaveLength(1);
  });

  it('delivers through the 9B model when it is explicitly selected, with its own pricing', async () => {
    const state = baseState();
    const fetchMock = dispatchFetch(state);
    const delivery = await generateCloudflareRasterImageFreeProofV15(
      INPUT,
      { ...ENV, ORIGIN_CLOUDFLARE_IMAGE_MODEL: '@cf/black-forest-labs/flux-2-klein-9b' },
      fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
    );
    expect(delivery.result.model).toBe('@cf/black-forest-labs/flux-2-klein-9b');
    // 256x256 on 9B still pays the flat first-megapixel charge.
    expect(delivery.usage.estimatedGenerationNeurons).toBe(1364);
    expect(delivery.result.costEvidence).toBe('post-generation-usage-zero-confirmed');
  });

  it('selects the highest-scoring passing candidate in best-of-2', async () => {
    // One defect on each of three axes derives to 3,3,3,4,4,4,4 — a
    // 0-100 score of 89 (the retired uniform-3.6 fixture's 90 is not
    // representable with integer derived sums: 25 -> 89, 26 -> 93).
    const score89 = JSON.stringify({
      promptAdherence: ['依頼とわずかに異なる要素があります'],
      composition: ['主体がわずかに中心からずれています'],
      subjectIntegrity: ['輪郭の一部がわずかに歪んでいます'],
      styleExecution: [], textHandling: [], artifactControl: [], professionalUsefulness: [],
      safetyPassed: true, safetyIssues: [], summary: '良好です。',
    });
    const state = baseState({ criticAnswers: [score89, PASSING_CRITIC_ANSWER] });
    const fetchMock = dispatchFetch(state);
    const delivery = await generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST, maxCandidates: 2 },
    );
    expect(state.imageRuns).toBe(2);
    expect(delivery.usage.candidatesPlanned).toBe(2);
    expect(delivery.usage.candidatesGenerated).toBe(2);
    expect(delivery.quality.selectedCandidateIndex).toBe(1);
    expect(delivery.quality.candidates).toEqual([
      { index: 0, retried: false, semanticScore: 89, passed: true, selected: false },
      { index: 1, retried: false, semanticScore: 100, passed: true, selected: true },
    ]);
    expect(delivery.quality.retryUsed).toBe(false);
  });

  it('runs the planned candidates concurrently and delivers the same winner and reconciliation as serial execution', async () => {
    const score89 = JSON.stringify({
      promptAdherence: ['依頼とわずかに異なる要素があります'],
      composition: ['主体がわずかに中心からずれています'],
      subjectIntegrity: ['輪郭の一部がわずかに歪んでいます'],
      styleExecution: [], textHandling: [], artifactControl: [], professionalUsefulness: [],
      safetyPassed: true, safetyIssues: [], summary: '良好です。',
    });
    const state = baseState({
      criticAnswers: [score89, PASSING_CRITIC_ANSWER],
      generationReportedNeurons: 104.2,
      criticReportedNeurons: 41.3,
    });
    const baseFetch = dispatchFetch(state);
    // Hold every FLUX run open briefly so concurrent candidate chains
    // observably overlap; a serial loop could never have two generation
    // calls in flight at once.
    let generationsInFlight = 0;
    let maxGenerationsInFlight = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).includes('/ai/run/@cf/black-forest-labs/flux-2-klein-')) {
        return baseFetch(url, init);
      }
      generationsInFlight += 1;
      maxGenerationsInFlight = Math.max(maxGenerationsInFlight, generationsInFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return await baseFetch(url, init);
      } finally {
        generationsInFlight -= 1;
      }
    });
    const delivery = await generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST, maxCandidates: 2 },
    );
    // Both candidate generations were in flight at the same time.
    expect(maxGenerationsInFlight).toBe(2);
    expect(state.imageRuns).toBe(2);
    expect(state.criticRuns).toBe(2);
    // Same outcome the serial loop produced for these candidates: the
    // higher-scoring second candidate wins, the reserve was computed for
    // 2 candidates + the retry up front (3 x (32 + 256)), and
    // reconciliation is carried by the complete per-request reports
    // (104.2 generation + 41.3 critic, per candidate).
    expect(delivery.usage).toMatchObject({
      candidatesPlanned: 2,
      candidatesGenerated: 2,
      reservedNeurons: 864,
      reconciliationMethod: 'per-request-reported',
      reportedNeurons: 291,
    });
    expect(delivery.quality.selectedCandidateIndex).toBe(1);
    expect(delivery.quality.candidates).toEqual([
      { index: 0, retried: false, semanticScore: 89, passed: true, selected: false },
      { index: 1, retried: false, semanticScore: 100, passed: true, selected: true },
    ]);
    expect(delivery.quality.retryUsed).toBe(false);
    // Complete reports skip the aggregate polling window, exactly as in
    // serial execution: only the quota baseline GraphQL read happened.
    const graphqlCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url).includes('/graphql'),
    );
    expect(graphqlCalls).toHaveLength(1);
  });

  it('retries once with critic findings folded into the prompt when every candidate fails', async () => {
    const state = baseState({ criticAnswers: [FAILING_CRITIC_ANSWER, PASSING_CRITIC_ANSWER] });
    const fetchMock = dispatchFetch(state);
    const delivery = await generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
    );
    expect(state.imageRuns).toBe(2);
    expect(delivery.quality.retryUsed).toBe(true);
    expect(delivery.quality.selectedCandidateIndex).toBe(1);
    expect(state.generationPrompts[1]).toContain('Revision:');
  });

  it('does not retry when the quota cannot budget a second attempt', async () => {
    // remaining = 388: one candidate (288) fits, a retry (another 288) does not.
    const state = baseState({ usedNeurons: 9_612, criticAnswer: FAILING_CRITIC_ANSWER });
    const fetchMock = dispatchFetch(state);
    await expect(generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch, { now: NOW_IN_WINDOW },
    )).rejects.toThrow('RASTER_SEMANTIC_CRITIC_REJECTED');
    expect(state.imageRuns).toBe(1);
  });

  it('shrinks the candidate count to what the remaining quota affords', async () => {
    // remaining = 388 affords only 1 of the 2 requested candidates.
    const state = baseState({ usedNeurons: 9_612 });
    const fetchMock = dispatchFetch(state);
    const delivery = await generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST, maxCandidates: 2 },
    );
    expect(delivery.usage.candidatesPlanned).toBe(1);
    expect(state.imageRuns).toBe(1);
  });

  it('generates from the enhanced prompt when the free chat model rewrites it', async () => {
    const enhanced = 'A serene lake at sunrise, mirror-like water reflection, soft golden light, photorealistic';
    const state = baseState({ openRouterAnswer: enhanced });
    const fetchMock = dispatchFetch(state);
    const delivery = await generateCloudflareRasterImageFreeProofV15(
      INPUT,
      { ...ENV, OPENROUTER_API_KEY: 'test-openrouter-key' },
      fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
    );
    expect(delivery.quality.promptEnhancement).toMatchObject({ applied: true, model: 'google/gemma-4-31b-it:free' });
    expect(state.generationPrompts[0]).toContain('mirror-like water reflection');
  });
});
