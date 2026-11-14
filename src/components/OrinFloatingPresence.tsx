import { useEffect, useRef, useState } from 'react';
import OriginCatState, { type OriginCatStateKind } from './OriginCatState';
import type { OriginLanguage } from '../i18n';

/**
 * オリンの浮遊プレゼンス（2026-11-14 08:59 ノリ指示）。
 *
 * オリンはヘッダーに「設置」されるのではなく、Muse アプリの
 * アバターのように画面上部中央に浮いて常駐する。位置は
 * position: fixed で画面に固定され、ページをスクロールしても
 * 動かない。待機中も作業中も同じ大きさ（台座リング付き104px）で、
 * 回答が終わっても小さいヘッダーアイコンには縮まない（ヘッダー
 * 中央のオリンは廃止し、このプレゼンスに一本化した）。名前
 * 「オリン」は常に姿の真下に出し、現在の作業を平易な一文で示す
 * 濃色ピルは作業中だけ姿の下に出す。完了・失敗の合図が終われば
 * 消えるのはピルだけで、姿と名前は残る。
 *
 * 状態文の正本は従来どおり：段階→文の対応は resolveOrinBubbleText
 * の1表に集約し、文そのものは App 側で既存正本（waitingText／
 * researchStageText／imagePhaseText／完了・失敗キュー）から組み
 * 立てられたものをそのまま使う。ピルを出す条件（作業中だけ出す・
 * 回答が流れ始めたら引っ込む・完了／失敗キューは既存の尺だけ
 * 出す）も App 側の従来判定（bubbleText）がそのまま担う。
 *
 * 姿は App 側の状態集約（orinPresenceState）をそのまま流用する：
 * working 状態では既存の動画アセットで動き、それ以外は状態別の
 * 静止画。待機中（ピルなし）は台座ごと静かな呼吸（上限は
 * OriginCatState の ORIGIN_CAT_IDLE_MOTION_* のとおり）。
 * prefers-reduced-motion では動画を使わず静止画にし、呼吸も
 * ピルのフェードも無くす（即時表示・即時消去）。
 *
 * タップで小さく頷いて「いまの作業」シートを開く（頷きの合図は
 * App 側の nodSignal）。シートが開いている間はプレゼンス自体を
 * 隠す。「いまの作業を表示」という名前の操作はこのプレゼンスの
 * タップ対象ただ1つだけ（ヘッダー側の同名ボタンは廃止した）。
 */

/** ピルの出現／消去トランジションの尺。 */
export const ORIN_PRESENCE_FADE_MS = 180;

/** プレゼンスのオリンの絵の寸法（px）。台座の外径はこの約1.08倍になる。 */
export const ORIN_PRESENCE_CAT_SIZE_PX = 96;
/** 台座込みの外径（px）。絵96px＋片側リング4px＝104px。待機・作業で不変。 */
export const ORIN_PRESENCE_PEDESTAL_SIZE_PX = 104;

export interface OrinBubbleSignals {
  imagePhase: 'designing' | 'drawing' | 'checking' | null;
  researchStage: 'searching' | 'checking' | 'writing' | null;
  streamPhase: 'searching' | 'composing' | null;
  isLoading: boolean;
}

export interface OrinBubbleTexts {
  waitingText: string;
  researchStageText: string;
  imagePhaseText: string;
}

/**
 * 段階→状態文の対応表。旧ステージ（resolveOrinStageDisplay）と
 * 同じ優先順位：画像生成 → 調査 → ストリーム段階 → 送信中。
 * 各段階の文そのものは App 側で既存正本から組み立てられたものを
 * そのまま使う（この表は文を作らない）。
 */
export function resolveOrinBubbleText(signals: OrinBubbleSignals, texts: OrinBubbleTexts): string | null {
  if (signals.imagePhase !== null) return texts.imagePhaseText;
  if (signals.researchStage !== null) return texts.researchStageText;
  if (signals.streamPhase !== null) return texts.waitingText;
  if (signals.isLoading) return texts.waitingText;
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

export interface OrinFloatingPresenceProps {
  /** ピルに出す状態文。null の間はピルを出さない（姿と名前は常駐）。 */
  text: string | null;
  /** オリンの姿（App 側の状態集約 orinPresenceState をそのまま渡す）。 */
  state: OriginCatStateKind;
  /** 名前のロケール（ja: オリン / en: Orin）。 */
  language: OriginLanguage;
  /** タップで「いまの作業」シートを開く。 */
  onOpenWorkSheet: () => void;
  /** 「いまの作業」シートが開いている間はプレゼンス自体を隠す。 */
  hidden?: boolean;
  /** タップ時の一回性の頷きの合図（App 側で数える）。 */
  nodSignal?: number;
}

export default function OrinFloatingPresence({ text, state, language, onOpenWorkSheet, hidden = false, nodSignal = 0 }: OrinFloatingPresenceProps) {
  const reduced = usePrefersReducedMotion();
  const [pillText, setPillText] = useState<string | null>(null);
  const [pillRevealed, setPillRevealed] = useState(false);
  const pillTextRef = useRef<string | null>(null);
  pillTextRef.current = pillText;

  useEffect(() => {
    if (hidden) {
      // シートが開いたら競合させない：フェードを待たずピルもろとも隠す
      // （コンポーネント自体が null を返すため、ここでは状態だけ戻す）。
      setPillText(null);
      setPillRevealed(false);
      return;
    }
    if (text !== null) {
      const wasHidden = pillTextRef.current === null;
      setPillText(text);
      if (!wasHidden || reduced) {
        // 段階の切り替わりでは点滅させない。reduced-motion では即時表示。
        setPillRevealed(true);
        return;
      }
      // ピルの出現時のみフェード＋わずかな拡縮で出す（姿は動かさない）。
      setPillRevealed(false);
      const frame = window.requestAnimationFrame(() => setPillRevealed(true));
      return () => window.cancelAnimationFrame(frame);
    }
    if (pillTextRef.current === null) return;
    // 完了・失敗の合図が終わったら、消えるのはピルだけ。姿と名前は
    // そのまま残し、大きさも変えない。
    setPillRevealed(false);
    if (reduced) {
      setPillText(null);
      return;
    }
    const timer = window.setTimeout(() => setPillText(null), ORIN_PRESENCE_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [text, reduced, hidden]);

  if (hidden) return null;

  const ja = language !== 'en';
  // 待機中（ピルが消えきって・動画でない状態）だけ、台座ごと静かな
  // 呼吸を付ける。ピルのフェードアウト中はまだ付けない。
  const breathing = pillText === null && state !== 'working';
  return (
    <div className="origin-orin-presence" data-testid="origin-orin-presence">
      <button
        type="button"
        className="origin-orin-presence__tap"
        onClick={onOpenWorkSheet}
        aria-label={ja ? 'いまの作業を表示' : 'Show current work'}
      >
        <span key={nodSignal} className={nodSignal > 0 ? 'origin-cat-nod inline-flex' : 'inline-flex'}>
          <OriginCatState state={state} size={ORIN_PRESENCE_CAT_SIZE_PX} pedestal breathing={breathing} />
        </span>
        <span className="origin-orin-presence__name" data-testid="origin-orin-presence-name">
          {ja ? 'オリン' : 'Orin'}
        </span>
        {pillText !== null && (
          <span
            className={`origin-orin-presence__pill${pillRevealed ? ' is-visible' : ''}`}
            data-testid="origin-orin-presence-status"
            role="status"
            aria-live="polite"
            style={{ opacity: pillRevealed ? 1 : 0 }}
          >
            {pillText}
          </span>
        )}
      </button>
    </div>
  );
}
