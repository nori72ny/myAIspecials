import {
  verifyVisualBlobSha256V15,
  type VisualRasterPresetV15,
} from './localVisualExportV15';

/**
 * Creative Studio v1.5 shared core.
 *
 * The verified vector-generation flow (status proof -> generate -> header
 * evidence -> byte-level SHA-256 verification) used to live inside the
 * standalone "作る" workspace screen. As of the screen-structure migration
 * (stage 3, 2026-11-09) the Create screen is gone: creation starts in chat
 * and the deliverable opens in the artifact panel beside the conversation.
 * This module is the single home of the generation contract so the create
 * panel (CreativePanelV15) and the artifact-panel editor
 * (CreativeArtifactEditorV15) share exactly one verification path.
 */

export type CreativeVisualKindV15 = 'social-card' | 'poster' | 'info-card';
export type CreativeVisualLayoutV15 = 'editorial' | 'minimal' | 'split';
export type CreativeVisualPresetV15 = VisualRasterPresetV15;

export type CreativeDraftV15 = {
  kind: CreativeVisualKindV15;
  preset: CreativeVisualPresetV15;
  layout: CreativeVisualLayoutV15;
  title: string;
  subtitle: string;
  body: string;
  footer: string;
  background: string;
  foreground: string;
  accent: string;
  muted: string;
};

export type CreativeArtifactThemeV15 = {
  background: string;
  foreground: string;
  accent: string;
  muted: string;
};

/**
 * Structured editing metadata carried on an ArtifactBlock (type 'html',
 * language 'svg') so a generated card/poster can be re-edited with the
 * structured fields (title, body, kind, layout, colors) from the artifact
 * panel and regenerated through the same verified flow. The artifact's
 * `title` mirrors `draft.title`; everything else lives here.
 */
export type CreativeArtifactMetaV15 = {
  version: 1;
  kind: CreativeVisualKindV15;
  preset: CreativeVisualPresetV15;
  layout: CreativeVisualLayoutV15;
  subtitle: string;
  body: string;
  footer: string;
  theme: CreativeArtifactThemeV15;
  downloadName: string;
  sha256: string;
  generationId?: string;
  visualBrainVersion?: string;
  providerId?: string;
  planSha256?: string;
};

export type VerifiedCreativeArtifactV15 = {
  blob: Blob;
  svgText: string;
  preset: CreativeVisualPresetV15;
  title: string;
  downloadName: string;
  sha256: string;
  generationId?: string;
  visualBrainVersion?: string;
  providerId?: string;
  planSha256?: string;
};

type CreativeStatusBodyV15 = {
  ok?: boolean;
  ready?: boolean;
  releaseStage?: string;
  externalNetworkRequests?: number;
  providerExecutions?: number;
  costUsd?: number;
  freeOnly?: boolean;
};

/**
 * The draft starts empty on purpose: the previous screen pre-filled the
 * title/body with slogan-like copy ("伝わるクリエイティブを、すぐ形に。")
 * that looked like user input and could be generated as-is. The screen
 * necessity review (2026-11-09) classified that friction as "do not carry
 * over"; the panel shows placeholders instead.
 */
export const EMPTY_CREATIVE_DRAFT_V15: CreativeDraftV15 = {
  kind: 'social-card',
  preset: 'portrait',
  layout: 'editorial',
  title: '',
  subtitle: '',
  body: '',
  footer: '',
  background: '#F7F7F4',
  foreground: '#151515',
  accent: '#315CFF',
  muted: '#686868',
};

