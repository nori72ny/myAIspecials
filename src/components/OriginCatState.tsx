import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';

/**
 * ORIGIN のキャラクター「猫」の状態表示。
 *
 * 静止画を基本とし、動画は「作業中」が伝わると効果が大きい場面
 * （エージェント実行中とチャットの生成中）に使う。動画はこの状態が
 * 表示されるまで読み込まれず（遅延読み込み）、prefers-reduced-motion
 * では動画を再生せず静止画に切り替える。
 *
 * 猫の絵柄は濃紺〜黒系で背景が焼き込まれているため、そのままでは
 * 画面の背景に沈んで見えにくい。`pedestal` を付けると明るい円形の
 * 台座（ディスク＋リング＋影）の上に載せ、ライト／ダーク両テーマで
 * 輪郭がはっきり視認できるようにする（オーナー指示 2026-11-09）。
 *
 * 暫定対処（2026-11-09）：アセットは暗い背景が全面に焼き込まれた
 * 不透明画像のため、台座の内寸いっぱいに敷くと明るい台座面が細い
 * リングとしてしか見えない。台座の総寸は変えず、絵を内寸の 80%
 * （ORIGIN_CAT_PEDESTAL_MEDIA_RATIO）に縮小して中央に置き、明色面が
 * はっきり見える形にしている。本命の修正は透過背景アセットへの
 * 差し替え（猫ホスト化フェーズ）で、その際は比率を 1 に戻す。
 */
export type OriginCatStateKind = 'idle' | 'thinking' | 'working' | 'waiting' | 'done' | 'sorry' | 'sleep';

export const ORIGIN_CAT_STILL_SRC: Record<OriginCatStateKind, string> = {
  idle: '/brand/origin-cat.webp',
  thinking: '/brand/origin-cat-thinking.webp',
  working: '/brand/origin-cat-working.webp',
  waiting: '/brand/origin-cat-waiting.webp',
  done: '/brand/origin-cat-done.webp',
  sorry: '/brand/origin-cat-sorry.webp',
  sleep: '/brand/origin-cat-sleep.webp',
};

export const ORIGIN_CAT_WORKING_VIDEO_SRC = '/brand/origin-cat-working.mp4';

/** 台座内での絵の占有率（暫定値。本命は透過アセット差し替え）。 */
export const ORIGIN_CAT_PEDESTAL_MEDIA_RATIO = 0.8;

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
  /** 表示サイズ（px）。既定は 36。台座を付けた場合は台座の内寸（絵は暫定でその80%に縮小して表示）。 */
  size?: number;
  /** 明るい円形の台座を付けて、暗い絵柄を両テーマで視認しやすくする。 */
  pedestal?: boolean;
}

export default function OriginCatState({ state, size = 36, pedestal = false }: OriginCatStateProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  // 台座がある場合は台座の内寸に対する割合で大きさを決め、台座ごと
  // CSS で拡縮できるようにする（短い画面でのホーム圧縮など）。絵は
  // 暫定で内寸の 80% に縮小し、台座の明色面をはっきり見せる（台座は
  // flex 中央寄せのため、縮小した絵は中央に載る）。静止画・動画・
  // ポスターすべてに同じ占有率がかかる。
  const pedestalMediaSize = `${ORIGIN_CAT_PEDESTAL_MEDIA_RATIO * 100}%`;
  const style: CSSProperties = pedestal ? { width: pedestalMediaSize, height: pedestalMediaSize } : { width: size, height: size };

  let media: ReactElement;
  if (state === 'working' && !prefersReducedMotion) {
    media = (
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
  } else {
    media = (
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

  if (!pedestal) return media;

  const pad = Math.max(3, Math.round(size * 0.09));
  const total = size + pad * 2;
  return (
    <span
      data-testid="origin-cat-pedestal"
      className="origin-cat-pedestal"
      style={{ width: total, height: total, padding: pad }}
    >
      {media}
    </span>
  );
}
