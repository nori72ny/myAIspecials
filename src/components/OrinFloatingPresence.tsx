import { useEffect, useRef, useState } from 'react';
import OriginCatState, { ORIGIN_CAT_VIDEO_SRC, type OriginCatStateKind } from './OriginCatState';
import type { OriginLanguage } from '../i18n';

/**
 * オリンのプレゼンス（2026-11-14 08:59 ノリ指示、2026-11-17 帯方式、
 * 2026-11-20 「オリンの窓」方式、同日 10:10 浮遊＋自動縮小へ改訂）。
 *
 * オリンはヘッダーに「設置」されるのではなく、画面上部中央に
 * 常駐する。当初は position: fixed で画面に浮かせていたが、
 * スクロールする本文の上に重なって文字やコードを隠す問題が
 * 本番で確認されたため、ヘッダー直下の通常フロー内の帯に改めた
 * （2026-11-17）。それでも丸いアバター単体が目立ちすぎるという
 * オーナー指示（2026-11-20 08:30）で、帯の中身を「オリン専用の
 * 窓」に改めた：不透明な面（--bg-surface）＋1px hairline 罫線＋
 * --radius-panel の角丸＋ --shadow-1 だけの影を持つ小さな
 * パネルが1つのUI要素として収まり、左にオリン、右に状態
 * テキストを置く。姿の下の名前テキストは出さない（2026-11-15
 * ノリ指示で削除。名前はタップで開くプロフィールカードの中に
 * だけ出す）。
 *
 * その後オーナーが実機スクリーンショット付きで方向を refine
 * した（2026-11-20 10:10）：手本は Muse アプリの Muse
 * アバターで、小さく浮遊し、その下をコンテンツがスクロール
 * して読める形がよい。浮遊自体は可とし、代わりにオリン自体が
 * 自動的に小さくなること（チャットやエージェントで依頼をして
 * いるとき、スクロールしているとき）。これを受けて、窓の形は
 * そのままに配置を浮遊へ戻し（メイン列の相対配置を基準に
 * absolute で上部中央。列の幅に追随させるため fixed ではなく
 * 列内 absolute を採る）、自動縮小を入れた：
 * - 通常時（待機中・未スクロール）：絵は 56px の窓。
 * - 作業中（状態テキストが表示されている間。チャットの読み
 *   込み中・エージェント実行中・画像生成中を含む）：絵は
 *   36px に縮む。状態テキストは表示中は常に見える。
 * - 会話がスクロールされている間（scrollTop が閾値超）：絵は
 *   36px。待機中ならオリンだけの小さい窓になる。
 * サイズ変化は約200msのトランジションで、prefers-reduced-motion
 * では即時切替。会話スクローラ側は、先頭行が浮遊窓の下に隠れ
 * ないよう上部に窓の高さ分のパディングを確保しつつ、スクロール
 * した内容は窓の下を通過できる（.origin-chat-scroll、CSS 側）。
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
 * 静止画。待機中（テキストなし・未スクロール）は窓の中で静かな
 * 呼吸（上限は OriginCatState の ORIGIN_CAT_IDLE_MOTION_* の
 * とおり）。prefers-reduced-motion では動画を使わず静止画にし、
 * 呼吸もテキストのフェードも無くす（即時表示・即時消去）。
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
 * 窓の中のオリンの絵の通常時の寸法（px）。旧・台座付き104pxの
 * 常駐は目立ちすぎるというオーナー指示（2026-11-20）で、窓の
 * 枠内に収まる 56px にした。作業中・スクロール中は
 * ORIN_PRESENCE_CAT_SIZE_COMPACT_PX へ自動で縮む（同日 10:10
 * の refine 指示）。
 */
export const ORIN_PRESENCE_CAT_SIZE_PX = 56;

/**
 * 自動縮小時の絵の寸法（px）。作業中（状態テキスト表示中）と
 * 会話のスクロール中にこの大きさになり、浮遊窓の下を内容が
 * 読み進められる余地を広げる（2026-11-20 10:10 オーナー指示）。
 */
export const ORIN_PRESENCE_CAT_SIZE_COMPACT_PX = 36;

/**
 * 会話スクローラの scrollTop がこの px を超えたら「スクロール
 * されている」とみなして絵を縮める閾値（App 側のスクロール
 * 判定が使う正本）。
 */
export const ORIN_PRESENCE_SCROLL_SHRINK_THRESHOLD_PX = 40;

/** 絵のサイズ変化のトランジションの尺（CSS 側と一致させる）。 */
export const ORIN_PRESENCE_RESIZE_MS = 200;

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
  /**
   * 会話がスクロールされているか（scrollTop が
   * ORIN_PRESENCE_SCROLL_SHRINK_THRESHOLD_PX 超。App 側が
   * chatScrollRef のスクロールから集約して渡す）。true の間は
   * 作業中でなくても絵が自動で小さくなる。
   */
  scrolled?: boolean;
}

export default function OrinFloatingPresence({ text, state, language, onOpenWorkSheet, hidden = false, joySignal = 0, scrolled = false }: OrinFloatingPresenceProps) {
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
  // 自動縮小（2026-11-20 10:10）：状態テキストが表示されている間
  // （作業中。フェードアウトの間もテキストは見えているので含む）
  // と、会話がスクロールされている間は絵を小さくする。テキスト
  // 自体は縮小しても常に見える（作業中コメントの詳細化の要件）。
  const compact = scrolled || pillText !== null;
  const catSize = compact ? ORIN_PRESENCE_CAT_SIZE_COMPACT_PX : ORIN_PRESENCE_CAT_SIZE_PX;
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
        className={`origin-orin-presence__tap${pillText === null ? ' is-idle' : ''}${compact ? ' is-compact' : ''}`}
        onClick={onOpenWorkSheet}
        aria-label={ja ? 'いまの作業を表示' : 'Show current work'}
      >
        <span key={joySignal} className={joySignal > 0 ? 'origin-cat-joy inline-flex' : 'inline-flex'}>
          <OriginCatState state={state} size={catSize} breathing={breathing} />
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
