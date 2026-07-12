import React, { useState, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Mic, 
  Send, 
  Sparkles, 
  Command, 
  History, 
  Search, 
  Zap, 
  LayoutTemplate, 
  Database, 
  ChevronRight,
  BrainCircuit,
  CornerDownLeft,
  Volume2,
  ShieldCheck,
  AlertTriangle
} from "lucide-react";
import { 
  ACOSValidationManager, 
  classifyContent,
  getMissionComplexity,
  extractEvidence,
  getProviderSelectionReason,
  calculateScoreForDisplay
} from "../utils/MissionValidator";

export interface MissionInputProps {
  /**
   * Callback function called when the user submits a mission
   */
  onSubmit?: (prompt: string) => void;
  /**
   * Initial value of the prompt input field
   */
  initialValue?: string;
  /**
   * Placeholder text for the input field
   */
  placeholder?: string;
}

export default function MissionInput({
  onSubmit,
  initialValue = "",
  placeholder = "What is your next mission?"
}: MissionInputProps) {
  const [prompt, setPrompt] = useState(initialValue);
  const [isFocused, setIsFocused] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const liveScanResult = useMemo(() => {
    if (!prompt.trim() || prompt.trim().length < 3) return null;
    const detectedCap = classifyContent(prompt);
    
    // Calculate V3 Complexity
    const complexityInfo = getMissionComplexity(prompt);
    
    // Extract keyword matching evidence
    const evidenceKeywords = extractEvidence(prompt, detectedCap);
    
    let validationStatus = "Analyzing...";
    let statusColor = "text-amber-400";
    let matchRate = 0;
    
    if (prompt.trim().length < 10) {
      validationStatus = "詳細不足 (Pre-flight保留中)";
      statusColor = "text-amber-400/80";
      matchRate = Math.min(60, prompt.trim().length * 6);
    } else {
      validationStatus = "Pre-flight検証成功";
      statusColor = "text-emerald-400";
      matchRate = Math.min(100, 80 + prompt.trim().length);
    }

    const manager = ACOSValidationManager.getInstance();
    const allProviders = manager.registry.getAllProviders();

    // Score and rank for TOP3
    const scoredList = allProviders.map(p => {
      const scores = calculateScoreForDisplay(p, [detectedCap], "quality");
      const selectionReason = getProviderSelectionReason(
        p.name,
        p.metrics.quality,
        p.metrics.cost,
        p.metrics.latency,
        detectedCap
      );
      return {
        id: p.id,
        name: p.name,
        provider: p.adapterId,
        quality: p.metrics.quality,
        cost: p.metrics.cost,
        latency: p.metrics.latency,
        health: p.health,
        overallScore: Number((scores.overall * 10).toFixed(1)),
        selectionReason,
        scores
      };
    });

    // Sort descending by score
    scoredList.sort((a, b) => b.overallScore - a.overallScore);
    const top3 = scoredList.slice(0, 3);
    const primaryProvider = top3[0];
    
    return {
      capability: detectedCap,
      matchRate,
      status: validationStatus,
      statusColor,
      complexity: complexityInfo.level,
      complexityReason: complexityInfo.reason,
      evidence: evidenceKeywords,
      top3,
      primaryProvider
    };
  }, [prompt]);

  const quickActions = [
    { icon: Zap, label: "Execute Market Research", color: "text-blue-500 dark:text-blue-400", bg: "bg-blue-500/10" },
    { icon: LayoutTemplate, label: "Design System Architecture", color: "text-emerald-500 dark:text-emerald-400", bg: "bg-emerald-500/10" },
    { icon: Database, label: "Build Data Analysis Model", color: "text-purple-500 dark:text-purple-400", bg: "bg-purple-500/10" },
  ];

  const recentMissions = [
    "Design frontend architecture for ACOS 2.0",
    "SWOT analysis and competitor research",
    "Propose customer support automation with LLM"
  ];

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim()) return;
    
    if (onSubmit) {
      onSubmit(prompt);
    }
  };

  const handleActionClick = (actionLabel: string) => {
    setPrompt(actionLabel);
    inputRef.current?.focus();
  };

  const toggleVoiceInput = () => {
    setIsListening(prev => !prev);
    if (!isListening) {
      // Simulate voice typing
      const phrase = "Analyze current market trends...";
      let currentText = "";
      let i = 0;
      const interval = setInterval(() => {
        if (i < phrase.length) {
          currentText += phrase[i];
          setPrompt(prev => prev + phrase[i]);
          i++;
        } else {
          clearInterval(interval);
          setIsListening(false);
        }
      }, 50);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 relative z-50 group/mission">
      {/* Background Glow Effect - Brain Activity Visualization */}
      <div className="absolute -inset-4 bg-gradient-to-r from-indigo-500/20 via-purple-500/20 to-pink-500/20 rounded-[40px] blur-3xl opacity-0 group-hover/mission:opacity-100 transition-opacity duration-700 pointer-events-none -z-10" />

      {/* Main Glassmorphism Container */}
      <motion.div 
        layout
        className={`relative flex flex-col bg-white/70 dark:bg-[#0A0A0C]/70 backdrop-blur-3xl border border-black/[0.08] dark:border-white/[0.08] rounded-[32px] overflow-hidden transition-all duration-500 ease-out ${
          isFocused 
            ? 'shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] dark:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] ring-1 ring-black/5 dark:ring-white/10' 
            : 'shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.2)]'
        }`}
      >
        {/* Active Listening Indicator */}
        <AnimatePresence>
          {isListening && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 animate-pulse"
            />
          )}
        </AnimatePresence>

        <form onSubmit={handleSubmit} className="flex flex-col w-full relative z-10">
          {/* Primary Input Area (Raycast / Spotlight style) */}
          <div className="flex items-center px-6 py-6 sm:py-7">
            {/* Brain/Intelligence Icon */}
            <div className="flex-shrink-0 mr-4 sm:mr-6 relative">
              <div className="absolute inset-0 bg-indigo-500/20 blur-md rounded-full" />
              <div className="relative w-12 h-12 flex items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-inner border border-white/20">
                <BrainCircuit className="w-6 h-6 text-white" />
              </div>
            </div>

            {/* Main Input */}
            <input
              ref={inputRef}
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setTimeout(() => setIsFocused(false), 200)}
              placeholder={placeholder}
              className="flex-1 bg-transparent border-none text-2xl sm:text-3xl font-medium tracking-tight text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus-visible:ring-0 focus-visible:outline-none leading-tight"
            />

            {/* Right Actions */}
            <div className="flex items-center gap-3 flex-shrink-0 ml-4">
              <button
                type="button"
                onClick={toggleVoiceInput}
                className={`p-3 rounded-full transition-colors ${
                  isListening 
                    ? 'bg-rose-500/10 text-rose-500' 
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                {isListening ? <Volume2 className="w-5 h-5 animate-pulse" /> : <Mic className="w-5 h-5" />}
              </button>
              
              <button
                type="submit"
                disabled={!prompt.trim()}
                className="group relative flex items-center justify-center w-12 h-12 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-transform active:scale-95 shadow-sm"
              >
                <Send className="w-5 h-5 translate-x-[-1px] translate-y-[1px] group-hover:translate-x-0 group-hover:translate-y-0 transition-transform" />
              </button>
            </div>
          </div>

          {liveScanResult && (
            <div className="px-6 pb-6 pt-2 border-t border-black/5 dark:border-white/5 bg-slate-50/20 dark:bg-white/[0.01]">
              <div className="p-5 rounded-2xl bg-[#09090C] border border-white/5 space-y-4 shadow-2xl">
                
                {/* 1. Card Header */}
                <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                  <span className="text-[10px] font-black font-mono tracking-wider text-indigo-400 uppercase flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 animate-pulse text-indigo-400" />
                    ACOS V3 • EXPLAINABLE ROUTING CONTROL
                  </span>
                  <span className={`text-[9px] font-mono font-bold flex items-center gap-1 ${liveScanResult.statusColor}`}>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {liveScanResult.status}
                  </span>
                </div>

                {/* 2. Responsive Side-by-Side Split Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 text-xs">
                  
                  {/* Left Column: Input Analysis (Complexity & Capability Matches) */}
                  <div className="lg:col-span-5 space-y-4 border-r border-white/5 pr-0 lg:pr-5">
                    
                    {/* Mission Complexity Panel */}
                    <div className="space-y-1.5">
                      <div className="text-[9px] text-white/40 font-mono uppercase tracking-wider">Mission Complexity</div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-black font-mono tracking-wide px-2.5 py-0.5 rounded border uppercase ${
                          liveScanResult.complexity === "Very High"
                            ? "bg-rose-500/15 text-rose-400 border-rose-500/20"
                            : liveScanResult.complexity === "High"
                              ? "bg-amber-500/15 text-amber-400 border-amber-500/20"
                              : liveScanResult.complexity === "Medium"
                                ? "bg-blue-500/15 text-blue-400 border-blue-500/20"
                                : "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                        }`}>
                          {liveScanResult.complexity}
                        </span>
                        <span className="text-[10px] text-white/50">Auto-Detected</span>
                      </div>
                      <p className="text-[10.5px] text-white/70 leading-relaxed bg-white/[0.02] p-2 border border-white/5 rounded-lg">
                        {liveScanResult.complexityReason}
                      </p>
                    </div>

                    {/* Capability Match Reasons */}
                    <div className="space-y-1.5">
                      <div className="text-[9px] text-white/40 font-mono uppercase tracking-wider">Capability Matching Reason & Evidence</div>
                      <div className="bg-white/[0.02] border border-white/5 rounded-lg p-2.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white text-[11px] font-sans">
                            {liveScanResult.capability}
                          </span>
                          <span className="text-[9px] text-emerald-400 font-mono">Matched {liveScanResult.matchRate}%</span>
                        </div>
                        
                        <div className="space-y-1">
                          <div className="text-[8.5px] text-white/40 uppercase font-mono">抽出根拠キーワード:</div>
                          <div className="flex flex-wrap gap-1">
                            {liveScanResult.evidence.length > 0 ? (
                              liveScanResult.evidence.map((word, idx) => (
                                <span key={idx} className="bg-white/5 border border-white/10 text-white/80 text-[9.5px] px-1.5 py-0.2 rounded font-mono">
                                  ・{word}
                                </span>
                              ))
                            ) : (
                              <span className="text-[9.5px] text-white/30 italic">文脈キーワードから推論</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>

                  {/* Right Column: Dynamic Provider Decision & Top 3 Comparison */}
                  <div className="lg:col-span-7 space-y-4">
                    
                    {/* Why this Provider Card */}
                    <div className="space-y-1.5">
                      <div className="text-[9px] text-indigo-400 font-mono uppercase tracking-wider flex items-center gap-1">
                        <Sparkles className="w-2.5 h-2.5" />
                        Why this Provider? (選定理由)
                      </div>
                      <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl space-y-2">
                        <div className="flex items-center justify-between border-b border-indigo-500/10 pb-1.5">
                          <span className="font-extrabold text-white text-[12px] font-sans">
                            {liveScanResult.primaryProvider ? liveScanResult.primaryProvider.name : "Evaluating..."}
                          </span>
                          <span className="text-[10px] font-mono bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded font-bold">
                            Overall Score: {liveScanResult.primaryProvider ? liveScanResult.primaryProvider.overallScore : 0}
                          </span>
                        </div>
                        <p className="text-[10.5px] text-indigo-100/90 leading-relaxed italic">
                          💡 {liveScanResult.primaryProvider ? liveScanResult.primaryProvider.selectionReason : ""}
                        </p>
                        
                        {/* Dynamic Metrics Badges */}
                        {liveScanResult.primaryProvider && (
                          <div className="grid grid-cols-4 gap-1.5 pt-1 text-center text-[9px] font-mono font-bold">
                            <div className="bg-[#09090C] border border-white/5 p-1 rounded">
                              <div className="text-white/40 text-[8px] uppercase">Quality</div>
                              <div className="text-indigo-300 text-[10.5px]">{liveScanResult.primaryProvider.quality}/10</div>
                            </div>
                            <div className="bg-[#09090C] border border-white/5 p-1 rounded">
                              <div className="text-white/40 text-[8px] uppercase">Cost</div>
                              <div className="text-emerald-400 text-[10.5px]">{11 - liveScanResult.primaryProvider.cost}/10</div>
                            </div>
                            <div className="bg-[#09090C] border border-white/5 p-1 rounded">
                              <div className="text-white/40 text-[8px] uppercase">Latency</div>
                              <div className="text-cyan-300 text-[10.5px]">{liveScanResult.primaryProvider.latency}ms</div>
                            </div>
                            <div className="bg-[#09090C] border border-white/5 p-1 rounded">
                              <div className="text-white/40 text-[8px] uppercase">Health</div>
                              <div className="text-emerald-400 text-[10.5px]">10/10</div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Top 3 Providers Comparison Panel */}
                    <div className="space-y-1.5">
                      <div className="text-[9px] text-white/40 font-mono uppercase tracking-wider">Recommended Provider TOP3</div>
                      <div className="space-y-1.5">
                        {liveScanResult.top3.map((prov, index) => {
                          const placeName = index === 0 ? "1位" : index === 1 ? "2位" : "3位";
                          const placeColor = index === 0 ? "text-indigo-400 font-black" : index === 1 ? "text-slate-300 font-bold" : "text-amber-600/80 font-bold";
                          return (
                            <div key={prov.id} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-white/5 text-[11px] gap-3 hover:bg-white/[0.04] transition-colors">
                              <div className="flex items-center gap-2 shrink-0">
                                <span className={`text-[10px] w-6 font-mono ${placeColor}`}>{placeName}</span>
                                <span className="font-bold text-white font-sans">{prov.name}</span>
                                <span className="text-[8px] text-white/40 font-mono">({prov.provider})</span>
                              </div>
                              
                              {/* Overall Score Progress Bar */}
                              <div className="flex-1 flex items-center gap-2 justify-end">
                                <div className="hidden sm:block w-16 bg-white/10 h-1 rounded-full overflow-hidden">
                                  <div className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400" style={{ width: `${prov.overallScore}%` }} />
                                </div>
                                <span className="text-[10px] font-mono text-white/90 font-bold shrink-0">
                                  Score: {prov.overallScore}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                  </div>

                </div>

              </div>
            </div>
          )}
        </form>

        {/* Expanded Area: Quick Actions & Recent Missions */}
        <AnimatePresence>
          {isFocused && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="border-t border-black/5 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02]"
            >
              <div className="p-6 sm:p-8 grid grid-cols-1 sm:grid-cols-2 gap-8 sm:gap-12">
                {/* Quick Actions */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                    <Command className="w-4 h-4" />
                    <span>Quick Actions</span>
                  </div>
                  <div className="space-y-1">
                    {quickActions.map((action, idx) => (
                      <button
                        key={idx}
                        onMouseDown={() => handleActionClick(action.label)}
                        className="w-full flex items-center justify-between p-3 rounded-2xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors group/item text-left"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${action.bg} ${action.color}`}>
                            <action.icon className="w-4 h-4" />
                          </div>
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-300 group-hover/item:text-slate-900 dark:group-hover/item:text-white transition-colors">
                            {action.label}
                          </span>
                        </div>
                        <CornerDownLeft className="w-4 h-4 text-slate-300 dark:text-slate-600 opacity-0 group-hover/item:opacity-100 transition-opacity" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Recent Missions */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                    <History className="w-4 h-4" />
                    <span>Recent Missions</span>
                  </div>
                  <div className="space-y-1">
                    {recentMissions.map((mission, idx) => (
                      <button
                        key={idx}
                        onMouseDown={() => handleActionClick(mission)}
                        className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors group/item text-left"
                      >
                        <Search className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="text-sm font-medium text-slate-600 dark:text-slate-400 group-hover/item:text-slate-900 dark:group-hover/item:text-slate-200 truncate transition-colors">
                          {mission}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Organization Status Bar (Linear inspired footer) */}
              <div className="px-6 py-3 border-t border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.01] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="text-[11px] font-medium font-mono text-slate-500 dark:text-slate-400">
                    ORG ONLINE &bull; 4 ACTIVE AGENTS
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  <kbd className="px-1.5 py-0.5 rounded-lg bg-black/5 dark:bg-white/10 font-sans">⌘</kbd>
                  <kbd className="px-1.5 py-0.5 rounded-lg bg-black/5 dark:bg-white/10 font-sans">K</kbd>
                  <span className="ml-1">to search Workspace</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
