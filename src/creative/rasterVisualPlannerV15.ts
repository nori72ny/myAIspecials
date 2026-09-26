export type RasterVisualPurposeV15 =
  | 'photograph'
  | 'illustration'
  | 'advertisement'
  | 'social'
  | 'poster'
  | 'thumbnail'
  | 'product'
  | 'portrait'
  | 'infographic'
  | 'ui-visual';

export type RasterVisualPlanV15 = {
  version: 'raster-visual-plan-v1';
  originalRequest: string;
  ready: boolean;
  questions: readonly string[];
  purpose: RasterVisualPurposeV15;
  platform: string;
  width: number;
  height: number;
  style: readonly string[];
  composition: readonly string[];
  lighting: readonly string[];
  camera: readonly string[];
  exactText: readonly string[];
  requiresDeterministicTypography: boolean;
  compiledPrompt: string;
  negativePrompt: string;
};

const STYLE_RULES: readonly [RegExp, string][] = [
  [/(?:高級|luxur|premium|上質|洗練)/i, 'premium restrained visual language, generous negative space, controlled contrast'],
  [/(?:ミニマル|minimal|シンプル|simple)/i, 'minimal composition, reduced visual noise, intentional spacing'],
  [/(?:未来|futur|先進|advanced)/i, 'refined futuristic design without generic sci-fi clichés'],
  [/(?:かわいい|cute|kawaii)/i, 'warm approachable playful styling with clean shapes'],
  [/(?:リアル|写実|photoreal|realistic|写真)/i, 'photorealistic materials, natural texture, physically plausible detail'],
  [/(?:映画|cinematic|シネマ)/i, 'cinematic visual storytelling with controlled depth and atmosphere'],
  [/(?:editorial|雑誌)/i, 'editorial art direction, disciplined hierarchy, sophisticated spacing'],
  [/(?:anime|アニメ)/i, 'high-quality anime illustration with coherent anatomy and clean linework'],
  [/(?:watercolor|水彩)/i, 'watercolor illustration with organic pigments and subtle paper texture'],
  [/(?:vector|ベクター)/i, 'clean vector-like forms, crisp geometry, flat controlled surfaces'],
];

function purposeFor(input: string): RasterVisualPurposeV15 {
  if (/(?:広告|ad(?:vertisement)?|campaign|訴求)/i.test(input)) return 'advertisement';
  if (/(?:Instagram|インスタ|SNS|social|X投稿|LinkedIn)/i.test(input)) return 'social';
  if (/(?:ポスター|poster)/i.test(input)) return 'poster';
  if (/(?:サムネ|thumbnail|YouTube)/i.test(input)) return 'thumbnail';
  if (/(?:商品|product|物撮り|EC)/i.test(input)) return 'product';
  if (/(?:人物|portrait|ポートレート|顔写真)/i.test(input)) return 'portrait';
  if (/(?:インフォグラフィック|infographic|図解)/i.test(input)) return 'infographic';
  if (/(?:UI|画面|dashboard|app screen|mockup)/i.test(input)) return 'ui-visual';
  if (/(?:イラスト|illustration|draw|描いて|anime|アニメ|水彩)/i.test(input)) return 'illustration';
  return 'photograph';
}

function sizeFor(input: string): { width: number; height: number; platform: string } {
  if (/(?:9\s*[:：/]\s*16|縦長|ストーリー|story|vertical)/i.test(input)) return { width: 864, height: 1536, platform: 'vertical-mobile' };
  if (/(?:16\s*[:：/]\s*9|横長|landscape|wide|YouTube|サムネ)/i.test(input)) return { width: 1536, height: 864, platform: 'landscape-screen' };
  if (/(?:4\s*[:：/]\s*5|Instagram|インスタ|portrait feed)/i.test(input)) return { width: 1024, height: 1280, platform: 'portrait-feed' };
  if (/(?:1\s*[:：/]\s*1|正方形|square)/i.test(input)) return { width: 1024, height: 1024, platform: 'square' };
  return { width: 1024, height: 1024, platform: 'general' };
}

function quotedText(input: string): string[] {
  const values: string[] = [];
  const patterns = [
    /「([^」]{1,120})」/g,
    /『([^』]{1,120})』/g,
    /"([^"\n]{1,120})"/g,
    /'([^'\n]{1,120})'/g,
  ];
  for (const pattern of patterns) {
    for (const match of input.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (value && !values.includes(value)) values.push(value);
    }
  }
  return values.slice(0, 8);
}

function meaningfulSubject(input: string): boolean {
  const stripped = input
    .replace(/(?:画像|イラスト|写真|ポスター|バナー|サムネ(?:イル)?)/gi, ' ')
    .replace(/(?:作って|作成して|生成して|描いて|お願い(?:します)?|ほしい|欲しい|ください)/g, ' ')
    .replace(/\b(?:generate|create|make|draw|please|image|picture|illustration|poster|banner|thumbnail)\b/gi, ' ')
    .replace(/[\s。、,.!?！？]+/g, '');
  return stripped.length >= 4;
}

