import { useState } from 'react';
import OriginCatState, { type OriginCatStateKind } from './OriginCatState';
import { safeExternalUrl } from '../research/researchReport';
import type { AgentRunStepStateView, AgentRunView } from '../agent/agentRunClient';

/**
 * エージェント実況ビュー（ライブビュー）PR-L2。
 * 設計正本: AGENT_LIVE_VIEW_DESIGN_2026-11-13 §4・§5.1。
 *
 * エージェントの実処理はブラウザではなく検索とページ取得なので、
 * このパネルは「実際に取得したページのタイトル・URL・抜粋」を
 * ミニブラウザ風に映す。スクリーンショットや実ブラウザの埋め込みは
 * しない（§7）。表示は平易な項目タイトルと見たページの中身までで、
 * 生ログ・HTML・内部用語・エラーコードは出さない（作業工程表示
 * ルール 2026-11-09、エージェント画面の例外はノリさんの明示希望
 * 2026-11-13 による）。
 *
 * データは run 記録の stepsState（PR-L1 の liveDetail）。liveDetail
 * の無い旧記録・旧ステップは経過行だけで表示し、壊れない。
 */

type LiveStep = { toolName: string; params: Record<string, unknown> };

export type AgentLiveStatusHint = 'active' | 'completed' | 'failed' | 'held';

const TOOL_LABELS: Record<string, string> = {
  document_generator: '文書作成',
  code_interpreter: 'コード作成・確認',
  image_prompt_compiler: '画像の指示づくり',
  web_search_grounding: 'ウェブ調査',
  repository_explorer: 'ファイル一覧の確認',
  file_reader: 'ファイルの読み取り',
  file_writer: 'ファイルの作成・編集',
  verification_runner: 'テスト・動作確認',
};

function liveToolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? '作業';
}

/** 実行中ステップの平易な状態文（実態に即した表現に限る）。 */
function liveActivityLabel(toolName: string): string {
  const activities: Record<string, string> = {
    document_generator: '文書を作っています',
    code_interpreter: 'コードを作成・確認しています',
    image_prompt_compiler: '画像の指示を作っています',
    web_search_grounding: 'ウェブ調査をしています',
    repository_explorer: 'ファイル一覧を確認しています',
    file_reader: 'ファイルを読んでいます',
    file_writer: 'ファイルを作っています',
    verification_runner: 'テスト・動作確認をしています',
  };
  return activities[toolName] ?? '作業を進めています';
}

function stepStatusLabel(status: string): string {
  if (status === 'completed') return '完了';
  if (status === 'running') return '実行中';
  if (status === 'failed' || status === 'blocked') return '止まりました';
  return 'まだ';
}

