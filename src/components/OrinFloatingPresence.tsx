import { useEffect, useRef, useState } from 'react';
import OriginCatState, { ORIGIN_CAT_VIDEO_SRC, type OriginCatStateKind } from './OriginCatState';
import type { OriginLanguage } from '../i18n';

/**
 * オリンのプレゼンス（2026-11-14 08:59 ノリ指示、2026-11-17 帯方式、
 * 2026-11-20 「オリンの窓」方式、同日 10:10 浮遊＋自動縮小へ改訂、
 * 同日 12:06 枠なし＋上端から覗く形へ改訂）。
 *
 * オリンはヘッダーに「設置」されるのではなく、画面上部中央に
 * 常駐する。当初は position: fixed で画面に浮かせていたが、
 * スクロールする本文の上に重なって文字やコードを隠す問題が
 * 本番で確認されたため、ヘッダー直下の通常フロー内の帯に改めた
 * （2026-11-17）。それでも丸いアバター単体が目立ちすぎるという
 * オーナー指示（2026-11-20 08:30）で帯の中身を「オリン専用の
 * 窓」（不透明な面＋hairline 罫線＋角丸＋軽い影のパネル）に
 * 改め、同日 10:10 の refine で窓のまま浮遊配置へ戻した。
 *
 * しかしオーナーが実機で窓の枠を却下した（2026-11-20 12:06：
 * 「オリンの枠はいらない」。デザイン性のある穴・窓、または
 * 枠ではなく覗いている雰囲気でもよい、との指示）。統括の裁定
 * で「枠なし＋上端から覗くオリン」になった（同日 #1394）。
 *
 * その実機判定の続き（2026-11-20 15:36、スクリーンショット
 * 付き）：覗き配置では円盤の上部がヘッダーの裏に隠れ、猫の
 * 耳・頭が水平に切れて見える点が不可とされた。併せて、サイズ
 * は Muse のアバター相当（待機 48px／作業中・スクロール時
 * 36px、PC・スマホ共通）にし、統括が挙げた2つの注意点
 * （スクロール時に円盤の裏を通る行の数文字が一瞬隠れる／
 * 縮小時のタップの的が小さい）の修正も指示された。
 *
 * さらに同日 18:17 の実機判定で、PC・スマホともオリンが
 * 小さすぎて顔が見えず何なのか分かりにくいとされ、サイズを
 * 待機 72px／作業中・スクロール時 48px へ拡大した（PC・
 * スマホ共通は維持）。併せて、作業中コメントが入力文の
 * 丸写しに見える点（画像フェーズ文の主題埋め込みが主因。
 * 組み立て側で要約表現へ置換済み）と、テキストだけでは
 * 稼働中か分からない点への対応として、作業中のピル文末尾
 * に点滅ドットを付け、前景チャットの作業中は静止画では
 * なくタイピング動画で姿が動くようにした（App 側の状態
 * 集約）。現在の形：
 * - タップ対象から枠（border・背景・影・パネル角丸）を全て
 *   撤去し、円盤と状態テキストだけが浮く。状態テキストも枠を
 *   持たず、キャンバス色のハロー（text-shadow、CSS 側）で
 *   下を流れる本文の上でも読めるようにする。
 * - 円盤はヘッダーの下端より下に全体が見える配置にする
 *   （プレゼンス top はヘッダー下端の位置、タップのパディング
 *   分だけ下に離れる。CSS 側）。覗き見の演出より「頭が欠け
 *   ない」ことを優先し、画像（猫本体）は一切欠けない。
 * - 円盤の質感は 2026-11-21 の再デザイン（外部デザイン評価の
 *   回収）で改めた：待機静止画が透過背景アセットになったため、
 *   窪みの inset 影と円形の落影は撤去し、ラッパー（このコン
 *   ポーネント側で OriginCatState を包む span（__disc））は
 *   枠も影も持たない。残るのは足元の接地影（::after の楕円、
 *   ライトテーマのみ）だけで、ダークテーマではダーク専用絵の
 *   リムライトが輪郭を担う。静止画・動画のどちらの状態でも
 *   同じ扱いになる。
 * - 状態テキストは円盤の下に出す（同じく 2026-11-21 の再
 *   デザイン）：横に付けると待機時と作業時で見かけの中心が
 *   ずれるという指摘を受け、タップ対象を縦並びにして中心軸を
 *   全状態で固定した。
 * - タップの的は全状態で 44px 以上（タップ要素のパディング
 *   と最小寸法で確保、CSS 側）。見た目が 36px の縮小状態でも
 *   的は小さくならない。
 * - スクロール中は円盤の不透明度を約0.35 に下げ（App 側の
 *   scrolling 信号、復帰はスクロール停止後 約300ms）、下を
 *   通る本文の文字が透けて読めるようにする。（この緩和策は
 *   P4 改訂で廃止した。下記の改訂項を参照）
 * 配置は浮遊のまま（メイン列の相対配置を基準に absolute で
 * 上部中央。列の幅に追随させるため fixed ではなく列内
 * absolute を採る）。（P4 改訂で通常フロー内の行へ変更した。
 * 下記の改訂項を参照）姿の下の名前テキストは出さない
 * （2026-11-15 ノリ指示で削除。名前はタップで開くプロフィール
 * カードの中にだけ出す）。
 *
 * 自動縮小（2026-11-20 10:10、寸法は同日 15:36 の実機判定を
 * 経て同日 18:17 の実機判定で拡大）：
 * - 通常時（待機中・未スクロール）：絵は 72px。
 * - 作業中（状態テキストが表示されている間。チャットの読み
 *   込み中・エージェント実行中・画像生成中を含む）：絵は
 *   48px に縮む。状態テキストは表示中は常に見える。
 * - 会話がスクロールされている間（scrollTop が閾値超）：絵は
 *   48px。待機中ならオリンだけの小さい形になる。（P4 改訂で
 *   廃止。スクロールしても待機中は 72px のまま）
 * サイズ変化は約200msのトランジションで、prefers-reduced-motion
 * では即時切替。会話スクローラ側は、先頭行が円盤の下に隠れ
 * ないよう上部に円盤の下端より深いパディングを確保しつつ、
 * スクロールした内容は円盤の下を通過できる
 * （.origin-chat-scroll、CSS 側）。（パディングによる逃がしは
 * P4 改訂で不要になった：プレゼンスの行がスクローラの上に
 * あるため、内容は物理的に円盤の下へ入れない）
 *
 * 状態文の正本は従来どおり：段階→文の対応は resolveOrinBubbleText
 * の1表に集約し、文そのものは App 側で既存正本（waitingText／
 * researchStageText／imagePhaseText／完了・失敗キュー）から組み
 * 立てられたものをそのまま使う。文を出す条件（作業中だけ
 * 出す・回答が流れ始めたら引っ込む・完了／失敗キューは既存の
 * 尺だけ出す）も App 側の従来判定（bubbleText）がそのまま担う。
 *
 * 2026-11-20 の詳細化（オーナー指示）：ピル文の優先順位は
 * resolveOrinPillText の1表に集約し、末尾に「背景のエージェント
 * 作業の現在のステップ名」を足した。チャットが待機中でも裏で
 * エージェントが動いていれば、段階名ではなく実際のステップの
 * 平易なタイトルが円盤の下に出て、ステップが進むたびに切り替わる。
 * 画像フェーズ文も、段階名だけでなく依頼の主題（設計・描画）と
 * 実際に確認している観点（品質確認）を App 側で足す。
 *
 * 姿は App 側の状態集約（orinPresenceState）をそのまま流用する：
 * working 状態では既存の動画アセットで動き、それ以外は状態別の
 * 静止画。待機中（テキストなし）は円盤の中で静かな
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
 *
 * 2026-11-23 P4 改訂（週次品質検査の欠陥#4、2026-11-17 から
 * 継続）：配置を浮遊（メイン列内 absolute）から通常フロー内の
 * 専用行（ヘッダー直下・会話スクローラの上）へ戻した。浮遊形
 * では、スクロールした本文が円盤の下を通過し、スクロールが
 * 止まると不透明な円盤が本文の上に残って文字を隠した（フェード
 * 0.35 はスクロール中だけの緩和で、停止後に効かなかった）。
 * 行として場所を確保すれば、本文が下に潜る余地自体が無くなる。
 * あわせて、浮遊前提の緩和策2つを廃止した：スクロール中の
 * フェード（透けて読む対象が無くなった）とスクロール中の縮小
 * （フロー内では読書領域が 24px 跳ねるだけになる）。寸法は
 * 変えていない（待機 72px／作業中 48px）。名前が Floating の
 * ままなのは旧名の名残で、実体はフロー内の行である。
 */

