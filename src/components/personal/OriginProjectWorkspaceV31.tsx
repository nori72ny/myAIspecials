import React from 'react';
import type { ArtifactBlock, ConversationMessage, ConversationSession } from '../../App';
import type { OriginWorkspaceModeV31 } from './OriginWorkspaceShellV31';

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
  activeView: OriginProjectViewV31;
  onViewChange: (view: OriginProjectViewV31) => void;
};

export default function OriginProjectWorkspaceV31({
  mode,
  messages,
  sessions,
  artifacts,
  activeView,
  onViewChange,
}: OriginProjectWorkspaceV31Props) {
  const completedArtifacts = artifacts.filter((artifact) => artifact.isComplete).length;
  const views: readonly ProjectViewItem[] = [
    { id: 'overview', label: 'Overview', available: true, detail: '現在のProject状況' },
    { id: 'chat', label: 'Chat', available: true, detail: `${messages.length} messages · ${sessions.length} sessions` },
    { id: 'files', label: 'Files', available: false, detail: mode === 'coding' ? 'Code実行証拠との接続準備中' : 'Code Modeの実行証拠が必要' },
    { id: 'tasks', label: 'Tasks', available: false, detail: '実Agent jobとの接続準備中' },
    { id: 'artifacts', label: 'Artifacts', available: artifacts.length > 0, detail: artifacts.length > 0 ? `${artifacts.length} artifacts` : '成果物はまだありません' },
    { id: 'sources', label: 'Sources', available: false, detail: mode === 'research' ? 'Research結果との接続準備中' : 'Research結果が必要' },
  ];

  return <section aria-label="Project Workspace" className="origin-surface border-b border-origin-border px-3 py-3 sm:px-5">
    <div className="mx-auto w-full max-w-7xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="origin-muted m-0 text-[10px] font-bold uppercase tracking-[0.18em]">Project</p>
          <h2 className="m-0 mt-1 text-sm font-black">Current workspace</h2>
        </div>
        <span className="origin-badge hidden min-h-8 items-center border px-3 text-xs font-bold sm:inline-flex">Grounded state only</span>
      </div>

      <nav aria-label="Project views" className="mt-3 hidden gap-2 overflow-x-auto md:flex">
        {views.map((view) => {
          const selected = activeView === view.id;
          return <button
            key={view.id}
            type="button"
            aria-pressed={view.available ? selected : undefined}
            aria-label={view.available ? `Project ${view.label}` : `Project ${view.label} unavailable`}
            disabled={!view.available}
            onClick={() => view.available && onViewChange(view.id)}
            className={`min-h-11 shrink-0 rounded-lg border px-3 text-left text-xs font-semibold ${selected ? 'origin-primary-button' : 'origin-secondary-button'} disabled:cursor-not-allowed disabled:opacity-55`}
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
          className="mt-1 min-h-11 w-full rounded-lg border border-origin-border bg-transparent px-3 text-sm font-semibold"
        >
          {views.filter((view) => view.available).map((view) => <option key={view.id} value={view.id}>{view.label}</option>)}
        </select>
      </div>

      {activeView === 'overview' && <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <article className="origin-card border p-3">
          <p className="origin-muted m-0 text-xs font-bold">Conversation</p>
          <p className="m-0 mt-1 text-lg font-black">{messages.length}</p>
          <p className="origin-muted m-0 mt-1 text-xs">current messages · {sessions.length} archived sessions</p>
        </article>
        <article className="origin-card border p-3">
          <p className="origin-muted m-0 text-xs font-bold">Artifacts</p>
          <p className="m-0 mt-1 text-lg font-black">{artifacts.length}</p>
          <p className="origin-muted m-0 mt-1 text-xs">{completedArtifacts} complete · {artifacts.length - completedArtifacts} generating</p>
        </article>
        <article className="origin-card border p-3">
          <p className="origin-muted m-0 text-xs font-bold">Mode</p>
          <p className="m-0 mt-1 text-lg font-black">{mode === 'coding' ? 'Code' : mode === 'research' ? 'Research' : mode === 'creative' ? 'Create' : 'Chat'}</p>
          <p className="origin-muted m-0 mt-1 text-xs">Project view does not change Mode automatically.</p>
        </article>
      </div>}
    </div>
  </section>;
}