function questionsFor(input: string): string[] {
  const questions: string[] = [];
  if (!meaningfulSubject(input)) {
    questions.push('何を主役にした画像にしますか？ 例：人物、商品、風景、ORIGINの広告ビジュアル');
  }
  if (/(?:広告|SNS|ポスター|バナー|サムネ|Instagram|インスタ|YouTube)/i.test(input)
    && !/(?:9\s*[:：/]\s*16|16\s*[:：/]\s*9|4\s*[:：/]\s*5|1\s*[:：/]\s*1|縦長|横長|正方形|story|portrait|landscape|square)/i.test(input)) {
    questions.push('主な使用先と比率はどれですか？ 例：Instagram 4:5、Story 9:16、YouTube 16:9');
  }
  if (/(?:文字|テキスト|コピー|ロゴ|title|headline|caption)/i.test(input) && quotedText(input).length === 0) {
    questions.push('画像に必ず入れる文字を、そのまま正確に教えてください。');
  }
  return questions.slice(0, 3);
}

function styleFor(input: string): string[] {
  const styles = STYLE_RULES.filter(([pattern]) => pattern.test(input)).map(([, value]) => value);
  if (!styles.length) styles.push('clean professional visual direction with coherent subject detail');
  return styles.slice(0, 5);
}

function compositionFor(purpose: RasterVisualPurposeV15): string[] {
  if (purpose === 'advertisement' || purpose === 'poster') {
    return ['clear single hero subject', 'strong visual hierarchy', 'intentional negative space for copy', 'safe margins around critical content'];
  }
  if (purpose === 'thumbnail') {
    return ['immediate focal point', 'high subject-background separation', 'readable at small size', 'avoid edge crowding'];
  }
  if (purpose === 'product') {
    return ['hero product remains unmistakable', 'accurate product geometry', 'controlled reflections', 'clean supporting environment'];
  }
  if (purpose === 'portrait') {
    return ['natural face and anatomy', 'clean silhouette', 'eyes as primary focus', 'balanced headroom'];
  }
  if (purpose === 'infographic' || purpose === 'ui-visual') {
    return ['structured information hierarchy', 'clean grid', 'ample whitespace', 'precise alignment'];
  }
  return ['clear primary subject', 'balanced depth', 'intentional framing', 'natural visual hierarchy'];
}

function lightingFor(purpose: RasterVisualPurposeV15, input: string): string[] {
  if (/(?:夜|night|暗|dark)/i.test(input)) return ['controlled low-key lighting', 'preserve readable subject separation', 'avoid crushed blacks'];
  if (purpose === 'product' || purpose === 'advertisement') return ['controlled commercial key light', 'subtle fill', 'precise highlights and reflections'];
  if (purpose === 'portrait') return ['soft directional key light', 'natural skin tones', 'subtle eye catchlights'];
  return ['coherent physically plausible lighting', 'consistent shadows and reflections'];
}

function cameraFor(purpose: RasterVisualPurposeV15): string[] {
  if (purpose === 'portrait') return ['85mm-equivalent portrait perspective', 'eye-level camera unless requested otherwise', 'natural depth of field'];
  if (purpose === 'product') return ['commercial product photography perspective', 'minimal lens distortion', 'precise focus on product details'];
  if (purpose === 'photograph' || purpose === 'advertisement') return ['natural photographic perspective', 'controlled depth of field', 'avoid extreme lens distortion'];
  return ['camera treatment appropriate to the requested visual style'];
}

function compiledPrompt(input: string, plan: Omit<RasterVisualPlanV15, 'compiledPrompt' | 'negativePrompt'>): string {
  const exactTextInstruction = plan.exactText.length
    ? `Critical text to preserve exactly if text is rendered: ${plan.exactText.map((value) => `"${value}"`).join(', ')}. Keep a clean typography-safe area and do not invent extra words.`
    : 'Do not invent logos, labels, watermarks, signatures, or unnecessary text.';
  return [
    'Create a polished production-quality image from the following user request.',
    `User request: ${input.trim()}`,
    `Purpose: ${plan.purpose}. Platform: ${plan.platform}. Output: ${plan.width}x${plan.height}.`,
    `Art direction: ${plan.style.join('; ')}.`,
    `Composition: ${plan.composition.join('; ')}.`,
    `Lighting: ${plan.lighting.join('; ')}.`,
    `Camera/rendering: ${plan.camera.join('; ')}.`,
    exactTextInstruction,
    'Prioritize instruction following, coherent geometry, natural anatomy where applicable, realistic contact and shadows, clean edges, and a deliberate professional finish.',
  ].join('\n');
}

export function planRasterVisualRequestV15(input: string): RasterVisualPlanV15 {
  const originalRequest = input.normalize('NFKC').trim();
  const purpose = purposeFor(originalRequest);
  const size = sizeFor(originalRequest);
  const exactText = quotedText(originalRequest);
  const questions = questionsFor(originalRequest);
  const base = {
    version: 'raster-visual-plan-v1' as const,
    originalRequest,
    ready: questions.length === 0,
    questions,
    purpose,
    platform: size.platform,
    width: size.width,
    height: size.height,
    style: styleFor(originalRequest),
    composition: compositionFor(purpose),
    lighting: lightingFor(purpose, originalRequest),
    camera: cameraFor(purpose),
    exactText,
    requiresDeterministicTypography: exactText.length > 0 || purpose === 'infographic' || purpose === 'ui-visual',
  };
  const negativePrompt = [
    'low quality',
    'blurry',
    'deformed anatomy',
    'extra fingers',
    'duplicate subjects',
    'broken perspective',
    'unreadable accidental text',
    'watermark',
    'signature',
    'generic AI robot imagery unless explicitly requested',
    'excessive neon unless explicitly requested',
    'busy composition',
  ].join(', ');
  return {
    ...base,
    compiledPrompt: compiledPrompt(originalRequest, base),
    negativePrompt,
  };
}
