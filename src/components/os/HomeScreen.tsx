import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Brain, 
  BrainCircuit, 
  Database, 
  Sparkles, 
  TrendingUp, 
  Clock, 
  ChevronRight, 
  Cpu, 
  Zap, 
  AlertCircle, 
  CheckCircle2, 
  Command, 
  PlusCircle, 
  Layout, 
  Search, 
  Briefcase, 
  Shield, 
  Layers, 
  ArrowUpRight, 
  Activity,
  Award,
  Terminal,
  RefreshCw,
  HelpCircle,
  FileText
} from "lucide-react";
import { cn } from "../../utils";
import { WorkspaceCategory, TaskTemplate } from "../../types";

interface SavedMission {
  id: string;
  title: string;
  timestamp: string;
  category: string;
  successScore: number;
  roi: string;
  status: "Planning" | "Running" | "Review" | "Completed";
  resultData?: any;
}

interface HomeScreenProps {
  prompt: string;
  setPrompt: (val: string) => void;
  handleAnalyze: (e?: React.FormEvent, customPrompt?: string) => void;
  categories: WorkspaceCategory[];
  history: string[];
  clearHistory: () => void;
  savedMissions: SavedMission[];
  onViewMissionResult: (mission: SavedMission) => void;
  onSelectCategory: (category: WorkspaceCategory) => void;
}

