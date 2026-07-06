import React from "react";
import { Sparkles, Bot, Zap, ArrowRight, ChevronRight, X, Maximize2 } from "lucide-react";
import { 
  SovereignSidebar, 
  SovereignButton, 
  SovereignInput 
} from "../SovereignComponents";

export default function AIAssistantSidebar({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  return (
    <SovereignSidebar
      isOpen={isOpen}
      onClose={onClose}
      title="ACOS Copilot"
      className="pt-14"
      data-testid="ai-assistant-sidebar"
    >
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        
        <div>
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            Recommendations
          </h4>
          <div className="space-y-2">
            <button className="w-full text-left p-3 rounded-xl border border-indigo-100 bg-indigo-50/50 hover:bg-indigo-50 dark:border-indigo-500/10 dark:bg-indigo-500/5 transition-colors group">
              <p className="text-xs font-bold text-indigo-900 dark:text-indigo-400 mb-1">Optimize Active Missions</p>
              <p className="text-[10px] text-indigo-700/70 dark:text-indigo-300/70 leading-relaxed">SIL has identified overlapping tasks in 'Q3 Strategy' and 'Marketing'. Merge them to save API costs?</p>
              <div className="mt-2 flex items-center gap-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
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
            <button className="w-full flex items-center justify-between p-2.5 rounded-xl border border-slate-100 dark:border-white/[0.04] hover:border-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group text-left">
              <div>
                <p className="text-xs font-bold text-slate-700 dark:text-neutral-200">Approve Code Review</p>
                <p className="text-[10px] text-slate-500 mt-0.5">OEE is waiting for human input</p>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
            </button>
            <button className="w-full flex items-center justify-between p-2.5 rounded-xl border border-slate-100 dark:border-white/[0.04] hover:border-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group text-left">
              <div>
                <p className="text-xs font-bold text-slate-700 dark:text-neutral-200">Read Daily Summary</p>
                <p className="text-[10px] text-slate-500 mt-0.5">OEvE generated a new report</p>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
            </button>
          </div>
        </div>

      </div>

      <div className="p-4 border-t border-slate-100 dark:border-white/[0.03] bg-slate-50/50 dark:bg-neutral-950/20">
        <div className="flex items-center gap-2">
          <SovereignInput 
            type="text" 
            placeholder="Ask Copilot..." 
            className="flex-1 bg-white/50 dark:bg-white/5 text-xs"
          />
          <SovereignButton variant="primary" size="sm" className="p-2.5 shrink-0 rounded-xl">
            <Maximize2 className="w-3.5 h-3.5" />
          </SovereignButton>
        </div>
      </div>
    </SovereignSidebar>
  );
}
