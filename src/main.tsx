import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { historySessionTitle, type ConversationMessage, type ConversationSession } from './App';
import SettingsModal from './components/SettingsModal';
import SettingsErrorBoundary from './components/SettingsErrorBoundary';
import SplashScreen from './components/SplashScreen';
import FocusModeController from './components/FocusModeController';
import { resolveOriginCatSeason } from './components/OriginCatState';
import PersonalEditionApp from './components/personal/PersonalEditionApp';
import { isCreativeArtifactMetaV15, type CreativeArtifactMetaV15 } from './creative/creativeStudioV15';
import { usePersonalSettings } from './hooks/usePersonalSettings';
import { getTranslations } from './i18n';
import { decryptHistoryText, encryptHistoryText, isEncryptedHistoryText, migrateOriginLegacySnapshot, originIndexedDbAdapter, type OriginPersistedSnapshot, type OriginStorageWriteResult } from './lib/local/OriginIndexedDb';
import { isResearchReportResult } from './research/researchReport';
import { registerOriginServiceWorker } from './pwa/registerServiceWorker';
import { installActiveContextChatBridge } from './services/activeContextChatBridge';
import { refreshVoiceAvailability } from './voice/voiceAvailability';
import { refreshVoiceOutputAvailability } from './voice/voiceOutputAvailability';
import '@fontsource/m-plus-rounded-1c/400.css';
import '@fontsource/m-plus-rounded-1c/500.css';
import '@fontsource/m-plus-rounded-1c/700.css';
import '@fontsource/m-plus-rounded-1c/800.css';
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/500.css';
import '@fontsource/noto-sans-jp/700.css';
import './index.css';
import './ultra-optics.css';
import './audit-2026-priority.css';
import './origin-top-ui.css';

registerOriginServiceWorker();
installActiveContextChatBridge();
// Voice input (PR-V3): probe the transcribe endpoint's kill switch once
// at startup. The composer reads the result from the availability store
// and shows the microphone button only when the endpoint proves it is
// enabled; components never probe on mount.
void refreshVoiceAvailability();
// Voice output (VC-1): probe the health status' voiceOutputEnabled
// switch the same way. The read-aloud button and the "Orin's voice"
// settings section read the store and stay hidden until the server
// proves the switch is on.
void refreshVoiceOutputAvailability();

const HISTORY_EXPORT_VERSION = 1;
const HISTORY_STORAGE_KEY = 'origin_personal_history';
const SESSION_STORAGE_KEY = 'origin_personal_sessions';

type ArtifactRevision = { id: string; content: string; createdAt: number; source: 'generated' | 'direct-touch' | 'restore' };
type PersistedArtifact = { id: string; type: 'code' | 'markdown' | 'mermaid' | 'html'; title: string; language: string; content: string; isComplete: boolean; revision?: number; revisions?: readonly ArtifactRevision[]; creative?: CreativeArtifactMetaV15 };
type StorageHealth = 'ready' | Exclude<OriginStorageWriteResult, 'saved'>;
type IdleWindow = Window & typeof globalThis & { requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number; cancelIdleCallback?: (handle: number) => void };

