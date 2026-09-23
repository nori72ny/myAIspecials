import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import App from '../../App';
import type { ArtifactBlock, ConversationMessage, ConversationSession } from '../../App';
import type { Settings } from '../../types';
import OriginComposerModeControlV31 from './OriginComposerModeControlV31';
import OriginNavigationDrawerV31 from './OriginNavigationDrawerV31';
import OriginProjectNavigationV31 from './OriginProjectNavigationV31';
import OriginProjectWorkspaceV31, { type OriginProjectViewV31 } from './OriginProjectWorkspaceV31';
import type { ResearchSource } from './ResearchWorkspaceV31';
import type { CodingProjectEvidence } from '../CodingJobWorkspaceV14';
import type { OriginRuntimeActivityV31 } from './OriginRuntimeActivityV31';
import OriginWorkspaceShellV31, { type OriginWorkspaceModeV31 } from './OriginWorkspaceShellV31';
import useVisualViewportKeyboardInset from './useVisualViewportKeyboardInset';

const ResearchWorkspace = lazy(() => import('./ResearchWorkspaceV31'));
const CodingJobWorkspace = lazy(() => import('./CodingWorkspaceV31'));
const CreativeWorkspace = lazy(() => import('../CreativeWorkspaceV15'));

function workspaceLocation(): OriginWorkspaceModeV31 {
  const workspace = new URLSearchParams(window.location.search).get('workspace');
  if (workspace === 'research' || workspace === 'coding' || workspace === 'creative') return workspace;
  return 'chat';
}

function codingRuntimeActivity(evidence: CodingProjectEvidence): OriginRuntimeActivityV31 | null {
  if (!evidence.jobId || !evidence.status) return null;
  const status: OriginRuntimeActivityV31['status'] = evidence.status === 'verified'
    ? 'completed'
    : evidence.status === 'blocked'
      ? 'blocked'
      : evidence.status === 'failed'
        ? 'failed'
        : evidence.status === 'cancelled'
          ? 'cancelled'
          : 'running';
  const detail = evidence.status === 'queued'
    ? 'Coding jobを受け付け、worker開始を待っています。'
    : evidence.status === 'leased'
      ? 'workerがjobを受け取り、実行準備中です。'
      : evidence.status === 'running'
        ? 'コードの確認・変更を実行しています。'
        : evidence.status === 'repairing'
          ? '検証で検出した問題をbounded repairしています。'
          : evidence.status === 'verified'
            ? 'jobが検証済みで終了しました。'
            : evidence.status === 'blocked'
              ? '安全条件または実行条件によりjobを停止しました。'
              : evidence.status === 'failed'
                ? 'jobが失敗して終了しました。未完了工程を成功扱いしません。'
                : 'jobは取消済みです。';
  const passedChecks = evidence.verificationChecks.filter(check => check.ok).length;
  return {
    id: `coding-${evidence.jobId}`,
    kind: 'agent',
    status,
    title: 'Agentic Coding',
    detail,
    evidence: `job=${evidence.jobId} · files=${evidence.changedPaths.length} · checks=${passedChecks}/${evidence.verificationChecks.length}`,
  };
}

type PersonalEditionAppProps = { onSwitchToEnterprise?: () => void; settings?: Settings; onOpenSettings?: () => void; messages?: ConversationMessage[]; sessions?: readonly ConversationSession[]; artifacts?: readonly ArtifactBlock[]; onArchiveSession?: (messages: readonly ConversationMessage[]) => void; onRestoreSession?: (session: ConversationSession) => void; onMessagesChange?: (messages: ConversationMessage[]) => void; onArtifactsChange?: (artifacts: ArtifactBlock[]) => void; resetSignal?: number; };

