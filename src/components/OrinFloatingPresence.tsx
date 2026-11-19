import { useEffect, useRef, useState } from 'react';
import OriginCatState, { ORIGIN_CAT_VIDEO_SRC, type OriginCatStateKind } from './OriginCatState';
import type { OriginLanguage } from '../i18n';

/**
 * オリンのプレゼンス（2026-11-14 08:59 ノリ指示、2026-11-17 帯方式へ改訂）。
 *
 * オリンはヘッダーに「設置」されるのではなく、Muse アプリの
 * アバターのように画面上部中央に常駐する。当初は position: fixed
 * で画面に浮かせていたが、スクロールする本文の上に重なって文字や
 * コードを隠す問題が本番で確認されたため、ヘッダー直下の通常
 * フロー内の帯に改めた。帯は通常フローにあるので本文と重なる
 * ことはなく、ピルが出ると帯が伸びて本文が下がる。待機中も
 * 作業中も同じ大きさ（台座リング付き104px）で、回答が終わっても
 * 小さいヘッダーアイコンには縮まない（ヘッダー中央のオリンは
 * 廃止し、このプレゼンスに一本化した）。現在の作業を平易な一文で
 * 示す濃色ピルは作業中だけ姿の下に出す。完了・失敗の合図が
 * 終われば消えるのはピルだけで、姿は残る。姿の下の名前テキストは
 * 出さない（2026-11-15 ノリ指示で削除。名前はタップで開く
 * プロフィールカードの中にだけ出す）。
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
 * タップで小さく喜ぶ動き（跳ねる＋頷く、合図は App 側の
 * joySignal）をして、オリンのプロフィールカードを開く
 * （2026-11-15、Muse アプリのアバタータップと同じ考え方）。
 * カードは中央モーダル／下部シートのどちらでもプレゼンスと
 * 重ならないため、カードが開いている間もプレゼンスは隠さない
 * （喜ぶ動きを見せるため）。「いまの作業を表示」という名前の
 * 操作はこのプレゼンスのタップ対象ただ1つだけ（ヘッダー側の
 * 同名ボタンは廃止した）。
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
  /** タップでオリンのプロフィールカードを開く。 */
  onOpenWorkSheet: () => void;
  /** プレゼンス自体を隠す（カード表示中は使わない。汎用の非表示指定）。 */
  hidden?: boolean;
  /** タップ時の一回性の「喜ぶ」動きの合図（App 側で数える）。 */
  joySignal?: number;
}

export default function OrinFloatingPresence({ text, state, language, onOpenWorkSheet, hidden = false, joySignal = 0 }: OrinFloatingPresenceProps) {
  const reduced = usePrefersReducedMotion();
  const [pillText, setPillText] = useState<string | null>(null);
  const [pillRevealed, setPillRevealed] = useState(false);
  const pillTextRef = useRef<string | null>(null);
  pillTextRef.current = pillText;

  useEffect(() => {
    if (hidden) {
      // 非表示にされたら競合させない：フェードを待たずピルもろとも隠す
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
    // 完了・失敗の合図が終わったら、消えるのはピルだけ。姿は
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
  // 「動画でない状態」は OriginCatState の状態→動画対応表で判定する
  // （M2-3 で working 以外に searching も動画になったため、状態名の
  // 固定比較ではなく対応表の有無で一般化した）。
  const breathing = pillText === null && ORIGIN_CAT_VIDEO_SRC[state] === undefined;
  return (
    <div className="origin-orin-presence" data-testid="origin-orin-presence">
      <button
        type="button"
        className="origin-orin-presence__tap"
        onClick={onOpenWorkSheet}
        aria-label={ja ? 'いまの作業を表示' : 'Show current work'}
      >
        <span key={joySignal} className={joySignal > 0 ? 'origin-cat-joy inline-flex' : 'inline-flex'}>
          <OriginCatState state={state} size={ORIN_PRESENCE_CAT_SIZE_PX} pedestal breathing={breathing} />
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