export function persistableConversationMessages(messages: readonly ConversationMessage[]): ConversationMessage[] {
  return messages.map((message) => {
    // ファイル成果物（PR-3a）はバイト列を base64 で保持するため、履歴には
    // 含めない（UnifiedChatCore の messagesForStorage と同じ扱い）。
    // 回答本文はそのまま残る。
    const withoutFiles = message.files ? { ...message, files: undefined } : message;
    return withoutFiles.image
      ? { ...withoutFiles, image: { ...withoutFiles.image, url: undefined } }
      : { ...withoutFiles };
  });
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

export function parseImportedHistory(value: unknown): ConversationMessage[] {
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
      const validPrompt = sourceImage.prompt === undefined || typeof sourceImage.prompt === 'string' && sourceImage.prompt.length <= 2_000;
      const validVisualProvenance = sourceImage.visualBrainVersion === 'visual-brain-v1'
        && sourceImage.planVersion === 'raster-visual-plan-v1'
        && typeof sourceImage.planSha256 === 'string' && /^[a-f0-9]{64}$/i.test(sourceImage.planSha256)
        && typeof sourceImage.purpose === 'string' && /^[a-z-]{1,40}$/.test(sourceImage.purpose)
        && typeof sourceImage.typographyOverlay === 'boolean'
        && sourceImage.sourceCriticVersion === 'raster-structural-critic-v1'
        && typeof sourceImage.sourceQualityScore === 'number'
        && Number.isInteger(sourceImage.sourceQualityScore)
        && sourceImage.sourceQualityScore >= 0
        && sourceImage.sourceQualityScore <= 100
        && sourceImage.technicalCriticVersion === 'raster-technical-critic-v1'
        && typeof sourceImage.technicalQualityScore === 'number'
        && Number.isInteger(sourceImage.technicalQualityScore)
        && sourceImage.technicalQualityScore >= 0
        && sourceImage.technicalQualityScore <= 100;
      const validProvider = sourceImage.providerId === 'pollinations-zero-cost'
        || sourceImage.providerId === 'cloudflare-workers-ai-free'
        || sourceImage.providerId === 'origin-local-canvas';
      if (validMime && validAsset && validProvider
        && typeof sourceImage.model === 'string' && sourceImage.model.length > 0 && sourceImage.model.length <= 180
        && typeof sourceImage.downloadName === 'string' && /^[^\\/\u0000-\u001f\u007f]{1,180}\.(?:png|jpe?g|webp)$/i.test(sourceImage.downloadName)
        && validGeneration && validDimensions && validRelation && validParent && validPrompt && validVisualProvenance) {
        image = {
          assetId: sourceImage.assetId!.toLowerCase(),
          mimeType: sourceImage.mimeType!,
          downloadName: sourceImage.downloadName!,
          sha256: sourceImage.sha256!.toLowerCase(),
          providerId: sourceImage.providerId!,
          model: sourceImage.model!,
          generationId: sourceImage.generationId!,
          visualBrainVersion: 'visual-brain-v1',
          planVersion: 'raster-visual-plan-v1',
          planSha256: sourceImage.planSha256!.toLowerCase(),
          purpose: sourceImage.purpose!,
          typographyOverlay: sourceImage.typographyOverlay!,
          sourceCriticVersion: 'raster-structural-critic-v1',
          sourceQualityScore: Number(sourceImage.sourceQualityScore),
          technicalCriticVersion: 'raster-technical-critic-v1',
          technicalQualityScore: Number(sourceImage.technicalQualityScore),
          prompt: typeof sourceImage.prompt === 'string' ? sourceImage.prompt.slice(0, 2_000) : undefined,
          width: Number(sourceImage.width),
          height: Number(sourceImage.height),
          relation: sourceImage.relation!,
          parentId: sourceImage.parentId?.toLowerCase(),
        };
      }
    }
    // リサーチ結果は会話の一部として履歴に残るため（2026-11-09の
    // チャット統合）、保存時と同じ契約で検証できた場合だけ復元する。
    // 検証できない結果は、画像と同じく静かに落とす（本文は残る）。
    let research: ConversationMessage['research'];
    if (isResearchReportResult(candidate.research)) {
      research = { ...candidate.research, report: candidate.research.report.slice(0, 50_000) };
    }
    return {
      id: typeof candidate.id === 'string' && candidate.id.length <= 128 ? candidate.id : `import-${index}-${Date.now()}`,
      role: candidate.role,
      content: candidate.content.slice(0, 50_000),
      // 表示専用文面（「回答を調整」ピルのラベル等）も会話の一部として
      // 保持する。これを落とすと復元後に内部指示文が吹き出しへ戻ってしまう。
      // 旧データには無いので、その場合は undefined のまま（content を表示）。
      displayContent: typeof candidate.displayContent === 'string' && candidate.displayContent.length > 0 ? candidate.displayContent.slice(0, 2_000) : undefined,
      // 送信の種別（K-04）も検証できた場合だけ保持する。表示文が欠けた
      // データでも、印があれば表示解決が内部指示文を出さずに済む。
      requestKind: candidate.requestKind === 'refinement' ? 'refinement' : undefined,
      deliveryState: candidate.deliveryState === 'verified' || candidate.deliveryState === 'error' ? candidate.deliveryState : undefined,
      image,
      research,
    };
  });
}
/**
 * ジャーナル（localStorage の会話控え）を読む。暗号化された履歴エンベロープ
 * （S3）なら復号し、旧形式の平文はそのまま返す。今使える鍵で復号できない
 * ジャーナル（例：パスキーで守られていて、まだ解錠していない）は
 * unreadable として区別する：空の履歴と取り違えず、キー自体も消さずに残し、
 * 次回起動（解錠後）に再試行できるようにするため。
 */
