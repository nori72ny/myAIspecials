import { describe, expect, it } from 'vitest';

import { compileRasterVisualPromptV15 } from './rasterVisualPromptCompilerV15';

describe('rasterVisualPromptCompilerV15', () => {
  it('translates a premium mobile advertisement into visual design instructions', () => {
    const plan = compileRasterVisualPromptV15(
      '高級感のある黒背景で未来的なORIGIN Personalの広告画像。スマホ広告用。文字は「ORIGIN Personal」。AIっぽすぎず洗練させたい。',
      864,
      1536,
    );

    expect(plan).toMatchObject({
      version: 'raster-visual-plan-v1',
      purpose: 'advertising',
      style: 'premium-minimal',
      aspect: 'portrait',
      preserveExactText: true,
    });
    expect(plan.exactText).toContain('ORIGIN Personal');
    expect(plan.composition).toContain('negative space');
    expect(plan.lighting).toContain('controlled');
    expect(plan.providerPrompt).toContain('Original request:');
    expect(plan.providerPrompt).toContain('Render only these required visible words exactly as written');
    expect(plan.providerPrompt).toContain('"ORIGIN Personal"');
    expect(plan.negativePrompt).toContain('generic AI robot clichés');
    expect(plan.negativePrompt).not.toContain('illegible accidental text');
  });

  it('adapts composition, lighting and camera to portraits, products and landscapes', () => {
    const portrait = compileRasterVisualPromptV15('実写の人物ポートレートを作って', 1024, 1536);
    expect(portrait.purpose).toBe('portrait');
    expect(portrait.style).toBe('photorealistic');
    expect(portrait.camera).toContain('85mm-equivalent portrait');

    const product = compileRasterVisualPromptV15('高級腕時計の商品写真を作って', 1536, 1024);
    expect(product.purpose).toBe('product');
    expect(product.composition).toContain('hero-subject');
    expect(product.camera).toContain('commercial product');

    const landscape = compileRasterVisualPromptV15('山と湖の風景画像を生成して', 1536, 864);
    expect(landscape.purpose).toBe('landscape');
    expect(landscape.aspect).toBe('landscape');
    expect(landscape.lighting).toContain('atmospheric');
  });

  it('does not encourage accidental typography when the request has no required visible copy', () => {
    const plan = compileRasterVisualPromptV15('静かな湖の朝焼けを写真のように描いて', 1024, 1024);
    expect(plan.exactText).toEqual([]);
    expect(plan.providerPrompt).toContain('Do not add logos, watermarks, signatures, or unnecessary text.');
    expect(plan.negativePrompt).toContain('illegible accidental text');
  });

  it('is deterministic and bounded for the same request', () => {
    const source = '未来的で洗練されたAIサービスの横長バナーを作って';
    const a = compileRasterVisualPromptV15(source, 1536, 864);
    const b = compileRasterVisualPromptV15(source, 1536, 864);
    expect(a).toEqual(b);
    expect(a.providerPrompt.length).toBeLessThanOrEqual(1_850);
    expect(a.negativePrompt.length).toBeLessThanOrEqual(900);
  });

  it('fails closed for empty or oversized source requests', () => {
    expect(() => compileRasterVisualPromptV15('')).toThrow('INVALID_RASTER_VISUAL_SOURCE');
    expect(() => compileRasterVisualPromptV15('x'.repeat(2_001))).toThrow('INVALID_RASTER_VISUAL_SOURCE');
  });
});
