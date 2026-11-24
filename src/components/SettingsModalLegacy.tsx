import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Copy, Download, Globe, Info, Laptop, Moon, RotateCcw, ShieldCheck, Sun, Upload, X } from 'lucide-react';
import { getTranslations } from '../i18n';
import type { Settings } from '../types';
import { cn } from '../utils';
import McpConnectionsSettings from './McpConnectionsSettings';
import PersonalizationSettings from './PersonalizationSettings';
import VoiceOutputSettings from './VoiceOutputSettings';
import { setSessionCredential, useSessionCredential } from '../security/sessionCredentials';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  updateSettings: (settings: Settings) => void;
  savedConversationCount?: number;
  onExportHistory?: () => void;
  onImportHistory?: (file: File) => Promise<void>;
  onResetHistory?: () => void;
  /** Ids of saved conversation sessions that still exist (memory source links). */
  sourceSessionIds?: ReadonlySet<string>;
  /** Opens the conversation a memory item came from, when it still exists. */
  onOpenSourceSession?: (sessionId: string) => void;
  /** Section to bring into view when the modal opens (e.g. from the code screen's key guidance). */
  focusSection?: 'coding' | null;
}

const FULL_RELEASE_SHA = /^[0-9a-f]{40}$/i;
type ReleaseIdentity = { status: 'loading' } | { status: 'ready'; sha: string } | { status: 'unavailable' };
type HistoryStatus = { kind: 'idle' } | { kind: 'success'; message: string } | { kind: 'error'; message: string };