async function readLegacyJournal(): Promise<{ text: string | null; unreadable: boolean }> {
  let raw: string | null;
  try { raw = window.localStorage.getItem(HISTORY_STORAGE_KEY); } catch { return { text: null, unreadable: false }; }
  if (!raw) return { text: null, unreadable: false };
  if (!isEncryptedHistoryText(raw)) return { text: raw, unreadable: false };
  try {
    return { text: await decryptHistoryText(raw), unreadable: false };
  } catch {
    return { text: null, unreadable: true };
  }
}
function loadStoredSessions(): ConversationSession[] { try { const raw = window.localStorage.getItem(SESSION_STORAGE_KEY); if (!raw) return []; const parsed = JSON.parse(raw) as unknown; if (!Array.isArray(parsed)) return []; return parsed.slice(0, 24).flatMap((candidate, index) => { if (!candidate || typeof candidate !== 'object') return []; const source = candidate as Partial<ConversationSession>; if (typeof source.id !== 'string' || typeof source.title !== 'string' || typeof source.createdAt !== 'number' || !Array.isArray(source.messages)) return []; try { return [{ id: source.id.slice(0, 128) || `session-${index}`, title: source.title.slice(0, 120), createdAt: source.createdAt, messages: parseImportedHistory({ messages: source.messages }) }]; } catch { return []; } }); } catch { return []; } }
function loadSessionsFromSnapshot(value: unknown): ConversationSession[] { if (!Array.isArray(value)) return []; return value.slice(0, 24).flatMap((candidate, index) => { if (!candidate || typeof candidate !== 'object') return []; const source = candidate as Partial<ConversationSession>; if (typeof source.id !== 'string' || typeof source.title !== 'string' || typeof source.createdAt !== 'number' || !Array.isArray(source.messages)) return []; try { return [{ id: source.id.slice(0, 128) || `session-${index}`, title: source.title.slice(0, 120), createdAt: source.createdAt, messages: parseImportedHistory({ messages: source.messages }) }]; } catch { return []; } }); }
function parseStoredArtifacts(value: unknown): PersistedArtifact[] { if (!Array.isArray(value)) return []; return value.slice(0, 500).flatMap((candidate) => { if (!candidate || typeof candidate !== 'object') return []; const source = candidate as Partial<PersistedArtifact>; if (typeof source.id !== 'string' || typeof source.title !== 'string' || typeof source.language !== 'string' || typeof source.content !== 'string' || typeof source.isComplete !== 'boolean' || !source.type || !['code', 'markdown', 'mermaid', 'html'].includes(source.type)) return []; return [{ id: source.id.slice(0, 160), type: source.type, title: source.title.slice(0, 160), language: source.language.slice(0, 48), content: source.content.slice(0, 1_000_000), isComplete: source.isComplete, revision: typeof source.revision === 'number' ? Math.max(1, Math.floor(source.revision)) : undefined, revisions: undefined, creative: isCreativeArtifactMetaV15(source.creative) ? source.creative : undefined }]; }); }
function snapshotFromState(messages: ConversationMessage[], sessions: ConversationSession[], artifacts: PersistedArtifact[]): OriginPersistedSnapshot {
  return {
    version: 1,
    messages: persistableConversationMessages(messages),
    sessions: sessions.map((session) => ({ ...session, messages: persistableConversationMessages(session.messages) })),
    artifacts,
    updatedAt: Date.now(),
  };
}
type LegacySnapshotRead = { snapshot: OriginPersistedSnapshot | null; journalUnreadable: boolean };

