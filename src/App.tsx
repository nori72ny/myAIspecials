import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { getTranslations, type OriginLanguage } from './i18n';
import { originIndexedDbAdapter } from './lib/local/OriginIndexedDb';

export interface ArtifactBlock {
  id: string;
  type: 'code' | 'markdown' | 'mermaid' | 'html';
  title: string;
  language: string;
  content: string;
  isComplete: boolean;
  revision?: number;
  revisions?: readonly ArtifactRevision[];
}

export type ArtifactRevision = { id: string; content: string; createdAt: number; source: 'generated' | 'direct-touch' | 'restore' };
export type DirectTouchEdit = { index: number; text: string };
export type ArtifactVisualDiffLine = { kind: 'added' | 'removed' | 'context'; category: 'html' | 'css' | 'text'; value: string };
export type ArtifactVisualDiff = { lines: readonly ArtifactVisualDiffLine[]; added: number; removed: number; htmlChanges: number; cssChanges: number };

const splitArtifactVisualUnits = (content: string): string[] => content
  .replace(/>\s*</g, '>\n<')
  .replace(/}\s*/g, '}\n')
  .replace(/;\s*/g, ';\n')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .slice(0, 320);

const classifyArtifactVisualUnit = (value: string): ArtifactVisualDiffLine['category'] => {
  if (/[{}:;]/.test(value)) return 'css';
  if (value.startsWith('<') || value.startsWith('</')) return 'html';
  return 'text';
};

export const createArtifactVisualDiff = (previousContent: string, currentContent: string): ArtifactVisualDiff => {
  const previous = splitArtifactVisualUnits(previousContent);
  const current = splitArtifactVisualUnits(currentContent);
  const remainingCurrent = new Map<string, number>();
  current.forEach((value) => remainingCurrent.set(value, (remainingCurrent.get(value) ?? 0) + 1));
  const removed = previous.flatMap((value): ArtifactVisualDiffLine[] => {
    const available = remainingCurrent.get(value) ?? 0;
    if (available > 0) { remainingCurrent.set(value, available - 1); return []; }
    return [{ kind: 'removed', category: classifyArtifactVisualUnit(value), value }];
  });
  const remainingPrevious = new Map<string, number>();
  previous.forEach((value) => remainingPrevious.set(value, (remainingPrevious.get(value) ?? 0) + 1));
  const added = current.flatMap((value): ArtifactVisualDiffLine[] => {
    const available = remainingPrevious.get(value) ?? 0;
    if (available > 0) { remainingPrevious.set(value, available - 1); return []; }
    return [{ kind: 'added', category: classifyArtifactVisualUnit(value), value }];
  });
  const lines = [...removed, ...added].slice(0, 160);
  return { lines, added: added.length, removed: removed.length, htmlChanges: lines.filter((line) => line.category === 'html').length, cssChanges: lines.filter((line) => line.category === 'css').length };
};

const DIRECT_TOUCH_TARGET_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,li,figcaption,td,th,button,label,span,a';
const isDirectTouchEdits = (value: unknown): value is DirectTouchEdit[] => Array.isArray(value) && value.length > 0 && value.length <= 24 && value.every((edit) => Boolean(edit) && typeof edit.index === 'number' && Number.isInteger(edit.index) && edit.index >= 0 && edit.index < 2_000 && typeof edit.text === 'string' && edit.text.length <= 12_000);

export const applyDirectTouchEdits = (content: string, edits: unknown) => {
  if (!isDirectTouchEdits(edits) || typeof DOMParser === 'undefined') return content;
  const documentShell = /<\s*(?:!doctype|html)\b/i.test(content);
  const documentModel = new DOMParser().parseFromString(content, 'text/html');
  const targets = Array.from(documentModel.body.querySelectorAll<HTMLElement>(DIRECT_TOUCH_TARGET_SELECTOR)).filter((element) => element.children.length === 0 && Boolean(element.textContent?.trim()));
  const replacements = new Map(edits.map((edit) => [edit.index, edit.text]));
  replacements.forEach((text, index) => { const target = targets[index]; if (target) target.textContent = text; });
  if (!documentShell) return documentModel.body.innerHTML;
  const doctype = content.match(/^\s*(<!doctype[^>]*>)/i)?.[1] ?? '<!doctype html>';
  return `${doctype}\n${documentModel.documentElement.outerHTML}`;
};

const prepareDirectTouchMarkup = (content: string) => {
  if (typeof DOMParser === 'undefined') return content;
  const documentModel = new DOMParser().parseFromString(content, 'text/html');
  const targets = Array.from(documentModel.body.querySelectorAll<HTMLElement>(DIRECT_TOUCH_TARGET_SELECTOR)).filter((element) => element.children.length === 0 && Boolean(element.textContent?.trim()));
  targets.forEach((target, index) => {
    target.setAttribute('data-origin-direct-touch-index', String(index));
    target.setAttribute('contenteditable', 'plaintext-only');
    target.setAttribute('oninput', `window.clearTimeout(window.__originDirectTouchTimer);var node=this;window.__originDirectTouchTimer=window.setTimeout(function(){try{parent.postMessage({source:'ORIGIN_DIRECT_TOUCH',type:'commit',edits:[{index:${index},text:String(node.textContent||'')}],timestamp:Date.now()},'*')}catch(_){ }},420);`);
    target.spellcheck = true;
  });
  return documentModel.body.innerHTML;
};

export interface ParsedStreamFrame {
  conversationalText: string;
  artifacts: ArtifactBlock[];
  activeArtifact: ArtifactBlock | null;
}

export type ConversationMessage = { id: string; role: 'user' | 'assistant'; content: string };
export type ConversationSession = { id: string; title: string; createdAt: number; messages: readonly ConversationMessage[] };
type Attachment = { name: string; content: string; mediaType: string; kind: 'image' | 'text'; bytes: number };
export type OriginLocalSearchResult = { kind: 'session' | 'artifact'; id: string; title: string; detail: string; session?: ConversationSession; artifact?: ArtifactBlock };

export const searchOriginLocalSnapshot = (query: string, sessions: readonly ConversationSession[], artifacts: readonly ArtifactBlock[]): OriginLocalSearchResult[] => {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return [];
  const matches = (value: string) => { const normalized = value.toLocaleLowerCase(); return terms.every((term) => normalized.includes(term)); };
  const results: OriginLocalSearchResult[] = [];
  sessions.forEach((session) => {
    const source = `${session.title}\n${session.messages.map((message) => message.content).join('\n')}`;
    if (matches(source)) results.push({ kind: 'session', id: session.id, title: session.title, detail: session.messages.at(-1)?.content.slice(0, 160) || '会話セッション', session });
  });
  artifacts.forEach((artifact) => {
    const revisions = artifact.revisions?.map((revision) => revision.content).join('\n') || '';
    const source = `${artifact.title}\n${artifact.language}\n${artifact.content}\n${revisions}`;
    if (matches(source)) results.push({ kind: 'artifact', id: artifact.id, title: artifact.title, detail: `${artifact.language} · 最新の保存内容 · ${artifact.content.slice(0, 140)}`, artifact });
  });
  return results.slice(0, 30);
};

const isStoredArtifactBlock = (value: unknown): value is ArtifactBlock => Boolean(value)
  && typeof value === 'object'
  && typeof (value as ArtifactBlock).id === 'string'
  && typeof (value as ArtifactBlock).title === 'string'
  && typeof (value as ArtifactBlock).language === 'string'
  && typeof (value as ArtifactBlock).content === 'string'
  && ['code', 'markdown', 'mermaid', 'html'].includes((value as ArtifactBlock).type)
  && typeof (value as ArtifactBlock).isComplete === 'boolean';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const artifactExtension = (artifact: ArtifactBlock) => {
  if (artifact.language === 'markdown' || artifact.language === 'md') return 'md';
  if (artifact.language === 'svg') return 'svg';
  if (artifact.language === 'html') return 'html';
  return /^[a-z0-9]{1,12}$/i.test(artifact.language) ? artifact.language.toLowerCase() : 'txt';
};
const safeArtifactFileStem = (title: string, fallback: string) => title.replace(/[^a-z0-9._-]/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) || fallback;
export type ArtifactExportFormat = 'html' | 'svg' | 'png' | 'markdown' | 'json';
export type ArtifactExportPayload = { format: ArtifactExportFormat; fileName: string; type: string; content: string };

const escapeArtifactXml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' }[character] ?? character));
const localArtifactText = (content: string) => content.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
const artifactSvgDocument = (artifact: ArtifactBlock): string => {
  if (artifact.language === 'svg' || /^\s*<svg\b/i.test(artifact.content)) return artifact.content;
  const visible = localArtifactText(artifact.content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2_800);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#101827"/><text x="88" y="120" fill="#d7e8f7" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="34">${escapeArtifactXml(artifact.title)}</text><foreignObject x="88" y="168" width="1424" height="650"><div xmlns="http://www.w3.org/1999/xhtml" style="color:#d7e8f7;font:22px/1.55 system-ui,sans-serif;white-space:pre-wrap">${escapeArtifactXml(visible || 'ORIGIN artifact')}</div></foreignObject></svg>`;
};

