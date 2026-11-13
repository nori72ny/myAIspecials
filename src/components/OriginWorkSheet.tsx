import { X } from 'lucide-react';
import type { OriginLanguage } from '../i18n';

/**
 * 「いまの作業」シート（PR-β、設計正本 §9、2026-11-13）。
 *
 * ヘッダー上部中央の常駐オリンをタップすると上から開く、現在の
 * 作業の一覧。載せるのは平易な項目タイトル＋状態（進行中／完了）
 * ＋最小限の進み具合だけで、詳細・ログ・技術用語は出さない
 * （作業工程表示ルール 2026-11-09）。詳しい作業内容は各画面側の
 * 表示（エージェント画面の実況パネルなど）に寄せ、ここは全体の
 * 要約に徹する。
 */
export interface OriginWorkSheetItem {
  id: string;
  /** 平易な項目タイトル（例：回答を準備しています、ウェブ調査）。 */
  title: string;
  status: 'active' | 'done';
  /** 出典の件数やステップの進み具合（n/m）などの最小限の補足。 */
  meta?: string;
  /** 実行中のエージェント作業だけが持つ、画面への移動アクション。 */
  action?: 'agent';
}

export interface OriginWorkSheetProps {
  open: boolean;
  items: readonly OriginWorkSheetItem[];
  language: OriginLanguage;
  onClose: () => void;
  onOpenAgent?: () => void;
}

export default function OriginWorkSheet({ open, items, language, onClose, onOpenAgent }: OriginWorkSheetProps) {
  if (!open) return null;
  const ja = language !== 'en';
  return (
    <>
      <button
        type="button"
        data-testid="origin-work-sheet-backdrop"
        aria-label={ja ? '閉じる' : 'Close'}
        onClick={onClose}
        className="absolute inset-0 z-20 h-full w-full cursor-default"
      />
      <div className="absolute inset-x-0 top-14 z-30 mx-auto w-full max-w-md px-3">
        <section
          data-testid="origin-work-sheet"
          role="dialog"
          aria-label={ja ? 'いまの作業' : 'Current work'}
          className="origin-surface rounded-2xl border border-[var(--border-default)] p-4 shadow-lg"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 text-sm font-black">{ja ? 'いまの作業' : 'Current work'}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={ja ? '閉じる' : 'Close'}
              className="origin-secondary-button inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px]"
            >
              <X aria-hidden="true" size={17} strokeWidth={2.1} />
            </button>
          </div>
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
                        className="origin-secondary-button flex min-h-11 w-full items-center gap-2 rounded-[10px] px-3 text-left text-sm"
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="flex min-h-11 items-center gap-2 px-3 text-sm">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
