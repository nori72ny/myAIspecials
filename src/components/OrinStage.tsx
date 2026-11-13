import { useEffect, useRef, useState } from 'react';
import OriginCatState, { type OriginCatStateKind } from './OriginCatState';

/**
 * オリンの全体画面ステージ（PR-δ1、2026-11-13）。
 * 設計正本：~/workspace/origin-fix/ORIN_FULLSCREEN_STAGE_DESIGN_2026-11-13.md
 * （オーナー指示 2026-11-13 18:34／18:37、統括確定 U-2／U-3 を含む）。
 *
 * チャット送信後、回答が流れ始めるまでの待ち時間と、画像生成の実行中に、
 * 画面全体にオリンを大きく出し、作業の段階に応じて動きを変える。
 * 出すのはオリンと平易な段階タイトル1行のみ（作業工程表示ルール
 * 2026-11-09）。詳細・ログ・技術用語・出典件数は出さない（統括確定 U-4）。
 *
 * 第1段階の素材は既存の静止画＋CSS のみ。OriginCatState には必ず
 * `stillOnly` を渡し、不自然さが監査済みの working 動画（mp4）を
 * 大画面で再生させない。背景は台座ディスクを使わず（統括確定 U-2）、
 * `--bg-primary` の全面＋柔らかい放射グラデーションだけで受ける
 * （オリンの色は変えない）。状態→（猫の状態・動き・タイトル）の対応は
 * resolveOrinStageDisplay の1表に集約し、第2段階の素材差し替えは
 * OriginCatState の後ろ側だけで完結させる（設計 §6.7）。
 *
 * 表示の状態機械：
 * - waiting が 200ms 継続したら出現（即答でのチラつき防止）。
 * - waiting が「送信継続のまま」外れたら（本文が流れ始めた／成果物が
 *   着地した）合図なしでフェードアウトする。
 * - waiting が「送信終了と一緒に」外れたら、App が分類した outcome で
 *   合図を出す：done＝小さな頷き1回（700ms）、sorry＝姿勢を下げる
 *   （1,200ms）。outcome が null（手動停止・画像の要件確認待ち）は
 *   合図なしで引っ込む。
 * - タップ（全面ボタン）または Escape で最小化でき、その送信の間だけ
 *   ステージを出さない。作業自体は止めない。新しい送信（episode が
 *   増える）で最小化は解除される。
 * - ステージが実際に出ている間だけ onVisibilityChange(true) を返し、
 *   App は会話内の1行表示（origin-thinking 等）を抑制する（二重表示
 *   禁止、設計 §3.5）。
 */

/** 出現遅延：この時間「待ち状態」が続いたらステージを出す（§3.1）。 */
export const ORIN_STAGE_APPEAR_DELAY_MS = 200;
/** 出現のフェードイン（§3.1）。 */
export const ORIN_STAGE_FADE_IN_MS = 200;
/** 消滅のフェードアウト（§3.2）。 */
export const ORIN_STAGE_FADE_OUT_MS = 250;
/** 完了の合図（頷き）の尺。滞留は合図＋フェードで最大 950ms（§3.4）。 */
export const ORIN_STAGE_DONE_CUE_MS = 700;
/** 失敗の合図の尺（下げる動き 900ms＋静止 300ms、§3.4）。 */
export const ORIN_STAGE_SORRY_CUE_MS = 1200;
/**
 * 送信終了の瞬間に合図の分岐を決める前、App 側の outcome 確定
 * （isLoading の立ち下がりで分類する effect）を待つ小さな猶予。
 * 体感できない範囲で、props の伝播順に依存しないためのもの。
 */
export const ORIN_STAGE_OUTCOME_SETTLE_MS = 60;
/** 待ちがこの時間を超えたら thinking／searching の振幅を半減させる（§4.2）。 */
export const ORIN_STAGE_QUIET_AFTER_MS = 20_000;
/** 第1段階の猫の表示サイズ上限（256px 素材の引き伸ばしを抑える、§5.2）。 */
export const ORIN_STAGE_CAT_SIZE_MOBILE_PX = 224;
export const ORIN_STAGE_CAT_SIZE_DESKTOP_PX = 256;
/** デスクトップ幅の境界（Tailwind の sm と同じ 640px）。 */
export const ORIN_STAGE_WIDE_QUERY = '(min-width: 640px)';

export type OrinStageMotion =
  | 'thinking' | 'searching' | 'working' | 'designing' | 'checking' | 'composing' | 'done' | 'sorry';

export type OrinStageOutcome = 'done' | 'sorry';

export interface OrinStageSignals {
  imagePhase: 'designing' | 'drawing' | 'checking' | null;
  researchStage: 'searching' | 'checking' | 'writing' | null;
  streamPhase: 'searching' | 'composing' | null;
  isLoading: boolean;
}

export interface OrinStageTexts {
  waitingText: string;
  researchStageText: string;
  imagePhaseText: string;
}

export interface OrinStageDisplay {
  catState: OriginCatStateKind;
  motion: OrinStageMotion;
  title: string;
}

