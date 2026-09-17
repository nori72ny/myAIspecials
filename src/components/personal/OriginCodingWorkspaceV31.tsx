import React, { useState } from 'react';

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

type WorkspaceTab = 'files' | 'diff' | 'tests' | 'terminal' | 'checkpoint';

type Props = {
  result: OriginCodingResultV31 | null;
  state: OriginCodingResultStateV31;
  changedPaths: string[];
};

const CHECKS: readonly OriginCodingVerificationKindV31[] = ['typecheck', 'lint', 'test', 'build'];
const TABS: readonly Array<{ id: WorkspaceTab; label: string; availability: 'live' | 'unavailable' }> = [
  { id: 'files', label: 'Files', availability: 'live' },
  { id: 'diff', label: 'Diff', availability: 'live' },
  { id: 'tests', label: 'Tests', availability: 'live' },
  { id: 'terminal', label: 'Terminal', availability: 'unavailable' },
  { id: 'checkpoint', label: 'Checkpoint', availability: 'unavailable' },
];

function EmptyEvidence({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm leading-6 text-slate-500 dark:border-slate-700">{children}</div>;
}

function UnavailableNotice({ children }: { children: React.ReactNode }) {
  return <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">{children}</div>;
}

function FilesPanel({ result, state, changedPaths }: Props) {
  const kindByPath = new Map(result?.diffs.map(diff => [diff.path, diff.kind]) ?? []);
  return <div className="space-y-3">
    {state === 'unavailable' && <UnavailableNotice>暗号化された差分詳細を取得できませんでした。サーバーが返した changed paths のみ表示します。</UnavailableNotice>}
    {changedPaths.length === 0
      ? <EmptyEvidence>変更ファイルはまだ確定していません。</EmptyEvidence>
      : <ul className="space-y-2" aria-label="Changed files">{changedPaths.map(path => <li key={path} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
          <code className="min-w-0 break-all text-xs font-semibold">{path}</code>
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">{kindByPath.get(path) ?? 'changed'}</span>
        </li>)}</ul>}
  </div>;
}

function DiffPanel({ result, state, changedPaths }: Props) {
  return <div className="space-y-4">
    {state === 'unavailable' && <UnavailableNotice>暗号化された差分詳細を取得できませんでした。ジョブ状態と changed paths は保持されています。</UnavailableNotice>}
    {changedPaths.length === 0 && !result?.diffs.length ? <EmptyEvidence>変更はまだ確定していません。</EmptyEvidence> : null}
    {result?.diffs.map((diff, index) => <article key={`${diff.path}-${index}`} className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/70">
        <code className="break-all text-xs font-semibold">{diff.path}</code>
        <span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] font-bold uppercase text-slate-700 dark:bg-slate-800 dark:text-slate-300">{diff.kind}</span>
      </header>
      {!diff.previewAvailable
        ? <p className="p-4 text-xs leading-5 text-slate-500">Preview unavailable; path-level change evidence remains available.</p>
        : <div className="grid md:grid-cols-2">
            <div className="min-w-0 border-b border-slate-200 md:border-b-0 md:border-r dark:border-slate-800">
              <div className="border-b border-slate-200 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:border-slate-800 dark:text-rose-300">Before</div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5">{diff.before ?? '(new file)'}</pre>
              {diff.beforeTruncated && <p className="px-3 pb-3 text-[10px] font-bold text-amber-700 dark:text-amber-300">Preview truncated</p>}
            </div>
            <div className="min-w-0">
              <div className="border-b border-slate-200 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:border-slate-800 dark:text-emerald-300">After</div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5">{diff.after ?? '(unavailable)'}</pre>
              {diff.afterTruncated && <p className="px-3 pb-3 text-[10px] font-bold text-amber-700 dark:text-amber-300">Preview truncated</p>}
            </div>
          </div>}
    </article>)}
    {!result?.diffs.length && changedPaths.map(path => <div key={path} className="rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs dark:border-slate-800">{path}</div>)}
  </div>;
}