export default function HomeScreen({
  prompt,
  setPrompt,
  handleAnalyze,
  categories,
  history,
  clearHistory,
  savedMissions,
  onViewMissionResult,
  onSelectCategory
}: HomeScreenProps) {
  const [selectedSuggestCategory, setSelectedSuggestCategory] = useState<WorkspaceCategory>(categories[0]);
  const [inputFocused, setInputFocused] = useState(false);
  const [brainActivityPulse, setBrainActivityPulse] = useState(true);
  const [cognitivePower, setCognitivePower] = useState(98.2);

  // Periodic simulation for brain immersion
  useEffect(() => {
    const timer = setInterval(() => {
      setCognitivePower(prev => {
        const delta = (Math.random() - 0.5) * 0.2;
        return parseFloat(Math.min(100, Math.max(95, prev + delta)).toFixed(1));
      });
      setBrainActivityPulse(prev => !prev);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const handlePresetClick = (preset: string) => {
    setPrompt(preset);
    // Find the category this template belongs to
    const matchingCat = categories.find(c => 
      c.templates.some(t => t.placeholder === preset || t.name === preset)
    );
    if (matchingCat) {
      onSelectCategory(matchingCat);
    }
    handleAnalyze(undefined, preset);
  };

  const handleTemplateClick = (temp: TaskTemplate, cat: WorkspaceCategory) => {
    setPrompt(temp.placeholder);
    onSelectCategory(cat);
    handleAnalyze(undefined, temp.placeholder);
  };

  const activeSuggestTemplates = selectedSuggestCategory?.templates || [];

  return (
    <div className="space-y-8 py-2 animate-fade-in">
      
      {/* ④ BRAIN CARD AT THE VERY TOP (Bento Grid) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
            <h3 className="text-xs font-black text-slate-400 dark:text-neutral-500 uppercase tracking-widest font-mono">
              Supreme Cognitive Core
            </h3>
          </div>
          <span className="text-[10px] font-bold font-mono text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-400 px-2 py-0.5 rounded-full border border-indigo-100/50 dark:border-indigo-900/30">
            BPI: {cognitivePower}% Active
          </span>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          
          {/* Card 1: Knowledge DNA */}
          <div className="bg-white/80 dark:bg-neutral-900/40 backdrop-blur-md border border-slate-200/60 dark:border-white/[0.04] p-5 rounded-2xl shadow-xs hover:shadow-md transition-all flex flex-col justify-between group overflow-hidden relative min-h-[140px]">
            <div className="absolute right-0 bottom-0 translate-x-3 translate-y-3 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity pointer-events-none duration-500">
              <Brain className="w-32 h-32 text-indigo-500" />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                <BrainCircuit className="w-4 h-4 animate-pulse" />
                <span className="font-bold text-xs font-mono tracking-wide uppercase">Knowledge DNA</span>
              </div>
              <span className="text-[9px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded font-mono">
                v2.4
              </span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">4.8 GB</div>
              <p className="text-[10px] text-slate-400 dark:text-neutral-500 font-medium mt-1 leading-relaxed">
                12 Active Layers compiled with self-adapting neural synapses.
              </p>
            </div>
          </div>

          {/* Card 2: Memory */}
          <div className="bg-white/80 dark:bg-neutral-900/40 backdrop-blur-md border border-slate-200/60 dark:border-white/[0.04] p-5 rounded-2xl shadow-xs hover:shadow-md transition-all flex flex-col justify-between group overflow-hidden relative min-h-[140px]">
            <div className="absolute right-0 bottom-0 translate-x-3 translate-y-3 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity pointer-events-none duration-500">
              <Database className="w-32 h-32 text-emerald-500" />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <Database className="w-4 h-4" />
                <span className="font-bold text-xs font-mono tracking-wide uppercase">OEvE Memory</span>
              </div>
              <span className="text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded font-mono">
                Live
              </span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">142 Logs</div>
              <p className="text-[10px] text-slate-400 dark:text-neutral-500 font-medium mt-1 leading-relaxed">
                2,410 Long-term synapses consolidated and ready for context.
              </p>
            </div>
          </div>

          {/* Card 3: Org Learning */}
          <div className="bg-white/80 dark:bg-neutral-900/40 backdrop-blur-md border border-slate-200/60 dark:border-white/[0.04] p-5 rounded-2xl shadow-xs hover:shadow-md transition-all flex flex-col justify-between group overflow-hidden relative min-h-[140px]">
            <div className="absolute right-0 bottom-0 translate-x-3 translate-y-3 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity pointer-events-none duration-500">
              <Shield className="w-32 h-32 text-amber-500" />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-500">
                <Shield className="w-4 h-4" />
                <span className="font-bold text-xs font-mono tracking-wide uppercase">Org Learning</span>
              </div>
              <span className="text-[9px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-500 px-1.5 py-0.5 rounded font-mono">
                98.4%
              </span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">28 Rules</div>
              <p className="text-[10px] text-slate-400 dark:text-neutral-500 font-medium mt-1 leading-relaxed">
                Adaptive behavior compliance actively governing task delivery.
              </p>
            </div>
          </div>

          {/* Card 4: Recent Missions */}
          <div className="bg-white/80 dark:bg-neutral-900/40 backdrop-blur-md border border-slate-200/60 dark:border-white/[0.04] p-5 rounded-2xl shadow-xs hover:shadow-md transition-all flex flex-col justify-between group overflow-hidden relative min-h-[140px]">
            <div className="absolute right-0 bottom-0 translate-x-3 translate-y-3 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity pointer-events-none duration-500">
              <Clock className="w-32 h-32 text-blue-500" />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-indigo-500">
                <Clock className="w-4 h-4" />
                <span className="font-bold text-xs font-mono tracking-wide uppercase">Recent Activity</span>
              </div>
              <span className="text-[9px] font-bold bg-slate-100 dark:bg-neutral-800 text-slate-500 dark:text-neutral-400 px-1.5 py-0.5 rounded font-mono">
                Pulses
              </span>
            </div>
            <div className="mt-3 space-y-1.5 overflow-hidden max-h-[72px]">
              {savedMissions.slice(0, 2).map((m, idx) => (
                <div 
                  key={m.id || idx} 
                  onClick={() => onViewMissionResult(m)}
                  className="flex items-center justify-between text-[10px] p-1 hover:bg-slate-50 dark:hover:bg-neutral-800/50 rounded transition-colors cursor-pointer border-b border-slate-100 dark:border-neutral-800 last:border-none"
                >
                  <span className="font-bold text-slate-700 dark:text-neutral-300 truncate max-w-[130px]">{m.title}</span>
                  <span className="font-mono text-emerald-500 font-black shrink-0">{m.successScore}%</span>
                </div>
              ))}
              {savedMissions.length === 0 && (
                <p className="text-[9px] text-slate-400 italic">No recent missions. Run your first mission below!</p>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ① HOME中央: UNIVERSAL MISSION INPUT */}
      <div className="max-w-3xl mx-auto w-full py-6 space-y-6 relative">
        <div className="text-center space-y-2">
          {/* Glassmorphic Brand Accent */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 dark:bg-indigo-500/20 border border-indigo-500/20 rounded-full text-[10px] text-indigo-600 dark:text-indigo-300 font-black font-mono tracking-widest uppercase">
            <Sparkles className="w-3 h-3 text-indigo-500 animate-pulse" />
            MISSION FIRST SYSTEM
          </div>
          <h2 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
            What is your next mission?
          </h2>
          <p className="text-xs text-slate-400 dark:text-neutral-500 font-medium max-w-md mx-auto leading-relaxed">
            AI boardroom orchestration executes complex research and workflows. Formulating strategic deliverables instantly.
          </p>
        </div>

        {/* Input box */}
        <div className={cn(
          "bg-white/90 dark:bg-neutral-900/80 backdrop-blur-xl rounded-3xl border transition-all duration-300 shadow-lg relative p-2",
          inputFocused 
            ? "border-indigo-500/80 shadow-indigo-500/[0.04] ring-4 ring-indigo-500/10" 
            : "border-slate-200/80 dark:border-white/[0.04] shadow-slate-200/40 dark:shadow-none"
        )}>
          <form onSubmit={(e) => handleAnalyze(e)} className="relative flex items-center">
            <div className="absolute left-4 text-slate-400 dark:text-neutral-500">
              <Search className="w-5 h-5" />
            </div>
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="Describe your target... (e.g. SWOT analysis, competitor market intelligence)"
              className="w-full bg-transparent border-none outline-none pl-12 pr-28 py-4 text-sm font-semibold text-slate-800 dark:text-neutral-200 placeholder:text-slate-400 dark:placeholder:text-neutral-600"
            />
            <div className="absolute right-2 flex items-center gap-1.5">
              <span className="hidden sm:inline-flex items-center gap-1 text-[9px] font-bold text-slate-400 dark:text-neutral-500 px-1.5 py-1 bg-slate-50 dark:bg-neutral-800 border border-slate-200/50 dark:border-neutral-700/30 rounded-lg">
                <span>Enter</span>
                <span className="text-[10px]">↵</span>
              </span>
              <button
                type="submit"
                disabled={!prompt.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-600 text-white rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer flex items-center gap-1.5 shadow-sm shadow-indigo-600/10"
              >
                <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
                <span>Execute</span>
              </button>
            </div>
          </form>
        </div>

        {/* ⑤ MARKETPLACE SUGGESTIONS UNDER INPUT */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-neutral-800 pb-2">
            <span className="text-[10px] font-black text-slate-400 dark:text-neutral-500 uppercase tracking-wider font-mono">
              Marketplace Templates Suggestion
            </span>
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedSuggestCategory(cat)}
                  className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors cursor-pointer whitespace-nowrap",
                    selectedSuggestCategory.id === cat.id
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-xs"
                      : "text-slate-400 dark:text-neutral-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-neutral-800/50"
                  )}
                >
                  <span className="mr-1">{cat.icon}</span>
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          {/* Suggest templates list */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {activeSuggestTemplates.map(temp => (
              <button
                key={temp.id}
                onClick={() => handleTemplateClick(temp, selectedSuggestCategory)}
                className="flex items-start text-left p-2.5 rounded-xl border border-slate-100 dark:border-neutral-800 bg-white/40 dark:bg-neutral-900/20 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 hover:border-indigo-200/60 dark:hover:border-indigo-500/20 transition-all cursor-pointer group"
              >
                <div className="mr-2 text-indigo-500 mt-0.5 group-hover:scale-110 transition-transform">
                  <PlusCircle className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-neutral-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    {temp.name}
                  </h4>
                  <p className="text-[10px] text-slate-400 dark:text-neutral-500 mt-0.5 font-medium leading-relaxed truncate max-w-[280px]">
                    {temp.hint}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

      </div>

      {/* ③ WORKSPACE (現在の作業空間) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h3 className="text-base font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-1.5">
              <Briefcase className="w-5 h-5 text-indigo-600" />
              Active Workspace
            </h3>
            <p className="text-[11px] text-slate-400 dark:text-neutral-500 font-medium">
              Completed missions are automatically saved to this persistent working desk.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/10 px-2.5 py-1 rounded-full text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Auto-Sync Active
            </div>
          </div>
        </div>

        {/* Workspace Grid Layout (Bento style file cabinet) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          
          {/* Main Workspace Asset Table */}
          <div className="md:col-span-2 bg-white/80 dark:bg-neutral-900/40 backdrop-blur-md border border-slate-200/60 dark:border-white/[0.04] rounded-2xl p-5 shadow-xs flex flex-col justify-between min-h-[220px]">
            <div className="space-y-4 w-full">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-slate-400 dark:text-neutral-500 uppercase tracking-widest font-mono">
                  Saved Assets & Documents
                </span>
                <span className="text-[10px] font-bold text-slate-500 font-mono">
                  {savedMissions.length} files
                </span>
              </div>

              <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                {savedMissions.map((m) => (
                  <div 
                    key={m.id}
                    onClick={() => onViewMissionResult(m)}
                    className="flex items-center justify-between p-2.5 bg-slate-50/50 dark:bg-neutral-800/20 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/25 border border-slate-100 dark:border-neutral-800 hover:border-indigo-100 dark:hover:border-indigo-900/30 rounded-xl transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-3 truncate max-w-[70%]">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center shrink-0 border border-indigo-100/50 dark:border-indigo-900/30 group-hover:scale-105 transition-transform">
                        <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <div className="truncate">
                        <p className="text-xs font-black text-slate-800 dark:text-neutral-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">
                          {m.title}
                        </p>
                        <p className="text-[9px] text-slate-400 dark:text-neutral-500 mt-0.5 font-mono">
                          {new Date(m.timestamp).toLocaleDateString()} • {m.roi || "ROI Predictor"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 font-mono bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/10 px-2 py-0.5 rounded">
                        Score: {m.successScore}%
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </div>
                ))}
                {savedMissions.length === 0 && (
                  <div className="text-center py-8 text-slate-400 italic text-xs">
                    Workspace is empty. Launch a mission above to automatically persist the deliverables here!
                  </div>
                )}
              </div>
            </div>
            
            <div className="border-t border-slate-50 dark:border-neutral-800 pt-3 mt-4 flex items-center justify-between text-[10px] text-slate-400 dark:text-neutral-500">
              <span className="font-mono">WORKSPACE SYNC: CLOUD SECURE</span>
              <button 
                onClick={() => alert("Creating custom files is currently managed via automated mission outputs.")}
                className="hover:text-indigo-600 dark:hover:text-indigo-400 font-bold transition-colors cursor-pointer flex items-center gap-1"
              >
                <PlusCircle className="w-3 h-3" />
                Add External Asset
              </button>
            </div>
          </div>

          {/* Workspace Status & Active Boardroom Card */}
          <div className="bg-white/80 dark:bg-neutral-900/40 backdrop-blur-md border border-slate-200/60 dark:border-white/[0.04] rounded-2xl p-5 shadow-xs flex flex-col justify-between min-h-[220px]">
            <div className="space-y-3">
              <span className="text-[10px] font-black text-slate-400 dark:text-neutral-500 uppercase tracking-widest font-mono">
                Active Boardroom Status
              </span>
              
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs pb-1 border-b border-slate-100 dark:border-neutral-800">
                  <span className="text-slate-500 font-semibold">Gemini Master Brain</span>
                  <span className="font-mono text-emerald-500 font-black">98.4ms latency</span>
                </div>
                <div className="flex items-center justify-between text-xs pb-1 border-b border-slate-100 dark:border-neutral-800">
                  <span className="text-slate-500 font-semibold">Claude Analyst Agent</span>
                  <span className="font-mono text-emerald-500 font-black">74.1ms latency</span>
                </div>
                <div className="flex items-center justify-between text-xs pb-1 border-b border-slate-100 dark:border-neutral-800">
                  <span className="text-slate-500 font-semibold">UQI Fact Auditor</span>
                  <span className="font-mono text-emerald-500 font-black">22.5ms latency</span>
                </div>
                <div className="flex items-center justify-between text-xs pb-1 border-b border-slate-100 dark:border-neutral-800">
                  <span className="text-slate-500 font-semibold">Memory Consolidator</span>
                  <span className="font-mono text-emerald-500 font-black">15.8ms latency</span>
                </div>
              </div>
            </div>

            <div className="p-3 bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/10 dark:border-indigo-500/20 rounded-xl space-y-1 mt-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-700 dark:text-indigo-400">
                <Award className="w-3.5 h-3.5" />
                <span>Q5 Production Release Rule</span>
              </div>
              <p className="text-[9px] text-slate-400 dark:text-neutral-500 leading-normal font-medium">
                No deliverables are committed to the persistent Workspace unless UQI evaluation reaches &gt;95 points.
              </p>
            </div>
          </div>

        </div>
      </div>

      {/* ② INTEGRATED OPERATIONS DASHBOARD (Brainの下に移動) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <div className="space-y-0.5">
            <h3 className="text-base font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-1.5">
              <Activity className="w-5 h-5 text-indigo-600 animate-pulse" />
              Integrated Operations Dashboard
            </h3>
            <p className="text-[11px] text-slate-400 dark:text-neutral-500 font-medium">
              Real-time core system status, active agent allocation, and Strategic Intelligence recommendations.
            </p>
          </div>
          <span className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-950/50 rounded-full text-[10px] font-bold font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            SYSTEM ONLINE
          </span>
        </div>

        {/* Dashboard Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Active Agents (OEE) */}
          <div className="bg-white/80 dark:bg-neutral-900/40 backdrop-blur-md p-5 rounded-2xl border border-slate-200/60 dark:border-white/[0.04] shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-3 text-indigo-600 dark:text-indigo-400">
              <Cpu className="w-4 h-4" />
              <span className="font-bold text-xs">Active Agents (OEE)</span>
            </div>
            <div>
              <div className="text-2xl font-black text-slate-800 dark:text-white">12 Agents</div>
              <p className="text-[9px] text-emerald-500 font-bold mt-1">Multi-model active staff</p>
            </div>
          </div>

          {/* Total Missions (MOS) */}
          <div className="bg-white/80 dark:bg-neutral-900/40 backdrop-blur-md p-5 rounded-2xl border border-slate-200/60 dark:border-white/[0.04] shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-3 text-amber-500">
              <Zap className="w-4 h-4" />
              <span className="font-bold text-xs">Total Missions (MOS)</span>
            </div>
            <div>
              <div className="text-2xl font-black text-slate-800 dark:text-white">{savedMissions.length + 8} executed</div>
              <p className="text-[9px] text-amber-500 font-bold mt-1">Active processing pipeline</p>
            </div>
          </div>

          {/* Pending Reviews (SIL) */}
          <div className="bg-white/80 dark:bg-neutral-900/40 backdrop-blur-md p-5 rounded-2xl border border-slate-200/60 dark:border-white/[0.04] shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-3 text-rose-500">
              <AlertCircle className="w-4 h-4" />
              <span className="font-bold text-xs">Risk Profiles (SIL)</span>
            </div>
            <div>
              <div className="text-2xl font-black text-slate-800 dark:text-white">0 High-Risk</div>
              <p className="text-[9px] text-rose-500 font-bold mt-1">Audited and fully aligned</p>
            </div>
          </div>

          {/* Strategic Alignment */}
          <div className="bg-white/80 dark:bg-neutral-900/40 backdrop-blur-md p-5 rounded-2xl border border-slate-200/60 dark:border-white/[0.04] shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-3 text-emerald-500">
              <Shield className="w-4 h-4" />
              <span className="font-bold text-xs">Strategic Alignment</span>
            </div>
            <div>
              <div className="text-2xl font-black text-slate-800 dark:text-white">98.4%</div>
              <p className="text-[9px] text-emerald-500 font-bold mt-1">Target accuracy guarantee</p>
            </div>
          </div>
        </div>

        {/* Strategic Recommendations and decisions from SIL */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Strategic Recommendation */}
          <div className="bg-white/80 dark:bg-neutral-900/40 backdrop-blur-md p-5 rounded-2xl border border-slate-200/60 dark:border-white/[0.04] shadow-xs">
            <h4 className="text-xs font-black text-slate-800 dark:text-neutral-300 uppercase tracking-widest font-mono mb-3 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              Strategic Recommendations (SIL Engine)
            </h4>
            <div className="space-y-2">
              <div className="p-3 bg-slate-50 dark:bg-neutral-800/20 border border-slate-100 dark:border-neutral-800 rounded-xl">
                <div className="text-xs font-bold text-slate-800 dark:text-neutral-200">API Allocation Efficiency</div>
                <p className="text-[10px] text-slate-400 dark:text-neutral-500 mt-1">
                  SIL detected optimal performance utilizing cross-engine prompt templates. Saving 12% compute resources.
                </p>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-neutral-800/20 border border-slate-100 dark:border-neutral-800 rounded-xl">
                <div className="text-xs font-bold text-slate-800 dark:text-neutral-200">Self-Adapting Web Caching</div>
                <p className="text-[10px] text-slate-400 dark:text-neutral-500 mt-1">
                  Frequent SWOT analyses detected. Recommended automatic caching in persistent knowledge DNA.
                </p>
              </div>
            </div>
          </div>

          {/* Operational Decisions */}
          <div className="bg-white/80 dark:bg-neutral-900/40 backdrop-blur-md p-5 rounded-2xl border border-slate-200/60 dark:border-white/[0.04] shadow-xs">
            <h4 className="text-xs font-black text-slate-800 dark:text-neutral-300 uppercase tracking-widest font-mono mb-3 flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
              Core Decisions Pulse
            </h4>
            <div className="space-y-2">
              <div className="p-3 bg-slate-50 dark:bg-neutral-800/20 border border-slate-100 dark:border-neutral-800 rounded-xl flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-800 dark:text-neutral-200">Durable Cloud Sync active</div>
                  <p className="text-[9px] text-slate-400 dark:text-neutral-500 mt-0.5">Ensuring mission artifacts survive cache resets.</p>
                </div>
                <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded shrink-0">Active</span>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-neutral-800/20 border border-slate-100 dark:border-neutral-800 rounded-xl flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-800 dark:text-neutral-200">Automated Q5 quality checks</div>
                  <p className="text-[9px] text-slate-400 dark:text-neutral-500 mt-0.5">Enforcing rigid fact audit rules at compilation.</p>
                </div>
                <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded shrink-0">Enforced</span>
              </div>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
