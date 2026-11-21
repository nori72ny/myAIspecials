import { useEffect } from 'react';
import { X } from 'lucide-react';
import OriginCatState, { ORIGIN_CAT_SEASON_FULL_SRC, resolveOriginCatSeason } from './OriginCatState';
import type { OriginLanguage } from '../i18n';

/**
 * オリンのプロフィールカード（2026-11-15、ノリ指示）。
 *
 * 画面上部中央の常駐オリンをタップすると開く。Muse アプリの
 * アバタータップと同じ考え方で、オリンのプロフィール（大きな姿・
 * 名前・ひとこと紹介）と「いまの作業」の一覧を1枚のカードに載せる。
 * 「いまの作業」は従来の上部シート（PR-β、2026-11-13）が載せていた
 * 内容そのまま：平易な項目タイトル＋状態（進行中／完了）＋最小限の
 * 進み具合だけで、詳細・ログ・技術用語は出さない（作業工程表示
 * ルール 2026-11-09）。詳しい作業内容は各画面側の表示（エージェント
 * 画面の実況パネルなど）に寄せ、ここは全体の要約に徹する。ただし
 * エージェント作業については、「いまの作業を表示」という操作の名に
 * 沿って、要約1行ではなく計画のステップ列（タイトル＋状態）までを
 * ここに載せる（データは run 記録の stepsState 由来の共有要約）。
 *
 * 内容と項目は全デバイスで完全に同一にし、表示形態だけを変える：
 * 広い画面（640px以上）では中央のカード型モーダル、狭い画面では
 * 下から出るシート型。切り替えは origin-top-ui.css の
 * .origin-orin-profile 側（ブレークポイント 640px）が担う。
 * 閉じる操作は×ボタン・カード外タップ・Escキーの3つ。
 */
/** エージェント作業の計画ステップ1件分（平易なタイトル＋状態）。 */
export interface OriginWorkSheetStep {
  title: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'blocked';
}

export interface OriginWorkSheetItem {
  id: string;
  /** 平易な項目タイトル（例：回答を準備しています、ウェブ調査）。 */
  title: string;
  status: 'active' | 'done';
  /** 出典の件数やステップの進み具合（n/m）などの最小限の補足。 */
  meta?: string;
  /** 実行中のエージェント作業だけが持つ、画面への移動アクション。 */
  action?: 'agent';
  /**
   * エージェント作業の計画ステップ列。「いまの作業を表示」の名に
   * 沿って、現在のステップ1行ではなく計画全体の進捗（各ステップの
   * 状態まで）を見せるために、エージェント項目だけが持つ。
   */
  steps?: readonly OriginWorkSheetStep[];
}

/** ステップ状態の平易な表示文（実況パネルの語彙と揃える）。 */
function workSheetStepStatusText(status: OriginWorkSheetStep['status'], ja: boolean): string {
  if (status === 'running') return ja ? '実行中' : 'In progress';
  if (status === 'completed') return ja ? '完了' : 'Done';
  if (status === 'failed' || status === 'blocked') return ja ? '止まりました' : 'Stopped';
  return ja ? 'まだ' : 'Pending';
}

export interface OriginWorkSheetProps {
  open: boolean;
  items: readonly OriginWorkSheetItem[];
  language: OriginLanguage;
  onClose: () => void;
  onOpenAgent?: () => void;
}

/** カードに大きく出すオリンの姿の寸法（px）。台座込みの外径はその約1.08倍。 */
export const ORIN_PROFILE_ART_SIZE_PX = 128;

