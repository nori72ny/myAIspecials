import React from 'react';

export type OriginWorkspaceModeV31 = 'chat' | 'research' | 'coding' | 'creative';

type OriginWorkspaceShellV31Props = {
  mode: OriginWorkspaceModeV31;
  onModeChange: (mode: OriginWorkspaceModeV31) => void;
  navigation?: React.ReactNode;
};

const modeCapabilities: Record<OriginWorkspaceModeV31, readonly string[]> = {
  chat: ['Files', 'Artifacts'],
  research: ['Public Web', 'Sources', 'Conflict Review'],
  coding: ['GitHub', 'Diff', 'Tests'],
  creative: ['Local SVG', 'PNG', 'History'],
};

function SystemDetails({ mode }: { mode: OriginWorkspaceModeV31 }) {
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
        <div aria-label="Tools capability" className="grid gap-1 border-t border-origin-border pt-3">
          <span className="origin-muted text-[11px] font-bold uppercase tracking-wide">Tools</span>
          <strong>利用可能な経路</strong>
          <span className="origin-muted text-xs">{modeCapabilities[mode].join(' · ')}</span>
        </div>
        <div aria-label="Agent runtime evidence policy" className="grid gap-1 border-t border-origin-border pt-3">
          <span className="origin-muted text-[11px] font-bold uppercase tracking-wide">Agent</span>
          <strong>実行時のみ状態表示</strong>
          <span className="origin-muted text-xs">Agent / Tool / Approval の進行状態は、取得済みruntime evidenceがある場合だけ作業箇所のActivityへ表示</span>
        </div>
      </div>
    </div>
  </details>;
}

export default function OriginWorkspaceShellV31({ mode, navigation }: OriginWorkspaceShellV31Props) {
  return <section aria-label="ORIGIN workspace shell" className="origin-workspace-shell border-b border-origin-border px-3 sm:px-5">
    <div className="mx-auto flex h-12 w-full max-w-7xl items-center gap-2 sm:h-14 sm:gap-3">
      {navigation}
      <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
        <span className="text-sm font-black tracking-tight sm:text-base">ORIGIN</span>
        <span className="origin-badge hidden min-h-7 items-center border px-2 text-[11px] font-bold sm:inline-flex">Personal</span>
        <span className="sr-only">Workspace</span>
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-2">
        <SystemDetails mode={mode} />
      </div>
    </div>
  </section>;
}
