import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, X,   ArrowUp } from "lucide-react";

interface FloatingAIAssistantProps {
  onInvokeAction?: (action: string) => void;
}

export default function FloatingAIAssistant({ onInvokeAction }: FloatingAIAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    if (onInvokeAction) {
      onInvokeAction(query);
    }
    setQuery("");
    setIsOpen(false);
  };

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-4">
      <AnimatePresence>
        {!isOpen && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="hidden md:flex items-center gap-2 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md px-4 py-2 rounded-full border border-slate-200 dark:border-white/10 shadow-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
            onClick={() => setIsOpen(true)}
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-xs font-medium text-slate-700 dark:text-neutral-300">
              前回の続きから再開しますか？ (Smart Suggest)
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20, originX: 1, originY: 1 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="w-80 sm:w-96 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-slate-200/50 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden"
            style={{
              boxShadow: "0 20px 40px -10px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.1)"
            }}
          >
            {/* Apple Intelligence Style Gradient Header */}
            <div className="h-1.5 w-full bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 animate-gradient-x" />
            
            <div className="p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">ACOS Intelligence</h3>
                    <p className="text-[10px] text-slate-500 dark:text-neutral-400 font-mono">Ready to assist</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="relative">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="何をお手伝いしましょうか？"
                  autoFocus
                  className="w-full bg-slate-100 dark:bg-black/40 border border-transparent focus:border-indigo-500/50 rounded-2xl py-3 pl-4 pr-12 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-neutral-500 outline-none transition-all shadow-inner"
                />
                <button
                  type="submit"
                  disabled={!query.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-300 dark:disabled:bg-white/10 text-white rounded-full flex items-center justify-center transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              </form>

              <div className="flex flex-wrap gap-2">
                <button className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-xs text-slate-700 dark:text-neutral-300 transition-colors cursor-pointer border border-transparent dark:border-white/5">
                  📝 サマリーを作成
                </button>
                <button className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-xs text-slate-700 dark:text-neutral-300 transition-colors cursor-pointer border border-transparent dark:border-white/5">
                  🔍 コンテキスト検索
                </button>
                <button className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-xs text-slate-700 dark:text-neutral-300 transition-colors cursor-pointer border border-transparent dark:border-white/5">
                  ⚡ クイックアクション
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="w-14 h-14 rounded-full bg-gradient-to-br from-slate-800 to-black dark:from-white dark:to-slate-200 shadow-2xl flex items-center justify-center cursor-pointer border border-slate-700 dark:border-white/20 z-10"
        style={{
          boxShadow: "0 10px 30px -5px rgba(0,0,0,0.5)"
        }}
      >
        <Sparkles className="w-6 h-6 text-white dark:text-black" />
      </motion.button>
    </div>
  );
}
