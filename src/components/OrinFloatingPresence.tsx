import { useEffect, useRef, useState } from 'react';
import OriginCatState, { ORIGIN_CAT_VIDEO_SRC, type OriginCatStateKind } from './OriginCatState';
import type { OriginLanguage } from '../i18n';

/**
 * オリンのプレゼンス（2026-11-14 08:59 ノリ指示、2026-11-17 帯方式、
 * 2026-11-20 「オリンの窓」方式へ改訂）。
 *
 * オリンはヘッダーに「設置」されるのではなく、画面上部中央に
 * 常駐する。当初は position: fixed で画面に浮かせていたが、
 * スクロールする本文の上に重なって文字やコードを隠す問題が
 * 本番で確認されたため、ヘッダー直下の通常フロー内の帯に改めた
 * （2026-11-17）。それでも丸いアバター単体が目立ちすぎるという
 * オーナー指示（2026-11-20 08:30）で、帯の中身を「オリン専用の
 * 窓」に改めた：不透明な面（--bg-surface）＋1px hairline 罫線＋
 * --radius-panel の角丸＋ --shadow-1 だけの影を持つ小さな
 * パネルが1つのUI要素として帯に収まり、左にオリン（56px、
 * 台座は窓が枠を担うため付けない）、右に状態テキストを置く。
 * 画面切り替えや機能で位置が動いても、窓ごと一体で扱う。
 * テキストが無い待機時は窓はオリンだけの小さな形に縮む。
 * 窓は通常フロー内の帯にあるため本文と重なることはなく、
 * テキストが出ると帯が伸びて本文が下がる。姿の下の名前
 * テキストは出さない（2026-11-15 ノリ指示で削除。名前は
 * タップで開くプロフィールカードの中にだけ出す）。
 *
 * 状態文の正本は従来どおり：段階→文の対応は resolveOrinBubbleText
 * の1表に集約し、文そのものは App 側で既存正本（waitingText／
 * researchStageText／imagePhaseText／完了・失敗キュー）から組み
 * 立てられたものをそのまま使う。窓に文を出す条件（作業中だけ
 * 出す・回答が流れ始めたら引っ込む・完了／失敗キューは既存の
 * 尺だけ出す）も App 側の従来判定（bubbleText）がそのまま担う。
 *
 * 2026-11-20 の詳細化（オーナー指示）：ピル文の優先順位は
 * resolveOrinPillText の1表に集約し、末尾に「背景のエージェント
 * 作業の現在のステップ名」を足した。チャットが待機中でも裏で
 * エージェントが動いていれば、段階名ではなく実際のステップの
 * 平易なタイトルが窓に出て、ステップが進むたびに切り替わる。
 * 画像フェーズ文も、段階名だけでなく依頼の主題（設計・描画）と
 * 実際に確認している観点（品質確認）を App 側で足す。
 *
 * 姿は App 側の状態集約（orinPresenceState）をそのまま流用する：
 * working 状態では既存の動画アセットで動き、それ以外は状態別の
 * 静止画。待機中（テキストなし）は窓の中で静かな呼吸（上限は
 * OriginCatState の ORIGIN_CAT_IDLE_MOTION_* のとおり）。
 * prefers-reduced-motion では動画を使わず静止画にし、呼吸も
 * テキストのフェードも無くす（即時表示・即時消去）。
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

/** 状態テキストの出現／消去トランジションの尺。 */
export const ORIN_PRESENCE_FADE_MS = 180;

/**
 * 窓の中のオリンの絵の寸法（px）。旧・台座付き104pxの常駐は
 * 目立ちすぎるというオーナー指示（2026-11-20）で、窓の枠内に
 * 収まる 56px にした。待機・作業で不変（窓の横幅だけが
 * テキストの有無で変わる）。
 */
export const ORIN_PRESENCE_CAT_SIZE_PX = 56;

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

