import React, { useState } from 'react';
import type { OriginRuntimeActivityV31 } from './OriginRuntimeActivityV31';

export type ResearchSource = {
  id: string;
  title: string;
  url: string;
  domain: string;
  evidenceLevel: 'snippet' | 'page-verified';
  freshness: 'recent' | 'older' | 'unknown';
  score: number;
  scoreScope: 'retrieval-evidence-only';
  citation: string;
};

type ResearchConflict = {
  kind: 'structured-value-mismatch';
  topic: 'price' | 'version' | 'percentage';
  values: string[];
  sourceIds: string[];
  note: string;
};

type ResearchSuccess = {
  ok: true;
  version: '1.1';
  status: 'grounded';
  provider?: 'DuckDuckGo' | 'Wikipedia';
  freeOnly: true;
  costUsd: 0;
  paidFallbackUsed: false;
  sourceCount: number;
  distinctDomainCount: number;
  confidence: 'strong' | 'moderate' | 'limited';
  confidenceScope: 'retrieval-evidence-only';
  semanticConflictDetection: 'conservative-structured-only';
  sources: ResearchSource[];
  conflicts: ResearchConflict[];
  report: string;
};

type ResearchFailure = {
  ok?: false;
  code?: string;
  message?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isResearchSource(value: unknown): value is ResearchSource {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.url === 'string'
    && typeof value.domain === 'string'
    && (value.evidenceLevel === 'snippet' || value.evidenceLevel === 'page-verified')
    && (value.freshness === 'recent' || value.freshness === 'older' || value.freshness === 'unknown')
    && typeof value.score === 'number'
    && Number.isFinite(value.score)
    && value.score >= 0
    && value.score <= 100
    && value.scoreScope === 'retrieval-evidence-only'
    && typeof value.citation === 'string';
}

function isResearchConflict(value: unknown): value is ResearchConflict {
  if (!isRecord(value)) return false;
  return value.kind === 'structured-value-mismatch'
    && (value.topic === 'price' || value.topic === 'version' || value.topic === 'percentage')
    && isStringArray(value.values)
    && isStringArray(value.sourceIds)
    && typeof value.note === 'string';
}

function isResearchSuccess(value: unknown): value is ResearchSuccess {
  if (!isRecord(value) || !Array.isArray(value.sources) || !Array.isArray(value.conflicts)) return false;
  const providerValid = value.provider === undefined || value.provider === 'DuckDuckGo' || value.provider === 'Wikipedia';
  const confidenceValid = value.confidence === 'strong' || value.confidence === 'moderate' || value.confidence === 'limited';
  return value.ok === true
    && value.version === '1.1'
    && value.status === 'grounded'
    && providerValid
    && value.freeOnly === true
    && value.costUsd === 0
    && value.paidFallbackUsed === false
    && Number.isInteger(value.sourceCount)
    && (value.sourceCount as number) >= 1
    && Number.isInteger(value.distinctDomainCount)
    && (value.distinctDomainCount as number) >= 1
    && (value.distinctDomainCount as number) <= (value.sourceCount as number)
    && value.sourceCount === value.sources.length
    && confidenceValid
    && value.confidenceScope === 'retrieval-evidence-only'
    && value.semanticConflictDetection === 'conservative-structured-only'
    && value.sources.every(isResearchSource)
    && value.conflicts.every(isResearchConflict)
    && typeof value.report === 'string';
}

function researchFailure(value: unknown): ResearchFailure {
  if (!isRecord(value)) return {};
  return {
    ok: value.ok === false ? false : undefined,
    code: typeof value.code === 'string' ? value.code : undefined,
    message: typeof value.message === 'string' ? value.message : undefined,
  };
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function confidenceLabel(value: ResearchSuccess['confidence']) {
  if (value === 'strong') return 'Strong';
  if (value === 'moderate') return 'Moderate';
  return 'Limited';
}

function failureMessage(code?: string, message?: string) {
  if (code === 'SENSITIVE_INPUT_BLOCKED') return '機微情報の可能性があるため、外部情報源への送信を停止しました。';
  if (code === 'RESEARCH_SOURCE_UNAVAILABLE') return '無料の公開情報源から確認可能な情報を取得できませんでした。未確認内容で補完していません。';
  if (code === 'INVALID_RESEARCH_QUERY') return '調査内容を1〜1200文字で入力してください。';
  return message || '調査を完了できませんでした。確認できていない内容は表示していません。';
}

type ResearchWorkspaceV31Props = {
  composerControls?: React.ReactNode;
  onSourcesChange?: (sources: readonly ResearchSource[]) => void;
  onRuntimeActivityChange?: (activity: OriginRuntimeActivityV31) => void;
};

export default function ResearchWorkspaceV31({ composerControls, onSourcesChange, onRuntimeActivityChange }: ResearchWorkspaceV31Props) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ResearchSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runResearch() {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length > 1200 || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    onSourcesChange?.([]);
    onRuntimeActivityChange?.({
      id: 'research-current',
      kind: 'research',
      status: 'running',
      title: '公開情報を調査',
      detail: '無料の公開Web情報源から取得し、応答契約と出典を検証しています。',
    });
    try {
      const response = await fetch('/api/research/v1.1/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });
      const data = await response.json() as unknown;
      if (!response.ok) {
        const failure = researchFailure(data);
        const message = failureMessage(failure.code, failure.message);
        setError(message);
        onRuntimeActivityChange?.({
          id: 'research-current',
          kind: 'research',
          status: failure.code === 'SENSITIVE_INPUT_BLOCKED' ? 'blocked' : 'failed',
          title: '公開情報を調査',
          detail: message,
          evidence: failure.code ? `code: ${failure.code}` : undefined,
        });
        return;
      }
      if (!isResearchSuccess(data)) {
        const message = '調査APIの応答を検証できなかったため、安全に停止しました。未確認内容は表示していません。';
        setError(message);
        onRuntimeActivityChange?.({ id: 'research-current', kind: 'research', status: 'failed', title: '公開情報を調査', detail: message, evidence: 'response contract validation failed' });
        return;
      }
      setResult(data);
      onSourcesChange?.(data.sources);
      onRuntimeActivityChange?.({
        id: 'research-current',
        kind: 'research',
        status: 'completed',
        title: '公開情報を調査',
        detail: `${data.sourceCount}件の出典・${data.distinctDomainCount}ドメインを検証済みです。`,
        evidence: `status=grounded · confidence=${data.confidence}${data.provider ? ` · provider=${data.provider}` : ''} · costUsd=0`,
      });
    } catch {
      const message = '調査APIへ接続できませんでした。未確認内容で補完していません。';
      setError(message);
      onRuntimeActivityChange?.({ id: 'research-current', kind: 'research', status: 'failed', title: '公開情報を調査', detail: message, evidence: 'network/request failure' });
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="Research Workspace" className="min-h-[calc(100vh-5rem)] bg-slate-50 p-3 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:p-5">
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="px-1 pt-2 md:px-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-500">Research</p>
            <h1 className="mt-1 text-lg font-black">公開情報を出典付きで調査</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">複数の公開情報源を確認し、出典と不確実性を分けて表示します。</p>
          </div>
          <span title="$0 · paid fallbackなし" className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">無料範囲で安全に調査</span>
        </div>
        <div className="origin-composer origin-surface mt-4 flex items-end gap-2 rounded-[24px] border p-2 shadow-lg shadow-black/5">
          {composerControls}
          <label htmlFor="research-query" className="sr-only">調べたいこと</label>
          <textarea id="research-query" value={query} onChange={event => setQuery(event.target.value)} maxLength={1200} rows={1} placeholder="調べたいことを入力…" className="origin-input max-h-52 min-h-[60px] flex-1 resize-none bg-transparent px-4 py-3 text-base leading-7 outline-none" />
          <button type="button" aria-label={busy ? '調査中…' : '調査する'} title={busy ? '調査中…' : '調査する'} onClick={() => void runResearch()} disabled={busy || !query.trim()} className="origin-primary-button inline-flex h-11 w-11 min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full p-0 text-xl font-bold disabled:cursor-not-allowed disabled:opacity-50"><span aria-hidden="true">{busy ? '…' : '↑'}</span></button>
        </div>
        <div className="mt-2 flex justify-end">
          <span className="text-[10px] text-slate-500">{query.length}/1200 · 機微情報は外部送信前にブロック</span>
        </div>
        {error && <div role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">{error}</div>}
      </header>

      {result && <>
        <section aria-label="Research summary" className="origin-workspace rounded-2xl p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-slate-200 px-3 py-1 font-bold dark:border-slate-700">Confidence: {confidenceLabel(result.confidence)}</span>
            <span className="rounded-full border border-slate-200 px-3 py-1 dark:border-slate-700">{result.sourceCount} sources</span>
            <span className="rounded-full border border-slate-200 px-3 py-1 dark:border-slate-700">{result.distinctDomainCount} domains</span>
            {result.provider && <span className="rounded-full border border-slate-200 px-3 py-1 dark:border-slate-700">Provider: {result.provider}</span>}
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">Confidence scope: retrieval evidence only. Semantic conflict detection is conservative and limited to structured values such as price/version/percentage.</p>
        </section>

        <section aria-labelledby="research-sources-title" className="origin-workspace rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><h2 id="research-sources-title" className="font-black">Sources</h2><span className="text-xs text-slate-500">出典を回答から分離表示</span></div>
          <div className="space-y-3">{result.sources.map(source => {
            const href = safeExternalUrl(source.url);
            return <article key={source.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><p className="m-0 text-xs font-black text-indigo-500">{source.id}</p><h3 className="mt-1 break-words text-sm font-bold">{source.title}</h3><p className="mt-1 text-xs text-slate-500">{source.domain}</p></div>
                <div className="flex shrink-0 flex-wrap gap-1 text-[10px]"><span className="rounded-full border border-slate-200 px-2 py-1 dark:border-slate-700">{source.evidenceLevel}</span><span className="rounded-full border border-slate-200 px-2 py-1 dark:border-slate-700">{source.freshness}</span><span className="rounded-full border border-slate-200 px-2 py-1 dark:border-slate-700">score {source.score}/100</span></div>
              </div>
              {href ? <a href={href} target="_blank" rel="noreferrer" className="origin-touch-link mt-3 inline-flex min-h-11 items-center break-all text-sm font-semibold text-indigo-600 underline dark:text-indigo-300">原文を開く</a> : <p className="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-300">安全なHTTPS URLとして確認できないためリンクを無効化しました。</p>}
            </article>;
          })}</div>
        </section>

        <section aria-labelledby="research-conflicts-title" className="origin-workspace rounded-2xl p-4">
          <h2 id="research-conflicts-title" className="font-black">Conflict review</h2>
          {result.conflicts.length === 0 ? <p className="mt-2 text-sm text-slate-500">構造化値の不一致は検出されませんでした。これは意味的な一致を保証するものではありません。</p> : <ul className="mt-3 space-y-2 pl-5 text-sm">{result.conflicts.map((conflict, index) => <li key={`${conflict.topic}-${index}`}><strong>{conflict.topic}</strong>: {conflict.values.join(' / ')} · {conflict.sourceIds.join(', ')}</li>)}</ul>}
        </section>

        <section aria-labelledby="research-report-title" className="origin-workspace rounded-2xl p-4">
          <h2 id="research-report-title" className="font-black">Grounded report</h2>
          <pre className="mt-3 max-h-[42rem] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 dark:border-slate-800 dark:bg-slate-950">{result.report}</pre>
        </section>
      </>}
    </div>
  </section>;
}
