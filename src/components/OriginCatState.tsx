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
 *
 * 2026-11-21 の再デザイン（外部デザイン評価の回収）で、その透過化が
 * 待機姿に届いた：通常・冬・お正月の待機静止画は透過背景アセットに
 * 差し替わり、焼き込みのクリーム円盤は消えた。通常の待機姿には
 * ダークテーマ専用のリムライト版（ORIGIN_CAT_DARK_IDLE_SRC）を対で
 * 用意し、暗い画面では輪郭の光で読ませる。台座（pedestal）はホーム
 * のヒーローなど従来の配置向けに残すが、常駐プレゼンスとプロフィール
 * カードは台座なしで透過絵そのままを出す。
 *
 * 同日のデザイン一次評価で、作業中表示（プレゼンス）とエージェント
 * 画面の状態チップにはまだ円盤が残ると指摘されたため、状態別の
 * 静止画（thinking / searching / working / making / waiting / done /
 * sorry / sleep）と動画2本（working / searching）も同じキーイングで
 * 透過化し、全配置で円盤時代の素材を使わない形に統一した。動画は
 * 透過チャンネルを持てる WebM（VP9・320px）に変換し、旧 MP4 は
 * 参照を外した（ファイル自体は public/brand に残置）。エージェント
 * 画面の状態チップも台座をやめ、透過絵そのままの表示に揃えた。
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

/** 冬（12月〜2月）の待機姿の差し替え先。季節差し替えは待機の静止画だけが対象。 */
export const ORIGIN_CAT_WINTER_IDLE_SRC = '/brand/origin-cat-winter.webp';
/** お正月（1月1日〜10日）の待機姿の差し替え先。冬の差し替えより優先する。 */
export const ORIGIN_CAT_NEWYEAR_IDLE_SRC = '/brand/origin-cat-newyear.webp';

/**
 * ダークテーマ専用の通常待機姿（輪郭に青灰色のリムライトを焼き込んだ
 * 透過版）。季節外の通常待機姿でのみ対で描画し、表示側の切り替えは
 * CSS の :root[data-theme="dark"] が担う（origin-top-ui.css の
 * .origin-cat-still--light / --dark）。テーマ判定を JS へ持ち込まず、
 * 既存のダーク調整と同じセレクタに寄せる。季節差し替え絵には
 * ダーク版を用意せず、透過版そのままを両テーマで使う。
 */
export const ORIGIN_CAT_DARK_IDLE_SRC = '/brand/origin-cat-dark.webp';

/** プロフィールカードの中にだけ出す冬の完成イラスト（雪景色）の配置先。 */
export const ORIGIN_CAT_WINTER_FULL_SRC = '/brand/origin-cat-winter-full.webp';
/** プロフィールカードの中にだけ出すお正月の完成イラスト（赤い着物）の配置先。 */
export const ORIGIN_CAT_NEWYEAR_FULL_SRC = '/brand/origin-cat-newyear-full.webp';

/** 季節の種別（季節外は resolveOriginCatSeason が null を返す）。 */
export type OriginCatSeason = 'winter' | 'newyear';

/** 季節→プロフィールカード用・完成イラストの対応表。 */
export const ORIGIN_CAT_SEASON_FULL_SRC: Record<OriginCatSeason, string> = {
  winter: ORIGIN_CAT_WINTER_FULL_SRC,
  newyear: ORIGIN_CAT_NEWYEAR_FULL_SRC,
};

/**
 * いま効いている季節を返す。利用者のローカル時間で判定する。
 * 常駐の待機姿の差し替えと、プロフィールカード内の完成イラスト
 * 表示は、どちらもこの判定を正本にする（日付条件を二重に持たない）。
 * - 1月1日〜10日：お正月（冬より優先）
 * - 12月1日〜2月末：冬
 * - それ以外：季節なし（null）
 */
export function resolveOriginCatSeason(now: Date): OriginCatSeason | null {
  const month = now.getMonth() + 1;
  const day = now.getDate();
  if (month === 1 && day <= 10) return 'newyear';
  if (month === 12 || month === 1 || month === 2) return 'winter';
  return null;
}

/**
 * 待機姿の季節差し替え（オーナー承認 2026-11-21）。差し替えが効く
 * のは待機（idle）の静止画だけ。作業中・調べ中などの動画と他の
 * 状態の静止画は、年間を通じて従来どおり。季節の判定は
 * resolveOriginCatSeason が正本。
 *
 * 常駐表示の差し替え絵は「控えめな季節アクセント」だけにする
 * （オーナー決定 2026-11-21：冬＝落ち着いた青のマフラー1点、
 * お正月＝朱の襟元1点）。雪景色・着物姿の完成イラストは常駐には
 * 出さず、プロフィールカードの中にだけ出す
 * （ORIGIN_CAT_SEASON_FULL_SRC）。
 */
export function resolveOriginCatIdleSrc(now: Date): string {
  const season = resolveOriginCatSeason(now);
  if (season === 'newyear') return ORIGIN_CAT_NEWYEAR_IDLE_SRC;
  if (season === 'winter') return ORIGIN_CAT_WINTER_IDLE_SRC;
  return ORIGIN_CAT_STILL_SRC.idle;
}

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

export const ORIGIN_CAT_WORKING_VIDEO_SRC = '/brand/origin-cat-working.webm';
export const ORIGIN_CAT_SEARCHING_VIDEO_SRC = '/brand/origin-cat-searching.webm';

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
  // 待機の静止画だけ季節差し替えを通す（resolveOriginCatIdleSrc）。
  // 動画の poster は動画がある状態（working／searching）でしか使わ
  // れないため、idle では実質 img の src だけが差し替わる。他の状態
  // は従来どおり対応表の静止画を使う。
  const stillSrc = state === 'idle' ? resolveOriginCatIdleSrc(new Date()) : ORIGIN_CAT_STILL_SRC[state];
  const stillClassName = `shrink-0 rounded-full object-cover${pedestal ? '' : motionClassName}`;
  let media: ReactElement;
  if (videoSrc !== undefined && !prefersReducedMotion && !stillOnly) {
    media = (
      <video
        data-testid="origin-cat-state"
        data-state={state}
        className={`shrink-0 rounded-full object-cover${pedestal ? '' : motionClassName}`}
        style={style}
        src={videoSrc}
        poster={stillSrc}
        autoPlay
        muted
        loop
        playsInline
        aria-hidden="true"
      />
    );
  } else if (state === 'idle' && stillSrc === ORIGIN_CAT_STILL_SRC.idle) {
    // 通常の待機姿だけはダークテーマ専用絵（リムライト版）を対で
    // 出し、CSS（:root[data-theme="dark"]）で表示側を切り替える。
    // ダーク側は data-testid を分け、通常側の取得
    // （origin-cat-state）を単一に保つ。
    media = (
      <>
        <img
          data-testid="origin-cat-state"
          data-state={state}
          className={`${stillClassName} origin-cat-still--light`}
          style={style}
          src={stillSrc}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <img
          data-testid="origin-cat-state-dark"
          data-state={state}
          className={`${stillClassName} origin-cat-still--dark`}
          style={style}
          src={ORIGIN_CAT_DARK_IDLE_SRC}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      </>
    );
  } else {
    media = (
      <img
        data-testid="origin-cat-state"
        data-state={state}
        className={stillClassName}
        style={style}
        src={stillSrc}
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
