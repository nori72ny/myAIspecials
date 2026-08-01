import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Globe,
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

export default function SettingsModal({ isOpen, onClose, settings, updateSettings }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
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

  const update = (patch: Partial<Settings>) => {
    updateSettings({ ...settings, ...patch });
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
            className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-[1.25rem] border border-slate-200/90 bg-white text-slate-950 shadow-[0_24px_80px_rgba(15,23,42,0.24)] dark:border-white/10 dark:bg-neutral-950 dark:text-neutral-100 sm:max-h-[calc(100dvh-2rem)]"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-white/10">
              <div>
                <h2 id="settings-title" className="text-base font-bold">
                  {isEn ? 'Settings' : '設定'}
                </h2>
                <p id="settings-description" className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
                  {isEn ? 'Changes are saved automatically.' : '変更は自動で保存されます。'}
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                data-testid="close-settings-button"
                aria-label={isEn ? 'Close settings' : '設定を閉じる'}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-500 outline-none transition hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:hover:bg-white/10 dark:hover:text-white dark:focus-visible:ring-offset-neutral-950"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-5 pb-7">
              <section aria-labelledby="language-heading" className="space-y-3">
                <h3 id="language-heading" className="flex items-center gap-2 text-sm font-bold">
                  <Globe className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
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
                            ? 'border-indigo-700 bg-indigo-600 text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-white/5',
                        )}
                      >
                        {selected && <Check className="h-4 w-4" aria-hidden="true" />}
                        {language.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section aria-labelledby="appearance-heading" className="space-y-3 border-t border-slate-200 pt-5 dark:border-white/10">
                <h3 id="appearance-heading" className="text-sm font-bold">
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
                            ? 'border-indigo-700 bg-indigo-600 text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-white/5',
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
                className="space-y-3 border-t border-slate-200 pt-5 dark:border-white/10"
              >
                <h3 id="safety-heading" className="flex items-center gap-2 text-sm font-bold">
                  <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  {isEn ? 'Safety and cost' : '安全と費用'}
                </h3>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-100">
                  <p className="font-bold">
                    {isEn ? 'This release uses free AI only.' : 'この版は無料AIだけを使います。'}
                  </p>
                  <p className="mt-1 text-xs leading-5">
                    {isEn
                      ? '$0.00 maximum · fixed free model · no automatic switching. If zero cost or the actual execution route cannot be verified, ORIGIN does not show an answer.'
                      : '$0.00上限・無料モデル固定・自動切替なし。無料であることや実際の実行先を確認できない場合、回答は表示しません。'}
                  </p>
                </div>
                <p className="text-xs leading-5 text-slate-500 dark:text-neutral-400">
                  {isEn
                    ? 'Provider credentials are managed on the server. Do not enter passwords, API keys, tokens, or private keys here or in chat.'
                    : '接続用の認証情報はサーバーで管理します。パスワード、APIキー、トークン、秘密鍵を設定画面やチャットへ入力しないでください。'}
                </p>
              </section>
            </div>

            <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-white/10 dark:bg-neutral-900/70">
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 w-full rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white outline-none transition hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:bg-white dark:text-black dark:hover:bg-neutral-200 dark:focus-visible:ring-offset-neutral-900"
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
