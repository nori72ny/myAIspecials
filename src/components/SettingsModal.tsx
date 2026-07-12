import { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Settings, AIAgentConfig } from "../types";
import { 
  X, 
  Cpu, 
  Check, 
  AlertTriangle, 
  Code, 
  Globe, 
  Palette, 
  DollarSign, 
  RefreshCw, 
  Clock 
} from "lucide-react";
import { cn } from "../utils";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  updateSettings: (s: Settings) => void;
}

const AGENTS_LIST: AIAgentConfig[] = [
  { id: "gemini", name: "Gemini", description: "Googleの高精度・高速推論モデル（デフォルト有効）", icon: "♊", status: "active", provider: "Google" },
  { id: "openai", name: "OpenAI / OpenRouter", description: "GPT-4oおよびOpenRouter各種モデル（APIキー対応）", icon: "🟢", status: "active", provider: "OpenAI" },
  { id: "claude", name: "Claude (Anthropic)", description: "極めて高精度な日本語・コード生成。将来対応予定", icon: "🍁", status: "planned", provider: "Anthropic" },
  { id: "perplexity", name: "Perplexity AI", description: "リアルタイムWeb検索と連動した最新情報の収集。将来対応予定", icon: "🔍", status: "planned", provider: "Perplexity" },
  { id: "deepseek", name: "DeepSeek", description: "推論と構造化に特化した最新OSSモデル。将来対応予定", icon: "🐳", status: "planned", provider: "DeepSeek" },
];

