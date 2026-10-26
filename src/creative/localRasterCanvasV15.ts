import { planRasterVisualRequestV15 } from './rasterVisualPlannerV15';

export type LocalCanvasRasterV15 = {
  blob: Blob;
  sha256: string;
  planSha256: string;
  width: number;
  height: number;
  purpose: string;
  typographyZone: 'left' | 'center' | 'bottom' | 'top';
  generationId: string;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const hashText = (value: string) => {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
};
const sha256 = async (value: ArrayBuffer | string): Promise<string> => {
  if (!globalThis.crypto?.subtle) throw new Error('LOCAL_CANVAS_SHA256_UNAVAILABLE');
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};
const pngBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => blob && blob.type === 'image/png' && blob.size
    ? resolve(blob) : reject(new Error('LOCAL_CANVAS_PNG_ENCODE_FAILED')), 'image/png');
});

/** Creates a real PNG locally. This is procedural artwork, not a generative AI model. */
export async function generateLocalCanvasRasterV15(prompt: string): Promise<LocalCanvasRasterV15> {
  if (typeof document === 'undefined') throw new Error('LOCAL_CANVAS_BROWSER_REQUIRED');
  const normalized = prompt.normalize('NFKC').trim().slice(0, 2_000);
  if (normalized.length < 4) throw new Error('LOCAL_CANVAS_PROMPT_TOO_SHORT');
  const plan = planRasterVisualRequestV15(normalized);
  if (!plan.ready) throw new Error('LOCAL_CANVAS_PROMPT_NEEDS_CLARIFICATION');
  const width = clamp(plan.width, 256, 1536);
  const height = clamp(plan.height, 256, 1536);
  const seed = hashText(normalized);
  const hue = seed % 360;
  const hue2 = (hue + 65 + (seed % 80)) % 360;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('LOCAL_CANVAS_CONTEXT_UNAVAILABLE');

  const zone = (['left', 'center', 'bottom', 'top'] as const).includes(plan.typographyZone as 'left' | 'center' | 'bottom' | 'top')
    ? plan.typographyZone as 'left' | 'center' | 'bottom' | 'top' : 'bottom';
  const vertical = zone === 'top' || zone === 'bottom';
  const gradient = ctx.createLinearGradient(0, 0, vertical ? width : 0, vertical ? height : height);
  gradient.addColorStop(0, `hsl(${hue} 58% 15%)`);
  gradient.addColorStop(.48, `hsl(${hue2} 68% 34%)`);
  gradient.addColorStop(1, `hsl(${(hue + 190) % 360} 52% 8%)`);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);

  // Prompt-derived light, palette, and composition, all generated in-browser.
  const glow = ctx.createRadialGradient(width * (0.28 + (seed % 45) / 100), height * .34, 0, width * .45, height * .42, Math.max(width, height) * .72);
  glow.addColorStop(0, `hsla(${hue2} 90% 78% / .48)`);
  glow.addColorStop(1, 'hsla(0 0% 0% / 0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
  const cx = width * (zone === 'left' ? .68 : .54);
  const cy = height * (zone === 'top' ? .68 : zone === 'bottom' ? .36 : .48);
  const radius = Math.min(width, height) * (.19 + (seed % 9) / 100);
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate((seed % 21 - 10) * Math.PI / 180);
  const subject = ctx.createRadialGradient(-radius * .32, -radius * .4, radius * .05, 0, 0, radius * 1.5);
  subject.addColorStop(0, `hsla(${(hue + 28) % 360} 75% 88% / .92)`);
  subject.addColorStop(.55, `hsla(${hue2} 65% 58% / .74)`);
  subject.addColorStop(1, `hsla(${hue} 70% 18% / .08)`);
  ctx.fillStyle = subject; ctx.beginPath(); ctx.arc(0, 0, radius * 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.42)'; ctx.lineWidth = Math.max(1, width / 700);
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(0, 0, radius * (1.08 + i * .17), radius * (.46 + i * .13), i * .38, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();

  const panel = vertical ? height * .27 : width * .34;
  const panelGradient = zone === 'top'
    ? ctx.createLinearGradient(0, 0, 0, panel)
    : zone === 'left'
      ? ctx.createLinearGradient(0, 0, width * .42, 0)
      : zone === 'center'
        ? ctx.createRadialGradient(width / 2, height / 2, 1, width / 2, height / 2, Math.max(width, height) * .56)
        : ctx.createLinearGradient(0, height - panel, 0, height);
  panelGradient.addColorStop(0, 'rgba(0,0,0,.68)');
  panelGradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = panelGradient;
  if (zone === 'top') ctx.fillRect(0, 0, width, panel);
  else if (zone === 'left') ctx.fillRect(0, 0, width * .48, height);
  else if (zone === 'center') ctx.fillRect(0, 0, width, height);
  else ctx.fillRect(0, height - panel, width, panel);

  // Do not fake model-rendered lettering; exact user copy is rendered deterministically.
  if (plan.exactText.length) {
    const fontSize = Math.max(24, Math.round(Math.min(width, height) * .045));
    ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 5;
    ctx.textBaseline = 'top';
    const maxWidth = width * .78;
    let y = zone === 'top' ? height * .07 : zone === 'center' ? height * .38 : zone === 'bottom' ? height * .76 : height * .18;
    for (const text of plan.exactText.slice(0, 4)) {
      let line = '';
      for (const char of Array.from(text)) {
        if (line && ctx.measureText(line + char).width > maxWidth) {
          ctx.fillText(line, zone === 'center' ? Math.max(24, (width - ctx.measureText(line).width) / 2) : width * .07, y);
          y += fontSize * 1.3; line = char;
        } else line += char;
      }
      if (line) ctx.fillText(line, zone === 'center' ? Math.max(24, (width - ctx.measureText(line).width) / 2) : width * .07, y);
      y += fontSize * 1.45;
    }
  }

  const blob = await pngBlob(canvas);
  const digest = await sha256(await blob.arrayBuffer());
  const planSha256 = await sha256(JSON.stringify({
    version: plan.version, purpose: plan.purpose, width, height, style: plan.style,
    composition: plan.composition, lighting: plan.lighting, typographyZone: zone, exactText: plan.exactText,
  }));
  return {
    blob, sha256: digest, planSha256, width, height, purpose: plan.purpose,
    typographyZone: zone, generationId: `raster-${digest.slice(0, 24)}`,
  };
}
