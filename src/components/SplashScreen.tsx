import { useEffect, useState } from 'react';
import './splash-brand.css';

export interface SplashScreenProps {
  durationMs?: number;
  visible?: boolean;
  oncePerSession?: boolean;
}

const SESSION_KEY = 'origin_personal_splash_seen_v1';
const STARTUP_BRAND_MARK_SRC = '/brand/origin-sunrise-mark.svg?v=sunrise-20261004';

function shouldShowSplash(visible: boolean, oncePerSession: boolean): boolean {
  if (!visible) return false;
  if (!oncePerSession) return true;
  try {
    if (window.sessionStorage.getItem(SESSION_KEY) === '1') return false;
    window.sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    // Storage can be unavailable in privacy-restricted environments; showing the splash is safe.
  }
  return true;
}

export default function SplashScreen({ durationMs = 600, visible = true, oncePerSession = false }: SplashScreenProps) {
  const [mounted, setMounted] = useState(() => shouldShowSplash(visible, oncePerSession));

  useEffect(() => {
    if (!visible) {
      setMounted(false);
      return;
    }
    if (!mounted) return;
    const timer = window.setTimeout(() => setMounted(false), Math.max(0, durationMs));
    return () => window.clearTimeout(timer);
  }, [durationMs, mounted, visible]);

  if (!mounted) return null;

  return (
    <div className="origin-ultra-splash" role="status" aria-label="ORIGIN を起動しています">
      <div className="origin-ultra-splash__aurora" aria-hidden="true" />
      <div className="origin-ultra-splash__content">
        <div className="origin-sunrise-logo" aria-hidden="true">
          <span className="origin-sunrise-logo__halo" />
          <img
            className="origin-sunrise-logo__mark"
            src={STARTUP_BRAND_MARK_SRC}
            alt=""
            draggable={false}
          />
        </div>
        <div className="origin-sunrise-wordmark">ORIGIN</div>
      </div>
      <div className="origin-ultra-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
