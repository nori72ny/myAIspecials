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

function CapabilityDetails({ mode }: { mode: OriginWorkspaceModeV31 }) {
  return <details className="origin-card min-w-40 border px-3 py-2 text-sm">
    <summary aria-label="Tools 自動管理" className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold">
      <span className="origin-muted text-xs">Tools</span>
      <span>自動管理</span>
    </summary>
    <div className="border-t border-origin-border pt-3 text-xs leading-6">
      <p className="origin-muted m-0">現在のModeで利用中</p>
      <ul className="m-0 mt-1 list-disc pl-5">
        {modeCapabilities[mode].map(tool => <li key={tool}>{tool}</li>)}
      </ul>
      <p className="origin-muted mb-0 mt-2">手動Tool切替は次の実装段階で追加します。</p>
    </div>
  </details>;
}

function ModelDetails() {
  return <details className="origin-card min-w-40 border px-3 py-2 text-sm">
    <summary aria-label="Model ORIGIN Auto" className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold">
      <span className="origin-muted text-xs">Model</span>
      <span>ORIGIN Auto</span>
    </summary>
    <div className="border-t border-origin-border pt-3 text-xs leading-6">
      <p className="m-0 font-semibold">ORIGIN Auto</p>
      <p className="origin-muted mb-0 mt-1">現行runtimeではprovider/model選択をサーバー側で管理しています。選べないモデルを選択肢として表示しません。</p>
    </div>
  </details>;
}

function AgentDetails({ mode }: { mode: OriginWorkspaceModeV31 }) {
  const coding = mode === 'coding';
  const stateLabel = coding ? '実行可能' : '通常応答';
  return <details className="origin-card min-w-40 border px-3 py-2 text-sm">
    <summary aria-label={`Agent ${stateLabel}`} className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold">
      <span className="origin-muted text-xs">Agent</span>
      <span>{stateLabel}</span>
    </summary>
    <div className="border-t border-origin-border pt-3 text-xs leading-6">
      <p className="m-0 font-semibold">{coding ? 'Code ModeではAgentic Codingを利用できます。' : 'このModeは通常応答として動作します。'}</p>
      <p className="origin-muted mb-0 mt-1">AgentはModeとは別概念として表示し、独立切替はruntime対応後に有効化します。</p>
    </div>
  </details>;
}

export default function OriginWorkspaceShellV31({ mode, onModeChange }: OriginWorkspaceShellV31Props) {
  return <section aria-label="ORIGIN workspace shell" className="origin-surface border-b px-3 py-3 sm:px-5">
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-h-11 items-center gap-3">
          <span className="text-base font-black tracking-tight">ORIGIN</span>
          <span className="origin-muted text-xs">Workspace</span>
          <span className="origin-badge inline-flex min-h-8 items-center border px-3 text-xs font-bold">Personal</span>
        </div>
        <div aria-label="Model Tools Agent" className="flex max-w-full gap-2 overflow-x-auto pb-1">
          <ModelDetails />
          <CapabilityDetails mode={mode} />
          <AgentDetails mode={mode} />
        </div>
      </div>

      <nav aria-label="Mode" className="flex max-w-full items-center gap-2 overflow-x-auto border-t border-origin-border pt-3">
        <span className="origin-muted shrink-0 px-1 text-xs font-bold uppercase tracking-wide">Mode</span>
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
            className={`min-h-11 shrink-0 rounded-lg border px-4 text-left text-sm font-semibold transition-colors ${selected ? 'origin-primary-button' : 'origin-secondary-button'} disabled:opacity-60`}
          >
            <span className="block">{item.label}</span>
            <span className={`block text-xs font-normal ${selected ? 'opacity-90' : 'origin-muted'}`}>{item.available ? item.description : '準備中'}</span>
          </button>;
        })}
      </nav>
    </div>
  </section>;
}