async function loadLegacySnapshot(): Promise<LegacySnapshotRead> {
  let sessionsRaw: string | null;
  try { sessionsRaw = window.localStorage.getItem(SESSION_STORAGE_KEY); } catch { sessionsRaw = null; }
  const journal = await readLegacyJournal();
  if (!journal.text && !journal.unreadable && !sessionsRaw) return { snapshot: null, journalUnreadable: false };

  let messages: ConversationMessage[] = [];
  let historyUpdatedAt = 0;
  if (journal.text) {
    try { messages = parseImportedHistory(JSON.parse(journal.text)); } catch { messages = []; }
    try {
      const parsed = JSON.parse(journal.text) as { updatedAt?: unknown };
      if (typeof parsed?.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)) historyUpdatedAt = parsed.updatedAt;
    } catch { /* Invalid legacy history is treated as older than any valid durable snapshot. */ }
  }
  const sessions = sessionsRaw ? loadStoredSessions() : [];
  const sessionUpdatedAt = sessions.reduce((latest, session) => Math.max(latest, session.createdAt), 0);
  // 読めないジャーナルだけが残っている場合は「何も保存されていない」と
  // 取り違えないよう、スナップショット自体を返さない（キーは残る）。
  if (journal.unreadable && !sessionsRaw) return { snapshot: null, journalUnreadable: true };
  return {
    snapshot: { version: 1, messages, sessions, artifacts: [], updatedAt: Math.max(historyUpdatedAt, sessionUpdatedAt) },
    journalUnreadable: journal.unreadable,
  };
}

/**
 * 起動時に保存されていた「前回の進行中会話」を、履歴セッションとして
 * 退避するための変換。アプリは必ずトップ画面から始めるため
 * （オーナー指示 2026-11-09）、前回の会話をそのまま開くことはせず、
 * 履歴ドロワーから明示的に選んだときだけ復元できる形で残す。
 */
export function startupArchivedSession(source: readonly ConversationMessage[], createdAt: number): ConversationSession | null {
  if (!source.length) return null;
  const firstId = typeof source[0]?.id === 'string' && source[0].id ? source[0].id : String(createdAt);
  return {
    id: `session-startup-${firstId}`.slice(0, 128),
    // タイトル付けは App 側の表示用変換と共通化した（P7 A-3）。
    // 利用者メッセージだけを源にし、生成時点で表示と同じ整形を掛ける。
    title: historySessionTitle(source),
    createdAt,
    messages: persistableConversationMessages(source),
  };
}

/**
 * 起動時の退避をセッション一覧へ統合する。同じ会話（先頭メッセージIDと
 * 件数が一致）が既に履歴にある場合は二重登録しない。
 */
export function withStartupArchivedSession(sessions: readonly ConversationSession[], source: readonly ConversationMessage[], createdAt: number): ConversationSession[] {
  const archived = startupArchivedSession(source, createdAt);
  if (!archived) return [...sessions];
  const firstId = source[0]?.id;
  const alreadyArchived = sessions.some((session) => session.messages[0]?.id === firstId && session.messages.length === source.length);
  if (alreadyArchived) return [...sessions];
  return [archived, ...sessions].slice(0, 24);
}

// 暗号化が非同期になったため、ジャーナル書き込みは直列化する。古い内容が
// 新しい内容より後に書き込まれて巻き戻ることを防ぐ。
let journalWriteChain: Promise<void> = Promise.resolve();

function journalMessages(messages: ConversationMessage[]): void {
  const payload = JSON.stringify({
    version: HISTORY_EXPORT_VERSION,
    messages: persistableConversationMessages(messages),
    updatedAt: Date.now(),
  });
  journalWriteChain = journalWriteChain.then(async () => {
    try {
      // ジャーナルは履歴ストアの鍵で暗号化する（S3）。暗号化できない場合は
      // 平文で書かず、その回の書き込み自体を見送る。
      window.localStorage.setItem(HISTORY_STORAGE_KEY, await encryptHistoryText(payload));
    } catch { /* IndexedDB persistence and the visible storage health remain authoritative. */ }
  });
}

