import React from 'react';
import type { CodingProjectEvidence } from '../CodingJobWorkspaceV14';
import type { ResearchSource } from './ResearchWorkspaceV31';
import type { OriginProjectViewV31 } from './OriginProjectWorkspaceV31';

type OriginProjectNavigationV31Props = {
  sources: readonly ResearchSource[];
  codingEvidence: CodingProjectEvidence;
  onViewChange: (view: OriginProjectViewV31) => void;
};

export default function OriginProjectNavigationV31({ sources, codingEvidence, onViewChange }: OriginProjectNavigationV31Props) {
  const files = codingEvidence.changedPaths.length;
  const hasTask = Boolean(codingEvidence.jobId && codingEvidence.status);
  const sourceCount = sources.length;
  if (!files && !hasTask && !sourceCount) return null;

  return <section aria-label="Project navigation" className="mb-4 rounded-xl border border-origin-border p-2">
    <div className="mb-2 flex items-center justify-between gap-2 px-1">
      <h2 className="m-0 text-xs font-black uppercase tracking-wide">Project</h2>
      <span className="origin-muted text-xs">必要な項目のみ</span>
    </div>
    <div className="grid gap-1.5">
      {files > 0 && <button type="button" onClick={() => onViewChange('files')} className="origin-secondary-button flex min-h-11 items-center justify-between rounded-lg px-3 text-left text-sm font-semibold">
        <span>Files</span><span className="origin-muted text-xs">{files}</span>
      </button>}
      {hasTask && <button type="button" onClick={() => onViewChange('tasks')} className="origin-secondary-button flex min-h-11 items-center justify-between rounded-lg px-3 text-left text-sm font-semibold">
        <span>Tasks</span><span className="origin-muted text-xs">{codingEvidence.status}</span>
      </button>}
      {sourceCount > 0 && <button type="button" onClick={() => onViewChange('sources')} className="origin-secondary-button flex min-h-11 items-center justify-between rounded-lg px-3 text-left text-sm font-semibold">
        <span>Sources</span><span className="origin-muted text-xs">{sourceCount}</span>
      </button>}
    </div>
  </section>;
}