export default function SettingsModalLegacy({
  isOpen, onClose, settings, updateSettings,
  savedConversationCount = 0,
  onExportHistory = () => undefined,
  onImportHistory = async () => undefined,
  onResetHistory = () => undefined,
  sourceSessionIds,
  onOpenSourceSession,
  focusSection,
}: Props) {
  const t = getTranslations(settings.language);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [mcpConfigured, setMcpConfigured] = useState(false);
  const [releaseIdentity, setReleaseIdentity] = useState<ReleaseIdentity>({ status: 'loading' });
  const [showFullReleaseSha, setShowFullReleaseSha] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>({ kind: 'idle' });
  const codingKey = useSessionCredential('coding');
  const adminKey = useSessionCredential('admin');
  const selectedTheme = settings.selectedTheme === 'light' || settings.selectedTheme === 'dark' || settings.selectedTheme === 'system' ? settings.selectedTheme : 'system';
  const selectedDesignTheme = settings.designTheme === 'luxury' || settings.designTheme === 'glass' ? settings.designTheme : 'minimal';

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const dialog = closeButtonRef.current?.closest('[role="dialog"]');
      const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? []).filter((element) => {
        // Controls inside a closed <details> are not rendered and cannot
        // take focus; its <summary> stays focusable so the disclosure can
        // still be opened from the keyboard.
        const details = element.closest('details');
        return !details || details.open || element.tagName === 'SUMMARY';
      });
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.clearTimeout(focusTimer); window.removeEventListener('keydown', handleKeyDown); previouslyFocused?.focus(); };
  }, [isOpen]);

  // 特定の節への案内から開かれたときは、その節の入力欄まで移動して
  // フォーカスする（コード画面の実行キー案内）。通常の開き方では
  // focusSection が無いため、従来どおり閉じるボタンへのフォーカスが担う。
  useEffect(() => {
    if (!isOpen || focusSection !== 'coding') return;
    const timer = window.setTimeout(() => {
      const input = document.getElementById('settings-coding-key');
      if (!input) return;
      if (typeof input.scrollIntoView === 'function') input.scrollIntoView({ block: 'center' });
      input.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [isOpen, focusSection]);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    let active = true;
    const timeoutId = window.setTimeout(() => { if (active) { controller.abort(); setReleaseIdentity({ status: 'unavailable' }); } }, 5_000);
    setReleaseIdentity({ status: 'loading' });
    setShowFullReleaseSha(false);
    setCopyStatus('idle');
    setHistoryStatus({ kind: 'idle' });
    void (async () => {
      try {
        const response = await fetch('/api/health', { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('release identity request failed');
        const payload: unknown = await response.json();
        const releaseSha = payload && typeof payload === 'object' && 'releaseSha' in payload ? (payload as { releaseSha?: unknown }).releaseSha : undefined;
        if (typeof releaseSha !== 'string' || !FULL_RELEASE_SHA.test(releaseSha)) throw new Error('release identity is invalid');
        if (active) { window.clearTimeout(timeoutId); setReleaseIdentity({ status: 'ready', sha: releaseSha.toLowerCase() }); }
      } catch {
        if (active) { window.clearTimeout(timeoutId); setReleaseIdentity({ status: 'unavailable' }); }
      }
    })();
    return () => { active = false; window.clearTimeout(timeoutId); controller.abort(); };
  }, [isOpen]);

  // 外部サービス連携（MCP）は、構成が有効な場合だけ項目を表示する。
  // 未構成のまま項目を出すと「準備中」への行き止まりになるため、状態を
  // 確認できるまでは出さない（仕組み自体は維持し、有効になれば現れる）。
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    let active = true;
    setMcpConfigured(false);
    void (async () => {
      try {
        const response = await fetch('/api/mcp/status', { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (active && payload && typeof payload === 'object' && (payload as { configured?: unknown }).configured === true) setMcpConfigured(true);
      } catch { /* 未構成・到達不能の場合は項目を表示しない */ }
    })();
    return () => { active = false; controller.abort(); };
  }, [isOpen]);

  const update = (patch: Partial<Settings>) => updateSettings({ ...settings, ...patch });
  const stopPointer = (event: React.SyntheticEvent) => { event.stopPropagation(); };
  const copyReleaseSha = async () => {
    if (releaseIdentity.status !== 'ready') return;
    setCopyStatus('idle');
    try { await navigator.clipboard.writeText(releaseIdentity.sha); setCopyStatus('success'); }
    catch { setCopyStatus('error'); }
  };
  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try { await onImportHistory(file); setHistoryStatus({ kind: 'success', message: t.historyImported }); }
    catch (error) { setHistoryStatus({ kind: 'error', message: error instanceof Error ? error.message : t.historyImportFailed }); }
  };
  const resetHistory = () => { onResetHistory(); setHistoryStatus({ kind: 'success', message: t.historyCleared }); };

  const handleBackdropPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[70] flex min-h-0 items-center justify-center overflow-hidden p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
          aria-describedby="settings-description"
          onPointerDown={handleBackdropPointerDown}
          style={{
            paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
            paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
            paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
            paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
          }}
        >
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="origin-dialog-overlay pointer-events-none absolute inset-0" aria-hidden="true" />
          <motion.div data-testid="settings-modal" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="origin-surface relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[660px] flex-col overflow-hidden rounded-2xl border sm:max-h-[calc(100dvh-2rem)]" onPointerDown={stopPointer} style={{ overscrollBehavior: 'contain' }}>
            <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
              <div><h2 id="settings-title" className="text-base font-bold">{t.settings}</h2><p id="settings-description" className="origin-muted mt-1 text-[13px]">{t.settingsDescription}</p></div>
              <button ref={closeButtonRef} type="button" onClick={(event) => { stopPointer(event); onClose(); }} data-testid="close-settings-button" aria-label={t.closeSettings} className="origin-secondary-button origin-close-button"><X aria-hidden="true" size={18} /></button>
            </div>
            <div data-testid="settings-scroll-region" className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-5 pb-7">
              <section aria-labelledby="language-heading" className="space-y-3"><h3 id="language-heading" className="flex items-center gap-2 text-sm font-bold"><Globe className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />{t.languageHeading}</h3><div className="grid grid-cols-2 gap-2">{[{ id: 'ja', label: t.languageJapanese }, { id: 'en', label: t.languageEnglish }].map((language) => { const selected = settings.language === language.id; return <button type="button" key={language.id} onClick={(event) => { stopPointer(event); update({ language: language.id as Settings['language'] }); }} aria-pressed={selected} style={{ minHeight: 48 }} className={cn('flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition', selected ? 'origin-primary-button border-transparent' : 'origin-secondary-button')}>{selected && <Check className="h-4 w-4" aria-hidden="true" />}{language.label}</button>; })}</div></section>
              <section aria-labelledby="appearance-heading" className="space-y-3 border-t border-[var(--border-default)] pt-5"><h3 id="appearance-heading" className="text-sm font-bold">{t.appearanceHeading}</h3><div className="grid grid-cols-3 gap-2">{[{ id: 'light', label: t.themeLight, icon: Sun }, { id: 'dark', label: t.themeDark, icon: Moon }, { id: 'system', label: t.themeSystem, icon: Laptop }].map((theme) => { const selected = selectedTheme === theme.id; return <button type="button" key={theme.id} onClick={(event) => { stopPointer(event); update({ selectedTheme: theme.id as Settings['selectedTheme'] }); }} aria-pressed={selected} style={{ minHeight: 48 }} className={cn('flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-1 text-sm font-semibold transition', selected ? 'origin-primary-button border-transparent' : 'origin-secondary-button')}><theme.icon className="h-4 w-4" aria-hidden="true" />{theme.label}</button>; })}</div><p className="origin-muted text-[13px] leading-5">{t.systemThemeDescription}</p></section>
              <section data-testid="origin-design-theme-section" aria-labelledby="design-theme-heading" className="space-y-3 border-t border-[var(--border-default)] pt-5"><h3 id="design-theme-heading" className="text-sm font-bold">{settings.language === 'ja' ? '見た目のテーマ' : 'Visual theme'}</h3><div role="group" aria-labelledby="design-theme-heading" className="grid grid-cols-3 gap-2">{([{ id: 'minimal', label: settings.language === 'ja' ? 'ミニマル' : 'Minimal' }, { id: 'luxury', label: settings.language === 'ja' ? 'ラグジュアリー' : 'Luxury' }, { id: 'glass', label: settings.language === 'ja' ? 'グラス' : 'Glass' }] as const).map((theme) => <button type="button" key={theme.id} data-testid={`design-theme-${theme.id}`} aria-pressed={selectedDesignTheme === theme.id} onClick={(event) => { stopPointer(event); update({ designTheme: theme.id }); }} style={{ minHeight: 48 }} className={cn('min-h-12 rounded-[10px] px-2 text-sm font-semibold transition-colors', selectedDesignTheme === theme.id ? 'origin-primary-button' : 'origin-secondary-button')}>{theme.label}</button>)}</div><p className="origin-muted text-[13px] leading-5">{settings.language === 'ja' ? '成果物のプレビューにも、同じデザインがすぐに反映されます。' : 'Artifact previews immediately reflect the same design.'}</p></section>
              <section aria-labelledby="history-heading" className="space-y-3 border-t border-[var(--border-default)] pt-5"><h3 id="history-heading" className="text-sm font-bold">{t.historyHeading}</h3><p className="origin-muted text-[13px] leading-5">{t.historyCount(savedConversationCount)}</p><input ref={importInputRef} type="file" accept="application/json,.json" tabIndex={-1} className="sr-only" aria-label={t.historyFileLabel} onChange={(event) => void handleImport(event)} /><div className="flex flex-wrap gap-2"><button type="button" onClick={(event) => { stopPointer(event); onExportHistory(); }} className="origin-secondary-button inline-flex min-h-12 flex-[1_1_auto] items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-center text-sm font-semibold"><Download className="h-4 w-4 shrink-0" aria-hidden="true" />{t.exportHistory}</button><button type="button" onClick={(event) => { stopPointer(event); importInputRef.current?.click(); }} className="origin-secondary-button inline-flex min-h-12 flex-[1_1_auto] items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-center text-sm font-semibold"><Upload className="h-4 w-4 shrink-0" aria-hidden="true" />{t.importHistory}</button><button type="button" onClick={(event) => { stopPointer(event); resetHistory(); }} className="origin-danger-button inline-flex min-h-12 flex-[1_1_auto] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-center text-sm font-semibold"><RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />{t.clearHistory}</button></div><p className="origin-muted text-[13px] leading-5">{t.historyResetNote}</p><p role="status" aria-live="polite" className={cn('text-sm leading-5', historyStatus.kind === 'error' ? 'text-[var(--danger)]' : 'origin-muted')}>{historyStatus.kind === 'idle' ? t.portableHistoryNotice : historyStatus.message}</p></section>
              <PersonalizationSettings language={settings.language} enabled={settings.personalizationEnabled !== false} onToggleEnabled={(next) => update({ personalizationEnabled: next })} sourceSessionIds={sourceSessionIds} onOpenSourceSession={onOpenSourceSession} />
              <VoiceOutputSettings language={settings.language} />
              <section aria-labelledby="coding-execution-heading" className="space-y-3 border-t border-[var(--border-default)] pt-5">
                <h3 id="coding-execution-heading" className="text-sm font-bold">{settings.language === 'ja' ? 'コード実行' : 'Code execution'}</h3>
                <p className="origin-muted text-[13px] leading-5">{settings.language === 'ja' ? 'コードの作成・変更を実行するためのキーです。通常のチャットや調べものには不要です。入力したキーは保存されず、このアプリを開いている間だけ使われます。' : 'This key runs code creation and changes. It is not needed for regular chat or research. The key is never saved and is only used while this app is open.'}</p>
                <div>
                  <label htmlFor="settings-coding-key" className="text-[13px] font-semibold">{settings.language === 'ja' ? '実行キー' : 'Execution key'}</label>
                  <input id="settings-coding-key" type="password" autoComplete="off" value={codingKey} onChange={(event) => setSessionCredential('coding', event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border-default)] bg-transparent px-3 text-sm" />
                </div>
              </section>
              {mcpConfigured && <details className="border-t border-[var(--border-default)] pt-5"><summary className="min-h-11 cursor-pointer py-3 text-sm font-bold">{settings.language === 'ja' ? '外部サービス連携（設定・状態確認）' : 'Connected services (setup & status)'}</summary><p className="origin-muted -mt-1 mb-3 text-[13px] leading-5">{settings.language === 'ja' ? '必要な場合だけ設定します。通常の利用では変更不要です。' : 'Set this up only when needed. No changes are required for normal use.'}</p><McpConnectionsSettings language={settings.language} /></details>}
              <section data-testid="origin-execution-policy" aria-labelledby="safety-heading" className="space-y-3 border-t border-[var(--border-default)] pt-5"><h3 id="safety-heading" className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />{t.safetyHeading}</h3><div className="rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-4 text-sm leading-6 text-[var(--accent-primary)]"><p className="font-bold">{t.freeOnlyTitle}</p><p className="mt-1 text-sm leading-5">{t.freeOnlyDescription}</p></div><p className="origin-muted text-[13px] leading-5">{t.secretWarning}</p></section>
              <details data-testid="release-identity" className="border-t border-[var(--border-default)] pt-5"><summary id="release-identity-heading" className="flex min-h-11 cursor-pointer items-center gap-2 py-3 text-sm font-bold"><Info className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />{t.technicalInformation}</summary><section aria-labelledby="release-identity-heading" className="space-y-3"><div className="origin-surface-muted rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="origin-muted text-sm font-semibold">{t.releaseId}</p>{releaseIdentity.status === 'loading' && <p role="status" className="origin-muted mt-1 text-sm">{t.releaseChecking}</p>}{releaseIdentity.status === 'unavailable' && <p role="status" className="mt-1 text-sm font-semibold text-[var(--danger)]">{t.releaseUnavailable}</p>}{releaseIdentity.status === 'ready' && <code data-testid="release-sha-value" className="mt-1 block max-w-full break-all text-sm font-semibold">{showFullReleaseSha ? releaseIdentity.sha : `${releaseIdentity.sha.slice(0, 12)}…`}</code>}</div>{releaseIdentity.status === 'ready' && <div className="flex flex-wrap gap-2"><button type="button" onClick={(event) => { stopPointer(event); setShowFullReleaseSha((current) => !current); }} aria-expanded={showFullReleaseSha} className="origin-secondary-button min-h-12 whitespace-nowrap rounded-xl px-3 text-sm font-semibold">{showFullReleaseSha ? t.shortenReleaseId : t.showFullReleaseId}</button><button type="button" onClick={(event) => { stopPointer(event); void copyReleaseSha(); }} className="origin-secondary-button inline-flex min-h-12 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-sm font-semibold">{copyStatus === 'success' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}{copyStatus === 'success' ? t.copied : t.copy}</button></div>}</div><p aria-live="polite" className="origin-muted mt-2 text-[13px] leading-5">{copyStatus === 'error' ? t.releaseIdCopyFailed : t.releaseIdHelp}</p></div></section></details>
              <details className="border-t border-[var(--border-default)] pt-5">
                <summary className="min-h-11 cursor-pointer py-3 text-sm font-bold">{settings.language === 'ja' ? '詳細（管理者向け）' : 'Advanced (for administrators)'}</summary>
                <p className="origin-muted text-[13px] leading-5">{settings.language === 'ja' ? '管理者として作成された作業を、エージェント画面に表示・操作するためのキーです。通常の利用では使いません。入力したキーは保存されず、このアプリを開いている間だけ使われます。' : 'This key shows and operates administrator-created work on the agent screen. It is not used in regular use. The key is never saved and is only used while this app is open.'}</p>
                <div className="mt-3">
                  <label htmlFor="settings-admin-key" className="text-[13px] font-semibold">{settings.language === 'ja' ? '管理者キー' : 'Administrator key'}</label>
                  <input id="settings-admin-key" type="password" autoComplete="off" value={adminKey} onChange={(event) => setSessionCredential('admin', event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border-default)] bg-transparent px-3 text-sm" />
                </div>
              </details>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
