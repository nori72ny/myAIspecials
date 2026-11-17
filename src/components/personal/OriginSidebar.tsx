import { Bot, CodeXml, MessageSquare, PanelLeftClose, Plus, Settings } from 'lucide-react';
import OriginBrandLockup from '../OriginBrandLockup';
import type { OriginWorkspaceModeV31 } from './OriginWorkspaceModeV31';

/**
 * サイドバー（レイアウト設計 2026-11-16 の段階1：シェルの導入）。
 *
 * 置き場所は PersonalEditionApp のシェル階層で、中身は行き先だけに絞る：
 * ブランド／新しい会話／チャット・エージェント・コード／設定。
 * 履歴はまだ入れない（段階2で HistoryDrawer から移す。それまでは現行の
 * ヘッダーの履歴ドロワーをそのまま使う）。「作る」「画像生成」は行き先
 * ではなくチャット内の操作なので置かない（オーナー決定 2026-11-12）。
 *
 * 方式は幅で切り替える：1,024px 以上はプッシュ式（メイン領域が狭まる）、
 * 未満は左から重なるドロワー＋スクリム。開閉状態の端末内保存と、PC で
 * 開いたときのオリンの中央位置の調整は段階3で扱う。
 */
type OriginSidebarProps = {
  open: boolean;
  workspace: OriginWorkspaceModeV31;
  isEn: boolean;
  onClose: () => void;
  onNavigate: (mode: OriginWorkspaceModeV31) => void;
  onNewConversation: () => void;
  onOpenSettings?: () => void;
};

const NAV_ITEMS: ReadonlyArray<{
  mode: OriginWorkspaceModeV31;
  ja: string;
  en: string;
  Icon: typeof MessageSquare;
}> = [
  { mode: 'chat', ja: 'チャット', en: 'Chat', Icon: MessageSquare },
  { mode: 'agent', ja: 'エージェント', en: 'Agent', Icon: Bot },
  { mode: 'coding', ja: 'コード', en: 'Code', Icon: CodeXml },
];

export default function OriginSidebar({
  open,
  workspace,
  isEn,
  onClose,
  onNavigate,
  onNewConversation,
  onOpenSettings,
}: OriginSidebarProps) {
  return (
    <>
      {open && (
        <button
          type="button"
          data-testid="sidebar-scrim"
          aria-hidden="true"
          tabIndex={-1}
          onClick={onClose}
          className="origin-sidebar-scrim fixed inset-0 z-40 lg:hidden"
        />
      )}
      <aside
        data-testid="origin-sidebar"
        aria-label={isEn ? 'Sidebar' : 'サイドバー'}
        aria-hidden={!open}
        inert={!open}
        data-open={open}
        className={`origin-sidebar-safe-area origin-sidebar fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col border-r border-origin-border lg:static lg:z-auto lg:shrink-0 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full lg:-ml-[280px]'
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <OriginBrandLockup />
          <button
            type="button"
            data-testid="sidebar-close"
            aria-label={isEn ? 'Close sidebar' : 'サイドバーを閉じる'}
            onClick={onClose}
            className="origin-sidebar-item inline-flex h-11 min-h-11 w-11 shrink-0 items-center justify-center"
          >
            <PanelLeftClose aria-hidden="true" size={18} strokeWidth={1.9} />
          </button>
        </div>

        <div className="px-3 py-2">
          <button
            type="button"
            data-testid="sidebar-new-conversation"
            onClick={onNewConversation}
            className="origin-sidebar-item flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm"
          >
            <Plus aria-hidden="true" size={18} strokeWidth={1.9} />
            {isEn ? 'New conversation' : '新しい会話'}
          </button>
        </div>

        <nav aria-label={isEn ? 'Switch screen' : '画面切り替え'} className="flex flex-col gap-1 px-3 py-1">
          {NAV_ITEMS.map(({ mode, ja, en, Icon }) => {
            const active = workspace === mode;
            return (
              <button
                key={mode}
                type="button"
                data-testid={`sidebar-nav-${mode}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => onNavigate(mode)}
                className={`${
                  active ? 'origin-nav-active' : 'origin-sidebar-item'
                } flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm`}
              >
                <Icon aria-hidden="true" size={18} strokeWidth={1.9} />
                {isEn ? en : ja}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto px-3 pb-1 pt-2">
          <button
            type="button"
            data-testid="sidebar-settings"
            onClick={onOpenSettings}
            className="origin-sidebar-item flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm"
          >
            <Settings aria-hidden="true" size={18} strokeWidth={1.9} />
            {isEn ? 'Settings' : '設定'}
          </button>
        </div>
      </aside>
    </>
  );
}
