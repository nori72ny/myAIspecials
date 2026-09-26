import { describe, expect, it, vi } from 'vitest';
import {
  critiqueRasterWithVisionV15,
  ORIGIN_RASTER_VISION_CRITIC_MODEL_V15,
  rasterVisionCriticStatusV15,
  verifyRasterVisionCriticModelV15,
} from './rasterVisionCriticV15';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const freeModelEntry = {
  id: ORIGIN_RASTER_VISION_CRITIC_MODEL_V15,
  pricing: { prompt: '0', completion: '0' },
};

const perfectCriticPayload = {
  dimensions: {
    promptAdherence: 94,
    composition: 90,
    realism: 88,
    artifactControl: 92,
    textAccuracy: 96,
  },
  issues: [],
  repairInstructions: [],
};

describe('rasterVisionCriticV15', () => {
  it('qualifies only the exact free multimodal critic model at zero prompt and completion price', async () => {
    const fetchMock = vi.fn(async () => json({ data: [freeModelEntry] })) as unknown as typeof fetch;
    await expect(verifyRasterVisionCriticModelV15(fetchMock)).resolves.toBe(true);

    const priced = vi.fn(async () => json({
      data: [{ ...freeModelEntry, pricing: { prompt: '0.0001', completion: '0' } }],
    })) as unknown as typeof fetch;
    await expect(verifyRasterVisionCriticModelV15(priced)).resolves.toBe(false);
  });

  it('reports truthful readiness and stays disabled without a server-side OpenRouter credential', async () => {
    await expect(rasterVisionCriticStatusV15({})).resolves.toMatchObject({
      configured: false,
      ready: false,
      zeroCostVerified: false,
      paidFallbackEnabled: false,
      reason: 'VISION_CRITIC_KEY_NOT_CONFIGURED',
    });
  });

  it('evaluates a generated image using the exact free vision model and verifies zero cost', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: [freeModelEntry] }))
      .mockResolvedValueOnce(json({
        model: ORIGIN_RASTER_VISION_CRITIC_MODEL_V15.replace(/:free$/, ''),
        choices: [{ message: { content: JSON.stringify(perfectCriticPayload) } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          cost: 0,
          cost_details: { upstream_inference_cost: 0 },
          is_byok: false,
        },
        billing_tier: 'free',
        is_free: true,
        pricing: { prompt: 0, completion: 0 },
      })) as unknown as typeof fetch;

    const result = await critiqueRasterWithVisionV15({
      bytes: Buffer.from([1, 2, 3, 4, 5, 6]),
      mimeType: 'image/png',
      prompt: '高級感のある黒背景のORIGIN Personal広告画像',
    }, { OPENROUTER_API_KEY: 'server-only-key' }, fetchMock);

    expect(result).toMatchObject({
      version: 'raster-vision-critic-v1',
      model: ORIGIN_RASTER_VISION_CRITIC_MODEL_V15,
      passed: true,
      actualCostUsd: 0,
      fallbackUsed: false,
    });
    expect(result.score).toBeGreaterThanOrEqual(82);
    expect(result.imageSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const criticRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const body = JSON.parse(String(criticRequest.body));
    expect(body.model).toBe(ORIGIN_RASTER_VISION_CRITIC_MODEL_V15);
    expect(body.provider).toMatchObject({
      allow_fallbacks: false,
      data_collection: 'deny',
      zdr: true,
      max_price: { prompt: 0, completion: 0, request: 0 },
    });
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it('rejects non-zero billing even if the critic text looks valid', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: [freeModelEntry] }))
      .mockResolvedValueOnce(json({
        model: ORIGIN_RASTER_VISION_CRITIC_MODEL_V15,
        choices: [{ message: { content: JSON.stringify(perfectCriticPayload) } }],
        usage: { cost: 0.001, is_byok: false },
      })) as unknown as typeof fetch;

    await expect(critiqueRasterWithVisionV15({
      bytes: Buffer.from([1, 2, 3]),
      mimeType: 'image/jpeg',
      prompt: '商品広告',
    }, { OPENROUTER_API_KEY: 'server-only-key' }, fetchMock)).rejects.toThrow('VISION_CRITIC_COST_UNVERIFIED');
  });

  it('marks visibly weak outputs as rejected and returns bounded repair instructions', async () => {
    const weak = {
      dimensions: {
        promptAdherence: 70,
        composition: 72,
        realism: 68,
        artifactControl: 60,
        textAccuracy: 55,
      },
      issues: ['右手の指が不自然', '指定文字が誤っている'],
      repairInstructions: ['右手のみ自然な5本指へ修正', '指定文字を正確に再描画'],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: [freeModelEntry] }))
      .mockResolvedValueOnce(json({
        model: ORIGIN_RASTER_VISION_CRITIC_MODEL_V15,
        choices: [{ message: { content: ```json\n${JSON.stringify(weak)}\n``` } }],
        usage: { cost: 0, cost_details: { upstream_inference_cost: 0 }, is_byok: false },
        billing_tier: 'free',
        is_free: true,
      })) as unknown as typeof fetch;

    const result = await critiqueRasterWithVisionV15({
      bytes: Buffer.from([1, 2, 3]),
      mimeType: 'image/webp',
      prompt: '人物を自然に描き、文字はORIGIN Personal',
    }, { OPENROUTER_API_KEY: 'server-only-key' }, fetchMock);

    expect(result.passed).toBe(false);
    expect(result.issues).toContain('右手の指が不自然');
    expect(result.repairInstructions).toContain('指定文字を正確に再描画');
  });
});
