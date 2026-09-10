import { createHash } from 'node:crypto';
import { zipStore } from '../artifacts/zipStore.js';

export type WebProjectKind = 'landing' | 'dashboard' | 'webapp';
export type WebProjectTheme = 'light' | 'dark' | 'system';
export type WebProjectAccent = 'indigo' | 'emerald' | 'rose' | 'sky' | 'amber' | 'violet';
export type WebSectionLayout = 'cards' | 'metrics' | 'steps' | 'faq' | 'split';

export type WebBuilderItem = { title: string; body?: string; value?: string };
export type WebBuilderAction = { label: string; href: string };
export type WebBuilderSection = {
  eyebrow?: string;
  title: string;
  body?: string;
  layout?: WebSectionLayout;
  items?: WebBuilderItem[];
};
export type WebBuilderPage = {
  slug?: string;
  title: string;
  headline: string;
  subheadline?: string;
  action?: WebBuilderAction;
  sections?: WebBuilderSection[];
};
export type WebBuilderRequest = {
  kind: WebProjectKind;
  name: string;
  description?: string;
  locale?: 'ja' | 'en';
  theme?: WebProjectTheme;
  accent?: WebProjectAccent;
  pages?: WebBuilderPage[];
};

export type WebProjectManifest = {
  version: '1.3';
  kind: WebProjectKind;
  name: string;
  pages: Array<{ title: string; slug: string; path: string }>;
  files: string[];
  offline: true;
  externalRuntimeDependencies: 0;
  publishTarget: 'static-hosting';
  persistence: 'client-save-only';
  freeOnly: true;
  costUsd: 0;
  paidFallbackEnabled: false;
};

export type GeneratedWebProject = {
  filename: string;
  mimeType: 'application/zip';
  bytes: Buffer;
  sha256: string;
  verified: boolean;
  verification: string[];
  manifest: WebProjectManifest;
};

type NormalizedPage = Required<Pick<WebBuilderPage, 'title' | 'headline'>> & {
  slug: string;
  subheadline: string;
  action?: WebBuilderAction;
  sections: WebBuilderSection[];
};

type NormalizedSpec = Omit<Required<WebBuilderRequest>, 'pages'> & { pages: NormalizedPage[] };

