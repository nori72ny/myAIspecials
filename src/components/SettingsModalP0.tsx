import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  children?: React.ReactNode;
  /** Optional opener pointer id. When omitted, the last pointerdown is used. */
  openingPointerId?: number;
}

let lastPointerDownId: number | null = null;

// Capture at the window level so parent React handlers cannot hide the opener event.
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (event) => {
      lastPointerDownId = event.pointerId;
    },
    true,
  );
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  children,
  openingPointerId,
}) => {
  const openingPointerIdRef = useRef<number | null>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    setPortalHost(document.body);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      openingPointerIdRef.current = null;
      return;
    }

    openingPointerIdRef.current =
      typeof openingPointerId === 'number'
        ? openingPointerId
        : lastPointerDownId;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      openingPointerIdRef.current = null;
    };
  }, [isOpen, onClose, openingPointerId]);

  if (!isOpen || !portalHost) return null;

  const handleBackdropPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    // Never allow the same physical pointer that opened the modal to close it.
    if (event.pointerId === openingPointerIdRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  const handleContentPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    event.stopPropagation();
  };

  return createPortal(
    <div
      role="presentation"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding:
          'max(16px, env(safe-area-inset-top)) ' +
          'max(16px, env(safe-area-inset-right)) ' +
          'max(16px, env(safe-area-inset-bottom)) ' +
          'max(16px, env(safe-area-inset-left))',
      }}
      onPointerDown={handleBackdropPointerDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="ORIGIN Settings"
        style={{
          backgroundColor: '#1c1c1e',
          color: '#ffffff',
          borderRadius: '16px',
          padding: '24px',
          width: 'min(90%, 500px)',
          maxHeight: '80dvh',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
          overscrollBehavior: 'contain',
        }}
        onPointerDown={handleContentPointerDown}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
            ORIGIN Settings
          </h2>
          <button
            type="button"
            aria-label="設定を閉じる"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#a1a1aa',
              fontSize: '1.5rem',
              cursor: 'pointer',
              padding: '8px',
              minWidth: '44px',
              minHeight: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>
        {children ?? (
          <p style={{ color: '#a1a1aa' }}>設定項目を読み込んでいます...</p>
        )}
      </div>
    </div>,
    portalHost,
  );
};