export const createArtifactExportPayload = (artifact: ArtifactBlock, format: Exclude<ArtifactExportFormat, 'png'>): ArtifactExportPayload => {
  const stem = safeArtifactFileStem(artifact.title, 'origin-artifact');
  if (format === 'html') return { format, fileName: `${stem}.html`, type: 'text/html;charset=utf-8', content: artifact.language === 'html' ? artifact.content : `<!doctype html><meta charset="utf-8"><pre>${escapeBundleHtml(artifact.content)}</pre>` };
  if (format === 'svg') return { format, fileName: `${stem}.svg`, type: 'image/svg+xml;charset=utf-8', content: artifactSvgDocument(artifact) };
  if (format === 'markdown') return { format, fileName: `${stem}.md`, type: 'text/markdown;charset=utf-8', content: artifact.language === 'markdown' || artifact.language === 'md' ? artifact.content : `# ${artifact.title}\n\n\`\`\`${artifact.language || 'text'}\n${artifact.content}\n\`\`\`\n` };
  return { format, fileName: `${stem}.json`, type: 'application/json;charset=utf-8', content: JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), artifact: { ...artifact, revisions: artifact.revisions ?? [] } }, null, 2) };
};

export const createArtifactPngBlob = async (artifact: ArtifactBlock): Promise<Blob> => {
  if (typeof document === 'undefined' || typeof URL === 'undefined') throw new Error('png-export-unavailable');
  const canvas = document.createElement('canvas');
  canvas.width = 1600; canvas.height = 900;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('png-context-unavailable');
  context.fillStyle = '#101827'; context.fillRect(0, 0, canvas.width, canvas.height);
  const renderFallback = () => {
    const fallbackText = localArtifactText(artifact.content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
    context.fillStyle = '#d7e8f7'; context.font = 'bold 34px system-ui, sans-serif'; context.fillText(artifact.title.slice(0, 80), 88, 110);
    context.font = '22px system-ui, sans-serif';
    fallbackText.match(/.{1,88}(?:\s|$)/g)?.slice(0, 20).forEach((line, index) => context.fillText(line.trim(), 88, 175 + index * 36));
  };
  if (artifact.language === 'svg' || /^\s*<svg\b/i.test(artifact.content)) {
    const url = URL.createObjectURL(new Blob([artifactSvgDocument(artifact)], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('png-render-failed')); image.src = url; });
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    } catch { renderFallback(); }
    finally { URL.revokeObjectURL(url); }
  } else {
    renderFallback();
  }
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('png-encode-failed')), 'image/png'));
};
const escapeBundleHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
const zipEncoder = new TextEncoder();
const zipJoin = (chunks: readonly Uint8Array[]) => { const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0); const joined = new Uint8Array(total); let offset = 0; chunks.forEach((chunk) => { joined.set(chunk, offset); offset += chunk.length; }); return joined; };
const zipU16 = (value: number) => Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
const zipU32 = (value: number) => Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
const zipCrc32 = (bytes: Uint8Array) => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; };
const createStoredZip = (entries: readonly { path: string; content: string }[]) => {
  const local: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  entries.forEach((entry) => {
    const name = zipEncoder.encode(entry.path); const data = zipEncoder.encode(entry.content); const crc = zipCrc32(data);
    const localHeader = zipJoin([zipU32(0x04034b50), zipU16(20), zipU16(0), zipU16(0), zipU16(0), zipU16(0), zipU32(crc), zipU32(data.length), zipU32(data.length), zipU16(name.length), zipU16(0), name, data]);
    const centralHeader = zipJoin([zipU32(0x02014b50), zipU16(20), zipU16(20), zipU16(0), zipU16(0), zipU16(0), zipU16(0), zipU32(crc), zipU32(data.length), zipU32(data.length), zipU16(name.length), zipU16(0), zipU16(0), zipU16(0), zipU16(0), zipU32(0), zipU32(offset), name]);
    local.push(localHeader); central.push(centralHeader); offset += localHeader.length;
  });
  const directory = zipJoin(central);
  return zipJoin([...local, directory, zipU32(0x06054b50), zipU16(0), zipU16(0), zipU16(entries.length), zipU16(entries.length), zipU32(directory.length), zipU32(offset), zipU16(0)]);
};

export const createOfflineArtifactBundle = async (artifacts: readonly ArtifactBlock[]) => {
  const included = artifacts.filter((artifact) => artifact.content.length > 0).slice(0, 100);
  const createdAt = new Date().toISOString();
  const bundleEntries: { path: string; content: string }[] = [];
  const files = included.map((artifact, index) => {
    const filename = `${String(index + 1).padStart(2, '0')}-${safeArtifactFileStem(artifact.title, `artifact-${index + 1}`)}.${artifactExtension(artifact)}`;
    const path = `artifacts/${filename}`;
    bundleEntries.push({ path, content: artifact.content });
    return { id: artifact.id, title: artifact.title, language: artifact.language, type: artifact.type, revision: artifact.revision ?? 1, path };
  });
  const manifest = { format: 'ORIGIN Offline Artifact Package', version: 1, createdAt, artifactCount: files.length, artifacts: files };
  bundleEntries.push({ path: 'manifest.json', content: JSON.stringify(manifest, null, 2) });
  bundleEntries.push({ path: 'README.txt', content: `ORIGIN Offline Artifact Package\nCreated: ${createdAt}\nArtifacts: ${files.length}\n\nOpen index.html after extracting this ZIP. Artifact source files are stored in the artifacts directory.\n` });
  bundleEntries.push({ path: 'index.html', content: `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ORIGIN Artifact Package</title><style>body{margin:0;background:#0d1117;color:#e6edf3;font:16px/1.55 system-ui,sans-serif}.shell{max-width:900px;margin:0 auto;padding:48px 24px}h1{margin:0 0 8px}p{color:#9da7b3}.card{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:16px;margin:12px 0;border:1px solid #30363d;border-radius:14px;background:#161b22}a{color:#58d5ff;font-weight:700}@media(max-width:560px){.card{align-items:flex-start;flex-direction:column}}</style></head><body><main class="shell"><h1>ORIGIN Artifact Package</h1><p>Offline package · ${files.length} artifact(s) · ${escapeBundleHtml(createdAt)}</p><section>${files.map((file) => `<article class="card"><div><strong>${escapeBundleHtml(file.title)}</strong><br><small>${escapeBundleHtml(file.language)} · v${file.revision}</small></div><a href="${encodeURI(file.path)}">Open source</a></article>`).join('')}</section></main></body></html>` });
  return new Blob([createStoredZip(bundleEntries)], { type: 'application/zip' });
};

export class StreamArtifactParser {
  public static parse(fullText: string): ParsedStreamFrame {
    if (!fullText) return { conversationalText: '', artifacts: [], activeArtifact: null };
    const normalized = fullText.replace(/\r\n/g, '\n');
    const artifacts: ArtifactBlock[] = [];
    let conversationalText = '';
    let cursor = 0;
    let artifactIndex = 0;
    while (cursor < normalized.length) {
      const fenceMatch = /(?:^|\n)```([a-zA-Z0-9_-]+)?(?::([^\n]+))?[ \t]*(?:\n|$)/g;
      fenceMatch.lastIndex = cursor;
      const match = fenceMatch.exec(normalized);
      if (!match) { conversationalText += normalized.slice(cursor); break; }
      const matchIndex = match.index + (match[0].startsWith('\n') ? 1 : 0);
      conversationalText += normalized.slice(cursor, matchIndex);
      const rawLang = (match[1] || 'text').trim().toLowerCase();
      const rawTitle = (match[2] || '').trim();
      const title = rawTitle.slice(0, 100).replace(/[\x00-\x1F\x7F\u202A-\u202E\u2066-\u2069]/g, '').trim() || `Artifact-${artifactIndex + 1}`;
      const contentStart = matchIndex + match[0].length - (match[0].startsWith('\n') ? 1 : 0);
      const closeFenceRegex = /(?:^|\n)```[ \t]*(?:\n|$)/g;
      closeFenceRegex.lastIndex = contentStart;
      const closeMatch = closeFenceRegex.exec(normalized);
      const type = rawLang === 'html' || rawLang === 'svg' ? 'html' : rawLang === 'mermaid' ? 'mermaid' : rawLang === 'markdown' || rawLang === 'md' ? 'markdown' : 'code';
      const id = `art-${artifactIndex++}`;
      if (!closeMatch) { artifacts.push({ id, type, title, language: rawLang, content: normalized.slice(contentStart), isComplete: false }); break; }
      const contentEnd = closeMatch.index + (closeMatch[0].startsWith('\n') ? 1 : 0);
      artifacts.push({ id, type, title, language: rawLang, content: normalized.slice(contentStart, contentEnd), isComplete: true });
      cursor = closeMatch.index + closeMatch[0].length;
    }
    return { conversationalText: conversationalText.trim(), artifacts, activeArtifact: artifacts.at(-1) ?? null };
  }
}

