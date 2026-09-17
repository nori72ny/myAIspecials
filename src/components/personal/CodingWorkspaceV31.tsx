import React from 'react';
import CodingJobWorkspaceV14 from '../CodingJobWorkspaceV14';

type CodingWorkspaceTarget = 'files' | 'diff' | 'tests';

const TARGETS: Record<CodingWorkspaceTarget, string> = {
  files: 'coding-diff-title',
  diff: 'coding-diff-title',
  tests: 'coding-verification-title',
};

function jumpTo(target: CodingWorkspaceTarget) {
  document.getElementById(TARGETS[target])?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function CodingWorkspaceV31() {
  return <section aria-label="ORIGIN Coding Workspace" className="min-h-0">
    <div className="origin-surface-muted sticky top-0 z-30 border-b px-3 py-2 backdrop-blur md:px-5">
      <div className="mx-auto flex max-w-[1600px] items-center gap-2 overflow-x-auto" role="navigation" aria-label="Coding workspace sections">
        <span className="shrink-0 pr-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Code</span>
        <button type="button" onClick={() => jumpTo('files')} className="origin-secondary-button min-h-11 shrink-0 rounded-lg border px-3 text-sm font-semibold">Files</button>
        <button type="button" onClick={() => jumpTo('diff')} className="origin-secondary-button min-h-11 shrink-0 rounded-lg border px-3 text-sm font-semibold">Diff</button>
        <button type="button" disabled title="Terminal output is not yet exposed by the V1.4 result contract" className="min-h-11 shrink-0 cursor-not-allowed rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-400 opacity-70 dark:border-slate-800">Terminal · 準備中</button>
        <button type="button" onClick={() => jumpTo('tests')} className="origin-secondary-button min-h-11 shrink-0 rounded-lg border px-3 text-sm font-semibold">Tests</button>
        <button type="button" disabled title="Checkpoint restore is not yet backed by a server-owned rollback contract" className="min-h-11 shrink-0 cursor-not-allowed rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-400 opacity-70 dark:border-slate-800">Checkpoint · 準備中</button>
        <span className="ml-auto hidden shrink-0 text-[11px] font-medium text-slate-500 lg:inline">実データのみ表示 · 未接続機能は無効化</span>
      </div>
    </div>
    <CodingJobWorkspaceV14 />
  </section>;
}
