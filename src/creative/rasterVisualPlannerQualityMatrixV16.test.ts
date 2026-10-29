import { describe, expect, it } from 'vitest';

import { planRasterVisualRequestV15 } from './rasterVisualPlannerV15';

const REQUEST_MATRIX = [
  {
    label: 'commercial product photography',
    request: 'EC向けの高級な香水ボトルの商品広告を4:5で作ってください',
    purpose: 'product',
    templateId: 'product-ad',
    requiredPrompt: 'accurate product geometry',
  },
  {
    label: 'portrait photography',
    request: '自然な光のプロフェッショナルな人物ポートレートを作ってください',
    purpose: 'portrait',
    templateId: 'general-square',
    requiredPrompt: 'natural face and anatomy',
  },
  {
    label: 'brand logo',
    request: 'ORIGINのミニマルなロゴを作ってください',
    purpose: 'logo',
    templateId: 'general-square',
    requiredPrompt: 'single memorable mark',
  },
  {
    label: 'information design',
    request: '水循環を説明する科学的なインフォグラフィックを作ってください',
    purpose: 'infographic',
    templateId: 'general-square',
    requiredPrompt: 'structured information hierarchy',
  },
  {
    label: 'app screen concept',
    request: '高級感のあるモバイルアプリのUI画面モックアップを作ってください',
    purpose: 'ui-visual',
    templateId: 'general-square',
    requiredPrompt: 'precise alignment',
  },
  {
    label: 'anime illustration',
    request: '夕暮れの街を歩く少女の高品質なアニメイラストを作ってください',
    purpose: 'illustration',
    templateId: 'general-square',
    requiredPrompt: 'coherent anatomy and clean linework',
  },
  {
    label: 'watercolor illustration',
    request: '青い花と白い鳥を描いた水彩イラストを作ってください',
    purpose: 'illustration',
    templateId: 'general-square',
    requiredPrompt: 'organic pigments and subtle paper texture',
  },
  {
    label: 'cinematic scenery',
    request: '雨上がりの東京を映画のようなリアルな写真で作ってください',
    purpose: 'photograph',
    templateId: 'general-square',
    requiredPrompt: 'cinematic visual storytelling',
  },
  {
    label: 'YouTube thumbnail',
    request: 'YouTubeサムネイル用に、宇宙探査をテーマにした印象的な画像を作ってください',
    purpose: 'thumbnail',
    templateId: 'youtube-thumbnail',
    requiredPrompt: 'readable at small size',
  },
  {
    label: 'Instagram story campaign',
    request: 'Instagram Story用に春の新商品キャンペーン画像を9:16で作ってください',
    purpose: 'social',
    templateId: 'instagram-story',
    requiredPrompt: 'vertical story framing',
  },
  {
    label: 'print poster',
    request: 'A4印刷用の音楽イベントポスターを作ってください',
    purpose: 'poster',
    templateId: 'a4-poster',
    requiredPrompt: 'generous trim-safe margins',
  },
  {
    label: 'exact Japanese copy',
    request: '広告画像に「春、新しい自分へ。」という文字を正確に入れてください',
    purpose: 'advertisement',
    templateId: 'general-square',
    requiredPrompt: '春、新しい自分へ。',
  },
] as const;

describe('rasterVisualPlannerV15 cross-category quality matrix', () => {
  it.each(REQUEST_MATRIX)('compiles $label into a purpose-specific visual plan', ({ request, purpose, templateId, requiredPrompt }) => {
    const plan = planRasterVisualRequestV15(request);

    expect(plan.ready).toBe(true);
    expect(plan.questions).toEqual([]);
    expect(plan.purpose).toBe(purpose);
    expect(plan.templateId).toBe(templateId);
    expect(plan.width).toBeGreaterThanOrEqual(256);
    expect(plan.height).toBeGreaterThanOrEqual(256);
    expect(plan.compiledPrompt).toContain(requiredPrompt);
    expect(plan.negativePrompt).toContain('watermark');
    expect(plan.composition.length).toBeGreaterThanOrEqual(3);
    expect(plan.lighting.length).toBeGreaterThan(0);
    expect(plan.camera.length).toBeGreaterThan(0);
  });

  it('preserves exact copy and enables deterministic typography for a text-sensitive creative', () => {
    const plan = planRasterVisualRequestV15('広告画像に「春、新しい自分へ。」という文字を正確に入れてください');

    expect(plan.exactText).toEqual(['春、新しい自分へ。']);
    expect(plan.requiresDeterministicTypography).toBe(true);
    expect(plan.compiledPrompt).toContain('do not render this critical text yourself');
    expect(plan.negativePrompt).toContain('misspelled lettering');
  });

  it('keeps an explicit no-text request free of invented copy and typography overlays', () => {
    const plan = planRasterVisualRequestV15('青い花と白い鳥の水彩イラスト。文字なしで作ってください');

    expect(plan.ready).toBe(true);
    expect(plan.exactText).toEqual([]);
    expect(plan.requiresDeterministicTypography).toBe(false);
    expect(plan.negativePrompt).toContain('unwanted text');
    expect(plan.negativePrompt).toContain('unwanted logo');
  });

  it('does not claim that one candidate is a best-of-N selection', () => {
    const plan = planRasterVisualRequestV15('高級な香水ボトルの商品広告を作ってください');

    expect(plan.purpose).toBe('product');
    expect(plan.composition).toContain('hero product remains unmistakable');
  });
});