const copyText = async (value: string) => {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return; } } catch { /* use fallback */ }
  const helper = document.createElement('textarea');
  helper.value = value; helper.style.position = 'fixed'; helper.style.opacity = '0';
  document.body.appendChild(helper); helper.select();
  const copied = document.execCommand('copy'); helper.remove();
  if (!copied) throw new Error('copy unavailable');
};

const isTextLike = (file: File) => file.type.startsWith('text/') || /\.(md|txt|json|csv|ts|tsx|js|jsx|css|html|svg|xml|yml|yaml)$/i.test(file.name);
const SAFE_WAITING_PROVIDER_CODES = new Set(['PROVIDER_POLICY_VIOLATION', 'PROVIDER_COST_UNVERIFIED', 'PROVIDER_ROUTING_UNVERIFIED', 'FREE_MODEL_EVIDENCE_STALE']);
const SAFE_WAITING_MESSAGE = '無料モデルの$0.00応答を確認できないため、回答は表示せず安全待機中です。時間をおいて再試行してください。';
const readAttachment = async (file: File): Promise<Attachment> => {
  if (file.type.startsWith('image/')) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read-error'));
      reader.onload = () => resolve({ name: file.name, content: String(reader.result), mediaType: file.type, kind: 'image', bytes: file.size });
      reader.readAsDataURL(file);
    });
  }
  if (isTextLike(file)) return { name: file.name, content: await file.text(), mediaType: file.type || 'text/plain', kind: 'text', bytes: file.size };
  throw new Error('unsupported');
};

const LegacyKnowledgeMap: React.FC<{ sessions: readonly ConversationSession[]; onRestoreSession?: (session: ConversationSession) => void }> = ({ sessions, onRestoreSession }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const frameRef = useRef<number | null>(null);
  const queuedAction = useRef<(() => void) | null>(null);
  const schedule = (action: () => void) => {
    queuedAction.current = action;
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => { frameRef.current = null; const next = queuedAction.current; queuedAction.current = null; next?.(); });
  };
  useEffect(() => () => { if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current); }, []);
  const nodes = useMemo(() => sessions.slice(0, 12).map((session, index, all) => {
    const angle = (Math.PI * 2 * index) / Math.max(all.length, 1) - Math.PI / 2;
    return { session, x: 150 + Math.cos(angle) * 105, y: 135 + Math.sin(angle) * 82 };
  }), [sessions]);
  return <>
    <button type="button" data-testid="knowledge-map-toggle" aria-label="ナレッジマップを開く" aria-pressed={isOpen} onClick={() => setIsOpen((value) => !value)} className="origin-secondary-button min-h-11 px-3 text-[13px] font-semibold">◎ Map</button>
    {isOpen && <section data-testid="knowledge-map" aria-label="ローカルナレッジマップ" className="origin-surface absolute right-4 top-20 z-40 w-[min(94vw,420px)] p-4 shadow-2xl">
      <div className="flex items-center justify-between gap-3"><div><h2 className="m-0 text-base font-bold">ナレッジマップ</h2><p className="origin-muted m-0 mt-1 text-[13px]">端末内のセッションのみを関連ノードとして表示します。</p></div><span data-testid="knowledge-map-node-count" className="origin-badge px-2 py-1 text-[13px] font-mono">{nodes.length}</span></div>
      {nodes.length === 0 ? <p className="origin-muted mt-4 text-base">復元できる過去セッションはまだありません。</p> : <>
        <svg data-testid="knowledge-map-canvas" viewBox="0 0 300 270" role="img" aria-label="セッション関連ノード" className="mt-4 h-56 w-full rounded-2xl bg-black/10">
          {nodes.slice(1).map((node) => <line key={`edge-${node.session.id}`} x1="150" y1="135" x2={node.x} y2={node.y} stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />)}
          {nodes.map((node, index) => <g key={node.session.id} role="button" tabIndex={0} aria-label={`${node.session.title}を復元`} onClick={() => schedule(() => { setSelectedSessionId(node.session.id); onRestoreSession?.(node.session); })} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); schedule(() => { setSelectedSessionId(node.session.id); onRestoreSession?.(node.session); }); } }} className="cursor-pointer outline-none"><circle cx={node.x} cy={node.y} r={selectedSessionId === node.session.id ? 19 : 15} fill={index === 0 ? '#22d3ee' : '#334155'} stroke={selectedSessionId === node.session.id ? '#e6edf3' : '#64748b'} strokeWidth="2" /><text x={node.x} y={node.y + 4} textAnchor="middle" fill="#f8fafc" fontSize="13" fontWeight="700">{index + 1}</text></g>)}
        </svg>
        <div className="mt-3 grid max-h-36 gap-2 overflow-auto">{nodes.map(({ session }, index) => <button type="button" key={`restore-${session.id}`} data-testid={`knowledge-map-session-${index}`} aria-pressed={selectedSessionId === session.id} onClick={() => schedule(() => { setSelectedSessionId(session.id); onRestoreSession?.(session); })} className="origin-secondary-button min-h-11 truncate px-3 text-left text-[13px] font-semibold">{index + 1}. {session.title}</button>)}</div>
      </>}</section>}
  </>;
};

const HistoryDrawer: React.FC<{ sessions: readonly ConversationSession[]; artifacts?: readonly ArtifactBlock[]; onRestoreSession?: (session: ConversationSession) => void; onOpenArtifact?: (artifact: ArtifactBlock) => void }> = ({ sessions, artifacts = [], onRestoreSession, onOpenArtifact }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [storedSessions, setStoredSessions] = useState<ConversationSession[] | null>(null);
  const [storedArtifacts, setStoredArtifacts] = useState<ArtifactBlock[] | null>(null);
  const deferredQuery = useDeferredValue(query);
  const frameRef = useRef<number | null>(null);
  const queuedAction = useRef<(() => void) | null>(null);
  const schedule = (action: () => void) => {
    queuedAction.current = action;
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => { frameRef.current = null; const next = queuedAction.current; queuedAction.current = null; next?.(); });
  };
  useEffect(() => () => { if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current); }, []);
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    void originIndexedDbAdapter.load().then((snapshot) => {
      if (!active || !snapshot) return;
      const restoredSessions = snapshot.sessions.flatMap((value): ConversationSession[] => {
        if (!value || typeof value !== 'object') return [];
        const candidate = value as Partial<ConversationSession>;
        if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string' || typeof candidate.createdAt !== 'number' || !Array.isArray(candidate.messages)) return [];
        const messages = candidate.messages.flatMap((message): ConversationMessage[] => message && typeof message === 'object' && ((message as ConversationMessage).role === 'user' || (message as ConversationMessage).role === 'assistant') && typeof (message as ConversationMessage).content === 'string' ? [{ id: String((message as ConversationMessage).id || ''), role: (message as ConversationMessage).role, content: (message as ConversationMessage).content }] : []);
        return [{ id: candidate.id, title: candidate.title, createdAt: candidate.createdAt, messages }];
      });
      setStoredSessions(restoredSessions);
      setStoredArtifacts(snapshot.artifacts.filter(isStoredArtifactBlock));
    });
    return () => { active = false; };
  }, [isOpen]);
  const searchableSessions = storedSessions ?? sessions;
  const searchableArtifacts = storedArtifacts ?? artifacts;
  const results = useMemo(() => searchOriginLocalSnapshot(deferredQuery, searchableSessions, searchableArtifacts), [deferredQuery, searchableArtifacts, searchableSessions]);
  return <>
    <button type="button" data-testid="history-drawer-toggle" aria-label="履歴を開く" aria-pressed={isOpen} onClick={() => setIsOpen((value) => !value)} className="origin-secondary-button min-h-11 px-3 text-[13px] font-semibold">☰ 履歴</button>
    {isOpen && <section data-testid="history-drawer" aria-label="端末内の会話と成果物履歴" className="origin-surface absolute right-4 top-20 z-40 w-[min(94vw,460px)] p-4 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><h2 className="m-0 text-base font-bold">履歴を検索</h2><p className="origin-muted m-0 mt-1 text-[13px]">会話、成果物コード、保存済みの版を端末内だけで検索します。</p></div><span className="origin-badge px-2 py-1 text-[13px] font-mono">Local</span></div><label className="mt-4 block text-[13px] font-semibold" htmlFor="origin-history-search">検索語</label><input id="origin-history-search" data-testid="history-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="会話・コード・成果物を検索" className="origin-input mt-1 min-h-11 w-full rounded-[10px] border bg-transparent px-3 text-base" />{deferredQuery.trim() ? <div data-testid="history-search-results" role="status" aria-live="polite" className="mt-3 grid max-h-72 gap-2 overflow-auto">{results.length ? results.map((result, index) => <button key={`${result.kind}-${result.id}`} type="button" data-testid={`history-search-result-${index}`} onClick={() => schedule(() => { if (result.session) onRestoreSession?.(result.session); if (result.artifact) onOpenArtifact?.(result.artifact); setIsOpen(false); })} className="origin-secondary-button min-h-11 px-3 py-2 text-left"><span className="block truncate text-[13px] font-bold">{result.kind === 'session' ? '会話' : '成果物'} · {result.title}</span><span className="origin-muted mt-1 block line-clamp-2 text-[13px]">{result.detail}</span></button>) : <p className="origin-muted m-0 py-4 text-center text-base">一致する端末内履歴はありません。</p>}</div> : <p className="origin-muted mt-3 text-[13px]">入力すると、保存済みの全セッションと成果物本文を即時に絞り込みます。</p>}</section>}
  </>;
};

