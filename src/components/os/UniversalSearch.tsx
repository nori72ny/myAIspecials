import React, { useState, useEffect, useRef } from "react";
import { 
  Search, 
  Command, 
  FileText, 
  MessageSquare, 
  Database, 
  Sparkles, 
  X, 
  ChevronRight,
  Home,
  Briefcase,
  BrainCircuit,
  Settings2,
  Paperclip,
  TrendingUp,
  Shield,
  HelpCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../../utils";

interface UniversalSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectApp?: (app: string) => void;
  onViewMission?: (mission: any) => void;
}

interface SearchItem {
  id: string;
  category: "Project" | "Mission" | "Knowledge" | "Workspace" | "Marketplace";
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  action: () => void;
}

export default function UniversalSearch({ isOpen, onClose, onSelectApp, onViewMission }: UniversalSearchProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load saved missions & files from localStorage to search them dynamically
  const [savedMissions, setSavedMissions] = useState<any[]>([]);
  const [savedFiles, setSavedFiles] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 100);

      try {
        const storedMissions = localStorage.getItem("acos_saved_missions");
        if (storedMissions) setSavedMissions(JSON.parse(storedMissions));
        
        const storedFiles = localStorage.getItem("acos_workspace_files");
        if (storedFiles) setSavedFiles(JSON.parse(storedFiles));
      } catch (e) {
        console.warn(e);
      }
    }
  }, [isOpen]);

  // Command palette search universe
  const allItems: SearchItem[] = [
    // 1. Projects
    {
      id: "app-home",
      category: "Project",
      title: "Home Workspace",
      subtitle: "Run new AI missions and view executive cockpit OEE logs",
      icon: <Home className="w-4 h-4 text-indigo-400" />,
      action: () => { onSelectApp?.("dashboard"); onClose(); }
    },
    {
      id: "app-workspace",
      category: "Project",
      title: "Unified Active Workspace",
      subtitle: "Manage all results, attached documents, briefings & AI debate threads",
      icon: <Briefcase className="w-4 h-4 text-amber-400" />,
      action: () => { onSelectApp?.("workspace"); onClose(); }
    },
    {
      id: "app-brain",
      category: "Project",
      title: "Unified Brain Overview",
      subtitle: "Visualise OEvE cognitive knowledge maps, and memory networks",
      icon: <BrainCircuit className="w-4 h-4 text-emerald-400" />,
      action: () => { onSelectApp?.("brain"); onClose(); }
    },
    {
      id: "app-marketplace",
      category: "Project",
      title: "Marketplace Templates",
      subtitle: "Find professional pre-configured mission templates",
      icon: <Sparkles className="w-4 h-4 text-pink-400" />,
      action: () => { onSelectApp?.("marketplace"); onClose(); }
    },
    {
      id: "app-organization",
      category: "Project",
      title: "Organization & Compliance Control",
      subtitle: "Configure active model API credentials and OQI rule guidelines",
      icon: <Shield className="w-4 h-4 text-blue-400" />,
      action: () => { onSelectApp?.("organization"); onClose(); }
    },

    // 2. Templates (Marketplace)
    {
      id: "tpl-lawyer",
      category: "Marketplace",
      title: "交通事故に強い弁護士の自律比較候補提案",
      subtitle: "Search and rank litigation success rates & client review metrics",
      icon: <Sparkles className="w-4 h-4 text-indigo-400" />,
      action: () => { onSelectApp?.("dashboard"); onClose(); }
    },
    {
      id: "tpl-swot",
      category: "Marketplace",
      title: "新規AI SaaS事業のSWOT分析 & ROI予測",
      subtitle: "Multi-agent SWOT formulation with automatic financial cash flow projection",
      icon: <TrendingUp className="w-4 h-4 text-pink-400" />,
      action: () => { onSelectApp?.("dashboard"); onClose(); }
    },
    {
      id: "tpl-competitor",
      category: "Marketplace",
      title: "競合他社インテリジェンス調査",
      subtitle: "Scrapes competitor positioning, tech stack, and pricing tiers",
      icon: <Database className="w-4 h-4 text-teal-400" />,
      action: () => { onSelectApp?.("dashboard"); onClose(); }
    },

    // 3. Static Knowledge Nodes
    {
      id: "kn-ove",
      category: "Knowledge",
      title: "OEvE (Organizational Evolution Engine)",
      subtitle: "Self-adapting memory logs tracking historical company knowledge nodes",
      icon: <Database className="w-4 h-4 text-emerald-400" />,
      action: () => { onSelectApp?.("brain"); onClose(); }
    },
    {
      id: "kn-uqi",
      category: "Knowledge",
      title: "UQI Quality Indicators Spec",
      subtitle: "ACOS threshold requirement demanding quality scores of 95% or higher",
      icon: <Shield className="w-4 h-4 text-blue-400" />,
      action: () => { onSelectApp?.("organization"); onClose(); }
    }
  ];

  // Dynamically push saved missions and files into the search universe!
  savedMissions.forEach((m: any) => {
    allItems.push({
      id: `mission-${m.id}`,
      category: "Mission",
      title: m.title,
      subtitle: `Completed Mission deliverable • Success score: ${m.successScore}%`,
      icon: <FileText className="w-4 h-4 text-indigo-500 animate-pulse" />,
      action: () => { onViewMission?.(m); onClose(); }
    });
  });

  savedFiles.forEach((f: any) => {
    allItems.push({
      id: `file-${f.id}`,
      category: "Workspace",
      title: f.name,
      subtitle: `Attached briefing note • Size: ${f.size}`,
      icon: <Paperclip className="w-4 h-4 text-emerald-500" />,
      action: () => { onSelectApp?.("workspace"); onClose(); }
    });
  });

  // Filtering
  const filteredItems = allItems.filter(item => {
    const sQuery = query.toLowerCase();
    return (
      item.title.toLowerCase().includes(sQuery) ||
      item.subtitle.toLowerCase().includes(sQuery) ||
      item.category.toLowerCase().includes(sQuery)
    );
  });

  // Handle keyboard navigation (Raycast style)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % Math.max(1, filteredItems.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].action();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 sm:px-0 bg-slate-950/80 backdrop-blur-xl">
      <div className="absolute inset-0" onClick={onClose} />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -10 }}
        className="w-full max-w-2xl bg-[#0D0D11] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden relative z-10 flex flex-col"
      >
        {/* Spotlight Search Header */}
        <div className="flex items-center gap-3.5 px-5 py-4 border-b border-white/[0.06] bg-[#0E0E12]">
          <Search className="w-5 h-5 text-indigo-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search missions, assets, knowledge, templates, projects... (Arrow keys, Enter)"
            className="flex-1 bg-transparent border-none text-sm outline-none placeholder:text-slate-500 text-slate-100 font-semibold"
          />
          <div className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 text-slate-400 rounded text-[9px] font-bold font-sans">⌘K</kbd>
            <kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 text-slate-400 rounded text-[9px] font-bold font-sans" onClick={onClose}>ESC</kbd>
          </div>
        </div>

        {/* Search list container */}
        <div className="max-h-[50vh] overflow-y-auto p-2 space-y-1.5">
          {filteredItems.length === 0 ? (
            <div className="p-10 text-center text-slate-500 flex flex-col items-center">
              <Command className="w-10 h-10 text-slate-800 mb-3 animate-pulse" />
              <p className="text-xs font-bold text-slate-400">No matching assets found</p>
              <p className="text-[10px] text-slate-600 mt-1">Try typing 'swot', 'workspace', 'home' or a custom mission term.</p>
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  onClick={item.action}
                  className={cn(
                    "w-full flex items-center justify-between p-3 rounded-xl transition-all text-left group cursor-pointer border",
                    isSelected
                      ? "bg-indigo-600 border-indigo-500/30 text-white shadow-lg shadow-indigo-600/10"
                      : "bg-transparent border-transparent text-slate-300 hover:bg-white/[0.03] hover:border-white/[0.04]"
                  )}
                >
                  <div className="flex items-center gap-3.5 truncate max-w-[85%]">
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border",
                      isSelected 
                        ? "bg-white/10 border-white/10" 
                        : "bg-white/5 border-white/[0.05]"
                    )}>
                      {item.icon}
                    </div>
                    <div className="truncate">
                      <div className={cn(
                        "text-xs font-black truncate",
                        isSelected ? "text-white" : "text-slate-200"
                      )}>
                        {item.title}
                      </div>
                      <div className={cn(
                        "text-[10px] truncate mt-0.5",
                        isSelected ? "text-indigo-200" : "text-slate-400"
                      )}>
                        {item.subtitle}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 font-mono">
                    <span className={cn(
                      "text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider",
                      isSelected
                        ? "bg-white/20 text-white"
                        : "bg-white/5 text-slate-400"
                    )}>
                      {item.category}
                    </span>
                    <ChevronRight className={cn(
                      "w-3.5 h-3.5 transition-all",
                      isSelected ? "translate-x-0.5 text-white" : "text-slate-600 opacity-0 group-hover:opacity-100"
                    )} />
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Spotlight Footer info */}
        <div className="bg-[#09090D] px-5 py-3 border-t border-white/[0.06] flex items-center justify-between text-[10px] font-semibold text-slate-400 font-sans">
          <div className="flex items-center gap-1.5 text-indigo-400">
            <Sparkles className="w-3.5 h-3.5" />
            <span>ACOS Raycast Command Palette v2.0</span>
          </div>
          <span className="text-[9px] text-slate-500">↑↓ keys to select • Enter to launch</span>
        </div>
      </motion.div>
    </div>
  );
}
