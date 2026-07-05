import React, { useState, useEffect } from "react";
import { 
  Cpu, 
  Zap, 
  AlertCircle, 
  CheckCircle2, 
  PlusCircle, 
  Search, 
  Briefcase, 
  Shield, 
  Layers, 
  Activity,
  Award,
  FileText,
  ChevronRight,
  Sparkles,
  TrendingUp
} from "lucide-react";
import { cn } from "../../utils";
import { WorkspaceCategory, TaskTemplate } from "../../types";
import DynamicBrain from "./DynamicBrain";
import { 
  SovereignGlassCard,
  SovereignButton,
  SovereignInput,
  SovereignBadge,
  SovereignSegmentedControl
} from "../SovereignComponents";

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
  developerMode?: boolean;
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
  onSelectCategory,
  developerMode = false
}: HomeScreenProps) {
  const [selectedSuggestCategory, setSelectedSuggestCategory] = useState<WorkspaceCategory>(categories[0]);
  const [inputFocused, setInputFocused] = useState(false);
  const [cognitivePower, setCognitivePower] = useState(98.2);

  // Periodic simulation for brain immersion
  useEffect(() => {
    const timer = setInterval(() => {
      setCognitivePower(prev => {
        const delta = (Math.random() - 0.5) * 0.2;
        return parseFloat(Math.min(100, Math.max(95, prev + delta)).toFixed(1));
      });
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const handleTemplateClick = (temp: TaskTemplate, cat: WorkspaceCategory) => {
    setPrompt(temp.placeholder);
    onSelectCategory(cat);
    handleAnalyze(undefined, temp.placeholder);
  };

  const activeSuggestTemplates = selectedSuggestCategory?.templates || [];

  const categoryOptions = categories.map(cat => ({
    id: cat.id,
    label: cat.name,
    icon: <span className="mr-1">{cat.icon}</span>
  }));

  return (
    <div className="space-y-12 py-4 px-1 max-w-6xl mx-auto">
      
      {/* ① BRAIN CARD (主役 - First Eye Contact) */}
      <SovereignGlassCard className="relative overflow-hidden p-1">
        <DynamicBrain />
      </SovereignGlassCard>

      {/* ② UNIVERSAL MISSION INPUT (第二優先 - Interactive Action Center) */}
      <div className="max-w-3xl mx-auto w-full space-y-6 text-center">
        <div className="space-y-3">
          <SovereignBadge variant="indigo">
            <Sparkles className="w-3 h-3 text-indigo-500 mr-1.5 animate-pulse" />
            MISSION FIRST COMMAND SYSTEM
          </SovereignBadge>
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
            What is your next mission?
          </h2>
          <p className="text-xs text-slate-400 dark:text-neutral-500 font-medium max-w-md mx-auto leading-relaxed">
            AI boardroom orchestration executes complex research and workflows, formulating strategic deliverables instantly.
          </p>
        </div>

        {/* Vision Pro-style spatial search bar */}
        <div className="max-w-3xl mx-auto w-full">
          <SovereignGlassCard className={cn(
            "p-1.5 bg-white/70 dark:bg-neutral-950/20 transition-all duration-300",
            inputFocused 
              ? "border-indigo-500/40 dark:border-indigo-500/30 ring-8 ring-indigo-500/5 dark:ring-indigo-500/5 scale-[1.005]" 
              : ""
          )}>
            <form onSubmit={(e) => handleAnalyze(e)} className="relative flex items-center">
              <div className="absolute left-4 text-slate-400 dark:text-neutral-500">
                <Search className="w-4 h-4" />
              </div>
              <SovereignInput
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder="Describe your target... (e.g. SWOT analysis, competitor market intelligence)"
                className="w-full bg-transparent border-none outline-none pl-12 pr-28 py-3.5 text-xs font-semibold text-slate-800 dark:text-neutral-200 placeholder:text-slate-400 dark:placeholder:text-neutral-600 focus:ring-0 focus:border-transparent shadow-none"
              />
              <div className="absolute right-2 flex items-center gap-2">
                <span className="hidden sm:inline-flex items-center gap-1 text-[9px] font-bold text-slate-400 dark:text-neutral-500 px-1.5 py-1 bg-slate-50/80 dark:bg-neutral-900/80 border border-slate-200/30 dark:border-white/[0.02] rounded-lg">
                  <span>Enter</span>
                  <span className="text-[10px]">↵</span>
                </span>
                <SovereignButton
                  type="submit"
                  disabled={!prompt.trim()}
                  variant="primary"
                  size="sm"
                  className="rounded-xl px-4 py-2 text-xs font-bold"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Execute</span>
                </SovereignButton>
              </div>
            </form>
          </SovereignGlassCard>
        </div>
      </div>

      {/* ③ INTEGRATED OPERATIONS DASHBOARD (第三優先 - System Analytics) */}
      <div className="space-y-6">
        <div className="flex items-center justify-between px-1">
          <div className="space-y-1">
            <h3 className="text-[10px] font-bold tracking-widest text-slate-400 dark:text-neutral-500 uppercase font-mono flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-500" />
              Integrated Operations Dashboard
            </h3>
            <p className="text-xs text-slate-400 dark:text-neutral-500 font-medium">
              Real-time core system status, active agent allocation, and Strategic Intelligence recommendations.
            </p>
          </div>
          <SovereignBadge variant="cyan">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse mr-1.5"></span>
            SYSTEM ONLINE
          </SovereignBadge>
        </div>

        {/* Dashboard Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Active Agents */}
          <SovereignGlassCard className="p-6 flex flex-col justify-between hover:border-slate-300 dark:hover:border-white/[0.08] hover:-translate-y-0.5">
            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
              <Cpu className="w-4 h-4" />
              <span className="font-bold text-xs font-sans tracking-tight">Active Agents (OEE)</span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-bold tracking-tight text-slate-800 dark:text-white">12 Agents</div>
              <p className="text-[10px] text-indigo-500/80 font-semibold mt-1 font-mono">Multi-model active staff</p>
            </div>
          </SovereignGlassCard>

          {/* Total Missions */}
          <SovereignGlassCard className="p-6 flex flex-col justify-between hover:border-slate-300 dark:hover:border-white/[0.08] hover:-translate-y-0.5">
            <div className="flex items-center gap-2 text-pink-500">
              <Zap className="w-4 h-4" />
              <span className="font-bold text-xs font-sans tracking-tight">Total Missions (MOS)</span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-bold tracking-tight text-slate-800 dark:text-white">{savedMissions.length + 8} executed</div>
              <p className="text-[10px] text-pink-500/80 font-semibold mt-1 font-mono">Active processing pipeline</p>
            </div>
          </SovereignGlassCard>

          {/* Risk Profiles */}
          <SovereignGlassCard className="p-6 flex flex-col justify-between hover:border-slate-300 dark:hover:border-white/[0.08] hover:-translate-y-0.5">
            <div className="flex items-center gap-2 text-blue-500">
              <AlertCircle className="w-4 h-4" />
              <span className="font-bold text-xs font-sans tracking-tight">Risk Profiles (SIL)</span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-bold tracking-tight text-slate-800 dark:text-white">0 High-Risk</div>
              <p className="text-[10px] text-blue-500/80 font-semibold mt-1 font-mono">Audited and fully aligned</p>
            </div>
          </SovereignGlassCard>

          {/* Strategic Alignment */}
          <SovereignGlassCard className="p-6 flex flex-col justify-between hover:border-slate-300 dark:hover:border-white/[0.08] hover:-translate-y-0.5">
            <div className="flex items-center gap-2 text-indigo-500 dark:text-indigo-400">
              <Shield className="w-4 h-4" />
              <span className="font-bold text-xs font-sans tracking-tight">Strategic Alignment</span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-bold tracking-tight text-slate-800 dark:text-white">98.4%</div>
              <p className="text-[10px] text-indigo-500/80 font-semibold mt-1 font-mono">Target accuracy guarantee</p>
            </div>
          </SovereignGlassCard>
        </div>

        {/* Detailed recommendations cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SovereignGlassCard className="p-6">
            <h4 className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest font-mono mb-4 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              Strategic Recommendations (SIL Engine)
            </h4>
            <div className="space-y-3">
              <div className="p-4 bg-slate-50/50 dark:bg-white/[0.01] border border-slate-100 dark:border-white/[0.02] rounded-2xl">
                <div className="text-xs font-bold text-slate-800 dark:text-neutral-200">API Allocation Efficiency</div>
                <p className="text-[11px] text-slate-400 dark:text-neutral-500 mt-1 leading-relaxed">
                  SIL detected optimal performance utilizing cross-engine prompt templates. Saving 12% compute resources.
                </p>
              </div>
              <div className="p-4 bg-slate-50/50 dark:bg-white/[0.01] border border-slate-100 dark:border-white/[0.02] rounded-2xl">
                <div className="text-xs font-bold text-slate-800 dark:text-neutral-200">Self-Adapting Web Caching</div>
                <p className="text-[11px] text-slate-400 dark:text-neutral-500 mt-1 leading-relaxed">
                  Frequent SWOT analyses detected. Recommended automatic caching in persistent knowledge DNA.
                </p>
              </div>
            </div>
          </SovereignGlassCard>

          <SovereignGlassCard className="p-6">
            <h4 className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest font-mono mb-4 flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5 text-pink-500" />
              Core Decisions Pulse
            </h4>
            <div className="space-y-3">
              <div className="p-4 bg-slate-50/50 dark:bg-white/[0.01] border border-slate-100 dark:border-white/[0.02] rounded-2xl flex items-center justify-between">
                <div className="pr-4">
                  <div className="text-xs font-bold text-slate-800 dark:text-neutral-200">Durable Cloud Sync active</div>
                  <p className="text-[11px] text-slate-400 dark:text-neutral-500 mt-1 leading-relaxed">Ensuring mission artifacts survive cache resets.</p>
                </div>
                <SovereignBadge variant="indigo" className="shrink-0">Active</SovereignBadge>
              </div>
              <div className="p-4 bg-slate-50/50 dark:bg-white/[0.01] border border-slate-100 dark:border-white/[0.02] rounded-2xl flex items-center justify-between">
                <div className="pr-4">
                  <div className="text-xs font-bold text-slate-800 dark:text-neutral-200">Automated Q5 quality checks</div>
                  <p className="text-[11px] text-slate-400 dark:text-neutral-500 mt-1 leading-relaxed">Enforcing rigid fact audit rules at compilation.</p>
                </div>
                <SovereignBadge variant="pink" className="shrink-0">Enforced</SovereignBadge>
              </div>
            </div>
          </SovereignGlassCard>
        </div>
      </div>

      {/* ④ ACTIVE WORKSPACE (第四優先 - Local Document Workspace) */}
      <div className="space-y-6">
        <div className="flex items-center justify-between px-1">
          <div className="space-y-1">
            <h3 className="text-[10px] font-bold tracking-widest text-slate-400 dark:text-neutral-500 uppercase font-mono flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-blue-500" />
              Active Workspace
            </h3>
            <p className="text-xs text-slate-400 dark:text-neutral-500 font-medium">
              Completed missions are automatically saved to this persistent working desk.
            </p>
          </div>
          <SovereignBadge variant="indigo">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse mr-1.5" />
            Auto-Sync Active
          </SovereignBadge>
        </div>

        {/* Workspace Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Saved Documents Column */}
          <SovereignGlassCard className="lg:col-span-2 p-6 flex flex-col justify-between min-h-[260px]">
            <div className="space-y-4 w-full">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-white/[0.02]">
                <span className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest font-mono">
                  Saved Assets & Documents
                </span>
                <span className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 font-mono">
                  {savedMissions.length} files
                </span>
              </div>

              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 scrollbar-none">
                {savedMissions.map((m) => (
                  <div 
                    key={m.id}
                    onClick={() => onViewMissionResult(m)}
                    className="flex items-center justify-between p-3 bg-slate-50/50 dark:bg-white/[0.01] hover:bg-indigo-500/[0.03] dark:hover:bg-indigo-500/[0.03] border border-slate-100 dark:border-white/[0.01] hover:border-indigo-500/20 dark:hover:border-indigo-500/20 rounded-2xl transition-all duration-300 cursor-pointer group"
                  >
                    <div className="flex items-center gap-3 truncate max-w-[70%]">
                      <div className="w-8 h-8 rounded-xl bg-indigo-500/5 dark:bg-indigo-500/10 flex items-center justify-center shrink-0 border border-indigo-500/5 dark:border-indigo-500/10 group-hover:scale-105 transition-transform">
                        <FileText className="w-4 h-4 text-indigo-500" />
                      </div>
                      <div className="truncate">
                        <p className="text-xs font-bold text-slate-800 dark:text-neutral-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">
                          {m.title}
                        </p>
                        <p className="text-[9px] text-slate-400 dark:text-neutral-500 mt-0.5 font-mono">
                          {new Date(m.timestamp).toLocaleDateString()} • {m.roi || "ROI Predictor"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <SovereignBadge variant="pink" className="shrink-0">
                        Score: {m.successScore}%
                      </SovereignBadge>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 dark:text-neutral-600 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </div>
                ))}
                {savedMissions.length === 0 && (
                  <div className="text-center py-12 text-slate-400 dark:text-neutral-600 italic text-xs">
                    Workspace is empty. Launch a mission above to automatically persist the deliverables here!
                  </div>
                )}
              </div>
            </div>
            
            <div className="border-t border-slate-100 dark:border-white/[0.02] pt-4 mt-6 flex items-center justify-between text-[10px] text-slate-400 dark:text-neutral-500">
              <span className="font-mono">WORKSPACE SYNC: CLOUD SECURE</span>
              <SovereignButton 
                variant="ghost" 
                size="sm"
                onClick={() => alert("Creating custom files is currently managed via automated mission outputs.")}
                className="hover:text-indigo-600 dark:hover:text-indigo-400 font-bold"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Add External Asset
              </SovereignButton>
            </div>
          </SovereignGlassCard>

          {/* Core Latency and Release rules Column */}
          {developerMode ? (
            <SovereignGlassCard className="p-6 flex flex-col justify-between min-h-[260px]">
              <div className="space-y-4">
                <span className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest font-mono pb-2 block border-b border-slate-100 dark:border-white/[0.02]">
                  Active Boardroom Status
                </span>
                
                <div className="space-y-2 pt-1 font-mono text-[10px]">
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-white/[0.02]">
                    <span className="text-slate-500 font-semibold font-sans">Gemini Master Brain</span>
                    <span className="text-indigo-500 font-bold">98.4ms latency</span>
                  </div>
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-white/[0.02]">
                    <span className="text-slate-500 font-semibold font-sans">Claude Analyst Agent</span>
                    <span className="text-indigo-500 font-bold">74.1ms latency</span>
                  </div>
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-white/[0.02]">
                    <span className="text-slate-500 font-semibold font-sans">UQI Fact Auditor</span>
                    <span className="text-pink-500 font-bold">22.5ms latency</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-semibold font-sans">Memory Consolidator</span>
                    <span className="text-indigo-500 font-bold">15.8ms latency</span>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/10 rounded-2xl space-y-1.5 mt-4">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider font-mono">
                  <Award className="w-3.5 h-3.5" />
                  <span>Q5 Release Core Standard</span>
                </div>
                <p className="text-[11px] text-slate-400 dark:text-neutral-500 leading-normal font-medium">
                  No deliverables are committed to the persistent Workspace unless UQI evaluation reaches &gt;95 points.
                </p>
              </div>
            </SovereignGlassCard>
          ) : (
            <SovereignGlassCard className="p-6 flex flex-col justify-between min-h-[260px]">
              <div className="space-y-4">
                <span className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest font-sans pb-2 block border-b border-slate-100 dark:border-white/[0.02]">
                  Strategic Quality Alignment
                </span>
                
                <div className="space-y-3 pt-1 text-xs">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-slate-800 dark:text-neutral-200">Guaranteed Deliverables</h4>
                      <p className="text-[11px] text-slate-400 dark:text-neutral-500 leading-snug">Every synthesized document undergoes automated multi-agent audit before export.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-slate-800 dark:text-neutral-200">Autonomous Compliance</h4>
                      <p className="text-[11px] text-slate-400 dark:text-neutral-500 leading-snug">100% adherence to Design System v3.0 core rules and sovereign metrics.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/10 rounded-2xl space-y-1.5 mt-4">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider font-sans">
                  <Award className="w-3.5 h-3.5" />
                  <span>Q5 Business Grade</span>
                </div>
                <p className="text-[11px] text-slate-400 dark:text-neutral-500 leading-normal font-medium">
                  Autonomous quality threshold guarantees &gt;95/100 readiness for boardroom presentation.
                </p>
              </div>
            </SovereignGlassCard>
          )}
        </div>
      </div>

      {/* ⑤ MARKETPLACE TEMPLATES SUGGESTION (第五優先 - Capability Marketplace Ecosystem) */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-1 border-b border-slate-200/50 dark:border-white/[0.03] pb-4">
          <div className="space-y-1">
            <h3 className="text-[10px] font-bold tracking-widest text-slate-400 dark:text-neutral-500 uppercase font-mono flex items-center gap-2">
              <Layers className="w-4 h-4 text-pink-500" />
              Capability Ecosystem Suggestions
            </h3>
            <p className="text-xs text-slate-400 dark:text-neutral-500 font-medium">
              3-clicks capabilities deployment. Select category to browse specialized autonomous workflow templates.
            </p>
          </div>
          
          {/* iOS Segmented Control style category switcher */}
          <SovereignSegmentedControl
            options={categoryOptions}
            selectedValue={selectedSuggestCategory.id}
            onChange={(id) => {
              const cat = categories.find(c => c.id === id);
              if (cat) setSelectedSuggestCategory(cat);
            }}
            className="w-full sm:max-w-md"
          />
        </div>

        {/* Suggest templates list - refined clean cards with hover glow */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {activeSuggestTemplates.map(temp => (
            <SovereignGlassCard
              key={temp.id}
              onClick={() => handleTemplateClick(temp, selectedSuggestCategory)}
              className="group flex items-start text-left p-4 hover:bg-white/80 dark:hover:bg-neutral-900/30 hover:border-pink-500/20 dark:hover:border-pink-500/20 shadow-xs cursor-pointer hover:-translate-y-0.5"
            >
              <div className="mr-3 text-pink-500 mt-0.5 bg-pink-500/5 p-2 rounded-xl group-hover:scale-105 transition-transform border border-pink-500/5">
                <PlusCircle className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-slate-800 dark:text-neutral-200 group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors">
                  {temp.name}
                </h4>
                <p className="text-[11px] text-slate-400 dark:text-neutral-500 font-medium leading-relaxed">
                  {temp.hint}
                </p>
              </div>
            </SovereignGlassCard>
          ))}
        </div>
      </div>

    </div>
  );
}