const PersonalEditionApp = React.memo(function PersonalEditionApp({ settings, onOpenSettings, messages: parentMessages, sessions: parentSessions, artifacts: parentArtifacts, onArchiveSession: parentOnArchiveSession, onRestoreSession: parentOnRestoreSession, onMessagesChange: parentOnMessagesChange, onArtifactsChange: parentOnArtifactsChange, resetSignal = 0 }: PersonalEditionAppProps) {
  useVisualViewportKeyboardInset();
  const [messages, setMessages] = useState<ConversationMessage[]>(() => parentMessages ?? []);
  const [workspace, setWorkspace] = useState<OriginWorkspaceModeV31>(workspaceLocation);
  const [projectView, setProjectView] = useState<OriginProjectViewV31>('overview');
  const [projectSources, setProjectSources] = useState<readonly ResearchSource[]>([]);
  const [codingEvidence, setCodingEvidence] = useState<CodingProjectEvidence>({ jobId: null, status: null, changedPaths: [], verificationChecks: [] });
  const [runtimeActivities, setRuntimeActivities] = useState<OriginRuntimeActivityV31[]>([]);
  const [codingMounted, setCodingMounted] = useState(() => workspaceLocation() === 'coding');
  const [localResetSignal, setLocalResetSignal] = useState(0);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => { setWorkspace(workspaceLocation()); setProjectView('overview'); };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  useEffect(() => { if (workspace === 'coding') setCodingMounted(true); }, [workspace]);
  const switchWorkspace = useCallback((next: OriginWorkspaceModeV31) => {
    const url = new URL(window.location.href);
    if (next === 'chat') url.searchParams.delete('workspace');
    else url.searchParams.set('workspace', next);
    window.history.pushState(null, '', url);
    setProjectView('overview');
    setWorkspace(next);
  }, []);
  const [artifacts, setArtifacts] = useState<ArtifactBlock[]>(() => [...(parentArtifacts ?? [])]);
  useEffect(() => { if (parentMessages) setMessages(parentMessages); }, [parentMessages]);
  useEffect(() => { if (parentArtifacts) setArtifacts([...parentArtifacts]); }, [parentArtifacts]);
  useEffect(() => {
    if (selectedArtifactId && !artifacts.some((artifact) => artifact.id === selectedArtifactId)) setSelectedArtifactId(null);
  }, [artifacts, selectedArtifactId]);
  const effectiveSessions = parentSessions ?? [];
  const latestArtifact = artifacts.at(-1) ?? null;
  const activeArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? latestArtifact;
  const recordRuntimeActivity = useCallback((activity: OriginRuntimeActivityV31) => {
    setRuntimeActivities(current => [...current.filter(item => item.id !== activity.id), activity].slice(-8));
  }, []);
  const handleCodingEvidenceChange = useCallback((evidence: CodingProjectEvidence) => {
    setCodingEvidence(evidence);
    const activity = codingRuntimeActivity(evidence);
    if (activity) recordRuntimeActivity(activity);
  }, [recordRuntimeActivity]);
  const handleMessagesChange = useCallback((nextMessages: ConversationMessage[]) => { setMessages(nextMessages); parentOnMessagesChange?.(nextMessages); }, [parentOnMessagesChange]);
  const handleArtifactsChange = useCallback((nextArtifacts: ArtifactBlock[]) => { setArtifacts(nextArtifacts); parentOnArtifactsChange?.(nextArtifacts); }, [parentOnArtifactsChange]);
  const handleArchiveSession = useCallback((nextMessages: readonly ConversationMessage[]) => { parentOnArchiveSession?.(nextMessages); }, [parentOnArchiveSession]);
  const handleRestoreSession = useCallback((session: ConversationSession) => {
    const restored = session.messages.map((message) => ({ ...message }));
    switchWorkspace('chat');
    setMessages(restored);
    setRuntimeActivities([]);
    setProjectView('chat');
    parentOnRestoreSession?.(session);
    parentOnMessagesChange?.(restored);
  }, [parentOnMessagesChange, parentOnRestoreSession, switchWorkspace]);
  const handleProjectViewChange = useCallback((next: OriginProjectViewV31) => {
    if (next === 'artifacts' && !activeArtifact) return;
    if (next === 'artifacts' && !selectedArtifactId && latestArtifact) setSelectedArtifactId(latestArtifact.id);
    setProjectView(next);
  }, [activeArtifact, latestArtifact, selectedArtifactId]);
  const handleDrawerArtifact = useCallback((artifact: ArtifactBlock) => {
    switchWorkspace('chat');
    setArtifacts(current => current.some(item => item.id === artifact.id) ? current : [...current, artifact]);
    setSelectedArtifactId(artifact.id);
    setProjectView('artifacts');
  }, [switchWorkspace]);
  const handleNewConversation = useCallback(() => {
    switchWorkspace('chat');
    setProjectView('overview');
    setSelectedArtifactId(null);
    setRuntimeActivities([]);
    setLocalResetSignal((current) => current + 1);
  }, [switchWorkspace]);
  const closeArtifact = useCallback(() => {
    setProjectView(workspace === 'chat' ? 'chat' : 'overview');
  }, [workspace]);
  const artifactOpen = projectView === 'artifacts' && activeArtifact !== null;
  const conversationOpen = workspace === 'chat' && messages.length > 0;
  const shellClass = `origin-personal-surface ${conversationOpen || artifactOpen ? 'origin-personal-conversation' : ''} ${artifactOpen ? 'origin-personal-artifact-open' : ''}`;
  const modeControl = <OriginComposerModeControlV31 mode={workspace} onModeChange={switchWorkspace} />;
  const onArtifactOpen = (artifact: ArtifactBlock | null) => {
    if (!artifact) { closeArtifact(); return; }
    setSelectedArtifactId(artifact.id);
    setProjectView('artifacts');
  };
  return <div className={shellClass}>
    <div className="origin-personal-navigation">
    <OriginWorkspaceShellV31
      mode={workspace}
      onModeChange={switchWorkspace}
      navigation={<OriginNavigationDrawerV31
        sessions={effectiveSessions}
        artifacts={artifacts}
        onRestoreSession={handleRestoreSession}
        onOpenArtifact={handleDrawerArtifact}
        onNewConversation={handleNewConversation}
        onOpenSettings={onOpenSettings}
        projectNavigation={<OriginProjectNavigationV31 sources={projectSources} codingEvidence={codingEvidence} onViewChange={handleProjectViewChange} />}
      />}
    />
    <OriginProjectWorkspaceV31 mode={workspace} messages={messages} sessions={effectiveSessions} artifacts={artifacts} sources={projectSources} codingEvidence={codingEvidence} activeView={projectView} onViewChange={handleProjectViewChange} />
    {workspace === 'chat' && activeArtifact && <div role="tablist" aria-label="モバイルChat表示" className="origin-surface-muted flex gap-2 border-b px-3 py-2 md:hidden">
      <button type="button" role="tab" aria-selected={!artifactOpen} onClick={closeArtifact} className={`min-h-11 flex-1 rounded-lg border px-4 text-sm font-semibold ${!artifactOpen ? 'origin-primary-button' : 'origin-secondary-button'}`}>会話</button>
      <button type="button" role="tab" aria-selected={artifactOpen} onClick={() => handleProjectViewChange('artifacts')} className={`min-h-11 flex-1 rounded-lg border px-4 text-sm font-semibold ${artifactOpen ? 'origin-primary-button' : 'origin-secondary-button'}`}>成果物</button>
    </div>}
    </div>
    <div className="origin-personal-chat" hidden={workspace !== 'chat'}><App embedded composerControls={workspace === 'chat' ? modeControl : undefined} runtimeActivities={runtimeActivities} openArtifactId={artifactOpen ? activeArtifact.id : null} onArtifactOpen={onArtifactOpen} onOpenSettings={onOpenSettings} messages={messages} sessions={effectiveSessions} artifacts={artifacts} onArchiveSession={handleArchiveSession} onRestoreSession={handleRestoreSession} onMessagesChange={handleMessagesChange} onArtifactsChange={handleArtifactsChange} resetSignal={resetSignal + localResetSignal} language={settings?.language ?? 'ja'} designTheme={settings?.designTheme ?? 'minimal'} /></div>

    {workspace === 'research' && <Suspense fallback={<p role="status">Researchを読み込んでいます…</p>}><ResearchWorkspace composerControls={modeControl} onSourcesChange={setProjectSources} onRuntimeActivityChange={recordRuntimeActivity} /></Suspense>}
    {codingMounted && <div hidden={workspace !== 'coding'}><Suspense fallback={<p role="status">Codeを読み込んでいます…</p>}><CodingJobWorkspace composerControls={workspace === 'coding' ? modeControl : undefined} onProjectEvidenceChange={handleCodingEvidenceChange} onRuntimeActivityChange={recordRuntimeActivity} /></Suspense></div>}
    {workspace === 'creative' && <Suspense fallback={<p role="status">Createを読み込んでいます…</p>}><CreativeWorkspace composerControls={modeControl} /></Suspense>}
  </div>;
});
export default PersonalEditionApp;
