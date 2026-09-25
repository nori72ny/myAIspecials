export type RasterVisualPurposeV15 =
  | 'advertising'
  | 'poster'
  | 'social'
  | 'thumbnail'
  | 'infographic'
  | 'product'
  | 'portrait'
  | 'landscape'
  | 'editorial'
  | 'general';

export type RasterVisualStyleV15 =
  | 'premium-minimal'
  | 'refined-futuristic'
  | 'photorealistic'
  | 'editorial'
  | 'illustration'
  | 'soft-friendly'
  | 'fine-art'
  | 'neutral';

export type RasterVisualPlanV15 = {
  version: 'raster-visual-plan-v1';
  purpose: RasterVisualPurposeV15;
  style: RasterVisualStyleV15;
  aspect: 'square' | 'portrait' | 'landscape';
  composition: string;
  lighting: string;
  camera: string;
  exactText: readonly string[];
  preserveExactText: boolean;
  visualHierarchy: readonly string[];
  avoid: readonly string[];
  providerPrompt: string;
  negativePrompt: string;
};

const MAX_SOURCE_CHARS = 2_000;
const MAX_PROVIDER_PROMPT_CHARS = 1_850;
const MAX_NEGATIVE_PROMPT_CHARS = 900;

function clean(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function purposeFor(input: string): RasterVisualPurposeV15 {
  if (/(?:広告|ad(?:vertisement)?|campaign|キャンペーン|訴求|commercial)/i.test(input)) return 'advertising';
  if (/(?:ポスター|poster|flyer|チラシ)/i.test(input)) return 'poster';
  if (/(?:インフォグラフィック|infographic|図解|visual summary)/i.test(input)) return 'infographic';
  if (/(?:サムネ|thumbnail|youtube)/i.test(input)) return 'thumbnail';
  if (/(?:instagram|tiktok|sns|social|ストーリー|story)/i.test(input)) return 'social';
  if (/(?:商品|製品|product|packshot|腕時計|watch|cosmetic|化粧品)/i.test(input)) return 'product';
  if (/(?:人物|portrait|ポートレート|顔|person|人物写真)/i.test(input)) return 'portrait';
  if (/(?:風景|landscape|scenery|景色|街並み|cityscape)/i.test(input)) return 'landscape';
  if (/(?:editorial|雑誌|magazine|表紙|cover)/i.test(input)) return 'editorial';
  return 'general';
}

function styleFor(input: string): RasterVisualStyleV15 {
  if (/(?:高級|premium|luxury|洗練|上質|quiet luxury|minimal)/i.test(input)) return 'premium-minimal';
  if (/(?:未来|futuristic|先進|近未来|sci[- ]?fi)/i.test(input)) return 'refined-futuristic';
  if (/(?:実写|写真|photoreal|realistic|photo)/i.test(input)) return 'photorealistic';
  if (/(?:editorial|雑誌|fashion|ファッション)/i.test(input)) return 'editorial';
  if (/(?:anime|アニメ|manga|漫画|イラスト|illustration|vector)/i.test(input)) return 'illustration';
  if (/(?:かわいい|可愛い|cute|friendly|やさしい|柔らか)/i.test(input)) return 'soft-friendly';
  if (/(?:油彩|水彩|painting|fine art|絵画)/i.test(input)) return 'fine-art';
  return 'neutral';
}

function aspectFor(width: number, height: number): RasterVisualPlanV15['aspect'] {
  const ratio = width / height;
  if (ratio > 1.15) return 'landscape';
  if (ratio < 0.87) return 'portrait';
  return 'square';
}

function extractExactText(input: string): string[] {
  const values: string[] = [];
  const patterns = [
    /[「『]([^」』]{1,120})[」』]/g,
    /["“]([^"”]{1,120})["”]/g,
    /(?:文字|テキスト|headline|title|copy|表記)\s*(?:は|:|：)\s*([^。,.\n]{1,120})/gi,
  ];
  for (const pattern of patterns) {
    for (const match of input.matchAll(pattern)) {
      const value = clean(match[1] ?? '');
      if (value && !values.includes(value)) values.push(value);
      if (values.length >= 6) return values;
    }
  }
  return values;
}

function compositionFor(purpose: RasterVisualPurposeV15, aspect: RasterVisualPlanV15['aspect']): string {
  const frame = aspect === 'portrait'
    ? 'vertical composition with strong upper/middle/lower hierarchy and safe edge margins'
    : aspect === 'landscape'
      ? 'wide composition with a clear focal subject and deliberate negative space'
      : 'balanced square composition with a clear single focal point';
  if (purpose === 'advertising' || purpose === 'product') return `${frame}; premium hero-subject layout; generous negative space for brand communication`;
  if (purpose === 'poster' || purpose === 'thumbnail') return `${frame}; immediate focal hierarchy readable at a glance`;
  if (purpose === 'infographic') return `${frame}; structured modular hierarchy; clean grouping; no decorative clutter`;
  if (purpose === 'portrait') return `${frame}; subject-led framing; natural body crop; coherent background separation`;
  if (purpose === 'landscape') return `${frame}; foreground-midground-background depth; natural visual flow`;
  return `${frame}; intentional visual hierarchy and controlled negative space`;
}

function lightingFor(purpose: RasterVisualPurposeV15, style: RasterVisualStyleV15): string {
  if (style === 'premium-minimal' || purpose === 'product') return 'controlled studio-quality lighting, soft key light, subtle rim separation, realistic restrained reflections';
  if (style === 'refined-futuristic') return 'clean cinematic lighting with restrained luminous accents and physically plausible shadows';
  if (style === 'photorealistic' || purpose === 'portrait') return 'natural cinematic key light, realistic shadow softness, believable global illumination';
  if (purpose === 'landscape') return 'natural atmospheric light with coherent sun direction and realistic depth';
  return 'coherent soft lighting with controlled contrast and believable shadows';
}

function cameraFor(purpose: RasterVisualPurposeV15, style: RasterVisualStyleV15): string {
  if (purpose === 'portrait') return '85mm-equivalent portrait perspective, eye-level unless the request says otherwise, natural depth of field';
  if (purpose === 'product') return '85mm-equivalent commercial product perspective, precise geometry, controlled depth of field';
  if (purpose === 'landscape') return '35mm-equivalent environmental perspective with foreground-to-background depth';
  if (style === 'photorealistic') return 'natural photographic perspective with realistic lens behavior and restrained depth of field';
  return 'camera perspective appropriate to the subject; no extreme distortion unless explicitly requested';
}

function styleDirection(style: RasterVisualStyleV15): string {
  switch (style) {
    case 'premium-minimal': return 'premium minimal visual language, limited palette, generous negative space, precise material rendering, quiet confidence';
    case 'refined-futuristic': return 'refined near-future visual language, sophisticated materials, restrained technology cues, avoid cyberpunk clichés';
    case 'photorealistic': return 'photorealistic rendering with natural texture, believable materials, realistic anatomy and optics';
    case 'editorial': return 'high-end editorial art direction, confident framing, sophisticated color and visual rhythm';
    case 'illustration': return 'polished illustration with intentional line, shape language, coherent anatomy and controlled detail';
    case 'soft-friendly': return 'warm approachable visual language, soft shapes, gentle palette, clear hierarchy';
    case 'fine-art': return 'intentional fine-art treatment with authentic medium texture, controlled composition and tonal depth';
    default: return 'clean contemporary visual direction with realistic hierarchy and coherent detail';
  }
}

function trimTo(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max).replace(/\s+\S*$/, '').trim();
}

