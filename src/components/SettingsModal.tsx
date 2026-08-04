import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Copy,
  Globe,
  Info,
  Moon,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import type { Settings } from '../types';
import { cn } from '../utils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  updateSettings: (settings: Settings) => void;
}

const FULL_RELEASE_SHA = /^[0-9a-f]{40}$/i;

type ReleaseIdentity =
  | { status: 'loading' }
  | { status: 'ready'; sha: string }
  | { status: 'unavailable' };

export default function SettingsModal({ isOpen, onClose, settings, updateSettings }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [releaseIdentity, setReleaseIdentity] = useState<ReleaseIdentity>({ status: 'loading' });
  const [showFullReleaseSha, setShowFullReleaseSha] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const isEn = settings.language === 'en';
  const selectedTheme = settings.selectedTheme === 'light' ? 'light' : 'dark';

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;
      const dialog = closeButtonRef.current?.closest('[role="dialog"]');
      const focusable = dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const controller = new AbortController();
    let active = true;
    const timeoutId = window.setTimeout(() => {
      if (!active) return;
      controller.abort();
      setReleaseIdentity({ status: 'unavailable' });
    }, 5_000);
    setReleaseIdentity({ status: 'loading' });
    setShowFullReleaseSha(false);
    setCopyStatus('idle');

    void (async () => {
      try {
        const response = await fetch('/api/health', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('release identity request failed');

        const payload: unknown = await response.json();
        const releaseSha = payload && typeof payload === 'object' && 'releaseSha' in payload
          ? (payload as { releaseSha?: unknown }).releaseSha
          : undefined;
        if (typeof releaseSha !== 'string' || !FULL_RELEASE_SHA.test(releaseSha)) {
          throw new Error('release identity is invalid');
        }

        if (active) {
          window.clearTimeout(timeoutId);
          setReleaseIdentity({ status: 'ready', sha: releaseSha.toLowerCase() });
        }
      } catch {
        if (active) {
          window.clearTimeout(timeoutId);
          setReleaseIdentity({ status: 'unavailable' });
        }
      }
    })();

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [isOpen]);

  const update = (patch: Partial<Settings>) => {
    updateSettings({ ...settings, ...patch });
  };

  const copyReleaseSha = async () => {
    if (releaseIdentity.status !== 'ready') return;
    setCopyStatus('idle');
    try {
      await navigator.clipboard.writeText(releaseIdentity.sha);
      setCopyStatus('success');
    } catch {
      setCopyStatus('error');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex min-h-0 items-center justify-center overflow-hidden p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
          aria-describedby="settings-description"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-950/65 backdrop-blur-[2px]"
            aria-hidden="true"
          />

          <motion.div
            data-testid="settings-modal"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-origin-border bg-origin-surface text-origin-ink shadow-xl sm:max-h-[calc(100dvh-2rem)]"
          >
            <div className="flex items-center justify-between border-b border-origin-border px-5 py-4">
              <div>
                <h2 id="settings-title" className="text-base font-bold text-origin-ink">
                  {isEn ? 'Settings' : '設定'}
                </h2>
                <p id="settings-description" className="mt-1 text-[13px] text-origin-muted">
                  {isEn ? 'Changes are saved automatically.' : '変更は自動で保存されます。'}
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                data-testid="close-settings-button"
                aria-label={isEn ? 'Close settings' : '設定を閉じる'}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-origin-muted outline-none transition hover:bg-origin-surface-muted hover:text-origin-ink focus-visible:ring-2 focus-visible:ring-origin-brand focus-visible:ring-offset-2 focus-visible:ring-offset-origin-surface"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div data-testid="settings-scroll-region" className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-5 pb-7">
              <section aria-labelledby="language-heading" className="space-y-3">
                <h3 id="language-heading" className="flex items-center gap-2 text-sm font-bold text-origin-ink">
                  <Globe className="h-4 w-4 text-origin-brand" aria-hidden="true" />
                  {isEn ? 'Language' : '表示言語'}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'ja', label: '日本語' },
                    { id: 'en', label: 'English' },
                  ].map((language) => {
                    const selected = settings.language === language.id;
                    return (
                      <button
                        type="button"
                        key={language.id}
                        onClick={() => update({ language: language.id as Settings['language'] })}
                        aria-pressed={selected}
                        className={cn(
                          'flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition',
                          selected
                            ? 'border-origin-brand bg-origin-brand text-origin-paper'
                            : 'border-origin-control bg-origin-surface text-origin-ink hover:bg-origin-surface-muted',
                        )}
                      >
                        {selected && <Check className="h-4 w-4" aria-hidden="true" />}
                        {language.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section aria-labelledby="appearance-heading" className="space-y-3 border-t border-origin-border pt-5">
                <h3 id="appearance-heading" className="text-sm font-bold text-origin-ink">
                  {isEn ? 'Appearance' : '画面の明るさ'}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'light', label: isEn ? 'Light' : '明るい', icon: Sun },
                    { id: 'dark', label: isEn ? 'Dark' : '暗い', icon: Moon },
                  ].map((theme) => {
                    const selected = selectedTheme === theme.id;
                    return (
                      <button
                        type="button"
                        key={theme.id}
                        onClick={() => update({ selectedTheme: theme.id as Settings['selectedTheme'] })}
                        aria-pressed={selected}
                        className={cn(
                          'flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition',
                          selected
                            ? 'border-origin-brand bg-origin-brand text-origin-paper'
                            : 'border-origin-control bg-origin-surface text-origin-ink hover:bg-origin-surface-muted',
                        )}
                      >
                        <theme.icon className="h-4 w-4" aria-hidden="true" />
                        {theme.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section
                data-testid="origin-execution-policy"
                aria-labelledby="safety-heading"
                className="space-y-3 border-t border-origin-border pt-5"
              >
                <h3 id="safety-heading" className="flex items-center gap-2 text-sm font-bold text-origin-ink">
                  <ShieldCheck className="h-4 w-4 text-origin-brand" aria-hidden="true" />
                  {isEn ? 'Safety and cost' : '安全と費用'}
                </h3>
                <div className="rounded-xl border border-origin-brand-border bg-origin-brand-soft p-4 text-sm leading-6 text-origin-brand">
                  <p className="font-bold">
                    {isEn ? 'This release uses free AI only.' : 'この版は無料AIだけを使います。'}
                  </p>
                  <p className="mt-1 text-[13px] leading-5">
                    {isEn
                      ? '$0.00 maximum · fixed free model · no automatic switching. If zero cost or the actual execution route cannot be verified, ORIGIN does not show an answer.'
                      : '$0.00上限・無料モデル固定・自動切替なし。無料であることや実際の実行先を確認できない場合、回答は表示しません。'}
                  </p>
                </div>
                <p className="text-[13px] leading-5 text-origin-muted">
                  {isEn
                    ? 'Provider credentials are managed on the server. Do not enter passwords, API keys, tokens, or private keys here or in chat.'
                    : '接続用の認証情報はサーバーで管理します。パスワード、APIキー、トークン、秘密鍵を設定画面やチャットへ入力しないでください。'}
                </p>
              </section>

              <section
                data-testid="release-identity"
                aria-labelledby="release-identity-heading"
                className="space-y-3 border-t border-origin-border pt-5"
              >
                <h3 id="release-identity-heading" className="flex items-center gap-2 text-sm font-bold text-origin-ink">
                  <Info className="h-4 w-4 text-origin-brand" aria-hidden="true" />
                  {isEn ? 'Technical information' : '技術情報'}
                </h3>
                <div className="rounded-xl border border-origin-border bg-origin-surface-muted p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-origin-muted">
                        {isEn ? 'Release ID' : 'リリースID'}
                      </p>
                      {releaseIdentity.status === 'loading' && (
                        <p role="status" className="mt-1 text-sm text-origin-muted">
                          {isEn ? 'Checking…' : '確認中…'}
                        </p>
                      )}
                      {releaseIdentity.status === 'unavailable' && (
                        <p role="status" className="mt-1 inline-flex rounded-lg bg-red-100 px-2.5 py-1 text-[13px] font-semibold text-red-800 dark:bg-red-950/50 dark:text-red-300">
                          {isEn ? 'Could not verify' : '確認できません'}
                        </p>
                      )}
                      {releaseIdentity.status === 'ready' && (
                        <code data-testid="release-sha-value" className="mt-1 block max-w-full break-all text-sm font-semibold text-origin-ink">
                          {showFullReleaseSha
                            ? releaseIdentity.sha
                            : `${releaseIdentity.sha.slice(0, 12)}…`}
                        </code>
                      )}
                    </div>

                    {releaseIdentity.status === 'ready' && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setShowFullReleaseSha((current) => !current)}
                          aria-expanded={showFullReleaseSha}
                          className="min-h-11 rounded-xl border border-origin-control bg-origin-surface px-3 text-[13px] font-semibold text-origin-ink outline-none transition hover:bg-origin-surface-muted focus-visible:ring-2 focus-visible:ring-origin-brand"
                        >
                          {showFullReleaseSha
                            ? (isEn ? 'Shorten' : '短く表示')
                            : (isEn ? 'Show full ID' : '全文を表示')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyReleaseSha()}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-origin-control bg-origin-surface px-3 text-[13px] font-semibold text-origin-ink outline-none transition hover:bg-origin-surface-muted focus-visible:ring-2 focus-visible:ring-origin-brand"
                        >
                          {copyStatus === 'success'
                            ? <Check className="h-4 w-4" aria-hidden="true" />
                            : <Copy className="h-4 w-4" aria-hidden="true" />}
                          {copyStatus === 'success'
                            ? (isEn ? 'Copied' : 'コピー済み')
                            : (isEn ? 'Copy' : 'コピー')}
                        </button>
                      </div>
                    )}
                  </div>
                  <p aria-live="polite" className="mt-2 text-[13px] leading-5 text-origin-muted">
                    {copyStatus === 'error'
                      ? (isEn ? 'Could not copy the release ID.' : 'リリースIDをコピーできませんでした。')
                      : (isEn
                        ? 'Use this ID when checking which version is running.'
                        : '現在動いている版を確認するときに使用します。')}
                  </p>
                </div>
              </section>
            </div>

            <div className="safe-area-bottom shrink-0 border-t border-origin-border bg-origin-surface-muted px-4 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 w-full rounded-xl bg-origin-brand px-4 text-sm font-semibold text-origin-paper outline-none transition hover:bg-origin-brand-hover focus-visible:ring-2 focus-visible:ring-origin-brand focus-visible:ring-offset-2 focus-visible:ring-offset-origin-surface"
              >
                {isEn ? 'Close' : '閉じる'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
