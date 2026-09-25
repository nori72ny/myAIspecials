import React from 'react';
import type { ArtifactBlock, ConversationMessage, ConversationSession } from '../../App';
import type { OriginWorkspaceModeV31 } from './OriginWorkspaceModeV31';
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
    { id: 'artifacts', label: 'Artifacts', available: artifacts.length > 0, detail: artifacts.length > 0 ? `${artifacts.length} artifacts` : '作成物はまだありません' },
    { id: 'sources', label: 'Sources', available: sources.length > 0, detail: sources.length > 0 ? `${sources.length} verified sources` : (mode === 'research' ? 'Research結果がまだありません' : 'Research結果が必要') },
  ];

  return <section aria-label="Project Workspace" className="origin-surface border-b border-origin-border px-3 py-2 sm:px-5 sm:py-3">
    <div className="mx-auto w-full max-w-7xl">
      <div className="hidden items-center justify-between gap-3 md:flex">
        <div>
          <p className="origin-muted m-0 text-[10px] font-bold uppercase tracking-[0.18em]">Details</p>
          <h2 className="m-0 mt-1 text-sm font-black">現在の情報</h2>
        </div>
        <span className="origin-muted text-xs">{messages.length} messages · {artifacts.length} artifacts</span>
      </div>

      <nav aria-label="Project views" className="mt-3 hidden gap-2 overflow-x-auto md:flex">
        {views.filter((view) => view.available).map((view) => {
          const selected = activeView === view.id;
          return <button
            key={view.id}
            type="button"
            aria-pressed={selected}
            aria-label={`Project ${view.label}`}
            onClick={() => onViewChange(view.id)}
            className={`min-h-11 shrink-0 rounded-lg border px-3 text-left text-xs font-semibold ${selected ? 'origin-primary-button' : 'origin-secondary-button'}`}
          >
            <span className="block text-sm font-bold">{view.label}</span>
            <span className="origin-muted block max-w-44 truncate font-normal">{view.detail}</span>
          </button>;
        })}
      </nav>

      <div className="mt-3 md:hidden">
        <label htmlFor="origin-project-view" className="origin-muted block text-xs font-bold">Project view</label>
        <select
          id="origin-project-view"
          value={activeView}
          onChange={(event) => onViewChange(event.target.value as OriginProjectViewV31)}
          className="origin-interactive-target mt-1 min-h-11 w-full rounded-lg border border-origin-border bg-transparent px-3 text-sm font-semibold"
        >
          {views.filter((view) => view.available).map((view) => <option key={view.id} value={view.id}>{view.label}</option>)}
        </select>
      </div>

      {activeView === 'overview' && <p className="origin-muted m-0 mt-3 hidden text-sm md:block">必要な証拠や作成物ができた時だけ、ここに追加の詳細が表示されます。</p>}
      {activeView === 'files' && codingEvidence.changedPaths.length > 0 && <section aria-label="Project Files" className="mt-3 origin-card border p-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="m-0 text-sm font-black">Changed files</h3>
          <span className="origin-muted text-xs">{codingEvidence.changedPaths.length} grounded paths</span>
        </div>
        <ul className="m-0 mt-2 space-y-2 p-0">
          {codingEvidence.changedPaths.map((path) => <li key={path} className="list-none rounded-lg border border-origin-border p-3 font-mono text-xs break-all">{path}</li>)}
        </ul>
      </section>}
      {activeView === 'tasks' && codingEvidence.jobId && codingEvidence.status && <section aria-label="Project Tasks" className="mt-3 origin-card border p-3">
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
      {activeView === 'sources' && sources.length > 0 && <section aria-label="Project Sources" className="mt-3 origin-card border p-3">
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
