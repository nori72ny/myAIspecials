import React from 'react';

export type OriginWorkspaceModeV31 = 'chat' | 'research' | 'coding' | 'creative';

type ModeItem = {
  id: OriginWorkspaceModeV31;
  label: string;
  description: string;
};

type OriginWorkspaceShellV31Props = {
  mode: OriginWorkspaceModeV31;
  onModeChange: (mode: OriginWorkspaceModeV31) => void;
};

const MODES: readonly ModeItem[] = [
  { id: 'chat', label: 'Chat', description: '会話・相談' },
  { id: 'research', label: 'Research', description: '調査・出典' },
  { id: 'coding', label: 'Code', description: 'Agentic Coding' },
  { id: 'creative', label: 'Create', description: 'Visual生成' },
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
    <summary aria-label="ORIGIN Auto settings" className="origin-secondary-button flex min-h-11 list-none items-center gap-2 rounded-full border px-3 text-xs font-semibold sm:px-4">
      <span>Auto</span>
      <span aria-hidden="true" className="origin-muted text-[10px]">▾</span>
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
    <div className="mx-auto flex min-h-12 w-full max-w-7xl items-center gap-2 sm:min-h-14 sm:gap-3">
      <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
        <span className="text-sm font-black tracking-tight sm:text-base">ORIGIN</span>
        <span className="origin-badge hidden min-h-7 items-center border px-2 text-[11px] font-bold sm:inline-flex">Personal</span>
        <span className="sr-only">Workspace</span>
      </div>

      <label className="ml-auto min-w-0 flex-1 sm:hidden">
        <span className="sr-only">Mode selector</span>
        <select
          aria-label="Mode selector"
          value={mode}
          onChange={(event) => onModeChange(event.target.value as OriginWorkspaceModeV31)}
          className="origin-secondary-button min-h-11 w-full rounded-full border px-3 text-sm font-bold"
        >
          {MODES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>

      <nav aria-label="Mode" className="ml-auto hidden min-w-0 flex-1 items-center justify-end gap-1.5 sm:flex">
        {MODES.map((item) => {
          const selected = item.id === mode;
          return <button
            key={item.id}
            type="button"
            aria-pressed={selected}
            aria-label={item.label}
            title={item.description}
            onClick={() => onModeChange(item.id)}
            className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-bold transition-colors ${selected ? 'origin-primary-button' : 'origin-secondary-button'}`}
          >
            {item.label}
          </button>;
        })}
      </nav>

      <SystemDetails mode={mode} />
    </div>
  </section>;
}
