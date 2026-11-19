import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';

/**
 * ORIGIN のキャラクター「猫」の状態表示。
 *
 * 静止画を基本とし、動画は動き自体が意味を持つ状態（作業中の
 * タイプ、調べ中の見回し）にだけ使う。動画はこの状態が
 * 表示されるまで読み込まれず（遅延読み込み）、prefers-reduced-motion
 * では動画を再生せず静止画に切り替える。
 *
 * 猫の絵柄は当初、濃紺〜黒系で背景が焼き込まれていたため、そのまま
 * では画面の背景に沈んで見えにくかった。`pedestal` を付けると明るい
 * 円形の台座（ディスク＋リング＋影）の上に載せ、ライト／ダーク両
 * テーマで輪郭がはっきり視認できるようにする（オーナー指示
 * 2026-11-09）。2026-11-15 の再デザイン（PR-δ2）で絵柄はクリーム
 * 背景が焼き込まれたものに変わったが、台座の見た目は従来どおり
 * 維持する（円形切り抜きの中にクリーム背景がそのまま収まる）。
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
export type OriginCatStateKind = 'idle' | 'thinking' | 'searching' | 'working' | 'making' | 'waiting' | 'done' | 'sorry' | 'sleep';

export const ORIGIN_CAT_STILL_SRC: Record<OriginCatStateKind, string> = {
  idle: '/brand/origin-cat.webp',
  thinking: '/brand/origin-cat-thinking.webp',
  // 「調べている」は作業中（working）から分離した専用の状態（動きの
  // 作り直し第1段、2026-11-13）。第1段では thinking の静止画を暫定
  // 流用していたが、第2段（M1／M2、2026-11-18）で専用静止画
  // （顔を上げて見回す姿、検収 9.4）に差し替えた。
  // 差し替えはこの1か所だけで全配置に効く。
  searching: '/brand/origin-cat-searching.webp',
  working: '/brand/origin-cat-working.webp',
  // 「作っている」は成果物を作成している場面専用の状態（動きの
  // 作り直し第2段、2026-11-18）。鉛筆で紙に描く姿の静止画
  // （検収 9.2）。画像生成中とエージェントの制作系ステップから使う。
  making: '/brand/origin-cat-making.webp',
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
/**
 * タップ時の一回性の「喜ぶ」動き（小さく跳ねる＋頷く）の長さ
 * （ループさせない）。旧来の頷き（nod）と同じ 700ms 級に収め、
 * 拡大も控えめにする（プロフィールカード表示、2026-11-15）。
 */
export const ORIGIN_CAT_JOY_DURATION_MS = 700;

export const ORIGIN_CAT_WORKING_VIDEO_SRC = '/brand/origin-cat-working.mp4';
export const ORIGIN_CAT_SEARCHING_VIDEO_SRC = '/brand/origin-cat-searching.mp4';

/**
 * 状態→動画の対応表（動きの作り直し第2段 M2-3、2026-11-19）。
 * 動画がある状態だけを載せ、無い状態は静止画で表す。working は
 * 前足でタイプする動き、searching は顔（視線）が左右を見回す動き
 * （M1-2 で制作し検収合格・全軸9.0以上、5.92秒ループ）。
 * どちらの動画も poster はその状態の静止画が兼ねるため、動画が
 * 読み込めない・自動再生できない環境では静止画の見た目に落ちる。
 * searching の動画ファイルはバイナリ素材のため、この PR とは別に
 * GitHub Web から public/brand/ へ配置する（コードはこの表の
 * パスを参照するだけ。ファイルが無い間も poster の静止画で表示
 * が成立する）。
 */
export const ORIGIN_CAT_VIDEO_SRC: Partial<Record<OriginCatStateKind, string>> = {
  working: ORIGIN_CAT_WORKING_VIDEO_SRC,
  searching: ORIGIN_CAT_SEARCHING_VIDEO_SRC,
};

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

  // 動画は対応表にある状態だけが使う（M2-3 で working 固定の分岐から
  // 一般化）。動画はこの状態が表示されるまで読み込まれず、poster は
  // その状態の静止画。prefers-reduced-motion と stillOnly では従来
  // どおり静止画に切り替える。
  const videoSrc = ORIGIN_CAT_VIDEO_SRC[state];
  let media: ReactElement;
  if (videoSrc !== undefined && !prefersReducedMotion && !stillOnly) {
    media = (
      <video
        data-testid="origin-cat-state"
        data-state={state}
        className={`shrink-0 rounded-full object-cover${pedestal ? '' : motionClassName}`}
        style={style}
        src={videoSrc}
        poster={ORIGIN_CAT_STILL_SRC[state]}
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
