import { motion, AnimatePresence } from "motion/react";
import { Settings, AIAgentConfig } from "../types";
import { X, Cpu, Check, AlertTriangle, Code } from "lucide-react";
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
  const toggleAgent = (agentId: string) => {
    const isSelected = settings.selectedAgents.includes(agentId);
    let updated: string[];
    if (isSelected) {
      // Don't allow deselecting everything
      if (settings.selectedAgents.length <= 1) return;
      updated = settings.selectedAgents.filter(id => id !== agentId);
    } else {
      updated = [...settings.selectedAgents, agentId];
    }
    updateSettings({
      ...settings,
      selectedAgents: updated
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative w-full max-w-lg overflow-hidden bg-white rounded-2xl shadow-2xl border border-gray-200 text-gray-900"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
              <h2 className="text-sm font-bold text-gray-800 flex items-center gap-2 tracking-wide">
                <Cpu className="w-5 h-5 text-indigo-600" />
                AIエージェント管理 & 連携設定
              </h2>
              <button
                onClick={onClose}
                className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors rounded-full hover:bg-gray-100"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4 max-h-[400px] overflow-y-auto">
              <p className="text-xs text-gray-500 leading-relaxed">
                万能AIワークスペースで使用するAIエージェントを有効・無効化できます。現在はGeminiとOpenAI/OpenRouterモデルが同時並列で稼働し、双方の強みを統合します。
              </p>

              <div className="space-y-3 pt-2">
                {AGENTS_LIST.map((agent) => {
                  const isActive = settings.selectedAgents.includes(agent.id);
                  const isPlanned = agent.status === "planned";
                  
                  return (
                    <div
                      key={agent.id}
                      onClick={() => !isPlanned && toggleAgent(agent.id)}
                      className={cn(
                        "flex items-start justify-between p-3.5 rounded-xl border transition-all select-none",
                        isPlanned 
                          ? "bg-gray-50/50 border-gray-100 opacity-60 cursor-not-allowed" 
                          : isActive
                            ? "bg-indigo-50/40 border-indigo-200 cursor-pointer hover:bg-indigo-50/60"
                            : "bg-white border-gray-200 cursor-pointer hover:bg-gray-50"
                      )}
                    >
                      <div className="flex gap-3">
                        <span className="text-xl bg-gray-100 w-10 h-10 rounded-lg flex items-center justify-center border border-gray-200/50">
                          {agent.icon}
                        </span>
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-900">{agent.name}</span>
                            <span className="text-[10px] px-1.5 py-0.2 bg-gray-100 text-gray-500 rounded font-medium">
                              {agent.provider}
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 max-w-[280px]">
                            {agent.description}
                          </p>
                        </div>
                      </div>

                      {/* Status switch/badge */}
                      <div className="flex items-center self-center pl-2">
                        {isPlanned ? (
                          <span className="text-[9px] bg-amber-50 text-amber-600 border border-amber-200/50 px-2 py-0.5 rounded-full font-semibold">
                            将来予定
                          </span>
                        ) : isActive ? (
                          <span className="flex items-center gap-1 text-[10px] bg-emerald-50 text-emerald-600 border border-emerald-200/50 px-2.5 py-0.5 rounded-full font-bold">
                            <Check className="w-3 h-3" />
                            有効
                          </span>
                        ) : (
                          <span className="text-[10px] bg-gray-100 text-gray-400 border border-gray-200 px-2.5 py-0.5 rounded-full font-medium">
                            無効
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Developer Mode Toggle */}
              <div className="pt-4 border-t border-gray-100">
                <div
                  onClick={() => updateSettings({ ...settings, developerMode: !settings.developerMode })}
                  className={cn(
                    "flex items-start justify-between p-3.5 rounded-xl border transition-all select-none cursor-pointer",
                    settings.developerMode
                      ? "bg-indigo-50/40 border-indigo-200 hover:bg-indigo-50/60"
                      : "bg-white border-gray-200 hover:bg-gray-50"
                  )}
                >
                  <div className="flex gap-3">
                    <span className="text-xl bg-gray-100 w-10 h-10 rounded-lg flex items-center justify-center border border-gray-200/50">
                      <Code className="w-5 h-5 text-indigo-600" />
                    </span>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-900">
                          {settings.language === "en" ? "Developer Mode" : "デベロッパーモード"}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500 max-w-[280px]">
                        {settings.language === "en"
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
                      <span className="text-[10px] bg-gray-100 text-gray-400 border border-gray-200 px-2.5 py-0.5 rounded-full font-medium">
                        OFF
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Footer */}
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <p className="text-[10px] text-gray-500">
                ※ OpenAI / OpenRouterエージェントの利用には、管理者パネルでのAPIキー（OPENAI_API_KEY）の設定が必要です。
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

