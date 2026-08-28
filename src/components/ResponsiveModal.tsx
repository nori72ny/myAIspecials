import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ResponsiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  closeOnBackdrop?: boolean;
}

/** Responsive dialog primitive. On <=640px it behaves as a draggable bottom sheet. */
export default function ResponsiveModal({
  isOpen,
  onClose,
  title,
  children,
  closeOnBackdrop = true,
}: ResponsiveModalProps) {
  const [dragY, setDragY] = useState(0);
  const touchStartRef = useRef<number | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!isOpen) {
      setDragY(0);
      touchStartRef.current = null;
      return;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [isOpen]);

  if (!mounted || !isOpen) return null;

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) return;
    touchStartRef.current = event.touches[0].clientY;
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartRef.current === null) return;
    const diffY = event.touches[0].clientY - touchStartRef.current;
    if (diffY > 0) {
      setDragY(diffY);
      if (event.cancelable) event.preventDefault();
    }
  };

  const handleTouchEnd = () => {
    if (dragY > 120) onClose();
    setDragY(0);
    touchStartRef.current = null;
  };

  const handleBackdropPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!closeOnBackdrop || event.target !== event.currentTarget) return;
    event.preventDefault();
    onClose();
  };

  return createPortal(
    <div
      className="origin-dialog-overlay fixed inset-0 z-[9999] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      role="presentation"
      onPointerDown={handleBackdropPointerDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title ?? 'Dialog'}
        className="origin-mobile-sheet w-full max-w-xl overflow-y-auto border border-white/10 bg-[var(--bg-surface)] p-5 text-[var(--text-primary)] shadow-2xl"
        style={{
          transform: `translateY(${dragY}px)`,
          transition: touchStartRef.current === null ? 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
          maxHeight: 'min(86dvh, 760px)',
          WebkitOverflowScrolling: 'touch',
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-current/15 sm:hidden" aria-hidden="true" />
        {title && <h2 className="mb-4 text-lg font-semibold tracking-tight">{title}</h2>}
        {children}
      </div>
    </div>,
    document.body,
  );
}