export function creativeDraftFromRequestV15(initialRequest: string): CreativeDraftV15 {
  const request = initialRequest.normalize('NFKC').trim().slice(0, 4000);
  if (!request) return { ...EMPTY_CREATIVE_DRAFT_V15 };

  const kind: CreativeVisualKindV15 = /(?:ポスター|poster)/i.test(request)
    ? 'poster'
    : /(?:情報カード|インフォグラフィック|info\s*card|infographic)/i.test(request)
      ? 'info-card'
      : 'social-card';
  const preset: CreativeVisualPresetV15 = /(?:Story|ストーリー|9\s*[:：/]\s*16)/i.test(request)
    ? 'story'
    : /(?:横長|landscape|16\s*[:：/]\s*9|1200\s*[x×X]\s*630)/i.test(request)
      ? 'landscape'
      : /(?:正方形|square|1\s*[:：/]\s*1)/i.test(request)
        ? 'square'
        : 'portrait';

  const explicitTitle = request.match(/(?:タイトル|title)\s*[:：]\s*[「『"'“]?([^\n」』"'”]{2,120})/i)?.[1]?.trim();
  const cleaned = request
    .replace(/^(?:please\s+)?(?:use|open)\s+(?:the\s+)?(?:Creative|Create)\s+workspace\s+(?:to\s+)?/i, '')
    .replace(/^(?:Creative|Create)\s*(?:workspace|ワークスペース|画面|モード)?(?:で|を使って)?\s*/i, '')
    .replace(/^(?:クリエイティブ|作る)\s*(?:ワークスペース|画面|モード)?(?:で|を使って)?\s*/i, '')
    .replace(/^(?:please\s+)?(?:make|create|design|prepare)\s+/i, '')
    .replace(/(?:を)?(?:作って|作成して|デザインして|準備して)(?:ください)?[。.!！]?$/i, '')
    .trim();
  const inferredTitle = explicitTitle || (cleaned.length >= 2 && cleaned.length <= 120 ? cleaned : '');

  return {
    ...EMPTY_CREATIVE_DRAFT_V15,
    kind,
    preset,
    title: inferredTitle.slice(0, 120),
    body: request.slice(0, 2200),
  };
}

export const CREATIVE_PRESET_LABELS_V15: Record<CreativeVisualPresetV15, string> = {
  square: '正方形 1080×1080',
  portrait: '縦長 1080×1350',
  story: 'ストーリー 1080×1920',
  landscape: '横長 1200×630',
};

export const CREATIVE_PRESET_ASPECT_V15: Record<CreativeVisualPresetV15, string> = {
  square: '1 / 1',
  portrait: '4 / 5',
  story: '9 / 16',
  landscape: '40 / 21',
};

function filenameFromDisposition(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8) {
    try { return decodeURIComponent(utf8); } catch { return fallback; }
  }
  return value.match(/filename="([^"]+)"/i)?.[1] || fallback;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.clone().json() as { code?: string; message?: string };
    return body.message || body.code || `生成に失敗しました（${response.status}）`;
  } catch {
    return `生成に失敗しました（${response.status}）`;
  }
}

/**
 * Proves the zero-cost capability boundary before generation is enabled.
 * Returns true only when the server reports the verified vector foundation
 * with zero external requests, zero provider executions and zero cost.
 */
export async function fetchCreativeStatusV15(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch('/api/creative/v1.5/status', { signal, credentials: 'same-origin' });
    if (!response.ok) return false;
    const body = await response.json() as CreativeStatusBodyV15;
    return body.ready === true
      && body.releaseStage === 'verified-vector-foundation'
      && body.externalNetworkRequests === 0
      && body.providerExecutions === 0
      && body.costUsd === 0
      && body.freeOnly === true;
  } catch {
    return false;
  }
}

/**
 * Runs one generation and verifies the full evidence chain (verified flag,
 * zero-cost boundary, content type, SHA-256 header, Visual Brain provenance)
 * plus the actual bytes against the advertised SHA-256. Throws an Error
 * with a user-facing Japanese message on any proof failure; nothing is
 * returned unless every check passes.
 */
export async function generateCreativeArtifactV15(draft: CreativeDraftV15): Promise<VerifiedCreativeArtifactV15> {
  const response = await fetch('/api/creative/v1.5/generate', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: draft.kind,
      preset: draft.preset,
      layout: draft.layout,
      title: draft.title,
      subtitle: draft.subtitle,
      body: draft.body,
      footer: draft.footer,
      theme: {
        background: draft.background,
        foreground: draft.foreground,
        accent: draft.accent,
        muted: draft.muted,
      },
    }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  if (response.headers.get('x-origin-visual-verified') !== 'true') throw new Error('作成物の検証証拠を確認できませんでした。');
  if (response.headers.get('x-origin-free-only') !== 'true'
    || response.headers.get('x-origin-cost-usd') !== '0'
    || response.headers.get('x-origin-external-network') !== 'false') {
    throw new Error('作成物のゼロコスト境界を確認できませんでした。');
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('image/svg+xml')) throw new Error('想定外の作成物形式が返されました。');
  const artifactSha256 = response.headers.get('x-origin-visual-sha256') || '';
  if (!/^[a-f0-9]{64}$/i.test(artifactSha256)) throw new Error('作成物のSHA-256証拠を確認できませんでした。');
  const visualBrainVersion = response.headers.get('x-origin-visual-brain') || '';
  const providerId = response.headers.get('x-origin-visual-provider') || '';
  const planSha256 = response.headers.get('x-origin-visual-plan-sha256') || '';
  const generationId = response.headers.get('x-origin-visual-generation-id') || '';
  const critic = response.headers.get('x-origin-visual-critic') || '';
  const qualityScore = Number(response.headers.get('x-origin-visual-quality-score') || '0');
  if (visualBrainVersion !== 'visual-brain-v1'
    || providerId !== 'origin-local-svg'
    || critic !== 'deterministic-v1'
    || qualityScore < 100
    || !/^[a-f0-9]{64}$/i.test(planSha256)
    || !/^visual-[a-f0-9]{24}$/i.test(generationId)) {
    throw new Error('Visual Brainの生成・品質検証証拠を確認できませんでした。');
  }
  const blob = await response.blob();
  if (blob.size <= 0) throw new Error('空の作成物が返されました。');
  if (!(await verifyVisualBlobSha256V15(blob, artifactSha256))) {
    throw new Error('作成物の実バイトとSHA-256証拠が一致しませんでした。');
  }

  return {
    blob,
    svgText: await blob.text(),
    preset: draft.preset,
    title: draft.title,
    downloadName: filenameFromDisposition(response.headers.get('content-disposition'), 'origin-creative.svg'),
    sha256: artifactSha256.toLowerCase(),
    generationId,
    visualBrainVersion,
    providerId,
    planSha256: planSha256.toLowerCase(),
  };
}

