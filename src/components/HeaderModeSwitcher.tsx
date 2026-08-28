import React, { useEffect, useState } from 'react';
import {
  isPasskeyConfigured,
  registerPasskeyKey,
  unlockAndSetPasskeyKey,
} from '../security/passkeyKeyDerivation';

export type OriginWorkspaceMode = 'chat' | 'agent';

interface HeaderModeSwitcherProps {
  currentMode: OriginWorkspaceMode;
  onModeChange: (mode: OriginWorkspaceMode) => void;
}

export default function HeaderModeSwitcher({ currentMode, onModeChange }: HeaderModeSwitcherProps) {
  const [passkeyConfigured, setPasskeyConfigured] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState(false);

  useEffect(() => {
    setPasskeyConfigured(isPasskeyConfigured());
  }, []);

  const handlePasskey = async () => {
    if (passkeyBusy) return;
    setPasskeyBusy(true);
    setPasskeyError(false);
    try {
      if (isPasskeyConfigured()) {
        await unlockAndSetPasskeyKey();
      } else {
        await registerPasskeyKey();
      }
      setPasskeyConfigured(true);
    } catch {
      // Biometric cancellation/unsupported hardware must never break the workspace.
      setPasskeyError(true);
    } finally {
      setPasskeyBusy(false);
    }
  };

  return (
    <div className="sticky top-0 z-40 flex w-full flex-wrap items-center justify-center gap-2 border-b border-slate-200/80 bg-white/90 px-3 py-2 backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/90" role="group" aria-label="Workspace mode">
      <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <button type="button" aria-pressed={currentMode === 'chat'} onClick={() => onModeChange('chat')} className={`min-h-11 rounded-lg px-4 text-sm font-semibold transition ${currentMode === 'chat' ? 'bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white' : 'text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white'}`}>
          Chat Mode
        </button>
        <button type="button" aria-pressed={currentMode === 'agent'} onClick={() => onModeChange('agent')} className={`min-h-11 rounded-lg px-4 text-sm font-semibold transition ${currentMode === 'agent' ? 'bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white' : 'text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white'}`}>
          ⚡ Agent Workspace
        </button>
      </div>
      <button
        type="button"
        onClick={() => void handlePasskey()}
        disabled={passkeyBusy}
        className="min-h-11 rounded-full border border-emerald-300 bg-emerald-50 px-3 text-xs font-bold text-emerald-900 shadow-sm transition hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200"
        title={passkeyConfigured ? 'Passkeyで暗号化キーをアンロック' : 'Passkey保護を有効化'}
      >
        🛡️ {passkeyBusy ? 'Passkey...' : passkeyConfigured ? 'Passkey Protected' : 'Enable Passkey'}
      </button>
      {passkeyError && <span role="status" className="text-xs font-medium text-amber-700 dark:text-amber-300">Passkeyは変更されていません。</span>}
      <span className="sr-only">Option+A switches Chat Mode and Agent Workspace Mode.</span>
    </div>
  );
}
