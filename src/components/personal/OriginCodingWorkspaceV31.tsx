import React, { useEffect, useRef, useState } from 'react';

export type OriginCodingResultStateV31 = 'pending' | 'available' | 'unavailable' | 'not_applicable';
export type OriginCodingVerificationKindV31 = 'typecheck' | 'lint' | 'test' | 'build';

export type OriginCodingResultV31 = {
  repairRounds: number;
  diffs: Array<{
    path: string;
    kind: 'modified' | 'created';
    before: string | null;
    after: string | null;
    beforeTruncated: boolean;
    afterTruncated: boolean;
    previewAvailable: boolean;
  }>;
  verificationChecks: Array<{
    kind: OriginCodingVerificationKindV31;
    ok: boolean;
    exitCode: number | null;
    timedOut: boolean;
    attempt: number;
  }>;
};

type WorkspaceTab = 'files' | 'diff' | 'tests';

type Props = {
  result: OriginCodingResultV31 | null;
  state: OriginCodingResultStateV31;
  changedPaths: string[];
};

const CHECKS: readonly OriginCodingVerificationKindV31[] = ['typecheck', 'lint', 'test', 'build'];
const CHECK_KIND_LABELS: Record<OriginCodingVerificationKindV31, string> = { typecheck: '型チェック', lint: '書き方のチェック', test: 'テスト', build: 'ビルド' };
const DIFF_KIND_LABELS: Record<string, string> = { modified: '変更', created: '新規', changed: '変更あり' };
const TABS: ReadonlyArray<{ id: WorkspaceTab; label: string }> = [
  { id: 'files', label: 'ファイル' },
  { id: 'diff', label: '変更内容' },
  { id: 'tests', label: '確認結果' },
];

