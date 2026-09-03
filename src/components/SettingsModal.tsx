import React, { useEffect, useRef, useState } from 'react';
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
  /** Pointer id captured by the settings opener, when available. */
  openingPointerId?: number;
}

let lastPointerDownId: number | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (event) => {
      lastPointerDownId = event.pointerId;
    },
    true,
  );
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
  openingPointerId,
}: Props) {
  const openingPointerIdRef = useRef<number | null>(null);
  const [portalHost] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' ? document.body : null,
  );

  useEffect(() => {
    if (!isOpen) {
      openingPointerIdRef.current = null;
      return;
    }
    openingPointerIdRef.current =
      typeof openingPointerId === 'number' ? openingPointerId : lastPointerDownId;
    // Consume the opener's pointer id so later pointer events using the same
    // browser pointer id are not accidentally swallowed by the portal guard.
    lastPointerDownId = null;
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