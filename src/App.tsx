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
export type ArtifactSyntaxIssue = { line: number; column: number; message: string };
export type ArtifactSyntaxResult = { valid: true; issue: null } | { valid: false; issue: ArtifactSyntaxIssue };
export type ArtifactVisualDiffLine = { kind: 'added' | 'removed' | 'context'; category: 'html' | 'css' | 'text'; value: string };
export type ArtifactVisualDiff = { lines: readonly ArtifactVisualDiffLine[]; added: number; removed: number; htmlChanges: number; cssChanges: number };

const VOID_HTML_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const OPTIONAL_HTML_TAGS = new Set(['li', 'p', 'dt', 'dd', 'rt', 'rp', 'optgroup', 'option', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th']);

const artifactSyntaxIssue = (content: string, index: number, message: string): ArtifactSyntaxResult => {
  const prefix = content.slice(0, Math.max(index, 0));
  return { valid: false, issue: { line: prefix.split('\n').length, column: prefix.length - prefix.lastIndexOf('\n'), message } };
};

export const analyzeArtifactSyntax = (content: string, language: string): ArtifactSyntaxResult => {
  const normalizedLanguage = language.toLowerCase();
  if (normalizedLanguage === 'json') {
    try { JSON.parse(content); return { valid: true, issue: null }; }
    catch (error) {
      const offset = Number((error instanceof Error ? error.message : '').match(/position\s+(\d+)/i)?.[1] ?? 0);
      return artifactSyntaxIssue(content, offset, 'JSON の形式が正しくありません。');
    }
  }
  if (normalizedLanguage !== 'html' && normalizedLanguage !== 'svg') return { valid: true, issue: null };

  const stack: { name: string; index: number }[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const start = content.indexOf('<', cursor);
    if (start < 0) break;
    if (content.startsWith('<!--', start)) {
      const end = content.indexOf('-->', start + 4);
      if (end < 0) return artifactSyntaxIssue(content, start, 'HTML コメントが閉じられていません。');
      cursor = end + 3;
      continue;
    }
    if (/^<!doctype\b|^<!\[CDATA\[|^<\?/i.test(content.slice(start))) {
      const end = content.indexOf('>', start + 2);
      if (end < 0) return artifactSyntaxIssue(content, start, '宣言タグが閉じられていません。');
      cursor = end + 1;
      continue;
    }
    const nameMatch = content.slice(start).match(/^<\s*(\/?)\s*([a-zA-Z][\w:.-]*)\b/);
    if (!nameMatch) { cursor = start + 1; continue; }
    let quote: string | null = null;
    let end = start + nameMatch[0].length;
    for (; end < content.length; end += 1) {
      const character = content[end];
      if (quote) { if (character === quote) quote = null; continue; }
      if (character === '"' || character === "'") { quote = character; continue; }
      if (character === '>') break;
      if (character === '<') return artifactSyntaxIssue(content, start, 'タグの終端 > が不足しています。');
    }
    if (end >= content.length) return artifactSyntaxIssue(content, start, quote ? '属性値の引用符が閉じられていません。' : 'タグの終端 > が不足しています。');
    const name = nameMatch[2].toLowerCase();
    const isClosing = Boolean(nameMatch[1]);
    if (isClosing) {
      while (stack.length && stack.at(-1)?.name !== name && OPTIONAL_HTML_TAGS.has(stack.at(-1)!.name)) stack.pop();
      if (stack.at(-1)?.name !== name) return artifactSyntaxIssue(content, start, `</${name}> に対応する開始タグがありません。`);
      stack.pop();
    } else if (!VOID_HTML_TAGS.has(name) && !/\/\s*>$/.test(content.slice(start, end + 1))) {
      if (stack.at(-1)?.name === name && OPTIONAL_HTML_TAGS.has(name)) stack.pop();
      stack.push({ name, index: start });
      if (name === 'script' || name === 'style') {
        const closing = new RegExp(`<\\/\\s*${name}\\s*>`, 'ig');
        closing.lastIndex = end + 1;
        const match = closing.exec(content);
        if (!match) return artifactSyntaxIssue(content, start, `<${name}> の閉じタグ </${name}> が不足しています。`);
        stack.pop();
        cursor = closing.lastIndex;
        continue;
      }
    }
    cursor = end + 1;
  }
  while (stack.length && OPTIONAL_HTML_TAGS.has(stack.at(-1)!.name)) stack.pop();
  const unclosed = stack.at(-1);
  return unclosed ? artifactSyntaxIssue(content, unclosed.index, `<${unclosed.name}> の閉じタグ </${unclosed.name}> が不足しています。`) : { valid: true, issue: null };
};

export const completeArtifactClosingTag = (content: string, cursor: number): { content: string; cursor: number; completed: boolean } => {
  if (!Number.isInteger(cursor) || cursor < 1 || cursor > content.length || content[cursor - 1] !== '>') return { content, cursor, completed: false };
  const opening = content.slice(0, cursor).match(/<([a-zA-Z][\w:.-]*)(?:\s[^<>]*?)?>$/);
  if (!opening || /\/\s*>$/.test(opening[0]) || VOID_HTML_TAGS.has(opening[1].toLowerCase())) return { content, cursor, completed: false };
  const closing = `</${opening[1]}>`;
  if (content.slice(cursor).toLowerCase().startsWith(closing.toLowerCase())) return { content, cursor, completed: false };
  return { content: `${content.slice(0, cursor)}${closing}${content.slice(cursor)}`, cursor, completed: true };
};

export const getOriginSystemPrompt = (language: OriginLanguage): string => language === 'en'
  ? 'You are ORIGIN Personal, an executive-grade decision and creation partner. Lead with a decisive one-sentence recommendation, then present evidence, trade-offs, risks, and the next action in concise native English. For artifacts, use fenced blocks in the exact format ```language:title and deliver production-ready output.'
  : 'あなたは ORIGIN Personal です。結論を1文で先に示し、根拠、比較、リスク、次の行動を論理的に整理してください。成果物は ```language:title 形式で、本番利用できる品質に仕上げてください。';

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

export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  deliveryState?: 'verified' | 'error';
};
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
export type ArtifactIntegrityEntry = { id: string; title: string; language: string; type: ArtifactBlock['type']; revision: number; path: string; bytes: number; sha256: string };
export type ArtifactIntegrityManifest = { format: 'ORIGIN Artifact Integrity Manifest'; version: 2; algorithm: 'SHA-256'; exportedAt: string; artifactCount: number; artifacts: readonly ArtifactIntegrityEntry[] };

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

const sha256Hex = async (content: string): Promise<string> => {
  if (!globalThis.crypto?.subtle) throw new Error('sha256-unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', zipEncoder.encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const createArtifactIntegrityManifest = async (
  artifacts: readonly { artifact: ArtifactBlock; path: string; content: string }[],
  exportedAt: string = new Date().toISOString(),
): Promise<ArtifactIntegrityManifest> => ({
  format: 'ORIGIN Artifact Integrity Manifest',
  version: 2,
  algorithm: 'SHA-256',
  exportedAt,
  artifactCount: artifacts.length,
  artifacts: await Promise.all(artifacts.map(async ({ artifact, path, content }) => ({
    id: artifact.id,
    title: artifact.title,
    language: artifact.language,
    type: artifact.type,
    revision: artifact.revision ?? 1,
    path,
    bytes: zipEncoder.encode(content).byteLength,
    sha256: await sha256Hex(content),
  }))),
});

const serializeEmbeddedManifest = (manifest: ArtifactIntegrityManifest): string => JSON.stringify(manifest, null, 2).replace(/</g, '\\u003c');

export const createArtifactHtmlExportPayload = async (artifact: ArtifactBlock, exportedAt: string = new Date().toISOString()): Promise<ArtifactExportPayload> => {
  const base = createArtifactExportPayload(artifact, 'html');
  const manifest = await createArtifactIntegrityManifest([{ artifact, path: base.fileName, content: base.content }], exportedAt);
  const metadata = `<script type="application/json" id="origin-export-manifest" data-filename="manifest.json">${serializeEmbeddedManifest(manifest)}</script>`;
  const content = /<\/body\s*>/i.test(base.content)
    ? base.content.replace(/<\/body\s*>/i, `${metadata}</body>`)
    : `${base.content}\n${metadata}`;
  return { ...base, content };
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
  const exportedAt = new Date().toISOString();
  const bundleEntries: { path: string; content: string }[] = [];
  const sources = included.map((artifact, index) => {
    const filename = `${String(index + 1).padStart(2, '0')}-${safeArtifactFileStem(artifact.title, `artifact-${index + 1}`)}.${artifactExtension(artifact)}`;
    const path = `artifacts/${filename}`;
    bundleEntries.push({ path, content: artifact.content });
    return { artifact, path, content: artifact.content };
  });
  const manifest = await createArtifactIntegrityManifest(sources, exportedAt);
  const files = manifest.artifacts;
  bundleEntries.push({ path: 'manifest.json', content: JSON.stringify(manifest, null, 2) });
  bundleEntries.push({ path: 'README.txt', content: `ORIGIN Offline Artifact Package\nExported: ${exportedAt}\nArtifacts: ${files.length}\nIntegrity: SHA-256 hashes are recorded in manifest.json.\n\nOpen index.html after extracting this ZIP. Artifact source files are stored in the artifacts directory.\n` });
  bundleEntries.push({ path: 'index.html', content: `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ORIGIN Artifact Package</title><style>body{margin:0;background:#0d1117;color:#e6edf3;font:16px/1.55 system-ui,sans-serif}.shell{max-width:900px;margin:0 auto;padding:48px 24px}h1{margin:0 0 8px}p{color:#9da7b3}.card{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:16px;margin:12px 0;border:1px solid #30363d;border-radius:14px;background:#161b22}a{color:#58d5ff;font-weight:700}@media(max-width:560px){.card{align-items:flex-start;flex-direction:column}}</style></head><body><main class="shell"><h1>ORIGIN Artifact Package</h1><p>Offline package · ${files.length} artifact(s) · ${escapeBundleHtml(exportedAt)} · SHA-256 manifest included</p><section>${files.map((file) => `<article class="card"><div><strong>${escapeBundleHtml(file.title)}</strong><br><small>${escapeBundleHtml(file.language)} · latest · SHA-256 ${file.sha256.slice(0, 12)}…</small></div><a href="${encodeURI(file.path)}">Open source</a></article>`).join('')}</section></main></body></html>` });
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

export type OriginStreamRenderBatcher = {
  enqueue: (chunk: string) => void;
  flush: () => void;
  cancel: () => void;
};

export function createOriginStreamRenderBatcher(
  render: (chunk: string) => void,
  scheduler: {
    requestFrame?: (callback: FrameRequestCallback) => number;
    cancelFrame?: (handle: number) => void;
  } = {},
): OriginStreamRenderBatcher {
  const requestFrame = scheduler.requestFrame ?? window.requestAnimationFrame.bind(window);
  const cancelFrame = scheduler.cancelFrame ?? window.cancelAnimationFrame.bind(window);
  let queuedText = '';
  let frameHandle: number | null = null;
  let active = true;

  const flush = () => {
    if (frameHandle !== null) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }
    if (!active || !queuedText) return;
    const next = queuedText;
    queuedText = '';
    render(next);
  };

  return {
    enqueue(chunk) {
      if (!active || !chunk) return;
      queuedText += chunk;
      if (frameHandle !== null) return;
      frameHandle = requestFrame(() => {
        frameHandle = null;
        flush();
      });
    },
    flush,
    cancel() {
      active = false;
      queuedText = '';
      if (frameHandle !== null) {
        cancelFrame(frameHandle);
        frameHandle = null;
      }
    },
  };
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
const ORIGIN_FIXED_FREE_MODEL = 'google/gemma-4-26b-a4b-it:free';
const SAFE_WAITING_PROVIDER_CODES = new Set(['PROVIDER_POLICY_VIOLATION', 'PROVIDER_COST_UNVERIFIED', 'PROVIDER_ROUTING_UNVERIFIED', 'FREE_MODEL_EVIDENCE_STALE', 'FREE_MODEL_CATALOG_INVALID']);
const TRANSIENT_PROVIDER_CODES = new Set(['PROVIDER_RATE_LIMITED', 'PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_INTERNAL_ERROR']);
const SAFE_WAITING_MESSAGE = '無料モデルの$0.00応答を確認できないため、回答は表示せず安全待機中です。時間をおいて再試行してください。';
const MODEL_BUSY_MESSAGE = "現在モデルが混雑しています。数十秒後に再試行してください（費用 $0.00 は維持されています）";
const formatDiagnostic = (code, status) => " (code: " + (code || "UNKNOWN") + ", status: " + (status ?? "---") + ")";
const MODEL_BUSY_MESSAGE_EN = 'The model is currently busy. Please try again in a few dozen seconds (the $0.00 cost is still maintained).';

type OriginChatFailurePayload = {
  code?: unknown;
  retryable?: unknown;
  retryAttempted?: unknown;
};

const isTransientHttpStatus = (status: number) => status === 429 || status === 502 || status === 503 || status === 504;

async function fetchOriginChatWithOneRetry(body: string, signal: AbortSignal): Promise<Response> {
  let lastNetworkError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body,
      });
      if (response.ok || !isTransientHttpStatus(response.status) || attempt === 1) return response;

      const failure = await response.clone().json().catch(() => null) as OriginChatFailurePayload | null;
      // The API already performs its one permitted provider retry. Retry here
      // only for an edge/proxy failure that did not reach that boundary.
      if (failure?.retryAttempted === true || typeof failure?.code === 'string') return response;
    } catch (error) {
      if (signal.aborted) throw error;
      lastNetworkError = error;
      if (attempt === 1) throw error;
    }
  }
  throw lastNetworkError instanceof Error ? lastNetworkError : new Error('request-error');
}

type OriginVerifiedChatPayload = {
  content?: unknown;
  model?: unknown;
  usage?: { cost?: unknown; costUsd?: unknown };
  routing?: {
    model?: unknown;
    modelId?: unknown;
    freeOnly?: unknown;
    cost?: unknown;
    actualCostUsd?: unknown;
    estimatedCostUsd?: unknown;
    billingTier?: unknown;
    usage?: { cost?: unknown; costUsd?: unknown };
    providerRouting?: { requestedModel?: unknown; servedModel?: unknown; fallbackUsed?: unknown };
  };
};

export const isVerifiedZeroCostChatPayload = (payload: OriginVerifiedChatPayload): boolean => {
  const routing = payload.routing;
  if (!routing || routing.freeOnly !== true || routing.cost !== 0 || routing.actualCostUsd !== 0 || routing.estimatedCostUsd !== 0) return false;
  const visibleCosts = [payload.usage?.cost, payload.usage?.costUsd, routing.usage?.cost, routing.usage?.costUsd];
  if (visibleCosts.some((cost) => cost !== undefined && (typeof cost !== 'number' || !Number.isFinite(cost) || cost !== 0))) return false;
  if (routing.billingTier !== undefined && routing.billingTier !== 'free') return false;
  if (routing.modelId === undefined) return routing.model === 'ORIGIN アプリ内処理' && payload.model === undefined;
  const route = routing.providerRouting;
  return routing.modelId === ORIGIN_FIXED_FREE_MODEL
    && (payload.model === undefined || payload.model === ORIGIN_FIXED_FREE_MODEL)
    && route?.requestedModel === ORIGIN_FIXED_FREE_MODEL
    && route.servedModel === ORIGIN_FIXED_FREE_MODEL
    && route.fallbackUsed === false
    && routing.usage?.costUsd === 0;
};
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
    <button type="button" data-testid="knowledge-map-toggle" aria-label="ナレッジマップを開く" aria-pressed={isOpen} onClick={() => setIsOpen((value) => !value)} className="origin-secondary-button min-h-11 min-w-11 px-3 text-[13px] font-semibold">◎ Map</button>
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
    <button type="button" data-testid="history-drawer-toggle" aria-label="履歴を開く" aria-pressed={isOpen} onClick={() => setIsOpen((value) => !value)} className="origin-secondary-button inline-flex h-11 min-h-11 w-11 shrink-0 items-center justify-center whitespace-nowrap rounded-[10px] px-0 text-[15px] font-semibold sm:w-auto sm:min-w-11 sm:px-3 sm:text-[13px]"><span aria-hidden="true">☰</span><span className="hidden sm:ml-1.5 sm:inline">履歴</span></button>
    {isOpen && <section data-testid="history-drawer" aria-label="端末内の会話と成果物履歴" className="origin-surface absolute right-4 top-20 z-40 w-[min(94vw,460px)] p-4 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><h2 className="m-0 text-base font-bold">履歴を検索</h2><p className="origin-muted m-0 mt-1 text-[13px]">会話、成果物コード、保存済みの版を端末内だけで検索します。</p></div><span className="origin-badge px-2 py-1 text-[13px] font-mono">Local</span></div><div className="mt-3"><LegacyKnowledgeMap sessions={sessions} onRestoreSession={onRestoreSession} /></div><label className="mt-4 block text-[13px] font-semibold" htmlFor="origin-history-search">検索語</label><input id="origin-history-search" data-testid="history-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="会話・コード・成果物を検索" className="origin-input mt-1 min-h-11 w-full rounded-[10px] border bg-transparent px-3 text-base" />{deferredQuery.trim() ? <div data-testid="history-search-results" role="status" aria-live="polite" className="mt-3 grid max-h-72 gap-2 overflow-auto">{results.length ? results.map((result, index) => <button key={`${result.kind}-${result.id}`} type="button" data-testid={`history-search-result-${index}`} onClick={() => schedule(() => { if (result.session) onRestoreSession?.(result.session); if (result.artifact) onOpenArtifact?.(result.artifact); setIsOpen(false); })} className="origin-secondary-button min-h-11 min-w-11 px-3 py-2 text-left"><span className="block truncate text-[13px] font-bold">{result.kind === 'session' ? '会話' : '成果物'} · {result.title}</span><span className="origin-muted mt-1 block line-clamp-2 text-[13px]">{result.detail}</span></button>) : <p className="origin-muted m-0 py-4 text-center text-base">一致する端末内履歴はありません。</p>}</div> : <p className="origin-muted mt-3 text-[13px]">入力すると、保存済みの全セッションと成果物本文を即時に絞り込みます。</p>}</section>}
  </>;
};

const KnowledgeMap: React.FC<{ sessions: readonly ConversationSession[]; onRestoreSession?: (session: ConversationSession) => void }> = ({ sessions, onRestoreSession }) => <HistoryDrawer sessions={sessions} onRestoreSession={onRestoreSession} />;

const ArtifactVisualDiffInspector: React.FC<{ diff: ArtifactVisualDiff }> = ({ diff }) => <section data-testid="artifact-visual-diff" aria-label="成果物の変更箇所" className="origin-surface-muted h-full overflow-auto rounded-2xl p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="m-0 text-base font-bold">最新と1つ前の版の変更</h3><p className="origin-muted m-0 mt-1 text-[13px]">端末内に保存した不変の成果物だけを比較しています。</p></div><div className="flex gap-2 text-[13px] font-mono"><span className="rounded-[10px] bg-emerald-500/15 px-2 py-1 text-emerald-600 dark:text-emerald-300">+ {diff.added}</span><span className="p-3 my-2 bg-red-950/80 border border-red-500/50 rounded-lg text-red-200 text-sm font-mono shadow-lg relative z-50 block w-full">− {diff.removed}</span></div></div><p data-testid="artifact-visual-diff-summary" className="origin-muted mt-3 text-[13px]">HTML要素 {diff.htmlChanges}件・CSS/スタイル {diff.cssChanges}件の変更</p>{diff.lines.length ? <pre className="m-0 mt-3 whitespace-pre-wrap break-words rounded-2xl bg-black/10 p-3 font-mono text-[13px] leading-6">{diff.lines.map((line, index) => <span key={`${line.kind}-${index}`} className={line.kind === 'added' ? 'block rounded-[10px] bg-emerald-500/15 px-2 text-emerald-600 dark:text-emerald-300' : 'block rounded-[10px] bg-red-500/15 px-2 text-red-600 dark:text-red-300'}>{line.kind === 'added' ? '+ ' : '− '}{line.value}</span>)}</pre> : <p className="origin-muted mt-5 text-base">構造・スタイル上の変更はありません。</p>}</section>;

const ResponseVerificationBadge: React.FC = () => <details data-testid="response-verification-details" className="origin-verification mt-2"><summary className="origin-secondary-button flex min-h-11 min-w-11 list-none items-center gap-2 rounded-[10px] px-3 text-[13px] font-semibold"><span aria-hidden="true">✓</span><span>検証済み</span><span className="origin-muted ml-auto text-[13px] font-normal">詳細</span></summary><ul data-testid="response-verification-log" className="origin-surface-muted m-0 mt-2 grid gap-1 rounded-2xl p-3 text-[13px] leading-6"><li><span className="font-semibold">意図分析</span> · 依頼内容と回答の対応を確認。</li><li><span className="font-semibold">制作仕様</span> · 成果物は必要な場合のみ隔離プレビューに表示。</li><li><span className="font-semibold">構文検証</span> · 固定の無料モデルと端末内保存の境界を維持。</li></ul></details>;

export type OriginDesignTheme = 'minimal' | 'luxury' | 'glass';
export const ORIGIN_ARTIFACT_SANDBOX_PERMISSIONS = 'allow-scripts' as const;
export const ORIGIN_ARTIFACT_THEME_TOKENS = ['--bg-primary', '--bg-surface', '--bg-surface-muted', '--bg-elevated', '--text-primary', '--text-secondary', '--text-placeholder', '--text-on-accent', '--border-default', '--border-strong', '--accent-primary', '--accent-hover', '--accent-soft', '--accent-border', '--accent-glow', '--success', '--danger', '--shadow-color', '--radius-control', '--radius-card', '--radius-composer'] as const;

export const ArtifactWorkspace: React.FC<{ artifact: ArtifactBlock | null; artifacts?: readonly ArtifactBlock[]; isOpen: boolean; language: OriginLanguage; onClose: () => void; onOpenSettings?: () => void; onArtifactRevision?: (artifact: ArtifactBlock) => void; isStreaming?: boolean; onSteer?: (direction: string) => void; designTheme?: OriginDesignTheme }> = ({ artifact, artifacts = [], isOpen, language, onClose, onOpenSettings, onArtifactRevision, isStreaming = false, onSteer, designTheme = 'minimal' }) => {
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
  const [steeringPrompt, setSteeringPrompt] = useState('');
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const workspaceRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const codeEditorRef = useRef<HTMLTextAreaElement>(null);
  const cleanLoadConfirmed = useRef(false);
  const setLastKnownGood = (snapshot: ArtifactBlock | null) => { if (snapshot === null || cleanLoadConfirmed.current) setLastKnownGoodState(snapshot); };
  useEffect(() => { const updateFullscreen = () => { const active = document.fullscreenElement === workspaceRef.current; setIsFullscreen(active); if (!active) setIsPresentation(false); }; document.addEventListener('fullscreenchange', updateFullscreen); return () => document.removeEventListener('fullscreenchange', updateFullscreen); }, []);
  useEffect(() => { cleanLoadConfirmed.current = false; setActiveTab('code'); setCopied(false); setShared(false); setIsPresentation(false); setPresentationSlideIndex(0); setPreviewViewport('fluid'); setIsDirectEditing(false); setSandboxError(null); setLastKnownGood(null); setIsExportMenuOpen(false); setIsDetailsMenuOpen(false); }, [artifact?.id]);
  useEffect(() => { const update = () => setIsOffline(!navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); }; }, []);
  useEffect(() => { if (!isDirectEditing) setWorkingContent(artifact?.content ?? ''); }, [artifact?.content, artifact?.id, isDirectEditing]);
  const syntaxResult = useMemo(() => analyzeArtifactSyntax(workingContent, artifact?.language ?? ''), [artifact?.language, workingContent]);
  const isRenderable = Boolean(artifact && (artifact.type === 'html' || artifact.language === 'html' || artifact.language === 'svg'));
  const sandboxSrcDoc = useMemo(() => {
    if (!artifact || !isRenderable) return '';
    const isolatedStorageBootstrap = `<script data-origin-storage-polyfill="true">(function(){var createStorage=function(){var values=new Map();var prototype=Object.create(null);Object.defineProperties(prototype,{length:{configurable:true,get:function(){return values.size}},key:{configurable:true,value:function(index){var position=Number(index);return Number.isFinite(position)&&position>=0?Array.from(values.keys())[Math.trunc(position)]||null:null}},getItem:{configurable:true,value:function(key){var normalized=String(key);return values.has(normalized)?values.get(normalized):null}},setItem:{configurable:true,value:function(key,value){values.set(String(key),String(value))}},removeItem:{configurable:true,value:function(key){values.delete(String(key))}},clear:{configurable:true,value:function(){values.clear()}}});var target=Object.create(prototype);return new Proxy(target,{get:function(object,property,receiver){if(typeof property!=='string'||property in object)return Reflect.get(object,property,receiver);return values.has(property)?values.get(property):undefined},set:function(object,property,value,receiver){if(typeof property==='string'&&!(property in object)){values.set(property,String(value));return true}return Reflect.set(object,property,value,receiver)},deleteProperty:function(object,property){if(typeof property==='string'&&values.has(property)){values.delete(property);return true}return Reflect.deleteProperty(object,property)},has:function(object,property){return Reflect.has(object,property)||(typeof property==='string'&&values.has(property))},ownKeys:function(object){return Reflect.ownKeys(object).concat(Array.from(values.keys()).filter(function(key){return !Reflect.has(object,key)}))},getOwnPropertyDescriptor:function(object,property){if(typeof property==='string'&&values.has(property)&&!Reflect.has(object,property))return{configurable:true,enumerable:true,writable:true,value:values.get(property)};return Reflect.getOwnPropertyDescriptor(object,property)}})};['localStorage','sessionStorage'].forEach(function(name){var isolated=createStorage();try{Object.defineProperty(window,name,{configurable:true,enumerable:true,get:function(){return isolated}})}catch(_){}})})();</script>`;
    const cleanLoadBoundary = `<script>(function(){var source='ORIGIN_SANDBOX_BOUNDARY';var failed=false;var send=function(type,payload){try{parent.postMessage(Object.assign({source:source,type:type},payload||{}),'*')}catch(_){}};var report=function(value){if(failed)return;failed=true;var message=String(value&&value.message||value||'Unknown runtime error').replace(/\\s+/g,' ').slice(0,280);send('runtime-error',{message:message,timestamp:Date.now()})};window.addEventListener('error',function(event){report(event.error||event.message);event.preventDefault&&event.preventDefault()},true);window.addEventListener('unhandledrejection',function(event){report(event&&event.reason);event&&event.preventDefault&&event.preventDefault()});window.addEventListener('load',function(){setTimeout(function(){if(!failed)send('ready',{timestamp:Date.now()})},120)},{once:true})})();</script>`;
    const artifactA11yLinter = `<script data-origin-a11y-linter="true">(function(){var root=document.documentElement;var defaultLabel=${JSON.stringify(language === 'ja' ? '操作ボタン' : 'Action button')};var parse=function(value){var parts=String(value||'').match(/-?\\d*\\.?\\d+/g);if(!parts||parts.length<3)return null;return[Number(parts[0]),Number(parts[1]),Number(parts[2]),parts.length>3?Number(parts[3]):1]};var channel=function(value){var normalized=value/255;return normalized<=0.04045?normalized/12.92:Math.pow((normalized+0.055)/1.055,2.4)};var luminance=function(rgb){return 0.2126*channel(rgb[0])+0.7152*channel(rgb[1])+0.0722*channel(rgb[2])};var ratio=function(first,second){var bright=Math.max(luminance(first),luminance(second));var dark=Math.min(luminance(first),luminance(second));return(bright+0.05)/(dark+0.05)};var background=function(element){for(var current=element;current;current=current.parentElement){var parsed=parse(getComputedStyle(current).backgroundColor);if(parsed&&parsed[3]>0.05)return parsed}return[255,255,255,1]};var hasDirectText=function(element){return Array.prototype.some.call(element.childNodes,function(node){return node.nodeType===3&&String(node.textContent||'').trim()})};var accessibleName=function(element){var labelledBy=String(element.getAttribute('aria-labelledby')||'').trim().split(/\\s+/).filter(Boolean).map(function(id){var target=document.getElementById(id);return target?String(target.textContent||'').trim():''}).filter(Boolean).join(' ');var image=element.querySelector('img[alt]');return String(element.getAttribute('aria-label')||labelledBy||element.textContent||element.getAttribute('title')||element.getAttribute('value')||(image&&image.getAttribute('alt'))||'').trim()};var run=function(){var contrastFixed=document.querySelectorAll('[data-origin-contrast-fixed="true"]').length;var namesFixed=document.querySelectorAll('[data-origin-name-fixed="true"]').length;Array.prototype.forEach.call(document.querySelectorAll('[data-origin-presentation-content] *'),function(element){if(!hasDirectText(element))return;var style=getComputedStyle(element);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return;var foreground=parse(style.color);var back=background(element);if(!foreground)return;var fontSize=parseFloat(style.fontSize)||16;var weight=parseInt(style.fontWeight,10)||(/bold/i.test(style.fontWeight)?700:400);var threshold=fontSize>=24||(fontSize>=18.66&&weight>=700)?3:4.5;if(ratio(foreground,back)+0.01>=threshold)return;var black=[17,24,39,1];var white=[255,255,255,1];element.style.setProperty('color',ratio(black,back)>=ratio(white,back)?'#111827':'#ffffff','important');if(element.getAttribute('data-origin-contrast-fixed')!=='true'){element.setAttribute('data-origin-contrast-fixed','true');contrastFixed+=1}});Array.prototype.forEach.call(document.querySelectorAll('button,[role="button"]'),function(element,index){if(accessibleName(element))return;element.setAttribute('aria-label',defaultLabel+' '+String(index+1));if(element.getAttribute('data-origin-name-fixed')!=='true'){element.setAttribute('data-origin-name-fixed','true');namesFixed+=1}});root.setAttribute('data-origin-a11y-checked','true');root.setAttribute('data-origin-a11y-contrast-fixes',String(contrastFixed));root.setAttribute('data-origin-a11y-name-fixes',String(namesFixed));root.setAttribute('data-origin-a11y-fixes',String(contrastFixed+namesFixed));try{parent.postMessage({source:'ORIGIN_SANDBOX_A11Y',contrastFixes:contrastFixed,nameFixes:namesFixed,totalFixes:contrastFixed+namesFixed},'*')}catch(_){}};window.__originRunA11yLint=run;window.addEventListener('load',function(){setTimeout(run,0)},{once:true})})();</script>`;
    const presentationBridge = `<script>(function(){var slides=[];var current=${presentationSlideIndex};var presenting=${isPresentation ? 'true' : 'false'};var collect=function(){slides=Array.prototype.slice.call(document.querySelectorAll('[data-slide], .slide, [role="group"][aria-roledescription="slide"]'));if(slides.length<2)slides=[];if(slides.length)current=Math.min(Math.max(current,0),slides.length-1);document.documentElement.setAttribute('data-origin-slide-count',String(slides.length))};var render=function(){if(!slides.length){document.documentElement.setAttribute('data-origin-slide-index','0');return}slides.forEach(function(slide,index){slide.style.display=!presenting||index===current?'':'none';slide.setAttribute('aria-hidden',String(presenting&&index!==current));if(presenting&&index===current){slide.setAttribute('tabindex','-1');try{slide.focus({preventScroll:true})}catch(_){}}});document.documentElement.setAttribute('data-origin-slide-index',String(current+1))};var command=function(type){document.documentElement.setAttribute('data-origin-presentation-command',String(type));collect();if(type==='presentation-start'){presenting=true;current=0;render()}else if(type==='presentation-exit'){presenting=false;render()}else if(type==='presentation-next'&&slides.length){current=Math.min(current+1,slides.length-1);render()}else if(type==='presentation-prev'&&slides.length){current=Math.max(current-1,0);render()}};window.addEventListener('message',function(event){var data=event.data;if(!data||data.source!=='ORIGIN_PRESENTATION')return;command(data.type)});window.addEventListener('load',function(){collect();render()},{once:true})})();</script>`;
    const presentationKeyboardBridge = `<script>(function(){window.addEventListener('keydown',function(event){if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;if(event.key!=='ArrowRight'&&event.key!=='ArrowLeft'&&event.key!=='Escape')return;event.preventDefault();try{parent.postMessage({source:'ORIGIN_PRESENTATION_KEYBOARD',key:event.key},'*')}catch(_){}})})();</script>`;
    const artifactThemeBridge = `<script data-origin-theme-bridge="true">(function(){var allowed=${JSON.stringify(ORIGIN_ARTIFACT_THEME_TOKENS)};window.addEventListener('message',function(event){if(event.source!==parent)return;var data=event.data;if(!data||data.source!=='ORIGIN_ARTIFACT_THEME'||!data.tokens||typeof data.tokens!=='object')return;if(data.designTheme!=='minimal'&&data.designTheme!=='luxury'&&data.designTheme!=='glass')return;var root=document.documentElement;allowed.forEach(function(name){var value=data.tokens[name];if(typeof value!=='string'||!value||value.length>160||/[;{}<>]/.test(value)||/url\\s*\\(|expression\\s*\\(/i.test(value))return;var property=name.indexOf('--radius-')===0?'border-radius':'color';if(typeof CSS==='undefined'||!CSS.supports(property,value))return;root.style.setProperty(name,value)});root.setAttribute('data-origin-design-theme',data.designTheme);if(data.colorTheme==='light'||data.colorTheme==='dark'){root.setAttribute('data-origin-color-theme',data.colorTheme);root.style.colorScheme=data.colorTheme}if(typeof window.__originRunA11yLint==='function')setTimeout(window.__originRunA11yLint,0)})})();</script>`;
    let slideOrder = 0;
    const markedContent = workingContent.replace(/<(section|article|div)(?=[^>]*(?:\bdata-slide\b|class\s*=\s*["'][^"']*\bslide\b|aria-roledescription\s*=\s*["']slide["']))[^>]*>/gi, (tag) => tag.replace(/>$/, ` data-origin-slide-order="${++slideOrder}">`));
    const presentationStyles = `<style>[data-origin-presentation-content][data-origin-presenting="true"] [data-origin-slide-order]{display:none!important;opacity:0;transform:translateX(12px)}[data-origin-presentation-content][data-origin-presenting="true"] [data-origin-slide-order="${presentationSlideIndex + 1}"]{display:block!important;opacity:1;transform:translateX(0);transition:opacity 180ms ease-out,transform 180ms ease-out}@media (prefers-reduced-motion:reduce){[data-origin-presentation-content] [data-origin-slide-order]{transition:none!important}}</style>`;
    const previewContent = isDirectEditing ? prepareDirectTouchMarkup(markedContent) : markedContent;
    const sanitized = `${isolatedStorageBootstrap}${cleanLoadBoundary}${presentationBridge}${presentationKeyboardBridge}${artifactA11yLinter}${artifactThemeBridge}${presentationStyles}<div data-origin-presentation-content data-origin-presenting="${isPresentation ? 'true' : 'false'}"><div data-origin-direct-touch-root${isDirectEditing ? ' data-origin-direct-touch="true"' : ''}>${previewContent.replace(/<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '')}</div></div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none';"><meta name="referrer" content="no-referrer"><style>html,body{min-height:100%;margin:0}body{font-family:system-ui,sans-serif;padding:16px;color:var(--text-primary,CanvasText);background:var(--bg-primary,transparent);transition:background-color 180ms ease,color 180ms ease}[data-origin-direct-touch="true"]{outline:2px dashed #22d3ee;outline-offset:-4px;cursor:text}[data-origin-direct-touch="true"] [data-origin-direct-touch-index]{outline:1px dashed color-mix(in srgb,#22d3ee 55%,transparent);outline-offset:3px;border-radius:3px}</style></head><body><script>window.addEventListener('click',function(event){var target=event.target;while(target&&target.tagName!=='A')target=target.parentElement;if(target&&target.tagName==='A'){event.preventDefault();event.stopPropagation();}},true);window.open=function(){return null;};</script>${sanitized}</body></html>`;
  }, [artifact, isDirectEditing, isPresentation, isRenderable, language, presentationSlideIndex, workingContent]);
  const postArtifactTheme = () => {
    if (!previewRef.current?.contentWindow || typeof document === 'undefined') return;
    const root = document.documentElement;
    const computed = window.getComputedStyle(root);
    const tokens = Object.fromEntries(ORIGIN_ARTIFACT_THEME_TOKENS.map((name) => [name, computed.getPropertyValue(name).trim()]).filter(([, value]) => Boolean(value)));
    previewRef.current.contentWindow.postMessage({ source: 'ORIGIN_ARTIFACT_THEME', designTheme, colorTheme: root.dataset.theme === 'dark' ? 'dark' : 'light', tokens }, '*');
  };
  useEffect(() => {
    if (!isOpen || !isRenderable || activeTab !== 'preview') return;
    let timer = window.setTimeout(postArtifactTheme, 0);
    const observer = new MutationObserver(() => { window.clearTimeout(timer); timer = window.setTimeout(postArtifactTheme, 0); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-design-theme', 'class', 'style'] });
    return () => { window.clearTimeout(timer); observer.disconnect(); };
  }, [activeTab, designTheme, isOpen, isRenderable]);
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
    const onSandboxKeyDown = (event: MessageEvent) => {
      if (event.source !== previewRef.current?.contentWindow) return;
      if (!event.data || event.data.source !== 'ORIGIN_PRESENTATION_KEYBOARD') return;
      if (event.data.key !== 'ArrowRight' && event.data.key !== 'ArrowLeft' && event.data.key !== 'Escape') return;
      onKeyDown(new KeyboardEvent('keydown', { key: event.data.key }));
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('message', onSandboxKeyDown);
    return () => { window.clearTimeout(timer); window.removeEventListener('keydown', onKeyDown); window.removeEventListener('message', onSandboxKeyDown); };
  }, [isPresentation, activeTab, sandboxSrcDoc]);
  if (!isOpen || !artifact) return null;
  const fileType = artifact.language === 'html' ? 'text/html;charset=utf-8' : artifact.language === 'svg' ? 'image/svg+xml;charset=utf-8' : artifact.language === 'markdown' || artifact.language === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
  const extension = artifact.language === 'markdown' || artifact.language === 'md' ? 'md' : artifact.language === 'html' ? 'html' : artifact.language === 'svg' ? 'svg' : artifact.language || 'txt';
  const safeTitle = artifact.title.replace(/[^a-z0-9._-]/gi, '_') || 'origin-artifact';
  const fileName = safeTitle.toLowerCase().endsWith(`.${extension.toLowerCase()}`) ? safeTitle : `${safeTitle}.${extension}`;
  const downloadArtifact = async () => {
    const source = { ...artifact, content: workingContent };
    const content = artifact.language === 'html' ? (await createArtifactHtmlExportPayload(source)).content : workingContent;
    const url = URL.createObjectURL(new Blob([content], { type: fileType }));
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
      const payload = format === 'png' ? undefined : format === 'html' ? await createArtifactHtmlExportPayload(source) : createArtifactExportPayload(source, format);
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
  const commitCodeRevision = () => {
    if (!syntaxResult.valid) { setActiveTab('code'); codeEditorRef.current?.focus(); return false; }
    if (workingContent !== artifact.content) {
      const history = artifact.revisions ?? [{ id: `${artifact.id}:v1`, content: artifact.content, createdAt: 0, source: 'generated' as const }];
      const revision: ArtifactRevision = { id: `${artifact.id}:v${history.length + 1}`, content: workingContent, createdAt: Date.now(), source: 'direct-touch' };
      cleanLoadConfirmed.current = false;
      onArtifactRevision?.({ ...artifact, content: workingContent, revision: history.length + 1, revisions: [...history, revision] });
    }
    setIsDirectEditing(false);
    setActiveTab(isRenderable ? 'preview' : 'code');
    return true;
  };
  const updateCodeEditor = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    const cursor = event.target.selectionStart ?? value.length;
    const insertedSingleCharacter = value.length === workingContent.length + 1
      && value.slice(0, cursor - 1) === workingContent.slice(0, cursor - 1)
      && value.slice(cursor) === workingContent.slice(cursor - 1);
    const completion = insertedSingleCharacter && (artifact.language === 'html' || artifact.language === 'svg')
      ? completeArtifactClosingTag(value, cursor)
      : { content: value, cursor, completed: false };
    setWorkingContent(completion.content);
    if (completion.completed) window.requestAnimationFrame(() => codeEditorRef.current?.setSelectionRange(completion.cursor, completion.cursor));
  };
  const previewWidth = previewViewport === '375' ? '375px' : previewViewport === '768' ? '768px' : '100%';
  const codePanel = isDirectEditing
    ? <div className="flex h-full min-h-0 flex-col gap-3"><label htmlFor="artifact-code-editor" className="text-[13px] font-semibold">{language === 'ja' ? '成果物のコードを直接編集' : 'Edit artifact source'}</label><textarea ref={codeEditorRef} id="artifact-code-editor" data-testid="artifact-code-editor" aria-label={language === 'ja' ? '成果物のコードを直接編集' : 'Edit artifact source'} aria-invalid={!syntaxResult.valid} aria-describedby="artifact-code-syntax-status" value={workingContent} onChange={updateCodeEditor} onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); commitCodeRevision(); } }} spellCheck={false} className="origin-surface min-h-48 flex-1 resize-none rounded-2xl border border-[var(--border-default)] p-3 font-mono text-[13px] leading-6 focus:outline-none focus:ring-2 focus:ring-[var(--accent-glow)]" /><div id="artifact-code-syntax-status" data-testid="artifact-code-syntax-status" role={syntaxResult.valid ? 'status' : 'alert'} className={`text-[13px] ${syntaxResult.valid ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{syntaxResult.valid ? language === 'ja' ? '✓ 構文を確認済み。閉じタグは自動補完されます。' : '✓ Syntax verified. Closing tags are completed automatically.' : language === 'ja' ? `${syntaxResult.issue.line}行 ${syntaxResult.issue.column}列: ${syntaxResult.issue.message}` : `Line ${syntaxResult.issue.line}, column ${syntaxResult.issue.column}: ${syntaxResult.issue.message}`}</div><button type="button" data-testid="artifact-code-apply" disabled={!syntaxResult.valid} onClick={commitCodeRevision} className="origin-primary-button min-h-11 min-w-11 rounded-[10px] px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50">{language === 'ja' ? '確認して編集を完了' : 'Validate and finish editing'}</button></div>
    : <pre className="m-0 whitespace-pre-wrap break-all font-mono text-[13px] leading-6">{workingContent}</pre>;
  const previewFrame = activeTab === 'preview' && isRenderable ? <div data-testid="responsive-preview-stage" className="flex h-full min-w-full items-start justify-center overflow-auto"><iframe ref={previewRef} title={t.previewTitle} aria-label={t.previewTitle} key={sandboxSrcDoc} src="/origin-artifact-sandbox.html" data-origin-srcdoc={sandboxSrcDoc} sandbox={ORIGIN_ARTIFACT_SANDBOX_PERMISSIONS} referrerPolicy="no-referrer" onLoad={(event) => { event.currentTarget.setAttribute('data-origin-loaded', 'true'); event.currentTarget.contentWindow?.postMessage({ source: 'ORIGIN_SANDBOX_INIT', html: sandboxSrcDoc }, '*'); postArtifactTheme(); if (isPresentation) postPresentationCommand('presentation-start'); }} style={{ width: previewWidth }} className="origin-surface h-full shrink-0 rounded-2xl transition-[width] duration-200 ease-out motion-reduce:transition-none" /></div> : codePanel;
  const priorRevision = artifact.revisions && artifact.revisions.length >= 2 ? artifact.revisions[artifact.revisions.length - 2] : null;
  const visualDiff = priorRevision ? createArtifactVisualDiff(priorRevision.content, workingContent) : null;
  return <aside ref={workspaceRef} aria-label={t.workspaceLabel} data-testid="artifact-workspace" className="origin-workspace fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l shadow-2xl sm:w-[560px]">
    <div className="flex min-h-16 flex-wrap items-center justify-between gap-2 border-b border-[var(--border-default)] px-3 py-2 sm:px-4">
      <div className="min-w-0 flex flex-1 items-center gap-2"><span className="origin-badge rounded-[10px] px-2 py-1 text-[13px] font-mono font-semibold">{artifact.language}</span><h2 className="truncate text-base font-semibold">{artifact.title}</h2><span data-testid="artifact-revision-indicator" aria-live="polite" className="origin-muted shrink-0 text-[13px] font-semibold">最新</span>{priorRevision && <span className="origin-muted shrink-0 text-[13px]">1つ前の版あり</span>}</div>
      <div className="flex flex-wrap items-center justify-end gap-1">
        {isRenderable && <><div role="group" aria-label={t.displayMode} className="origin-surface-muted flex rounded-2xl p-1"><button type="button" aria-label={t.showCode} aria-pressed={activeTab === 'code'} onClick={() => setActiveTab('code')} className={`min-h-11 min-w-11 rounded-[10px] px-3 text-[13px] font-semibold ${activeTab === 'code' ? 'origin-primary-button' : 'origin-secondary-button'}`}>{t.code}</button><button type="button" aria-label={t.showPreview} aria-pressed={activeTab === 'preview'} onClick={() => { if (!isDirectEditing || syntaxResult.valid) setActiveTab('preview'); }} className={`min-h-11 min-w-11 rounded-[10px] px-3 text-[13px] font-semibold ${activeTab === 'preview' ? 'origin-primary-button' : 'origin-secondary-button'}`}>{t.preview}</button></div><div data-testid="responsive-viewport-bar" role="group" aria-label={t.responsivePreview} className="origin-surface-muted flex rounded-2xl p-1"><button type="button" data-testid="preview-viewport-375" aria-label={t.phoneViewport} aria-pressed={previewViewport === '375'} onClick={() => { setIsPresentation(false); if (!isDirectEditing || syntaxResult.valid) setActiveTab('preview'); setPreviewViewport('375'); }} className={`min-h-11 min-w-11 rounded-[10px] px-2 text-[13px] font-semibold ${previewViewport === '375' ? 'origin-primary-button' : 'origin-secondary-button'}`}>📱 375px</button><button type="button" data-testid="preview-viewport-768" aria-label={t.tabletViewport} aria-pressed={previewViewport === '768'} onClick={() => { setIsPresentation(false); if (!isDirectEditing || syntaxResult.valid) setActiveTab('preview'); setPreviewViewport('768'); }} className={`min-h-11 min-w-11 rounded-[10px] px-2 text-[13px] font-semibold ${previewViewport === '768' ? 'origin-primary-button' : 'origin-secondary-button'}`}>📱 768px</button><button type="button" data-testid="preview-viewport-fluid" aria-label={t.fluidViewport} aria-pressed={previewViewport === 'fluid'} onClick={() => { setIsPresentation(false); if (!isDirectEditing || syntaxResult.valid) setActiveTab('preview'); setPreviewViewport('fluid'); }} className={`min-h-11 min-w-11 rounded-[10px] px-2 text-[13px] font-semibold ${previewViewport === 'fluid' ? 'origin-primary-button' : 'origin-secondary-button'}`}>💻 100%</button></div></>}
        <div data-testid="artifact-action-bar" role="group" aria-label="成果物の主要操作" className="origin-surface-muted flex rounded-2xl p-1"><button type="button" data-testid="artifact-action-edit" aria-label={t.editArtifact} aria-pressed={isDirectEditing} onClick={() => { if (isDirectEditing) { commitCodeRevision(); return; } setIsDirectEditing(true); setActiveTab(isRenderable ? 'preview' : 'code'); }} className={`min-h-11 min-w-11 rounded-[10px] px-3 text-[13px] font-semibold ${isDirectEditing ? 'origin-primary-button' : 'origin-secondary-button'}`}>✏️ {isDirectEditing ? t.finishEditing : language === 'ja' ? '編集' : 'Edit'}</button><button type="button" data-testid="artifact-action-share" aria-label={t.shareArtifact} onClick={() => void shareArtifact()} className="origin-secondary-button min-h-11 min-w-11 rounded-[10px] px-3 text-[13px] font-semibold">📲 {shared ? language === 'ja' ? '共有済み' : 'Shared' : language === 'ja' ? '共有' : 'Share'}</button><button type="button" data-testid="artifact-action-save" aria-label={t.downloadArtifact} onClick={downloadArtifact} className="origin-secondary-button min-h-11 min-w-11 rounded-[10px] px-3 text-[13px] font-semibold">📥 {language === 'ja' ? '保存' : 'Save'}</button><div className="relative"><button type="button" data-testid="artifact-action-details" aria-label="成果物の詳細操作を開く" aria-expanded={isDetailsMenuOpen} onClick={() => { setIsDetailsMenuOpen((current) => !current); setIsExportMenuOpen(false); }} className="origin-secondary-button min-h-11 min-w-11 rounded-[10px] px-3 text-[13px] font-semibold">••• 詳細</button>{isDetailsMenuOpen && <div data-testid="artifact-details-menu" role="menu" aria-label="成果物の詳細操作" className="origin-surface absolute right-0 top-12 z-50 grid min-w-52 gap-1 rounded-2xl p-2 shadow-xl"><button type="button" data-testid="artifact-action-copy" role="menuitem" aria-label={t.copyArtifact} onClick={() => void copyText(workingContent).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2_000); })} className="origin-secondary-button min-h-11 min-w-11 rounded-[10px] px-3 text-left text-[13px] font-semibold">📋 {copied ? t.copied : t.copy}</button>{priorRevision && <button type="button" data-testid="artifact-visual-diff-toggle" role="menuitem" aria-label="最新と1つ前の版の変更箇所を見る" aria-pressed={isDiffInspectorOpen} onClick={() => { setIsDirectEditing(false); setIsDiffInspectorOpen((current) => !current); setIsDetailsMenuOpen(false); }} className={`min-h-11 min-w-11 rounded-[10px] px-3 text-left text-[13px] font-semibold ${isDiffInspectorOpen ? 'origin-primary-button' : 'origin-secondary-button'}`}>🔍 {isDiffInspectorOpen ? '変更箇所を閉じる' : '変更箇所を見る'}</button>}<div className="relative"><button type="button" data-testid="artifact-action-export-menu" role="menuitem" aria-label="保存形式を選ぶ" aria-expanded={isExportMenuOpen} onClick={() => setIsExportMenuOpen((current) => !current)} className="origin-secondary-button min-h-11 min-w-11 w-full rounded-[10px] px-3 text-left text-[13px] font-semibold">形式を選んで保存</button>{isExportMenuOpen && <div data-testid="artifact-export-menu" role="menu" aria-label="成果物の保存形式" className="origin-surface absolute right-full top-0 z-[60] grid min-w-36 gap-1 rounded-2xl p-2 shadow-xl">{([{ key: 'html', label: 'HTML' }, { key: 'svg', label: 'SVG' }, { key: 'png', label: 'PNG' }, { key: 'markdown', label: 'Markdown' }, { key: 'json', label: 'JSON' }] as const).map((option) => <button key={option.key} type="button" data-testid={`artifact-export-${option.key}`} role="menuitem" onClick={() => void downloadArtifactFormat(option.key)} className="origin-secondary-button min-h-11 min-w-11 rounded-[10px] px-3 text-left text-[13px] font-semibold">{option.label}</button>)}</div>}</div><button type="button" data-testid="artifact-action-bundle" role="menuitem" aria-label="一括パッケージ保存" aria-busy={isBundling} onClick={() => void downloadArtifactBundle()} className="origin-secondary-button min-h-11 min-w-11 rounded-[10px] px-3 text-left text-[13px] font-semibold disabled:cursor-wait" disabled={isBundling}>📦 {isBundling ? '準備中' : '一括パッケージ保存'}</button>{priorRevision && <button type="button" data-testid="artifact-restore-previous" role="menuitem" aria-label="1つ前の版をこの版に戻す" onClick={restorePreviousVersion} className="origin-secondary-button min-h-11 min-w-11 rounded-[10px] px-3 text-left text-[13px] font-semibold">↶ この版に戻す</button>}{isRenderable && <button type="button" data-testid="presentation-mode-toggle" role="menuitem" aria-label={isPresentation ? t.exitPresentation : t.presentation} aria-pressed={isPresentation} onClick={() => void togglePresentation()} className={`min-h-11 min-w-11 rounded-[10px] px-3 text-left text-[13px] font-semibold ${isPresentation ? 'origin-primary-button' : 'origin-secondary-button'}`}>▣ {isPresentation ? t.exitPresentation : t.presentation}</button>}{onOpenSettings && <button type="button" data-testid="artifact-open-design-settings" role="menuitem" onClick={() => { setIsDetailsMenuOpen(false); onOpenSettings(); }} className="origin-secondary-button min-h-11 min-w-11 rounded-[10px] px-3 text-left text-[13px] font-semibold">🎨 {language === 'ja' ? 'デザインテーマ' : 'Design theme'}</button>}<button type="button" role="menuitem" aria-label={isFullscreen ? t.exitFullscreenLabel : t.openFullscreen} aria-pressed={isFullscreen} onClick={() => void toggleFullscreen()} className="origin-secondary-button min-h-11 min-w-11 rounded-[10px] px-3 text-left text-[13px] font-semibold">{isFullscreen ? t.exitFullscreen : t.fullscreen}</button></div>}</div></div><button type="button" aria-label={t.closeWorkspace} onClick={onClose} className="origin-secondary-button inline-flex h-11 w-11 items-center justify-center rounded-[10px] text-lg">✕</button>
      </div>
      {isPresentation && <p className="sr-only" role="status">{t.presentationKeyboardHint}</p>}{isOffline && <p data-testid="artifact-offline-status" role="status" className="text-[13px] text-amber-600 dark:text-amber-300">オフライン中: 端末内の成果物は閲覧・編集・保存できます。</p>}{bundleError && <p role="alert" className="text-[13px] text-[var(--danger)]">パッケージを作成できませんでした。</p>}{exportError && <p role="alert" className="text-[13px] text-[var(--danger)]">この形式でのローカル書き出しを完了できませんでした。</p>}
    </div>
    <div className="origin-code-panel relative min-h-0 flex-1 overflow-auto p-4">{isDiffInspectorOpen && visualDiff && priorRevision ? <ArtifactVisualDiffInspector diff={visualDiff} /> : previewFrame}{sandboxError && <div data-testid="sandbox-runtime-boundary" role="alert" className="absolute inset-6 flex flex-col justify-center rounded-2xl border border-red-400/60 bg-[var(--bg-surface)]/95 p-5 shadow-2xl backdrop-blur"><p className="p-3 my-2 bg-red-950/80 border border-red-500/50 rounded-lg text-red-200 text-sm font-mono shadow-lg relative z-50 block w-full">{t.sandboxRuntimeError}</p><p className="mt-2 break-words font-mono text-[13px]">{sandboxError}</p><p className="origin-muted mt-3 text-[13px]">{t.sandboxRuntimeDetail}</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" data-testid="restore-last-known-good" disabled={!lastKnownGood} title={!lastKnownGood ? t.noLastKnownGood : undefined} onClick={restoreLastKnownGood} className="origin-primary-button min-h-11 min-w-11 rounded-[10px] px-4 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-50">{t.restoreLastKnownGood}</button><button type="button" onClick={() => setSandboxError(null)} className="origin-secondary-button min-h-11 min-w-11 rounded-[10px] px-4 text-[13px] font-semibold">{t.close}</button></div></div>}</div>
    {isStreaming && !artifact.isComplete && onSteer && <form data-testid="artifact-live-steering" aria-label="成果物の方向修正" onSubmit={(event) => { event.preventDefault(); const direction = steeringPrompt.trim(); if (!direction) return; setSteeringPrompt(''); onSteer(direction); }} className="safe-area-bottom origin-surface-muted shrink-0 px-3 pt-3"><label htmlFor="artifact-live-steering-input" className="mb-2 block text-[13px] font-semibold text-[var(--accent-primary)]">⚡ {language === 'ja' ? '方向修正' : 'Adjust direction'}</label><div className="flex items-center gap-2"><input id="artifact-live-steering-input" data-testid="artifact-live-steering-input" aria-label={language === 'ja' ? '成果物の方向修正' : 'Adjust artifact direction'} value={steeringPrompt} onChange={(event) => setSteeringPrompt(event.target.value)} onKeyDown={(event) => { if ((event.nativeEvent.isComposing || event.keyCode === 229) && event.key === 'Enter') event.preventDefault(); }} placeholder={language === 'ja' ? '例：配色を落ち着いたネイビーに' : 'Example: use a calmer navy palette'} maxLength={1200} className="origin-input min-h-11 min-w-0 flex-1 rounded-[10px] border border-[var(--border-default)] bg-transparent px-3 text-base" /><button type="submit" data-testid="artifact-live-steering-submit" disabled={!steeringPrompt.trim()} className="origin-primary-button min-h-11 min-w-11 rounded-[10px] px-3 text-[13px] font-semibold disabled:opacity-50">{language === 'ja' ? '反映' : 'Apply'}</button></div></form>}
  </aside>;
};

export type OriginPersonalAppProps = { onOpenSettings?: () => void; messages?: ConversationMessage[]; sessions?: readonly ConversationSession[]; artifacts?: readonly ArtifactBlock[]; onArchiveSession?: (messages: readonly ConversationMessage[]) => void; onRestoreSession?: (session: ConversationSession) => void; onMessagesChange?: (messages: ConversationMessage[]) => void; onArtifactsChange?: (artifacts: ArtifactBlock[]) => void; resetSignal?: number; language?: OriginLanguage; designTheme?: OriginDesignTheme };
export const App: React.FC<OriginPersonalAppProps> = ({ onOpenSettings, messages: controlledMessages, sessions = [], artifacts: controlledArtifacts, onArchiveSession, onRestoreSession, onMessagesChange, onArtifactsChange, resetSignal = 0, language = 'ja', designTheme = 'minimal' }) => {
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
  const [isSafeWaiting, setIsSafeWaiting] = useState(false);
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
  const resetConversation = () => { onArchiveSession?.(messagesRef.current); abortRef.current?.abort(); abortRef.current = null; setIsLoading(false); setInputText(''); setAttachments([]); setAttachmentError(''); setIsSafeWaiting(false); setActiveArtifact(null); setIsWorkspaceOpen(false); updateMessages(() => []); };
  useEffect(() => { if (observedResetSignal.current === resetSignal) return; observedResetSignal.current = resetSignal; resetConversation(); }, [resetSignal]);
  useEffect(() => { if (!textareaRef.current) return; textareaRef.current.style.height = 'auto'; textareaRef.current.style.height = `${Math.min(Math.max(textareaRef.current.scrollHeight, 44), 160)}px`; }, [inputText]);
  const attachFiles = async (fileList?: FileList | File[]) => {
    if (!fileList?.length) return;
    setAttachmentError('');
    setIsSafeWaiting(false);
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
  const handleSend = async (textToSend?: string, interruptCurrent = false) => {
    const text = textToSend || inputText;
    if ((!text.trim() && !attachments.length) || (isLoading && !interruptCurrent)) return;
    if (isOffline) {
      setAttachmentError('オフライン中は新規AI応答を停止しています。端末内の履歴・成果物は閲覧、直接編集、保存、パッケージ化を継続できます。');
      return;
    }
    setAttachmentError('');
    setIsSafeWaiting(false);
    const interruptedArtifact = interruptCurrent ? activeArtifact : null;
    if (interruptCurrent) abortRef.current?.abort();
    const attachmentMessage = attachments.map((attachment) => attachment.kind === 'image' ? `\n\n[${attachment.name}: ${attachment.content}]` : `\n\n[${attachment.name}]\n${attachment.content}`).join('');
    const displayText = interruptCurrent ? `⚡ ${language === 'ja' ? '方向修正' : 'Direction update'}: ${text.trim()}` : text.trim();
    const userMessage: ConversationMessage = { id: `u-${Date.now()}`, role: 'user', content: `${displayText}${attachmentMessage}`.trim() };
    const conversation = updateMessages((current) => [...current, userMessage]);
    const requestMessages = conversation.map((message) => ({ role: message.role, content: message.content }));
    if (interruptedArtifact?.content) {
      const latestMessage = requestMessages.at(-1);
      if (latestMessage) latestMessage.content += `\n\n[生成途中の成果物: ${interruptedArtifact.title}]\n` + '```' + `${interruptedArtifact.language}:${interruptedArtifact.title}\n${interruptedArtifact.content.slice(0, 24_000)}\n` + '```' + '\n\n上記の途中成果物を土台として、最新の方向修正を優先して成果物を完成してください。';
    }
    setInputText(''); setAttachments([]); setIsLoading(true);
    const controller = new AbortController(); abortRef.current = controller;
    const appendFailure = (content: string) => {
      setAttachmentError(content);
      setIsSafeWaiting(true);
      // A response that failed during streaming is never eligible for a
      // verification trace. Remove that incomplete frame fail-closed.
      updateMessages((current) => current.at(-1)?.role === 'assistant' && current.at(-1)?.deliveryState !== 'verified'
        ? current.slice(0, -1)
        : current);
    };
    const enterSafeWaiting = () => {
      setAttachmentError(language === 'en'
        ? 'A verified $0.00 free-model response is unavailable. The response was withheld; please try again later.'
        : SAFE_WAITING_MESSAGE);
      setIsSafeWaiting(true);
    };
    let streamRenderBatcher: OriginStreamRenderBatcher | null = null;
    try {
      const response = await fetchOriginChatWithOneRetry(
        JSON.stringify({ model: ORIGIN_FIXED_FREE_MODEL, systemPrompt: getOriginSystemPrompt(language), messages: requestMessages }),
        controller.signal,
      );
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as OriginChatFailurePayload | null;
        if (typeof failure?.code === 'string' && SAFE_WAITING_PROVIDER_CODES.has(failure.code)) {
          enterSafeWaiting();
          return;
        }
        const isModelBusy = failure?.retryable === true && (failure?.code === "PROVIDER_RATE_LIMITED" || failure?.code === "PROVIDER_TIMEOUT");
      if (isModelBusy) {
          appendFailure(language === 'en' ? MODEL_BUSY_MESSAGE_EN : MODEL_BUSY_MESSAGE);
          return;
        }
        appendFailure(t.error);
        return;
      }
      const reportedCost = response.headers.get('x-origin-cost-usd') ?? response.headers.get('x-openrouter-cost');
      const reportedModel = response.headers.get('x-origin-model-id');
      const reportedTier = response.headers.get('x-origin-billing-tier');
      if ((reportedCost !== null && (!reportedCost.trim() || !Number.isFinite(Number(reportedCost)) || Number(reportedCost) !== 0))
        || (reportedModel !== null && reportedModel !== ORIGIN_FIXED_FREE_MODEL)
        || (reportedTier !== null && reportedTier.toLowerCase() !== 'free')
        || response.headers.get('x-origin-free-only') === 'false') {
        enterSafeWaiting();
        await response.body?.cancel();
        return;
      }
      let verifiedResponseText: string | undefined;
      if ((response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
        const payload = await response.json() as OriginVerifiedChatPayload;
        if (!isVerifiedZeroCostChatPayload(payload)) {
          enterSafeWaiting();
          return;
        }
        if (typeof payload.content !== 'string') throw new Error('invalid-response');
        verifiedResponseText = payload.content;
      }
      const reader = verifiedResponseText === undefined ? response.body?.getReader() : undefined; const decoder = new TextDecoder(); let fullText = ''; const assistantId = `a-${Date.now()}`;
      updateMessages((current) => [...current, { id: assistantId, role: 'assistant', content: '' }]);
      const displayVerifiedText = (next: string) => { fullText += next; const parsed = StreamArtifactParser.parse(fullText); updateMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: parsed.conversationalText } : message)); if (parsed.activeArtifact) { const streamedArtifacts = parsed.artifacts.map((block) => ({ ...block, id: `${assistantId}-${block.id}` })); updateArtifacts((current) => [...current.filter((block) => !block.id.startsWith(`${assistantId}-`)), ...streamedArtifacts]); setActiveArtifact(streamedArtifacts.at(-1) ?? null); setIsWorkspaceOpen(true); } };
      if (verifiedResponseText !== undefined) displayVerifiedText(verifiedResponseText);
      if (reader) {
        streamRenderBatcher = createOriginStreamRenderBatcher(displayVerifiedText);
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          streamRenderBatcher.enqueue(decoder.decode(value, { stream: true }));
        }
        streamRenderBatcher.enqueue(decoder.decode());
        streamRenderBatcher.flush();
      }
      updateMessages((current) => current.map((message) => message.id === assistantId ? { ...message, deliveryState: 'verified' } : message));
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') appendFailure(language === 'en' ? MODEL_BUSY_MESSAGE_EN : MODEL_BUSY_MESSAGE);
    }
    finally {
      streamRenderBatcher?.cancel();
      if (abortRef.current === controller) { abortRef.current = null; setIsLoading(false); }
    }
  };
  const composer = <><input ref={fileInputRef} type="file" multiple aria-label={t.attachFile} className="sr-only" accept="image/*,text/*,.md,.json,.csv,.ts,.tsx,.js,.jsx,.css,.html,.svg,.xml,.yml,.yaml" onChange={(event) => { void attachFiles(event.target.files); event.target.value = ''; }} /><div onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop} className={`origin-composer origin-surface flex items-end gap-2 rounded-[24px] border p-2 shadow-lg shadow-black/5 transition focus-within:border-[var(--accent-primary)] focus-within:ring-2 focus-within:ring-[var(--accent-glow)] ${messages.length ? 'origin-composer--compact' : ''} ${isDragging ? 'ring-2 ring-[var(--accent-primary)]' : ''}`}><textarea ref={textareaRef} aria-label={messages.length ? t.sendRequest : t.startRequest} aria-describedby="origin-chat-guidance" data-testid={messages.length ? 'origin-chat-request' : 'origin-home-request'} value={inputText} onChange={(event) => setInputText(event.target.value)} onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void handleSend(); } }} placeholder={messages.length ? t.chatPlaceholder : t.homePlaceholder} rows={1} disabled={isLoading} className="origin-input max-h-52 min-h-[60px] flex-1 resize-none bg-transparent px-4 py-3 text-base leading-7 focus:outline-none" /><button type="button" onClick={() => fileInputRef.current?.click()} aria-label={t.attachFile} className="origin-secondary-button inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-lg">＋</button>{isLoading ? <button type="button" aria-label={t.stopGeneration} onClick={() => abortRef.current?.abort()} className="origin-danger-button min-h-11 min-w-11 rounded-[10px] px-5 text-[13px] font-bold">{t.stop}</button> : <button type="button" data-testid={messages.length ? 'send-request-button' : 'start-request-button'} aria-label={messages.length ? t.sendRequest : t.startRequest} onClick={() => void handleSend()} disabled={(!inputText.trim() && !attachments.length)} className="origin-primary-button min-h-11 min-w-11 shrink-0 rounded-[10px] px-5 text-[13px] font-bold">{messages.length ? t.send : t.start}</button>}</div>{attachments.length > 0 && <div className="origin-muted mt-2 flex flex-wrap gap-2 text-[13px]"><span className="sr-only">{t.attachedFiles}</span>{attachments.map((attachment, index) => <span key={`${attachment.name}-${index}`} className="origin-surface-muted flex items-center gap-2 rounded-[10px] px-2 py-1"><span>{t.attach}: {attachment.name}</span><button type="button" onClick={() => setAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index))} aria-label={`${t.removeAttachment}: ${attachment.name}`} className="origin-secondary-button min-h-11 min-w-11 rounded-[10px] px-3 text-[13px]">✕</button></span>)}</div>}{attachmentError && <p data-testid={isSafeWaiting ? "origin-safe-waiting-state" : undefined} role="alert" aria-live={isSafeWaiting ? "assertive" : undefined} className="mt-2 text-[13px] text-[var(--danger)]">{attachmentError}</p>}<p id="origin-chat-guidance" className="sr-only">{t.keyboardGuidance}{t.dropFiles}</p></>;
  return <div className="origin-app flex h-[100dvh] w-screen overflow-hidden font-sans"><main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden"><header className="origin-header flex min-h-16 items-center justify-between px-3 backdrop-blur-md sm:px-4">
  <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.location.href = "/"}>
    
  <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.location.href = "/"}>
    <div className="flex shrink-0 items-center gap-1 whitespace-nowrap sm:gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[var(--accent-primary)] shadow-[0_0_10px_var(--accent-glow)]" aria-hidden="true" /><span className="text-base font-extrabold tracking-tight">ORIGIN</span><span className="origin-badge rounded-[10px] px-1.5 py-0.5 text-[13px] font-mono">Personal</span></div><div className="flex shrink-0 items-center gap-1 whitespace-nowrap sm:gap-2"><KnowledgeMap sessions={sessions} onRestoreSession={onRestoreSession} /><button type="button" onClick={onOpenSettings} aria-label={t.openSettings} className="origin-secondary-button inline-flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center whitespace-nowrap rounded-[10px] px-0 text-[13px] font-semibold sm:w-auto sm:px-3"><span aria-hidden="true">⚙️</span><span className="hidden sm:ml-1.5 sm:inline">{t.settings}</span></button><button type="button" onClick={resetConversation} aria-label={t.newConversationLabel} className="origin-secondary-button inline-flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center whitespace-nowrap rounded-[10px] px-0 text-[13px] font-semibold min-[380px]:w-auto min-[380px]:px-2 sm:px-3"><span aria-hidden="true">＋</span><span className="hidden min-[380px]:ml-1 min-[380px]:inline">{t.newConversation}</span></button></div>
  </div>

  </div>
</header><div className="min-h-0 flex-1 overflow-y-auto p-4">{messages.length === 0 ? <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center py-4"><div data-testid="origin-core-logo" className="relative mb-4 flex h-16 w-16 items-center justify-center"><div className="origin-logo-glow absolute inset-0 rounded-2xl blur-md" /><div className="origin-logo-core relative flex h-14 w-14 items-center justify-center rounded-2xl shadow-xl">◈</div></div><div className="mb-1 text-[13px] font-semibold uppercase tracking-wider text-[var(--accent-primary)]">ORIGIN</div><h1 className="text-center text-2xl font-extrabold tracking-tight sm:text-3xl">{t.homeHeading}</h1><p className="origin-muted mt-2 max-w-lg text-center text-base leading-7">{t.homeDescription}</p><div className="mt-8 w-full max-w-2xl">{composer}</div><p className="origin-safe-note mt-5 text-center text-[13px]">{t.freeOnlyNotice}</p></div> : <div role="log" aria-label={t.conversationLog} aria-live="off" aria-busy={isLoading} className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 pb-8">{messages.map((message) => { const isStreamingAssistant = isLoading && message.role === 'assistant' && message.id === messages.at(-1)?.id; return <article key={message.id} aria-label={message.role === 'user' ? t.userRequest : t.assistantResponse} className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}><div className={`max-w-[88%] rounded-2xl px-4 py-3 text-base leading-7 sm:max-w-[76%] ${message.role === 'user' ? 'origin-chat-user' : 'origin-chat-assistant'}`}><p className="m-0 whitespace-pre-wrap break-all">{message.content || (isStreamingAssistant ? t.thinking : '')}</p></div>{message.role === 'assistant' && message.deliveryState !== 'error' && Boolean(message.content) && !isStreamingAssistant && <ResponseVerificationBadge />}</article>; })}{isLoading && <div data-testid="origin-thinking" role="status" aria-live="polite" className="origin-surface-muted flex w-fit items-center gap-3 rounded-2xl px-4 py-3 text-[13px] font-semibold text-[var(--accent-primary)] shadow-sm"><span aria-hidden="true" className="inline-flex h-2.5 w-2.5 rounded-full bg-[var(--accent-primary)] animate-ping" />✨ {t.thinking}</div>}{messages.some((message) => message.role === 'assistant' && !isLoading) && <p data-testid="response-announcement" role="status" className="sr-only">{t.responseReady}</p>}</div>}</div>{messages.length > 0 && <div className="safe-area-bottom mx-auto w-full max-w-3xl px-4">{composer}</div>}</main><ArtifactWorkspace artifact={activeArtifact} artifacts={artifacts} isOpen={isWorkspaceOpen} language={language} designTheme={designTheme} isStreaming={isLoading} onSteer={(direction) => { void handleSend(direction, true); }} onOpenSettings={onOpenSettings} onClose={() => setIsWorkspaceOpen(false)} onArtifactRevision={(next) => { setActiveArtifact(next); updateArtifacts((current) => current.map((block) => block.id === next.id ? next : block)); }} /></div>;
};
export default App;
