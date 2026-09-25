export type VisualIntentPurposeV15 =
  | 'portrait'
  | 'product-ad'
  | 'social-post'
  | 'poster'
  | 'thumbnail'
  | 'infographic'
  | 'landscape'
  | 'illustration'
  | 'general';

export type VisualIntentStyleV15 =
  | 'photorealistic'
  | 'editorial'
  | 'cinematic'
  | 'minimal'
  | 'anime'
  | 'manga'
  | 'watercolor'
  | 'oil-painting'
  | '3d'
  | 'vector-like'
  | 'unspecified';

export type VisualIntentPlanV15 = {
  purpose: VisualIntentPurposeV15;
  style: VisualIntentStyleV15;
  width: number;
  height: number;
  orientation: 'square' | 'portrait' | 'landscape';
  exactText: readonly string[];
  requiresTypographyOverlay: boolean;
  positivePrompt: string;
  negativePrompt: string;
  assumptions: readonly string[];
};

const QUOTED_TEXT = /["“”「『]([^"“”」』]{1,120})["“”」』]/gu;

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function purposeFor(input: string): VisualIntentPurposeV15 {
  if (/(?:portrait|headshot|人物|ポートレート|プロフィール写真)/i.test(input)) return 'portrait';
  if (/(?:商品|product).{0,20}(?:広告|ad|advert|hero)|(?:広告|ad|advert).{0,20}(?:商品|product)/i.test(input)) return 'product-ad';
  if (/(?:instagram|インスタ|sns|social).{0,20}(?:投稿|post|画像|image)/i.test(input)) return 'social-post';
  if (/(?:poster|ポスター|flyer|チラシ)/i.test(input)) return 'poster';
  if (/(?:thumbnail|サムネ(?:イル)?|youtube)/i.test(input)) return 'thumbnail';
  if (/(?:infographic|インフォグラフィック|図解|比較図)/i.test(input)) return 'infographic';
  if (/(?:landscape|scenery|風景|景色|自然)/i.test(input)) return 'landscape';
  if (/(?:illustration|イラスト|絵|draw|描)/i.test(input)) return 'illustration';
  return 'general';
}

function styleFor(input: string): VisualIntentStyleV15 {
  if (/(?:photoreal|photo|写真|実写|リアル)/i.test(input)) return 'photorealistic';
  if (/(?:editorial|雑誌|エディトリアル)/i.test(input)) return 'editorial';
  if (/(?:cinematic|映画|シネマ)/i.test(input)) return 'cinematic';
  if (/(?:minimal|minimalist|ミニマル|シンプル|apple(?:風|のよう)|洗練)/i.test(input)) return 'minimal';
  if (/(?:anime|アニメ|セル画)/i.test(input)) return 'anime';
  if (/(?:manga|漫画|マンガ|comic)/i.test(input)) return 'manga';
  if (/(?:watercolor|水彩)/i.test(input)) return 'watercolor';
  if (/(?:oil painting|oil-paint|油彩|油絵)/i.test(input)) return 'oil-painting';
  if (/(?:3d|CG|render|レンダー)/i.test(input)) return '3d';
  if (/(?:vector|ベクター|フラットイラスト)/i.test(input)) return 'vector-like';
  return 'unspecified';
}

function exactTextFor(input: string): string[] {
  const values: string[] = [];
  for (const match of input.matchAll(QUOTED_TEXT)) {
    const text = normalize(match[1] ?? '');
    if (text && !values.includes(text)) values.push(text);
  }
  const explicit = input.match(/(?:文字|テキスト|コピー|見出し|title|text)\s*(?:は|:|：)\s*([^。\n]{1,120})/i)?.[1];
  const normalizedExplicit = explicit ? normalize(explicit.replace(/[。,.，]+$/g, '')) : '';
  if (normalizedExplicit && !values.includes(normalizedExplicit)) values.push(normalizedExplicit);
  return values.slice(0, 6);
}

function orientationFor(width: number, height: number): VisualIntentPlanV15['orientation'] {
  if (width === height) return 'square';
  return height > width ? 'portrait' : 'landscape';
}

function compositionGuidance(purpose: VisualIntentPurposeV15, orientation: VisualIntentPlanV15['orientation']): string {
  const orientationText = orientation === 'portrait'
    ? 'vertical composition optimized for mobile viewing'
    : orientation === 'landscape'
      ? 'wide composition with clear lateral visual flow'
      : 'balanced square composition';
  if (purpose === 'portrait') return `${orientationText}, clear face hierarchy, natural pose, clean separation from background`;
  if (purpose === 'product-ad') return `${orientationText}, hero product hierarchy, premium negative space, controlled reflections, commercial lighting`;
  if (purpose === 'poster' || purpose === 'thumbnail' || purpose === 'social-post') return `${orientationText}, immediate focal point, strong hierarchy, generous safe margins, usable negative space for typography`;
  if (purpose === 'infographic') return `${orientationText}, modular grid, clean visual grouping, generous whitespace, avoid rendering dense text inside the generated image`;
  if (purpose === 'landscape') return `${orientationText}, foreground-midground-background depth, natural atmospheric perspective`;
  return `${orientationText}, intentional focal point, coherent perspective, strong subject separation`;
}

function styleGuidance(style: VisualIntentStyleV15): string {
  switch (style) {
    case 'photorealistic': return 'photorealistic natural materials, plausible optics, realistic lighting, authentic texture, restrained post-processing';
    case 'editorial': return 'high-end editorial art direction, refined framing, controlled palette, premium visual hierarchy';
    case 'cinematic': return 'cinematic lighting, motivated light sources, natural depth, restrained color grading, filmic composition';
    case 'minimal': return 'quiet premium minimalism, reduced visual noise, limited palette, large negative space, precision composition';
    case 'anime': return 'clean hand-drawn anime aesthetic, coherent anatomy, deliberate cel shading, detailed painted environment';
    case 'manga': return 'refined manga illustration, confident linework, controlled screentones, expressive composition';
    case 'watercolor': return 'transparent watercolor washes, natural pigment variation, paper texture, controlled edges';
    case 'oil-painting': return 'traditional oil painting, visible brushwork, layered pigments, controlled tonal hierarchy';
    case '3d': return 'high-end physically based 3D rendering, coherent materials, realistic global illumination, polished geometry';
    case 'vector-like': return 'clean vector-like shapes, crisp silhouettes, disciplined geometry, flat controlled palette';
    default: return 'visually coherent professional art direction matched to the subject and intended use';
  }
}

function negativeFor(plan: {
  purpose: VisualIntentPurposeV15;
  exactText: readonly string[];
}): string {
  const negatives = [
    'low quality',
    'blurry',
    'jpeg artifacts',
    'duplicate subject',
    'deformed anatomy',
    'extra limbs',
    'extra fingers',
    'fused fingers',
    'distorted face',
    'broken perspective',
    'inconsistent lighting',
    'unwanted watermark',
    'unwanted signature',
    'visual clutter',
  ];
  if (plan.exactText.length === 0 && plan.purpose !== 'infographic') {
    negatives.push('unwanted text', 'unwanted logo');
  } else {
    negatives.push('garbled lettering', 'misspelled lettering', 'distorted typography');
  }
  return negatives.join(', ');
}

export function compileVisualIntentV15(input: {
  prompt: string;
  width: number;
  height: number;
}): VisualIntentPlanV15 {
  const prompt = normalize(input.prompt);
  if (!prompt) throw new Error('VISUAL_INTENT_PROMPT_REQUIRED');
  const purpose = purposeFor(prompt);
  const style = styleFor(prompt);
  const exactText = exactTextFor(prompt);
  const orientation = orientationFor(input.width, input.height);
  const typographyOverlay = exactText.length > 0 || purpose === 'poster' || purpose === 'thumbnail' || purpose === 'infographic';

  const positivePrompt = [
    prompt,
    `Purpose: ${purpose}.`,
    `Canvas: ${input.width}x${input.height}, ${orientation}.`,
    `Art direction: ${styleGuidance(style)}.`,
    `Composition: ${compositionGuidance(purpose, orientation)}.`,
    'Use physically plausible lighting and geometry where applicable.',
    'Keep important subjects fully inside the frame and preserve clean safe margins.',
    typographyOverlay
      ? 'Reserve a clean high-contrast region for deterministic typography overlay; do not invent extra words or logos.'
      : '',
    exactText.length
      ? `Required copy will be overlaid separately and must not be redrawn by the image model: ${exactText.map((value) => JSON.stringify(value)).join(', ')}.`
      : '',
  ].filter(Boolean).join(' ');

  const assumptions = [
    style === 'unspecified' ? 'style:auto-professional' : '',
    exactText.length ? 'critical-copy:deterministic-overlay' : '',
  ].filter(Boolean);

  return {
    purpose,
    style,
    width: input.width,
    height: input.height,
    orientation,
    exactText,
    requiresTypographyOverlay: typographyOverlay,
    positivePrompt,
    negativePrompt: negativeFor({ purpose, exactText }),
    assumptions,
  };
}

export function imageRequirementGapsV15(input: string): readonly ('subject' | 'purpose' | 'format')[] {
  const prompt = normalize(input);
  if (!prompt) return ['subject'];
  const gaps: Array<'subject' | 'purpose' | 'format'> = [];
  const genericOnly = /^(?:画像|イラスト|写真|絵)(?:を)?(?:作って|作成して|生成して|描いて|ほしい|欲しい|お願いします?)[。.!！\s]*$/u.test(prompt);
  if (genericOnly || prompt.length < 8) gaps.push('subject');
  if (!/(?:instagram|インスタ|sns|web|lp|広告|ad|poster|ポスター|thumbnail|サムネ|資料|presentation|印刷|print|壁紙|wallpaper|プロフィール|icon|アイコン)/i.test(prompt)) {
    gaps.push('purpose');
  }
  if (!/(?:\b\d{2,4}\s*[x×]\s*\d{2,4}\b|\b\d+\s*[:：/]\s*\d+\b|縦長|横長|正方形|portrait|landscape|square|story)/i.test(prompt)) {
    gaps.push('format');
  }
  return gaps;
}
