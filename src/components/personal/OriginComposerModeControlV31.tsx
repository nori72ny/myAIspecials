import React from 'react';
import type { OriginWorkspaceModeV31 } from './OriginWorkspaceShellV31';

type OriginComposerModeControlV31Props = {
  mode: OriginWorkspaceModeV31;
  onModeChange: (mode: OriginWorkspaceModeV31) => void;
};

const OPTIONS: readonly { value: OriginWorkspaceModeV31; label: string }[] = [
  { value: 'chat', label: 'Chat' },
  { value: 'research', label: 'Research' },
  { value: 'coding', label: 'Code' },
  { value: 'creative', label: 'Create' },
];

export default function OriginComposerModeControlV31({ mode, onModeChange }: OriginComposerModeControlV31Props) {
  return (
    <label className="origin-composer-mode-host flex shrink-0 items-center">
      <span className="sr-only">Mode</span>
      <select
        aria-label={mode === 'chat' ? 'Composer mode' : 'Workspace mode'}
        value={mode}
        onChange={(event) => onModeChange(event.target.value as OriginWorkspaceModeV31)}
        className="origin-secondary-button h-9 min-h-9 w-[5rem] max-w-[5rem] rounded-full border px-2 text-[11px] font-bold sm:w-[5.4rem] sm:max-w-[5.4rem] sm:text-xs"
      >
        {OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