function TestsPanel({ result, state }: Pick<Props, 'result' | 'state'>) {
  const byKind = new Map(result?.verificationChecks.map(check => [check.kind, check]) ?? []);
  const absentLabel = result ? 'NOT RUN' : state === 'unavailable' ? 'N/A' : state === 'not_applicable' ? 'CANCELLED' : 'WAIT';
  const absentDetail = result ? 'not executed before terminal stop' : state === 'unavailable' ? 'result unavailable' : state === 'not_applicable' ? 'job cancelled' : 'pending';

  return <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{CHECKS.map(kind => {
    const check = byKind.get(kind);
    return <div key={kind} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{kind}</span>
        <span className={`text-sm font-black ${check?.ok ? 'text-emerald-600 dark:text-emerald-300' : check ? 'text-rose-600 dark:text-rose-300' : 'text-slate-400'}`}>{check ? check.ok ? 'PASS' : 'FAIL' : absentLabel}</span>
      </div>
      <p className="mt-2 text-xs text-slate-500">{check ? `exit ${check.exitCode ?? 'null'}${check.timedOut ? ' · timeout' : ''}` : absentDetail}</p>
    </div>;
  })}</div>;
}

function UnsupportedPanel({ kind }: { kind: 'Terminal' | 'Checkpoint' }) {
  const isTerminal = kind === 'Terminal';
  return <UnavailableNotice>
    <strong className="block text-sm">{kind}はV1.4 runtimeから提供されていません。</strong>
    <span className="mt-1 block text-xs leading-5">{isTerminal
      ? 'workerの生ログや擬似コマンド出力は生成しません。安全に公開できる実行ログAPIが追加された時だけ、この面へ接続します。'
      : '巻き戻し可能なcheckpoint IDや復元APIがないため、Undoできるようには見せません。永続checkpointが実装された時だけ有効化します。'}</span>
  </UnavailableNotice>;
}

export default function OriginCodingWorkspaceV31(props: Props) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('files');
  const changedCount = props.changedPaths.length;
  const checkCount = props.result?.verificationChecks.length ?? 0;

  return <section className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-900/50" aria-labelledby="coding-workspace-v31-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Coding Workspace</p>
        <h2 id="coding-workspace-v31-title" className="mt-1 text-lg font-black">Files · Diff · Tests · Terminal · Checkpoint</h2>
      </div>
      <div className="flex flex-wrap gap-2 text-[10px] font-bold text-slate-500">
        <span className="rounded-full border border-slate-200 px-2 py-1 dark:border-slate-700">{changedCount} files</span>
        <span className="rounded-full border border-slate-200 px-2 py-1 dark:border-slate-700">{checkCount} checks</span>
        {props.result && <span className="rounded-full border border-slate-200 px-2 py-1 dark:border-slate-700">repair {props.result.repairRounds}</span>}
      </div>
    </div>

    <div className="mt-4 overflow-x-auto pb-1">
      <div role="tablist" aria-label="Coding workspace views" className="flex min-w-max gap-2">
        {TABS.map(tab => <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={`coding-workspace-panel-${tab.id}`}
          id={`coding-workspace-tab-${tab.id}`}
          onClick={() => setActiveTab(tab.id)}
          className={`min-h-11 rounded-xl border px-3 text-sm font-bold ${activeTab === tab.id ? 'border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-200' : 'border-slate-200 bg-white/70 text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300'}`}
        >
          {tab.label}{tab.availability === 'unavailable' && <span className="ml-2 text-[9px] font-bold uppercase text-amber-700 dark:text-amber-300">Unavailable</span>}
        </button>)}
      </div>
    </div>

    <div className="mt-4">
      <div role="tabpanel" id="coding-workspace-panel-files" aria-labelledby="coding-workspace-tab-files" hidden={activeTab !== 'files'}><FilesPanel {...props} /></div>
      <div role="tabpanel" id="coding-workspace-panel-diff" aria-labelledby="coding-workspace-tab-diff" hidden={activeTab !== 'diff'}><DiffPanel {...props} /></div>
      <div role="tabpanel" id="coding-workspace-panel-tests" aria-labelledby="coding-workspace-tab-tests" hidden={activeTab !== 'tests'}><TestsPanel result={props.result} state={props.state} /></div>
      <div role="tabpanel" id="coding-workspace-panel-terminal" aria-labelledby="coding-workspace-tab-terminal" hidden={activeTab !== 'terminal'}><UnsupportedPanel kind="Terminal" /></div>
      <div role="tabpanel" id="coding-workspace-panel-checkpoint" aria-labelledby="coding-workspace-tab-checkpoint" hidden={activeTab !== 'checkpoint'}><UnsupportedPanel kind="Checkpoint" /></div>
    </div>
  </section>;
}
