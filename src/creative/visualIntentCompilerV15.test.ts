import { describe, expect, it } from 'vitest';
import { compileVisualIntentV15, imageRequirementGapsV15 } from './visualIntentCompilerV15';

describe('visualIntentCompilerV15', () => {
  it('turns a vague visual request into a structured provider-ready plan without inventing text', () => {
    const plan = compileVisualIntentV15({
      prompt: '高級感のある黒背景で未来的なORIGINのスマホ広告画像を作って',
      width: 864,
      height: 1536,
    });

    expect(plan.purpose).toBe('product-ad');
    expect(plan.orientation).toBe('portrait');
    expect(plan.positivePrompt).toContain('premium negative space');
    expect(plan.positivePrompt).toContain('864x1536');
    expect(plan.negativePrompt).toContain('unwanted text');
    expect(plan.requiresTypographyOverlay).toBe(false);
  });

  it('keeps requested copy out of the raster model and reserves deterministic typography space', () => {
    const plan = compileVisualIntentV15({
      prompt: 'Instagram用のミニマル広告。文字は「ORIGIN Personal」。黒背景で洗練された雰囲気。',
      width: 1080,
      height: 1350,
    });

    expect(plan.purpose).toBe('social-post');
    expect(plan.style).toBe('minimal');
    expect(plan.exactText).toContain('ORIGIN Personal');
    expect(plan.requiresTypographyOverlay).toBe(true);
    expect(plan.positivePrompt).toContain('must not be redrawn by the image model');
    expect(plan.positivePrompt).toContain('ORIGIN Personal');
    expect(plan.negativePrompt).not.toContain('unwanted text');
    expect(plan.negativePrompt).toContain('garbled lettering');
  });

  it('adapts composition and style to portraits and cinematic landscape requests', () => {
    const portrait = compileVisualIntentV15({
      prompt: '自然光のリアルな人物ポートレート写真',
      width: 1024,
      height: 1536,
    });
    expect(portrait.purpose).toBe('portrait');
    expect(portrait.style).toBe('photorealistic');
    expect(portrait.positivePrompt).toContain('clear face hierarchy');

    const landscape = compileVisualIntentV15({
      prompt: '映画のような北海道の雪景色を描いて',
      width: 1536,
      height: 864,
    });
    expect(landscape.purpose).toBe('landscape');
    expect(landscape.style).toBe('cinematic');
    expect(landscape.positivePrompt).toContain('foreground-midground-background depth');
  });

  it('asks only for material gaps on truly underspecified image requests', () => {
    expect(imageRequirementGapsV15('画像を作って')).toEqual(['subject']);
    expect(imageRequirementGapsV15('Instagram画像を作って')).toEqual(['subject']);
    expect(imageRequirementGapsV15('Instagram投稿用に、夕焼けの海を9:16でミニマルに作って')).toEqual([]);
    expect(imageRequirementGapsV15('夕焼けの海をリアルに描いて')).toEqual([]);
  });
});
