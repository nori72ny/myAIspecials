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
 * 台座の形状（2026-11-12 見直し）：当初（2026-11-09 の暫定対処）は
 * 絵を台座の内寸の 80% に縮小し、パッドも内寸の 9% 取っていたため、
 * 円盤が絵の約1.49倍になり、白いリングが太く目立った（オーナー指摘
 * 「生成中のオリンの周りの白い枠が大き過ぎ」）。視認性のための台座
 * 自体は残しつつリングを細くする：絵は台座の内寸いっぱい（＝size
 * そのもの）に載せ、円盤は絵の 1.08 倍前後（片側のリングは絵の約
 * 4%、ORIGIN_CAT_PEDESTAL_RING_RATIO）に抑える。絵の実寸は従来と
 * 同じく size 基準で決まるため、猫の大きさ自体は変わらない。
 * 本命の修正は透過背景アセットへの差し替え（猫ホスト化フェーズ）。
 */
export type OriginCatStateKind = 'idle' | 'thinking' | 'searching' | 'working' | 'waiting' | 'done' | 'sorry' | 'sleep';

export const ORIGIN_CAT_STILL_SRC: Record<OriginCatStateKind, string> = {
  idle: '/brand/origin-cat.webp',
  thinking: '/brand/origin-cat-thinking.webp',
  // 「調べている」は作業中（working）から分離した専用の状態（動きの
  // 作り直し第1段、2026-11-13）。専用アセットは第2段で制作するため、
  // 第1段では視線が上〜横を向く thinking の静止画を暫定的に使う。
  // 差し替えはこの1か所だけで全配置に効く。
  searching: '/brand/origin-cat-thinking.webp',
  working: '/brand/origin-cat-working.webp',
  waiting: '/brand/origin-cat-waiting.webp',
  done: '/brand/origin-cat-done.webp',
  sorry: '/brand/origin-cat-sorry.webp',
  sleep: '/brand/origin-cat-sleep.webp',
};

/**
 * 常駐オリンの静かな動きの上限（設計正本 §7・D-5）。
 * 待機の呼吸は周期3秒以上・スケール3%以内・上下動2px以内に収める。
 * CSS 側（origin-top-ui.css の origin-cat-breathe）もこの値に合わせ、
 * テストで両方の整合を確認する。prefers-reduced-motion では動かさない。
 */
export const ORIGIN_CAT_IDLE_MOTION_PERIOD_MS = 6000;
export const ORIGIN_CAT_IDLE_MOTION_MAX_SCALE = 1.025;
export const ORIGIN_CAT_IDLE_MOTION_MAX_SHIFT_PX = 1;
/** タップ時などの一回性の小さな頷きの長さ（ループさせない）。 */
export const ORIGIN_CAT_NOD_DURATION_MS = 700;

export const ORIGIN_CAT_WORKING_VIDEO_SRC = '/brand/origin-cat-working.mp4';

/**
 * 台座の片側リング幅（台座内寸＝絵の寸法に対する比率）。
 * 円盤の外径は絵 ×(1 + 2 × この値) ≒ 1.08 倍になる。
 */
export const ORIGIN_CAT_PEDESTAL_RING_RATIO = 0.04;

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
  /** 表示サイズ（px）。既定は 36。台座を付けた場合も絵の寸法はこの値で、円盤はその約8%増しになる。 */
  size?: number;
  /** 明るい円形の台座を付けて、暗い絵柄を両テーマで視認しやすくする。 */
  pedestal?: boolean;
  /**
   * 動画を使わず静止画だけにする（ヘッダー常駐など小さい表示用。
   * 小さな常駐表示で動画は騒がしいため、設計 D-3 で静止画に限る）。
   */
  stillOnly?: boolean;
  /**
   * 待機中のごく静かな呼吸モーション（CSS）を付ける。常駐表示用。
   * 上限は ORIGIN_CAT_IDLE_MOTION_* の定数どおりで、
   * prefers-reduced-motion では付けない（CSS 側でも止める）。
   */
  breathing?: boolean;
}

export default function OriginCatState({ state, size = 36, pedestal = false, stillOnly = false, breathing = false }: OriginCatStateProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const motionClassName = breathing && !prefersReducedMotion ? ' origin-cat-breathe' : '';
  // 絵の寸法は台座の有無にかかわらず size そのもの。台座がある場合は
  // その周りに細いリング（片側 = 内寸の約4%、最小2px）だけを足し、
  // 円盤の外径を絵の 1.08 倍前後に抑える（2026-11-12 見直し）。
  // 静止画・動画・ポスターすべてに同じ寸法がかかる。台座ごと CSS で
  // 拡縮できる構造（短い画面でのホーム圧縮など）は従来どおり。
  const style: CSSProperties = { width: size, height: size };

  let media: ReactElement;
  if (state === 'working' && !prefersReducedMotion && !stillOnly) {
    media = (
      <video
        data-testid="origin-cat-state"
        data-state={state}
        className={`shrink-0 rounded-full object-cover${pedestal ? '' : motionClassName}`}
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
        className={`shrink-0 rounded-full object-cover${pedestal ? '' : motionClassName}`}
        style={style}
        src={ORIGIN_CAT_STILL_SRC[state]}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    );
  }

  if (!pedestal) return media;

  const pad = Math.max(2, Math.round(size * ORIGIN_CAT_PEDESTAL_RING_RATIO));
  const total = size + pad * 2;
  return (
    <span
      data-testid="origin-cat-pedestal"
      className={`origin-cat-pedestal${motionClassName}`}
      style={{ width: total, height: total, padding: pad }}
    >
      {media}
    </span>
  );
}