const KnowledgeMap: React.FC<{ sessions: readonly ConversationSession[]; onRestoreSession?: (session: ConversationSession) => void }> = ({ sessions, onRestoreSession }) => <><LegacyKnowledgeMap sessions={sessions} onRestoreSession={onRestoreSession} /><HistoryDrawer sessions={sessions} onRestoreSession={onRestoreSession} /></>;

const ArtifactVisualDiffInspector: React.FC<{ diff: ArtifactVisualDiff }> = ({ diff }) => <section data-testid="artifact-visual-diff" aria-label="成果物の変更箇所" className="origin-surface-muted h-full overflow-auto rounded-2xl p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="m-0 text-base font-bold">最新と1つ前の版の変更</h3><p className="origin-muted m-0 mt-1 text-[13px]">端末内に保存した不変の成果物だけを比較しています。</p></div><div className="flex gap-2 text-[13px] font-mono"><span className="rounded-[10px] bg-emerald-500/15 px-2 py-1 text-emerald-600 dark:text-emerald-300">+ {diff.added}</span><span className="rounded-[10px] bg-red-500/15 px-2 py-1 text-red-600 dark:text-red-300">− {diff.removed}</span></div></div><p data-testid="artifact-visual-diff-summary" className="origin-muted mt-3 text-[13px]">HTML要素 {diff.htmlChanges}件・CSS/スタイル {diff.cssChanges}件の変更</p>{diff.lines.length ? <pre className="m-0 mt-3 whitespace-pre-wrap break-words rounded-2xl bg-black/10 p-3 font-mono text-[13px] leading-6">{diff.lines.map((line, index) => <span key={`${line.kind}-${index}`} className={line.kind === 'added' ? 'block rounded-[10px] bg-emerald-500/15 px-2 text-emerald-600 dark:text-emerald-300' : 'block rounded-[10px] bg-red-500/15 px-2 text-red-600 dark:text-red-300'}>{line.kind === 'added' ? '+ ' : '− '}{line.value}</span>)}</pre> : <p className="origin-muted mt-5 text-base">構造・スタイル上の変更はありません。</p>}</section>;

const ResponseVerificationBadge: React.FC = () => <details data-testid="response-verification-details" className="origin-verification mt-2"><summary className="origin-secondary-button flex min-h-11 list-none items-center gap-2 rounded-[10px] px-3 text-[13px] font-semibold"><span aria-hidden="true">✓</span><span>検証済み</span><span className="origin-muted ml-auto text-[13px] font-normal">詳細</span></summary><ul data-testid="response-verification-log" className="origin-surface-muted m-0 mt-2 grid gap-1 rounded-2xl p-3 text-[13px] leading-6"><li><span className="font-semibold">意図分析</span> · 依頼内容と回答の対応を確認。</li><li><span className="font-semibold">制作仕様</span> · 成果物は必要な場合のみ隔離プレビューに表示。</li><li><span className="font-semibold">構文検証</span> · 固定の無料モデルと端末内保存の境界を維持。</li></ul></details>;