export function creativeMetaFromVerifiedV15(verified: VerifiedCreativeArtifactV15, draft: CreativeDraftV15): CreativeArtifactMetaV15 {
  return {
    version: 1,
    kind: draft.kind,
    preset: draft.preset,
    layout: draft.layout,
    subtitle: draft.subtitle,
    body: draft.body,
    footer: draft.footer,
    theme: {
      background: draft.background,
      foreground: draft.foreground,
      accent: draft.accent,
      muted: draft.muted,
    },
    downloadName: verified.downloadName,
    sha256: verified.sha256,
    generationId: verified.generationId,
    visualBrainVersion: verified.visualBrainVersion,
    providerId: verified.providerId,
    planSha256: verified.planSha256,
  };
}

export function creativeDraftFromMetaV15(meta: CreativeArtifactMetaV15, title: string): CreativeDraftV15 {
  return {
    kind: meta.kind,
    preset: meta.preset,
    layout: meta.layout,
    title,
    subtitle: meta.subtitle,
    body: meta.body,
    footer: meta.footer,
    background: meta.theme.background,
    foreground: meta.theme.foreground,
    accent: meta.theme.accent,
    muted: meta.theme.muted,
  };
}

const CREATIVE_KINDS_V15 = new Set<string>(['social-card', 'poster', 'info-card']);
const CREATIVE_LAYOUTS_V15 = new Set<string>(['editorial', 'minimal', 'split']);
const CREATIVE_PRESETS_V15 = new Set<string>(['square', 'portrait', 'story', 'landscape']);
const SHA256_HEX = /^[a-f0-9]{64}$/i;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Strict shape check used when creative metadata is restored from the
 * persisted snapshot. Anything malformed is dropped (the artifact itself
 * still restores as a plain SVG artifact without structured editing).
 */
export function isCreativeArtifactMetaV15(value: unknown): value is CreativeArtifactMetaV15 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const meta = value as Partial<CreativeArtifactMetaV15>;
  if (meta.version !== 1) return false;
  if (typeof meta.kind !== 'string' || !CREATIVE_KINDS_V15.has(meta.kind)) return false;
  if (typeof meta.preset !== 'string' || !CREATIVE_PRESETS_V15.has(meta.preset)) return false;
  if (typeof meta.layout !== 'string' || !CREATIVE_LAYOUTS_V15.has(meta.layout)) return false;
  if (typeof meta.subtitle !== 'string' || meta.subtitle.length > 320) return false;
  if (typeof meta.body !== 'string' || meta.body.length > 2200) return false;
  if (typeof meta.footer !== 'string' || meta.footer.length > 240) return false;
  if (typeof meta.downloadName !== 'string' || meta.downloadName.length > 180) return false;
  if (typeof meta.sha256 !== 'string' || !SHA256_HEX.test(meta.sha256)) return false;
  if (!meta.theme || typeof meta.theme !== 'object') return false;
  const theme = meta.theme as Partial<CreativeArtifactThemeV15>;
  if (typeof theme.background !== 'string' || !HEX_COLOR.test(theme.background)) return false;
  if (typeof theme.foreground !== 'string' || !HEX_COLOR.test(theme.foreground)) return false;
  if (typeof theme.accent !== 'string' || !HEX_COLOR.test(theme.accent)) return false;
  if (typeof theme.muted !== 'string' || !HEX_COLOR.test(theme.muted)) return false;
  if (meta.generationId !== undefined && (typeof meta.generationId !== 'string' || !/^visual-[a-f0-9]{24}$/i.test(meta.generationId))) return false;
  if (meta.visualBrainVersion !== undefined && (typeof meta.visualBrainVersion !== 'string' || meta.visualBrainVersion.length > 64)) return false;
  if (meta.providerId !== undefined && (typeof meta.providerId !== 'string' || meta.providerId.length > 80)) return false;
  if (meta.planSha256 !== undefined && (typeof meta.planSha256 !== 'string' || !SHA256_HEX.test(meta.planSha256))) return false;
  return true;
}
