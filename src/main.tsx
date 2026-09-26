import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SettingsModal from './components/SettingsModal';
import SettingsErrorBoundary from './components/SettingsErrorBoundary';
import SplashScreen from './components/SplashScreen';
import FocusModeController from './components/FocusModeController';
import PersonalEditionApp from './components/personal/PersonalEditionApp';
import { UniversalMasterEnginePanel } from './components/UniversalMasterEnginePanel';
import { usePersonalSettings } from './hooks/usePersonalSettings';
import { getTranslations } from './i18n';
import { migrateOriginLegacySnapshot, originIndexedDbAdapter, type OriginPersistedSnapshot, type OriginStorageWriteResult } from './lib/local/OriginIndexedDb';
import { registerOriginServiceWorker } from './pwa/registerServiceWorker';
import { installActiveContextChatBridge } from './services/activeContextChatBridge';
import './index.css';
import './ultra-optics.css';
import './audit-2026-priority.css';
import './origin-top-ui.css';

registerOriginServiceWorker();
installActiveContextChatBridge();

const HISTORY_EXPORT_VERSION = 1;
const HISTORY_STORAGE_KEY = 'origin_personal_history';
const SESSION_STORAGE_KEY = 'origin_personal_sessions';

type ConversationMessage = { id: string; role: 'user' | 'assistant'; content: string; deliveryState?: 'verified' | 'error'; image?: { url?: string; assetId: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; downloadName: string; sha256: string; providerId: 'pollinations-zero-cost'; model: string; generationId: string; visualBrainVersion: 'visual-brain-v1'; planVersion: 'raster-visual-plan-v1'; planSha256: string; purpose: string; typographyOverlay: boolean; criticVersion: 'raster-structural-critic-v1'; qualityScore: number; width: number; height: number; relation: 'generated' | 'variation' | 'edited-from'; parentId?: string } };
type ConversationSession = { id: string; title: string; createdAt: number; messages: readonly ConversationMessage[] };
type ArtifactRevision = { id: string; content: string; createdAt: number; source: 'generated' | 'direct-touch' | 'restore' };
type PersistedArtifact = { id: string; type: 'code' | 'markdown' | 'mermaid' | 'html'; title: string; language: string; content: string; isComplete: boolean; revision?: number; revisions?: readonly ArtifactRevision[] };
type StorageHealth = 'ready' | Exclude<OriginStorageWriteResult, 'saved'>;
type IdleWindow = Window & typeof globalThis & { requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number; cancelIdleCallback?: (handle: number) => void };

export function persistableConversationMessages(messages: readonly ConversationMessage[]): ConversationMessage[] {
  return messages.map((message) => message.image
    ? { ...message, image: { ...message.image, url: undefined } }
    : { ...message });
}

