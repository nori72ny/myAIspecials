import { useEffect } from 'react';

const MIN_KEYBOARD_INSET_PX = 96;
const MAX_KEYBOARD_INSET_RATIO = 0.65;

export function calculateVisualViewportKeyboardInset(
  layoutHeight: number,
  visualHeight: number,
  offsetTop: number,
  textEntryFocused: boolean,
): number {
  if (!textEntryFocused) return 0;
  if (![layoutHeight, visualHeight, offsetTop].every(Number.isFinite) || layoutHeight <= 0 || visualHeight <= 0) return 0;
  const rawInset = layoutHeight - visualHeight - Math.max(0, offsetTop);
  if (rawInset < MIN_KEYBOARD_INSET_PX) return 0;
  return Math.min(Math.round(rawInset), Math.round(layoutHeight * MAX_KEYBOARD_INSET_RATIO));
}

function hasTextEntryFocus(): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return true;
  return active instanceof HTMLElement && active.isContentEditable;
}

export default function useVisualViewportKeyboardInset(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    if (!viewport) {
      root.style.setProperty('--origin-keyboard-inset', '0px');
      root.setAttribute('data-origin-keyboard-inset', '0');
      return;
    }

    let blurTimer: number | null = null;
    const update = () => {
      const inset = calculateVisualViewportKeyboardInset(
        window.innerHeight,
        viewport.height,
        viewport.offsetTop,
        hasTextEntryFocus(),
      );
      root.style.setProperty('--origin-keyboard-inset', `${inset}px`);
      root.setAttribute('data-origin-keyboard-inset', String(inset));
    };
    const afterBlur = () => {
      if (blurTimer !== null) window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(update, 0);
    };

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('focusin', update);
    window.addEventListener('focusout', afterBlur);

    return () => {
      if (blurTimer !== null) window.clearTimeout(blurTimer);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('focusin', update);
      window.removeEventListener('focusout', afterBlur);
      root.style.removeProperty('--origin-keyboard-inset');
      root.removeAttribute('data-origin-keyboard-inset');
    };
  }, []);
}
