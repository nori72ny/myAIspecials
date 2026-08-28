import { type ComponentProps, useEffect, useRef } from 'react';
import UnifiedChatCore from './UnifiedChatCore';

type UnifiedChatProps = ComponentProps<typeof UnifiedChatCore>;
type Range = [number, number];

const EXCLUDED_TAGS = new Set([
  'A', 'BUTTON', 'CODE', 'INPUT', 'NAV', 'OPTION', 'PRE', 'SCRIPT', 'SELECT', 'STYLE', 'TEXTAREA',
]);
const CONTENT_TAGS = new Set(['BLOCKQUOTE', 'H1', 'H2', 'H3', 'LI', 'P', 'TD', 'TH']);

function isDateLike(value: string): boolean {
  return /^(?:19|20)\d{2}(?:年|[-/.]\d{1,2}(?:月|[-/.]\d{1,2}(?:日)?)?)?$/.test(value)
    || /^\d{1,2}月(?:\d{1,2}日)?$/.test(value)
    || /^\d{1,2}日$/.test(value)
    || /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value);
}

function protectedRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const add = (re: RegExp) => {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) ranges.push([match.index, match.index + match[0].length]);
  };
  add(/https?:\/\/[^\s)<>]+|www\.[^\s)<>]+/gi);
  add(/<verified_source>[\s\S]*?<\/verified_source>/gi);
  add(/(?:19|20)\d{2}(?:年|[-/.]\d{1,2}(?:月|[-/.]\d{1,2}(?:日)?)?)/g);
  add(/\d{1,2}月(?:\d{1,2}日)?|\d{1,2}日/g);
  add(/\d{1,2}:\d{2}(?::\d{2})?/g);
  return ranges;
}

function isProtected(index: number, ranges: Range[]): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function processTextNode(node: Text): void {
  const parent = node.parentElement;
  if (!parent || !CONTENT_TAGS.has(parent.tagName)) return;
  if (parent.closest('[data-origin-estimate-unverified="true"]')) return;
  if (EXCLUDED_TAGS.has(parent.tagName) || parent.closest('a,button,code,pre,input,textarea,select,option,nav,script,style')) return;

  const text = node.data;
  if (!/\d/.test(text)) return;
  const ranges = protectedRanges(text);
  const numberRe = /(?<![\w])(?:[$€£¥￥]\s?)?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s?(?:%|万円|億円|円|USD|EUR|GBP|JPY|ドル))?(?![\w])/g;
  const matches: Array<{ start: number; end: number; value: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = numberRe.exec(text)) !== null) {
    const value = match[0];
    const start = match.index;
    const end = start + value.length;
    if (isProtected(start, ranges) || isDateLike(value)) continue;
    const following = text.slice(end);
    if (/^\s*\./.test(following) && !/[$€£¥￥%円万億]/.test(value)) continue;
    matches.push({ start, end, value });
  }
  if (matches.length === 0) return;

  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const item of matches) {
    if (item.start > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, item.start)));
    const badge = document.createElement('span');
    badge.dataset.originEstimateUnverified = 'true';
    badge.setAttribute('role', 'note');
    badge.setAttribute('aria-label', `AI推定値：${item.value}`);
    badge.title = '⚠️ AI推定値 — 確定事実として扱う前に根拠を確認してください。';
    badge.className = 'mx-0.5 inline-flex items-center rounded-md bg-yellow-100 px-1.5 py-0.5 font-medium text-yellow-900 ring-1 ring-yellow-300/80 dark:bg-yellow-400/15 dark:text-yellow-100 dark:ring-yellow-300/30';
    badge.textContent = `⚠️ ${item.value}`;
    fragment.appendChild(badge);
    cursor = item.end;
  }
  if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
  node.parentNode?.replaceChild(fragment, node);
}

function postProcessRenderedNumbers(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  nodes.forEach(processTextNode);
}

export default function UnifiedChat(props: UnifiedChatProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        postProcessRenderedNumbers(root);
      });
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={rootRef} data-origin-context-aware-numeric-postprocessor="v1" className="contents">
      <UnifiedChatCore {...props} />
    </div>
  );
}
