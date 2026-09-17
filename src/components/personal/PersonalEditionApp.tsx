import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import App from '../../App';
import { ArtifactWorkspace } from '../../App';
import type { ArtifactBlock, ConversationMessage, ConversationSession } from '../../App';
import type { Settings } from '../../types';
import OriginArtifactContextV31 from './OriginArtifactContextV31';
import OriginWorkspaceShellV31, { type OriginWorkspaceModeV31 } from './OriginWorkspaceShellV31';

const ResearchWorkspace = lazy(() => import('./ResearchWorkspaceV31'));
const CodingJobWorkspace = lazy(() => import('./CodingWorkspaceV31'));
const CreativeWorkspace = lazy(() => import('../CreativeWorkspaceV15'));

type MobileChatSurface = 'conversation' | 'artifact';

function workspaceLocation(): OriginWorkspaceModeV31 {
  const workspace = new URLSearchParams(window.location.search).get('workspace');
  if (workspace === 'research' || workspace === 'coding' || workspace === 'creative') return workspace;
  return 'chat';
}

type PersonalEditionAppProps = { onSwitchToEnterprise?: () => void; settings?: Settings; onOpenSettings?: () => void; messages?: ConversationMessage[]; sessions?: readonly ConversationSession[]; artifacts?: readonly ArtifactBlock[]; onArchiveSession?: (messages: readonly ConversationMessage[]) => void; onRestoreSession?: (session: ConversationSession) => void; onMessagesChange?: (messages: ConversationMessage[]) => void; onArtifactsChange?: (artifacts: ArtifactBlock[]) => void; resetSignal?: number; };

const PersonalEditionApp = React.memo(function PersonalEditionApp({ settings, onOpenSettings, messages: parentMessages, sessions: parentSessions, artifacts: parentArtifacts, onArchiveSession: parentOnArchiveSession, onRestoreSession: parentOnRestoreSession, onMessagesChange: parentOnMessagesChange, onArtifactsChange: parentOnArtifactsChange, resetSignal = 0 }: PersonalEditionAppProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>(() => parentMessages ?? []);
  const [workspace, setWorkspace] = useState<OriginWorkspaceModeV31>(workspaceLocation);
  const [mobileSurface, setMobileSurface] = useState<MobileChatSurface>('conversation');
  useEffect(() => {
    const sync = () => { setWorkspace(workspaceLocation()); setMobileSurface('conversation'); };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const switchWorkspace = (next: OriginWorkspaceModeV31) => {
    const url = new URL(window.location.href);
    if (next === 'chat') url.searchParams.delete('workspace');
    else url.searchParams.set('workspace', next);
    window.history.pushState(null, '', url);
    setMobileSurface('conversation');
    setWorkspace(next);
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
  const handleArchiveSession = useCallback((nextMessages: readonly ConversationMessage[]) => { parentOnArchiveSession?.(nextMessages); }, [parentOnArchiveSession]);
  const handleRestoreSession = useCallback((session: ConversationSession) => { const restored = session.messages.map((message) => ({ ...message })); setMessages(restored); parentOnRestoreSession?.(session); parentOnMessagesChange?.(restored); }, [parentOnMessagesChange, parentOnRestoreSession]);
  return <>
    <OriginWorkspaceShellV31 mode={workspace} onModeChange={switchWorkspace} />
    {workspace === 'chat' && <OriginArtifactContextV31 artifacts={artifacts} />}
    {workspace === 'chat' && latestArtifact && <div role="tablist" aria-label="モバイルChat表示" className="origin-surface-muted flex gap-2 border-b px-3 py-2 md:hidden">
      <button type="button" role="tab" aria-selected={mobileSurface === 'conversation'} onClick={() => setMobileSurface('conversation')} className={`min-h-11 flex-1 rounded-lg border px-4 text-sm font-semibold ${mobileSurface === 'conversation' ? 'origin-primary-button' : 'origin-secondary-button'}`}>会話</button>
      <button type="button" role="tab" aria-selected={mobileSurface === 'artifact'} onClick={() => setMobileSurface('artifact')} className={`min-h-11 flex-1 rounded-lg border px-4 text-sm font-semibold ${mobileSurface === 'artifact' ? 'origin-primary-button' : 'origin-secondary-button'}`}>成果物</button>
    </div>}
    <div hidden={workspace !== 'chat'}><App onOpenSettings={onOpenSettings} messages={messages} sessions={effectiveSessions} artifacts={artifacts} onArchiveSession={handleArchiveSession} onRestoreSession={handleRestoreSession} onMessagesChange={handleMessagesChange} onArtifactsChange={handleArtifactsChange} resetSignal={resetSignal} language={settings?.language ?? 'ja'} designTheme={settings?.designTheme ?? 'minimal'} /></div>
    {workspace === 'chat' && latestArtifact && <ArtifactWorkspace artifact={latestArtifact} artifacts={artifacts} isOpen={mobileSurface === 'artifact'} language={settings?.language ?? 'ja'} designTheme={settings?.designTheme ?? 'minimal'} isStreaming={false} onSteer={() => undefined} onOpenSettings={onOpenSettings} onClose={() => setMobileSurface('conversation')} onArtifactRevision={handleArtifactRevision} />}
    {workspace === 'research' && <Suspense fallback={<p role="status">Researchを読み込んでいます…</p>}><ResearchWorkspace /></Suspense>}
    {workspace === 'coding' && <Suspense fallback={<p role="status">Codeを読み込んでいます…</p>}><CodingJobWorkspace /></Suspense>}
    {workspace === 'creative' && <Suspense fallback={<p role="status">Createを読み込んでいます…</p>}><CreativeWorkspace /></Suspense>}
  </>;
});
export default PersonalEditionApp;