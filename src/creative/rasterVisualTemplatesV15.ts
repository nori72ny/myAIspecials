export type RasterVisualTemplateIdV15 =
  | 'general-square'
  | 'instagram-feed'
  | 'instagram-story'
  | 'youtube-thumbnail'
  | 'social-landscape'
  | 'lp-hero'
  | 'a4-poster'
  | 'product-ad'
  | 'portrait-poster';

export type RasterVisualTemplateV15 = {
  id: RasterVisualTemplateIdV15;
  label: string;
  platform: string;
  width: number;
  height: number;
  safeMarginPct: number;
  typographyZone: 'top' | 'bottom' | 'left' | 'right' | 'center' | 'none';
  compositionGuidance: readonly string[];
};

const TEMPLATES: readonly RasterVisualTemplateV15[] = [
  {
    id: 'general-square',
    label: 'General square',
    platform: 'general-square',
    width: 1024,
    height: 1024,
    safeMarginPct: 7,
    typographyZone: 'bottom',
    compositionGuidance: ['balanced square composition', 'clear single focal point', 'keep critical content away from edges'],
  },
  {
    id: 'instagram-feed',
    label: 'Instagram feed 4:5',
    platform: 'instagram-feed',
    width: 1024,
    height: 1280,
    safeMarginPct: 7,
    typographyZone: 'bottom',
    compositionGuidance: ['portrait-feed framing', 'strong top-to-bottom hierarchy', 'reserve breathing room for mobile viewing'],
  },
  {
    id: 'instagram-story',
    label: 'Story / Reel 9:16',
    platform: 'vertical-mobile-story',
    width: 864,
    height: 1536,
    safeMarginPct: 9,
    typographyZone: 'bottom',
    compositionGuidance: ['vertical story framing', 'keep subject inside central mobile-safe region', 'avoid critical details near top/bottom UI overlays'],
  },
  {
    id: 'youtube-thumbnail',
    label: 'YouTube thumbnail 16:9',
    platform: 'youtube-thumbnail',
    width: 1536,
    height: 864,
    safeMarginPct: 6,
    typographyZone: 'left',
    compositionGuidance: ['immediate focal point at small size', 'high subject-background separation', 'reserve one side for large concise copy'],
  },
  {
    id: 'social-landscape',
    label: 'Social landscape 16:9',
    platform: 'social-landscape',
    width: 1536,
    height: 864,
    safeMarginPct: 7,
    typographyZone: 'left',
    compositionGuidance: ['wide editorial composition', 'clear left-to-right visual flow', 'preserve edge-safe copy area'],
  },
  {
    id: 'lp-hero',
    label: 'Landing page hero 16:9',
    platform: 'web-hero',
    width: 1536,
    height: 864,
    safeMarginPct: 8,
    typographyZone: 'left',
    compositionGuidance: ['hero subject offset away from copy zone', 'large intentional negative space', 'desktop and mobile crop resilience'],
  },
  {
    id: 'a4-poster',
    label: 'A4 portrait poster',
    platform: 'a4-poster',
    width: 1086,
    height: 1536,
    safeMarginPct: 8,
    typographyZone: 'bottom',
    compositionGuidance: ['print-like vertical hierarchy', 'clear poster focal point', 'generous trim-safe margins'],
  },
  {
    id: 'product-ad',
    label: 'Product advertisement 4:5',
    platform: 'product-ad',
    width: 1024,
    height: 1280,
    safeMarginPct: 8,
    typographyZone: 'bottom',
    compositionGuidance: ['hero product occupies the primary visual field', 'controlled reflections and supporting environment', 'clean campaign copy zone'],
  },
  {
    id: 'portrait-poster',
    label: 'Portrait poster 2:3',
    platform: 'portrait-poster',
    width: 1024,
    height: 1536,
    safeMarginPct: 8,
    typographyZone: 'bottom',
    compositionGuidance: ['strong vertical portrait composition', 'balanced headroom and body crop', 'keep face and hands away from typography zone'],
  },
];

export function rasterVisualTemplatesV15(): readonly RasterVisualTemplateV15[] {
  return TEMPLATES.map(template => ({ ...template, compositionGuidance: [...template.compositionGuidance] }));
}

export function resolveRasterVisualTemplateV15(input: string): RasterVisualTemplateV15 {
  const text = input.normalize('NFKC');

  if (/(?:Instagram|インスタ).{0,24}(?:Story|ストーリー|Reel|リール)|(?:Story|ストーリー|Reel|リール).{0,24}(?:Instagram|インスタ)|9\s*[:：/]\s*16/i.test(text)) {
    return TEMPLATES.find(template => template.id === 'instagram-story')!;
  }
  if (/(?:YouTube|ユーチューブ).{0,20}(?:サムネ|thumbnail)|(?:サムネ|thumbnail).{0,20}(?:YouTube|ユーチューブ)/i.test(text)) {
    return TEMPLATES.find(template => template.id === 'youtube-thumbnail')!;
  }
  if (/(?:LP|landing page|ランディングページ).{0,24}(?:hero|ヒーロー|kv|キービジュアル)|(?:hero|ヒーロー|キービジュアル).{0,24}(?:LP|landing page|ランディングページ)/i.test(text)) {
    return TEMPLATES.find(template => template.id === 'lp-hero')!;
  }
  if (/(?:A4|印刷|print).{0,20}(?:ポスター|poster)|(?:ポスター|poster).{0,20}A4/i.test(text)) {
    return TEMPLATES.find(template => template.id === 'a4-poster')!;
  }
  if (/(?:商品|product|EC|物撮り).{0,24}(?:広告|ad|advert|campaign|訴求)/i.test(text)) {
    return TEMPLATES.find(template => template.id === 'product-ad')!;
  }
  if (/(?:Instagram|インスタ).{0,24}(?:投稿|feed)|4\s*[:：/]\s*5/i.test(text)) {
    return TEMPLATES.find(template => template.id === 'instagram-feed')!;
  }
  if (/(?:人物|portrait|ポートレート).{0,24}(?:ポスター|poster)|2\s*[:：/]\s*3/i.test(text)) {
    return TEMPLATES.find(template => template.id === 'portrait-poster')!;
  }
  if (/(?:16\s*[:：/]\s*9|横長|landscape|wide|X投稿|LinkedIn)/i.test(text)) {
    return TEMPLATES.find(template => template.id === 'social-landscape')!;
  }
  return TEMPLATES.find(template => template.id === 'general-square')!;
}