/** 段階タイトルの整形：末尾の「…」等を付けない（シートの sheetStageTitle と同じ規則、§3.3）。 */
export function stripOrinStageTitle(text: string): string {
  return text.replace(/[…。.]+$/u, '');
}

/**
 * 状態対応表（§3.3）。上から優先する。文言は既存の正
 * （waitingText／researchStageText／imagePhaseText）の再利用のみで、
 * ステージ専用の新文言は作らない。composing の動きは §4.2 で
 * thinking のキーフレームに畳む（描画側の対応付け参照）。
 */
export function resolveOrinStageDisplay(signals: OrinStageSignals, texts: OrinStageTexts): OrinStageDisplay | null {
  const { imagePhase, researchStage, streamPhase, isLoading } = signals;
  if (imagePhase === 'designing') return { catState: 'thinking', motion: 'designing', title: stripOrinStageTitle(texts.imagePhaseText) };
  if (imagePhase === 'drawing') return { catState: 'working', motion: 'working', title: stripOrinStageTitle(texts.imagePhaseText) };
  if (imagePhase === 'checking') return { catState: 'thinking', motion: 'checking', title: stripOrinStageTitle(texts.imagePhaseText) };
  if (researchStage === 'searching') return { catState: 'searching', motion: 'searching', title: stripOrinStageTitle(texts.researchStageText) };
  if (researchStage === 'checking') return { catState: 'searching', motion: 'checking', title: stripOrinStageTitle(texts.researchStageText) };
  if (researchStage === 'writing') return { catState: 'thinking', motion: 'composing', title: stripOrinStageTitle(texts.researchStageText) };
  if (streamPhase === 'searching') return { catState: 'searching', motion: 'searching', title: stripOrinStageTitle(texts.waitingText) };
  if (streamPhase === 'composing') return { catState: 'thinking', motion: 'composing', title: stripOrinStageTitle(texts.waitingText) };
  if (isLoading) return { catState: 'thinking', motion: 'thinking', title: stripOrinStageTitle(texts.waitingText) };
  return null;
}

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

function useStageCatSize(): number {
  const [wide, setWide] = useState<boolean>(() => typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(ORIN_STAGE_WIDE_QUERY).matches);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(ORIN_STAGE_WIDE_QUERY);
    const onChange = (event: MediaQueryListEvent) => setWide(event.matches);
    setWide(media.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);
  return wide ? ORIN_STAGE_CAT_SIZE_DESKTOP_PX : ORIN_STAGE_CAT_SIZE_MOBILE_PX;
}

/** 動きのクラス対応（§4.2）。composing は thinking の2層（傾き＋呼吸）を使う。 */
function motionClasses(motion: OrinStageMotion, reduced: boolean): { outer: string | null; inner: string } {
  if (reduced) return { outer: null, inner: '' };
  switch (motion) {
    case 'thinking':
    case 'composing':
      return { outer: 'origin-stage-tilt', inner: 'origin-stage-breathe' };
    case 'searching':
      return { outer: null, inner: 'origin-stage-searching' };
    case 'working':
      return { outer: null, inner: 'origin-stage-working' };
    case 'designing':
      return { outer: null, inner: 'origin-stage-designing' };
    case 'checking':
      return { outer: null, inner: 'origin-stage-checking' };
    case 'done':
      return { outer: null, inner: 'origin-stage-done' };
    case 'sorry':
      return { outer: null, inner: 'origin-stage-sorry' };
    default:
      return { outer: null, inner: '' };
  }
}

type StagePhase = 'off' | 'pending' | 'on' | 'ending' | 'cue' | 'fading';

export interface OrinStageProps {
  /** 待ち状態（§3.1 の出現条件を App 側で導出したもの）。 */
  waiting: boolean;
  /** 送信が継続しているか（isLoading）。消滅理由の判定に使う。 */
  sending: boolean;
  /** 送信エピソードの通し番号。増えると最小化が解除される。 */
  episode: number;
  /** 送信終了の分類（App が既存の完了判定＋失敗シグナルで分類）。未確定は null。 */
  outcome: OrinStageOutcome | null;
  /** resolveOrinStageDisplay の結果。待ち状態でなければ null でよい。 */
  display: OrinStageDisplay | null;
  /** 最小化ボタンの aria-label（「会話に戻る」）。 */
  backLabel: string;
  /** ステージが実際に出ている間だけ true（二重表示の抑制用）。 */
  onVisibilityChange?: (visible: boolean) => void;
}

