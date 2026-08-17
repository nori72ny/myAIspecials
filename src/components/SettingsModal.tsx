import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Copy, Download, Globe, Info, Laptop, Moon, RotateCcw, ShieldCheck, Sun, Upload, X } from 'lucide-react';
import type { Settings } from '../types';
import { cn } from '../utils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  updateSettings: (settings: Settings) => void;
  messageCount?: number;
  onExportHistory?: () => void;
  onImportHistory?: (file: File) => Promise<void>;
  onResetHistory?: () => void;
}

const FULL_RELEASE_SHA = /^[0-9a-f]{40}$/i;
type ReleaseIdentity = { status: 'loading' } | { status: 'ready'; sha: string } | { status: 'unavailable' };
type HistoryStatus = { kind: 'idle' } | { kind: 'success'; message: string } | { kind: 'error'; message: string };

export default function SettingsModal({
  isOpen, onClose, settings, updateSettings,
  messageCount = 0,
  onExportHistory = () => undefined,
  onImportHistory = async () => { throw new Error('会話履歴の読み込みはこの画面では利用できません。'); },
  onResetHistory = () => undefined,
}: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [releaseIdentity, setReleaseIdentity] = useState<ReleaseIdentity>({ status: 'loading' });
  const [showFullReleaseSha, setShowFullReleaseSha] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>({ kind: 'idle' });
  const isEn = settings.language === 'en';
  const selectedTheme = settings.selectedTheme === 'light' || settings.selectedTheme === 'dark' || settings.selectedTheme === 'system'
    ? settings.selectedTheme
    : 'system';

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const dialog = closeButtonRef.current?.closest('[role="dialog"]');
      const focusable = dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.clearTimeout(focusTimer); window.removeEventListener('keydown', handleKeyDown); previouslyFocused?.focus(); };
  }, [isOpen, onClose]);

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

  const update = (patch: Partial<Settings>) => updateSettings({ ...settings, ...patch });
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
    try {
      await onImportHistory(file);
      setHistoryStatus({ kind: 'success', message: isEn ? 'Conversation history was imported.' : '会話履歴をインポートしました。' });
    } catch (error) {
      setHistoryStatus({ kind: 'error', message: error instanceof Error ? error.message : (isEn ? 'Could not import this file.' : 'ファイルをインポートできませんでした。') });
    }
  };
  const resetHistory = () => {
    onResetHistory();
    setHistoryStatus({ kind: 'success', message: isEn ? 'Conversation history was cleared.' : '会話履歴を初期化しました。' });
  };

  return (
    <AnimatePresence>
      {isOpen && <div className="fixed inset-0 z-50 flex min-h-0 items-center justify-center overflow-hidden p-3 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="settings-title" aria-describedby="settings-description">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="origin-dialog-overlay absolute inset-0 backdrop-blur-[2px]" aria-hidden="true" />
        <motion.div data-testid="settings-modal" initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 8 }} className="origin-surface relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border sm:max-h-[calc(100dvh-2rem)]">
          <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4"><div><h2 id="settings-title" className="text-base font-bold">{isEn ? 'Settings' : '設定'}</h2><p id="settings-description" className="origin-muted mt-1 text-[13px]">{isEn ? 'Changes are saved automatically.' : '変更は自動で保存されます。'}</p></div><button ref={closeButtonRef} type="button" onClick={onClose} data-testid="close-settings-button" aria-label={isEn ? 'Close settings' : '設定を閉じる'} className="origin-secondary-button inline-flex h-11 w-11 items-center justify-center rounded-xl border"><X className="h-5 w-5" aria-hidden="true" /></button></div>
          <div data-testid="settings-scroll-region" className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-5 pb-7">
            <section aria-labelledby="language-heading" className="space-y-3"><h3 id="language-heading" className="flex items-center gap-2 text-sm font-bold"><Globe className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />{isEn ? 'Language' : '表示言語'}</h3><div className="grid grid-cols-2 gap-2">{[{ id: 'ja', label: '日本語' }, { id: 'en', label: 'English' }].map((language) => { const selected = settings.language === language.id; return <button type="button" key={language.id} onClick={() => update({ language: language.id as Settings['language'] })} aria-pressed={selected} className={cn('flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition', selected ? 'origin-primary-button border-transparent' : 'origin-secondary-button')}>{selected && <Check className="h-4 w-4" aria-hidden="true" />}{language.label}</button>; })}</div></section>
            <section aria-labelledby="appearance-heading" className="space-y-3 border-t border-[var(--border-default)] pt-5"><h3 id="appearance-heading" className="text-sm font-bold">{isEn ? 'Appearance' : '画面の明るさ'}</h3><div className="grid grid-cols-3 gap-2">{[{ id: 'light', label: isEn ? 'Light' : '明るい', icon: Sun }, { id: 'dark', label: isEn ? 'Dark' : '暗い', icon: Moon }, { id: 'system', label: isEn ? 'System' : 'システム設定', icon: Laptop }].map((theme) => { const selected = selectedTheme === theme.id; return <button type="button" key={theme.id} onClick={() => update({ selectedTheme: theme.id as Settings['selectedTheme'] })} aria-pressed={selected} className={cn('flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-1 text-xs font-semibold transition', selected ? 'origin-primary-button border-transparent' : 'origin-secondary-button')}><theme.icon className="h-4 w-4" aria-hidden="true" />{theme.label}</button>; })}</div><p className="origin-muted text-[13px] leading-5">{isEn ? 'System follows your device setting immediately and keeps every surface in sync.' : 'システム設定では端末の明るさに即時追従し、すべての画面要素を同じテーマで表示します。'}</p></section>
            <section aria-labelledby="history-heading" className="space-y-3 border-t border-[var(--border-default)] pt-5"><h3 id="history-heading" className="text-sm font-bold">{isEn ? 'Conversation history' : '会話履歴'}</h3><p className="origin-muted text-[13px] leading-5">{isEn ? `${messageCount} messages are currently held in this browser tab.` : `このブラウザーの会話は現在 ${messageCount} 件です。`}</p><input ref={importInputRef} type="file" accept="application/json,.json" className="sr-only" aria-label={isEn ? 'Choose conversation history file' : '会話履歴ファイルを選択'} onChange={(event) => void handleImport(event)} /><div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><button type="button" onClick={onExportHistory} className="origin-secondary-button inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold"><Download className="h-4 w-4" aria-hidden="true" />{isEn ? 'Export' : '書き出す'}</button><button type="button" onClick={() => importInputRef.current?.click()} className="origin-secondary-button inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold"><Upload className="h-4 w-4" aria-hidden="true" />{isEn ? 'Import' : '読み込む'}</button><button type="button" onClick={resetHistory} className="origin-danger-button inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold"><RotateCcw className="h-4 w-4" aria-hidden="true" />{isEn ? 'Clear' : '初期化'}</button></div><p role="status" aria-live="polite" className={cn('text-[13px] leading-5', historyStatus.kind === 'error' ? 'text-[var(--danger)]' : 'origin-muted')}>{historyStatus.kind === 'idle' ? (isEn ? 'Export uses a portable JSON file. Imported files are checked before use.' : '書き出しは持ち運び可能なJSON形式です。読み込み前に内容を検証します。') : historyStatus.message}</p></section>
            <section data-testid="origin-execution-policy" aria-labelledby="safety-heading" className="space-y-3 border-t border-[var(--border-default)] pt-5"><h3 id="safety-heading" className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />{isEn ? 'Safety and cost' : '安全と費用'}</h3><div className="rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-4 text-sm leading-6 text-[var(--accent-primary)]"><p className="font-bold">{isEn ? 'This release uses free AI only.' : 'この版は無料AIだけを使います。'}</p><p className="mt-1 text-[13px] leading-5">{isEn ? '$0.00 maximum · fixed free model · no automatic switching.' : '$0.00上限・無料モデル固定・自動切替なし。'}</p></div><p className="origin-muted text-[13px] leading-5">{isEn ? 'Do not enter passwords, API keys, tokens, or private keys here or in chat.' : 'パスワード、APIキー、トークン、秘密鍵を設定画面やチャットへ入力しないでください。'}</p></section>
            <section data-testid="release-identity" aria-labelledby="release-identity-heading" className="space-y-3 border-t border-[var(--border-default)] pt-5"><h3 id="release-identity-heading" className="flex items-center gap-2 text-sm font-bold"><Info className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />{isEn ? 'Technical information' : '技術情報'}</h3><div className="origin-surface-muted rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="origin-muted text-[13px] font-semibold">{isEn ? 'Release ID' : 'リリースID'}</p>{releaseIdentity.status === 'loading' && <p role="status" className="origin-muted mt-1 text-sm">{isEn ? 'Checking…' : '確認中…'}</p>}{releaseIdentity.status === 'unavailable' && <p role="status" className="mt-1 text-sm font-semibold text-[var(--danger)]">{isEn ? 'Could not verify' : '確認できません'}</p>}{releaseIdentity.status === 'ready' && <code data-testid="release-sha-value" className="mt-1 block max-w-full break-all text-sm font-semibold">{showFullReleaseSha ? releaseIdentity.sha : `${releaseIdentity.sha.slice(0, 12)}…`}</code>}</div>{releaseIdentity.status === 'ready' && <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setShowFullReleaseSha((current) => !current)} aria-expanded={showFullReleaseSha} className="origin-secondary-button rounded-xl border px-3 text-[13px] font-semibold">{showFullReleaseSha ? (isEn ? 'Shorten' : '短く表示') : (isEn ? 'Show full ID' : '全文を表示')}</button><button type="button" onClick={() => void copyReleaseSha()} className="origin-secondary-button inline-flex items-center gap-1.5 rounded-xl border px-3 text-[13px] font-semibold">{copyStatus === 'success' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}{copyStatus === 'success' ? (isEn ? 'Copied' : 'コピー済み') : (isEn ? 'Copy' : 'コピー')}</button></div>}</div><p aria-live="polite" className="origin-muted mt-2 text-[13px] leading-5">{copyStatus === 'error' ? (isEn ? 'Could not copy the release ID.' : 'リリースIDをコピーできませんでした。') : (isEn ? 'Use this ID when checking which version is running.' : '現在動いている版を確認するときに使用します。')}</p></div></section>
          </div>
          <div className="safe-area-bottom origin-surface-muted shrink-0 border-t border-[var(--border-default)] px-4 pt-4"><button type="button" onClick={onClose} className="origin-primary-button w-full rounded-xl px-4 text-sm font-semibold">{isEn ? 'Close' : '閉じる'}</button></div>
        </motion.div>
      </div>}
    </AnimatePresence>
  );
}
