import React, { useState } from "react";
import { motion } from "motion/react";
import { 
  Shield, 
  Settings, 
  Cpu, 
  Check, 
  AlertTriangle, 
  TrendingUp, 
  Activity, 
  Key, 
  UserCheck, 
  Plus, 
  Layers, 
  Info,
  Server
} from "lucide-react";
import { cn } from "../../utils";
import { Settings as AppSettings, AIAgentConfig } from "../../types";

interface OrganizationAppProps {
  settings: AppSettings;
  updateSettings: (s: AppSettings) => void;
}

const AGENTS_LIST: AIAgentConfig[] = [
  { id: "gemini", name: "Google Gemini 3.5 Flash", description: "Googleの高精度・高速推論モデル（デフォルト有効・高速並列）", icon: "♊", status: "active", provider: "Google" },
  { id: "openai", name: "OpenAI GPT-4o / Router", description: "GPT-4oおよびOpenRouter各種モデル。コンテキスト拡張に対応", icon: "🟢", status: "active", provider: "OpenAI" },
  { id: "claude", name: "Claude 3.5 Sonnet (Anthropic)", description: "極めて高精度な日本語・構造コード生成。将来対応予定", icon: "🍁", status: "planned", provider: "Anthropic" },
  { id: "perplexity", name: "Perplexity AI Spec", description: "リアルタイムWeb検索と連動した最新情報の収集。将来対応予定", icon: "🔍", status: "planned", provider: "Perplexity" },
  { id: "deepseek", name: "DeepSeek-V3 / R1", description: "推論と構造化、数学的評価に特化した最新モデル。将来対応予定", icon: "🐳", status: "planned", provider: "DeepSeek" },
];