export default function OrinStage({ waiting, sending, episode, outcome, display, backLabel, onVisibilityChange }: OrinStageProps) {
  const [phase, setPhase] = useState<StagePhase>('off');
  const [cueKind, setCueKind] = useState<OrinStageOutcome | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [lastDisplay, setLastDisplay] = useState<OrinStageDisplay | null>(null);
  const timerRef = useRef<number | null>(null);
  const sendingRef = useRef(sending);
  sendingRef.current = sending;
  const outcomeRef = useRef(outcome);
  outcomeRef.current = outcome;
  const prefersReducedMotion = usePrefersReducedMotion();
  const catSize = useStageCatSize();

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const schedule = (fn: () => void, ms: number) => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      fn();
    }, ms);
  };
  const startFadeOut = () => {
    setPhase('fading');
    schedule(() => setPhase('off'), ORIN_STAGE_FADE_OUT_MS);
  };

  // 新しい送信（episode の増加）で最小化を解除し、状態機械を初期化する。
  const episodeRef = useRef(episode);
  useEffect(() => {
    if (episodeRef.current === episode) return;
    episodeRef.current = episode;
    clearTimer();
    setMinimized(false);
    setCueKind(null);
    setQuiet(false);
    setPhase('off');
  }, [episode]);

  // 合図・タイトルの引き継ぎ用に、直近の表示内容を保持する。
  useEffect(() => {
    if (display) setLastDisplay(display);
  }, [display]);

  // 状態機械の本体（出現遅延・消滅・合図の分岐）。
  useEffect(() => {
    if (waiting) {
      if (minimized) return;
      if (phase === 'off') {
        setPhase('pending');
        schedule(() => setPhase('on'), ORIN_STAGE_APPEAR_DELAY_MS);
      } else if (phase === 'fading' || phase === 'ending' || phase === 'cue') {
        // 消えかけた直後に待ちが戻ったら（段階の切り替わり等）表示へ戻す。
        clearTimer();
        setCueKind(null);
        setPhase('on');
      }
      return;
    }
    if (phase === 'pending') {
      clearTimer();
      setPhase('off');
    } else if (phase === 'on') {
      if (sendingRef.current) {
        // 本文が流れ始めた／成果物が着地した：合図なしで引っ込む。
        startFadeOut();
      } else {
        // 送信が終わった：outcome の確定を少し待ってから合図を分岐する。
        setPhase('ending');
        schedule(() => {
          const settled = outcomeRef.current;
          if (settled === 'done') {
            setCueKind('done');
            setPhase('cue');
            schedule(startFadeOut, ORIN_STAGE_DONE_CUE_MS);
          } else if (settled === 'sorry') {
            setCueKind('sorry');
            setPhase('cue');
            schedule(startFadeOut, ORIN_STAGE_SORRY_CUE_MS);
          } else {
            startFadeOut();
          }
        }, ORIN_STAGE_OUTCOME_SETTLE_MS);
      }
    }
    // 'ending' / 'cue' / 'fading' / 'off' はタイマー駆動で進むため何もしない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, minimized, phase]);

  // 表示の有無を App へ伝える（会話内の1行表示の抑制に使う）。
  useEffect(() => {
    onVisibilityChange?.(phase === 'on' || phase === 'ending' || phase === 'cue');
  }, [phase, onVisibilityChange]);

  // フェードイン：マウント直後のフレームで opacity を 1 へ遷移させる。
  useEffect(() => {
    if (phase === 'on' || phase === 'ending' || phase === 'cue') {
      const frame = window.requestAnimationFrame(() => setReveal(true));
      return () => window.cancelAnimationFrame(frame);
    }
    setReveal(false);
  }, [phase]);

  // 長時間の待ちでは動きを静かにする（§4.2、20秒超で振幅半減）。
  useEffect(() => {
    if (phase !== 'on') {
      setQuiet(false);
      return;
    }
    const timer = window.setTimeout(() => setQuiet(true), ORIN_STAGE_QUIET_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const minimize = () => {
    clearTimer();
    setMinimized(true);
    setCueKind(null);
    setPhase('off');
  };

  // Escape でも会話に戻れる（§3.5）。
  useEffect(() => {
    if (phase !== 'on' && phase !== 'ending' && phase !== 'cue') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') minimize();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // アンマウント時のタイマー掃除。
  useEffect(() => clearTimer, []);

  if (phase === 'off' || phase === 'pending') return null;

  const shownDisplay: OrinStageDisplay | null = phase === 'cue' && cueKind && lastDisplay
    ? { ...lastDisplay, catState: cueKind === 'done' ? 'done' : 'sorry', motion: cueKind }
    : display ?? lastDisplay;
  if (!shownDisplay) return null;

  const { outer, inner } = motionClasses(shownDisplay.motion, prefersReducedMotion);
  const cat = (
    <div className={inner || undefined}>
      <OriginCatState state={shownDisplay.catState} size={catSize} stillOnly />
    </div>
  );

  return (
    <div
      className="origin-stage"
      data-testid="origin-stage"
      style={{
        opacity: reveal ? 1 : 0,
        transitionDuration: `${phase === 'fading' ? ORIN_STAGE_FADE_OUT_MS : ORIN_STAGE_FADE_IN_MS}ms`,
      }}
    >
      <button type="button" className="origin-stage-dismiss" aria-label={backLabel} onClick={minimize} />
      <div className="origin-stage-content">
        <div className="origin-stage-glow" aria-hidden="true" />
        <div className={`origin-stage-cat${quiet ? ' origin-stage--quiet' : ''}`}>
          {outer ? <div className={outer}>{cat}</div> : cat}
        </div>
        <p className="origin-stage-title" role="status" aria-live="polite">{shownDisplay.title}</p>
      </div>
    </div>
  );
}