function PersonalReleaseRoot() {
  const { settings, updateSettings } = usePersonalSettings();
  const t = getTranslations(settings.language);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsFocusSection, setSettingsFocusSection] = useState<'coding' | null>(null);
  // 起動時は保存済みの進行中会話をそのまま開かず、必ずトップ画面
  // （空の会話）から始める。前回の会話は hydration の完了時に履歴
  // セッションへ退避され、失われない（オーナー指示 2026-11-09）。
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [sessions, setSessions] = useState<ConversationSession[]>(loadStoredSessions);
  const [artifacts, setArtifacts] = useState<PersistedArtifact[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  // スプラッシュの切り替えは「トップ画面の初回描画が終わったこと」を
  // 準備完了とする。保存データの移行（isHydrated）は requestIdleCallback
  // 経由で始まるため完了時刻が端末負荷で大きくぶれ、それを待つと
  // スプラッシュの表示時間が起動ごとに変わってしまう。トップ画面は
  // スプラッシュの背後で初回描画の時点で完成しており、移行の完了は
  // 画面の見た目を変えない（進行中会話は開かず履歴へ退避されるだけ）
  // ため、移行は背後で静かに終わらせる。
  const [hasPainted, setHasPainted] = useState(false);
  const [storageReadFailed, setStorageReadFailed] = useState(false);
  const [storageHealth, setStorageHealth] = useState<StorageHealth>('ready');
  const [resetSignal, setResetSignal] = useState(0);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  const [updateReady, setUpdateReady] = useState(false);
  const dirtyDuringHydration = useRef({ messages: false, sessions: false, artifacts: false });

  const resolvedTheme = useMemo(() => settings.selectedTheme === 'dark' || settings.selectedTheme === 'light' ? settings.selectedTheme : (systemPrefersDark ? 'dark' : 'light'), [settings.selectedTheme, systemPrefersDark]);
  useEffect(() => { const media = window.matchMedia('(prefers-color-scheme: dark)'); const onChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches); setSystemPrefersDark(media.matches); media.addEventListener?.('change', onChange); return () => media.removeEventListener?.('change', onChange); }, []);
  useEffect(() => { const announceUpdate = () => setUpdateReady(true); window.addEventListener('origin:pwa-update-ready', announceUpdate); return () => window.removeEventListener('origin:pwa-update-ready', announceUpdate); }, []);
  useEffect(() => { const root = document.documentElement; const isDark = resolvedTheme === 'dark'; root.lang = settings.language; root.dataset.theme = resolvedTheme; root.dataset.designTheme = settings.designTheme === 'luxury' || settings.designTheme === 'glass' ? settings.designTheme : 'minimal'; root.classList.toggle('dark', isDark); root.classList.toggle('light', !isDark); document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#0b1024' : '#ffffff'); }, [resolvedTheme, settings.language, settings.designTheme]);
  // 背景の季節デザイン（オーナー依頼 2026-11-16、実装 2026-11-25）：
  // 季節の判定はオリンの待機姿・プロフィールカードと同じ
  // resolveOriginCatSeason を正本とし、結果を data-season 属性として
  // CSS（index.css の季節ルール）へ渡す。季節外では属性自体を外し、
  // 背景は従来どおりテーマの --bg-primary そのものになる。季節は
  // 日付で決まりセッション中に意味を持って変わらないため、判定は
  // 起動時の一度だけでよい（OrinPanel の描画時判定と同じ前提）。
  useEffect(() => { const root = document.documentElement; const season = resolveOriginCatSeason(new Date()); if (season) root.dataset.season = season; else delete root.dataset.season; }, []);
  useEffect(() => { document.documentElement.dataset.originStorageState = !isHydrated ? 'hydrating' : storageHealth === 'ready' ? 'ready' : 'degraded'; }, [isHydrated, storageHealth]);
  useEffect(() => { let second = 0; const first = window.requestAnimationFrame(() => { second = window.requestAnimationFrame(() => setHasPainted(true)); }); return () => { window.cancelAnimationFrame(first); if (second) window.cancelAnimationFrame(second); }; }, []);
  useEffect(() => { let active = true; const cancelIdle = scheduleIdle(() => { void (async () => { const legacy = await loadLegacySnapshot(); const result = await migrateOriginLegacySnapshot(originIndexedDbAdapter, legacy.snapshot, () => { // 読めないジャーナル（S3）は旧データの残骸ではない。まだ使えない鍵で守られた最新の進行中会話かもしれないため、その場合は履歴キーを消さずに残す。
      if (!legacy.journalUnreadable) window.localStorage.removeItem(HISTORY_STORAGE_KEY); window.localStorage.removeItem(SESSION_STORAGE_KEY); }); if (!active) return; if (result.snapshot) { // 保存されていた進行中会話は開かず、履歴セッションへ退避する（起動時は必ずトップ画面）。
        let storedMessages: ConversationMessage[] = []; try { storedMessages = parseImportedHistory({ messages: result.snapshot.messages }); } catch { storedMessages = []; }
        const archivedAt = typeof result.snapshot.updatedAt === 'number' && Number.isFinite(result.snapshot.updatedAt) && result.snapshot.updatedAt > 0 ? result.snapshot.updatedAt : Date.now();
        if (!dirtyDuringHydration.current.sessions) { setSessions(withStartupArchivedSession(loadSessionsFromSnapshot(result.snapshot.sessions), storedMessages, archivedAt)); }
        else if (storedMessages.length) { setSessions((current) => withStartupArchivedSession(current, storedMessages, archivedAt)); }
        if (!dirtyDuringHydration.current.artifacts) setArtifacts(parseStoredArtifacts(result.snapshot.artifacts)); } setStorageReadFailed(result.readFailed === true); setStorageHealth(result.writeResult && result.writeResult !== 'saved' ? result.writeResult : 'ready'); setIsHydrated(true); })(); }); return () => { active = false; cancelIdle(); }; }, []);
  useEffect(() => { if (!isHydrated || storageReadFailed) return; const snapshot = snapshotFromState(messages, sessions, artifacts); const timer = window.setTimeout(() => { void originIndexedDbAdapter.save(snapshot).then((result) => setStorageHealth(result === 'saved' ? 'ready' : result)); }, 180); return () => window.clearTimeout(timer); }, [artifacts, isHydrated, messages, sessions, storageReadFailed]);

  const archiveSession = (source: readonly ConversationMessage[]) => { if (!source.length) return; dirtyDuringHydration.current.sessions = true; const snapshot: ConversationSession = { id: `session-${Date.now()}`, title: historySessionTitle(source), createdAt: Date.now(), messages: persistableConversationMessages(source) }; setSessions((current) => [snapshot, ...current.filter((session) => session.title !== snapshot.title)].slice(0, 24)); };
  const exportHistory = () => { const payload = JSON.stringify({ version: HISTORY_EXPORT_VERSION, exportedAt: new Date().toISOString(), messages: persistableConversationMessages(messages) }, null, 2); const anchor = document.createElement('a'); const url = URL.createObjectURL(new Blob([payload], { type: 'application/json;charset=utf-8' })); anchor.href = url; anchor.download = `origin-personal-history-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url); };
  const importHistory = async (file: File) => { if (file.size > 1_500_000) throw new Error(t.historyImportFailed); try { dirtyDuringHydration.current.messages = true; setMessages(parseImportedHistory(JSON.parse(await file.text()))); } catch { throw new Error(t.historyImportFailed); } };
  const resetConversation = () => { archiveSession(messages); dirtyDuringHydration.current.messages = true; setMessages([]); setResetSignal((value) => value + 1); };
  const restoreSession = (session: ConversationSession) => { const next = session.messages.map((message) => ({ ...message })); dirtyDuringHydration.current.messages = true; if (!storageReadFailed) journalMessages(next); setMessages(next); };
  const openSourceSession = (sessionId: string) => { const session = sessions.find((candidate) => candidate.id === sessionId); if (!session) return; restoreSession(session); setIsSettingsOpen(false); };

  return <>
    <FocusModeController />
    <SplashScreen ready={hasPainted} oncePerSession />
    <PersonalEditionApp settings={settings} onOpenSettings={(section) => { setSettingsFocusSection(section ?? null); setIsSettingsOpen(true); }} messages={messages} sessions={sessions} artifacts={artifacts} onArchiveSession={archiveSession} onRestoreSession={restoreSession} onMessagesChange={(next) => { dirtyDuringHydration.current.messages = true; if (!storageReadFailed) journalMessages(next); setMessages(next); }} onArtifactsChange={(next) => { dirtyDuringHydration.current.artifacts = true; setArtifacts(next); }} resetSignal={resetSignal} />
    <SettingsErrorBoundary>
      <SettingsModal isOpen={isSettingsOpen} focusSection={settingsFocusSection} onClose={() => { setIsSettingsOpen(false); setSettingsFocusSection(null); }} settings={settings} updateSettings={updateSettings} savedConversationCount={sessions.length} onExportHistory={exportHistory} onImportHistory={importHistory} onResetHistory={resetConversation} sourceSessionIds={new Set(sessions.map((session) => session.id))} onOpenSourceSession={openSourceSession} />
    </SettingsErrorBoundary>
    {updateReady && <p role="status" className="origin-pwa-update-notice">{t.pwaUpdateNotice}</p>}
    {(!isHydrated || storageHealth !== 'ready') && <p data-testid="origin-storage-status" role="status" className="sr-only">{!isHydrated ? 'この端末への保存を準備しています。' : 'この端末に保存できないため、このセッションはメモリ上だけで続けています。'}</p>}
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><PersonalReleaseRoot /></StrictMode>);