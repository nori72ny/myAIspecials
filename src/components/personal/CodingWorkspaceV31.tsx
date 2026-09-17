import React from 'react';
import CodingJobWorkspaceV14 from '../CodingJobWorkspaceV14';

export default function CodingWorkspaceV31() {
  return <section aria-label="ORIGIN Coding Workspace" className="min-h-0">
    <div className="origin-surface-muted sticky top-0 z-30 border-b px-3 py-2 backdrop-blur md:px-5">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Code</span>
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Grounded execution evidence</span>
        <span className="ml-auto text-[11px] font-medium text-slate-500">Files / Diff / Tests は実結果のみ · Terminal / Checkpoint は未接続</span>
      </div>
    </div>
    <CodingJobWorkspaceV14 />
  </section>;
}
