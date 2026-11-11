import React, { useEffect, useMemo, useRef } from 'react';
import {
  researchConfidenceLabel,
  researchConflictTopicLabel,
  safeExternalUrl,
  type ResearchReportResult,
  type ResearchSource,
} from '../../research/researchReport';

/**
 * リサーチ結果の表示（チャット統合版）。
 *
 * 旧 ResearchWorkspaceV31 の専用画面表示を、会話の中に残るレポート表示へ
 * 移したもの（画面構成の見直し 2026-11-09、オーナー承認）：
 * - レポートは会話の回答として表示され、履歴にも残る。
 * - 出典はレポート側に一本化する（詳細パネルの Sources との二重表示は
 *   しない）。出典カードと「出典同士の違い」は ORIGIN の強みとして残す。
 * - 長いレポートは会話では途中までを示し、全画面の閲覧ビュー
 *   （ResearchReaderOverlay、目次・出典つき）から全文を読む。
 * - 「調査の安全条件」のような内部方針の説明文は持ち込まない。
 */

type ResearchViewLanguage = 'ja' | 'en';

/** 会話内にそのまま表示するレポート本文の目安（これを超えたら閲覧ビューへ誘導）。 */
export const RESEARCH_INLINE_REPORT_CHAR_LIMIT = 1200;

function renderInlineResearchMarkdown(text: string, sources: readonly ResearchSource[]) {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\[S\d+\]\(https:\/\/[^)\s]+\))/g);
  return parts.map((part, index) => {
    const bold = part.match(/^\*\*([^*\n]+)\*\*$/);
    if (bold) return <strong key={`bold-${index}`}>{bold[1]}</strong>;

    const citation = part.match(/^\[(S\d+)\]\((https:\/\/[^)\s]+)\)$/);
    if (citation) {
      const source = sources.find(item => item.id === citation[1]);
      const expected = source ? safeExternalUrl(source.url) : null;
      const actual = safeExternalUrl(citation[2]);
      if (expected && actual && expected === actual) {
        return <a key={`citation-${index}`} href={actual} target="_blank" rel="noreferrer" className="font-semibold text-[var(--accent-primary)] underline">{citation[1]}</a>;
      }
    }
    return <React.Fragment key={`text-${index}`}>{part}</React.Fragment>;
  });
}

function ResearchReportMarkdown({ report, sources, headingIdPrefix }: { report: string; sources: readonly ResearchSource[]; headingIdPrefix?: string }) {
  return <div className="break-words text-[15px] leading-7">
    {report.split('\n').map((line, index) => {
      if (!line.trim()) return <div key={`space-${index}`} className="h-2" aria-hidden="true" />;
      if (line.startsWith('### ')) return <h4 key={`h4-${index}`} id={headingIdPrefix ? `${headingIdPrefix}-${index}` : undefined} className="mt-5 text-[15px] font-black">{renderInlineResearchMarkdown(line.slice(4), sources)}</h4>;
      if (line.startsWith('## ')) return <h3 key={`h3-${index}`} id={headingIdPrefix ? `${headingIdPrefix}-${index}` : undefined} className="mt-6 text-[17px] font-black first:mt-0">{renderInlineResearchMarkdown(line.slice(3), sources)}</h3>;
      if (line.startsWith('- ')) return <p key={`bullet-${index}`} className="ml-4 before:mr-2 before:content-['•']">{renderInlineResearchMarkdown(line.slice(2), sources)}</p>;
      return <p key={`line-${index}`}>{renderInlineResearchMarkdown(line, sources)}</p>;
    })}
  </div>;
}

function truncateReport(report: string, limit: number): { text: string; truncated: boolean } {
  if (report.length <= limit) return { text: report, truncated: false };
  const lines = report.split('\n');
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (kept.length > 0 && length + line.length > limit) break;
    kept.push(line);
    length += line.length + 1;
    if (length >= limit) break;
  }
  return { text: kept.join('\n'), truncated: kept.length < lines.length };
}

function freshnessLabel(source: ResearchSource, language: ResearchViewLanguage): string {
  if (language === 'en') {
    if (source.freshness === 'recent') return 'Recent';
    if (source.freshness === 'older') return 'May be outdated';
    return 'Date unknown';
  }
  if (source.freshness === 'recent') return '最近の情報';
  if (source.freshness === 'older') return '古い情報の可能性があります';
  return '日付不明';
}

