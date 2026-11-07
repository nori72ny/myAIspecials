import { describe, expect, it, vi } from 'vitest';
import { generateCloudflareRasterImageFreeProofV15 } from './cloudflareRasterFreeGenerationV15';

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

const PASSING_CRITIC_ANSWER = JSON.stringify({
  promptAdherence: 4,
  composition: 4,
  subjectIntegrity: 4,
  styleExecution: 4,
  textHandling: 4,
  artifactControl: 4,
  professionalUsefulness: 4,
  safetyPassed: true,
  safetyIssues: [],
  criticalIssues: [],
  summary: '依頼どおりの画像です。',
});

const FAILING_CRITIC_ANSWER = JSON.stringify({
  promptAdherence: 1,
  composition: 2,
  subjectIntegrity: 2,
  styleExecution: 2,
  textHandling: 3,
  artifactControl: 2,
  professionalUsefulness: 1,
  safetyPassed: true,
  safetyIssues: [],
  criticalIssues: ['主体が依頼と異なります'],
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
  generationPrompts: string[];
  openRouterAnswer?: string;
  /** Analytics lag: the GraphQL total never reflects this request's runs. */
  lagUsage?: boolean;
  /** When set, the FLUX run envelope reports this many Neurons for itself. */
  generationReportedNeurons?: number;
  /** When set, the critic run envelope (live shape) reports this many Neurons. */
  criticReportedNeurons?: number;
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
  return vi.fn(async (url: string, init?: RequestInit) => {
    const target = String(url);
    if (target.includes('/workers/account-settings')) {
      return envelope({ default_usage_model: state.usageModel ?? 'bundled' });
    }
    if (target.includes('/subscriptions')) return envelope(state.subscriptions ?? []);
    if (target.includes('/ai/models/schema')) return envelope({ input: {}, output: {} });
    if (target.includes('/graphql')) {
      if (state.graphqlBroken) {
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
      observedDeltaNeurons: 0,
      usedAfterNeurons: 100,
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

  it('never lets per-request reports rescue an over-bound aggregate delta', async () => {
    const state = baseState({
      generationDelta: 5_000,
      generationReportedNeurons: 140,
      criticReportedNeurons: 35,
    });
    const fetchMock = dispatchFetch(state);
    await expect(generateCloudflareRasterImageFreeProofV15(
      INPUT, ENV, fetchMock as unknown as typeof fetch,
      { now: NOW_IN_WINDOW, usageVerification: RECONCILE_FAST },
    )).rejects.toThrow('CLOUDFLARE_USAGE_RECONCILIATION_FAILED');
    expect(state.imageRuns).toBe(1);
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
    const score90 = JSON.stringify({
      promptAdherence: 3.6, composition: 3.6, subjectIntegrity: 3.6, styleExecution: 3.6,
      textHandling: 3.6, artifactControl: 3.6, professionalUsefulness: 3.6,
      safetyPassed: true, safetyIssues: [], criticalIssues: [], summary: '良好です。',
    });
    const state = baseState({ criticAnswers: [score90, PASSING_CRITIC_ANSWER] });
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
      { index: 0, retried: false, semanticScore: 90, passed: true, selected: false },
      { index: 1, retried: false, semanticScore: 100, passed: true, selected: true },
    ]);
    expect(delivery.quality.retryUsed).toBe(false);
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