function EmptyEvidence({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-origin-border p-6 text-center text-sm leading-6 text-origin-muted">{children}</div>;
}

function UnavailableNotice({ children }: { children: React.ReactNode }) {
  return <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">{children}</div>;
}

function verificationState(result: OriginCodingResultV31 | null, state: OriginCodingResultStateV31, kind: OriginCodingVerificationKindV31) {
  const check = result?.verificationChecks.find(item => item.kind === kind);
  const label = check ? check.ok ? '問題なし' : '問題あり' : result ? '未実施' : state === 'unavailable' ? '対象外' : state === 'not_applicable' ? '取り消し済み' : '確認中';
  const detail = check ? `終了コード ${check.exitCode ?? 'null'}${check.timedOut ? ' · 時間切れ' : ''}` : result ? '終わる前に止まったため、実施していません' : state === 'unavailable' ? '結果を取得できませんでした' : state === 'not_applicable' ? '取り消されたため、実施していません' : 'まだ実施していません';
  return { check, label, detail };
}

function FilesPanel({ result, state, changedPaths }: Props) {
  const kindByPath = new Map(result?.diffs.map(diff => [diff.path, diff.kind]) ?? []);
  return <div className="space-y-3" aria-labelledby="coding-files-title">
    <h3 id="coding-files-title" className="sr-only">ファイル</h3>
    {state === 'unavailable' && <UnavailableNotice>詳しい変更内容を取得できませんでした。変更したファイル名だけを表示します。</UnavailableNotice>}
    {changedPaths.length === 0
      ? <EmptyEvidence>変更したファイルはまだ決まっていません。</EmptyEvidence>
      : <ul className="space-y-2" aria-label="変更したファイル">{changedPaths.map(path => <li key={path} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-origin-border bg-origin-surface/70 px-3 py-2">
          <code className="min-w-0 break-all text-xs font-semibold">{path}</code>
          <span className="shrink-0 rounded-full bg-origin-surface-muted px-2 py-1 text-[10px] font-bold uppercase text-origin-muted">{DIFF_KIND_LABELS[kindByPath.get(path) ?? 'changed'] ?? '変更あり'}</span>
        </li>)}</ul>}
  </div>;
}

function DiffPanel({ result, state, changedPaths }: Props) {
  return <div className="space-y-4" aria-labelledby="coding-diff-title">
    <h3 id="coding-diff-title" className="sr-only">変更内容</h3>
    {state === 'unavailable' && <UnavailableNotice>詳しい変更内容を取得できませんでした。依頼の状態とファイル名は残っています。</UnavailableNotice>}
    {changedPaths.length === 0 && !result?.diffs.length ? <EmptyEvidence>変更内容はまだ決まっていません。</EmptyEvidence> : null}
    {result?.diffs.map((diff, index) => <article key={`${diff.path}-${index}`} className="overflow-hidden rounded-xl border border-origin-border">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-origin-border bg-origin-surface-muted px-3 py-2">
        <code className="break-all text-xs font-semibold">{diff.path}</code>
        <span className="rounded-full bg-origin-surface-muted px-2 py-1 text-[10px] font-bold text-origin-ink">{DIFF_KIND_LABELS[diff.kind] ?? diff.kind}</span>
      </header>
      {!diff.previewAvailable
        ? <p className="p-4 text-xs leading-5 text-origin-muted">変更内容のプレビューは表示できません。ファイル名だけを表示します。</p>
        : <div className="grid md:grid-cols-2">
            <div className="min-w-0 border-b border-origin-border md:border-b-0 md:border-r">
              <div className="border-b border-origin-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-300">変更前</div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5">{diff.before ?? '（新規ファイル）'}</pre>
              {diff.beforeTruncated && <p className="px-3 pb-3 text-[10px] font-bold text-amber-700 dark:text-amber-300">一部だけ表示しています</p>}
            </div>
            <div className="min-w-0">
              <div className="border-b border-origin-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-300">変更後</div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5">{diff.after ?? '（取得できませんでした）'}</pre>
              {diff.afterTruncated && <p className="px-3 pb-3 text-[10px] font-bold text-amber-700 dark:text-amber-300">一部だけ表示しています</p>}
            </div>
          </div>}
    </article>)}
    {!result?.diffs.length && changedPaths.map(path => <div key={path} className="rounded-xl border border-origin-border px-3 py-2 font-mono text-xs">{path}</div>)}
  </div>;
}

function TestsPanel({ result, state }: Pick<Props, 'result' | 'state'>) {
  return <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-labelledby="coding-verification-title">
    <h3 id="coding-verification-title" className="sr-only">確認結果</h3>
    {CHECKS.map(kind => {
      const { check, label, detail } = verificationState(result, state, kind);
      return <div key={kind} className="rounded-xl border border-origin-border p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold tracking-wide text-origin-muted">{CHECK_KIND_LABELS[kind]}</span>
          <span className={`text-sm font-black ${check?.ok ? 'text-emerald-600 dark:text-emerald-300' : check ? 'text-rose-600 dark:text-rose-300' : 'text-origin-placeholder'}`}>{label}</span>
        </div>
        <p className="mt-2 text-xs text-origin-muted">{detail}</p>
      </div>;
    })}
  </div>;
}

function VerificationSnapshot({ result, state }: Pick<Props, 'result' | 'state'>) {
  return <div className="mt-3 flex flex-wrap gap-2" aria-label="Verification snapshot">{CHECKS.map(kind => {
    const { check, label } = verificationState(result, state, kind);
    return <span key={kind} className="inline-flex items-center gap-2 rounded-full border border-origin-border px-2 py-1 text-[10px] font-bold">
      <span className="text-origin-muted">{CHECK_KIND_LABELS[kind]}</span>
      <span className={check?.ok ? 'text-emerald-600 dark:text-emerald-300' : check ? 'text-rose-600 dark:text-rose-300' : 'text-origin-muted'}>{label}</span>
    </span>;
  })}</div>;
}

export default function OriginCodingWorkspaceV31(props: Props) {
  const hasEvidence = props.result !== null || props.changedPaths.length > 0 || props.state !== 'pending';
  const [selectedTab, setSelectedTab] = useState<WorkspaceTab>('files');
  const manualSelectionRef = useRef(false);
  const changedCount = props.changedPaths.length;
  const checkCount = props.result?.verificationChecks.length ?? 0;
  const diffCount = props.result?.diffs.length ?? 0;

  useEffect(() => {
    if (props.state === 'pending' && props.result === null && props.changedPaths.length === 0) {
      manualSelectionRef.current = false;
      setSelectedTab('files');
      return;
    }
    if (!manualSelectionRef.current && diffCount > 0) setSelectedTab('diff');
  }, [diffCount, props.changedPaths.length, props.result, props.state]);

  const selectTab = (tab: WorkspaceTab) => {
    manualSelectionRef.current = true;
    setSelectedTab(tab);
  };

  if (!hasEvidence) return null;

  return <section className="rounded-2xl border border-origin-border bg-origin-surface/70 p-4" aria-labelledby="coding-workspace-v31-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-origin-muted">結果</p>
        <h2 id="coding-workspace-v31-title" className="mt-1 text-lg font-black">変更内容と確認結果</h2>
      </div>
      <div className="flex flex-wrap gap-2 text-[10px] font-bold text-origin-muted">
        <span className="rounded-full border border-origin-border px-2 py-1">{changedCount}件のファイル</span>
        <span className="rounded-full border border-origin-border px-2 py-1">{checkCount}件の確認</span>
        {props.result && <span className="rounded-full border border-origin-border px-2 py-1">修正 {props.result.repairRounds}回</span>}
      </div>
    </div>

    <VerificationSnapshot result={props.result} state={props.state} />

    <div className="mt-4 overflow-x-auto pb-1">
      <div role="tablist" aria-label="Coding workspace views" className="flex min-w-max gap-2">
        {TABS.map(tab => <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={selectedTab === tab.id}
          aria-controls={`coding-workspace-panel-${tab.id}`}
          id={`coding-workspace-tab-${tab.id}`}
          onClick={() => selectTab(tab.id)}
          className={`min-h-11 rounded-xl border px-3 text-sm font-bold ${selectedTab === tab.id ? 'border-origin-brand-border bg-origin-brand-soft text-origin-brand' : 'border-origin-border bg-origin-surface/70 text-origin-muted'}`}
        >
          {tab.label}
        </button>)}
      </div>
    </div>

    <div className="mt-4" role="tabpanel" id={`coding-workspace-panel-${selectedTab}`} aria-labelledby={`coding-workspace-tab-${selectedTab}`}>
      {selectedTab === 'files' && <FilesPanel {...props} />}
      {selectedTab === 'diff' && <DiffPanel {...props} />}
      {selectedTab === 'tests' && <TestsPanel result={props.result} state={props.state} />}
    </div>
  </section>;
}