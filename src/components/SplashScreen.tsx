import { useCallback, useEffect, useRef, useState } from 'react';
import OriginBrandLockup from './OriginBrandLockup';
import './splash-brand.css';

export interface SplashScreenProps {
  /** True once the main screen behind the splash is ready to be used. */
  ready?: boolean;
  oncePerSession?: boolean;
}

const SESSION_KEY = 'origin_personal_splash_seen_v1';
const STARTUP_BRAND_MARK_SRC = '/brand/origin-ribbon-o.webp?v=ribbon-20261108';

/**
 * The entrance sequence (mark, letters, gold line) completes within this:
 * the sequence itself ends at ~800ms (see splash-brand.css), and the
 * splash then leaves at exactly this mark whenever the app is ready, so
 * the handoff timing is the same on every launch instead of stretching
 * to whenever hydration happens to finish.
 */
export const SPLASH_MIN_DISPLAY_MS = 900;
/** Reduced motion shows the lockup statically, only briefly. */
export const SPLASH_REDUCED_MIN_DISPLAY_MS = 400;
/** Fail-safe: the splash always closes by this point, ready or not. */
export const SPLASH_FAILSAFE_MS = 2800;
/** Matches the fade-out transition in splash-brand.css. */
export const SPLASH_FADE_MS = 240;

function shouldShowSplash(oncePerSession: boolean): boolean {
  if (!oncePerSession) return true;
  try {
    if (window.sessionStorage.getItem(SESSION_KEY) === '1') return false;
    window.sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    // Storage can be unavailable in privacy-restricted environments; showing the splash is safe.
  }
  return true;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

type SplashPhase = 'showing' | 'leaving' | 'hidden';

export default function SplashScreen({ ready = false, oncePerSession = true }: SplashScreenProps) {
  const [phase, setPhase] = useState<SplashPhase>(() => (shouldShowSplash(oncePerSession) ? 'showing' : 'hidden'));
  const startedAtRef = useRef(0);
  if (startedAtRef.current === 0) startedAtRef.current = Date.now();

  const beginLeaving = useCallback(() => {
    setPhase((current) => (current === 'showing' ? 'leaving' : current));
  }, []);

  useEffect(() => {
    if (phase !== 'showing') return;
    const elapsed = Date.now() - startedAtRef.current;
    const minDisplayMs = prefersReducedMotion() ? SPLASH_REDUCED_MIN_DISPLAY_MS : SPLASH_MIN_DISPLAY_MS;
    // Ready: leave once the entrance sequence has had its minimum run.
    // Not ready: wait, but never past the fail-safe.
    const delay = ready
      ? Math.max(0, minDisplayMs - elapsed)
      : Math.max(0, SPLASH_FAILSAFE_MS - elapsed);
    const timer = window.setTimeout(beginLeaving, delay);
    return () => window.clearTimeout(timer);
  }, [phase, ready, beginLeaving]);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = window.setTimeout(() => setPhase('hidden'), SPLASH_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === 'hidden') return null;

  return (
    <div
      className={`origin-ultra-splash${phase === 'leaving' ? ' is-leaving' : ''}`}
      role="status"
      aria-label="ORIGIN を起動しています"
      onPointerDown={beginLeaving}
    >
      <div className="origin-ultra-splash__aurora" aria-hidden="true" />
      <div className="origin-ultra-splash__content">
        <OriginBrandLockup variant="splash" markSrc={STARTUP_BRAND_MARK_SRC} />
      </div>
    </div>
  );
}
