import React, { useState } from 'react';

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

type ResearchWorkspaceV31Props = { onSourcesChange?: (sources: readonly ResearchSource[]) => void };

export default function ResearchWorkspaceV31({ onSourcesChange }: ResearchWorkspaceV31Props) {
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
    try {
      const response = await fetch('/api/research/v1.1/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });
      const data = await response.json() as unknown;
      if (!response.ok) {
        const failure = researchFailure(data);
        setError(failureMessage(failure.code, failure.message));
        return;
      }
      if (!isResearchSuccess(data)) {
        setError('調査APIの応答を検証できなかったため、安全に停止しました。未確認内容は表示していません。');
        return;
      }
      setResult(data);
      onSourcesChange?.(data.sources);
    } catch {
      setError('調査APIへ接続できませんでした。未確認内容で補完していません。');
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="Research Workspace" className="min-h-full bg-slate-50 p-3 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:p-5">
    <div className="mx-auto max-w-4xl space-y-4">
      <section className="origin-workspace rounded-2xl p-4 md:p-5">
        <h1 className="text-xl font-black">詳しく調べる</h1>
        <p className="mt-1 text-sm leading-6 text-slate-500">ORIGINが公開情報を確認し、出典付きでまとめます。</p>

        <label htmlFor="research-query" className="mt-4 block text-sm font-bold">調べたいこと</label>
        <textarea
          id="research-query"
          value={query}
          onChange={event => setQuery(event.target.value)}
          maxLength={1200}
          placeholder="例: 生成AIの店舗集客への活用について、最近の公開情報を比較してください。"
          className="mt-2 min-h-28 w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[10px] text-slate-500">{query.length}/1200</span>
          <button type="button" onClick={() => void runResearch()} disabled={busy || !query.trim()} className="origin-primary-button min-h-11 rounded-xl px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? '調査中…' : '調査する'}</button>
        </div>

        <details className="mt-3 border-t border-slate-200 pt-2 text-xs dark:border-slate-800">
          <summary className="min-h-11 cursor-pointer py-3 font-semibold">調査の安全条件</summary>
          <p className="leading-5 text-slate-500">公開情報を使って調査します。有料AIへの自動切り替えは行いません。機密性の高い情報は外部へ送る前に停止します。</p>
        </details>

        {error && <div role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">{error}</div>}
      </section>

      {result && <>
        <section aria-labelledby="research-report-title" className="origin-workspace rounded-2xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="research-report-title" className="font-black">調査結果</h2>
            <span className="text-xs text-slate-500">{result.sourceCount}件の出典</span>
          </div>
          <div className="mt-3 max-h-[42rem] overflow-auto whitespace-pre-wrap break-words text-sm leading-7">{result.report}</div>
        </section>

        <section aria-label="Research summary" className="origin-workspace rounded-2xl px-4">
          <details>
            <summary className="min-h-11 cursor-pointer py-3 font-semibold">出典を見る</summary>

            <div className="pb-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border border-slate-200 px-3 py-1 font-bold dark:border-slate-700">確認度: {confidenceLabel(result.confidence)}</span>
                <span className="rounded-full border border-slate-200 px-3 py-1 dark:border-slate-700">{result.sourceCount}件</span>
                <span className="rounded-full border border-slate-200 px-3 py-1 dark:border-slate-700">{result.distinctDomainCount}サイト</span>
                
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">確認度は、取得できた出典の強さを示します。内容全体の正しさを保証するものではありません。</p>

              <div className="mt-4 space-y-3">{result.sources.map(source => {
                const href = safeExternalUrl(source.url);
                return <article key={source.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="m-0 text-xs font-black text-indigo-500">{source.id}</p>
                      <h3 className="mt-1 break-words text-sm font-bold">{source.title}</h3>
                      <p className="mt-1 text-xs text-slate-500">{source.domain}</p>
                    </div>
                    
                  </div>
                  {href
                    ? <a href={href} target="_blank" rel="noreferrer" className="origin-touch-link mt-3 inline-flex min-h-11 items-center break-all text-sm font-semibold text-indigo-600 underline dark:text-indigo-300">原文を開く</a>
                    : <p className="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-300">安全なHTTPS URLとして確認できないためリンクを無効化しました。</p>}
                </article>;
              })}</div>

              <div className="mt-4 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
                <strong>出典同士の違い</strong>
                {result.conflicts.length === 0
                  ? <p className="mt-2 text-slate-500">価格・バージョン・割合など、比較できる数値の食い違いは見つかりませんでした。</p>
                  : <ul className="mt-2 space-y-2 pl-5">{result.conflicts.map((conflict, index) => <li key={`${conflict.topic}-${index}`}><strong>{conflict.topic}</strong>: {conflict.values.join(' / ')} · {conflict.sourceIds.join(', ')}</li>)}</ul>}
              </div>
            </div>
          </details>
        </section>
      </>}
    </div>
  </section>;
}
