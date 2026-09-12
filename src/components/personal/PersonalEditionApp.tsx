import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import App from '../../App';
import type { ArtifactBlock, ConversationMessage, ConversationSession } from '../../App';
import type { Settings } from '../../types';
const CodingJobWorkspace = lazy(() => import('../CodingJobWorkspaceV14'));
function codingLocation() { return new URLSearchParams(window.location.search).get('workspace') === 'coding'; }
type PersonalEditionAppProps = { onSwitchToEnterprise?: () => void; settings?: Settings; onOpenSettings?: () => void; messages?: ConversationMessage[]; sessions?: readonly ConversationSession[]; artifacts?: readonly ArtifactBlock[]; onArchiveSession?: (messages: readonly ConversationMessage[]) => void; onRestoreSession?: (session: ConversationSession) => void; onMessagesChange?: (messages: ConversationMessage[]) => void; onArtifactsChange?: (artifacts: ArtifactBlock[]) => void; resetSignal?: number; };
const PersonalEditionApp = React.memo(function PersonalEditionApp({ settings, onOpenSettings, messages: parentMessages, sessions: parentSessions, artifacts: parentArtifacts, onArchiveSession: parentOnArchiveSession, onRestoreSession: parentOnRestoreSession, onMessagesChange: parentOnMessagesChange, onArtifactsChange: parentOnArtifactsChange, resetSignal = 0 }: PersonalEditionAppProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>(() => parentMessages ?? []);
  const [codingOpen, setCodingOpen] = useState(codingLocation);
  useEffect(() => {
    const sync = () => setCodingOpen(codingLocation());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const switchWorkspace = (coding: boolean) => {
    const url = new URL(window.location.href);
    if (coding) url.searchParams.set('workspace', 'coding');
    else url.searchParams.delete('workspace');
    window.history.pushState(null, '', url);
    setCodingOpen(coding);
  };
  const [artifacts, setArtifacts] = useState<ArtifactBlock[]>(() => [...(parentArtifacts ?? [])]);
  const effectiveSessions = parentSessions ?? [];
  const handleMessagesChange = useCallback((nextMessages: ConversationMessage[]) => { setMessages(nextMessages); parentOnMessagesChange?.(nextMessages); }, [parentOnMessagesChange]);
  const handleArtifactsChange = useCallback((nextArtifacts: ArtifactBlock[]) => { setArtifacts(nextArtifacts); parentOnArtifactsChange?.(nextArtifacts); }, [parentOnArtifactsChange]);
  const handleArchiveSession = useCallback((nextMessages: readonly ConversationMessage[]) => { parentOnArchiveSession?.(nextMessages); }, [parentOnArchiveSession]);
  const handleRestoreSession = useCallback((session: ConversationSession) => { const restored = session.messages.map((message) => ({ ...message })); setMessages(restored); parentOnRestoreSession?.(session); parentOnMessagesChange?.(restored); }, [parentOnMessagesChange, parentOnRestoreSession]);
  return <>
    <nav aria-label="ワークスペース" className="flex flex-wrap gap-2 border-b border-slate-200 bg-white p-2 text-slate-900">
      <button type="button" aria-pressed={!codingOpen} onClick={() => switchWorkspace(false)} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold">チャット</button>
      <button type="button" aria-pressed={codingOpen} onClick={() => switchWorkspace(true)} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold">Coding</button>
    </nav>
    <div hidden={codingOpen}><App onOpenSettings={onOpenSettings} messages={messages} sessions={effectiveSessions} artifacts={artifacts.length ? artifacts : parentArtifacts ?? []} onArchiveSession={handleArchiveSession} onRestoreSession={handleRestoreSession} onMessagesChange={handleMessagesChange} onArtifactsChange={handleArtifactsChange} resetSignal={resetSignal} language={settings?.language ?? 'ja'} designTheme={settings?.designTheme ?? 'minimal'} /></div>
    {codingOpen && <Suspense fallback={<p role="status">Codingを読み込んでいます…</p>}><CodingJobWorkspace /></Suspense>}
  </>;
});
export default PersonalEditionApp;
