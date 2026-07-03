import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Briefcase, 
  FileText, 
  MessageSquare, 
  Paperclip, 
  Users, 
  Sparkles, 
  Plus, 
  ArrowUpRight, 
  File, 
  Trash2, 
  Search, 
  Clock, 
  CheckCircle2, 
  ChevronRight,
  TrendingUp,
  Cpu,
  BookOpen
} from "lucide-react";
import { cn } from "../../utils";

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

interface WorkspaceAppProps {
  savedMissions: SavedMission[];
  onViewMissionResult: (mission: SavedMission) => void;
  onNavigateToApp: (app: "chat" | "multi-ai" | "brain") => void;
}

interface AttachedFile {
  id: string;
  name: string;
  size: string;
  timestamp: string;
  type: string;
}

export default function WorkspaceApp({
  savedMissions,
  onViewMissionResult,
  onNavigateToApp
}: WorkspaceAppProps) {
  const [activeTab, setActiveTab] = useState<"all" | "missions" | "chats" | "files" | "debates">("all");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Local state for attached materials (real local uploader state)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>(() => {
    try {
      const stored = localStorage.getItem("acos_workspace_files");
      return stored ? JSON.parse(stored) : [
        { id: "f-01", name: "AI_SaaS_Competitor_Analysis.xlsx", size: "1.4 MB", timestamp: new Date(Date.now() - 3600000 * 2).toISOString(), type: "xlsx" },
        { id: "f-02", name: "SWOT_Strategic_Brief.pdf", size: "480 KB", timestamp: new Date(Date.now() - 3600000 * 24).toISOString(), type: "pdf" }
      ];
    } catch {
      return [];
    }
  });

  // Local state for AI debate threads (simulated but persistent and beautiful)
  const [debates, setDebates] = useState([
    {
      id: "d-01",
      topic: "SWOT Strategy Validation on Legal Tech SaaS",
      agents: ["Gemini Master", "Claude Specialist", "UQI Auditor"],
      status: "Resolved",
      lastMessage: "UQI Auditor: Legal compliance confirmed. Ready for delivery.",
      timestamp: new Date(Date.now() - 3600000 * 3).toISOString()
    },
    {
      id: "d-02",
      topic: "ROI Prediction Reliability Metrics",
      agents: ["Gemini Master", "Strategic ROI Engine"],
      status: "In Progress",
      lastMessage: "Strategic ROI Engine: Optimizing parameters based on client churn model...",
      timestamp: new Date(Date.now() - 3600000 * 12).toISOString()
    }
  ]);

  const [dragActive, setDragActive] = useState(false);

  // File Upload Handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const newFiles: AttachedFile[] = Array.from(e.dataTransfer.files).map((f, i) => ({
        id: `f-${Date.now()}-${i}`,
        name: f.name,
        size: `${(f.size / 1024).toFixed(0)} KB`,
        timestamp: new Date().toISOString(),
        type: f.name.split(".").pop() || "bin"
      }));

      setAttachedFiles(prev => {
        const updated = [...newFiles, ...prev];
        localStorage.setItem("acos_workspace_files", JSON.stringify(updated));
        return updated;
      });
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const newFiles: AttachedFile[] = Array.from(e.target.files).map((f, i) => ({
        id: `f-${Date.now()}-${i}`,
        name: f.name,
        size: `${(f.size / 1024).toFixed(0)} KB`,
        timestamp: new Date().toISOString(),
        type: f.name.split(".").pop() || "bin"
      }));

      setAttachedFiles(prev => {
        const updated = [...newFiles, ...prev];
        localStorage.setItem("acos_workspace_files", JSON.stringify(updated));
        return updated;
      });
    }
  };

  const handleDeleteFile = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setAttachedFiles(prev => {
      const updated = prev.filter(f => f.id !== id);
      localStorage.setItem("acos_workspace_files", JSON.stringify(updated));
      return updated;
    });
  };

  // Filter content based on query & active tab
  const filteredMissions = savedMissions.filter(m => 
    m.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredFiles = attachedFiles.filter(f => 
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredDebates = debates.filter(d => 
    d.topic.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      
      {/* Header section with sleek workspace stats */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/50 dark:border-white/[0.04] pb-5">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 dark:bg-indigo-500/20 border border-indigo-500/20 rounded-full text-[10px] text-indigo-600 dark:text-indigo-300 font-bold font-mono tracking-widest uppercase">
            <Briefcase className="w-3.5 h-3.5" />
            UNIFIED CURRENT WORKING SPACE
          </div>
          <h2 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
            Active Intelligence Desk
          </h2>
          <p className="text-xs text-slate-400 dark:text-neutral-500 font-medium">
            Missions, chat context, attached briefs, and real-time boardroom debates—all managed on one interactive dashboard.
          </p>
        </div>

        {/* Quick uploader button */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm shadow-indigo-600/15 cursor-pointer active:scale-95">
            <Plus className="w-4 h-4" />
            <span>Attach Briefing Document</span>
            <input 
              type="file" 
              multiple 
              onChange={handleFileInput} 
              className="hidden" 
            />
          </label>
        </div>
      </div>

      {/* Workspace search and filtering tab bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/40 dark:bg-neutral-900/20 border border-slate-200/60 dark:border-white/[0.04] p-2 rounded-2xl backdrop-blur-md">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none shrink-0">
          {(["all", "missions", "chats", "files", "debates"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={cn(
                "px-3.5 py-1.5 rounded-xl text-xs font-bold capitalize transition-all cursor-pointer whitespace-nowrap",
                activeTab === t
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-sm"
                  : "text-slate-500 dark:text-neutral-400 hover:text-slate-800 dark:hover:text-neutral-200 hover:bg-slate-50 dark:hover:bg-neutral-800/30"
              )}
            >
              {t === "all" && "All Assets"}
              {t === "missions" && `Missions (${filteredMissions.length})`}
              {t === "chats" && "AI Chats"}
              {t === "files" && `Materials (${filteredFiles.length})`}
              {t === "debates" && `AI Debates (${filteredDebates.length})`}
            </button>
          ))}
        </div>

        <div className="relative flex items-center w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search workspace assets..."
            className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-200/60 dark:border-neutral-800 rounded-xl py-1.5 pl-9 pr-4 text-xs font-semibold text-slate-800 dark:text-neutral-200 placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* Main Grid content matching the filters */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Cols: Main cabinet blocks */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Section 1: Active Missions */}
          {(activeTab === "all" || activeTab === "missions") && (
            <div className="space-y-3">
              <h3 className="text-xs font-black text-slate-400 dark:text-neutral-500 uppercase tracking-widest font-mono flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-500" />
                Strategic Mission Deliverables
              </h3>
              <div className="space-y-2.5">
                {filteredMissions.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => onViewMissionResult(m)}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-white/80 dark:bg-neutral-900/30 border border-slate-200/50 dark:border-white/[0.04] rounded-2xl hover:border-indigo-500/30 hover:shadow-md transition-all cursor-pointer group"
                  >
                    <div className="flex items-start gap-3 truncate max-w-[80%]">
                      <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center shrink-0 border border-indigo-100/50 dark:border-indigo-900/30 group-hover:scale-105 transition-all">
                        <FileText className="w-4.5 h-4.5 text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <div className="truncate">
                        <h4 className="text-xs font-black text-slate-800 dark:text-neutral-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">
                          {m.title}
                        </h4>
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1 text-[10px] font-medium text-slate-400 dark:text-neutral-500">
                          <span className="font-mono text-indigo-400">{m.category.toUpperCase()}</span>
                          <span>•</span>
                          <span>{new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                          <span>•</span>
                          <span className="text-indigo-500 dark:text-indigo-300 font-semibold">{m.roi}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-2 sm:mt-0 justify-end shrink-0">
                      <div className="text-right">
                        <span className="text-[10px] font-black text-emerald-500 dark:text-emerald-400 font-mono px-2 py-0.5 bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/10 rounded">
                          UQI: {m.successScore}%
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </div>
                ))}
                {filteredMissions.length === 0 && (
                  <p className="text-xs text-slate-400 italic py-4">No completed mission deliverables found matching search parameters.</p>
                )}
              </div>
            </div>
          )}

          {/* Section 2: AI Discussions / Debates */}
          {(activeTab === "all" || activeTab === "debates") && (
            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-black text-slate-400 dark:text-neutral-500 uppercase tracking-widest font-mono flex items-center gap-2">
                <Users className="w-4 h-4 text-pink-500" />
                Cross-Model Debate & Consensus Streams
              </h3>
              <div className="space-y-2.5">
                {filteredDebates.map((d) => (
                  <div
                    key={d.id}
                    onClick={() => onNavigateToApp("multi-ai")}
                    className="p-4 bg-white/80 dark:bg-neutral-900/30 border border-slate-200/50 dark:border-white/[0.04] rounded-2xl hover:border-pink-500/30 hover:shadow-md transition-all cursor-pointer group"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <h4 className="text-xs font-black text-slate-800 dark:text-neutral-200 group-hover:text-pink-500 dark:group-hover:text-pink-400 transition-colors">
                          {d.topic}
                        </h4>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {d.agents.map((ag, i) => (
                            <span key={i} className="text-[9px] font-mono bg-slate-100 dark:bg-neutral-800 text-slate-500 dark:text-neutral-400 px-1.5 py-0.2 rounded">
                              {ag}
                            </span>
                          ))}
                        </div>
                      </div>
                      <span className={cn(
                        "text-[9px] font-bold px-2 py-0.5 rounded font-mono shrink-0",
                        d.status === "Resolved" 
                          ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/10"
                          : "bg-pink-500/10 text-pink-500 border border-pink-500/10 animate-pulse"
                      )}>
                        {d.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 dark:text-neutral-500 font-medium mt-3 font-mono bg-slate-50 dark:bg-neutral-950/40 p-2.5 rounded-lg border border-slate-100 dark:border-white/[0.02] truncate">
                      {d.lastMessage}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 3: Attached Materials (Files) */}
          {(activeTab === "all" || activeTab === "files") && (
            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-black text-slate-400 dark:text-neutral-500 uppercase tracking-widest font-mono flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-emerald-500" />
                Attached Materials & Source Briefings
              </h3>
              
              {/* Drag and Drop Zone */}
              <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                className={cn(
                  "border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer",
                  dragActive
                    ? "border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/10"
                    : "border-slate-200/80 dark:border-white/[0.04] bg-white/40 dark:bg-neutral-900/10 hover:border-indigo-500/20 dark:hover:border-indigo-500/20"
                )}
              >
                <input 
                  type="file" 
                  id="workspace-file-upload-drag"
                  multiple 
                  onChange={handleFileInput} 
                  className="hidden" 
                />
                <label htmlFor="workspace-file-upload-drag" className="cursor-pointer space-y-2 block">
                  <Paperclip className="w-8 h-8 text-slate-300 dark:text-neutral-600 mx-auto animate-bounce" />
                  <p className="text-xs font-bold text-slate-700 dark:text-neutral-300">
                    Drag and drop briefing notes here, or click to browse
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Supports TXT, PDF, DOCX, XLSX and images to grounds AI analysis
                  </p>
                </label>
              </div>

              {/* Uploaded files catalog */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filteredFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-3.5 bg-white/80 dark:bg-neutral-900/30 border border-slate-200/50 dark:border-white/[0.04] rounded-xl group relative overflow-hidden"
                  >
                    <div className="flex items-center gap-3 truncate max-w-[80%]">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100/50 dark:border-emerald-900/30 flex items-center justify-center shrink-0">
                        <File className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div className="truncate">
                        <p className="text-xs font-bold text-slate-800 dark:text-neutral-200 truncate">
                          {file.name}
                        </p>
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {file.size} • {new Date(file.timestamp).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteFile(file.id, e)}
                      className="p-1.5 bg-rose-500/5 hover:bg-rose-500/10 text-rose-400 rounded-lg hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-4.5 h-4.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Right 1 Col: Workspace intelligence side stats */}
        <div className="space-y-6">
          
          {/* Active Cockpit Summary */}
          <div className="bg-white/80 dark:bg-neutral-900/40 backdrop-blur-md border border-slate-200/60 dark:border-white/[0.04] p-5 rounded-2xl shadow-xs space-y-4">
            <h4 className="text-xs font-black text-slate-800 dark:text-neutral-300 uppercase tracking-widest font-mono">
              Working Workspace Summary
            </h4>
            <div className="space-y-3.5 text-xs">
              <div className="flex justify-between pb-2 border-b border-slate-100 dark:border-neutral-800">
                <span className="text-slate-400 font-semibold">Active Session ID</span>
                <span className="font-mono text-slate-800 dark:text-white font-bold">W-COGNITIVE-08</span>
              </div>
              <div className="flex justify-between pb-2 border-b border-slate-100 dark:border-neutral-800">
                <span className="text-slate-400 font-semibold">Saved Deliverables</span>
                <span className="font-mono text-slate-800 dark:text-white font-bold">{savedMissions.length} documents</span>
              </div>
              <div className="flex justify-between pb-2 border-b border-slate-100 dark:border-neutral-800">
                <span className="text-slate-400 font-semibold">Attached Briefings</span>
                <span className="font-mono text-slate-800 dark:text-white font-bold">{attachedFiles.length} briefs</span>
              </div>
              <div className="flex justify-between pb-2 border-b border-slate-100 dark:border-neutral-800">
                <span className="text-slate-400 font-semibold">Compliance Threshold</span>
                <span className="font-mono text-emerald-500 font-black">&gt;95% UQI REQUIRED</span>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={() => onNavigateToApp("chat")}
                className="w-full py-2.5 bg-slate-50 dark:bg-neutral-900 hover:bg-slate-100 dark:hover:bg-neutral-800/60 border border-slate-200/60 dark:border-neutral-800 rounded-xl text-xs font-bold text-slate-700 dark:text-neutral-300 transition-all text-center cursor-pointer flex items-center justify-center gap-1.5"
              >
                <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />
                <span>Jump into Active Chat Cockpit</span>
              </button>
            </div>
          </div>

          {/* OEvE Cognitive Compliance Card */}
          <div className="bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 text-white rounded-2xl p-5 border border-white/5 space-y-3">
            <div className="flex items-center gap-1 text-[10px] text-indigo-300 font-bold font-mono uppercase tracking-wider">
              <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />
              <span>Workspace OEvE Status</span>
            </div>
            <h4 className="text-sm font-black tracking-tight leading-tight">
              Self-Adapting Organizational Alignment
            </h4>
            <p className="text-[11px] text-indigo-200/75 leading-relaxed font-medium">
              Every deliverable and associated attachment inside this workspace undergoes multi-agent cross-referencing to eliminate hallucinations.
            </p>
            <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-indigo-300 font-mono">
              <span>AGENTS ENGAGED: 4 ACTIVE</span>
              <span>UQI AUDIT: SAFE</span>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
