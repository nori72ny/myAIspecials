import { useEffect, useRef, useState } from 'react';
import OriginCatState, { type OriginCatStateKind } from './OriginCatState';
import type { OriginLanguage } from '../i18n';

/**
 * オリンの作業中プレゼンス（2026-11-14 ノリ指示、Muse アプリの
 * 作業中表示のスクリーンショットで確定）。
 *
 * 作業中は、ヘッダーの小さい常駐オリンに代えて、画面上部中央に
 * 大きなオリン（台座リング付き・約104px）を会話の上に重ねて出し、
 * 真下に名前「オリン」、その下に現在の作業を平易な一文で示す
 * 濃色ピルを出す。旧来の白枠吹き出し（2026-11-13、PR #1249）は
 * この表示に置き換え、二重表示にしない。
 *
 * 状態文の正本は従来どおり：段階→文の対応は resolveOrinBubbleText
 * の1表に集約し、文そのものは App 側で既存正本（waitingText／
 * researchStageText／imagePhaseText／完了・失敗キュー）から組み
 * 立てられたものをそのまま使う。表示条件（作業中だけ出す・回答が
 * 流れ始めたら引っ込む・完了／失敗キューは既存の尺だけ出す・
 * 「いまの作業」シートが開いている間は隠す）も App 側の従来判定
 * （bubbleText）がそのまま担う。
 *
 * 姿は App 側の状態集約（headerCatState）をそのまま流用する：
 * working 状態では既存の動画アセットで動き、それ以外は状態別の
 * 静止画。prefers-reduced-motion では動画を使わず静止画にし、
 * 出現／消去のフェードと拡縮も無くす（即時表示・即時消去）。
 * ヘッダーの常駐オリンの静かな呼吸の上限はここには適用しない
 * （これは作業中だけの表示）。
 */

/** プレゼンスの出現／消去トランジションの尺。 */
export const ORIN_BUBBLE_FADE_MS = 180;

/** 大きなオリンの絵の寸法（px）。台座の外径はこの約1.08倍になる。 */
export const ORIN_OVERLAY_CAT_SIZE_PX = 96;
/** 台座込みの外径（px）。絵96px＋片側リング4px＝104px。 */
export const ORIN_OVERLAY_PEDESTAL_SIZE_PX = 104;

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

export interface OrinSpeechBubbleProps {
  /** 表示する状態文。null の間はプレゼンスを出さない。 */
  text: string | null;
  /** オリンの姿（App 側の状態集約 headerCatState をそのまま渡す）。 */
  state: OriginCatStateKind;
  /** 名前のロケール（ja: オリン / en: Orin）。 */
  language: OriginLanguage;
  /** タップで「いまの作業」シートを開く（ヘッダーのオリンと同じ動作）。 */
  onOpenWorkSheet: () => void;
  /** 「いまの作業」シートが開いている間は即時に隠す。 */
  hidden?: boolean;
}

interface RenderedPresence {
  text: string;
  state: OriginCatStateKind;
}

export default function OrinSpeechBubble({ text, state, language, onOpenWorkSheet, hidden = false }: OrinSpeechBubbleProps) {
  const reduced = usePrefersReducedMotion();
  const [rendered, setRendered] = useState<RenderedPresence | null>(null);
  const [revealed, setRevealed] = useState(false);
  const renderedRef = useRef<RenderedPresence | null>(null);
  renderedRef.current = rendered;

  useEffect(() => {
    if (hidden) {
      // シートが開いたら競合させない：フェードを待たず即時に隠す。
      setRendered(null);
      setRevealed(false);
      return;
    }
    if (text !== null) {
      const wasHidden = renderedRef.current === null;
      setRendered({ text, state });
      if (!wasHidden || reduced) {
        // 段階の切り替わりでは点滅させない。reduced-motion では即時表示。
        setRevealed(true);
        return;
      }
      // 出現時のみフェード＋わずかな拡縮で出す。
      setRevealed(false);
      const frame = window.requestAnimationFrame(() => setRevealed(true));
      return () => window.cancelAnimationFrame(frame);
    }
    if (renderedRef.current === null) return;
    // 消去はフェードアウトのあとにアンマウントする。
    setRevealed(false);
    if (reduced) {
      setRendered(null);
      return;
    }
    const timer = window.setTimeout(() => setRendered(null), ORIN_BUBBLE_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [text, state, reduced, hidden]);

  if (hidden || rendered === null) return null;

  const ja = language !== 'en';
  return (
    <div
      className={`origin-orin-overlay${revealed ? ' is-visible' : ''}`}
      data-testid="origin-orin-overlay"
      style={{ opacity: revealed ? 1 : 0 }}
    >
      <button
        type="button"
        className="origin-orin-overlay__tap"
        onClick={onOpenWorkSheet}
        aria-label={ja ? 'いまの作業を表示' : 'Show current work'}
      >
        <OriginCatState state={rendered.state} size={ORIN_OVERLAY_CAT_SIZE_PX} pedestal />
        <span className="origin-orin-overlay__name" data-testid="origin-orin-overlay-name">
          {ja ? 'オリン' : 'Orin'}
        </span>
        <span className="origin-orin-overlay__pill" data-testid="origin-orin-overlay-status" role="status" aria-live="polite">
          {rendered.text}
        </span>
      </button>
    </div>
  );
}
