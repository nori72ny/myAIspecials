export type ImageStyle = 'photorealistic' | 'manga' | 'cel_anime' | 'stylized_3d' | 'fine_art' | 'ghibli' | 'disney' | 'scenery';

export interface EnhancedImagePrompt {
  style: ImageStyle;
  positivePrompt: string;
  negativePrompt: string;
  prompt: string;
}

const STYLE_PRESETS: Record<ImageStyle, string> = {
  photorealistic: 'unprocessed 35mm RAW photograph, shot on Hasselblad X2D 100C with 85mm F1.4 lens, natural skin pores and micro-texture, fine facial hair, authentic eye reflection, Rembrandt soft window lighting, subtle film grain, shallow depth of field, organic color science, zero plastic CG skin effect',
  manga: 'high-quality Japanese manga illustration, confident ink linework, controlled screentone texture, expressive composition, clean silhouette, intentional panel-like framing, refined facial construction',
  cel_anime: 'hand-drawn cel animation aesthetic, clean keyline drawing, layered cel shading, painted background, soft natural lighting, expressive but anatomically coherent character design, atmospheric environmental detail',
  stylized_3d: 'high-end stylized 3D animation aesthetic, physically based materials, subsurface scattering, three-point cinematic lighting, detailed hair and eye reflections, polished feature-animation render quality',
  fine_art: 'masterpiece oil painting, impasto brushstrokes, rich canvas texture, classical composition, museum lighting, authentic paint depth, controlled tonal hierarchy',
  ghibli: 'hand-drawn Japanese cel-animation aesthetic, gouache-painted background, soft natural lighting, warm nostalgic atmosphere, expressive but natural character design, delicate environmental detail',
  disney: 'high-end 3D family animation aesthetic, physically based materials, subsurface scattering, three-point cinematic studio lighting, detailed hair and eye reflections, polished feature-animation render quality',
  scenery: 'cinematic landscape photography, natural atmospheric perspective, volumetric light, realistic depth, carefully balanced foreground-midground-background composition, fine environmental detail',
};

const COMMON_NEGATIVE = [
  'low quality', 'blurry', 'jpeg artifacts', 'overprocessed', 'text', 'watermark',
  'logo', 'signature', 'duplicate subject', 'deformed anatomy', 'bad anatomy',
  'extra limbs', 'missing limbs', 'extra fingers', 'missing fingers', 'fused fingers',
  'fused hands', 'deformed joints', 'malformed hands', 'asymmetric eyes',
  'distorted face', 'unnatural proportions', 'plastic smooth skin', 'plastic skin',
  'oversharpening', 'clipped highlights', 'broken perspective', 'inconsistent lighting',
].join(', ');

const STYLE_ALIASES: ReadonlyArray<readonly [RegExp, ImageStyle]> = [
  [/\b(manga|comic|マンガ|漫画)\b/i, 'manga'],
  [/\b(cel[- ]?anime|anime|アニメ|セル画)\b/i, 'cel_anime'],
  [/\b(stylized\s*3d|3d animation|3d|ピクサー|3dアニメ)\b/i, 'stylized_3d'],
  [/\b(fine art|oil painting|oil paint|painting|絵画|油彩)\b/i, 'fine_art'],
  [/\b(ghibli|ジブリ)\b/i, 'ghibli'],
  [/\b(disney|ディズニー)\b/i, 'disney'],
  [/\b(photo|photograph|photorealistic|realistic|写真|実写)\b/i, 'photorealistic'],
  [/\b(scenery|landscape|風景|景色)\b/i, 'scenery'],
];

function sanitize(input: string): string {
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function detectImageStyle(userInput: string, fallback: ImageStyle = 'photorealistic'): ImageStyle {
  const input = sanitize(userInput);
  for (const [pattern, style] of STYLE_ALIASES) {
    if (pattern.test(input)) return style;
  }
  return fallback;
}

export function enhanceImagePrompt(userInput: string, style?: ImageStyle): EnhancedImagePrompt {
  const subject = sanitize(userInput);
  if (!subject) throw new Error('Image prompt input must not be empty.');

  const resolvedStyle = style ?? detectImageStyle(subject);
  const positivePrompt = [
    subject,
    STYLE_PRESETS[resolvedStyle],
    'coherent perspective, physically plausible lighting, clean subject separation, accurate anatomy where applicable, intentional composition',
  ].join(', ');

  const negativePrompt = resolvedStyle === 'fine_art'
    ? `${COMMON_NEGATIVE}, muddy paint, accidental brush noise, flat digital fill`
    : COMMON_NEGATIVE;

  return {
    style: resolvedStyle,
    positivePrompt,
    negativePrompt,
    prompt: `Positive Prompt: ${positivePrompt}\nNegative Prompt: ${negativePrompt}`,
  };
}