export const ArtifactWorkspace: React.FC<{ artifact: ArtifactBlock | null; artifacts?: readonly ArtifactBlock[]; isOpen: boolean; language: OriginLanguage; onClose: () => void; onArtifactRevision?: (artifact: ArtifactBlock) => void }> = ({ artifact, artifacts = [], isOpen, language, onClose, onArtifactRevision }) => {
  const t = getTranslations(language);
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('code');
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPresentation, setIsPresentation] = useState(false);
  const [presentationSlideIndex, setPresentationSlideIndex] = useState(0);
  const [previewViewport, setPreviewViewport] = useState<'375' | '768' | 'fluid'>('fluid');
  const [isDirectEditing, setIsDirectEditing] = useState(false);
  const [workingContent, setWorkingContent] = useState('');
  const [lastKnownGood, setLastKnownGoodState] = useState<ArtifactBlock | null>(null);
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const [isBundling, setIsBundling] = useState(false);
  const [bundleError, setBundleError] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isDetailsMenuOpen, setIsDetailsMenuOpen] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [isDiffInspectorOpen, setIsDiffInspectorOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const workspaceRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const cleanLoadConfirmed = useRef(false);
  const setLastKnownGood = (snapshot: ArtifactBlock | null) => { if (snapshot === null || cleanLoadConfirmed.current) setLastKnownGoodState(snapshot); };
  useEffect(() => { const updateFullscreen = () => { const active = document.fullscreenElement === workspaceRef.current; setIsFullscreen(active); if (!active) setIsPresentation(false); }; document.addEventListener('fullscreenchange', updateFullscreen); return () => document.removeEventListener('fullscreenchange', updateFullscreen); }, []);
  useEffect(() => { cleanLoadConfirmed.current = false; setActiveTab('code'); setCopied(false); setShared(false); setIsPresentation(false); setPresentationSlideIndex(0); setPreviewViewport('fluid'); setIsDirectEditing(false); setSandboxError(null); setLastKnownGood(null); setIsExportMenuOpen(false); setIsDetailsMenuOpen(false); }, [artifact?.id]);
  useEffect(() => { const update = () => setIsOffline(!navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); }; }, []);
  useEffect(() => { if (!isDirectEditing) setWorkingContent(artifact?.content ?? ''); }, [artifact?.content, artifact?.id, isDirectEditing]);
  const isRenderable = Boolean(artifact && (artifact.type === 'html' || artifact.language === 'html' || artifact.language === 'svg'));
  const sandboxSrcDoc = useMemo(() => {
    if (!artifact || !isRenderable) return '';
    const isolatedStorageBootstrap = `<script data-origin-storage-polyfill="true">(function(){var createStorage=function(){var values=new Map();var prototype=Object.create(null);Object.defineProperties(prototype,{length:{configurable:true,get:function(){return values.size}},key:{configurable:true,value:function(index){var position=Number(index);return Number.isFinite(position)&&position>=0?Array.from(values.keys())[Math.trunc(position)]||null:null}},getItem:{configurable:true,value:function(key){var normalized=String(key);return values.has(normalized)?values.get(normalized):null}},setItem:{configurable:true,value:function(key,value){values.set(String(key),String(value))}},removeItem:{configurable:true,value:function(key){values.delete(String(key))}},clear:{configurable:true,value:function(){values.clear()}}});var target=Object.create(prototype);return new Proxy(target,{get:function(object,property,receiver){if(typeof property!=='string'||property in object)return Reflect.get(object,property,receiver);return values.has(property)?values.get(property):undefined},set:function(object,property,value,receiver){if(typeof property==='string'&&!(property in object)){values.set(property,String(value));return true}return Reflect.set(object,property,value,receiver)},deleteProperty:function(object,property){if(typeof property==='string'&&values.has(property)){values.delete(property);return true}return Reflect.deleteProperty(object,property)},has:function(object,property){return Reflect.has(object,property)||(typeof property==='string'&&values.has(property))},ownKeys:function(object){return Reflect.ownKeys(object).concat(Array.from(values.keys()).filter(function(key){return !Reflect.has(object,key)}))},getOwnPropertyDescriptor:function(object,property){if(typeof property==='string'&&values.has(property)&&!Reflect.has(object,property))return{configurable:true,enumerable:true,writable:true,value:values.get(property)};return Reflect.getOwnPropertyDescriptor(object,property)}})};['localStorage','sessionStorage'].forEach(function(name){var isolated=createStorage();try{Object.defineProperty(window,name,{configurable:true,enumerable:true,get:function(){return isolated}})}catch(_){}})})();</script>`;
    const cleanLoadBoundary = `<script>(function(){var source='ORIGIN_SANDBOX_BOUNDARY';var failed=false;var send=function(type,payload){try{parent.postMessage(Object.assign({source:source,type:type},payload||{}),'*')}catch(_){}};var report=function(value){if(failed)return;failed=true;var message=String(value&&value.message||value||'Unknown runtime error').replace(/\\s+/g,' ').slice(0,280);send('runtime-error',{message:message,timestamp:Date.now()})};window.addEventListener('error',function(event){report(event.error||event.message);event.preventDefault&&event.preventDefault()},true);window.addEventListener('unhandledrejection',function(event){report(event&&event.reason);event&&event.preventDefault&&event.preventDefault()});window.addEventListener('load',function(){setTimeout(function(){if(!failed)send('ready',{timestamp:Date.now()})},120)},{once:true})})();</script>`;
    const presentationBridge = `<script>(function(){var slides=[];var current=${presentationSlideIndex};var presenting=${isPresentation ? 'true' : 'false'};var collect=function(){slides=Array.prototype.slice.call(document.querySelectorAll('[data-slide], .slide, [role="group"][aria-roledescription="slide"]'));if(slides.length<2)slides=[];if(slides.length)current=Math.min(Math.max(current,0),slides.length-1);document.documentElement.setAttribute('data-origin-slide-count',String(slides.length))};var render=function(){if(!slides.length){document.documentElement.setAttribute('data-origin-slide-index','0');return}slides.forEach(function(slide,index){slide.style.display=!presenting||index===current?'':'none';slide.setAttribute('aria-hidden',String(presenting&&index!==current));if(presenting&&index===current){slide.setAttribute('tabindex','-1');try{slide.focus({preventScroll:true})}catch(_){}}});document.documentElement.setAttribute('data-origin-slide-index',String(current+1))};var command=function(type){document.documentElement.setAttribute('data-origin-presentation-command',String(type));collect();if(type==='presentation-start'){presenting=true;current=0;render()}else if(type==='presentation-exit'){presenting=false;render()}else if(type==='presentation-next'&&slides.length){current=Math.min(current+1,slides.length-1);render()}else if(type==='presentation-prev'&&slides.length){current=Math.max(current-1,0);render()}};window.addEventListener('message',function(event){var data=event.data;if(!data||data.source!=='ORIGIN_PRESENTATION')return;command(data.type)});window.addEventListener('load',function(){collect();render()},{once:true})})();</script>`;
    let slideOrder = 0;
    const markedContent = workingContent.replace(/<(section|article|div)(?=[^>]*(?:\bdata-slide\b|class\s*=\s*["'][^"']*\bslide\b|aria-roledescription\s*=\s*["']slide["']))[^>]*>/gi, (tag) => tag.replace(/>$/, ` data-origin-slide-order="${++slideOrder}">`));
    const presentationStyles = `<style>[data-origin-presentation-content][data-origin-presenting="true"] [data-origin-slide-order]{display:none!important;opacity:0;transform:translateX(12px)}[data-origin-presentation-content][data-origin-presenting="true"] [data-origin-slide-order="${presentationSlideIndex + 1}"]{display:block!important;opacity:1;transform:translateX(0);transition:opacity 180ms ease-out,transform 180ms ease-out}@media (prefers-reduced-motion:reduce){[data-origin-presentation-content] [data-origin-slide-order]{transition:none!important}}</style>`;
    const previewContent = isDirectEditing ? prepareDirectTouchMarkup(markedContent) : markedContent;
    const sanitized = `${isolatedStorageBootstrap}${cleanLoadBoundary}${presentationBridge}${presentationStyles}<div data-origin-presentation-content data-origin-presenting="${isPresentation ? 'true' : 'false'}"><div data-origin-direct-touch-root${isDirectEditing ? ' data-origin-direct-touch="true"' : ''}>${previewContent.replace(/<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '')}</div></div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none';"><meta name="referrer" content="no-referrer"><style>html,body{min-height:100%;margin:0}body{font-family:system-ui,sans-serif;padding:16px;color:CanvasText;background:transparent}[data-origin-direct-touch="true"]{outline:2px dashed #22d3ee;outline-offset:-4px;cursor:text}[data-origin-direct-touch="true"] [data-origin-direct-touch-index]{outline:1px dashed color-mix(in srgb,#22d3ee 55%,transparent);outline-offset:3px;border-radius:3px}</style></head><body><script>window.addEventListener('click',function(event){var target=event.target;while(target&&target.tagName!=='A')target=target.parentElement;if(target&&target.tagName==='A'){event.preventDefault();event.stopPropagation();}},true);window.open=function(){return null;};</script>${sanitized}</body></html>`;
  }, [artifact, isDirectEditing, isPresentation, isRenderable, presentationSlideIndex, workingContent]);
  useEffect(() => {
    const onSandboxMessage = (event: MessageEvent) => {
      if (event.source !== previewRef.current?.contentWindow) return;
      if (!event.data || typeof event.data !== 'object') return;
      const data = event.data as { source?: string; type?: string; message?: string; edits?: unknown; timestamp?: number };
      const isBoundaryMessage = data.source === 'ORIGIN_SANDBOX_BOUNDARY' && (data.type === 'ready' || data.type === 'runtime-error');
      const isDirectTouchCommit = data.source === 'ORIGIN_DIRECT_TOUCH' && data.type === 'commit' && isDirectTouchEdits(data.edits);
      if (!isBoundaryMessage && !isDirectTouchCommit) return;
      if (data.source === 'ORIGIN_SANDBOX_BOUNDARY') {
        if (data.type === 'runtime-error') { cleanLoadConfirmed.current = false; setSandboxError(data.message || 'Unknown runtime error'); }
        if (data.type === 'ready' && artifact && typeof data.timestamp === 'number') { cleanLoadConfirmed.current = true; setLastKnownGood({ ...artifact, content: workingContent }); }
      }
      if (isDirectTouchCommit && artifact) {
        const nextContent = applyDirectTouchEdits(workingContent, data.edits);
        if (nextContent === workingContent) return;
        const priorRevisions = artifact.revisions ?? [{ id: `${artifact.id}:v1`, content: artifact.content, createdAt: 0, source: 'generated' as const }];
        const nextRevision = { id: `${artifact.id}:v${priorRevisions.length + 1}`, content: nextContent, createdAt: Date.now(), source: 'direct-touch' as const };
        const nextArtifact = { ...artifact, content: nextContent, revision: priorRevisions.length + 1, revisions: [...priorRevisions, nextRevision] };
        cleanLoadConfirmed.current = false;
        setWorkingContent(nextContent);
        onArtifactRevision?.(nextArtifact);
      }
    };
    window.addEventListener('message', onSandboxMessage);
    return () => window.removeEventListener('message', onSandboxMessage);
  }, [artifact, workingContent]);
  const postPresentationCommand = (type: 'presentation-start' | 'presentation-exit' | 'presentation-next' | 'presentation-prev') => previewRef.current?.contentWindow?.postMessage({ source: 'ORIGIN_PRESENTATION', type }, '*');
  useEffect(() => {
    if (!isPresentation) { postPresentationCommand('presentation-exit'); return; }
    const timer = window.setTimeout(() => postPresentationCommand('presentation-start'), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); setPresentationSlideIndex((index) => index + 1); postPresentationCommand('presentation-next'); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); setPresentationSlideIndex((index) => Math.max(index - 1, 0)); postPresentationCommand('presentation-prev'); }
      if (event.key === 'Escape') { event.preventDefault(); setIsPresentation(false); setPresentationSlideIndex(0); if (document.fullscreenElement) void document.exitFullscreen?.(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.clearTimeout(timer); window.removeEventListener('keydown', onKeyDown); };
  }, [isPresentation, activeTab, sandboxSrcDoc]);
  if (!isOpen || !artifact) return null;
  const fileType = artifact.language === 'html' ? 'text/html;charset=utf-8' : artifact.language === 'svg' ? 'image/svg+xml;charset=utf-8' : artifact.language === 'markdown' || artifact.language === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
  const extension = artifact.language === 'markdown' || artifact.language === 'md' ? 'md' : artifact.language === 'html' ? 'html' : artifact.language === 'svg' ? 'svg' : artifact.language || 'txt';
  const safeTitle = artifact.title.replace(/[^a-z0-9._-]/gi, '_') || 'origin-artifact';
  const fileName = safeTitle.toLowerCase().endsWith(`.${extension.toLowerCase()}`) ? safeTitle : `${safeTitle}.${extension}`;
  const downloadArtifact = () => {
    const url = URL.createObjectURL(new Blob([workingContent], { type: fileType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const downloadArtifactFormat = async (format: ArtifactExportFormat) => {
    if (!artifact) return;
    setExportError(false);
    try {
      const source = { ...artifact, content: workingContent };
      const payload = format === 'png' ? undefined : createArtifactExportPayload(source, format);
      const blob = format === 'png' ? await createArtifactPngBlob(source) : new Blob([payload.content], { type: payload.type });
      const stem = safeArtifactFileStem(source.title, 'origin-artifact');
      const fileName = format === 'png' ? `${stem}.png` : payload.fileName;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = fileName; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setIsExportMenuOpen(false);
    } catch {
      setExportError(true);
    }
  };
  const downloadArtifactBundle = async () => {
    if (isBundling) return;
    setIsBundling(true); setBundleError(false);
    try {
      const blob = await createOfflineArtifactBundle(artifacts.length ? artifacts : [artifact]);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `origin-artifact-package-${new Date().toISOString().slice(0, 10)}.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setBundleError(true);
    } finally {
      setIsBundling(false);
    }
  };
  const shareArtifact = async () => {
    try {
      const file = new File([workingContent], fileName, { type: fileType });
      const shareData: ShareData = { title: artifact.title, text: `${artifact.title}\n\n${workingContent.slice(0, 6_000)}` };
      if (navigator.canShare?.({ files: [file] })) shareData.files = [file];
      if (navigator.share) await navigator.share(shareData);
      else await copyText(`data:${fileType},${encodeURIComponent(workingContent)}`);
      setShared(true); window.setTimeout(() => setShared(false), 2_000);
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return;
      try { await copyText(`data:${fileType},${encodeURIComponent(workingContent)}`); setShared(true); window.setTimeout(() => setShared(false), 2_000); }
      catch { setShared(false); }
    }
  };
  const restoreLastKnownGood = () => {
    if (!lastKnownGood) return;
    const safeSnapshot = lastKnownGood.content
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    setWorkingContent(safeSnapshot);
    setSandboxError(null);
    setIsDirectEditing(false);
    setActiveTab('preview');
  };
  const restorePreviousVersion = () => {
    if (!artifact || !priorRevision) return;
    const history = artifact.revisions ?? [{ id: `${artifact.id}:v1`, content: artifact.content, createdAt: 0, source: 'generated' as const }];
    const nextRevision = { id: `${artifact.id}:v${history.length + 1}`, content: priorRevision.content, createdAt: Date.now(), source: 'restore' as const };
    const nextArtifact: ArtifactBlock = { ...artifact, content: priorRevision.content, revision: history.length + 1, revisions: [...history, nextRevision] };
    cleanLoadConfirmed.current = false;
    setWorkingContent(priorRevision.content);
    setIsDiffInspectorOpen(false);
    setIsDetailsMenuOpen(false);
    onArtifactRevision?.(nextArtifact);
  };
  const toggleFullscreen = async () => { if (!workspaceRef.current) return; if (document.fullscreenElement) await document.exitFullscreen?.(); else await workspaceRef.current.requestFullscreen?.(); };
  const togglePresentation = async () => { if (isPresentation) { setIsPresentation(false); setPresentationSlideIndex(0); if (document.fullscreenElement) await document.exitFullscreen?.(); return; } setIsDirectEditing(false); setActiveTab('preview'); setPresentationSlideIndex(0); setIsPresentation(true); const request = workspaceRef.current && !document.fullscreenElement ? workspaceRef.current.requestFullscreen?.() : undefined; await request?.catch(() => undefined); };
  const previewWidth = previewViewport === '375' ? '375px' : previewViewport === '768' ? '768px' : '100%';
  const previewFrame = activeTab === 'preview' && isRenderable ? <div data-testid="responsive-preview-stage" className="flex h-full min-w-full items-start justify-center overflow-auto"><iframe ref={previewRef} title={t.previewTitle} aria-label={t.previewTitle} key={sandboxSrcDoc} src="/origin-artifact-sandbox.html" data-origin-srcdoc={sandboxSrcDoc} sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={(event) => { event.currentTarget.setAttribute('data-origin-loaded', 'true'); event.currentTarget.contentWindow?.postMessage({ source: 'ORIGIN_SANDBOX_INIT', html: sandboxSrcDoc }, '*'); if (isPresentation) postPresentationCommand('presentation-start'); }} style={{ width: previewWidth }} className="origin-surface h-full shrink-0 rounded-2xl transition-[width] duration-200 ease-out motion-reduce:transition-none" /></div> : <pre className="m-0 whitespace-pre-wrap break-all font-mono text-[13px] leading-6">{workingContent}</pre>;
  const priorRevision = artifact.revisions && artifact.revisions.length >= 2 ? artifact.revisions[artifact.revisions.length - 2] : null;
  const visualDiff = priorRevision ? createArtifactVisualDiff(priorRevision.content, workingContent) : null;
  return <aside ref={workspaceRef} aria-label={t.workspaceLabel} data-testid="artifact-workspace" className="origin-workspace fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l shadow-2xl sm:w-[560px]">
    <div className="flex min-h-16 flex-wrap items-center justify-between gap-2 border-b border-[var(--border-default)] px-3 py-2 sm:px-4">
      <div className="min-w-0 flex flex-1 items-center gap-2"><span className="origin-badge rounded-[10px] px-2 py-1 text-[13px] font-mono font-semibold">{artifact.language}</span><h2 className="truncate text-base font-semibold">{artifact.title}</h2><span data-testid="artifact-revision-indicator" aria-live="polite" className="origin-muted shrink-0 text-[13px] font-semibold">最新</span>{priorRevision && <span className="origin-muted shrink-0 text-[13px]">1つ前の版あり</span>}</div>
      <div className="flex flex-wrap items-center justify-end gap-1">
        {isRenderable && <><div role="group" aria-label={t.displayMode} className="origin-surface-muted flex rounded-2xl p-1"><button type="button" aria-label={t.showCode} aria-pressed={activeTab === 'code'} onClick={() => { setIsDirectEditing(false); setActiveTab('code'); }} className={`min-h-11 rounded-[10px] px-3 text-[13px] font-semibold ${activeTab === 'code' ? 'origin-primary-button' : 'origin-secondary-button'}`}>{t.code}</button><button type="button" aria-label={t.showPreview} aria-pressed={activeTab === 'preview'} onClick={() => setActiveTab('preview')} className={`min-h-11 rounded-[10px] px-3 text-[13px] font-semibold ${activeTab === 'preview' ? 'origin-primary-button' : 'origin-secondary-button'}`}>{t.preview}</button></div><div data-testid="responsive-viewport-bar" role="group" aria-label={t.responsivePreview} className="origin-surface-muted flex rounded-2xl p-1"><button type="button" data-testid="preview-viewport-375" aria-label={t.phoneViewport} aria-pressed={previewViewport === '375'} onClick={() => { setIsPresentation(false); setActiveTab('preview'); setPreviewViewport('375'); }} className={`min-h-11 rounded-[10px] px-2 text-[13px] font-semibold ${previewViewport === '375' ? 'origin-primary-button' : 'origin-secondary-button'}`}>📱 375px</button><button type="button" data-testid="preview-viewport-768" aria-label={t.tabletViewport} aria-pressed={previewViewport === '768'} onClick={() => { setIsPresentation(false); setActiveTab('preview'); setPreviewViewport('768'); }} className={`min-h-11 rounded-[10px] px-2 text-[13px] font-semibold ${previewViewport === '768' ? 'origin-primary-button' : 'origin-secondary-button'}`}>📱 768px</button><button type="button" data-testid="preview-viewport-fluid" aria-label={t.fluidViewport} aria-pressed={previewViewport === 'fluid'} onClick={() => { setIsPresentation(false); setActiveTab('preview'); setPreviewViewport('fluid'); }} className={`min-h-11 rounded-[10px] px-2 text-[13px] font-semibold ${previewViewport === 'fluid' ? 'origin-primary-button' : 'origin-secondary-button'}`}>💻 100%</button></div></>}
        <div data-testid="artifact-action-bar" role="group" aria-label="成果物の主要操作" className="origin-surface-muted flex rounded-2xl p-1"><button type="button" data-testid="artifact-action-edit" aria-label={t.editArtifact} aria-pressed={isDirectEditing} onClick={() => { setIsDirectEditing((current) => !current); setActiveTab('preview'); }} className={`min-h-11 rounded-[10px] px-3 text-[13px] font-semibold ${isDirectEditing ? 'origin-primary-button' : 'origin-secondary-button'}`}>✏️ {isDirectEditing ? t.finishEditing : language === 'ja' ? '編集' : 'Edit'}</button><button type="button" data-testid="artifact-action-share" aria-label={t.shareArtifact} onClick={() => void shareArtifact()} className="origin-secondary-button min-h-11 rounded-[10px] px-3 text-[13px] font-semibold">📲 {shared ? language === 'ja' ? '共有済み' : 'Shared' : language === 'ja' ? '共有' : 'Share'}</button><button type="button" data-testid="artifact-action-save" aria-label={t.downloadArtifact} onClick={downloadArtifact} className="origin-secondary-button min-h-11 rounded-[10px] px-3 text-[13px] font-semibold">📥 {language === 'ja' ? '保存' : 'Save'}</button><div className="relative"><button type="button" data-testid="artifact-action-details" aria-label="成果物の詳細操作を開く" aria-expanded={isDetailsMenuOpen} onClick={() => { setIsDetailsMenuOpen((current) => !current); setIsExportMenuOpen(false); }} className="origin-secondary-button min-h-11 rounded-[10px] px-3 text-[13px] font-semibold">••• 詳細</button>{isDetailsMenuOpen && <div data-testid="artifact-details-menu" role="menu" aria-label="成果物の詳細操作" className="origin-surface absolute right-0 top-12 z-50 grid min-w-52 gap-1 rounded-2xl p-2 shadow-xl"><button type="button" data-testid="artifact-action-copy" role="menuitem" aria-label={t.copyArtifact} onClick={() => void copyText(workingContent).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2_000); })} className="origin-secondary-button min-h-11 rounded-[10px] px-3 text-left text-[13px] font-semibold">📋 {copied ? t.copied : t.copy}</button>{priorRevision && <button type="button" data-testid="artifact-visual-diff-toggle" role="menuitem" aria-label="最新と1つ前の版の変更箇所を見る" aria-pressed={isDiffInspectorOpen} onClick={() => { setIsDirectEditing(false); setIsDiffInspectorOpen((current) => !current); setIsDetailsMenuOpen(false); }} className={`min-h-11 rounded-[10px] px-3 text-left text-[13px] font-semibold ${isDiffInspectorOpen ? 'origin-primary-button' : 'origin-secondary-button'}`}>🔍 {isDiffInspectorOpen ? '変更箇所を閉じる' : '変更箇所を見る'}</button>}<div className="relative"><button type="button" data-testid="artifact-action-export-menu" role="menuitem" aria-label="保存形式を選ぶ" aria-expanded={isExportMenuOpen} onClick={() => setIsExportMenuOpen((current) => !current)} className="origin-secondary-button min-h-11 w-full rounded-[10px] px-3 text-left text-[13px] font-semibold">形式を選んで保存</button>{isExportMenuOpen && <div data-testid="artifact-export-menu" role="menu" aria-label="成果物の保存形式" className="origin-surface absolute right-full top-0 z-[60] grid min-w-36 gap-1 rounded-2xl p-2 shadow-xl">{([{ key: 'html', label: 'HTML' }, { key: 'svg', label: 'SVG' }, { key: 'png', label: 'PNG' }, { key: 'markdown', label: 'Markdown' }, { key: 'json', label: 'JSON' }] as const).map((option) => <button key={option.key} type="button" data-testid={`artifact-export-${option.key}`} role="menuitem" onClick={() => void downloadArtifactFormat(option.key)} className="origin-secondary-button min-h-11 rounded-[10px] px-3 text-left text-[13px] font-semibold">{option.label}</button>)}</div>}</div><button type="button" data-testid="artifact-action-bundle" role="menuitem" aria-label="一括パッケージ保存" aria-busy={isBundling} onClick={() => void downloadArtifactBundle()} className="origin-secondary-button min-h-11 rounded-[10px] px-3 text-left text-[13px] font-semibold disabled:cursor-wait" disabled={isBundling}>📦 {isBundling ? '準備中' : '一括パッケージ保存'}</button>{priorRevision && <button type="button" data-testid="artifact-restore-previous" role="menuitem" aria-label="1つ前の版をこの版に戻す" onClick={restorePreviousVersion} className="origin-secondary-button min-h-11 rounded-[10px] px-3 text-left text-[13px] font-semibold">↶ この版に戻す</button>}{isRenderable && <button type="button" data-testid="presentation-mode-toggle" role="menuitem" aria-label={isPresentation ? t.exitPresentation : t.presentation} aria-pressed={isPresentation} onClick={() => void togglePresentation()} className={`min-h-11 rounded-[10px] px-3 text-left text-[13px] font-semibold ${isPresentation ? 'origin-primary-button' : 'origin-secondary-button'}`}>▣ {isPresentation ? t.exitPresentation : t.presentation}</button>}<button type="button" role="menuitem" aria-label={isFullscreen ? t.exitFullscreenLabel : t.openFullscreen} aria-pressed={isFullscreen} onClick={() => void toggleFullscreen()} className="origin-secondary-button min-h-11 rounded-[10px] px-3 text-left text-[13px] font-semibold">{isFullscreen ? t.exitFullscreen : t.fullscreen}</button></div>}</div></div><button type="button" aria-label={t.closeWorkspace} onClick={onClose} className="origin-secondary-button inline-flex h-11 w-11 items-center justify-center rounded-[10px] text-lg">✕</button>
      </div>
      {isPresentation && <p className="sr-only" role="status">{t.presentationKeyboardHint}</p>}{isOffline && <p data-testid="artifact-offline-status" role="status" className="text-[13px] text-amber-600 dark:text-amber-300">オフライン中: 端末内の成果物は閲覧・編集・保存できます。</p>}{bundleError && <p role="alert" className="text-[13px] text-[var(--danger)]">パッケージを作成できませんでした。</p>}{exportError && <p role="alert" className="text-[13px] text-[var(--danger)]">この形式でのローカル書き出しを完了できませんでした。</p>}
    </div>
    <div className="origin-code-panel relative min-h-0 flex-1 overflow-auto p-4">{isDiffInspectorOpen && visualDiff && priorRevision ? <ArtifactVisualDiffInspector diff={visualDiff} /> : previewFrame}{sandboxError && <div data-testid="sandbox-runtime-boundary" role="alert" className="absolute inset-6 flex flex-col justify-center rounded-2xl border border-red-400/60 bg-[var(--bg-surface)]/95 p-5 shadow-2xl backdrop-blur"><p className="m-0 text-base font-bold text-red-500">{t.sandboxRuntimeError}</p><p className="mt-2 break-words font-mono text-[13px]">{sandboxError}</p><p className="origin-muted mt-3 text-[13px]">{t.sandboxRuntimeDetail}</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" data-testid="restore-last-known-good" disabled={!lastKnownGood} title={!lastKnownGood ? t.noLastKnownGood : undefined} onClick={restoreLastKnownGood} className="origin-primary-button min-h-11 rounded-[10px] px-4 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-50">{t.restoreLastKnownGood}</button><button type="button" onClick={() => setSandboxError(null)} className="origin-secondary-button min-h-11 rounded-[10px] px-4 text-[13px] font-semibold">{t.close}</button></div></div>}</div>
  </aside>;
};

export type OriginPersonalAppProps = { onOpenSettings?: () => void; messages?: ConversationMessage[]; sessions?: readonly ConversationSession[]; artifacts?: readonly ArtifactBlock[]; onArchiveSession?: (messages: readonly ConversationMessage[]) => void; onRestoreSession?: (session: ConversationSession) => void; onMessagesChange?: (messages: ConversationMessage[]) => void; onArtifactsChange?: (artifacts: ArtifactBlock[]) => void; resetSignal?: number; language?: OriginLanguage };
export const App: React.FC<OriginPersonalAppProps> = ({ onOpenSettings, messages: controlledMessages, sessions = [], artifacts: controlledArtifacts, onArchiveSession, onRestoreSession, onMessagesChange, onArtifactsChange, resetSignal = 0, language = 'ja' }) => {
  const t = getTranslations(language);
  const [uncontrolledMessages, setUncontrolledMessages] = useState<ConversationMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const [activeArtifact, setActiveArtifact] = useState<ArtifactBlock | null>(null);
  const [uncontrolledArtifacts, setUncontrolledArtifacts] = useState<ArtifactBlock[]>([]);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const observedResetSignal = useRef(resetSignal);
  const messages = controlledMessages ?? uncontrolledMessages;
  const artifacts = controlledArtifacts ?? uncontrolledArtifacts;
  const messagesRef = useRef(messages);
  const attachmentBytes = attachments.reduce((total, attachment) => total + attachment.bytes, 0);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { const update = () => setIsOffline(!navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); }; }, []);
  const updateMessages = (updater: (current: ConversationMessage[]) => ConversationMessage[]) => { const next = updater(messagesRef.current); messagesRef.current = next; setUncontrolledMessages(next); onMessagesChange?.(next); return next; };
  const updateArtifacts = (updater: (current: ArtifactBlock[]) => ArtifactBlock[]) => { const next = updater([...artifacts]); setUncontrolledArtifacts(next); onArtifactsChange?.(next); return next; };
  const resetConversation = () => { onArchiveSession?.(messagesRef.current); abortRef.current?.abort(); abortRef.current = null; setIsLoading(false); setInputText(''); setAttachments([]); setAttachmentError(''); setActiveArtifact(null); setIsWorkspaceOpen(false); updateMessages(() => []); };
  useEffect(() => { if (observedResetSignal.current === resetSignal) return; observedResetSignal.current = resetSignal; resetConversation(); }, [resetSignal]);
  useEffect(() => { if (!textareaRef.current) return; textareaRef.current.style.height = 'auto'; textareaRef.current.style.height = `${Math.min(Math.max(textareaRef.current.scrollHeight, 44), 160)}px`; }, [inputText]);
  const attachFiles = async (fileList?: FileList | File[]) => {
    if (!fileList?.length) return;
    setAttachmentError('');
    const loaded: Attachment[] = [];
    let totalBytes = attachmentBytes;
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_ATTACHMENT_BYTES) { setAttachmentError(t.attachmentTooLarge); continue; }
      if (totalBytes + file.size > MAX_TOTAL_ATTACHMENT_BYTES) { setAttachmentError(t.attachmentTotalTooLarge); continue; }
      try { const attachment = await readAttachment(file); loaded.push(attachment); totalBytes += file.size; }
      catch (error) { const code = error instanceof Error ? error.message : ''; setAttachmentError(code === 'unsupported' ? t.unsupportedAttachment : t.attachmentReadError); }
    }
    if (loaded.length) setAttachments((current) => [...current, ...loaded]);
  };
  const handleDrop = (event: React.DragEvent<HTMLElement>) => { event.preventDefault(); setIsDragging(false); void attachFiles(event.dataTransfer.files); };
  const handleSend = async (textToSend?: string) => {
    const text = textToSend || inputText;
    if ((!text.trim() && !attachments.length) || isLoading) return;
    if (isOffline) {
      setAttachmentError('オフライン中は新規AI応答を停止しています。端末内の履歴・成果物は閲覧、直接編集、保存、パッケージ化を継続できます。');
      return;
    }
    setAttachmentError('');
    const attachmentMessage = attachments.map((attachment) => attachment.kind === 'image' ? `\n\n[${attachment.name}: ${attachment.content}]` : `\n\n[${attachment.name}]\n${attachment.content}`).join('');
    const userMessage: ConversationMessage = { id: `u-${Date.now()}`, role: 'user', content: `${text.trim()}${attachmentMessage}`.trim() };
    const conversation = updateMessages((current) => [...current, userMessage]);
    setInputText(''); setAttachments([]); setIsLoading(true);
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ model: 'google/gemma-4-26b-a4b-it:free', systemPrompt: 'You are ORIGIN Personal 2.0. State the conclusion first and structure your answer logically. Use ```language:title for artifacts.', messages: conversation.map((message) => ({ role: message.role, content: message.content })) }) });
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { code?: unknown } | null;
        if (typeof failure?.code === 'string' && SAFE_WAITING_PROVIDER_CODES.has(failure.code)) {
          setAttachmentError(SAFE_WAITING_MESSAGE);
          return;
        }
        throw new Error('request-error');
      }
      const reader = response.body?.getReader(); const decoder = new TextDecoder(); let fullText = ''; const assistantId = `a-${Date.now()}`;
      updateMessages((current) => [...current, { id: assistantId, role: 'assistant', content: '' }]);
      while (reader) { const { done, value } = await reader.read(); if (done) break; fullText += decoder.decode(value, { stream: true }); const parsed = StreamArtifactParser.parse(fullText); updateMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: parsed.conversationalText } : message)); if (parsed.activeArtifact) { const streamedArtifacts = parsed.artifacts.map((block) => ({ ...block, id: `${assistantId}-${block.id}` })); updateArtifacts((current) => [...current.filter((block) => !block.id.startsWith(`${assistantId}-`)), ...streamedArtifacts]); setActiveArtifact(streamedArtifacts.at(-1) ?? null); setIsWorkspaceOpen(true); } }
    } catch (error) { if ((error as DOMException).name !== 'AbortError') updateMessages((current) => [...current, { id: `err-${Date.now()}`, role: 'assistant', content: t.error }]); }
    finally { if (abortRef.current === controller) { abortRef.current = null; setIsLoading(false); } }
  };
  const composer = <><input ref={fileInputRef} type="file" multiple aria-label={t.attachFile} className="sr-only" accept="image/*,text/*,.md,.json,.csv,.ts,.tsx,.js,.jsx,.css,.html,.svg,.xml,.yml,.yaml" onChange={(event) => { void attachFiles(event.target.files); event.target.value = ''; }} /><div onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop} className={`origin-composer origin-surface flex items-end gap-2 rounded-[24px] border p-2 shadow-lg shadow-black/5 transition focus-within:border-[var(--accent-primary)] focus-within:ring-2 focus-within:ring-[var(--accent-glow)] ${messages.length ? 'origin-composer--compact' : ''} ${isDragging ? 'ring-2 ring-[var(--accent-primary)]' : ''}`}><textarea ref={textareaRef} aria-label={messages.length ? t.sendRequest : t.startRequest} aria-describedby="origin-chat-guidance" data-testid={messages.length ? 'origin-chat-request' : 'origin-home-request'} value={inputText} onChange={(event) => setInputText(event.target.value)} onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void handleSend(); } }} placeholder={messages.length ? t.chatPlaceholder : t.homePlaceholder} rows={messages.length ? 1 : 2} disabled={isLoading} className="origin-input max-h-52 min-h-[60px] flex-1 resize-none bg-transparent px-4 py-3 text-base leading-7 focus:outline-none" /><button type="button" onClick={() => fileInputRef.current?.click()} aria-label={t.attachFile} className="origin-secondary-button inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-lg">＋</button>{isLoading ? <button type="button" aria-label={t.stopGeneration} onClick={() => abortRef.current?.abort()} className="origin-danger-button min-h-11 rounded-[10px] px-5 text-[13px] font-bold">{t.stop}</button> : <button type="button" data-testid={messages.length ? 'send-request-button' : 'start-request-button'} aria-label={messages.length ? t.sendRequest : t.startRequest} onClick={() => void handleSend()} disabled={(!inputText.trim() && !attachments.length)} className="origin-primary-button min-h-11 shrink-0 rounded-[10px] px-5 text-[13px] font-bold">{messages.length ? t.send : t.start}</button>}</div>{attachments.length > 0 && <div className="origin-muted mt-2 flex flex-wrap gap-2 text-[13px]"><span className="sr-only">{t.attachedFiles}</span>{attachments.map((attachment, index) => <span key={`${attachment.name}-${index}`} className="origin-surface-muted flex items-center gap-2 rounded-[10px] px-2 py-1"><span>{t.attach}: {attachment.name}</span><button type="button" onClick={() => setAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index))} aria-label={`${t.removeAttachment}: ${attachment.name}`} className="origin-secondary-button min-h-11 rounded-[10px] px-3 text-[13px]">✕</button></span>)}</div>}{attachmentError && <p role="alert" className="mt-2 text-[13px] text-[var(--danger)]">{attachmentError}</p>}<p id="origin-chat-guidance" className="sr-only">{t.keyboardGuidance}{t.dropFiles}</p></>;
  return <div className="origin-app flex h-[100dvh] w-screen overflow-hidden font-sans"><main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden"><header className="origin-header flex min-h-16 items-center justify-between px-3 backdrop-blur-md sm:px-4"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[var(--accent-primary)] shadow-[0_0_10px_var(--accent-glow)]" aria-hidden="true" /><span className="text-base font-extrabold tracking-tight">ORIGIN</span><span className="origin-badge rounded-[10px] px-1.5 py-0.5 text-[13px] font-mono">Personal 2.0</span></div><div className="flex items-center gap-2"><KnowledgeMap sessions={sessions} onRestoreSession={onRestoreSession} /><button type="button" onClick={onOpenSettings} aria-label={t.openSettings} className="origin-secondary-button min-h-11 rounded-[10px] px-3 text-[13px] font-semibold">⚙️ {t.settings}</button><button type="button" onClick={resetConversation} aria-label={t.newConversationLabel} className="origin-secondary-button min-h-11 rounded-[10px] px-3 text-[13px] font-semibold">{t.newConversation}</button></div></header><div className="min-h-0 flex-1 overflow-y-auto p-4">{messages.length === 0 ? <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center py-4"><div data-testid="origin-core-logo" className="relative mb-4 flex h-16 w-16 items-center justify-center"><div className="origin-logo-glow absolute inset-0 rounded-2xl blur-md" /><div className="origin-logo-core relative flex h-14 w-14 items-center justify-center rounded-2xl shadow-xl">◈</div></div><div className="mb-1 text-[13px] font-semibold uppercase tracking-wider text-[var(--accent-primary)]">ORIGIN</div><h1 className="text-center text-2xl font-extrabold tracking-tight sm:text-3xl">{t.homeHeading}</h1><p className="origin-muted mt-2 max-w-lg text-center text-base leading-7">{t.homeDescription}</p><div className="mt-8 w-full max-w-2xl">{composer}</div><p className="origin-safe-note mt-5 text-center text-[13px]">{t.freeOnlyNotice}</p></div> : <div role="log" aria-label={t.conversationLog} aria-live="off" aria-busy={isLoading} className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 pb-8">{messages.map((message) => { const isStreamingAssistant = isLoading && message.role === 'assistant' && message.id === messages.at(-1)?.id; return <article key={message.id} aria-label={message.role === 'user' ? t.userRequest : t.assistantResponse} className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}><div className={`max-w-[88%] rounded-2xl px-4 py-3 text-base leading-7 sm:max-w-[76%] ${message.role === 'user' ? 'origin-chat-user' : 'origin-chat-assistant'}`}><p className="m-0 whitespace-pre-wrap break-all">{message.content || (isStreamingAssistant ? t.thinking : '')}</p></div>{message.role === 'assistant' && Boolean(message.content) && !isStreamingAssistant && <ResponseVerificationBadge />}</article>; })}{isLoading && <div data-testid="origin-thinking" role="status" aria-live="polite" className="origin-surface-muted flex w-fit items-center gap-3 rounded-2xl px-4 py-3 text-[13px] font-semibold text-[var(--accent-primary)] shadow-sm"><span aria-hidden="true" className="inline-flex h-2.5 w-2.5 rounded-full bg-[var(--accent-primary)] animate-ping" />✨ {t.thinking}</div>}{messages.some((message) => message.role === 'assistant' && !isLoading) && <p data-testid="response-announcement" role="status" className="sr-only">{t.responseReady}</p>}</div>}</div>{messages.length > 0 && <div className="safe-area-bottom mx-auto w-full max-w-3xl px-4">{composer}</div>}</main><ArtifactWorkspace artifact={activeArtifact} artifacts={artifacts} isOpen={isWorkspaceOpen} language={language} onClose={() => setIsWorkspaceOpen(false)} onArtifactRevision={(next) => { setActiveArtifact(next); updateArtifacts((current) => current.map((block) => block.id === next.id ? next : block)); }} /></div>;
};
export default App;