/** 状態テキストの出現／消去トランジションの尺。 */
export const ORIN_PRESENCE_FADE_MS = 180;

/**
 * オリンの絵（円盤）の通常時の寸法（px）。旧・台座付き104pxの
 * 常駐は目立ちすぎるというオーナー指示（2026-11-20）で 56px に
 * したが、同日 15:36 の実機判定で「基本的に Muse のサイズで
 * よい。PC もスマホも」とされ、Muse のアバター相当の 48px に
 * 統一した（幅によるサイズ分岐はしない）。作業中・スクロール
 * 中は ORIN_PRESENCE_CAT_SIZE_COMPACT_PX へ自動で縮む（同日
 * 10:10 の refine 指示）。
 *
 * しかし同日 18:17 の実機判定で、PC・スマホとも小さすぎて
 * 顔が見えず何なのか分かりにくいとされ、72px へ拡大した
 * （全身像のため、顔の読み取りにはこの寸法が要る。幅による
 * サイズ分岐はしない＝PC・スマホ共通のまま）。
 */
export const ORIN_PRESENCE_CAT_SIZE_PX = 72;

/**
 * 自動縮小時の絵の寸法（px）。作業中（状態テキスト表示中）に
 * この大きさになり、プレゼンスの行が場所を取りすぎないように
 * する（2026-11-20 10:10 オーナー指示、寸法は同日 18:17 の
 * 実機判定で 36px から拡大）。スクロール中の縮小は P4 改訂
 * （2026-11-23）で廃止した：通常フロー内の行では、縮小は
 * 読書領域を 24px 跳ねさせるだけで、隠れ対策としての意味を
 * 失ったため。
 */