export default function OriginWorkSheet({ open, items, language, onClose, onOpenAgent }: OriginWorkSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  const ja = language !== 'en';
  // 季節の完成イラスト（雪景色／お正月の着物姿）はプロフィールカードの
  // 中にだけ出す（オーナー決定 2026-11-21）。判定は OriginCatState の
  // 正本に寄せ、常駐の待機姿と同じ季節条件で切り替える。季節外は
  // 何も足さない。
  const season = resolveOriginCatSeason(new Date());
  return (
    <div className="origin-orin-profile">
      <button
        type="button"
        data-testid="origin-work-sheet-backdrop"
        aria-label={ja ? '閉じる' : 'Close'}
        onClick={onClose}
        className="origin-orin-profile__backdrop"
      />
      <section
        data-testid="origin-work-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={ja ? 'オリンのプロフィール' : "Orin's profile"}
        className="origin-orin-profile__card origin-surface"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={ja ? '閉じる' : 'Close'}
          className="origin-secondary-button origin-close-button absolute right-3 top-3"
        >
          <X aria-hidden="true" size={18} strokeWidth={2.1} />
        </button>
        <div className="flex flex-col items-center px-2 text-center">
          <span data-testid="origin-orin-profile-art" className="inline-flex">
            <OriginCatState state="waiting" size={ORIN_PROFILE_ART_SIZE_PX} pedestal />
          </span>
          <h2 data-testid="origin-orin-profile-name" className="m-0 mt-3 text-xl font-bold">
            {ja ? 'オリン' : 'Orin'}
          </h2>
          <p data-testid="origin-orin-profile-intro" className="m-0 mt-2 max-w-xs text-sm leading-6">
            {ja
              ? 'こんにちは、オリンです。調べものや資料づくりなど、やりたいことを伝えてください。'
              : "Hi, I'm Orin. Tell me what you'd like to do — looking things up, making documents, and more."}
          </p>
          {season !== null && (
            <figure data-testid="origin-orin-profile-season" className="m-0 mt-4">
              <img
                src={ORIGIN_CAT_SEASON_FULL_SRC[season]}
                alt=""
                draggable={false}
                className="h-auto w-full max-w-[300px] rounded-2xl"
              />
              <figcaption className="origin-muted mt-2 text-[13px]">
                {season === 'winter'
                  ? (ja ? '雪景色のオリン' : 'Orin in a snowy scene')
                  : (ja ? 'お正月のオリン' : 'Orin for the New Year')}
              </figcaption>
            </figure>
          )}
        </div>
        <div className="mt-5 border-t border-[var(--border-default)] pt-4">
          <h3 className="m-0 text-sm font-black">{ja ? 'いまの作業' : 'Current work'}</h3>
          {items.length === 0 ? (
            <p className="mb-1 mt-3 text-sm">{ja ? 'いまは作業していません' : 'Nothing is in progress right now'}</p>
          ) : (
            <ul className="m-0 mt-2 grid list-none gap-1 p-0">
              {items.map((item) => {
                const statusText = item.status === 'active' ? (ja ? '進行中' : 'In progress') : (ja ? '完了' : 'Done');
                const body = (
                  <>
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 shrink-0 rounded-full ${item.status === 'active' ? 'animate-pulse bg-[var(--accent-primary)]' : 'bg-[var(--text-secondary)]'}`}
                    />
                    <span className="min-w-0 flex-1 truncate font-semibold">{item.title}</span>
                    {item.meta && <span className="origin-muted shrink-0 text-[13px]">{item.meta}</span>}
                    <span className="origin-muted shrink-0 text-[13px]">{statusText}</span>
                  </>
                );
                return (
                  <li key={item.id}>
                    {item.action === 'agent' && item.status === 'active' && onOpenAgent ? (
                      <button
                        type="button"
                        data-testid="origin-work-sheet-agent-link"
                        onClick={() => { onClose(); onOpenAgent(); }}
                        className="origin-secondary-button flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm"
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="flex min-h-11 items-center gap-2 px-3 text-sm">{body}</div>
                    )}
                    {item.steps && item.steps.length > 0 && (
                      <ol data-testid="origin-work-sheet-steps" className="m-0 mb-1 grid list-none gap-0.5 p-0 pl-6 pr-3">
                        {item.steps.map((step, stepIndex) => (
                          <li key={`${stepIndex}-${step.title}`} className="flex min-h-8 items-center gap-2 text-sm">
                            <span aria-hidden="true" className="origin-muted shrink-0">{stepIndex + 1}.</span>
                            <span
                              aria-hidden="true"
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${step.status === 'running' ? 'animate-pulse bg-[var(--accent-primary)]' : step.status === 'completed' ? 'bg-[var(--text-secondary)]' : 'bg-[var(--border-default)]'}`}
                            />
                            <span className="min-w-0 flex-1 truncate font-semibold">{step.title}</span>
                            <span className="origin-muted shrink-0">{workSheetStepStatusText(step.status, ja)}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