function scheduleIdle(task: () => void): () => void {
  const idleWindow = window as IdleWindow;
  if (typeof idleWindow.requestIdleCallback === 'function') {
    const handle = idleWindow.requestIdleCallback(() => task(), { timeout: 1200 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(task, 0);
  return () => window.clearTimeout(handle);
}

function parseImportedHistory(value: unknown): ConversationMessage[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { messages?: unknown }).messages)) throw new Error('invalid-history');
  const messages = (value as { messages: unknown[] }).messages;
  if (messages.length > 500) throw new Error('history-too-large');
  return messages.map((message, index) => {
    if (!message || typeof message !== 'object') throw new Error(`invalid-history-${index}`);
    const candidate = message as Partial<ConversationMessage>;
    if ((candidate.role !== 'user' && candidate.role !== 'assistant') || typeof candidate.content !== 'string') throw new Error(`invalid-history-${index}`);
    let image: ConversationMessage['image'];
    const sourceImage = candidate.image;
    if (sourceImage && typeof sourceImage === 'object') {
      const validMime = sourceImage.mimeType === 'image/png' || sourceImage.mimeType === 'image/jpeg' || sourceImage.mimeType === 'image/webp';
      const validSha = typeof sourceImage.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(sourceImage.sha256);
      const validAsset = typeof sourceImage.assetId === 'string' && validSha && sourceImage.assetId.toLowerCase() === sourceImage.sha256?.toLowerCase();
      const validGeneration = typeof sourceImage.generationId === 'string' && /^raster-[a-f0-9]{24}$/i.test(sourceImage.generationId);
      const validDimensions = Number.isInteger(sourceImage.width) && Number(sourceImage.width) >= 256 && Number(sourceImage.width) <= 1536
        && Number.isInteger(sourceImage.height) && Number(sourceImage.height) >= 256 && Number(sourceImage.height) <= 1536;
      const validRelation = sourceImage.relation === 'generated' || sourceImage.relation === 'variation' || sourceImage.relation === 'edited-from';
      const validParent = sourceImage.parentId === undefined || typeof sourceImage.parentId === 'string' && /^[a-f0-9]{64}$/i.test(sourceImage.parentId);
      const validVisualProvenance = sourceImage.visualBrainVersion === 'visual-brain-v1'
        && sourceImage.planVersion === 'raster-visual-plan-v1'
        && typeof sourceImage.planSha256 === 'string' && /^[a-f0-9]{64}$/i.test(sourceImage.planSha256)
        && typeof sourceImage.purpose === 'string' && /^[a-z-]{1,40}$/.test(sourceImage.purpose)
        && typeof sourceImage.typographyOverlay === 'boolean'
        && sourceImage.criticVersion === 'raster-structural-critic-v1'
        && typeof sourceImage.qualityScore === 'number'
        && Number.isInteger(sourceImage.qualityScore)
        && sourceImage.qualityScore >= 0
        && sourceImage.qualityScore <= 100;
      if (validMime && validAsset && sourceImage.providerId === 'pollinations-zero-cost'
        && typeof sourceImage.model === 'string' && sourceImage.model.length > 0 && sourceImage.model.length <= 180
        && typeof sourceImage.downloadName === 'string' && /^[^\\/\u0000-\u001f\u007f]{1,180}\.(?:png|jpe?g|webp)$/i.test(sourceImage.downloadName)
        && validGeneration && validDimensions && validRelation && validParent && validVisualProvenance) {
        image = {
          assetId: sourceImage.assetId!.toLowerCase(),
          mimeType: sourceImage.mimeType!,
          downloadName: sourceImage.downloadName!,
          sha256: sourceImage.sha256!.toLowerCase(),
          providerId: 'pollinations-zero-cost',
          model: sourceImage.model!,
          generationId: sourceImage.generationId!,
          visualBrainVersion: 'visual-brain-v1',
          planVersion: 'raster-visual-plan-v1',
          planSha256: sourceImage.planSha256!.toLowerCase(),
          purpose: sourceImage.purpose!,
          typographyOverlay: sourceImage.typographyOverlay!,
          criticVersion: 'raster-structural-critic-v1',
          qualityScore: Number(sourceImage.qualityScore),
          width: Number(sourceImage.width),
          height: Number(sourceImage.height),
          relation: sourceImage.relation!,
          parentId: sourceImage.parentId?.toLowerCase(),
        };
      }
    }
    return {
      id: typeof candidate.id === 'string' && candidate.id.length <= 128 ? candidate.id : `import-${index}-${Date.now()}`,
      role: candidate.role,
      content: candidate.content.slice(0, 50_000),
      deliveryState: candidate.deliveryState === 'verified' || candidate.deliveryState === 'error' ? candidate.deliveryState : undefined,
      image,
    };
  });
}
function loadStoredHistory(): ConversationMessage[] { try { const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY); return raw ? parseImportedHistory(JSON.parse(raw)) : []; } catch { return []; } }
function loadStoredSessions(): ConversationSession[] { try { const raw = window.localStorage.getItem(SESSION_STORAGE_KEY); if (!raw) return []; const parsed = JSON.parse(raw) as unknown; if (!Array.isArray(parsed)) return []; return parsed.slice(0, 24).flatMap((candidate, index) => { if (!candidate || typeof candidate !== 'object') return []; const source = candidate as Partial<ConversationSession>; if (typeof source.id !== 'string' || typeof source.title !== 'string' || typeof source.createdAt !== 'number' || !Array.isArray(source.messages)) return []; try { return [{ id: source.id.slice(0, 128) || `session-${index}`, title: source.title.slice(0, 120), createdAt: source.createdAt, messages: parseImportedHistory({ messages: source.messages }) }]; } catch { return []; } }); } catch { return []; } }
function loadSessionsFromSnapshot(value: unknown): ConversationSession[] { if (!Array.isArray(value)) return []; return value.slice(0, 24).flatMap((candidate, index) => { if (!candidate || typeof candidate !== 'object') return []; const source = candidate as Partial<ConversationSession>; if (typeof source.id !== 'string' || typeof source.title !== 'string' || typeof source.createdAt !== 'number' || !Array.isArray(source.messages)) return []; try { return [{ id: source.id.slice(0, 128) || `session-${index}`, title: source.title.slice(0, 120), createdAt: source.createdAt, messages: parseImportedHistory({ messages: source.messages }) }]; } catch { return []; } }); }
function parseStoredArtifacts(value: unknown): PersistedArtifact[] { if (!Array.isArray(value)) return []; return value.slice(0, 500).flatMap((candidate) => { if (!candidate || typeof candidate !== 'object') return []; const source = candidate as Partial<PersistedArtifact>; if (typeof source.id !== 'string' || typeof source.title !== 'string' || typeof source.language !== 'string' || typeof source.content !== 'string' || typeof source.isComplete !== 'boolean' || !source.type || !['code', 'markdown', 'mermaid', 'html'].includes(source.type)) return []; return [{ id: source.id.slice(0, 160), type: source.type, title: source.title.slice(0, 160), language: source.language.slice(0, 48), content: source.content.slice(0, 1_000_000), isComplete: source.isComplete, revision: typeof source.revision === 'number' ? Math.max(1, Math.floor(source.revision)) : undefined, revisions: undefined }]; }); }
function snapshotFromState(messages: ConversationMessage[], sessions: ConversationSession[], artifacts: PersistedArtifact[]): OriginPersistedSnapshot {
  return {
    version: 1,
    messages: persistableConversationMessages(messages),
    sessions: sessions.map((session) => ({ ...session, messages: persistableConversationMessages(session.messages) })),
    artifacts,
    updatedAt: Date.now(),
  };
}
function loadLegacySnapshot(): OriginPersistedSnapshot | null {
  let historyRaw: string | null;
  let sessionsRaw: string | null;
  try {
    historyRaw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    sessionsRaw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch { return null; }
  if (!historyRaw && !sessionsRaw) return null;

  const messages = historyRaw ? loadStoredHistory() : [];
  const sessions = sessionsRaw ? loadStoredSessions() : [];
  let historyUpdatedAt = 0;
  if (historyRaw) {
    try {
      const parsed = JSON.parse(historyRaw) as { updatedAt?: unknown };
      if (typeof parsed?.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)) historyUpdatedAt = parsed.updatedAt;
    } catch { /* Invalid legacy history is treated as older than any valid durable snapshot. */ }
  }
  const sessionUpdatedAt = sessions.reduce((latest, session) => Math.max(latest, session.createdAt), 0);
  return { version: 1, messages, sessions, artifacts: [], updatedAt: Math.max(historyUpdatedAt, sessionUpdatedAt) };
}

