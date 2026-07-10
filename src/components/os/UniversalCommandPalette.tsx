import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, Command, ArrowRight, Zap, Folder, MessageSquare, Briefcase, FileText, Settings, X, Globe, User, History } from "lucide-react";

interface UniversalCommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAction: (action: CommandAction) => void;
}

export interface CommandAction {
  id: string;
  title: string;
  category: "mission" | "memory" | "workflow" | "project" | "chat" | "action";
  icon: React.ReactNode;
  shortcut?: string;
}

const ALL_ACTIONS: CommandAction[] = [
  { id: "new-mission", title: "新しいミッションを作成", category: "mission", icon: <Zap className="w-4 h-4 text-amber-500" /> },
  { id: "search-memory", title: "コンテキストメモリを検索", category: "memory", icon: <Globe className="w-4 h-4 text-blue-500" /> },
  { id: "open-history", title: "ユニバーサル履歴 (タイムマシン)", category: "workflow", icon: <History className="w-4 h-4 text-indigo-500" /> },
  { id: "new-project", title: "新規プロジェクト", category: "project", icon: <Folder className="w-4 h-4 text-emerald-500" /> },
  { id: "chat", title: "AIアシスタントと対話", category: "chat", icon: <MessageSquare className="w-4 h-4 text-purple-500" /> },
  { id: "settings", title: "ACOS OS 設定", category: "action", icon: <Settings className="w-4 h-4 text-slate-500" /> },
];

export default function UniversalCommandPalette({ isOpen, onClose, onSelectAction }: UniversalCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
    }
  }, [isOpen]);

  // Command + K listener is usually handled at the app level, but we can also add it here
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const filteredActions = ALL_ACTIONS.filter(a => a.title.toLowerCase().includes(query.toLowerCase()));

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 md:p-20">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="relative w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-white/10"
          >
            <div className="flex items-center px-4 py-3 border-b border-slate-200 dark:border-white/10">
              <Search className="w-5 h-5 text-slate-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ACOS OS 全体を検索... (Missions, Memory, Workflows, Projects)"
                className="flex-1 bg-transparent border-none outline-none text-slate-800 dark:text-white px-4 text-base placeholder-slate-400 dark:placeholder-neutral-500 font-sans"
              />
              <div className="flex items-center gap-1.5 shrink-0">
                <kbd className="px-2 py-1 bg-slate-100 dark:bg-white/10 rounded text-[10px] font-mono text-slate-500 dark:text-neutral-400 font-bold">ESC</kbd>
              </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-2">
              {filteredActions.length > 0 ? (
                <div className="space-y-1">
                  {filteredActions.map((action, idx) => (
                    <button
                      key={action.id}
                      onClick={() => {
                        onSelectAction(action);
                        onClose();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 transition-colors group cursor-pointer text-left"
                    >
                      <div className="p-2 rounded-lg bg-slate-50 dark:bg-black/20 shrink-0 group-hover:scale-110 transition-transform">
                        {action.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          {action.title}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-neutral-500 font-mono uppercase tracking-wider mt-0.5">
                          {action.category}
                        </p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-300 dark:text-neutral-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 -translate-x-2 group-hover:translate-x-0" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-12 text-center">
                  <Command className="w-8 h-8 text-slate-300 dark:text-neutral-600 mx-auto mb-3" />
                  <p className="text-sm font-medium text-slate-900 dark:text-white">結果が見つかりません</p>
                  <p className="text-xs text-slate-500 dark:text-neutral-400 mt-1">別のキーワードでお試しください</p>
                </div>
              )}
            </div>

            <div className="px-4 py-2 bg-slate-50 dark:bg-black/20 border-t border-slate-200 dark:border-white/10 flex items-center justify-between text-[10px] text-slate-500 dark:text-neutral-500 font-mono">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1"><Command className="w-3 h-3" /> Universal Search</span>
                <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> ACOS DNA Engine Active</span>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