const KINDS: readonly WebProjectKind[] = ['landing', 'dashboard', 'webapp'];
const THEMES: readonly WebProjectTheme[] = ['light', 'dark', 'system'];
const ACCENTS: readonly WebProjectAccent[] = ['indigo', 'emerald', 'rose', 'sky', 'amber', 'violet'];
const LAYOUTS: readonly WebSectionLayout[] = ['cards', 'metrics', 'steps', 'faq', 'split'];
const MAX_SPEC_BYTES = 48 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const boundedString = (value: unknown, max: number, required = false): string | undefined => {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string') throw new Error('INVALID_WEB_BUILDER_SPEC');
  const text = value.trim();
  if ((required && text.length === 0) || text.length > max) throw new Error('INVALID_WEB_BUILDER_SPEC');
  return text;
};
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const html = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const safeFilename = (value: string) => value.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'origin-web-project';
const deriveSlug = (value: string, index: number) => {
  const slug = value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || `page-${index + 1}`;
};
const safeHref = (href: string) => /^(?:https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:[/?#][^\s<>"']*)?|\/(?!\/)[^\s<>"']*|#[A-Za-z0-9_-]+)$/.test(href);
const externalHref = (href: string) => href.startsWith('https://');

function parseItem(value: unknown): WebBuilderItem {
  if (!isRecord(value) || !exactKeys(value, ['title', 'body', 'value'])) throw new Error('INVALID_WEB_BUILDER_SPEC');
  return {
    title: boundedString(value.title, 120, true)!,
    ...(value.body !== undefined ? { body: boundedString(value.body, 800)! } : {}),
    ...(value.value !== undefined ? { value: boundedString(value.value, 80)! } : {}),
  };
}

function parseSection(value: unknown): WebBuilderSection {
  if (!isRecord(value) || !exactKeys(value, ['eyebrow', 'title', 'body', 'layout', 'items'])) throw new Error('INVALID_WEB_BUILDER_SPEC');
  const layout = value.layout === undefined ? 'cards' : value.layout;
  if (typeof layout !== 'string' || !LAYOUTS.includes(layout as WebSectionLayout)) throw new Error('INVALID_WEB_BUILDER_SPEC');
  if (value.items !== undefined && (!Array.isArray(value.items) || value.items.length > 12)) throw new Error('INVALID_WEB_BUILDER_SPEC');
  return {
    ...(value.eyebrow !== undefined ? { eyebrow: boundedString(value.eyebrow, 60)! } : {}),
    title: boundedString(value.title, 120, true)!,
    ...(value.body !== undefined ? { body: boundedString(value.body, 1500)! } : {}),
    layout: layout as WebSectionLayout,
    items: Array.isArray(value.items) ? value.items.map(parseItem) : [],
  };
}

function parsePage(value: unknown, index: number, usedSlugs: Set<string>): NormalizedPage {
  if (!isRecord(value) || !exactKeys(value, ['slug', 'title', 'headline', 'subheadline', 'action', 'sections'])) throw new Error('INVALID_WEB_BUILDER_SPEC');
  const title = boundedString(value.title, 100, true)!;
  const requestedSlug = value.slug === undefined ? undefined : boundedString(value.slug, 50, true)!;
  if (requestedSlug && !/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(requestedSlug)) throw new Error('INVALID_WEB_BUILDER_SPEC');
  const slug = index === 0 ? '' : (requestedSlug || deriveSlug(title, index));
  if (usedSlugs.has(slug)) throw new Error('INVALID_WEB_BUILDER_SPEC');
  usedSlugs.add(slug);

  let action: WebBuilderAction | undefined;
  if (value.action !== undefined) {
    if (!isRecord(value.action) || !exactKeys(value.action, ['label', 'href'])) throw new Error('INVALID_WEB_BUILDER_SPEC');
    const label = boundedString(value.action.label, 80, true)!;
    const href = boundedString(value.action.href, 300, true)!;
    if (!safeHref(href)) throw new Error('INVALID_WEB_BUILDER_SPEC');
    action = { label, href };
  }
  if (value.sections !== undefined && (!Array.isArray(value.sections) || value.sections.length > 12)) throw new Error('INVALID_WEB_BUILDER_SPEC');
  return {
    slug,
    title,
    headline: boundedString(value.headline, 180, true)!,
    subheadline: boundedString(value.subheadline ?? '', 500) ?? '',
    ...(action ? { action } : {}),
    sections: Array.isArray(value.sections) ? value.sections.map(parseSection) : [],
  };
}

export function parseWebBuilderRequest(input: unknown): NormalizedSpec {
  if (!isRecord(input) || !exactKeys(input, ['kind', 'name', 'description', 'locale', 'theme', 'accent', 'pages'])) throw new Error('INVALID_WEB_BUILDER_SPEC');
  let encoded: string;
  try { encoded = JSON.stringify(input); } catch { throw new Error('INVALID_WEB_BUILDER_SPEC'); }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_SPEC_BYTES) throw new Error('INVALID_WEB_BUILDER_SPEC');
  if (typeof input.kind !== 'string' || !KINDS.includes(input.kind as WebProjectKind)) throw new Error('INVALID_WEB_BUILDER_SPEC');
  const locale = input.locale === undefined ? 'ja' : input.locale;
  const theme = input.theme === undefined ? 'system' : input.theme;
  const accent = input.accent === undefined ? 'indigo' : input.accent;
  if ((locale !== 'ja' && locale !== 'en') || typeof theme !== 'string' || !THEMES.includes(theme as WebProjectTheme) || typeof accent !== 'string' || !ACCENTS.includes(accent as WebProjectAccent)) throw new Error('INVALID_WEB_BUILDER_SPEC');
  if (input.pages !== undefined && (!Array.isArray(input.pages) || input.pages.length < 1 || input.pages.length > 8)) throw new Error('INVALID_WEB_BUILDER_SPEC');

  const name = boundedString(input.name, 80, true)!;
  const description = boundedString(input.description ?? '', 500) ?? '';
  const rawPages = Array.isArray(input.pages) && input.pages.length ? input.pages : [{ title: name, headline: name, subheadline: description }];
  const usedSlugs = new Set<string>();
  const pages = rawPages.map((page, index) => parsePage(page, index, usedSlugs));
  return { kind: input.kind as WebProjectKind, name, description, locale, theme: theme as WebProjectTheme, accent: accent as WebProjectAccent, pages };
}

function pagePath(page: NormalizedPage): string { return page.slug ? `${page.slug}/index.html` : 'index.html'; }
function relativeRoot(page: NormalizedPage): string { return page.slug ? '../' : ''; }

function renderSection(section: WebBuilderSection, index: number): string {
  const layout = section.layout ?? 'cards';
  const items = section.items ?? [];
  const heading = `<div class="section-heading">${section.eyebrow ? `<p class="eyebrow">${html(section.eyebrow)}</p>` : ''}<h2>${html(section.title)}</h2>${section.body ? `<p>${html(section.body)}</p>` : ''}</div>`;
  if (layout === 'faq') {
    const rows = items.map(item => `<details><summary>${html(item.title)}</summary><p>${html(item.body ?? item.value ?? '')}</p></details>`).join('');
    return `<section class="section section-faq" id="section-${index + 1}">${heading}<div class="faq-list">${rows}</div></section>`;
  }
  const cards = items.map((item, itemIndex) => {
    const marker = layout === 'steps' ? `<span class="step-index">${String(itemIndex + 1).padStart(2, '0')}</span>` : '';
    const value = item.value ? `<strong class="metric-value">${html(item.value)}</strong>` : '';
    return `<article class="card">${marker}${value}<h3>${html(item.title)}</h3>${item.body ? `<p>${html(item.body)}</p>` : ''}</article>`;
  }).join('');
  return `<section class="section section-${html(layout)}" id="section-${index + 1}">${heading}<div class="grid grid-${html(layout)}">${cards}</div></section>`;
}

function renderPage(spec: NormalizedSpec, page: NormalizedPage): string {
  const root = relativeRoot(page);
  const nav = spec.pages.map(target => {
    const href = target.slug ? `${root}${target.slug}/` : (page.slug ? '../' : './');
    return `<a href="${html(href)}"${target.slug === page.slug ? ' aria-current="page"' : ''}>${html(target.title)}</a>`;
  }).join('');
  const action = page.action ? `<a class="button" href="${html(page.action.href)}"${externalHref(page.action.href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${html(page.action.label)}</a>` : '';
  const themeAttr = spec.theme === 'system' ? '' : ` data-theme="${spec.theme}"`;
  return `<!doctype html>
<html lang="${spec.locale}" data-accent="${spec.accent}"${themeAttr} data-origin-generated="v1.3">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${html(spec.description || page.subheadline || page.headline)}">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
  <meta name="referrer" content="no-referrer">
  <meta name="color-scheme" content="light dark">
  <title>${html(page.title)} · ${html(spec.name)}</title>
  <link rel="stylesheet" href="${root}assets/styles.css">
  <script defer src="${root}assets/app.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <a class="brand" href="${page.slug ? '../' : './'}" aria-label="${html(spec.name)} home"><span class="brand-mark" aria-hidden="true"></span><span>${html(spec.name)}</span></a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
    <nav id="site-nav" class="site-nav" aria-label="Primary navigation">${nav}</nav>
  </header>
  <main id="main">
    <section class="hero">
      <div class="hero-copy"><p class="eyebrow">${html(spec.kind.toUpperCase())} · ORIGIN V1.3</p><h1>${html(page.headline)}</h1>${page.subheadline ? `<p class="hero-lead">${html(page.subheadline)}</p>` : ''}${action}</div>
      <div class="hero-panel" aria-hidden="true"><span></span><span></span><span></span><div></div></div>
    </section>
    ${page.sections.map(renderSection).join('\n    ')}
  </main>
  <footer><p>${html(spec.name)} · Generated locally by ORIGIN V1.3 · No external runtime dependencies.</p></footer>
</body>
</html>`;
}

const STYLES = `:root{--bg:#f7f8fc;--surface:rgba(255,255,255,.82);--surface-solid:#fff;--text:#131722;--muted:#667085;--line:rgba(19,23,34,.10);--shadow:0 24px 70px rgba(16,24,40,.12);--accent:#4f46e5;--accent-2:#7c3aed;--radius:24px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light dark}html[data-accent=emerald]{--accent:#059669;--accent-2:#0d9488}html[data-accent=rose]{--accent:#e11d48;--accent-2:#db2777}html[data-accent=sky]{--accent:#0284c7;--accent-2:#2563eb}html[data-accent=amber]{--accent:#d97706;--accent-2:#ea580c}html[data-accent=violet]{--accent:#7c3aed;--accent-2:#9333ea}html[data-theme=dark]{--bg:#090b10;--surface:rgba(17,20,29,.84);--surface-solid:#11141d;--text:#f8fafc;--muted:#aab2c0;--line:rgba(255,255,255,.10);--shadow:0 24px 70px rgba(0,0,0,.34)}@media(prefers-color-scheme:dark){html:not([data-theme]){--bg:#090b10;--surface:rgba(17,20,29,.84);--surface-solid:#11141d;--text:#f8fafc;--muted:#aab2c0;--line:rgba(255,255,255,.10);--shadow:0 24px 70px rgba(0,0,0,.34)}}*{box-sizing:border-box}html{scroll-behavior:smooth;background:var(--bg)}body{margin:0;color:var(--text);background:radial-gradient(circle at 8% 8%,color-mix(in srgb,var(--accent) 16%,transparent),transparent 34rem),radial-gradient(circle at 92% 10%,color-mix(in srgb,var(--accent-2) 13%,transparent),transparent 30rem),var(--bg);min-height:100vh}.skip-link{position:fixed;left:12px;top:-80px;z-index:99;background:var(--text);color:var(--bg);padding:10px 14px;border-radius:10px}.skip-link:focus{top:12px}.site-header{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:24px;max-width:1180px;margin:auto;padding:20px 28px;background:color-mix(in srgb,var(--bg) 80%,transparent);backdrop-filter:blur(18px)}.brand{display:flex;align-items:center;gap:10px;color:var(--text);font-weight:800;text-decoration:none;letter-spacing:-.02em}.brand-mark{width:28px;height:28px;border-radius:9px;background:linear-gradient(135deg,var(--accent),var(--accent-2));box-shadow:0 8px 22px color-mix(in srgb,var(--accent) 35%,transparent)}.site-nav{margin-left:auto;display:flex;gap:6px;align-items:center}.site-nav a{color:var(--muted);text-decoration:none;font-weight:650;padding:9px 12px;border-radius:12px}.site-nav a:hover,.site-nav a[aria-current=page]{color:var(--text);background:var(--surface)}.nav-toggle{display:none;margin-left:auto;border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:12px;padding:9px 12px;font:inherit}main{max-width:1180px;margin:auto;padding:28px}.hero{min-height:62vh;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(260px,.75fr);gap:54px;align-items:center;padding:72px 0 86px}.hero-copy{max-width:760px}.eyebrow{margin:0 0 12px;color:var(--accent);font-size:.78rem;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.hero h1{font-size:clamp(3rem,8vw,6.8rem);line-height:.91;letter-spacing:-.065em;margin:0;max-width:11ch}.hero-lead,.section-heading>p{font-size:clamp(1.05rem,2vw,1.28rem);line-height:1.7;color:var(--muted);max-width:66ch}.button{display:inline-flex;margin-top:22px;padding:13px 18px;border-radius:14px;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:white;text-decoration:none;font-weight:800;box-shadow:0 14px 32px color-mix(in srgb,var(--accent) 28%,transparent)}.hero-panel{aspect-ratio:1/1;max-width:390px;width:100%;justify-self:end;border:1px solid var(--line);border-radius:34px;background:linear-gradient(145deg,var(--surface),color-mix(in srgb,var(--surface-solid) 58%,transparent));box-shadow:var(--shadow);padding:26px;display:grid;grid-template-columns:repeat(2,1fr);grid-template-rows:54px 1fr;gap:14px;transform:rotate(2deg)}.hero-panel span,.hero-panel div{border-radius:16px;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 25%,var(--surface-solid)),color-mix(in srgb,var(--accent-2) 12%,var(--surface-solid)))}.hero-panel div{grid-column:1/-1}.section{padding:74px 0;border-top:1px solid var(--line)}.section-heading{display:grid;grid-template-columns:minmax(220px,.7fr) minmax(0,1.3fr);gap:40px;align-items:end;margin-bottom:32px}.section-heading .eyebrow{grid-column:1/-1;margin-bottom:-22px}.section h2{font-size:clamp(2rem,5vw,4rem);line-height:1;letter-spacing:-.045em;margin:0}.section-heading>p{margin:0}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.grid-metrics{grid-template-columns:repeat(4,minmax(0,1fr))}.grid-split{grid-template-columns:repeat(2,minmax(0,1fr))}.card{position:relative;overflow:hidden;min-height:190px;padding:26px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);box-shadow:0 14px 42px rgba(16,24,40,.06)}.card:before{content:"";position:absolute;inset:auto -20% -48% 45%;height:130px;border-radius:50%;background:color-mix(in srgb,var(--accent) 10%,transparent);filter:blur(18px)}.card h3{position:relative;margin:10px 0 8px;font-size:1.12rem}.card p{position:relative;margin:0;color:var(--muted);line-height:1.65}.metric-value{position:relative;display:block;font-size:clamp(2rem,4vw,3.6rem);letter-spacing:-.06em}.step-index{display:inline-flex;width:42px;height:42px;border-radius:50%;align-items:center;justify-content:center;background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent);font-weight:900}.faq-list{display:grid;gap:10px;max-width:860px;margin-left:auto}details{border:1px solid var(--line);border-radius:18px;background:var(--surface);padding:18px 20px}summary{cursor:pointer;font-weight:800}details p{color:var(--muted);line-height:1.7;margin:12px 0 0}footer{max-width:1180px;margin:auto;padding:36px 28px 54px;color:var(--muted);font-size:.9rem;border-top:1px solid var(--line)}@media(max-width:820px){.site-header{padding:16px 20px}.nav-toggle{display:block}.site-nav{display:none;position:absolute;top:66px;left:20px;right:20px;padding:12px;border:1px solid var(--line);border-radius:18px;background:var(--surface-solid);box-shadow:var(--shadow);flex-direction:column;align-items:stretch}.site-nav[data-open=true]{display:flex}.hero{grid-template-columns:1fr;min-height:auto;padding:62px 0}.hero-panel{justify-self:start;max-width:280px}.section-heading{grid-template-columns:1fr}.section-heading .eyebrow{margin-bottom:0}.grid,.grid-metrics,.grid-split{grid-template-columns:1fr 1fr}}@media(max-width:560px){main{padding:20px}.hero h1{font-size:clamp(2.9rem,17vw,4.8rem)}.hero-panel{display:none}.grid,.grid-metrics,.grid-split{grid-template-columns:1fr}.section{padding:54px 0}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}`;

const SCRIPT = `(() => { const button = document.querySelector('.nav-toggle'); const nav = document.querySelector('.site-nav'); if (!(button instanceof HTMLButtonElement) || !(nav instanceof HTMLElement)) return; const close = () => { nav.dataset.open = 'false'; button.setAttribute('aria-expanded','false'); }; button.addEventListener('click', () => { const open = nav.dataset.open !== 'true'; nav.dataset.open = String(open); button.setAttribute('aria-expanded', String(open)); }); document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); }); nav.addEventListener('click', event => { if (event.target instanceof HTMLAnchorElement) close(); }); })();`;

function defaultSections(spec: NormalizedSpec): WebBuilderSection[] {
  if (spec.kind === 'dashboard') return [
    { eyebrow: 'Overview', title: 'Key signals', layout: 'metrics', items: [{ title: 'Availability', value: '99.9%', body: 'Designed for clear operational visibility.' }, { title: 'Tasks', value: '24', body: 'A compact summary surface for active work.' }, { title: 'Velocity', value: '+18%', body: 'A focused trend indicator without external analytics.' }] },
    { title: 'Workspace', body: 'Organize the most important operating information into a calm, readable grid.', layout: 'cards', items: [{ title: 'Priorities', body: 'Keep the next actions visible and bounded.' }, { title: 'Signals', body: 'Separate facts, status, and decisions.' }, { title: 'Review', body: 'Make verification a first-class step.' }] },
  ];
  if (spec.kind === 'webapp') return [
    { eyebrow: 'Product', title: 'A focused application shell', body: 'A dependency-free foundation with accessible navigation and a strict runtime security policy.', layout: 'cards', items: [{ title: 'Fast by default', body: 'No remote runtime dependencies or network calls.' }, { title: 'Safe by default', body: 'Strict CSP, escaped content, and no inline executable code.' }, { title: 'Portable by default', body: 'Deployable to any static host.' }] },
    { title: 'How it works', layout: 'steps', items: [{ title: 'Define', body: 'Describe pages and structured content.' }, { title: 'Generate', body: 'Build deterministic HTML, CSS, and JavaScript.' }, { title: 'Verify', body: 'Check package structure and security invariants.' }] },
  ];
  return [
    { eyebrow: 'Built with ORIGIN', title: 'Clear structure. Strong defaults.', body: 'A polished, responsive site that works without third-party runtime dependencies.', layout: 'cards', items: [{ title: 'Responsive', body: 'Layout scales cleanly across desktop and mobile.' }, { title: 'Accessible', body: 'Semantic structure, keyboard navigation, and reduced-motion support.' }, { title: 'Portable', body: 'A static bundle that can be hosted without a framework runtime.' }] },
    { title: 'From brief to verified site', layout: 'steps', items: [{ title: 'Design', body: 'Turn a structured brief into a consistent visual system.' }, { title: 'Build', body: 'Generate the complete project in memory.' }, { title: 'Verify', body: 'Enforce offline, CSP, packaging, and zero-cost invariants.' }] },
  ];
}

function makeReadme(spec: NormalizedSpec): string {
  return `# ${spec.name}\n\nGenerated by ORIGIN Web / Application Builder V1.3.\n\n## Run\n\nThis project is fully static. Serve the folder with any static file server or deploy it to a static host.\n\n## Security and cost\n\n- No external runtime dependencies\n- No network requests from generated JavaScript\n- Strict Content Security Policy\n- No server-side persistence in ORIGIN\n- ORIGIN generation cost: USD 0\n- Paid fallback: disabled\n`;
}

function verifyBundle(bytes: Buffer, manifest: WebProjectManifest): string[] {
  const checks: string[] = [];
  if (bytes.length > 0) checks.push('non-empty');
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50) checks.push('zip-signature');
  if (bytes.includes(Buffer.from('PK\u0005\u0006', 'binary'))) checks.push('zip-end-record');
  const required = ['assets/styles.css', 'assets/app.js', 'vercel.json', 'origin-manifest.json', 'README.md', ...manifest.pages.map(page => page.path)];
  if (required.every(path => bytes.includes(Buffer.from(path, 'utf8')))) checks.push('required-files');
  if (bytes.includes(Buffer.from('Content-Security-Policy')) && bytes.includes(Buffer.from("connect-src 'none'")) && bytes.includes(Buffer.from("form-action 'none'"))) checks.push('strict-csp');
  if (!bytes.includes(Buffer.from('fetch(')) && !bytes.includes(Buffer.from('XMLHttpRequest')) && !bytes.includes(Buffer.from('WebSocket')) && !bytes.includes(Buffer.from('eval(')) && !bytes.includes(Buffer.from('new Function'))) checks.push('offline-runtime');
  if (manifest.externalRuntimeDependencies === 0 && manifest.freeOnly && manifest.costUsd === 0 && !manifest.paidFallbackEnabled) checks.push('zero-cost-contract');
  return checks;
}

