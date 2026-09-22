import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const [host, setHost] = useState<HTMLSpanElement | null>(null);

  useEffect(() => {
    let activeHost: HTMLSpanElement | null = null;
    const attach = () => {
      const composer = document.querySelector<HTMLElement>('.origin-personal-chat .origin-composer');
      if (!composer) {
        if (activeHost?.isConnected) activeHost.remove();
        activeHost = null;
        setHost(null);
        return;
      }
      if (activeHost?.isConnected && activeHost.parentElement === composer) return;
      activeHost?.remove();
      const nextHost = document.createElement('span');
      nextHost.dataset.originComposerModeHost = 'true';
      nextHost.className = 'origin-composer-mode-host flex shrink-0 items-center';
      const textarea = composer.querySelector('textarea');
      composer.insertBefore(nextHost, textarea);
      activeHost = nextHost;
      setHost(nextHost);
    };

    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      activeHost?.remove();
      setHost(null);
    };
  }, []);

  if (!host) return null;
  return createPortal(
    <label className="flex shrink-0 items-center">
      <span className="sr-only">Mode</span>
      <select
        aria-label="Composer mode"
        value={mode}
        onChange={(event) => onModeChange(event.target.value as OriginWorkspaceModeV31)}
        className="origin-secondary-button h-11 min-h-11 w-[5.8rem] max-w-[5.8rem] rounded-xl border px-2 text-xs font-bold sm:w-[6.6rem] sm:max-w-[6.6rem] sm:text-sm"
      >
        {OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>,
    host,
  );
}