export const ORIN_PRESENCE_CAT_SIZE_COMPACT_PX = 48;

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

export interface OrinPillState {
  /** ピルに出す一文。出す文が無い間は null。 */
  text: string | null;
  /**
   * その文が「いま作業中」の文（前景のチャット作業・背景の
   * エージェント作業）か。完了・失敗の合図は作業の継続では
   * ないため false。プレゼンスは true の間だけ文末に点滅
   * ドットを付け、稼働中であることをテキスト自体でも見せる
   * （2026-11-20 18:17 の実機判定を受けた対応）。
   */
  active: boolean;
}

/**
 * ピルに出す一文と、その文が作業中かどうかの正本（2026-11-20
 * 詳細化でエージェント文を末尾に追加）：シート表示中は出さ
 * ない → 前景のチャット作業 → 失敗 → 完了 → 背景のエージェ
 * ント作業。呼び出し側は各文を「出す条件の間だけ非 null」に
 * して渡すこと。
 */
export function resolveOrinPillState(priority: OrinPillPriority): OrinPillState {
  if (priority.sheetOpen) return { text: null, active: false };
  if (priority.workingText !== null) return { text: priority.workingText, active: true };
  if (priority.failureText !== null) return { text: priority.failureText, active: false };
  if (priority.doneText !== null) return { text: priority.doneText, active: false };
  if (priority.agentText !== null) return { text: priority.agentText, active: true };
  return { text: null, active: false };
}

/**
 * ピルに出す一文だけが要る呼び出し向けの従来形
 * （resolveOrinPillState の text のみを返す）。
 */
export function resolveOrinPillText(priority: OrinPillPriority): string | null {
  return resolveOrinPillState(priority).text;
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
  /** 円盤の下に出す状態文。null の間は文を出さず、オリンだけの形になる。 */
  text: string | null;
  /**
   * 状態文が「いま作業中」の文か（App 側の resolveOrinPillState
   * が判定する）。true の間は文末に点滅ドットを付けて稼働中で
   * あることを見せる。文自体が末尾の省略記号（…）を持つ場合は
   * ドットがその役割を引き継ぐため、表示では省略記号を外す。
   * 完了・失敗の合図では付けない。
   */
  active?: boolean;
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

export default function OrinFloatingPresence({ text, active = false, state, language, onOpenWorkSheet, hidden = false, joySignal = 0 }: OrinFloatingPresenceProps) {
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
    // 姿はそのまま残し、オリンだけの形に戻る。
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
  // は絵を小さくする。テキスト自体は縮小しても常に見える
  // （作業中コメントの詳細化の要件）。スクロールでの縮小は
  // P4 改訂（2026-11-23）で廃止した（定数のコメント参照）。
  const compact = pillText !== null;
  const catSize = compact ? ORIN_PRESENCE_CAT_SIZE_COMPACT_PX : ORIN_PRESENCE_CAT_SIZE_PX;
  // 待機中（テキストが消えきって・動画でない状態）だけ、円盤の中で
  // 静かな呼吸を付ける。テキストのフェードアウト中はまだ付けない。
  // 「動画でない状態」は OriginCatState の状態→動画対応表で判定する
  // （M2-3 で working 以外に searching も動画になったため、状態名の
  // 固定比較ではなく対応表の有無で一般化した）。
  const breathing = pillText === null && ORIGIN_CAT_VIDEO_SRC[state] === undefined;
  // 作業中の文には末尾に点滅ドットを付ける（2026-11-20 18:17）。
  // 文自体が省略記号（…）で終わる場合はドットがその役割を引き
  // 継ぐため、表示では省略記号を外す（二重の点々を避ける）。
  // ドットは装飾であり、読み上げには含めない（aria-hidden）。
  const pillDisplayText = pillText !== null && active
    ? pillText.replace(/[…。.]+$/u, '')
    : pillText;
  return (
    <div className="origin-orin-presence" data-testid="origin-orin-presence">
      <button
        type="button"
        className={`origin-orin-presence__tap${pillText === null ? ' is-idle' : ''}${compact ? ' is-compact' : ''}`}
        onClick={onOpenWorkSheet}
        aria-label={ja ? 'いまの作業を表示' : 'Show current work'}
      >
        <span key={joySignal} className={`origin-orin-presence__disc inline-flex${joySignal > 0 ? ' origin-cat-joy' : ''}`}>
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
            {pillDisplayText}
            {active && (
              <span className="origin-orin-presence__dots" data-testid="origin-orin-presence-dots" aria-hidden="true">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            )}
          </span>
        )}
      </button>
    </div>
  );
}
