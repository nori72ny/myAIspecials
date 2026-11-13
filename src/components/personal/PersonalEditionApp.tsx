import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import App from '../../App';
import { ArtifactWorkspace } from '../../App';
import type { ArtifactBlock, ConversationMessage, ConversationSession } from '../../App';
import type { Settings } from '../../types';
import type { OriginWorkspaceModeV31 } from './OriginWorkspaceModeV31';

const CodingJobWorkspace = lazy(() => import('./CodingWorkspaceV31'));
const CreativePanel = lazy(() => import('../CreativePanelV15'));
const AgentWorkspace = lazy(() => import('../AgentWorkspaceView'));

type MobileChatSurface = 'conversation' | 'artifact';

function workspaceLocation(): OriginWorkspaceModeV31 {
  const workspace = new URLSearchParams(window.location.search).get('workspace');
  if (workspace === 'agent' || workspace === 'coding') return workspace;
  return 'chat';
}

type PersonalEditionAppProps = {
  settings?: Settings;
  onOpenSettings?: () => void;
  messages?: ConversationMessage[];
  sessions?: readonly ConversationSession[];
  artifacts?: readonly ArtifactBlock[];
  onArchiveSession?: (messages: readonly ConversationMessage[]) => void;
  onRestoreSession?: (session: ConversationSession) => void;
  onMessagesChange?: (messages: ConversationMessage[]) => void;
  onArtifactsChange?: (artifacts: ArtifactBlock[]) => void;
  resetSignal?: number;
};

