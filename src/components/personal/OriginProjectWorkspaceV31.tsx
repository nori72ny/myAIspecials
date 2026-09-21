import React from 'react';
import type { ArtifactBlock, ConversationMessage, ConversationSession } from '../../App';
import type { OriginWorkspaceModeV31 } from './OriginWorkspaceShellV31';
import type { ResearchSource } from './ResearchWorkspaceV31';
import type { CodingProjectEvidence } from '../CodingJobWorkspaceV14';

export type OriginProjectViewV31 = 'overview' | 'chat' | 'files' | 'tasks' | 'artifacts' | 'sources';

type ProjectViewItem = {
  id: OriginProjectViewV31;
  label: string;
  available: boolean;
  detail: string;
};

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
  mode,
  messages,
  sessions,
  artifacts,
  sources,
  codingEvidence,
  activeView,
  onViewChange,
}: OriginProjectWorkspaceV31Props) {
  const views: readonly ProjectViewItem[] = [
    { id: 'overview', label: 'Overview', available: true, detail: '現在のProject状況' },
    { id: 'chat', label: 'Chat', available: true, detail: `${messages.length} messages · ${sessions.length} sessions` },
    { id: 'files', label: 'Files', available: codingEvidence.changedPaths.length > 0, detail: codingEvidence.changedPaths.length > 0 ? `${codingEvidence.changedPaths.length} changed files` : (mode === 'coding' ? '変更ファイルはまだありません' : 'Code実行証拠が必要') },
    { id: 'tasks', label: 'Tasks', available: Boolean(codingEvidence.jobId && codingEvidence.status), detail: codingEvidence.status ? `Coding job · ${codingEvidence.status}` : '実Agent jobが必要' },
    { id: 'artifacts', label: 'Artifacts', available: artifacts.length > 0, detail: artifacts.length > 0 ? `${artifacts.length} artifacts` : '成果物はまだありません' },
    { id: 'sources', label: 'Sources', available: sources.length > 0, detail: sources.length > 0 ? `${sources.length} verified sources` : (mode === 'research' ? 'Research結果がまだありません' : 'Research結果が必要') },
  ];

  const availableEvidenceCount = Number(artifacts.length > 0) + Number(sources.length > 0) + Number(codingEvidence.changedPaths.length > 0) + Number(Boolean(codingEvidence.jobId && codingEvidence.status));
  const projectLabel = availableEvidenceCount > 0 ? `Project · ${availableEvidenceCount}` : 'Project';

  return <section aria-label="Project Workspace" className="origin-project-context px-3 sm:px-5">
    <div className="mx-auto w-full max-w-7xl">
      <details className="group relative inline-block py-2">
        <summary className="origin-muted flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-full px-2 text-xs font-semibold hover:bg-origin-surface-muted">
          <span>{projectLabel}</span>
          {activeView !== 'overview' && <span className="origin-badge inline-flex min-h-6 items-center border px-2 text-[10px] font-bold">{views.find(view => view.id === activeView)?.label}</span>}
        </summary>
        <div className="origin-card absolute left-0 z-40 mt-1 w-[min(40rem,calc(100vw-1.5rem))] border p-3 shadow-xl sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="origin-muted m-0 text-[10px] font-bold uppercase tracking-[0.16em]">Project</p>
              <h2 className="m-0 mt-1 text-sm font-black">Current workspace</h2>
            </div>
            <span className="origin-muted text-[11px]">Grounded state only</span>
          </div>

          <nav aria-label="Project views" className="flex flex-wrap gap-2">
            {views.map((view) => {
              const selected = activeView === view.id;
              return <button
                key={view.id}
                type="button"
                aria-pressed={view.available ? selected : undefined}
                aria-label={view.available ? `Project ${view.label}` : `Project ${view.label} unavailable`}
                disabled={!view.available}
                onClick={() => view.available && onViewChange(view.id)}
                className={`min-h-10 rounded-full border px-3 text-left text-xs font-semibold ${selected ? 'origin-primary-button' : 'origin-secondary-button'} disabled:opacity-45`}
              >
                <span>{view.label}</span>
                {view.available && view.id !== 'overview' && <span className="origin-muted ml-2 hidden text-[10px] sm:inline">{view.detail}</span>}
              </button>;
            })}
          </nav>
        </div>
      </details>

      {activeView === 'files' && codingEvidence.changedPaths.length > 0 && <section aria-label="Project Files" className="origin-card mb-3 border p-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="m-0 text-sm font-black">Changed files</h3>
          <span className="origin-muted text-xs">{codingEvidence.changedPaths.length} grounded paths</span>
        </div>
        <ul className="m-0 mt-2 space-y-2 p-0">
          {codingEvidence.changedPaths.map((path) => <li key={path} className="list-none rounded-lg border border-origin-border p-3 font-mono text-xs break-all">{path}</li>)}
        </ul>
      </section>}
      {activeView === 'tasks' && codingEvidence.jobId && codingEvidence.status && <section aria-label="Project Tasks" className="origin-card mb-3 border p-3">
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
      {activeView === 'sources' && sources.length > 0 && <section aria-label="Project Sources" className="origin-card mb-3 border p-3">
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