export interface OrinAgentBubbleSignals {
  /** エージェント実行中であり、要約が新しい（鮮度判定まで読み手側で集約済み）。 */
  agentActive: boolean;
  /** チャットの送信が進行中。前景の作業がある間はエージェント文を出さない。 */
  chatLoading: boolean;
  /** 現在のステップの平易なタイトル（計画側の正本そのまま）。無い場合は null。 */
  stepTitle: string | null;
}

/**
 * 背景で進むエージェント作業のピル文（2026-11-20 オーナー指示の
 * 詳細化）。段階名ではなく「いま実際にしていること」を出すため、
 * 現在のステップの平易なタイトルそのものを文にする。ステップが
 * 進めばタイトルが変わり、ピルも切り替わる。タイトルが無い場合
 * だけ汎用の文に落とす。チャットの送信中は前景の作業文が担う
 * ので出さない（優先順位は resolveOrinPillText が正本）。
 */
export function resolveOrinAgentBubbleText(signals: OrinAgentBubbleSignals, fallbackText: string): string | null {
  if (!signals.agentActive || signals.chatLoading) return null;
  return signals.stepTitle ?? fallbackText;
}

export interface OrinPillPriority {
  /** 作業シート（プロフィールカード）が開いている間はピルを出さない。 */
  sheetOpen: boolean;
  /** 前景のチャット作業文（待ち・調査段階・画像フェーズ）。出す条件の間だけ非 null で渡す。 */
  workingText: string | null;
  /** 失敗キューの文。キューの間だけ非 null で渡す。 */
  failureText: string | null;
  /** 完了キューの文。キューの間だけ非 null で渡す。 */
  doneText: string | null;
  /** 背景のエージェント作業文（現在のステップ名）。 */
  agentText: string | null;
}

/**
 * ピルに出す一文の優先順位の正本（2026-11-20 詳細化でエージェント
 * 文を末尾に追加）：シート表示中は出さない → 前景のチャット作業
 * → 失敗 → 完了 → 背景のエージェント作業。呼び出し側は各文を
 * 「出す条件の間だけ非 null」にして渡すこと。
 */
export function resolveOrinPillText(priority: OrinPillPriority): string | null {
  if (priority.sheetOpen) return null;
  if (priority.workingText !== null) return priority.workingText;
  if (priority.failureText !== null) return priority.failureText;
  if (priority.doneText !== null) return priority.doneText;
  return priority.agentText;
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
  /** 窓の右側に出す状態文。null の間は文を出さず、窓はオリンだけの小形になる。 */
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
      // 状態テキストの出現時のみフェードで出す（姿は動かさない）。
      setPillRevealed(false);
      const frame = window.requestAnimationFrame(() => setPillRevealed(true));
      return () => window.cancelAnimationFrame(frame);
    }
    if (pillTextRef.current === null) return;
    // 完了・失敗の合図が終わったら、消えるのは状態テキストだけ。
    // 窓と姿はそのまま残し、窓はオリンだけの小形に縮む。
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
  // 待機中（テキストが消えきって・動画でない状態）だけ、窓の中で
  // 静かな呼吸を付ける。テキストのフェードアウト中はまだ付けない。
  // 「動画でない状態」は OriginCatState の状態→動画対応表で判定する
  // （M2-3 で working 以外に searching も動画になったため、状態名の
  // 固定比較ではなく対応表の有無で一般化した）。
  const breathing = pillText === null && ORIGIN_CAT_VIDEO_SRC[state] === undefined;
  return (
    <div className="origin-orin-presence" data-testid="origin-orin-presence">
      <button
        type="button"
        className={`origin-orin-presence__tap${pillText === null ? ' is-idle' : ''}`}
        onClick={onOpenWorkSheet}
        aria-label={ja ? 'いまの作業を表示' : 'Show current work'}
      >
        <span key={joySignal} className={joySignal > 0 ? 'origin-cat-joy inline-flex' : 'inline-flex'}>
          <OriginCatState state={state} size={ORIN_PRESENCE_CAT_SIZE_PX} breathing={breathing} />
        </span>
        {pillText !== null && (
          <span
            className={`origin-orin-presence__status${pillRevealed ? ' is-visible' : ''}`}
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
