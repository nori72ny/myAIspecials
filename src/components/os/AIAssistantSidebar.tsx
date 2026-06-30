import React, { useState } from "react";
import { Sparkles, Bot, Zap, ArrowRight, ChevronRight, X, Maximize2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../../utils";

export default function AIAssistantSidebar({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, x: 300 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 300 }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="fixed right-0 top-0 bottom-0 w-80 bg-white border-l border-slate-200 shadow-2xl z-40 flex flex-col pt-14"
        >
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-indigo-50/30">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                <Bot className="w-4 h-4 text-indigo-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-sm">ACOS Copilot</h3>
                <p className="text-[10px] text-slate-500 font-medium">Always-on Assistant</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            
            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                Recommendations
              </h4>
              <div className="space-y-2">
                <button className="w-full text-left p-3 rounded-xl border border-indigo-100 bg-indigo-50/50 hover:bg-indigo-50 transition-colors group">
                  <p className="text-xs font-bold text-indigo-900 mb-1">Optimize Active Missions</p>
                  <p className="text-[10px] text-indigo-700/70 leading-relaxed">SIL has identified overlapping tasks in 'Q3 Strategy' and 'Marketing'. Merge them to save API costs?</p>
                  <div className="mt-2 flex items-center gap-1 text-[10px] font-bold text-indigo-600">
                    Review suggestion <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                Next Actions
              </h4>
              <div className="space-y-2">
                <button className="w-full flex items-center justify-between p-2.5 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-colors group text-left">
                  <div>
                    <p className="text-xs font-bold text-slate-700">Approve Code Review</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">OEE is waiting for human input</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                </button>
                <button className="w-full flex items-center justify-between p-2.5 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-colors group text-left">
                  <div>
                    <p className="text-xs font-bold text-slate-700">Read Daily Summary</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">OEvE generated a new report</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                </button>
              </div>
            </div>

          </div>

          <div className="p-4 border-t border-slate-100 bg-slate-50">
            <div className="bg-white border border-slate-200 rounded-xl p-2 flex items-center gap-2 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 transition-all">
              <input 
                type="text" 
                placeholder="Ask Copilot..." 
                className="flex-1 bg-transparent border-none text-xs outline-none placeholder:text-slate-400"
              />
              <button className="p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
