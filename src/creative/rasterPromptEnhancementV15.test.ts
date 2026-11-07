import { describe, expect, it, vi } from 'vitest';
import { enhanceRasterPromptV15 } from './rasterPromptEnhancementV15';

const NOW_IN_WINDOW = Date.parse('2026-11-06T12:00:00.000Z');
const ENV: NodeJS.ProcessEnv = { OPENROUTER_API_KEY: 'test-openrouter-key' };
const PROMPT = '静かな湖と朝焼け';

function chatResponse(content: unknown, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('rasterPromptEnhancementV15', () => {
  it('returns the original prompt without any network call when no key is configured', async () => {
    const fetchMock = vi.fn();
    await expect(enhanceRasterPromptV15(PROMPT, {}, fetchMock as unknown as typeof fetch, NOW_IN_WINDOW))
      .resolves.toMatchObject({ prompt: PROMPT, applied: false, reason: 'PROMPT_ENHANCEMENT_NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('can be disabled explicitly', async () => {
    const fetchMock = vi.fn();
    await expect(enhanceRasterPromptV15(
      PROMPT,
      { ...ENV, ORIGIN_RASTER_PROMPT_ENHANCEMENT: 'false' },
      fetchMock as unknown as typeof fetch,
      NOW_IN_WINDOW,
    )).resolves.toMatchObject({ prompt: PROMPT, applied: false, reason: 'PROMPT_ENHANCEMENT_DISABLED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails soft when the free-model evidence is stale', async () => {
    const fetchMock = vi.fn();
    await expect(enhanceRasterPromptV15(
      PROMPT, ENV, fetchMock as unknown as typeof fetch, Date.parse('2026-12-01T00:00:00.000Z'),
    )).resolves.toMatchObject({ prompt: PROMPT, applied: false, reason: 'PROMPT_ENHANCEMENT_EVIDENCE_UNAVAILABLE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies a sanitized enhanced prompt from the free chat model', async () => {
    const fetchMock = vi.fn(async () => chatResponse(
      '  "A serene mountain lake at sunrise, mirror reflection, soft golden light, photorealistic"  ',
    )) as unknown as typeof fetch;
    const result = await enhanceRasterPromptV15(PROMPT, ENV, fetchMock, NOW_IN_WINDOW);
    expect(result.applied).toBe(true);
    expect(result.model).toBe('google/gemma-4-31b-it:free');
    expect(result.prompt).toBe('A serene mountain lake at sunrise, mirror reflection, soft golden light, photorealistic');
    expect(result.externalNetworkRequests).toBe(1);
  });

  it('fails soft on HTTP errors and transport failures', async () => {
    const httpFailure = vi.fn(async () => chatResponse(null, 500)) as unknown as typeof fetch;
    await expect(enhanceRasterPromptV15(PROMPT, ENV, httpFailure, NOW_IN_WINDOW))
      .resolves.toMatchObject({ prompt: PROMPT, applied: false, reason: 'PROMPT_ENHANCEMENT_HTTP_ERROR' });

    const transportFailure = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await expect(enhanceRasterPromptV15(PROMPT, ENV, transportFailure, NOW_IN_WINDOW))
      .resolves.toMatchObject({ prompt: PROMPT, applied: false, reason: 'PROMPT_ENHANCEMENT_UNAVAILABLE' });
  });

  it('progresses through the zero-cost policy stages when no endpoint matches the strict stage', async () => {
    const providers: unknown[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      providers.push(JSON.parse(String(init?.body)).provider);
      if (providers.length === 1) return chatResponse(null, 404);
      return chatResponse('A serene mountain lake at sunrise, mirror reflection, soft golden light, photorealistic');
    }) as unknown as typeof fetch;
    const result = await enhanceRasterPromptV15(PROMPT, ENV, fetchMock, NOW_IN_WINDOW);
    expect(result.applied).toBe(true);
    expect(result.externalNetworkRequests).toBe(2);
    // Stage 1 keeps the strict ZDR requirement; stage 2 relaxes only that
    // filter. Cost and data-collection restrictions never relax.
    expect(providers[0]).toMatchObject({ zdr: true, data_collection: 'deny', allow_fallbacks: false });
    expect(providers[1]).not.toHaveProperty('zdr');
    expect(providers[1]).toMatchObject({ data_collection: 'deny', allow_fallbacks: false });
  });

  it('reports NO_ENDPOINT when every policy stage finds no matching endpoint', async () => {
    const fetchMock = vi.fn(async () => chatResponse(null, 403)) as unknown as typeof fetch;
    const result = await enhanceRasterPromptV15(PROMPT, ENV, fetchMock, NOW_IN_WINDOW);
    expect(result).toMatchObject({ prompt: PROMPT, applied: false, reason: 'PROMPT_ENHANCEMENT_NO_ENDPOINT' });
    expect(result.externalNetworkRequests).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reports RATE_LIMITED on 429 without burning the remaining policy stages', async () => {
    const fetchMock = vi.fn(async () => chatResponse(null, 429)) as unknown as typeof fetch;
    const result = await enhanceRasterPromptV15(PROMPT, ENV, fetchMock, NOW_IN_WINDOW);
    expect(result).toMatchObject({ prompt: PROMPT, applied: false, reason: 'PROMPT_ENHANCEMENT_RATE_LIMITED' });
    expect(result.externalNetworkRequests).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports TIMEOUT when the call is aborted', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    const fetchMock = vi.fn(async () => { throw abortError; }) as unknown as typeof fetch;
    await expect(enhanceRasterPromptV15(PROMPT, ENV, fetchMock, NOW_IN_WINDOW))
      .resolves.toMatchObject({ prompt: PROMPT, applied: false, reason: 'PROMPT_ENHANCEMENT_TIMEOUT' });
  });

  it('fails soft on unusable model output', async () => {
    const tooShort = vi.fn(async () => chatResponse('ok')) as unknown as typeof fetch;
    await expect(enhanceRasterPromptV15(PROMPT, ENV, tooShort, NOW_IN_WINDOW))
      .resolves.toMatchObject({ prompt: PROMPT, applied: false, reason: 'PROMPT_ENHANCEMENT_INVALID_OUTPUT' });

    const notAString = vi.fn(async () => chatResponse(42)) as unknown as typeof fetch;
    await expect(enhanceRasterPromptV15(PROMPT, ENV, notAString, NOW_IN_WINDOW))
      .resolves.toMatchObject({ prompt: PROMPT, applied: false, reason: 'PROMPT_ENHANCEMENT_INVALID_OUTPUT' });
  });
});