function journalMessages(messages: ConversationMessage[]): void {
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({
      version: HISTORY_EXPORT_VERSION,
      messages: persistableConversationMessages(messages),
      updatedAt: Date.now(),
    }));
  } catch { /* IndexedDB persistence and the visible storage health remain authoritative. */ }
}

function PersonalReleaseRoot() {
  const { settings, updateSettings } = usePersonalSettings();
  const t = getTranslations(settings.language);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>(loadStoredHistory);
  const [sessions, setSessions] = useState<ConversationSession[]>(loadStoredSessions);
  const [artifacts, setArtifacts] = useState<PersistedArtifact[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [storageReadFailed, setStorageReadFailed] = useState(false);
  const [storageHealth, setStorageHealth] = useState<StorageHealth>('ready');
  const [resetSignal, setResetSignal] = useState(0);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  const [updateReady, setUpdateReady] = useState(false);
  const [knowledgeContext, setKnowledgeContext] = useState('');
  const dirtyDuringHydration = useRef({ messages: false, sessions: false, artifacts: false });

  const resolvedTheme = useMemo(() => settings.selectedTheme === 'dark' || settings.selectedTheme === 'light' ? settings.selectedTheme : (systemPrefersDark ? 'dark' : 'light'), [settings.selectedTheme, systemPrefersDark]);
  useEffect(() => { const media = window.matchMedia('(prefers-color-scheme: dark)'); const onChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches); setSystemPrefersDark(media.matches); media.addEventListener?.('change', onChange); return () => media.removeEventListener?.('change', onChange); }, []);
  useEffect(() => { const announceUpdate = () => setUpdateReady(true); window.addEventListener('origin:pwa-update-ready', announceUpdate); return () => window.removeEventListener('origin:pwa-update-ready', announceUpdate); }, []);
  useEffect(() => { const root = document.documentElement; root.lang = settings.language; root.dataset.theme = resolvedTheme; root.dataset.designTheme = settings.designTheme === 'luxury' || settings.designTheme === 'glass' ? settings.designTheme : 'minimal'; root.classList.toggle('light', resolvedTheme === 'light'); root.classList.toggle('dark', resolvedTheme === 'dark'); document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'dark' ? '#030712' : '#f7f6f2'); }, [settings.language, settings.designTheme, resolvedTheme]);
  useEffect(() => { document.documentElement.dataset.originStorageState = !isHydrated ? 'hydrating' : storageHealth === 'ready' ? 'ready' : 'degraded'; }, [isHydrated, storageHealth]);
  useEffect(() => { let active = true; const legacy = loadLegacySnapshot(); const cancelIdle = scheduleIdle(() => { void migrateOriginLegacySnapshot(originIndexedDbAdapter, legacy, () => { window.localStorage.removeItem(HISTORY_STORAGE_KEY); window.localStorage.removeItem(SESSION_STORAGE_KEY); }).then((result) => { if (!active) return; if (result.snapshot) { if (!dirtyDuringHydration.current.messages) { try { setMessages(parseImportedHistory({ messages: result.snapshot.messages })); } catch { setMessages([]); } } if (!dirtyDuringHydration.current.sessions) setSessions(loadSessionsFromSnapshot(result.snapshot.sessions)); if (!dirtyDuringHydration.current.artifacts) setArtifacts(parseStoredArtifacts(result.snapshot.artifacts)); } setStorageReadFailed(result.readFailed === true); setStorageHealth(result.writeResult && result.writeResult !== 'saved' ? result.writeResult : 'ready'); setIsHydrated(true); }); }); return () => { active = false; cancelIdle(); }; }, []);
  useEffect(() => { if (!isHydrated || storageReadFailed) return; const snapshot = snapshotFromState(messages, sessions, artifacts); const timer = window.setTimeout(() => { void originIndexedDbAdapter.save(snapshot).then((result) => setStorageHealth(result === 'saved' ? 'ready' : result)); }, 180); return () => window.clearTimeout(timer); }, [artifacts, isHydrated, messages, sessions, storageReadFailed]);

  /* The legacy App header contains an accidental ancestor click handler that clears local state and reloads /.
     Capture the settings trigger before React's delegated click handler so Settings is deterministic on touch and desktop. */
  useEffect(() => {
    const handleSettingsTrigger = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (!target) return;
      const label = target.getAttribute('aria-label') ?? '';
      const text = target.textContent?.trim() ?? '';
      if (label !== t.openSettings && !text.includes(t.settings)) return;
      if (!target.closest('.origin-header')) return;
      event.preventDefault();
      event.stopPropagation();
      setIsSettingsOpen(true);
    };
    document.addEventListener('click', handleSettingsTrigger, true);
    return () => document.removeEventListener('click', handleSettingsTrigger, true);
  }, [t.openSettings, t.settings]);

  const archiveSession = (source: readonly ConversationMessage[]) => { if (!source.length) return; dirtyDuringHydration.current.sessions = true; const firstUser = source.find((message) => message.role === 'user')?.content || source[0]?.content || 'ORIGIN セッション'; const snapshot: ConversationSession = { id: `session-${Date.now()}`, title: firstUser.replace(/\s+/g, ' ').slice(0, 72), createdAt: Date.now(), messages: persistableConversationMessages(source) }; setSessions((current) => [snapshot, ...current.filter((session) => session.title !== snapshot.title)].slice(0, 24)); };
  const exportHistory = () => { const payload = JSON.stringify({ version: HISTORY_EXPORT_VERSION, exportedAt: new Date().toISOString(), messages: persistableConversationMessages(messages) }, null, 2); const anchor = document.createElement('a'); const url = URL.createObjectURL(new Blob([payload], { type: 'application/json;charset=utf-8' })); anchor.href = url; anchor.download = `origin-personal-history-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url); };
  const importHistory = async (file: File) => { if (file.size > 1_500_000) throw new Error(t.historyImportFailed); try { dirtyDuringHydration.current.messages = true; setMessages(parseImportedHistory(JSON.parse(await file.text()))); } catch { throw new Error(t.historyImportFailed); } };
  const resetConversation = () => { archiveSession(messages); dirtyDuringHydration.current.messages = true; setMessages([]); setResetSignal((value) => value + 1); };

  return <>
    <FocusModeController />
    <SplashScreen />
    <UniversalMasterEnginePanel onContextReady={(context) => { setKnowledgeContext(context); window.dispatchEvent(new CustomEvent('origin:knowledge-context', { detail: { context } })); }} />
    {knowledgeContext && <p role="status" className="sr-only">ナレッジグラフからチャット文脈を選択しました。</p>}
    <PersonalEditionApp settings={settings} onOpenSettings={() => setIsSettingsOpen(true)} messages={messages} sessions={sessions} artifacts={artifacts} onArchiveSession={archiveSession} onRestoreSession={(session) => { const next = session.messages.map((message) => ({ ...message })); dirtyDuringHydration.current.messages = true; if (!storageReadFailed) journalMessages(next); setMessages(next); }} onMessagesChange={(next) => { dirtyDuringHydration.current.messages = true; if (!storageReadFailed) journalMessages(next); setMessages(next); }} onArtifactsChange={(next) => { dirtyDuringHydration.current.artifacts = true; setArtifacts(next); }} resetSignal={resetSignal} />
    <SettingsErrorBoundary>
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} settings={settings} updateSettings={updateSettings} messageCount={messages.length} onExportHistory={exportHistory} onImportHistory={importHistory} onResetHistory={resetConversation} />
    </SettingsErrorBoundary>
    {updateReady && <p role="status" className="origin-pwa-update-notice">{t.pwaUpdateNotice}</p>}
    {(!isHydrated || storageHealth !== 'ready') && <p data-testid="origin-storage-status" role="status" className="sr-only">{!isHydrated ? '端末内ストレージを準備しています。' : '端末内ストレージへ保存できないため、このセッションはメモリ上で継続しています。'}</p>}
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><PersonalReleaseRoot /></StrictMode>);
