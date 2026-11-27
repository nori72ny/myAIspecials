import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import SettingsModalLegacy from './SettingsModalLegacy';
import type { Settings } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  updateSettings: (settings: Settings) => void;
  savedConversationCount?: number;
  onExportHistory?: () => void;
  onImportHistory?: (file: File) => Promise<void>;
  onResetHistory?: () => void;
  /** Ids of saved conversation sessions that still exist (memory source links). */
  sourceSessionIds?: ReadonlySet<string>;
  /** Opens the conversation a memory item came from, when it still exists. */
  onOpenSourceSession?: (sessionId: string) => void;
  /** Pointer id captured by the settings opener, when available. */
  openingPointerId?: number;
  /** Section to bring into view when the modal opens (e.g. from the code screen's key guidance). */
  focusSection?: 'coding' | 'admin' | null;
}

export default function SettingsModal({
  isOpen,
  onClose,
  settings,
  updateSettings,
  savedConversationCount = 0,
  onExportHistory,
  onImportHistory,
  onResetHistory,
  sourceSessionIds,
  onOpenSourceSession,
  openingPointerId,
  focusSection,
}: Props) {
  const openingPointerIdRef = useRef<number | null>(null);
  const [portalHost] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' ? document.body : null,
  );

  useEffect(() => {
    openingPointerIdRef.current = isOpen && typeof openingPointerId === 'number' ? openingPointerId : null;
  }, [isOpen, openingPointerId]);

  if (!isOpen || !portalHost) return null;

  const handlePortalPointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== openingPointerIdRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    openingPointerIdRef.current = null;
  };

  return createPortal(
    <div
      data-origin-settings-portal="true"
      onPointerDownCapture={handlePortalPointerDownCapture}
    >
      <SettingsModalLegacy
        isOpen={isOpen}
        onClose={onClose}
        settings={settings}
        updateSettings={updateSettings}
        savedConversationCount={savedConversationCount}
        onExportHistory={onExportHistory}
        onImportHistory={onImportHistory}
        onResetHistory={onResetHistory}
        sourceSessionIds={sourceSessionIds}
        onOpenSourceSession={onOpenSourceSession}
        focusSection={focusSection}
      />
    </div>,
    portalHost,
  );
}

export type { Props as SettingsModalProps };
