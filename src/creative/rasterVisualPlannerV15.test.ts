import { describe, expect, it } from 'vitest';

import { planRasterVisualRequestV15 } from './rasterVisualPlannerV15';

describe('rasterVisualPlannerV15', () => {
  it('asks focused questions for an underspecified image request instead of generating a generic image', () => {
    const plan = planRasterVisualRequestV15('画像を作ってください');
    expect(plan.ready).toBe(false);
    expect(plan.questions).toHaveLength(1);
    expect(plan.questions[0]).toContain('何を主役');
  });

  it('turns a mobile premium ad request into a production-oriented visual spec', () => {
    const plan = planRasterVisualRequestV15(
      'スマホ広告用に、高級感のある黒背景で未来的なORIGIN Personalの広告画像を9:16で作ってください',
    );
    expect(plan.ready).toBe(true);
    expect(plan.purpose).toBe('advertisement');
    expect(plan.platform).toBe('vertical-mobile-story');
    expect(plan).toMatchObject({
      templateId: 'instagram-story',
      safeMarginPct: 9,
      typographyZone: 'bottom',
      width: 864,
      height: 1536,
    });
    expect(plan.style.join(' ')).toContain('premium restrained');
    expect(plan.style.join(' ')).toContain('futuristic');
    expect(plan.composition).toContain('clear single hero subject');
    expect(plan.compiledPrompt).toContain('controlled commercial key light');
    expect(plan.compiledPrompt).toContain('Template: instagram-story');
    expect(plan.compiledPrompt).toContain('Safe area: keep critical content at least 9% away from the canvas edge');
    expect(plan.negativePrompt).toContain('extra fingers');
  });

  it('extracts exact quoted copy and marks typography-sensitive requests', () => {
    const plan = planRasterVisualRequestV15(
      'Instagram 4:5の広告画像。文字は「ORIGIN Personal」を必ず入れて、高級でミニマルに。',
    );
    expect(plan.exactText).toEqual(['ORIGIN Personal']);
    expect(plan.requiresDeterministicTypography).toBe(true);
    expect(plan.width).toBe(1024);
    expect(plan.height).toBe(1280);
    expect(plan.compiledPrompt).toContain('"ORIGIN Personal"');
    expect(plan.compiledPrompt).toContain('rendered later by ORIGIN deterministic typography');
    expect(plan.compiledPrompt).toContain('do not render this critical text yourself');
  });

  it('selects an LP hero template with crop-resilient negative space guidance', () => {
    const plan = planRasterVisualRequestV15('ORIGINのLPヒーロー用キービジュアルを、洗練された未来的な雰囲気で作ってください');
    expect(plan).toMatchObject({
      templateId: 'lp-hero',
      platform: 'web-hero',
      width: 1536,
      height: 864,
      typographyZone: 'left',
    });
    expect(plan.composition).toContain('hero subject offset away from copy zone');
    expect(plan.composition).toContain('desktop and mobile crop resilience');
  });

  it('compiles exact requested dimensions into the visual plan and provenance', () => {
    const plan = planRasterVisualRequestV15('広告画像を作ってください', { width: 1200, height: 628 });
    expect(plan).toMatchObject({
      templateId: 'custom-size',
      platform: 'custom-size',
      width: 1200,
      height: 628,
      safeMarginPct: 7,
    });
    expect(plan.compiledPrompt).toContain('Template: custom-size');
    expect(plan.compiledPrompt).toContain('Output: 1200x628');
  });

  it('does not ask an aspect-ratio question for ordinary unconstrained photographs', () => {
    const plan = planRasterVisualRequestV15('朝焼けの富士山をリアルな写真として生成してください');
    expect(plan.ready).toBe(true);
    expect(plan.purpose).toBe('photograph');
    expect(plan.questions).toEqual([]);
  });
});