function formatStepDuration(detail: AgentRunStepStateView['liveDetail']): string | null {
  if (!detail || typeof detail.startedAt !== 'number' || typeof detail.finishedAt !== 'number') return null;
  if (detail.finishedAt < detail.startedAt) return null;
  const seconds = Math.round((detail.finishedAt - detail.startedAt) / 1000);
  if (seconds < 1) return '1秒未満';
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes}分${rest}秒` : `${minutes}分`;
}

/**
 * 出典オリジンのファビコン（設計 §4.2）。クライアント側だけで完結
 * させ、第三者のファビコンサービスは使わない。読めなければ
 * ドメイン先頭文字のチップにフォールバックする。
 */
function SourceFavicon({ url, domain }: { url: string; domain?: string }) {
  const [failed, setFailed] = useState(false);
  const safe = safeExternalUrl(url);
  let origin: string | null = null;
  let host = domain ?? '';
  if (safe) {
    const parsed = new URL(safe);
    origin = parsed.origin;
    if (!host) host = parsed.hostname;
  }
  const letter = (host || '?').charAt(0).toUpperCase();
  if (!origin || failed) {
    return <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-origin-surface-muted text-[11px] font-black text-origin-muted">{letter}</span>;
  }
  return <img src={`${origin}/favicon.ico`} alt="" width={20} height={20} loading="lazy" onError={() => setFailed(true)} className="h-5 w-5 shrink-0 rounded" />;
}

type LiveRow = {
  step: LiveStep;
  index: number;
  state?: AgentRunStepStateView;
};

export default function AgentLivePanel({ steps, runView, statusHint, catState }: {
  steps: LiveStep[];
  runView: AgentRunView | null;
  statusHint: AgentLiveStatusHint;
  catState: OriginCatStateKind;
}) {
  const [selectedSource, setSelectedSource] = useState<{ stepId: string; index: number } | null>(null);

  const rows: LiveRow[] = steps.map((step, index) => ({
    step,
    index,
    state: runView?.stepsState.find((item) => item.id === `task-${index + 1}`) ?? runView?.stepsState[index],
  }));

  const runningRow = rows.find((row) => row.state?.status === 'running');
  const allCompleted = rows.length > 0 && rows.every((row) => row.state?.status === 'completed');

  let headline: string;
  if (allCompleted || runView?.status === 'completed' || statusHint === 'completed') {
    headline = '作業が完了しました';
  } else if (runView?.status === 'failed' || runView?.status === 'cancelled' || runView?.status === 'expired' || statusHint === 'failed') {
    headline = '作業が止まりました';
  } else if (runView?.status === 'held' || statusHint === 'held') {
    headline = '実行は保留中です';
  } else if (runningRow) {
    headline = liveActivityLabel(runningRow.step.toolName);
  } else {
    headline = '作業を進めています';
  }

  // 枠（アドレスバー＋本文）に映す対象: 出典を持つ調査ステップを
  // 優先し（実行中→最新の完了分）、無ければ実行中／直近のファイル
  // ステップの対象パスを出す。それ以外は枠自体を出さない。
  const researchRows = rows.filter((row) => row.step.toolName === 'web_search_grounding'
    && (row.state?.liveDetail?.sources?.length ?? 0) > 0);
  const focusResearch = researchRows.find((row) => row.state?.status === 'running')
    ?? researchRows[researchRows.length - 1];
  const currentRow = runningRow ?? [...rows].reverse().find((row) => row.state && row.state.status !== 'queued');
  const focusFile = !focusResearch && currentRow
    && (currentRow.step.toolName === 'file_reader' || currentRow.step.toolName === 'file_writer')
    && typeof currentRow.step.params.path === 'string' && currentRow.step.params.path.length > 0
    ? currentRow
    : undefined;

  const focusSources = focusResearch?.state?.liveDetail?.sources ?? [];
  const focusStepId = focusResearch?.state?.id ?? '';
  const selectedIndex = focusResearch
    ? (selectedSource && selectedSource.stepId === focusStepId
      ? Math.min(selectedSource.index, focusSources.length - 1)
      : 0)
    : 0;
  const focusSource = focusResearch ? focusSources[selectedIndex] : undefined;
  const focusHref = focusSource ? safeExternalUrl(focusSource.url) : null;
  const focusQuery = focusResearch?.state?.liveDetail?.query;
  const otherSources = focusSources
    .map((source, index) => ({ source, index }))
    .filter(({ index }) => index !== selectedIndex);

  return <section aria-label="いまの作業" className="p-4">
    <div className="flex items-center gap-2">
      <OriginCatState state={catState} size={32} />
      <h3 className="text-sm font-black">いまの作業</h3>
      <span className="text-sm font-semibold">{headline}</span>
    </div>

    {focusResearch && focusSource && <div className="mt-3">
      <div className="overflow-hidden rounded-xl border border-origin-border">
        <div className="border-b border-origin-border bg-origin-surface-muted px-3 py-2">
          <div className="flex items-start gap-2">
            <span className="mt-0.5"><SourceFavicon url={focusSource.url} domain={focusSource.domain} /></span>
            <div className="min-w-0">
              <p className="break-words text-sm font-bold leading-5">{focusSource.title}</p>
              <p className="break-all text-xs leading-5 text-origin-muted">{focusSource.url}</p>
            </div>
          </div>
          {focusHref
            ? <a href={focusHref} target="_blank" rel="noreferrer" className="origin-touch-link mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent-primary)] underline">原文を開く</a>
            : <p className="mt-1 text-xs font-semibold leading-5 text-amber-700 dark:text-amber-300">安全なHTTPS URLとして確認できないためリンクを無効化しました。</p>}
        </div>
        {focusQuery && <p className="px-3 pt-2 text-xs text-origin-muted">「{focusQuery}」で{focusResearch.state?.status === 'running' ? '調べています' : '調べました'}</p>}
        {focusSource.excerpt && <p className="whitespace-pre-wrap break-words px-3 py-2 text-sm leading-6">{focusSource.excerpt}</p>}
      </div>

      {otherSources.length > 0 && <div className="mt-2">
        <p className="text-xs font-bold text-origin-muted">ほかに見たページ</p>
        <ul className="mt-1 space-y-1">
          {otherSources.map(({ source, index }) => <li key={`${source.url}-${index}`}>
            <button type="button" onClick={() => setSelectedSource({ stepId: focusStepId, index })}
              className="origin-secondary-button flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left">
              <SourceFavicon url={source.url} domain={source.domain} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{source.title}</span>
              {source.domain && <span className="shrink-0 text-xs text-origin-muted">{source.domain}</span>}
            </button>
          </li>)}
        </ul>
      </div>}
    </div>}

    {focusFile && <div className="mt-3 rounded-xl border border-origin-border bg-origin-surface-muted px-3 py-2">
      <p className="text-xs font-bold text-origin-muted">対象のファイル</p>
      <p className="break-all text-sm font-semibold">{String(focusFile.step.params.path)}</p>
    </div>}

    <p className="mt-4 text-xs font-bold text-origin-muted">経過</p>
    <ol className="mt-1 space-y-1.5">
      {rows.map((row) => {
        const status = row.state?.status ?? 'queued';
        const duration = formatStepDuration(row.state?.liveDetail);
        const sourceCount = row.state?.liveDetail?.sources?.length ?? 0;
        const meta = [
          ...(sourceCount > 0 ? [`出典${sourceCount}件`] : []),
          ...(duration ? [duration] : []),
        ].join(' · ');
        return <li key={row.state?.id ?? `step-${row.index}`} className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="text-origin-muted">{row.index + 1}.</span>
          <span className="font-semibold">{liveToolLabel(row.step.toolName)}</span>
          <span className="inline-flex items-center gap-1 text-xs font-bold">
            {status === 'running' && <span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-current" />}
            {stepStatusLabel(status)}
          </span>
          {meta && <span className="text-xs text-origin-muted">{meta}</span>}
        </li>;
      })}
    </ol>
  </section>;
}

/**
 * 調査ステップの成果物（出典 JSON）の判定。最終ステップが調査の
 * run では、成果物は `{ provider, sources: [...] }` の JSON 文字列
 * で届く。それを生のまま見せず、出典カードで表示するための入口。
 * 形が合わなければ null を返し、呼び出し側は従来の Markdown 表示
 * にフォールバックする。
 */
export type AgentResearchArtifactSource = {
  title: string;
  url: string;
  domain?: string;
  excerpt?: string;
  evidenceLevel?: string;
};

export function parseAgentResearchArtifact(text: string): { sources: AgentResearchArtifactSource[] } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.provider !== 'string' || !Array.isArray(record.sources)) return null;
  const sources: AgentResearchArtifactSource[] = [];
  for (const raw of record.sources) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.title !== 'string' || typeof item.url !== 'string') continue;
    const source: AgentResearchArtifactSource = { title: item.title, url: item.url };
    if (typeof item.domain === 'string' && item.domain) source.domain = item.domain;
    if (typeof item.excerpt === 'string' && item.excerpt) source.excerpt = item.excerpt;
    if (typeof item.evidenceLevel === 'string' && item.evidenceLevel) source.evidenceLevel = item.evidenceLevel;
    sources.push(source);
  }
  return { sources };
}

/**
 * 調査成果物の出典カード表示（ResearchSourcesSection と同じ型）。
 * 抜粋は成果物そのものの中身なので、カード内にそのまま載せる。
 * URL は safeExternalUrl で検証できた場合だけリンクにする。
 */
export function AgentResearchSourceCards({ sources }: { sources: AgentResearchArtifactSource[] }) {
  return <section aria-label="出典">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="m-0 text-sm font-black">出典</h3>
      <span className="rounded-full border border-origin-border px-3 py-1 text-xs">{sources.length}件</span>
    </div>
    {sources.length === 0
      ? <p className="mt-3 text-sm text-origin-muted">取得できた出典はありませんでした。</p>
      : <div className="mt-3 space-y-3">{sources.map((source, index) => {
        const href = safeExternalUrl(source.url);
        return <article key={`${source.url}-${index}`} className="rounded-xl border border-origin-border p-3">
          <h4 className="break-words text-sm font-bold">{source.title}</h4>
          <p className="mt-1 text-xs text-origin-muted">
            {[source.domain, source.evidenceLevel ? (source.evidenceLevel === 'extracted' ? '本文確認済み' : '検索結果の要約') : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {source.excerpt && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{source.excerpt}</p>}
          {href
            ? <a href={href} target="_blank" rel="noreferrer" className="origin-touch-link mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent-primary)] underline">原文を開く</a>
            : <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">安全なHTTPS URLとして確認できないためリンクを無効化しました。</p>}
        </article>;
      })}</div>}
  </section>;
}
