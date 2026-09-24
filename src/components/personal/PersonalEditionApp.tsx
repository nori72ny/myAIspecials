import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import App from '../../App';
import { ArtifactWorkspace } from '../../App';
import type { ArtifactBlock, ConversationMessage, ConversationSession } from '../../App';
import type { Settings } from '../../types';
import OriginArtifactContextV31 from './OriginArtifactContextV31';
import OriginProjectWorkspaceV31, { type OriginProjectViewV31 } from './OriginProjectWorkspaceV31';
import type { ResearchSource } from './ResearchWorkspaceV31';
import type { CodingProjectEvidence } from '../CodingJobWorkspaceV14';
import type { OriginWorkspaceModeV31 } from './OriginWorkspaceShellV31';

const ResearchWorkspace = lazy(() => import('./ResearchWorkspaceV31'));
const CodingJobWorkspace = lazy(() => import('./CodingWorkspaceV31'));
const CreativeWorkspace = lazy(() => import('../CreativeWorkspaceV15'));

type MobileChatSurface = 'conversation' | 'artifact';

function workspaceLocation(): OriginWorkspaceModeV31 {
  const workspace = new URLSearchParams(window.location.search).get('workspace');
  if (workspace === 'research' || workspace === 'coding' || workspace === 'creative') return workspace;
  return 'chat';
}

type PersonalEditionAppProps = {
  onSwitchToEnterprise?: () => void;
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
  const [workspace, setWorkspace] = useState<OriginWorkspaceModeV31>(workspaceLocation);
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectView, setProjectView] = useState<OriginProjectViewV31>('overview');
  const [projectSources, setProjectSources] = useState<readonly ResearchSource[]>([]);
  const [codingEvidence, setCodingEvidence] = useState<CodingProjectEvidence>({ jobId: null, status: null, changedPaths: [], verificationChecks: [] });
  const [mobileSurface, setMobileSurface] = useState<MobileChatSurface>('conversation');

  useEffect(() => {
    const sync = () => {
      setWorkspace(workspaceLocation());
      setProjectOpen(false);
      setProjectView('overview');
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
    setProjectOpen(false);
    setProjectView('overview');
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
  const handleRestoreSession = useCallback((session: ConversationSession) => {
    const restored = session.messages.map((message) => ({ ...message }));
    setMessages(restored);
    parentOnRestoreSession?.(session);
    parentOnMessagesChange?.(restored);
  }, [parentOnMessagesChange, parentOnRestoreSession]);

  const handleProjectViewChange = useCallback((next: OriginProjectViewV31) => {
    setProjectView(next);
    if (next === 'artifacts' && latestArtifact) setMobileSurface('artifact');
    else if (next === 'chat' || next === 'overview') setMobileSurface('conversation');
  }, [latestArtifact]);

  const toggleProject = () => {
    setProjectOpen((current) => {
      if (current) {
        setProjectView('overview');
        setMobileSurface('conversation');
      }
      return !current;
    });
  };

  return <div className="flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden">
    {workspace !== 'chat' && <section aria-label="Workspace tool header" className="origin-surface shrink-0 border-b border-origin-border px-3 py-2 sm:px-4">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3">
        <button type="button" aria-label="会話に戻る" onClick={() => switchWorkspace('chat')} className="origin-secondary-button min-h-11 rounded-xl px-3 text-sm font-semibold">← 会話</button>
        <span className="min-w-0 flex-1 truncate text-center text-sm font-bold">{workspace === 'research' ? '調べる' : workspace === 'coding' ? 'コード' : '作る'}</span>
        <button type="button" aria-label={projectOpen ? '詳細を閉じる' : '詳細を開く'} aria-pressed={projectOpen} onClick={toggleProject} className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${projectOpen ? 'origin-primary-button' : 'origin-secondary-button'}`}>詳細</button>
      </div>
    </section>}

    {projectOpen && <div className="max-h-[42dvh] shrink-0 overflow-y-auto border-b border-origin-border">
      <OriginProjectWorkspaceV31
        mode={workspace}
        messages={messages}
        sessions={effectiveSessions}
        artifacts={artifacts}
        sources={projectSources}
        codingEvidence={codingEvidence}
        activeView={projectView}
        onViewChange={handleProjectViewChange}
      />
    </div>}

    {workspace === 'chat' && <OriginArtifactContextV31 artifacts={artifacts} />}

    {workspace === 'chat' && latestArtifact && <div role="tablist" aria-label="モバイルChat表示" className="origin-surface-muted flex shrink-0 gap-2 border-b px-3 py-2 md:hidden">
      <button type="button" role="tab" aria-selected={mobileSurface === 'conversation'} onClick={() => setMobileSurface('conversation')} className={`min-h-11 flex-1 rounded-lg border px-4 text-sm font-semibold ${mobileSurface === 'conversation' ? 'origin-primary-button' : 'origin-secondary-button'}`}>会話</button>
      <button type="button" role="tab" aria-selected={mobileSurface === 'artifact'} onClick={() => setMobileSurface('artifact')} className={`min-h-11 flex-1 rounded-lg border px-4 text-sm font-semibold ${mobileSurface === 'artifact' ? 'origin-primary-button' : 'origin-secondary-button'}`}>成果物</button>
    </div>}

    <div className="min-h-0 flex-1 overflow-hidden">
      <div className="h-full min-h-0" hidden={workspace !== 'chat' || projectView === 'artifacts'}>
        <App
          embedded
          onOpenSettings={onOpenSettings}
          onOpenResearch={() => switchWorkspace('research')}
          onOpenCoding={() => switchWorkspace('coding')}
          onOpenCreative={() => switchWorkspace('creative')}
          onOpenDetails={toggleProject}
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
        isOpen={projectView === 'artifacts' || mobileSurface === 'artifact'}
        language={settings?.language ?? 'ja'}
        designTheme={settings?.designTheme ?? 'minimal'}
        isStreaming={false}
        onSteer={() => undefined}
        onOpenSettings={onOpenSettings}
        onClose={() => { setProjectView('overview'); setMobileSurface('conversation'); }}
        onArtifactRevision={handleArtifactRevision}
      />}

      {workspace === 'research' && <div className="h-full overflow-y-auto"><Suspense fallback={<p role="status">Researchを読み込んでいます…</p>}><ResearchWorkspace onSourcesChange={setProjectSources} /></Suspense></div>}
      {workspace === 'coding' && <div className="h-full overflow-y-auto"><Suspense fallback={<p role="status">Codeを読み込んでいます…</p>}><CodingJobWorkspace onProjectEvidenceChange={setCodingEvidence} /></Suspense></div>}
      {workspace === 'creative' && <div className="h-full overflow-y-auto"><Suspense fallback={<p role="status">Createを読み込んでいます…</p>}><CreativeWorkspace /></Suspense></div>}
    </div>
  </div>;
});

export default PersonalEditionApp;
