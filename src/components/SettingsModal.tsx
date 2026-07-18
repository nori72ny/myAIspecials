import { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Settings } from "../types";
import {
  X,
  Cpu,
  Check,
  AlertTriangle,
  Code,
  Globe,
  Palette,
  DollarSign,
  Clock,
} from "lucide-react";
import { cn } from "../utils";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  updateSettings: (settings: Settings) => void;
}

export default function SettingsModal({ isOpen, onClose, settings, updateSettings }: Props) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    if (isOpen) window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const isEn = settings.language === "en";

  const handleKeyDownHelper = (event: React.KeyboardEvent, action: () => void) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      action();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
          />

          <motion.div
            data-testid="settings-modal"
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative w-full max-w-xl overflow-hidden bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-neutral-800 text-gray-900 dark:text-neutral-100 flex flex-col my-8"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-900/50">
              <h2
                id="settings-title"
                className="text-sm font-black text-gray-800 dark:text-neutral-200 flex items-center gap-2 tracking-wide"
              >
                <Cpu className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                {isEn ? "ORIGIN Personal Settings" : "ORIGIN Personal 設定"}
              </h2>
              <button
                type="button"
                onClick={onClose}
                data-testid="close-settings-button"
                aria-label={isEn ? "Close settings" : "設定を閉じる"}
                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-neutral-300 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-neutral-850"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[500px] overflow-y-auto">
              <section className="space-y-3" data-testid="origin-execution-policy">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-indigo-500" />
                  {isEn ? "AI Execution Policy" : "AI実行ポリシー"}
                </h3>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                      <Check className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100">
                        {isEn ? "ORIGIN selects automatically within free-only rules" : "無料限定ルール内でORIGINが自動選択します"}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-emerald-800 dark:text-emerald-200">
                        {isEn
                          ? "The current personal preview permits only an explicitly free model. Paid models, automatic model routers, and cross-provider fallback are disabled."
                          : "現在の個人版プレビューは、明示的に無料と確認できるモデルだけを使用します。有料モデル、自動モデルルーター、別プロバイダーへの自動フォールバックは無効です。"}
                      </p>
                    </div>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-gray-500 dark:text-neutral-400">
                  {isEn
                    ? "Provider selection is not a user setting in this phase. The server-side execution policy makes the final decision and fails closed when no eligible free provider is configured."
                    : "この段階では、利用者がプロバイダーを選択する設定はありません。サーバー側の実行ポリシーが最終判断し、条件を満たす無料プロバイダーがなければ実行を停止します。"}
                </p>
              </section>

              <section className="space-y-3 pt-2 border-t border-gray-100 dark:border-neutral-800">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Palette className="w-3.5 h-3.5 text-indigo-500" />
                  {isEn ? "Visual Theme" : "表示テーマ"}
                </h3>

                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "dark", label: isEn ? "Cosmic Slate" : "Cosmic（ダーク）", desc: isEn ? "Deep slate dark theme" : "深い濃紺のダークテーマ" },
                    { id: "light", label: isEn ? "Classic Slate" : "Slate（ライト）", desc: isEn ? "Readable light theme" : "可読性を重視したライトテーマ" },
                    { id: "oled", label: isEn ? "Pitch Black" : "OLED（漆黒）", desc: isEn ? "High-contrast black theme" : "高コントラストの黒テーマ" },
                    { id: "retro", label: isEn ? "Phosphor Retro" : "Retro（緑色端末）", desc: isEn ? "Monochrome terminal theme" : "クラシックな端末風テーマ" },
                  ].map((theme) => {
                    const isSelected = (settings.selectedTheme || "dark") === theme.id;
                    return (
                      <div
                        key={theme.id}
                        role="radio"
                        aria-checked={isSelected}
                        tabIndex={0}
                        onClick={() => updateSettings({ ...settings, selectedTheme: theme.id as Settings["selectedTheme"] })}
                        onKeyDown={(event) => handleKeyDownHelper(event, () => updateSettings({ ...settings, selectedTheme: theme.id as Settings["selectedTheme"] }))}
                        className={cn(
                          "p-2.5 rounded-xl border text-left cursor-pointer transition-all select-none focus:outline-none focus:ring-2 focus:ring-indigo-500",
                          isSelected
                            ? "ring-2 ring-indigo-500 scale-[1.02] shadow-sm"
                            : "opacity-80 hover:opacity-100 border-gray-200 dark:border-neutral-800",
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold">{theme.label}</span>
                          {isSelected && <span className="w-2 h-2 rounded-full bg-indigo-500" />}
                        </div>
                        <p className="text-[9px] text-gray-500 dark:text-neutral-400 mt-0.5">{theme.desc}</p>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="space-y-3 pt-2 border-t border-gray-100 dark:border-neutral-800">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-indigo-500" />
                  {isEn ? "Language" : "表示言語"}
                </h3>

                <div className="flex gap-2">
                  {[
                    { id: "ja", name: "日本語 (JA)" },
                    { id: "en", name: "English (EN)" },
                  ].map((language) => {
                    const isSelected = settings.language === language.id;
                    return (
                      <button
                        type="button"
                        key={language.id}
                        onClick={() => updateSettings({ ...settings, language: language.id as Settings["language"] })}
                        aria-pressed={isSelected}
                        className={cn(
                          "flex-1 py-2 px-3 text-xs font-bold rounded-xl border transition-all cursor-pointer",
                          isSelected
                            ? "bg-indigo-600 border-indigo-700 text-white shadow-sm"
                            : "bg-white dark:bg-neutral-800 border-gray-200 dark:border-neutral-700 text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-750",
                        )}
                      >
                        {language.name}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="space-y-3 pt-2 border-t border-gray-100 dark:border-neutral-800">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-indigo-500" />
                  {isEn ? "Cost Policy" : "コストポリシー"}
                </h3>
                <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/60">
                  <div>
                    <p className="text-xs font-bold text-gray-800 dark:text-neutral-100">
                      {isEn ? "Hard execution ceiling" : "実行時の上限"}
                    </p>
                    <p className="mt-1 text-[10px] leading-4 text-gray-500 dark:text-neutral-400">
                      {isEn
                        ? "Any plan with an estimated cost above zero is rejected before execution. Paid approval is not implemented yet."
                        : "見積額が0円を超える計画は実行前に拒否します。有料実行の承認機能はまだ実装していません。"}
                    </p>
                  </div>
                  <span className="ml-4 shrink-0 rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                    $0.00
                  </span>
                </div>
              </section>

              <section className="space-y-3 pt-2 border-t border-gray-100 dark:border-neutral-800">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-indigo-500" />
                  {isEn ? "Request Timeout" : "応答タイムアウト"}
                </h3>
                <label className="block text-[11px] font-bold text-gray-600 dark:text-neutral-300">
                  {isEn ? "Maximum waiting time" : "最大待機時間"}
                  <select
                    value={settings.timeoutSeconds || 30}
                    onChange={(event) => updateSettings({ ...settings, timeoutSeconds: Number.parseInt(event.target.value, 10) })}
                    className="mt-1 w-full text-xs font-medium p-2 rounded-xl bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 text-gray-800 dark:text-neutral-200 focus:outline-none focus:border-indigo-500"
                  >
                    {[10, 20, 30, 45, 60].map((seconds) => (
                      <option key={seconds} value={seconds}>{seconds} {isEn ? "seconds" : "秒"}</option>
                    ))}
                  </select>
                </label>
                <p className="text-[10px] leading-4 text-gray-500 dark:text-neutral-400">
                  {isEn
                    ? "This value is sent to the authoritative server execution policy. ORIGIN does not automatically retry or switch providers in this phase."
                    : "この値はサーバー側の正式な実行ポリシーへ送られます。この段階では自動再試行や別プロバイダーへの切替は行いません。"}
                </p>
              </section>

              <section className="space-y-3 pt-2 border-t border-gray-100 dark:border-neutral-800">
                <div
                  role="checkbox"
                  aria-checked={Boolean(settings.developerMode)}
                  tabIndex={0}
                  onClick={() => updateSettings({ ...settings, developerMode: !settings.developerMode })}
                  onKeyDown={(event) => handleKeyDownHelper(event, () => updateSettings({ ...settings, developerMode: !settings.developerMode }))}
                  className={cn(
                    "flex items-start justify-between p-3.5 rounded-xl border transition-all select-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500",
                    settings.developerMode
                      ? "bg-indigo-50/40 dark:bg-indigo-950/10 border-indigo-200 dark:border-indigo-900/50 hover:bg-indigo-50/60"
                      : "bg-white dark:bg-neutral-850 border-gray-200 dark:border-neutral-800 hover:bg-gray-50",
                  )}
                >
                  <div className="flex gap-3">
                    <span className="text-xl bg-gray-100 dark:bg-neutral-800 w-10 h-10 rounded-lg flex items-center justify-center border border-gray-200/50 dark:border-neutral-700/30">
                      <Code className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    </span>
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-gray-900 dark:text-neutral-100">
                        {isEn ? "Technical Details" : "技術詳細表示"}
                      </span>
                      <p className="text-[10px] text-gray-500 dark:text-neutral-400 max-w-[320px]">
                        {isEn
                          ? "Shows additional local diagnostics and execution metadata. This switch does not enable paid execution or external telemetry."
                          : "ローカル診断情報と実行メタデータの表示を増やします。この切替だけで有料実行や外部テレメトリーが有効になることはありません。"}
                      </p>
                    </div>
                  </div>
                  <span className={cn(
                    "self-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold",
                    settings.developerMode
                      ? "bg-indigo-500 text-white border-indigo-600"
                      : "bg-gray-100 dark:bg-neutral-800 text-gray-400 dark:text-neutral-500 border-gray-200 dark:border-neutral-700",
                  )}>
                    {settings.developerMode ? "ON" : "OFF"}
                  </span>
                </div>
              </section>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-neutral-900/80 border-t border-gray-100 dark:border-neutral-800 flex items-start gap-2">
              <AlertTriangle className="mt-0.5 w-4 h-4 text-amber-500 shrink-0" />
              <p className="text-[10px] leading-4 text-gray-500 dark:text-neutral-400">
                {isEn
                  ? "The OpenRouter credential is managed only in the server environment. Never enter API keys, tokens, passwords, or private keys in chat or this settings screen."
                  : "OpenRouterの認証情報はサーバー環境だけで管理します。APIキー、トークン、パスワード、秘密鍵をチャットやこの設定画面へ入力しないでください。"}
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
