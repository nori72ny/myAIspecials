import React, { useState, useEffect } from "react";
import { Search, Command, FileText, MessageSquare, Database, Sparkles, X, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../../utils";

interface UniversalSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function UniversalSearch({ isOpen, onClose }: UniversalSearchProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        isOpen ? onClose() : document.getElementById("universal-search-trigger")?.click();
      }
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 sm:px-0">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -20 }}
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden relative z-10 border border-slate-200"
      >
        <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-100">
          <Search className="w-5 h-5 text-indigo-500" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search missions, conversations, memory... (Cmd+K)"
            className="flex-1 bg-transparent border-none text-base outline-none placeholder:text-slate-400 text-slate-800 font-medium"
          />
          <div className="flex items-center gap-1">
            <kbd className="px-2 py-1 bg-slate-100 text-slate-500 rounded text-[10px] font-bold font-sans">ESC</kbd>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {query.trim() === "" ? (
            <div className="p-8 text-center text-slate-500 flex flex-col items-center">
              <Command className="w-12 h-12 text-slate-200 mb-3" />
              <p className="text-sm font-semibold">Start typing to search across the OS</p>
              <p className="text-xs mt-1">Search missions, prompts, workflows, and memory</p>
            </div>
          ) : (
            <div className="space-y-4 p-2">
              <div>
                <div className="text-xs font-bold text-slate-400 mb-2 uppercase px-2 tracking-wider">Missions</div>
                <div className="space-y-1">
                  <button className="w-full flex items-center justify-between p-2 hover:bg-slate-50 rounded-xl group transition-colors text-left">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-800 group-hover:text-indigo-600 transition-colors">Q3 Marketing Strategy Analysis</div>
                        <div className="text-xs text-slate-500">Mission in progress • 2 hours ago</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 opacity-0 group-hover:opacity-100 transition-all" />
                  </button>
                </div>
              </div>

              <div>
                <div className="text-xs font-bold text-slate-400 mb-2 uppercase px-2 tracking-wider">Conversations</div>
                <div className="space-y-1">
                  <button className="w-full flex items-center justify-between p-2 hover:bg-slate-50 rounded-xl group transition-colors text-left">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
                        <MessageSquare className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-800 group-hover:text-emerald-600 transition-colors">API Architecture Discussion</div>
                        <div className="text-xs text-slate-500">Chat with Gemini 3.5 Pro • Yesterday</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 opacity-0 group-hover:opacity-100 transition-all" />
                  </button>
                </div>
              </div>
              
              <div>
                <div className="text-xs font-bold text-slate-400 mb-2 uppercase px-2 tracking-wider">Memory & Graph</div>
                <div className="space-y-1">
                  <button className="w-full flex items-center justify-between p-2 hover:bg-slate-50 rounded-xl group transition-colors text-left">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
                        <Database className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-800 group-hover:text-amber-600 transition-colors">GraphQL Transition Specs</div>
                        <div className="text-xs text-slate-500">OEvE Synthesized Insight • Last Week</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-amber-500 opacity-0 group-hover:opacity-100 transition-all" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="bg-slate-50 p-3 border-t border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            <span className="text-xs font-semibold text-slate-600">ACOS Semantic Search</span>
          </div>
          <span className="text-[10px] text-slate-400">Powered by SIL</span>
        </div>
      </motion.div>
    </div>
  );
}