export function compileRasterVisualPromptV15(
  sourceInput: string,
  width = 1024,
  height = 1024,
): RasterVisualPlanV15 {
  const source = clean(sourceInput);
  if (!source || source.length > MAX_SOURCE_CHARS) throw new Error('INVALID_RASTER_VISUAL_SOURCE');
  const purpose = purposeFor(source);
  const style = styleFor(source);
  const aspect = aspectFor(width, height);
  const exactText = extractExactText(source);
  const composition = compositionFor(purpose, aspect);
  const lighting = lightingFor(purpose, style);
  const camera = cameraFor(purpose, style);
  const visualHierarchy = purpose === 'advertising' || purpose === 'product'
    ? ['hero subject', 'brand/message area', 'supporting detail', 'background']
    : purpose === 'infographic'
      ? ['headline', 'primary information', 'supporting information', 'background']
      : ['main subject', 'supporting environment', 'background'];

  const exactTextInstruction = exactText.length
    ? `Render only these required visible words exactly as written: ${exactText.map((value) => `"${value}"`).join(', ')}. Do not invent extra copy.`
    : 'Do not add logos, watermarks, signatures, or unnecessary text.';

  const providerPrompt = trimTo([
    'Create the requested image as a finished, production-quality visual.',
    `Original request: ${source}`,
    `Purpose: ${purpose}. Canvas: ${width}x${height} (${aspect}).`,
    `Art direction: ${styleDirection(style)}.`,
    `Composition: ${composition}.`,
    `Lighting: ${lighting}.`,
    `Camera/perspective: ${camera}.`,
    exactTextInstruction,
    'Maintain coherent geometry, natural anatomy where relevant, physically plausible contact/shadows/reflections, clean subject separation, and intentional detail.',
  ].join(' '), MAX_PROVIDER_PROMPT_CHARS);

  const avoid = [
    'generic AI robot clichés',
    'cheap SaaS stock-art look',
    'excessive neon',
    'busy composition',
    'duplicate subjects',
    'deformed anatomy',
    'extra or fused fingers',
    'distorted faces',
    'broken perspective',
    'inconsistent lighting',
    'plastic skin',
    'watermarks',
    'signatures',
  ];
  if (!exactText.length) avoid.push('illegible accidental text');

  return {
    version: 'raster-visual-plan-v1',
    purpose,
    style,
    aspect,
    composition,
    lighting,
    camera,
    exactText,
    preserveExactText: true,
    visualHierarchy,
    avoid,
    providerPrompt,
    negativePrompt: trimTo(avoid.join(', '), MAX_NEGATIVE_PROMPT_CHARS),
  };
}
