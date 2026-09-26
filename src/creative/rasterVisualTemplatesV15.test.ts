import { describe, expect, it } from 'vitest';

import {
  rasterVisualTemplatesV15,
  resolveRasterVisualTemplateV15,
} from './rasterVisualTemplatesV15';

describe('rasterVisualTemplatesV15', () => {
  it.each([
    ['Instagram Story 9:16で新商品の広告画像を作って', 'instagram-story', 864, 1536],
    ['Instagram 4:5のフィード投稿を作って', 'instagram-feed', 1024, 1280],
    ['YouTubeのサムネイルを16:9で作って', 'youtube-thumbnail', 1536, 864],
    ['LPのヒーロー用キービジュアルを作って', 'lp-hero', 1536, 864],
    ['A4印刷用のポスターを作って', 'a4-poster', 1086, 1536],
    ['商品広告を4:5で作って', 'product-ad', 1024, 1280],
    ['人物ポートレートのポスターを2:3で作って', 'portrait-poster', 1024, 1536],
    ['LinkedIn用の横長ビジュアルを作って', 'social-landscape', 1536, 864],
  ])('maps %s to %s', (input, id, width, height) => {
    const template = resolveRasterVisualTemplateV15(input);
    expect(template).toMatchObject({ id, width, height });
    expect(template.safeMarginPct).toBeGreaterThanOrEqual(6);
    expect(template.safeMarginPct).toBeLessThanOrEqual(10);
  });

  it('falls back to a safe square template for unconstrained general requests', () => {
    expect(resolveRasterVisualTemplateV15('朝焼けの富士山の写真を作って')).toMatchObject({
      id: 'general-square',
      width: 1024,
      height: 1024,
    });
  });

  it('returns a defensive copy of the template catalog', () => {
    const first = rasterVisualTemplatesV15();
    const second = rasterVisualTemplatesV15();
    expect(first).toHaveLength(9);
    expect(second[0]).not.toBe(first[0]);
    expect(second[0]?.compositionGuidance).not.toBe(first[0]?.compositionGuidance);
  });
});