export function generateWebProjectV13(input: unknown): GeneratedWebProject {
  const spec = parseWebBuilderRequest(input);
  const pages = spec.pages.map(page => ({ ...page, sections: page.sections.length ? page.sections : defaultSections(spec) }));
  const pageEntries = pages.map(page => ({ name: pagePath(page), data: Buffer.from(renderPage({ ...spec, pages }, page), 'utf8') }));
  const manifest: WebProjectManifest = {
    version: '1.3', kind: spec.kind, name: spec.name,
    pages: pages.map(page => ({ title: page.title, slug: page.slug, path: pagePath(page) })),
    files: [...pageEntries.map(entry => entry.name), 'assets/styles.css', 'assets/app.js', 'vercel.json', 'origin-manifest.json', 'README.md'],
    offline: true, externalRuntimeDependencies: 0, publishTarget: 'static-hosting', persistence: 'client-save-only', freeOnly: true, costUsd: 0, paidFallbackEnabled: false,
  };
  const entries = [
    ...pageEntries,
    { name: 'assets/styles.css', data: Buffer.from(STYLES, 'utf8') },
    { name: 'assets/app.js', data: Buffer.from(SCRIPT, 'utf8') },
    { name: 'vercel.json', data: Buffer.from(JSON.stringify({ cleanUrls: true, trailingSlash: true, headers: [{ source: '/(.*)', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' }] }] }, null, 2), 'utf8') },
    { name: 'origin-manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    { name: 'README.md', data: Buffer.from(makeReadme(spec), 'utf8') },
  ];
  const bytes = zipStore(entries);
  const verification = verifyBundle(bytes, manifest);
  const requiredChecks = ['non-empty', 'zip-signature', 'zip-end-record', 'required-files', 'strict-csp', 'offline-runtime', 'zero-cost-contract'];
  const verified = requiredChecks.every(check => verification.includes(check));
  return {
    filename: `${safeFilename(spec.name)}-origin-v1.3.zip`, mimeType: 'application/zip', bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'), verified, verification, manifest,
  };
}

export function runWebBuilderV13SelfTest(): Record<WebProjectKind, boolean> {
  return Object.fromEntries(KINDS.map(kind => {
    try {
      const project = generateWebProjectV13({ kind, name: `ORIGIN ${kind}`, description: 'Deterministic self-test project.' });
      return [kind, project.verified && project.manifest.pages.length === 1 && project.bytes.length > 0];
    } catch { return [kind, false]; }
  })) as Record<WebProjectKind, boolean>;
}
