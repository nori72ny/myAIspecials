export type WorldClassImagePromptProfileV16 =
  | 'text-layout'
  | 'portrait'
  | 'product-commercial'
  | 'photoreal'
  | 'illustration'
  | 'scenery'
  | 'generic';

export type WorldClassImagePromptPlanV16 = {
  profile: WorldClassImagePromptProfileV16;
  prompt: string;
};

const TEXT_LAYOUT = /(ポスター|広告|バナー|サムネ|メニュー|チラシ|インフォグラフィック|ui|画面|レイアウト|タイポ|文字|価格|料金|キャッチコピー|poster|advert|banner|thumbnail|menu|infographic|typography|headline|price|label|text)/i;
const PORTRAIT = /(人物|人間|女性|男性|顔|ポートレート|モデル|手|指|portrait|person|woman|man|face|human|hands?|fingers?)/i;
const PRODUCT = /(商品|製品|ボトル|パッケージ|化粧品|料理|飲食|ジュエリー|時計|バッグ|product|packaging|bottle|cosmetic|food|jewelry|watch|bag)/i;
const PHOTO = /(実写|写真|フォトリアル|リアル|撮影|カメラ|レンズ|photo|photograph|photoreal|realistic|camera|lens)/i;
const ILLUSTRATION = /(イラスト|アニメ|漫画|マンガ|絵画|油絵|水彩|3d|illustration|anime|manga|painting|watercolor|stylized)/i;
const SCENERY = /(風景|景色|建築|街並み|都市|自然|山|海|空|夜景|landscape|scenery|architecture|cityscape|nature|mountain|ocean|sky)/i;

function classify(prompt: string): WorldClassImagePromptProfileV16 {
  if (TEXT_LAYOUT.test(prompt)) return 'text-layout';
  if (PRODUCT.test(prompt)) return 'product-commercial';
  if (PORTRAIT.test(prompt)) return 'portrait';
  if (PHOTO.test(prompt)) return 'photoreal';
  if (ILLUSTRATION.test(prompt)) return 'illustration';
  if (SCENERY.test(prompt)) return 'scenery';
  return 'generic';
}

function commonConstraints(editing: boolean): string[] {
  const constraints = [
    'Follow the primary instruction exactly. Do not add unrequested subjects, text, logos, watermarks, borders, or decorative clutter.',
    'Use deliberate composition with a clear visual hierarchy, coherent perspective, physically plausible lighting, and clean subject separation.',
    'Avoid malformed anatomy, duplicated objects, warped geometry, broken reflections, inconsistent shadows, accidental text, and compression artifacts.',
    'Keep the result production-ready: crisp focal detail, controlled contrast, natural local texture, and no oversharpened or plastic surfaces unless explicitly requested.',
  ];
  if (editing) {
    constraints.unshift(
      'This is an edit task: preserve identity, product geometry, pose, composition, typography, and untouched regions unless the primary instruction explicitly asks to change them.',
      'Apply only the requested change. Do not silently redesign unrelated parts of the source image.',
    );
  }
  return constraints;
}

function profileConstraints(profile: WorldClassImagePromptProfileV16): string[] {
  switch (profile) {
    case 'text-layout':
      return [
        'Treat all requested visible text, numerals, prices, punctuation, capitalization, and Japanese characters as exact copy. Do not translate, paraphrase, invent, omit, or duplicate text.',
        'Prioritize legibility at thumbnail size, clean spacing, alignment, safe margins, typographic hierarchy, and strong figure-ground separation.',
        'For commercial layouts, reserve intentional negative space and keep the primary message visually dominant without obscuring the subject.',
      ];
    case 'portrait':
      return [
        'Prioritize facial identity, natural skin texture, anatomically correct hands and fingers, believable eyes and teeth, and consistent hair detail.',
        'Keep pose, gaze, clothing seams, jewelry, and limb relationships physically coherent.',
      ];
    case 'product-commercial':
      return [
        'Preserve product shape, packaging proportions, labels, closures, edges, and brand-critical geometry with studio-grade material realism.',
        'Use controlled commercial lighting, accurate reflections, realistic contact shadows, and a clean premium composition suitable for advertising.',
      ];
    case 'photoreal':
      return [
        'Render as a convincing real photograph with natural dynamic range, physically plausible optics, realistic micro-texture, and restrained post-processing.',
        'Avoid CGI sheen, waxy skin, impossible depth of field, synthetic bokeh, and overprocessed HDR.',
      ];
    case 'illustration':
      return [
        'Maintain a coherent intentional art direction with consistent line language, shape design, palette, lighting logic, and detail density.',
        'Avoid accidental mixed styles, muddy edges, and inconsistent rendering between foreground and background.',
      ];
    case 'scenery':
      return [
        'Use strong foreground-midground-background depth, atmospheric perspective, believable scale, and geographically coherent lighting.',
        'Keep architecture and environmental geometry structurally consistent and avoid repeated texture artifacts.',
      ];
    default:
      return [
        'Choose the most natural visual treatment for the request while preserving every explicit user constraint.',
      ];
  }
}

export function compileWorldClassImagePromptV16(
  rawPrompt: string,
  editing: boolean,
): WorldClassImagePromptPlanV16 {
  const prompt = rawPrompt.trim();
  if (!prompt) throw new Error('WORLD_CLASS_IMAGE_PROMPT_EMPTY');

  const profile = classify(prompt);
  const constraints = [...commonConstraints(editing), ...profileConstraints(profile)];

  return {
    profile,
    prompt: [
      'PRIMARY INSTRUCTION:',
      prompt,
      '',
      'EXECUTION CONSTRAINTS:',
      ...constraints.map((item) => `- ${item}`),
      '',
      'Priority order: explicit user instruction > exact requested content > subject fidelity > composition > aesthetic polish.',
    ].join('\n'),
  };
}
