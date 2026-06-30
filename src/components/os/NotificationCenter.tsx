import React, { useState } from "react";
import { Bell, CheckCircle2, AlertCircle, Sparkles, MessageSquare, Database } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const unreadCount = 3;

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-white" />
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div 
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-xl border border-slate-200 z-50 overflow-hidden"
            >
              <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="font-bold text-slate-800 text-sm">Notifications</h3>
                <button className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700">Mark all as read</button>
              </div>
              <div className="max-h-[400px] overflow-y-auto">
                <div className="p-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex gap-3 cursor-pointer">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800">Mission Completed</p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">Agent Team Alpha finished "Security Audit". Review the results.</p>
                    <p className="text-[10px] text-slate-400 mt-1 font-medium">10 mins ago</p>
                  </div>
                </div>
                
                <div className="p-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex gap-3 cursor-pointer bg-indigo-50/30">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
                    <AlertCircle className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800">Review Required</p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">Codebase Refactor Planning needs human approval to proceed.</p>
                    <p className="text-[10px] text-slate-400 mt-1 font-medium">1 hour ago</p>
                  </div>
                </div>

                <div className="p-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex gap-3 cursor-pointer">
                  <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
                    <Database className="w-4 h-4 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800">Memory Graph Updated</p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">OEvE synthesized 3 new insights from recent missions.</p>
                    <p className="text-[10px] text-slate-400 mt-1 font-medium">2 hours ago</p>
                  </div>
                </div>

                <div className="p-3 hover:bg-slate-50 transition-colors flex gap-3 cursor-pointer">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800">AI Recommendation</p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">SIL suggests enabling Prompt Caching to save 12% on token costs.</p>
                    <p className="text-[10px] text-slate-400 mt-1 font-medium">Yesterday</p>
                  </div>
                </div>
              </div>
              <div className="p-3 bg-slate-50 border-t border-slate-100 text-center">
                <button className="text-xs font-bold text-slate-600 hover:text-slate-800">View All Activity</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