export default function SettingsModal({ isOpen, onClose, settings, updateSettings }: Props) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const isEn = settings.language === "en";

  const toggleAgent = (agentId: string) => {
    const isSelected = settings.selectedAgents.includes(agentId);
    let updated: string[];
    if (isSelected) {
      if (settings.selectedAgents.length <= 1) return; // Don't allow deselecting all
      updated = settings.selectedAgents.filter(id => id !== agentId);
    } else {
      updated = [...settings.selectedAgents, agentId];
    }
    updateSettings({
      ...settings,
      selectedAgents: updated
    });
  };

  const handleKeyDownHelper = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
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
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
          />
          
          {/* Content Box */}
          <motion.div
            data-testid="settings-modal"
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative w-full max-w-xl overflow-hidden bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-neutral-800 text-gray-900 dark:text-neutral-100 flex flex-col my-8"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-900/50">
              <h2 
                id="settings-title"
                className="text-sm font-black text-gray-800 dark:text-neutral-200 flex items-center gap-2 tracking-wide"
              >
                <Cpu className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                {isEn ? "System Preferences & Hardware Config" : "システム環境 & 各種AI設定管理"}
              </h2>
              <button
                onClick={onClose}
                data-testid="close-settings-button"
                aria-label={isEn ? "Close settings" : "設定を閉じる"}
                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-neutral-300 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-neutral-850"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-6 space-y-6 max-h-[500px] overflow-y-auto">
              
              {/* SECTION 1: Providers (AI Agents) */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-indigo-500" />
                  {isEn ? "AI Provider Settings" : "AIプロバイダー連携設定"}
                </h3>
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  {isEn 
                    ? "Choose active artificial intelligence models. Gemini and OpenAI run simultaneously in the pipeline."
                    : "万能ワークスペースで使用するAIエージェントを有効化できます。GeminiとOpenAIが連動動作します。"}
                </p>

                <div className="space-y-2 pt-1">
                  {AGENTS_LIST.map((agent) => {
                    const isActive = settings.selectedAgents.includes(agent.id);
                    const isPlanned = agent.status === "planned";
                    
                    return (
                      <div
                        key={agent.id}
                        role="checkbox"
                        aria-checked={isActive}
                        aria-disabled={isPlanned}
                        tabIndex={isPlanned ? -1 : 0}
                        onClick={() => !isPlanned && toggleAgent(agent.id)}
                        onKeyDown={(e) => !isPlanned && handleKeyDownHelper(e, () => toggleAgent(agent.id))}
                        className={cn(
                          "flex items-start justify-between p-3 rounded-xl border transition-all select-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-neutral-900",
                          isPlanned 
                            ? "bg-gray-50/50 dark:bg-neutral-950/20 border-gray-100 dark:border-neutral-850 opacity-50 cursor-not-allowed" 
                            : isActive
                              ? "bg-indigo-50/40 dark:bg-indigo-950/10 border-indigo-200 dark:border-indigo-900/50 cursor-pointer hover:bg-indigo-50/60 dark:hover:bg-indigo-950/20"
                              : "bg-white dark:bg-neutral-850 border-gray-200 dark:border-neutral-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-neutral-800"
                        )}
                      >
                        <div className="flex gap-3">
                          <span className="text-lg bg-gray-100 dark:bg-neutral-800 w-9 h-9 rounded-lg flex items-center justify-center border border-gray-200/50 dark:border-neutral-700/30">
                            {agent.icon}
                          </span>
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-gray-900 dark:text-neutral-100">{agent.name}</span>
                              <span className="text-[9px] px-1.5 py-0.2 bg-gray-100 dark:bg-neutral-800 text-gray-500 dark:text-neutral-400 rounded font-medium">
                                {agent.provider}
                              </span>
                            </div>
                            <p className="text-[10px] text-gray-500 dark:text-neutral-400 max-w-[320px]">
                              {isEn && agent.id === "gemini" ? "Google's ultra-fast reasoning model (Active by default)" : agent.description}
                            </p>
                          </div>
                        </div>

                        {/* Switch indicator */}
                        <div className="flex items-center self-center pl-2">
                          {isPlanned ? (
                            <span className="text-[8px] bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-amber-900/30 px-2 py-0.5 rounded-full font-semibold">
                              {isEn ? "Planned" : "将来予定"}
                            </span>
                          ) : isActive ? (
                            <span className="flex items-center gap-1 text-[9px] bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-900/30 px-2 py-0.5 rounded-full font-bold">
                              <Check className="w-3 h-3" />
                              {isEn ? "Active" : "有効"}
                            </span>
                          ) : (
                            <span className="text-[9px] bg-gray-100 dark:bg-neutral-800 text-gray-400 dark:text-neutral-500 border border-gray-200 dark:border-neutral-700 px-2 py-0.5 rounded-full font-medium">
                              {isEn ? "Disabled" : "無効"}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* SECTION 2: Themes & Visual Styles */}
              <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-neutral-800">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Palette className="w-3.5 h-3.5 text-indigo-500" />
                  {isEn ? "Visual Theme Settings" : "ビジュアルテーマ設定"}
                </h3>
                
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "dark", label: isEn ? "Cosmic Slate (Dark)" : "Cosmic (宇宙ダーク)", desc: "宇宙をイメージした深みのある濃紺", style: "bg-slate-900 border-slate-800 text-white" },
                    { id: "light", label: isEn ? "Classic Slate (Light)" : "Slate (クラシックライト)", desc: "可読性に優れたオフホワイト調", style: "bg-slate-50 border-slate-200 text-slate-800" },
                    { id: "oled", label: isEn ? "Pitch Black (OLED)" : "OLED (コントラスト極大)", desc: "完全漆黒のハイコントラスト液晶向け", style: "bg-black border-neutral-900 text-white" },
                    { id: "retro", label: isEn ? "Phosphor Retro (Mono)" : "Retro (緑色端末)", desc: "クラシックなPC/緑色リン光モニター調", style: "bg-neutral-950 border-emerald-950 text-emerald-400 font-mono" }
                  ].map((theme) => {
                    const isSelected = (settings.selectedTheme || "dark") === theme.id;
                    return (
                      <div
                        key={theme.id}
                        role="radio"
                        aria-checked={isSelected}
                        tabIndex={0}
                        onClick={() => updateSettings({ ...settings, selectedTheme: theme.id as any })}
                        onKeyDown={(e) => handleKeyDownHelper(e, () => updateSettings({ ...settings, selectedTheme: theme.id as any }))}
                        className={cn(
                          "p-2.5 rounded-xl border text-left cursor-pointer transition-all select-none focus:outline-none focus:ring-2 focus:ring-indigo-500",
                          isSelected 
                            ? "ring-2 ring-indigo-500 scale-[1.02] shadow-sm" 
                            : "opacity-80 hover:opacity-100 border-gray-200 dark:border-neutral-800"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold">{theme.label}</span>
                          {isSelected && <span className="w-2 h-2 rounded-full bg-indigo-500"></span>}
                        </div>
                        <p className="text-[9px] text-gray-500 dark:text-neutral-400 mt-0.5">{theme.desc}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* SECTION 3: Language Preference */}
              <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-neutral-800">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-indigo-500" />
                  {isEn ? "System Language" : "システム言語設定"}
                </h3>
                
                <div className="flex gap-2">
                  {[
                    { id: "ja", name: "日本語 (JA)" },
                    { id: "en", name: "English (EN)" }
                  ].map((lang) => {
                    const isSelected = settings.language === lang.id;
                    return (
                      <button
                        key={lang.id}
                        onClick={() => updateSettings({ ...settings, language: lang.id as any })}
                        aria-pressed={isSelected}
                        className={cn(
                          "flex-1 py-2 px-3 text-xs font-bold rounded-xl border transition-all cursor-pointer",
                          isSelected 
                            ? "bg-indigo-600 border-indigo-700 text-white shadow-sm" 
                            : "bg-white dark:bg-neutral-800 border-gray-200 dark:border-neutral-700 text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-750"
                        )}
                      >
                        {lang.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* SECTION 4: Cost Management */}
              <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-neutral-800">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-indigo-500" />
                  {isEn ? "Cost Limit settings" : "自動実行コスト抑制設定"}
                </h3>
                <p className="text-[11px] text-gray-500 dark:text-neutral-400">
                  {isEn 
                    ? "Prevent excessive API costs. Limits cumulative token consumption per execution."
                    : "1回のミッション解析あたり、過度のトークン消費を防ぐ最大予算（USD）の上限値です。"}
                </p>
                <div className="flex items-center gap-4">
                  <input 
                    type="range"
                    min="0.10"
                    max="10.00"
                    step="0.10"
                    value={settings.maxCostCap || 1.00}
                    onChange={(e) => updateSettings({ ...settings, maxCostCap: parseFloat(e.target.value) })}
                    className="flex-1 accent-indigo-600 h-1.5 bg-gray-200 dark:bg-neutral-800 rounded-lg cursor-pointer"
                    aria-label={isEn ? "Maximum cost cap in USD" : "最大消費コスト上限（米ドル）"}
                  />
                  <div className="w-16 text-right shrink-0">
                    <span className="text-xs font-black text-indigo-600 dark:text-indigo-400">
                      ${(settings.maxCostCap || 1.00).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* SECTION 5: High Availability & Error Recovery */}
              <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-neutral-800">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 text-indigo-500" />
                  {isEn ? "High Availability & Error Recovery" : "高可用性・エラー回復設定"}
                </h3>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-gray-600 dark:text-neutral-300 flex items-center gap-1">
                      <RefreshCw className="w-3 h-3 text-gray-400" />
                      {isEn ? "Auto Retry Count" : "自動再試行回数"}
                    </label>
                    <select
                      value={settings.retryCount || 3}
                      onChange={(e) => updateSettings({ ...settings, retryCount: parseInt(e.target.value) })}
                      className="w-full text-xs font-medium p-2 rounded-xl bg-white dark:bg-neutral-800 border border-gray-250 dark:border-neutral-700 text-gray-800 dark:text-neutral-200 focus:outline-none focus:border-indigo-500"
                    >
                      {[1, 2, 3, 5].map(n => (
                        <option key={n} value={n}>{n} {isEn ? "Attempts" : "回"}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-gray-600 dark:text-neutral-300 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-gray-400" />
                      {isEn ? "Request Timeout" : "プロバイダータイムアウト"}
                    </label>
                    <select
                      value={settings.timeoutSeconds || 30}
                      onChange={(e) => updateSettings({ ...settings, timeoutSeconds: parseInt(e.target.value) })}
                      className="w-full text-xs font-medium p-2 rounded-xl bg-white dark:bg-neutral-800 border border-gray-250 dark:border-neutral-700 text-gray-800 dark:text-neutral-200 focus:outline-none focus:border-indigo-500"
                    >
                      {[10, 20, 30, 45, 60].map(s => (
                        <option key={s} value={s}>{s} {isEn ? "Seconds" : "秒"}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* SECTION 6: Developer Settings */}
              <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-neutral-800">
                <div
                  role="checkbox"
                  aria-checked={settings.developerMode}
                  tabIndex={0}
                  onClick={() => updateSettings({ ...settings, developerMode: !settings.developerMode })}
                  onKeyDown={(e) => handleKeyDownHelper(e, () => updateSettings({ ...settings, developerMode: !settings.developerMode }))}
                  className={cn(
                    "flex items-start justify-between p-3.5 rounded-xl border transition-all select-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500",
                    settings.developerMode
                      ? "bg-indigo-50/40 dark:bg-indigo-950/10 border-indigo-200 dark:border-indigo-900/50 hover:bg-indigo-50/60"
                      : "bg-white dark:bg-neutral-850 border-gray-200 dark:border-neutral-800 hover:bg-gray-50"
                  )}
                >
                  <div className="flex gap-3">
                    <span className="text-xl bg-gray-100 dark:bg-neutral-800 w-10 h-10 rounded-lg flex items-center justify-center border border-gray-200/50 dark:border-neutral-700/30">
                      <Code className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    </span>
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-gray-900 dark:text-neutral-100">
                        {isEn ? "Developer Mode" : "デベロッパーモード"}
                      </span>
                      <p className="text-[10px] text-gray-500 dark:text-neutral-400 max-w-[320px]">
                        {isEn
                          ? "Enables live telemetry, debug console, and detailed performance metrics across the OS."
                          : "システム全体のライブテレメトリー、詳細ログ、デバッグコンソール表示を有効化します。"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center self-center pl-2">
                    {settings.developerMode ? (
                      <span className="flex items-center gap-1 text-[10px] bg-indigo-500 text-white border border-indigo-600 px-2.5 py-0.5 rounded-full font-bold">
                        ON
                      </span>
                    ) : (
                      <span className="text-[10px] bg-gray-100 dark:bg-neutral-800 text-gray-400 dark:text-neutral-500 border border-gray-200 dark:border-neutral-700 px-2.5 py-0.5 rounded-full font-medium">
                        OFF
                      </span>
                    )}
                  </div>
                </div>
              </div>

            </div>
            
            {/* Footer */}
            <div className="p-4 bg-gray-50 dark:bg-neutral-900/80 border-t border-gray-100 dark:border-neutral-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <p className="text-[10px] text-gray-500 dark:text-neutral-400">
                {isEn
                  ? "※ Upstream OpenRouter/OpenAI API routing relies on administrative api keys defined in secret configurations."
                  : "※ OpenAI / OpenRouterエージェントの利用には、管理者パネルでのAPIキー（OPENAI_API_KEY）の設定が必要です。"}
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
