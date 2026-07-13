import  { useState } from "react";
import { ChevronDown, Briefcase, Code, Megaphone, Beaker, User } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

const WORKSPACES = [
  { id: "core", name: "Core Operations", icon: Briefcase, color: "bg-indigo-100 text-indigo-600" },
  { id: "dev", name: "Development", icon: Code, color: "bg-blue-100 text-blue-600" },
  { id: "marketing", name: "Marketing", icon: Megaphone, color: "bg-emerald-100 text-emerald-600" },
  { id: "research", name: "Research (SIL)", icon: Beaker, color: "bg-amber-100 text-amber-600" },
  { id: "personal", name: "Personal Sandbox", icon: User, color: "bg-slate-100 text-slate-600" },
];

export default function WorkspaceSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const [active, setActive] = useState(WORKSPACES[0]);

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
      >
        <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${active.color}`}>
          <active.icon className="w-3.5 h-3.5" />
        </div>
        <span className="text-sm font-bold text-slate-700 hidden sm:block">{active.name}</span>
        <ChevronDown className="w-4 h-4 text-slate-400" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div 
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute left-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden"
            >
              <div className="p-2">
                <div className="text-[10px] font-bold text-slate-400 uppercase px-3 py-2">Select Workspace</div>
                {WORKSPACES.map(ws => (
                  <button
                    key={ws.id}
                    onClick={() => { setActive(ws); setIsOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${active.id === ws.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                  >
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${ws.color}`}>
                      <ws.icon className="w-3.5 h-3.5" />
                    </div>
                    <span className={`text-sm font-semibold ${active.id === ws.id ? 'text-indigo-700' : 'text-slate-700'}`}>
                      {ws.name}
                    </span>
                  </button>
                ))}
              </div>
              <div className="p-2 border-t border-slate-100 bg-slate-50">
                <button className="w-full text-center text-xs font-bold text-slate-600 hover:text-slate-800 py-1">
                  + Create Workspace
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
