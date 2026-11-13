import { useEffect, useRef, useState } from 'react';

/**
 * 常駐オリンの吹き出し（待ち表示の仕様修正、2026-11-13 22:03 ノリ指示。
 * 設計正本：~/workspace/origin-fix/ORIN_WAITING_DISPLAY_REVISION_2026-11-13.md）。
 *
 * 全体画面ステージ（PR-δ1）は本番の待ち表示から外し、代わりに画面
 * 上部中央の常駐オリンが吹き出しで今の段階を一文で伝える。会話画面は
 * 切り替わらず、会話内の1行待ち表示もこの吹き出しに一本化する
 * （二重表示にしない）。
 *
 * 文言は新しいものを作らず既存の正本（waitingText／researchStageText／
 * imagePhaseText）を使う。段階→文の対応は resolveOrinBubbleText の
 * 1表に集約し、旧ステージの対応表と同じ優先順位を保つ。表記は1行
 * 表示側の既存文（末尾の「…」付き）に寄せる。
 *
 * 動きはフェードイン／アウトのみ。prefers-reduced-motion では
 * フェード自体を無くす（即時表示・即時消去）。
 */

/** 吹き出しのフェード（イン／アウト共通）の尺。 */
export const ORIN_BUBBLE_FADE_MS = 180;

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
 * 段階→吹き出し文の対応表。旧ステージ（resolveOrinStageDisplay）と
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
  /** 表示する一文。null の間は吹き出しを出さない。 */
  text: string | null;
}

export default function OrinSpeechBubble({ text }: OrinSpeechBubbleProps) {
  const reduced = usePrefersReducedMotion();
  const [renderedText, setRenderedText] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const renderedRef = useRef<string | null>(null);
  renderedRef.current = renderedText;

  useEffect(() => {
    if (text !== null) {
      const wasHidden = renderedRef.current === null;
      setRenderedText(text);
      if (!wasHidden || reduced) {
        // 段階の切り替わりでは点滅させない。reduced-motion では即時表示。
        setRevealed(true);
        return;
      }
      // 出現時のみフェードインする。
      setRevealed(false);
      const frame = window.requestAnimationFrame(() => setRevealed(true));
      return () => window.cancelAnimationFrame(frame);
    }
    if (renderedRef.current === null) return;
    // 消去はフェードアウトのあとにアンマウントする。
    setRevealed(false);
    if (reduced) {
      setRenderedText(null);
      return;
    }
    const timer = window.setTimeout(() => setRenderedText(null), ORIN_BUBBLE_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [text, reduced]);

  if (renderedText === null) return null;

  return (
    <div
      className="origin-orin-bubble"
      data-testid="origin-orin-bubble"
      style={{ opacity: revealed ? 1 : 0 }}
    >
      <div className="origin-orin-bubble-body" role="status" aria-live="polite">
        <span className="origin-orin-bubble-tail" aria-hidden="true" />
        {renderedText}
      </div>
    </div>
  );
}
