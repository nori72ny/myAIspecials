import { useEffect, useState } from 'react';

export interface SplashScreenProps {
  durationMs?: number;
  visible?: boolean;
}

export default function SplashScreen({ durationMs = 900, visible = true }: SplashScreenProps) {
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (!visible) {
      setMounted(false);
      return;
    }
    setMounted(true);
    const timer = window.setTimeout(() => setMounted(false), durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, visible]);

  if (!mounted) return null;

  return (
    <div className="origin-ultra-splash" role="status" aria-label="ORIGIN を起動しています">
      <div className="origin-ultra-splash__aurora" aria-hidden="true" />
      <div className="origin-ultra-splash__content">
        <div className="origin-ultra-logo" aria-hidden="true">
          <span className="origin-ultra-logo__halo" />
          <span className="origin-ultra-logo__core">O</span>
          <span className="origin-ultra-logo__edge" />
        </div>
        <div className="origin-ultra-wordmark">ORIGIN</div>
        <div className="origin-ultra-caption">PERSONAL INTELLIGENCE</div>
      </div>
      <div className="origin-ultra-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