const PersonalEditionApp = React.memo(function PersonalEditionApp({
  settings,
  onOpenSettings,
  messages: parentMessages,
  sessions: parentSessions,
  artifacts: parentArtifacts,
  onArchiveSession: parentOnArchiveSession,
  onRestoreSession: parentOnRestoreSession,
  onMessagesChange: parentOnMessagesChange,
  onArtifactsChange: parentOnArtifactsChange,
  resetSignal = 0,
}: PersonalEditionAppProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>(() => parentMessages ?? []);
  // 新規ロードでは URL に前回のワークスペース（?workspace=…）が残って
  // いても復元せず、必ずチャットのトップ画面から始める
  // （オーナー指示 2026-11-09）。セッション内の移動と popstate の
  // 同期では従来どおり workspaceLocation を使う。
  const [workspace, setWorkspace] = useState<OriginWorkspaceModeV31>('chat');
  const [codingInitialGoal, setCodingInitialGoal] = useState('');
  // 「作る」は専用画面ではなく、会話のそばに開くパネルになった
  // （画面構成の移行・第3段）。null = 閉じている、文字列 = その依頼で開く。
  const [creativePanelRequest, setCreativePanelRequest] = useState<string | null>(null);
  const [mobileSurface, setMobileSurface] = useState<MobileChatSurface>('conversation');
  const isEn = settings?.language === 'en';

  useEffect(() => {
    const sync = () => {
      setWorkspace(workspaceLocation());
      setCodingInitialGoal('');
      setCreativePanelRequest(null);
      setMobileSurface('conversation');
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const switchWorkspace = (next: OriginWorkspaceModeV31) => {
    const url = new URL(window.location.href);
    if (next === 'chat') url.searchParams.delete('workspace');
    else url.searchParams.set('workspace', next);
    window.history.pushState(null, '', url);
    if (next !== 'coding') setCodingInitialGoal('');
    setCreativePanelRequest(null);
    setMobileSurface('conversation');
    setWorkspace(next);
  };

  const openCodingWorkspace = (goal?: string) => {
    setCodingInitialGoal(goal?.trim().slice(0, 4000) ?? '');
    switchWorkspace('coding');
  };

  // 「作る」は画面遷移ではなく、会話のそばにパネルを開く（項目名は維持）。
  const openCreativePanel = (request?: string) => {
    setCreativePanelRequest(request?.trim().slice(0, 4000) ?? '');
  };

  const [artifacts, setArtifacts] = useState<ArtifactBlock[]>(() => [...(parentArtifacts ?? [])]);
  useEffect(() => { if (parentMessages) setMessages(parentMessages); }, [parentMessages]);
  useEffect(() => { if (parentArtifacts) setArtifacts([...parentArtifacts]); }, [parentArtifacts]);

  const effectiveSessions = parentSessions ?? [];
  const latestArtifact = artifacts.at(-1) ?? null;
  const handleMessagesChange = useCallback((nextMessages: ConversationMessage[]) => { setMessages(nextMessages); parentOnMessagesChange?.(nextMessages); }, [parentOnMessagesChange]);
  const handleArtifactsChange = useCallback((nextArtifacts: ArtifactBlock[]) => { setArtifacts(nextArtifacts); parentOnArtifactsChange?.(nextArtifacts); }, [parentOnArtifactsChange]);
  const handleArtifactRevision = useCallback((next: ArtifactBlock) => {
    setArtifacts((current) => {
      const updated = current.map((artifact) => artifact.id === next.id ? next : artifact);
      parentOnArtifactsChange?.(updated);
      return updated;
    });
  }, [parentOnArtifactsChange]);
  // 「作る」パネルで生成された成果物を会話の成果物として取り込む。
  // 同じ検証済みバイト（同じID）の再生成は重複させず置き換える。
  const handleCreativeArtifactCreated = useCallback((next: ArtifactBlock) => {
    setArtifacts((current) => {
      const updated = current.some((artifact) => artifact.id === next.id)
        ? current.map((artifact) => artifact.id === next.id ? next : artifact)
        : [...current, next];
      parentOnArtifactsChange?.(updated);
      return updated;
    });
  }, [parentOnArtifactsChange]);
  const handleArchiveSession = useCallback((nextMessages: readonly ConversationMessage[]) => { parentOnArchiveSession?.(nextMessages); }, [parentOnArchiveSession]);
  const handleRestoreSession = useCallback((session: ConversationSession) => {
    const restored = session.messages.map((message) => ({ ...message }));
    setMessages(restored);
    parentOnRestoreSession?.(session);
    parentOnMessagesChange?.(restored);
  }, [parentOnMessagesChange, parentOnRestoreSession]);

  return <div className="origin-personal-shell flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden">
    {workspace === 'chat' && <a href="#origin-main" className="origin-skip-link">{isEn ? 'Skip to main content' : 'メインコンテンツへスキップ'}</a>}
    {workspace !== 'chat' && <section aria-label="Workspace tool header" className="origin-surface shrink-0 border-b border-origin-border px-3 py-2 sm:px-4">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3">
        <button type="button" aria-label={isEn ? 'Back to chat' : '会話に戻る'} onClick={() => switchWorkspace('chat')} className="origin-secondary-button min-h-11 rounded-xl px-3 text-sm font-semibold">← {isEn ? 'Chat' : '会話'}</button>
        <span className="min-w-0 flex-1 truncate text-center text-sm font-bold">{workspace === 'agent' ? (isEn ? 'Agent' : 'エージェント') : (isEn ? 'Code' : 'コード')}</span>
        <span aria-hidden="true" className="min-w-11 sm:min-w-[72px]" />
      </div>
    </section>}

    {workspace === 'chat' && latestArtifact && <div role="tablist" aria-label="モバイルChat表示" className="origin-surface-muted flex shrink-0 gap-2 border-b px-3 py-2 md:hidden">
      <button type="button" role="tab" aria-selected={mobileSurface === 'conversation'} onClick={() => setMobileSurface('conversation')} className={`min-h-11 flex-1 rounded-lg border px-4 text-sm font-semibold ${mobileSurface === 'conversation' ? 'origin-primary-button' : 'origin-secondary-button'}`}>会話</button>
      <button type="button" role="tab" aria-selected={mobileSurface === 'artifact'} onClick={() => setMobileSurface('artifact')} className={`min-h-11 flex-1 rounded-lg border px-4 text-sm font-semibold ${mobileSurface === 'artifact' ? 'origin-primary-button' : 'origin-secondary-button'}`}>作成物</button>
    </div>}

    <div className="min-h-0 flex-1 overflow-hidden">
      <div className="h-full min-h-0" hidden={workspace !== 'chat'}>
        <App
          embedded
          onOpenSettings={onOpenSettings}
          onOpenAgent={() => switchWorkspace('agent')}
          onOpenCoding={openCodingWorkspace}
          onOpenCreative={openCreativePanel}
          messages={messages}
          sessions={effectiveSessions}
          artifacts={artifacts}
          onArchiveSession={handleArchiveSession}
          onRestoreSession={handleRestoreSession}
          onMessagesChange={handleMessagesChange}
          onArtifactsChange={handleArtifactsChange}
          resetSignal={resetSignal}
          language={settings?.language ?? 'ja'}
          designTheme={settings?.designTheme ?? 'minimal'}
        />
      </div>

      {latestArtifact && <ArtifactWorkspace
        artifact={latestArtifact}
        artifacts={artifacts}
        isOpen={mobileSurface === 'artifact'}
        language={settings?.language ?? 'ja'}
        designTheme={settings?.designTheme ?? 'minimal'}
        isStreaming={false}
        onSteer={() => undefined}
        onClose={() => setMobileSurface('conversation')}
        onArtifactRevision={handleArtifactRevision}
      />}

      {workspace === 'agent' && <div className="h-full overflow-y-auto"><Suspense fallback={<p role="status">エージェントを読み込んでいます…</p>}><AgentWorkspace /></Suspense></div>}
      {workspace === 'coding' && <div className="h-full overflow-y-auto"><Suspense fallback={<p role="status">コード画面を読み込んでいます…</p>}><CodingJobWorkspace initialGoal={codingInitialGoal} /></Suspense></div>}
    </div>

    {workspace === 'chat' && creativePanelRequest !== null && <Suspense fallback={null}><CreativePanel initialRequest={creativePanelRequest} onClose={() => setCreativePanelRequest(null)} onArtifactCreated={handleCreativeArtifactCreated} /></Suspense>}
  </div>;
});

export default PersonalEditionApp;
