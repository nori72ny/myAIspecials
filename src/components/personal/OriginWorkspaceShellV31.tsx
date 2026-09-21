import React from 'react';

export type OriginWorkspaceModeV31 = 'chat' | 'research' | 'coding' | 'creative';

type ModeItem = {
  id: 'chat' | 'research' | 'work' | 'coding' | 'creative';
  label: string;
  description: string;
  available: boolean;
};

type OriginWorkspaceShellV31Props = {
  mode: OriginWorkspaceModeV31;
  onModeChange: (mode: OriginWorkspaceModeV31) => void;
};

const MODES: readonly ModeItem[] = [
  { id: 'chat', label: 'Chat', description: '会話・相談', available: true },
  { id: 'research', label: 'Research', description: '調査・出典', available: true },
  { id: 'work', label: 'Work', description: '実作業', available: false },
  { id: 'coding', label: 'Code', description: 'Agentic Coding', available: true },
  { id: 'creative', label: 'Create', description: 'Visual生成', available: true },
];

const modeCapabilities: Record<OriginWorkspaceModeV31, readonly string[]> = {
  chat: ['Files', 'Artifacts'],
  research: ['Public Web', 'Sources', 'Conflict Review'],
  coding: ['GitHub', 'Diff', 'Tests'],
  creative: ['Local SVG', 'PNG', 'History'],
};

function SystemDetails({ mode }: { mode: OriginWorkspaceModeV31 }) {
  const agentState = mode === 'coding' ? '実行可能' : '通常応答';
  return <details className="relative shrink-0">
    <summary className="origin-secondary-button flex min-h-10 list-none items-center gap-2 rounded-full border px-3 text-xs font-semibold sm:min-h-11 sm:px-4">
      <span className="origin-muted">ORIGIN</span>
      <span>Auto</span>
    </summary>
    <div className="origin-card absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-1.5rem))] border p-4 text-sm shadow-xl">
      <div className="grid gap-3">
        <div aria-label="Model ORIGIN Auto" className="grid gap-1">
          <span className="origin-muted text-[11px] font-bold uppercase tracking-wide">Model</span>
          <strong>ORIGIN Auto</strong>
          <span className="origin-muted text-xs">provider/model routingはサーバー側で管理</span>
        </div>
        <div aria-label="Tools 自動管理" className="grid gap-1 border-t border-origin-border pt-3">
          <span className="origin-muted text-[11px] font-bold uppercase tracking-wide">Tools</span>
          <strong>自動管理</strong>
          <span className="origin-muted text-xs">{modeCapabilities[mode].join(' · ')}</span>
        </div>
        <div aria-label={`Agent ${agentState}`} className="grid gap-1 border-t border-origin-border pt-3">
          <span className="origin-muted text-[11px] font-bold uppercase tracking-wide">Agent</span>
          <strong>{agentState}</strong>
          <span className="origin-muted text-xs">{mode === 'coding' ? 'Code ModeでAgentic Codingを利用可能' : '必要時のみAgent状態を表示'}</span>
        </div>
      </div>
    </div>
  </details>;
}

export default function OriginWorkspaceShellV31({ mode, onModeChange }: OriginWorkspaceShellV31Props) {
  return <section aria-label="ORIGIN workspace shell" className="origin-workspace-shell border-b border-origin-border px-3 sm:px-5">
    <div className="mx-auto flex min-h-14 w-full max-w-7xl items-center gap-2 sm:min-h-16 sm:gap-3">
      <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
        <span className="text-sm font-black tracking-tight sm:text-base">ORIGIN</span>
        <span className="origin-badge hidden min-h-7 items-center border px-2 text-[11px] font-bold sm:inline-flex">Personal</span>
        <span className="sr-only">Workspace</span>
      </div>

      <nav aria-label="Mode" className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto sm:gap-1.5">
        {MODES.map(item => {
          const selected = item.id === mode;
          const enabledMode = item.id === 'chat' || item.id === 'research' || item.id === 'coding' || item.id === 'creative';
          return <button
            key={item.id}
            type="button"
            aria-pressed={enabledMode ? selected : undefined}
            aria-label={item.available ? item.label : `${item.label} 準備中`}
            disabled={!item.available}
            title={item.available ? item.description : `${item.description}は現在準備中です`}
            onClick={() => {
              if (item.id === 'chat' || item.id === 'research' || item.id === 'coding' || item.id === 'creative') onModeChange(item.id);
            }}
            className={`min-h-10 shrink-0 rounded-full border px-3 text-xs font-bold transition-colors sm:min-h-11 sm:px-4 sm:text-sm ${selected ? 'origin-primary-button' : 'origin-secondary-button'} disabled:hidden`}
          >
            {item.label}
          </button>;
        })}
      </nav>

      <SystemDetails mode={mode} />
    </div>
  </section>;
}