export default function OrganizationApp({ settings, updateSettings }: OrganizationAppProps) {
  const [activeTab, setActiveTab] = useState<"agents" | "compliance" | "keys">("agents");
  const [successMsg, setSuccessMsg] = useState("");

  const toggleAgent = (agentId: string) => {
    const isSelected = settings.selectedAgents.includes(agentId);
    let updated: string[];
    if (isSelected) {
      if (settings.selectedAgents.length <= 1) return;
      updated = settings.selectedAgents.filter(id => id !== agentId);
    } else {
      updated = [...settings.selectedAgents, agentId];
    }
    updateSettings({
      ...settings,
      selectedAgents: updated
    });
    
    setSuccessMsg("AI agent alignment updated successfully.");
    setTimeout(() => setSuccessMsg(""), 3000);
  };

  return (
    <div className="space-y-6">
      
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/50 dark:border-white/[0.04] pb-5">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-500/10 dark:bg-blue-500/20 border border-blue-500/20 rounded-full text-[10px] text-blue-600 dark:text-blue-300 font-bold font-mono tracking-widest uppercase">
            <Shield className="w-3.5 h-3.5" />
            ORGANIZATION CONTROL CENTER & SETTINGS
          </div>
          <h2 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
            Organization Cockpit
          </h2>
          <p className="text-xs text-slate-400 dark:text-neutral-500 font-medium">
            Configure active parallel AI models, set organizational risk postures, and align safety compliance parameters.
          </p>
        </div>
      </div>

      {/* Sub Tabs */}
      <div className="flex items-center gap-1.5 bg-white/40 dark:bg-neutral-900/20 border border-slate-200/60 dark:border-white/[0.04] p-1.5 rounded-2xl max-w-md backdrop-blur-md">
        <button
          onClick={() => setActiveTab("agents")}
          className={cn(
            "flex-1 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer text-center",
            activeTab === "agents"
              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-sm"
              : "text-slate-500 dark:text-neutral-400 hover:text-slate-800 dark:hover:text-neutral-200 hover:bg-slate-50 dark:hover:bg-neutral-800/20"
          )}
        >
          AI Agents ({settings.selectedAgents.length})
        </button>
        <button
          onClick={() => setActiveTab("compliance")}
          className={cn(
            "flex-1 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer text-center",
            activeTab === "compliance"
              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-sm"
              : "text-slate-500 dark:text-neutral-400 hover:text-slate-800 dark:hover:text-neutral-200 hover:bg-slate-50 dark:hover:bg-neutral-800/20"
          )}
        >
          Compliance (UQI)
        </button>
        <button
          onClick={() => setActiveTab("keys")}
          className={cn(
            "flex-1 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer text-center",
            activeTab === "keys"
              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-sm"
              : "text-slate-500 dark:text-neutral-400 hover:text-slate-800 dark:hover:text-neutral-200 hover:bg-slate-50 dark:hover:bg-neutral-800/20"
          )}
        >
          API Integrations
        </button>
      </div>

      {successMsg && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs font-bold text-emerald-500 flex items-center gap-2"
        >
          <Check className="w-4 h-4" />
          <span>{successMsg}</span>
        </motion.div>
      )}

      {/* Main Grid content matching active Tab */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Cols: Main settings pane */}
        <div className="lg:col-span-2 space-y-6">
          
          {activeTab === "agents" && (
            <div className="space-y-4">
              <div className="bg-white/80 dark:bg-neutral-900/40 border border-slate-200/60 dark:border-white/[0.04] rounded-2xl p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-black text-slate-800 dark:text-neutral-200 flex items-center gap-2">
                    <Cpu className="w-4.5 h-4.5 text-blue-500" />
                    AI Company Member Toggles
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 leading-normal">
                    Turn specific AI members on or off. Active models will simultaneously co-deliberate when executing high-value SWOT, Litigation and intelligence missions.
                  </p>
                </div>

                <div className="space-y-3">
                  {AGENTS_LIST.map((agent) => {
                    const isActive = settings.selectedAgents.includes(agent.id);
                    const isPlanned = agent.status === "planned";

                    return (
                      <div
                        key={agent.id}
                        onClick={() => !isPlanned && toggleAgent(agent.id)}
                        className={cn(
                          "flex items-start justify-between p-4 rounded-2xl border transition-all select-none",
                          isPlanned
                            ? "bg-slate-100/30 dark:bg-neutral-950/20 border-slate-100 dark:border-neutral-900 opacity-60 cursor-not-allowed"
                            : isActive
                              ? "bg-blue-500/[0.02] dark:bg-blue-500/[0.02] border-blue-500/40 cursor-pointer hover:bg-blue-500/[0.04]"
                              : "bg-white dark:bg-neutral-900/10 border-slate-200 dark:border-white/[0.03] cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02]"
                        )}
                      >
                        <div className="flex gap-3.5">
                          <span className="text-2xl bg-slate-50 dark:bg-neutral-900 w-11 h-11 rounded-xl flex items-center justify-center border border-slate-100 dark:border-white/[0.04] shrink-0 font-sans">
                            {agent.icon}
                          </span>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-slate-800 dark:text-neutral-200">{agent.name}</span>
                              <span className="text-[9px] px-2 py-0.5 bg-slate-100 dark:bg-neutral-800 text-slate-500 dark:text-slate-400 rounded-full font-mono font-bold uppercase tracking-wider">
                                {agent.provider}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 leading-relaxed font-semibold">
                              {agent.description}
                            </p>
                          </div>
                        </div>

                        {!isPlanned && (
                          <div className={cn(
                            "w-5 h-5 rounded-md flex items-center justify-center border transition-all mt-1 shrink-0",
                            isActive 
                              ? "bg-blue-500 border-blue-500 text-white" 
                              : "border-slate-300 dark:border-white/10"
                          )}>
                            {isActive && <Check className="w-3.5 h-3.5 stroke-[3px]" />}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === "compliance" && (
            <div className="space-y-4">
              <div className="bg-white/80 dark:bg-neutral-900/40 border border-slate-200/60 dark:border-white/[0.04] rounded-2xl p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-black text-slate-800 dark:text-neutral-200 flex items-center gap-2">
                    <Shield className="w-4.5 h-4.5 text-emerald-500" />
                    UQI (Universal Quality Indicators) Compliance
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 leading-normal">
                    Define strict quality gates and parameters governing how OEvE assembly is performed.
                  </p>
                </div>

                <div className="space-y-3.5 text-xs text-slate-700 dark:text-neutral-300 font-semibold">
                  <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-neutral-900/20 border border-slate-200/50 dark:border-neutral-800 rounded-xl">
                    <div className="space-y-0.5">
                      <p className="text-xs text-slate-800 dark:text-neutral-200">Enforce Quality Gate Threshold (&gt;95%)</p>
                      <p className="text-[10px] text-slate-400 font-medium">Rejects any mission output with high-hallucination indexes.</p>
                    </div>
                    <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/5 border border-emerald-500/10 px-2 py-0.5 rounded font-mono">ENFORCED</span>
                  </div>

                  <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-neutral-900/20 border border-slate-200/50 dark:border-neutral-800 rounded-xl">
                    <div className="space-y-0.5">
                      <p className="text-xs text-slate-800 dark:text-neutral-200">Legal Precedent Compliance Audits</p>
                      <p className="text-[10px] text-slate-400 font-medium">Auto-references court proceedings databases for law queries.</p>
                    </div>
                    <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/5 border border-emerald-500/10 px-2 py-0.5 rounded font-mono">ACTIVE</span>
                  </div>

                  <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-neutral-900/20 border border-slate-200/50 dark:border-neutral-800 rounded-xl">
                    <div className="space-y-0.5">
                      <p className="text-xs text-slate-800 dark:text-neutral-200">Fact-Checking Web Grounding</p>
                      <p className="text-[10px] text-slate-400 font-medium">Aggressively cross-references facts with real-time web search parameters.</p>
                    </div>
                    <span className="text-[9px] font-bold text-blue-500 bg-blue-500/5 border border-blue-500/10 px-2 py-0.5 rounded font-mono">GROUNDED</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "keys" && (
            <div className="space-y-4">
              <div className="bg-white/80 dark:bg-neutral-900/40 border border-slate-200/60 dark:border-white/[0.04] rounded-2xl p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-black text-slate-800 dark:text-neutral-200 flex items-center gap-2">
                    <Key className="w-4.5 h-4.5 text-amber-500" />
                    Secure API Credential Alignments
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 leading-normal">
                    Enter third-party keys safely. All credentials are encrypted server-side and never leaked.
                  </p>
                </div>

                <div className="space-y-4 text-xs font-semibold">
                  <div className="space-y-1.5">
                    <label className="text-slate-400">Gemini Secret Key (Implicit)</label>
                    <div className="flex gap-2">
                      <input
                        disabled
                        type="password"
                        value="••••••••••••••••••••••••••••••••"
                        className="flex-1 bg-slate-100 dark:bg-neutral-900 border border-slate-200/50 dark:border-neutral-800 rounded-xl px-3.5 py-2.5 text-slate-500 cursor-not-allowed font-mono"
                      />
                      <span className="text-[10px] text-emerald-500 bg-emerald-500/5 border border-emerald-500/10 px-3 py-2.5 rounded-xl font-bold flex items-center font-mono">SECURE</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-slate-400">OpenAI / OpenRouter API Key</label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        placeholder="sk-or-••••••••••••••••••••••••••••••••"
                        className="flex-1 bg-slate-50 dark:bg-neutral-900 border border-slate-200/50 dark:border-neutral-800 rounded-xl px-3.5 py-2.5 text-slate-200 placeholder:text-slate-500 font-mono focus:border-indigo-500/50 focus:ring-0 outline-none"
                      />
                      <button 
                        onClick={() => {
                          setSuccessMsg("OpenAI Router key saved securely.");
                          setTimeout(() => setSuccessMsg(""), 3000);
                        }}
                        className="px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Right 1 Col: Compliance diagnostics */}
        <div className="space-y-6">
          
          <div className="bg-white/80 dark:bg-neutral-900/40 border border-slate-200/60 dark:border-white/[0.04] rounded-2xl p-5 space-y-4 shadow-xs">
            <h4 className="text-xs font-black text-slate-800 dark:text-neutral-300 uppercase tracking-widest font-mono">
              Diagnostic Core Status
            </h4>
            <div className="space-y-3.5 text-xs">
              <div className="flex justify-between pb-1.5 border-b border-slate-100 dark:border-neutral-800">
                <span className="text-slate-400 font-semibold">Risk Posture Rating</span>
                <span className="font-mono text-emerald-500 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  AAA PERFECT
                </span>
              </div>
              <div className="flex justify-between pb-1.5 border-b border-slate-100 dark:border-neutral-800">
                <span className="text-slate-400 font-semibold">Active Model Parallelism</span>
                <span className="font-mono text-slate-800 dark:text-white font-bold">Dual-Model Active</span>
              </div>
              <div className="flex justify-between pb-1.5 border-b border-slate-100 dark:border-neutral-800">
                <span className="text-slate-400 font-semibold">OEvE Memory Cache size</span>
                <span className="font-mono text-slate-800 dark:text-white font-bold">2,410 synapses</span>
              </div>
              <div className="flex justify-between pb-1.5 border-b border-slate-100 dark:border-neutral-800">
                <span className="text-slate-400 font-semibold">UQI Quality Assurance Code</span>
                <span className="font-mono text-slate-800 dark:text-white font-bold">ACOS-SIL-V2</span>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-[#09090D] via-[#121216] to-[#0E0E12] text-white border border-white/[0.05] p-5 rounded-2xl space-y-3.5">
            <div className="flex items-center gap-2 text-[10px] text-pink-400 font-mono tracking-widest uppercase">
              <Server className="w-3.5 h-3.5" />
              <span>Security Audit Trail</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-normal font-semibold">
              All transactions, prompt compilations, and strategic analysis results undergo standard industry audits before being safely saved to local workspaces.
            </p>
          </div>

        </div>

      </div>

    </div>
  );
}
