import { createHash } from 'node:crypto';

export const VISUAL_KINDS_V15 = ['social-card', 'poster', 'info-card'] as const;
export const VISUAL_PRESETS_V15 = ['square', 'portrait', 'story', 'landscape'] as const;
export const VISUAL_LAYOUTS_V15 = ['editorial', 'minimal', 'split'] as const;

export type VisualKindV15 = (typeof VISUAL_KINDS_V15)[number];
export type VisualPresetV15 = (typeof VISUAL_PRESETS_V15)[number];
export type VisualLayoutV15 = (typeof VISUAL_LAYOUTS_V15)[number];

export type VisualThemeV15 = {
  background?: string;
  foreground?: string;
  accent?: string;
  muted?: string;
};

export type VisualArtifactRequestV15 = {
  kind: VisualKindV15;
  preset?: VisualPresetV15;
  layout?: VisualLayoutV15;
  title: string;
  subtitle?: string;
  body?: string;
  footer?: string;
  theme?: VisualThemeV15;
};

export type GeneratedVisualArtifactV15 = {
  version: '1.5';
  kind: VisualKindV15;
  preset: VisualPresetV15;
  layout: VisualLayoutV15;
  width: number;
  height: number;
  filename: string;
  mimeType: 'image/svg+xml';
  bytes: Buffer;
  sha256: string;
  verified: boolean;
  verification: readonly string[];
  externalNetworkRequests: 0;
  providerExecutions: 0;
  costUsd: 0;
  freeOnly: true;
};

export class VisualArtifactValidationErrorV15 extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'VisualArtifactValidationErrorV15';
  }
}

const PRESETS: Record<VisualPresetV15, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  landscape: { width: 1200, height: 630 },
};

const DEFAULT_THEME: Required<VisualThemeV15> = {
  background: '#F7F7F4',
  foreground: '#151515',
  accent: '#315CFF',
  muted: '#686868',
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SAFE_NAME = /[^\p{L}\p{N}._-]+/gu;
const MAX_SVG_BYTES = 512 * 1024;

function xml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function safeName(value: string): string {
  return value.normalize('NFKC').replace(SAFE_NAME, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'visual';
}

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && values.includes(value as T[number]);
}

function requiredText(value: unknown, code: string, max: number): string {
  if (typeof value !== 'string') throw new VisualArtifactValidationErrorV15(code);
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized.length > max) throw new VisualArtifactValidationErrorV15(code);
  return normalized;
}

function optionalText(value: unknown, code: string, max: number): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new VisualArtifactValidationErrorV15(code);
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length > max) throw new VisualArtifactValidationErrorV15(code);
  return normalized;
}

function parseTheme(value: unknown): Required<VisualThemeV15> {
  if (value === undefined) return { ...DEFAULT_THEME };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new VisualArtifactValidationErrorV15('INVALID_VISUAL_THEME');
  const source = value as Record<string, unknown>;
  const allowed = new Set(['background', 'foreground', 'accent', 'muted']);
  if (Object.keys(source).some(key => !allowed.has(key))) throw new VisualArtifactValidationErrorV15('INVALID_VISUAL_THEME');
  const result = { ...DEFAULT_THEME };
  for (const key of allowed) {
    const candidate = source[key];
    if (candidate === undefined) continue;
    if (typeof candidate !== 'string' || !HEX_COLOR.test(candidate)) throw new VisualArtifactValidationErrorV15('INVALID_VISUAL_COLOR');
    result[key as keyof Required<VisualThemeV15>] = candidate.toUpperCase();
  }
  return result;
}

export function parseVisualArtifactRequestV15(input: unknown): Required<Omit<VisualArtifactRequestV15, 'theme'>> & { theme: Required<VisualThemeV15> } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new VisualArtifactValidationErrorV15('INVALID_VISUAL_REQUEST');
  const value = input as Record<string, unknown>;
  const allowed = new Set(['kind', 'preset', 'layout', 'title', 'subtitle', 'body', 'footer', 'theme']);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new VisualArtifactValidationErrorV15('INVALID_VISUAL_REQUEST_FIELD');
  if (!isOneOf(value.kind, VISUAL_KINDS_V15)) throw new VisualArtifactValidationErrorV15('INVALID_VISUAL_KIND');
  const preset = value.preset === undefined ? 'portrait' : value.preset;
  const layout = value.layout === undefined ? 'editorial' : value.layout;
  if (!isOneOf(preset, VISUAL_PRESETS_V15)) throw new VisualArtifactValidationErrorV15('INVALID_VISUAL_PRESET');
  if (!isOneOf(layout, VISUAL_LAYOUTS_V15)) throw new VisualArtifactValidationErrorV15('INVALID_VISUAL_LAYOUT');
  return {
    kind: value.kind,
    preset,
    layout,
    title: requiredText(value.title, 'INVALID_VISUAL_TITLE', 240),
    subtitle: optionalText(value.subtitle, 'INVALID_VISUAL_SUBTITLE', 320),
    body: optionalText(value.body, 'INVALID_VISUAL_BODY', 2200),
    footer: optionalText(value.footer, 'INVALID_VISUAL_FOOTER', 240),
    theme: parseTheme(value.theme),
  };
}

