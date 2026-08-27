import { useEffect, useState } from 'react';

const FOCUS_MODE_EVENT = 'origin:focus-mode-change';

export default function FocusModeController() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const apply = (next: boolean) => {
      setActive(next);
      document.documentElement.dataset.originFocusMode = next ? 'true' : 'false';
      window.dispatchEvent(new CustomEvent(FOCUS_MODE_EVENT, { detail: { active: next } }));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        apply(!active);
      } else if (event.key === 'Escape' && active) {
        apply(false);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active]);

  useEffect(() => {
    document.documentElement.dataset.originFocusMode = active ? 'true' : 'false';
    return () => {
      delete document.documentElement.dataset.originFocusMode;
    };
  }, [active]);

  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {active ? 'Focus Mode: on. Press Alt+F or Escape to exit.' : 'Focus Mode: off. Press Alt+F to enter.'}
    </div>
  );
}
