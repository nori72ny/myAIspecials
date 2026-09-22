import React from 'react';
import type { ArtifactBlock, ConversationMessage, ConversationSession } from '../../App';
import type { OriginWorkspaceModeV31 } from './OriginWorkspaceShellV31';
import type { ResearchSource } from './ResearchWorkspaceV31';
import type { CodingProjectEvidence } from '../CodingJobWorkspaceV14';

export type OriginProjectViewV31 = 'overview' | 'chat' | 'files' | 'tasks' | 'artifacts' | 'sources';

type OriginProjectWorkspaceV31Props = {
  mode: OriginWorkspaceModeV31;
  messages: readonly ConversationMessage[];
  sessions: readonly ConversationSession[];
  artifacts: readonly ArtifactBlock[];
  sources: readonly ResearchSource[];
  codingEvidence: CodingProjectEvidence;
  activeView: OriginProjectViewV31;
  onViewChange: (view: OriginProjectViewV31) => void;
};

export default function OriginProjectWorkspaceV31({
  sources,
  codingEvidence,
  activeView,
}: OriginProjectWorkspaceV31Props) {
  const showFiles = activeView === 'files' && codingEvidence.changedPaths.length > 0;
  const showTasks = activeView === 'tasks' && Boolean(codingEvidence.jobId && codingEvidence.status);
  const showSources = activeView === 'sources' && sources.length > 0;
  if (!showFiles && !showTasks && !showSources) return null;

  return <section aria-label="Project Workspace" className="origin-project-context px-3 py-2 sm:px-5">
    <div className="mx-auto w-full max-w-7xl">
      {showFiles && <section aria-label="Project Files" className="origin-card border p-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="m-0 text-sm font-black">Changed files</h3>
          <span className="origin-muted text-xs">{codingEvidence.changedPaths.length} grounded paths</span>
        </div>
        <ul className="m-0 mt-2 space-y-2 p-0">
          {codingEvidence.changedPaths.map((path) => <li key={path} className="list-none rounded-lg border border-origin-border p-3 font-mono text-xs break-all">{path}</li>)}
        </ul>
      </section>}
      {showTasks && codingEvidence.jobId && codingEvidence.status && <section aria-label="Project Tasks" className="origin-card border p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="m-0 text-sm font-black">Coding task</h3>
          <span className="origin-muted text-xs">{codingEvidence.status}</span>
        </div>
        <p className="origin-muted m-0 mt-2 break-all font-mono text-xs">{codingEvidence.jobId}</p>
        {codingEvidence.verificationChecks.length > 0 && <ul className="m-0 mt-3 grid gap-2 p-0 sm:grid-cols-2">
          {codingEvidence.verificationChecks.map((check, index) => <li key={`${check.kind}-${check.attempt}-${index}`} className="list-none rounded-lg border border-origin-border p-3 text-xs">
            <strong>{check.kind}</strong> · {check.ok ? 'passed' : check.timedOut ? 'timed out' : 'failed'} · attempt {check.attempt}
          </li>)}
        </ul>}
      </section>}
      {showSources && <section aria-label="Project Sources" className="origin-card border p-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="m-0 text-sm font-black">Research Sources</h3>
          <span className="origin-muted text-xs">{sources.length} verified</span>
        </div>
        <ul className="m-0 mt-2 space-y-2 p-0">
          {sources.map((source) => <li key={source.id} className="list-none rounded-lg border border-origin-border p-3">
            <p className="m-0 text-xs font-black">{source.title}</p>
            <p className="origin-muted m-0 mt-1 text-xs">{source.domain} · {source.evidenceLevel} · {source.freshness}</p>
          </li>)}
        </ul>
      </section>}
    </div>
  </section>;
}
