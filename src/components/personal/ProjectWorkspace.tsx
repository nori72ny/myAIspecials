import React from 'react';
import { FolderKanban, Clock, MoreHorizontal, MessageSquare, Plus } from 'lucide-react';

export default function ProjectWorkspace({ activeProjectId }: { activeProjectId: string | null }) {
  if (activeProjectId) {
    return (
      <div className="flex flex-col h-full bg-slate-50/50 dark:bg-black items-center justify-center">
        <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center mb-6 border border-indigo-100 dark:border-indigo-500/20">
          <FolderKanban className="w-8 h-8 text-indigo-500" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight mb-2">{activeProjectId}</h2>
        <p className="text-slate-500 dark:text-neutral-400 text-sm max-w-sm text-center mb-8">
          This workspace contains all contextual memory, uploaded files, and chat history for {activeProjectId}.
        </p>
        <button className="flex items-center gap-2 px-6 py-2.5 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
          <MessageSquare className="w-4 h-4" />
          <span>Continue Chat</span>
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Active Workspaces</h2>
        <button className="flex items-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
          <Plus className="w-4 h-4" />
          <span>New Project</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {['ACOS Development', 'Sales Deck', 'Marketing', 'Traffic Accident', 'Travel'].map((proj) => (
          <div key={proj} className="group relative bg-white dark:bg-neutral-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 hover:border-indigo-500/50 hover:shadow-md transition-all cursor-pointer">
            <div className="flex justify-between items-start mb-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center">
                <FolderKanban className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <button className="text-slate-400 hover:text-slate-600 dark:hover:text-neutral-200 opacity-0 group-hover:opacity-100 transition-opacity">
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>
            <h3 className="font-semibold text-base mb-1">{proj}</h3>
            <div className="flex items-center gap-3 text-[11px] font-medium text-slate-500 dark:text-neutral-400">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Updated 2h ago
              </span>
              <span className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                12 chats
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
