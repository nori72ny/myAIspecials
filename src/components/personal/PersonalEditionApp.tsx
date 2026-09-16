import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import App from '../../App';
import type { ArtifactBlock, ConversationMessage, ConversationSession } from '../../App';
import type { Settings } from '../../types';

const CodingJobWorkspace = lazy(() => import('../CodingJobWorkspaceV14'));
const CreativeWorkspace = lazy(() => import('../CreativeWorkspaceV15'));

type WorkspaceMode = 'chat' | 'coding' | 'creative';

function workspaceLocation(): WorkspaceMode {
  const workspace = new URLSearchParams(window.location.search).get('workspace');
  if (workspace === 'coding' || workspace === 'creative') return workspace;
  return 'chat';
}

type PersonalEditionAppProps = { onSwitchToEnterprise?: () => void; settings?: Settings; onOpenSettings?: () => void; messages?: ConversationMessage[]; sessions?: readonly ConversationSession[]; artifacts?: readonly ArtifactBlock[]; onArchiveSession?: (messages: readonly ConversationMessage[]) => void; onRestoreSession?: (session: ConversationSession) => void; onMessagesChange?: (messages: ConversationMessage[]) => void; onArtifactsChange?: (artifacts: ArtifactBlock[]) => void; resetSignal?: number; };

const PersonalEditionApp = React.memo(function PersonalEditionApp({ settings, onOpenSettings, messages: parentMessages, sessions: parentSessions, artifacts: parentArtifacts, onArchiveSession: parentOnArchiveSession, onRestoreSession: parentOnRestoreSession, onMessagesChange: parentOnMessagesChange, onArtifactsChange: parentOnArtifactsChange, resetSignal = 0 }: PersonalEditionAppProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>(() => parentMessages ?? []);
  const [workspace, setWorkspace] = useState<WorkspaceMode>(workspaceLocation);
  useEffect(() => {
    const sync = () => setWorkspace(workspaceLocation());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const switchWorkspace = (next: WorkspaceMode) => {
    const url = new URL(window.location.href);
    if (next === 'chat') url.searchParams.delete('workspace');
    else url.searchParams.set('workspace', next);
    window.history.pushState(null, '', url);
    setWorkspace(next);
  };
  const [artifacts, setArtifacts] = useState<ArtifactBlock[]>(() => [...(parentArtifacts ?? [])]);
  useEffect(() => { if (parentMessages) setMessages(parentMessages); }, [parentMessages]);
  useEffect(() => { if (parentArtifacts) setArtifacts([...parentArtifacts]); }, [parentArtifacts]);
  const effectiveSessions = parentSessions ?? [];
  const handleMessagesChange = useCallback((nextMessages: ConversationMessage[]) => { setMessages(nextMessages); parentOnMessagesChange?.(nextMessages); }, [parentOnMessagesChange]);
  const handleArtifactsChange = useCallback((nextArtifacts: ArtifactBlock[]) => { setArtifacts(nextArtifacts); parentOnArtifactsChange?.(nextArtifacts); }, [parentOnArtifactsChange]);
  const handleArchiveSession = useCallback((nextMessages: readonly ConversationMessage[]) => { parentOnArchiveSession?.(nextMessages); }, [parentOnArchiveSession]);
  const handleRestoreSession = useCallback((session: ConversationSession) => { const restored = session.messages.map((message) => ({ ...message })); setMessages(restored); parentOnRestoreSession?.(session); parentOnMessagesChange?.(restored); }, [parentOnMessagesChange, parentOnRestoreSession]);
  return <>
    <nav aria-label="ワークスペース" className="flex max-w-full gap-2 overflow-x-auto border-b border-slate-200 bg-white p-2 text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
      <button type="button" aria-pressed={workspace === 'chat'} onClick={() => switchWorkspace('chat')} className="min-h-11 shrink-0 rounded-lg border border-slate-300 px-4 text-sm font-semibold dark:border-slate-700">チャット</button>
      <button type="button" aria-pressed={workspace === 'coding'} onClick={() => switchWorkspace('coding')} className="min-h-11 shrink-0 rounded-lg border border-slate-300 px-4 text-sm font-semibold dark:border-slate-700">Coding</button>
      <button type="button" aria-pressed={workspace === 'creative'} onClick={() => switchWorkspace('creative')} className="min-h-11 shrink-0 rounded-lg border border-slate-300 px-4 text-sm font-semibold dark:border-slate-700">✦ Creative</button>
    </nav>
    <div hidden={workspace !== 'chat'}><App onOpenSettings={onOpenSettings} messages={messages} sessions={effectiveSessions} artifacts={artifacts} onArchiveSession={handleArchiveSession} onRestoreSession={handleRestoreSession} onMessagesChange={handleMessagesChange} onArtifactsChange={handleArtifactsChange} resetSignal={resetSignal} language={settings?.language ?? 'ja'} designTheme={settings?.designTheme ?? 'minimal'} /></div>
    {workspace === 'coding' && <Suspense fallback={<p role="status">Codingを読み込んでいます…</p>}><CodingJobWorkspace /></Suspense>}
    {workspace === 'creative' && <Suspense fallback={<p role="status">Creativeを読み込んでいます…</p>}><CreativeWorkspace /></Suspense>}
  </>;
});
export default PersonalEditionApp;
