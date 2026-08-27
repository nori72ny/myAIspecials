export type ImageStyle = 'photorealistic' | 'ghibli' | 'disney' | 'fine_art' | 'scenery';

export interface EnhancedImagePrompt {
  style: ImageStyle;
  positivePrompt: string;
  negativePrompt: string;
  prompt: string;
}

const STYLE_PRESETS: Record<ImageStyle, string> = {
  photorealistic: 'unprocessed 35mm RAW photograph, shot on Hasselblad X2D 100C with 85mm F1.4 lens, natural skin pores and micro-texture, fine facial hair, authentic eye reflection, Rembrandt soft window lighting, subtle film grain, shallow depth of field, organic color science, zero plastic CG skin effect',
  ghibli: 'hand-drawn Japanese cel-animation aesthetic, gouache-painted background, soft natural lighting, warm nostalgic atmosphere, expressive but natural character design, delicate environmental detail',
  disney: 'high-end 3D family animation aesthetic, physically based materials, subsurface scattering, three-point cinematic studio lighting, detailed hair and eye reflections, polished feature-animation render quality',
  fine_art: 'masterpiece oil painting, impasto brushstrokes, rich canvas texture, classical composition, museum lighting, authentic paint depth, controlled tonal hierarchy',
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

function sanitize(input: string): string {
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function enhanceImagePrompt(userInput: string, style: ImageStyle): EnhancedImagePrompt {
  const subject = sanitize(userInput);
  if (!subject) throw new Error('Image prompt input must not be empty.');

  const positivePrompt = [
    subject,
    STYLE_PRESETS[style],
    'coherent perspective, physically plausible lighting, clean subject separation, accurate anatomy where applicable, intentional composition',
  ].join(', ');

  const negativePrompt = style === 'fine_art'
    ? `${COMMON_NEGATIVE}, muddy paint, accidental brush noise, flat digital fill`
    : COMMON_NEGATIVE;

  return {
    style,
    positivePrompt,
    negativePrompt,
    prompt: `Positive Prompt: ${positivePrompt}\nNegative Prompt: ${negativePrompt}`,
  };
}
