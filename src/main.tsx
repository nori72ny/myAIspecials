import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SettingsModal from './components/SettingsModal';
import PersonalEditionApp from './components/personal/PersonalEditionApp';
import { usePersonalSettings } from './hooks/usePersonalSettings';
import { getTranslations } from './i18n';
import { registerOriginServiceWorker } from './pwa/registerServiceWorker';
import './index.css';

registerOriginServiceWorker();

const HISTORY_EXPORT_VERSION = 1;
const HISTORY_STORAGE_KEY = 'origin_personal_history';

type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

function parseImportedHistory(value: unknown): ConversationMessage[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { messages?: unknown }).messages)) {
    throw new Error('invalid-history');
  }
  const messages = (value as { messages: unknown[] }).messages;
  if (messages.length > 500) throw new Error('history-too-large');

  return messages.map((message, index) => {
    if (!message || typeof message !== 'object') throw new Error(`invalid-history-${index}`);
    const candidate = message as Partial<ConversationMessage>;
    if (candidate.role !== 'user' && candidate.role !== 'assistant' || typeof candidate.content !== 'string') {
      throw new Error(`invalid-history-${index}`);
    }
    return {
      id: typeof candidate.id === 'string' && candidate.id.length <= 128 ? candidate.id : `import-${index}-${Date.now()}`,
      role: candidate.role,
      content: candidate.content.slice(0, 50_000),
    };
  });
}

function loadStoredHistory(): ConversationMessage[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    return raw ? parseImportedHistory(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function PersonalReleaseRoot() {
  const { settings, updateSettings } = usePersonalSettings();
  const t = getTranslations(settings.language);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>(loadStoredHistory);
  const [resetSignal, setResetSignal] = useState(0);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  const [updateReady, setUpdateReady] = useState(false);

  const resolvedTheme = useMemo(() => (
    settings.selectedTheme === 'dark' || settings.selectedTheme === 'light'
      ? settings.selectedTheme
      : (systemPrefersDark ? 'dark' : 'light')
  ), [settings.selectedTheme, systemPrefersDark]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    setSystemPrefersDark(media.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    const announceUpdate = () => setUpdateReady(true);
    window.addEventListener('origin:pwa-update-ready', announceUpdate);
    return () => window.removeEventListener('origin:pwa-update-ready', announceUpdate);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = settings.language;
    root.dataset.theme = resolvedTheme;
    root.classList.toggle('light', resolvedTheme === 'light');
    root.classList.toggle('dark', resolvedTheme === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'dark' ? '#111827' : '#f7f6f2');
  }, [settings.language, resolvedTheme]);

  useEffect(() => {
    try {
      if (messages.length) window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ version: HISTORY_EXPORT_VERSION, messages }));
      else window.localStorage.removeItem(HISTORY_STORAGE_KEY);
    } catch {
      // History remains available in memory if storage is unavailable.
    }
  }, [messages]);

  const exportHistory = () => {
    const payload = JSON.stringify({ version: HISTORY_EXPORT_VERSION, exportedAt: new Date().toISOString(), messages }, null, 2);
    const anchor = document.createElement('a');
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json;charset=utf-8' }));
    anchor.href = url;
    anchor.download = `origin-personal-history-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importHistory = async (file: File) => {
    if (file.size > 1_500_000) throw new Error(t.historyImportFailed);
    try {
      const parsed = parseImportedHistory(JSON.parse(await file.text()));
      setMessages(parsed);
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ version: HISTORY_EXPORT_VERSION, messages: parsed }));
    } catch {
      throw new Error(t.historyImportFailed);
    }
  };

  const resetConversation = () => {
    setMessages([]);
    window.localStorage.removeItem(HISTORY_STORAGE_KEY);
    setResetSignal((value) => value + 1);
  };

  return (
    <>
      <PersonalEditionApp
        settings={settings}
        onOpenSettings={() => setIsSettingsOpen(true)}
        messages={messages}
        onMessagesChange={setMessages}
        resetSignal={resetSignal}
      />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        updateSettings={updateSettings}
        messageCount={messages.length}
        onExportHistory={exportHistory}
        onImportHistory={importHistory}
        onResetHistory={resetConversation}
      />
      {updateReady && (
        <p role="status" className="origin-pwa-update-notice">
          {t.pwaUpdateNotice}
        </p>
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersonalReleaseRoot />
  </StrictMode>,
);
