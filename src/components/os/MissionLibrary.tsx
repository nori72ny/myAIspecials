// MissionLibrary.tsx - Sprint 21: High Fidelity ACOS Mission Library Dashboard
import  { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Search, Star,  History, Sparkles, Play, CheckCircle, 
  AlertTriangle, Lightbulb, Cpu, Layers, Activity, FileText, 
  Check, RotateCcw, Info,  Compass, ChevronRight, Award, Trash2
} from "lucide-react";
import { Mission, SearchFilters } from "./MissionLibraryTypes";
import { generateMissions, MISSION_CATEGORIES } from "./MissionLibraryData";

export default function MissionLibrary() {
  // Initialize exactly 1000 missions from the generator
  const [missions, setMissions] = useState<Mission[]>(() => generateMissions());
  const [selectedMission, setSelectedMission] = useState<Mission | null>(null);
  
  // Tab states
  const [activeSubTab, setActiveSubTab] = useState<"explorer" | "recommendations" | "history">("explorer");

  // Search and filter states
  const [filters, setFilters] = useState<SearchFilters>({
    query: "",
    category: "All",
    tag: "",
    onlyFavorites: false,
    factImportance: "All"
  });

  // Simulator state for run executions
  const [runningMission, setRunningMission] = useState<Mission | null>(null);
  const [executionLogs, setExecutionLogs] = useState<string[]>([]);
  const [executionStep, setExecutionStep] = useState<number>(0);
  const [executionSuccess, setExecutionSuccess] = useState<boolean>(false);
  const [runHistory, setRunHistory] = useState<{ id: string; title: string; timestamp: string; status: string; agentUsed: string }[]>([
    { id: "MSN-0001", title: "毎日の習慣化タスク管理 - パターン #1", timestamp: "2026-07-10 12:45", status: "Success", agentUsed: "Web Search Swarm Agent" },
    { id: "MSN-0042", title: "主要クラウドAI(AWS, GCP, Azure)コスト・性能比較 - パターン #1", timestamp: "2026-07-10 11:20", status: "Success", agentUsed: "Math & Stats Specialist Agent" },
    { id: "MSN-0105", title: "TOEIC 800点突破のための3ヶ月英語コーチング計画 - パターン #1", timestamp: "2026-07-09 18:10", status: "Success", agentUsed: "Multilingual Translation Co-pilot" }
  ]);

  // Handle setting selected mission on initial load if empty
  useEffect(() => {
    if (missions.length > 0 && !selectedMission) {
      setSelectedMission(missions[0]);
    }
  }, [missions, selectedMission]);

  // Toggle favorite status
  const toggleFavorite = (missionId: string) => {
    setMissions(prev => prev.map(m => {
      if (m.id === missionId) {
        const nextFav = !m.isFavorite;
        // Update selectedMission details in real-time too
        if (selectedMission && selectedMission.id === missionId) {
          setSelectedMission({ ...selectedMission, isFavorite: nextFav });
        }
        return { ...m, isFavorite: nextFav };
      }
      return m;
    }));
  };

  // Run/Test simulation logic
  const handleRunMission = (mission: Mission) => {
    setRunningMission(mission);
    setExecutionLogs([]);
    setExecutionStep(1);
    setExecutionSuccess(false);

    // Dynamic execution steps simulator
    const logs = [
      `[INIT] ACOS-OS Kernel initiating Mission: ${mission.id} (${mission.title})`,
      `[RESOURCE] Allocating processor units on required AI: ${mission.requiredAI}`,
      `[AGENT] Spawning specialized swarm intelligence: ${mission.requiredAgent}`,
      `[FACT_CHECK] Fetching verified factual groundings (Fact Importance: ${mission.factImportance})...`,
      `[ORCHESTRATOR] Aligning deliverables to match: ${mission.deliverableType}`,
      `[EVALUATION] Matching output stream with target scoring metrics...`,
      `[SUCCESS] Mission executed flawlessly! Metric confidence rating: 99.8%`
    ];

    let current = 0;
    const interval = setInterval(() => {
      if (current < logs.length) {
        setExecutionLogs(prev => [...prev, logs[current]]);
        setExecutionStep(current + 1);
        current++;
      } else {
        clearInterval(interval);
        setExecutionSuccess(true);
        // Increment runCount on mission
        setMissions(prev => prev.map(m => {
          if (m.id === mission.id) {
            const nextRunCount = m.runCount + 1;
            if (selectedMission && selectedMission.id === mission.id) {
              setSelectedMission({ ...selectedMission, runCount: nextRunCount });
            }
            return { ...m, runCount: nextRunCount };
          }
          return m;
        }));
        // Add to historical timeline
        const now = new Date();
        const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        setRunHistory(prev => [
          {
            id: mission.id,
            title: mission.title,
            timestamp: timeStr,
            status: "Success",
            agentUsed: mission.requiredAgent
          },
          ...prev
        ]);
      }
    }, 450);
  };

  // Recommendations logic (system recommendations based on high runs and balanced categories)
  const recommendations = useMemo(() => {
    // Pick 5 top distinct missions from different categories
    return missions.filter(m => m.runCount > 50).slice(0, 5);
  }, [missions]);

  // Extract all distinct tags from the 1000 missions for the filter list
  const popularTags = useMemo(() => {
    return ["ACOS-OS", "基礎編", "応用編-1", "応用編-2", "Fact-Critical", "Fact-High", "日常", "仕事", "営業", "プログラミング", "AI開発"];
  }, []);

  // Filtering implementation
  const filteredMissions = useMemo(() => {
    return missions.filter(m => {
      // Search text matches title, objective, goal, or tags
      const queryLower = filters.query.toLowerCase();
      const matchesQuery = !filters.query || 
        m.title.toLowerCase().includes(queryLower) ||
        m.id.toLowerCase().includes(queryLower) ||
        m.objective.toLowerCase().includes(queryLower) ||
        m.goal.toLowerCase().includes(queryLower) ||
        m.tags.some(t => t.toLowerCase().includes(queryLower));

      const matchesCategory = filters.category === "All" || m.category === filters.category;
      
      const matchesTag = !filters.tag || m.tags.includes(filters.tag);
      
      const matchesFavorite = !filters.onlyFavorites || m.isFavorite;
      
      const matchesFactImportance = filters.factImportance === "All" || m.factImportance === filters.factImportance;

      return matchesQuery && matchesCategory && matchesTag && matchesFavorite && matchesFactImportance;
    });
  }, [missions, filters]);

  // Overall Statistics computed dynamically
  const stats = useMemo(() => {
    const total = missions.length;
    const favorites = missions.filter(m => m.isFavorite).length;
    const criticalCount = missions.filter(m => m.factImportance === "Critical").length;
    const totalRuns = missions.reduce((acc, m) => acc + m.runCount, 0);

    return { total, favorites, criticalCount, totalRuns };
  }, [missions]);

  // Reset all filters easily
  const resetFilters = () => {
    setFilters({
      query: "",
      category: "All",
      tag: "",
      onlyFavorites: false,
      factImportance: "All"
    });
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 bg-slate-950 text-slate-100 rounded-3xl p-6 border border-slate-900 shadow-2xl overflow-hidden" id="mission-library-root">
      
      {/* ========================================================================= */}
      {/* LEFT: HEADER & CORE STATS (12 spans out of 12) */}
      {/* ========================================================================= */}
      <div className="xl:col-span-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-900 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-rose-600/10 rounded-xl border border-rose-500/20">
              <Award className="w-6 h-6 text-rose-500 animate-pulse" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight bg-gradient-to-r from-white via-slate-200 to-rose-400 bg-clip-text text-transparent">
                ACOS MISSION LIBRARY (ACOS-ML)
              </h2>
              <p className="text-xs text-slate-400 font-mono">
                Sprint 21: High-Performance Swarm Orchestration • Golden Answers Suite (Minimum 1000 Missions Loaded)
              </p>
            </div>
          </div>
        </div>

        {/* Global Performance Counters */}
        <div className="flex flex-wrap gap-4 bg-slate-900/40 p-1.5 rounded-2xl border border-slate-800/40">
          <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-900 text-center min-w-[100px]">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Total Missions</p>
            <p className="text-sm font-black text-rose-400 font-mono">{stats.total}</p>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-900 text-center min-w-[100px]">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Favorites</p>
            <p className="text-sm font-black text-amber-400 font-mono flex items-center justify-center gap-1">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              {stats.favorites}
            </p>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-900 text-center min-w-[100px]">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Critical Fact</p>
            <p className="text-sm font-black text-indigo-400 font-mono">{stats.criticalCount}</p>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-900 text-center min-w-[100px]">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Simulated Runs</p>
            <p className="text-sm font-black text-emerald-400 font-mono">{stats.totalRuns}</p>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* CENTRAL CONTROLS & SUB TABS (12 spans out of 12) */}
      {/* ========================================================================= */}
      <div className="xl:col-span-12 flex flex-col md:flex-row items-stretch md:items-center gap-4 bg-slate-900/20 p-2.5 rounded-2xl border border-slate-900/60">
        {/* Sub-Tab Navigation */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-900">
          <button
            onClick={() => setActiveSubTab("explorer")}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeSubTab === "explorer" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Compass className="w-3.5 h-3.5 text-rose-500" /> Mission Explorer
          </button>
          <button
            onClick={() => setActiveSubTab("recommendations")}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeSubTab === "recommendations" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Recommendations
          </button>
          <button
            onClick={() => setActiveSubTab("history")}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeSubTab === "history" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <History className="w-3.5 h-3.5 text-indigo-400" /> Execution History
          </button>
        </div>

        {/* Global Search and category/tag reset */}
        <div className="flex-1 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search 1,000+ ACOS Missions (e.g. 経営, LTV, MSN-0005...)"
              value={filters.query}
              onChange={(e) => setFilters(prev => ({ ...prev, query: e.target.value }))}
              className="w-full bg-slate-950 text-slate-200 pl-9 pr-4 py-2 rounded-xl text-xs font-semibold border border-slate-900 focus:border-rose-500/50 focus:outline-none transition-all placeholder:text-slate-600"
            />
          </div>

          <button
            onClick={resetFilters}
            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-950 border border-slate-900 hover:border-slate-800 text-slate-400 hover:text-slate-200 rounded-xl text-xs font-bold transition-all"
            title="Reset Filters"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* EXPLORER VIEW / LAYOUT GRID */}
      {/* ========================================================================= */}
      {activeSubTab === "explorer" && (
        <>
          {/* SIDEBAR FILTERS (col-span-3) */}
          <div className="xl:col-span-3 flex flex-col gap-5">
            {/* Categories Selector */}
            <div className="bg-slate-900/30 p-4 rounded-2xl border border-slate-900">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-850">
                <span className="text-xs font-black text-slate-300 uppercase tracking-widest font-mono">Categories</span>
                <span className="text-[10px] bg-rose-500/10 text-rose-400 px-1.5 py-0.5 rounded font-mono font-bold">24 Total</span>
              </div>
              
              <div className="max-h-[220px] overflow-y-auto space-y-1.5 pr-1 text-xs">
                <button
                  onClick={() => setFilters(prev => ({ ...prev, category: "All" }))}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg font-semibold flex items-center justify-between transition-all ${
                    filters.category === "All" ? "bg-rose-950/40 text-rose-300 border border-rose-900/30" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <span>🌐 All Categories</span>
                  <span className="text-[10px] font-mono text-slate-500">{missions.length}</span>
                </button>
                {MISSION_CATEGORIES.map(cat => {
                  const count = missions.filter(m => m.category === cat).length;
                  return (
                    <button
                      key={cat}
                      onClick={() => setFilters(prev => ({ ...prev, category: cat }))}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg font-semibold flex items-center justify-between transition-all ${
                        filters.category === cat ? "bg-rose-950/40 text-rose-300 border border-rose-900/30" : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <span>📂 {cat}</span>
                      <span className="text-[10px] font-mono text-slate-500">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Fact Importance Selector */}
            <div className="bg-slate-900/30 p-4 rounded-2xl border border-slate-900">
              <span className="text-xs font-black text-slate-300 uppercase tracking-widest font-mono block mb-3 pb-2 border-b border-slate-850">Fact Importance</span>
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                {["All", "Low", "Medium", "High", "Critical"].map(level => (
                  <button
                    key={level}
                    onClick={() => setFilters(prev => ({ ...prev, factImportance: level }))}
                    className={`px-2 py-1.5 rounded-lg font-semibold border transition-all text-center ${
                      filters.factImportance === level
                        ? "bg-rose-950/40 text-rose-300 border-rose-900"
                        : "bg-slate-950/40 text-slate-400 border-slate-900 hover:text-slate-200"
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            {/* Favorite Only Switch */}
            <div className="bg-slate-900/30 p-4 rounded-2xl border border-slate-900 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                <span className="text-xs font-bold text-slate-300">Show Favorites Only</span>
              </div>
              <button
                onClick={() => setFilters(prev => ({ ...prev, onlyFavorites: !prev.onlyFavorites }))}
                className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none ${
                  filters.onlyFavorites ? "bg-amber-500" : "bg-slate-800"
                }`}
              >
                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform duration-200 ${
                  filters.onlyFavorites ? "translate-x-4" : "translate-x-0"
                }`} />
              </button>
            </div>

            {/* Popular Tags */}
            <div className="bg-slate-900/30 p-4 rounded-2xl border border-slate-900">
              <span className="text-xs font-black text-slate-300 uppercase tracking-widest font-mono block mb-3 pb-2 border-b border-slate-850">Filter by Tag</span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setFilters(prev => ({ ...prev, tag: "" }))}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                    !filters.tag ? "bg-rose-900/30 text-rose-300 border-rose-900" : "bg-slate-950/40 text-slate-500 border-slate-900 hover:text-slate-300"
                  }`}
                >
                  Clear Tag
                </button>
                {popularTags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => setFilters(prev => ({ ...prev, tag }))}
                    className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                      filters.tag === tag ? "bg-rose-900/30 text-rose-300 border-rose-900" : "bg-slate-950/40 text-slate-500 border-slate-900 hover:text-slate-300"
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* MIDDLE: MISSION LIST (col-span-4) */}
          <div className="xl:col-span-4 flex flex-col gap-4">
            <div className="flex items-center justify-between bg-slate-900/20 p-3 rounded-xl border border-slate-900">
              <span className="text-xs font-bold text-slate-400">
                Found <span className="text-rose-400 font-bold font-mono">{filteredMissions.length}</span> matching missions
              </span>
              <span className="text-[10px] font-mono text-slate-500">ACOS Index</span>
            </div>

            <div className="max-h-[560px] overflow-y-auto space-y-2 pr-1">
              <AnimatePresence>
                {filteredMissions.length === 0 ? (
                  <div className="text-center py-12 bg-slate-900/20 rounded-2xl border border-slate-900 border-dashed">
                    <AlertTriangle className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-xs font-bold text-slate-400">No missions match your active search filters.</p>
                    <button
                      onClick={resetFilters}
                      className="mt-3 text-xs text-rose-400 font-bold hover:underline"
                    >
                      Clear all filters
                    </button>
                  </div>
                ) : (
                  filteredMissions.map(mission => {
                    const isSelected = selectedMission?.id === mission.id;
                    return (
                      <motion.div
                        key={mission.id}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        onClick={() => setSelectedMission(mission)}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                          isSelected 
                            ? "bg-slate-900 border-rose-500/40 shadow-lg shadow-rose-500/5" 
                            : "bg-slate-950/60 border-slate-900 hover:border-slate-800 hover:bg-slate-900/30"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-[10px] font-black text-rose-400 font-mono tracking-wider bg-rose-500/10 px-1.5 py-0.5 rounded">
                            {mission.id}
                          </span>
                          <div className="flex items-center gap-1">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              mission.factImportance === "Critical" ? "bg-rose-500/10 text-rose-400" :
                              mission.factImportance === "High" ? "bg-amber-500/10 text-amber-400" :
                              mission.factImportance === "Medium" ? "bg-indigo-500/10 text-indigo-400" : "bg-slate-800 text-slate-400"
                            }`}>
                              Fact: {mission.factImportance}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite(mission.id);
                              }}
                              className="p-1 text-slate-500 hover:text-amber-400 transition-colors"
                            >
                              <Star className={`w-3.5 h-3.5 ${mission.isFavorite ? "fill-amber-400 text-amber-400" : ""}`} />
                            </button>
                          </div>
                        </div>

                        <h4 className="text-xs font-black text-slate-200 mt-2 line-clamp-1">
                          {mission.title}
                        </h4>

                        <div className="flex flex-wrap gap-1 mt-2.5">
                          <span className="text-[9px] font-bold bg-slate-900 text-slate-400 px-2 py-0.5 rounded-md">
                            {mission.category}
                          </span>
                          <span className="text-[9px] font-mono text-slate-500 px-2 py-0.5 bg-slate-950 rounded-md">
                            {mission.requiredAI.split(" ")[0]}
                          </span>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* RIGHT: DETAILED INSPECTION (col-span-5) */}
          <div className="xl:col-span-5">
            {selectedMission ? (
              <div className="bg-slate-900/40 rounded-3xl border border-slate-900 p-6 flex flex-col gap-5 h-full max-h-[640px] overflow-y-auto">
                {/* Header info */}
                <div className="flex items-start justify-between gap-4 border-b border-slate-900 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-rose-400 font-mono bg-rose-500/10 px-2 py-0.5 rounded">
                        {selectedMission.id}
                      </span>
                      <span className="text-xs font-bold text-slate-500 font-mono">
                        {selectedMission.category}
                      </span>
                    </div>
                    <h3 className="text-base font-black text-white mt-1.5">
                      {selectedMission.title}
                    </h3>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => toggleFavorite(selectedMission.id)}
                      className="p-2 bg-slate-950 border border-slate-900 hover:border-slate-800 text-slate-400 hover:text-amber-400 rounded-xl transition-all"
                      title="Add to Favorites"
                    >
                      <Star className={`w-4 h-4 ${selectedMission.isFavorite ? "fill-amber-400 text-amber-400" : ""}`} />
                    </button>
                    
                    <button
                      onClick={() => handleRunMission(selectedMission)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-black shadow-lg shadow-rose-600/20 transition-all"
                    >
                      <Play className="w-3.5 h-3.5" /> Run Mission
                    </button>
                  </div>
                </div>

                {/* Main Metadata Blocks */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-900/60">
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 font-bold uppercase tracking-wider font-mono">
                      <Cpu className="w-3.5 h-3.5 text-rose-400" /> Required LLM
                    </div>
                    <p className="text-xs font-black text-slate-200 mt-1">{selectedMission.requiredAI}</p>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-900/60">
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 font-bold uppercase tracking-wider font-mono">
                      <Layers className="w-3.5 h-3.5 text-indigo-400" /> Required Swarm Agent
                    </div>
                    <p className="text-xs font-black text-slate-200 mt-1">{selectedMission.requiredAgent}</p>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-900/60">
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 font-bold uppercase tracking-wider font-mono">
                      <Activity className="w-3.5 h-3.5 text-amber-400" /> Fact Importance Score
                    </div>
                    <p className="text-xs font-black text-slate-200 mt-1 flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${
                        selectedMission.factImportance === "Critical" ? "bg-rose-500 animate-pulse" :
                        selectedMission.factImportance === "High" ? "bg-amber-500" :
                        selectedMission.factImportance === "Medium" ? "bg-indigo-500" : "bg-slate-400"
                      }`} />
                      {selectedMission.factImportance}
                    </p>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-900/60">
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 font-bold uppercase tracking-wider font-mono">
                      <FileText className="w-3.5 h-3.5 text-emerald-400" /> Deliverable Format
                    </div>
                    <p className="text-xs font-black text-slate-200 mt-1 truncate" title={selectedMission.deliverableType}>
                      {selectedMission.deliverableType}
                    </p>
                  </div>
                </div>

                {/* Detailed descriptions */}
                <div className="space-y-4">
                  {/* Objective */}
                  <div>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono block mb-1">目的 (Objective)</span>
                    <p className="text-xs text-slate-300 bg-slate-950 p-3 rounded-xl border border-slate-900 leading-relaxed font-semibold">
                      {selectedMission.objective}
                    </p>
                  </div>

                  {/* Goal */}
                  <div>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono block mb-1">ゴール (Goal)</span>
                    <p className="text-xs text-slate-300 bg-slate-950 p-3 rounded-xl border border-slate-900 leading-relaxed font-semibold">
                      {selectedMission.goal}
                    </p>
                  </div>

                  {/* Evaluation Criteria */}
                  <div>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono block mb-1">評価基準 (Evaluation Metrics)</span>
                    <div className="bg-slate-950 p-3 rounded-xl border border-slate-900 space-y-1.5">
                      {selectedMission.evaluationCriteria.map((crit, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          <span>{crit}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Ideal Answer */}
                  <div>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono block mb-1">理想回答 (Golden Answer)</span>
                    <pre className="text-[11px] text-emerald-300 bg-slate-950 p-3.5 rounded-xl border border-emerald-950/60 overflow-x-auto font-mono whitespace-pre-wrap leading-relaxed">
                      {selectedMission.idealAnswer}
                    </pre>
                  </div>

                  {/* NG Answer */}
                  <div>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono block mb-1">NG回答 (Forbidden Pattern)</span>
                    <div className="bg-rose-950/20 p-3.5 rounded-xl border border-rose-950/60 text-xs text-rose-300 flex gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <p className="leading-relaxed font-mono whitespace-pre-wrap">{selectedMission.ngAnswer}</p>
                    </div>
                  </div>

                  {/* Improvement Points */}
                  <div>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono block mb-1">改善ポイント (Key Improvements)</span>
                    <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-900 space-y-2">
                      {selectedMission.improvementPoints.map((pt, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                          <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                          <span>{pt}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-slate-900/10 border border-slate-900 border-dashed rounded-3xl min-h-[400px]">
                <Info className="w-8 h-8 text-slate-600 mb-2" />
                <p className="text-xs text-slate-400 font-bold">Select a mission from the list to inspect its golden metadata.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ========================================================================= */}
      {/* RECOMMENDATIONS TAB */}
      {/* ========================================================================= */}
      {activeSubTab === "recommendations" && (
        <div className="xl:col-span-12 space-y-6">
          <div className="bg-slate-900/20 p-4 rounded-2xl border border-slate-900">
            <h3 className="text-sm font-black text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" /> Highly Recommended ACOS Swarm Missions
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Top trending missions based on target validation workloads, complexity, and overall platform evaluation frequency.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recommendations.map(mission => (
              <div key={mission.id} className="bg-slate-900/40 p-5 rounded-2xl border border-slate-900/80 flex flex-col justify-between gap-4">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono bg-rose-500/10 text-rose-400 px-2 py-0.5 rounded font-black">
                      {mission.id}
                    </span>
                    <span className="text-[10px] text-slate-500 font-bold uppercase font-mono">
                      {mission.category}
                    </span>
                  </div>
                  <h4 className="text-xs font-black text-white mt-3 line-clamp-2">
                    {mission.title}
                  </h4>
                  <p className="text-xs text-slate-400 mt-2 line-clamp-3">
                    {mission.objective}
                  </p>
                </div>

                <div className="border-t border-slate-900/80 pt-3 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
                    <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                    <span>Run Count: {mission.runCount}</span>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedMission(mission);
                      setActiveSubTab("explorer");
                    }}
                    className="flex items-center gap-1 text-[10px] font-black text-rose-400 hover:text-rose-300 transition-colors"
                  >
                    Inspect details <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* HISTORY TAB */}
      {/* ========================================================================= */}
      {activeSubTab === "history" && (
        <div className="xl:col-span-12 space-y-6">
          <div className="bg-slate-900/20 p-4 rounded-2xl border border-slate-900 flex justify-between items-center">
            <div>
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <History className="w-4 h-4 text-indigo-400" /> ACOS Execution Stream Log
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Real-time tracking of simulated mission executions across local AI workloads.
              </p>
            </div>
            <button
              onClick={() => setRunHistory([])}
              className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1.5 font-bold"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear History
            </button>
          </div>

          <div className="bg-slate-950 rounded-2xl border border-slate-900 overflow-hidden text-xs">
            {runHistory.length === 0 ? (
              <div className="text-center py-12">
                <History className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                <p className="text-xs text-slate-500">No runs executed yet. Select a mission in Explorer and click 'Run Mission'.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-900">
                {runHistory.map((run, idx) => (
                  <div key={idx} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-900/20 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20 mt-0.5">
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-rose-400 font-bold">{run.id}</span>
                          <span className="font-bold text-slate-200">{run.title}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1 font-mono">
                          Swarm Agent: {run.agentUsed} • Executed perfectly on virtual engine
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                      <span className="text-[10px] text-slate-500 font-mono">{run.timestamp}</span>
                      <span className="bg-emerald-500/10 text-emerald-400 font-mono text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
                        {run.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* LIVE SIMULATION MODAL OVERLAY */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {runningMission && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-950 border border-slate-900 rounded-3xl p-6 max-w-xl w-full shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-rose-500 via-indigo-500 to-emerald-500" />
              
              <div className="flex items-start justify-between gap-4 border-b border-slate-900 pb-4">
                <div>
                  <span className="text-[10px] bg-rose-500/10 text-rose-400 px-2 py-0.5 rounded font-mono font-bold">
                    ACOS-OS EXECUTOR
                  </span>
                  <h4 className="text-sm font-black text-white mt-1.5">{runningMission.title}</h4>
                </div>
                <button
                  onClick={() => setRunningMission(null)}
                  className="text-xs text-slate-400 hover:text-white font-black"
                  disabled={!executionSuccess}
                >
                  ✕ Close
                </button>
              </div>

              {/* Terminal Logs View */}
              <div className="bg-black border border-slate-900 p-4 rounded-xl my-4 h-[220px] overflow-y-auto font-mono text-xs text-slate-300 space-y-1.5 scrollbar-thin">
                {executionLogs.map((log, idx) => (
                  <div key={idx} className={
                    log.includes("[SUCCESS]") ? "text-emerald-400 font-bold" :
                    log.includes("[INIT]") ? "text-rose-400" :
                    log.includes("[AGENT]") ? "text-indigo-300" : "text-slate-400"
                  }>
                    {log}
                  </div>
                ))}
                {!executionSuccess && (
                  <div className="flex items-center gap-2 text-slate-500 animate-pulse text-[11px] mt-2">
                    <span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-ping" />
                    Analyzing agent state parameters...
                  </div>
                )}
              </div>

              {/* Progress Slider */}
              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 font-mono mb-4">
                <span>PROGRESS STATUS</span>
                <span>{Math.floor((executionStep / 7) * 100)}%</span>
              </div>

              {/* Action Button */}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setRunningMission(null)}
                  className={`w-full py-2.5 rounded-xl text-xs font-black transition-all ${
                    executionSuccess 
                      ? "bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20" 
                      : "bg-slate-900 text-slate-500 cursor-not-allowed"
                  }`}
                  disabled={!executionSuccess}
                >
                  {executionSuccess ? "ACOS Swarm Verified • Close Console" : "Executing Mission Swarms..."}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
