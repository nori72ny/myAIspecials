import React from 'react';

export type OriginWorkspaceModeV31 = 'chat' | 'research' | 'coding' | 'creative';

type ModeItem = {
  id: OriginWorkspaceModeV31;
  label: string;
  ariaLabel: string;
  description: string;
};

type OriginWorkspaceShellV31Props = {
  mode: OriginWorkspaceModeV31;
  onModeChange: (mode: OriginWorkspaceModeV31) => void;
  projectOpen?: boolean;
  onProjectToggle?: () => void;
};

const MODES: readonly ModeItem[] = [
  { id: 'chat', label: '会話', ariaLabel: 'Chat', description: '相談・質問' },
  { id: 'research', label: '調べる', ariaLabel: 'Research', description: '調査・出典' },
  { id: 'coding', label: 'コード', ariaLabel: 'Code', description: '実装・検証' },
  { id: 'creative', label: '作る', ariaLabel: 'Create', description: '画像・成果物' },
];

export default function OriginWorkspaceShellV31({
  mode,
  onModeChange,
  projectOpen = false,
  onProjectToggle,
}: OriginWorkspaceShellV31Props) {
  return <section aria-label="ORIGIN workspace shell" className="origin-surface shrink-0 border-b border-origin-border px-2 py-2 sm:px-4">
    <div className="mx-auto flex w-full max-w-7xl items-center gap-2">
      <nav aria-label="Mode" className="grid min-w-0 flex-1 grid-cols-4 gap-1.5 md:flex md:max-w-[560px] md:gap-2">
        {MODES.map((item) => {
          const selected = item.id === mode;
          return <button
            key={item.id}
            type="button"
            aria-pressed={selected}
            aria-label={item.ariaLabel}
            title={item.description}
            onClick={() => onModeChange(item.id)}
            className={`min-h-11 min-w-0 rounded-xl border px-2 text-center text-sm font-bold transition-colors sm:px-3 md:min-w-[104px] ${selected ? 'origin-primary-button' : 'origin-secondary-button'}`}
          >
            <span className="block truncate">{item.label}</span>
          </button>;
        })}
      </nav>

      {onProjectToggle && <button
        type="button"
        aria-label={projectOpen ? '詳細を閉じる' : '詳細を開く'}
        aria-pressed={projectOpen}
        onClick={onProjectToggle}
        className={`min-h-11 shrink-0 rounded-xl border px-3 text-sm font-semibold ${projectOpen ? 'origin-primary-button' : 'origin-secondary-button'}`}
      >
        詳細
      </button>}
    </div>
  </section>;
}
