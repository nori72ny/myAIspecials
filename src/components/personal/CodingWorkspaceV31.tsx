import React from 'react';
import CodingJobWorkspaceV14, { type CodingProjectEvidence } from '../CodingJobWorkspaceV14';

type CodingWorkspaceV31Props = { onProjectEvidenceChange?: (evidence: CodingProjectEvidence) => void };

export default function CodingWorkspaceV31({ onProjectEvidenceChange }: CodingWorkspaceV31Props) {
  return <section aria-label="ORIGIN Coding Workspace" className="min-h-0">
    <div className="origin-surface-muted border-b px-3 py-2 backdrop-blur md:px-5">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Code</span>
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Grounded execution evidence</span>
        <span className="ml-auto text-[11px] font-medium text-slate-500">Files / Diff / Tests は実結果のみ · Terminal / Checkpoint は未接続</span>
      </div>
    </div>
    <CodingJobWorkspaceV14 onProjectEvidenceChange={onProjectEvidenceChange} />
  </section>;
}
