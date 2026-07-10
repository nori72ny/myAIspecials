import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Download, FileText, Layout, FileSpreadsheet, Presentation, Type, Github, Slack, MessageSquare } from "lucide-react";

interface UniversalExportMenuProps {
  onExport: (format: string) => void;
}

export default function UniversalExportMenu({ onExport }: UniversalExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  const formats = [
    { id: "pdf", name: "PDF Document", icon: <FileText className="w-4 h-4 text-red-500" /> },
    { id: "docx", name: "Word (.docx)", icon: <Type className="w-4 h-4 text-blue-600" /> },
    { id: "xlsx", name: "Excel (.xlsx)", icon: <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> },
    { id: "pptx", name: "PowerPoint (.pptx)", icon: <Presentation className="w-4 h-4 text-orange-500" /> },
    { id: "notion", name: "Notion Page", icon: <Layout className="w-4 h-4 text-slate-800 dark:text-white" /> },
    { id: "slack", name: "Send to Slack", icon: <Slack className="w-4 h-4 text-purple-500" /> },
    { id: "teams", name: "Send to Teams", icon: <MessageSquare className="w-4 h-4 text-indigo-500" /> },
    { id: "github", name: "Export to GitHub", icon: <Github className="w-4 h-4 text-slate-900 dark:text-slate-300" /> },
  ];

  return (
    <div className="relative z-50">
      <button
        className="flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold uppercase tracking-wider shadow-xl transition-all shrink-0 cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Download className="w-4.5 h-4.5" />
        One-Click Export
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute right-0 bottom-full mb-2 w-56 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl p-2 overflow-hidden"
          >
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 py-1 mb-1">
              Export Format
            </div>
            <div className="space-y-0.5">
              {formats.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    onExport(f.id);
                    setIsOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors text-left text-xs font-semibold text-slate-700 dark:text-neutral-200 cursor-pointer"
                >
                  {f.icon}
                  {f.name}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
