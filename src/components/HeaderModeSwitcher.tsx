import React from 'react';

export type OriginWorkspaceMode = 'chat' | 'agent';

interface HeaderModeSwitcherProps {
  currentMode: OriginWorkspaceMode;
  onModeChange: (mode: OriginWorkspaceMode) => void;
}

export default function HeaderModeSwitcher({ currentMode, onModeChange }: HeaderModeSwitcherProps) {
  return (
    <div className="sticky top-0 z-40 flex w-full justify-center border-b border-slate-200/80 bg-white/90 px-3 py-2 backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/90" role="group" aria-label="Workspace mode">
      <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <button type="button" aria-pressed={currentMode === 'chat'} onClick={() => onModeChange('chat')} className={`min-h-11 rounded-lg px-4 text-sm font-semibold transition ${currentMode === 'chat' ? 'bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white' : 'text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white'}`}>
          Chat Mode
        </button>
        <button type="button" aria-pressed={currentMode === 'agent'} onClick={() => onModeChange('agent')} className={`min-h-11 rounded-lg px-4 text-sm font-semibold transition ${currentMode === 'agent' ? 'bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white' : 'text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white'}`}>
          ⚡ Agent Workspace
        </button>
      </div>
      <span className="sr-only">Option+A switches Chat Mode and Agent Workspace Mode.</span>
    </div>
  );
}