function textUnits(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + (/^[\x00-\x7f]$/.test(char) ? 1 : 2), 0);
}

function wrapText(text: string, maxUnits: number, maxLines: number): string[] {
  if (!text) return [];
  const output: string[] = [];
  let line = '';
  let units = 0;
  for (const char of Array.from(text.replace(/\s+/g, ' ').trim())) {
    const charUnits = /^[\x00-\x7f]$/.test(char) ? 1 : 2;
    if (units + charUnits > maxUnits && line) {
      output.push(line.trimEnd());
      line = '';
      units = 0;
      if (output.length >= maxLines) break;
    }
    line += char;
    units += charUnits;
  }
  if (output.length < maxLines && line) output.push(line.trimEnd());
  if (output.length === maxLines && textUnits(output.join('')) < textUnits(text.replace(/\s+/g, ' ').trim())) {
    const last = output[maxLines - 1] ?? '';
    output[maxLines - 1] = `${last.slice(0, Math.max(0, last.length - 1))}…`;
  }
  return output;
}

function svgText(lines: string[], x: number, y: number, size: number, color: string, weight: number, lineHeight: number): string {
  if (lines.length === 0) return '';
  const tspans = lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${xml(line)}</tspan>`).join('');
  return `<text x="${x}" y="${y}" fill="${color}" font-family="system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="${size}" font-weight="${weight}" letter-spacing="-0.02em">${tspans}</text>`;
}

function buildSvg(request: ReturnType<typeof parseVisualArtifactRequestV15>): { svg: string; width: number; height: number } {
  const { width, height } = PRESETS[request.preset];
  const { background, foreground, accent, muted } = request.theme;
  const pad = Math.round(Math.min(width, height) * 0.075);
  const maxUnits = request.preset === 'landscape' ? 34 : 24;
  const titleSize = request.preset === 'story' ? 82 : request.preset === 'landscape' ? 68 : 76;
  const subtitleSize = Math.round(titleSize * 0.42);
  const bodySize = Math.round(titleSize * 0.34);
  const title = wrapText(request.title, maxUnits, 4);
  const subtitle = wrapText(request.subtitle, maxUnits + 6, 3);
  const body = wrapText(request.body, maxUnits + 10, request.preset === 'story' ? 10 : 7);
  const footer = wrapText(request.footer, maxUnits + 12, 2);

  const elements: string[] = [
    `<rect width="${width}" height="${height}" fill="${background}"/>`,
  ];

  if (request.layout === 'editorial') {
    elements.push(`<rect x="${pad}" y="${pad}" width="${Math.round(width * 0.12)}" height="12" rx="6" fill="${accent}"/>`);
    elements.push(`<circle cx="${width - pad - 46}" cy="${pad + 46}" r="46" fill="${accent}" opacity="0.12"/>`);
  } else if (request.layout === 'split') {
    const split = Math.round(width * 0.26);
    elements.push(`<rect width="${split}" height="${height}" fill="${accent}"/>`);
    elements.push(`<rect x="${split}" width="10" height="${height}" fill="${foreground}" opacity="0.08"/>`);
  } else {
    elements.push(`<rect x="${pad}" y="${pad}" width="18" height="18" rx="9" fill="${accent}"/>`);
  }

  const contentX = request.layout === 'split' ? Math.round(width * 0.34) : pad;
  const contentWidth = width - contentX - pad;
  const top = request.preset === 'story' ? Math.round(height * 0.23) : Math.round(height * 0.25);
  const titleLineHeight = Math.round(titleSize * 1.12);
  elements.push(svgText(title, contentX, top, titleSize, foreground, 760, titleLineHeight));

  let cursor = top + Math.max(1, title.length) * titleLineHeight + Math.round(titleSize * 0.45);
  if (subtitle.length > 0) {
    elements.push(svgText(subtitle, contentX, cursor, subtitleSize, accent, 650, Math.round(subtitleSize * 1.35)));
    cursor += subtitle.length * Math.round(subtitleSize * 1.35) + Math.round(titleSize * 0.45);
  }
  if (body.length > 0) {
    elements.push(`<line x1="${contentX}" y1="${cursor - Math.round(bodySize * 0.7)}" x2="${contentX + Math.min(contentWidth, Math.round(width * 0.22))}" y2="${cursor - Math.round(bodySize * 0.7)}" stroke="${muted}" stroke-width="3" opacity="0.3"/>`);
    elements.push(svgText(body, contentX, cursor, bodySize, muted, 430, Math.round(bodySize * 1.48)));
  }
  if (footer.length > 0) {
    elements.push(svgText(footer, contentX, height - pad, Math.max(24, Math.round(bodySize * 0.82)), muted, 560, Math.round(bodySize * 1.1)));
  }

  const label = xml(request.kind.toUpperCase().replace('-', ' '));
  elements.push(`<text x="${width - pad}" y="${height - pad}" text-anchor="end" fill="${foreground}" opacity="0.4" font-family="system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="20" font-weight="650" letter-spacing="0.12em">${label}</text>`);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(request.title)}">${elements.join('')}</svg>\n`;
  return { svg, width, height };
}

