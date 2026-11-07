import { useEffect, useState } from 'react';

/**
 * ORIGIN のキャラクター「猫」の状態表示。
 *
 * 静止画を基本とし、動画は最も効果が大きい「作業中（エージェント実行中）」の
 * 場面だけに使う。動画はこの状態が表示されるまで読み込まれず（遅延読み込み）、
 * prefers-reduced-motion では動画を再生せず静止画に切り替える。
 */
export type OriginCatStateKind = 'thinking' | 'working' | 'waiting' | 'done' | 'sorry' | 'sleep';

export const ORIGIN_CAT_STILL_SRC: Record<OriginCatStateKind, string> = {
  thinking: '/brand/origin-cat-thinking.webp',
  working: '/brand/origin-cat-working.webp',
  waiting: '/brand/origin-cat-waiting.webp',
  done: '/brand/origin-cat-done.webp',
  sorry: '/brand/origin-cat-sorry.webp',
  sleep: '/brand/origin-cat-sleep.webp',
};

export const ORIGIN_CAT_WORKING_VIDEO_SRC = '/brand/origin-cat-working.mp4';

function matchesReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => matchesReducedMotion());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    setReduced(media.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  return reduced;
}

export interface OriginCatStateProps {
  state: OriginCatStateKind;
  /** 表示サイズ（px）。既定は 36。 */
  size?: number;
}

export default function OriginCatState({ state, size = 36 }: OriginCatStateProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const style = { width: size, height: size };

  if (state === 'working' && !prefersReducedMotion) {
    return (
      <video
        data-testid="origin-cat-state"
        data-state={state}
        className="shrink-0 rounded-full object-cover"
        style={style}
        src={ORIGIN_CAT_WORKING_VIDEO_SRC}
        poster={ORIGIN_CAT_STILL_SRC.working}
        autoPlay
        muted
        loop
        playsInline
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      data-testid="origin-cat-state"
      data-state={state}
      className="shrink-0 rounded-full object-cover"
      style={style}
      src={ORIGIN_CAT_STILL_SRC[state]}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
