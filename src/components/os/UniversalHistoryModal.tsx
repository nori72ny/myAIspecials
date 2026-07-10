import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { History, X, Clock, Zap, Target, Search } from "lucide-react";

interface UniversalHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  savedMissions: any[];
}

export default function UniversalHistoryModal({ isOpen, onClose, savedMissions }: UniversalHistoryModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-12">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-4xl max-h-[85vh] bg-white dark:bg-zinc-950 rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-white/10 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                  <History className="w-5 h-5 text-indigo-500" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">Universal History</h2>
                  <p className="text-[10px] text-slate-500 dark:text-neutral-400 font-mono tracking-widest uppercase">Time Machine Engine</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="relative">
                {/* Timeline Line */}
                <div className="absolute left-4 sm:left-6 top-0 bottom-0 w-px bg-slate-200 dark:bg-white/10" />
                
                <div className="space-y-8">
                  {savedMissions.map((mission, idx) => (
                    <div key={mission.id || idx} className="relative flex items-start gap-4 sm:gap-6">
                      <div className="absolute left-4 sm:left-6 w-3 h-3 rounded-full bg-indigo-500 -translate-x-[5px] mt-1.5 ring-4 ring-white dark:ring-zinc-950" />
                      <div className="pl-10 sm:pl-12 w-full">
                        <div className="bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/5 rounded-xl p-4 hover:border-indigo-500/50 transition-colors">
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                            <span className="text-xs font-mono text-slate-500 dark:text-neutral-400 flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5" />
                              {new Date(mission.timestamp).toLocaleString()}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                              {mission.category}
                            </span>
                          </div>
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2 leading-tight">
                            {mission.title}
                          </h3>
                          <div className="flex items-center gap-4 text-[10px] font-mono text-slate-500 dark:text-neutral-500">
                            <span className="flex items-center gap-1"><Target className="w-3 h-3 text-emerald-500" /> Score: {mission.successScore || 90}</span>
                            <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-amber-500" /> ROI: {mission.roi || "N/A"}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {savedMissions.length === 0 && (
                    <div className="text-center py-12 text-slate-500 dark:text-neutral-400 text-sm">
                      履歴が見つかりません
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