export function verifyVisualSvgV15(bytes: Buffer, width: number, height: number): { verified: boolean; checks: readonly string[] } {
  const value = bytes.toString('utf8');
  const checks = {
    boundedBytes: bytes.length > 0 && bytes.length <= MAX_SVG_BYTES,
    svgRoot: /^<\?xml[^>]*>\s*<svg\b/i.test(value) && value.trimEnd().endsWith('</svg>'),
    exactViewport: value.includes(`width="${width}"`) && value.includes(`height="${height}"`) && value.includes(`viewBox="0 0 ${width} ${height}"`),
    noScript: !/<\s*script\b/i.test(value),
    noForeignObject: !/<\s*foreignObject\b/i.test(value),
    noEmbeddedImage: !/<\s*image\b/i.test(value),
    noExternalReference: !/(?:xlink:href|\bhref)\s*=|\burl\s*\(|@import/i.test(value),
    noEventHandlers: !/\son[a-z]+\s*=/i.test(value),
  };
  return { verified: Object.values(checks).every(Boolean), checks: Object.entries(checks).filter(([, ok]) => ok).map(([name]) => name) };
}

export function generateVisualArtifactV15(input: unknown): GeneratedVisualArtifactV15 {
  const request = parseVisualArtifactRequestV15(input);
  const { svg, width, height } = buildSvg(request);
  const bytes = Buffer.from(svg, 'utf8');
  const verification = verifyVisualSvgV15(bytes, width, height);
  return {
    version: '1.5',
    kind: request.kind,
    preset: request.preset,
    layout: request.layout,
    width,
    height,
    filename: `${safeName(request.title)}-${request.preset}.svg`,
    mimeType: 'image/svg+xml',
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    verified: verification.verified,
    verification: verification.checks,
    externalNetworkRequests: 0,
    providerExecutions: 0,
    costUsd: 0,
    freeOnly: true,
  };
}

export function visualArtifactSelfTestV15() {
  const cases: VisualArtifactRequestV15[] = [
    { kind: 'social-card', preset: 'portrait', layout: 'editorial', title: 'Verified visual', subtitle: '1080 × 1350', body: 'Local SVG artifact generation.' },
    { kind: 'poster', preset: 'story', layout: 'split', title: 'Poster', body: 'No external runtime dependency.' },
    { kind: 'info-card', preset: 'landscape', layout: 'minimal', title: 'Information', footer: 'ORIGIN V1.5' },
  ];
  const generated = cases.map(generateVisualArtifactV15);
  return {
    ready: generated.every(item => item.verified),
    format: 'svg' as const,
    cases: generated.map(item => ({ kind: item.kind, preset: item.preset, layout: item.layout, verified: item.verified })),
    externalNetworkRequests: 0,
    providerExecutions: 0,
    costUsd: 0,
    freeOnly: true,
  };
}
