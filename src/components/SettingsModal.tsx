import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import SettingsModalLegacy from './SettingsModalLegacy';
import type { Settings } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  updateSettings: (settings: Settings) => void;
  messageCount?: number;
  onExportHistory?: () => void;
  onImportHistory?: (file: File) => Promise<void>;
  onResetHistory?: () => void;
  /** Retained for compatibility with existing callers. */
  openingPointerId?: number;
}

export default function SettingsModal({
  isOpen,
  onClose,
  settings,
  updateSettings,
  messageCount = 0,
  onExportHistory,
  onImportHistory,
  onResetHistory,
}: Props) {
  // Resolve the host synchronously so opening the modal never depends on a
  // post-render effect or a second state transition.
  const [portalHost] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' ? document.body : null,
  );

  if (!isOpen || !portalHost) return null;

  return createPortal(
    <div data-origin-settings-portal="true">
      <SettingsModalLegacy
        isOpen={isOpen}
        onClose={onClose}
        settings={settings}
        updateSettings={updateSettings}
        messageCount={messageCount}
        onExportHistory={onExportHistory}
        onImportHistory={onImportHistory}
        onResetHistory={onResetHistory}
      />
    </div>,
    portalHost,
  );
}

export type { Props as SettingsModalProps };