export function ResearchSourcesSection({ result, language }: { result: ResearchReportResult; language: ResearchViewLanguage }) {
  const isEn = language === 'en';
  return <section aria-label={isEn ? 'Sources' : '出典'} className="mt-5 border-t border-origin-border pt-4">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="m-0 text-sm font-black">{isEn ? 'Sources' : '出典'}</h3>
      <span className="rounded-full border border-origin-border px-3 py-1 text-xs font-bold">{isEn ? `Confidence: ${researchConfidenceLabel(result.confidence, language)}` : `出典の確かさ: ${researchConfidenceLabel(result.confidence, language)}`}</span>
      <span className="rounded-full border border-origin-border px-3 py-1 text-xs">{isEn ? `${result.sourceCount} sources` : `${result.sourceCount}件`}</span>
    </div>
    <p className="origin-muted mt-2 text-xs leading-5">{isEn
      ? '"Page verified" means the source page text itself could be read during the research. Source confidence does not guarantee the whole answer is correct.'
      : '「本文確認済み」は、調べたときに元のページ本文を読めた出典です。出典の確かさは、回答全体の正しさを保証するものではありません。'}</p>

    <div className="mt-3 space-y-3">{result.sources.map(source => {
      const href = safeExternalUrl(source.url);
      return <article key={source.id} className="rounded-xl border border-origin-border p-3">
        <p className="m-0 text-xs font-black text-[var(--accent-primary)]">{source.id}</p>
        <h4 className="mt-1 break-words text-sm font-bold">{source.title}</h4>
        <p className="origin-muted mt-1 text-xs">{source.domain} · {freshnessLabel(source, language)} · {source.evidenceLevel === 'page-verified' ? (isEn ? 'Page verified' : '本文確認済み') : (isEn ? 'Search snippet' : '検索結果の要約')}</p>
        {href
          ? <a href={href} target="_blank" rel="noreferrer" className="origin-touch-link mt-2 inline-flex min-h-11 items-center break-all text-sm font-semibold text-[var(--accent-primary)] underline">{isEn ? 'Open original' : '原文を開く'}</a>
          : <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">{isEn ? 'Link disabled: the URL could not be confirmed as a safe HTTPS address.' : '安全なHTTPS URLとして確認できないためリンクを無効化しました。'}</p>}
      </article>;
    })}</div>

    <div className="mt-4 rounded-xl border border-origin-border p-3 text-sm">
      <strong>{isEn ? 'Differences between sources' : '出典同士の違い'}</strong>
      {result.conflicts.length === 0
        ? <p className="origin-muted mt-2">{isEn ? 'No disagreements were found in comparable values such as prices, versions, or percentages.' : '価格・バージョン・割合など、比較できる数値の食い違いは見つかりませんでした。'}</p>
        : <ul className="mt-2 space-y-2 pl-5">{result.conflicts.map((conflict, index) => <li key={`${conflict.topic}-${index}`}><strong>{researchConflictTopicLabel(conflict.topic, language)}</strong>: {conflict.values.join(' / ')} · {conflict.sourceIds.join(', ')}</li>)}</ul>}
    </div>
  </section>;
}

export function ResearchMessageView({ result, language, onOpenReader }: {
  result: ResearchReportResult;
  language: ResearchViewLanguage;
  onOpenReader: () => void;
}) {
  const isEn = language === 'en';
  const { text, truncated } = useMemo(() => truncateReport(result.report, RESEARCH_INLINE_REPORT_CHAR_LIMIT), [result.report]);
  return <div data-testid="research-message">
    <ResearchReportMarkdown report={text} sources={result.sources} />
    {truncated && <button type="button" onClick={onOpenReader} className="origin-secondary-button mt-3 inline-flex min-h-11 items-center rounded-[10px] px-4 text-sm font-semibold">{isEn ? 'Read the full report' : 'レポートを全画面で読む'}</button>}
    <ResearchSourcesSection result={result} language={language} />
  </div>;
}

export function ResearchReaderOverlay({ result, title, language, onClose }: {
  result: ResearchReportResult;
  title: string;
  language: ResearchViewLanguage;
  onClose: () => void;
}) {
  const isEn = language === 'en';
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const headingIdPrefix = 'research-reader-heading';
  const headings = useMemo(() => result.report.split('\n').flatMap((line, index) => {
    if (line.startsWith('## ')) return [{ index, level: 2, text: line.slice(3) }];
    if (line.startsWith('### ')) return [{ index, level: 3, text: line.slice(4) }];
    return [];
  }), [result.report]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const jumpToHeading = (index: number) => {
    scrollRef.current?.querySelector(`#${headingIdPrefix}-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-primary)]" role="dialog" aria-modal="true" aria-label={isEn ? 'Research report' : '調査レポート'}>
    <div className="origin-surface flex shrink-0 items-center justify-between gap-3 border-b border-origin-border px-3 py-2 sm:px-4">
      <p className="min-w-0 flex-1 truncate text-sm font-bold">{title || (isEn ? 'Research report' : '調査レポート')}</p>
      <button ref={closeRef} type="button" onClick={onClose} className="origin-secondary-button min-h-11 shrink-0 rounded-xl px-4 text-sm font-semibold">{isEn ? 'Back to chat' : '会話に戻る'}</button>
    </div>
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
      <div className="mx-auto w-full max-w-3xl">
        {headings.length > 1 && <nav aria-label={isEn ? 'Contents' : '目次'} className="mb-5 rounded-2xl border border-origin-border p-3">
          <p className="m-0 text-xs font-black">{isEn ? 'Contents' : '目次'}</p>
          <div className="mt-1 flex flex-col">
            {headings.map(heading => <button key={heading.index} type="button" onClick={() => jumpToHeading(heading.index)} className={`min-h-11 rounded-lg px-2 text-left text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/10 ${heading.level === 3 ? 'pl-6' : ''}`}>{heading.text.replace(/\*\*/g, '')}</button>)}
          </div>
        </nav>}
        <ResearchReportMarkdown report={result.report} sources={result.sources} headingIdPrefix={headingIdPrefix} />
        <ResearchSourcesSection result={result} language={language} />
      </div>
    </div>
  </div>;
}
