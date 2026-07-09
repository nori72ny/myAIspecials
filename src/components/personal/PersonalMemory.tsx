import React from 'react';
import { Brain, Search, Clock, Save, Shield, Settings } from 'lucide-react';

export default function PersonalMemory() {
  const memories = [
    { id: 1, type: 'Preference', content: 'ユーザーはApple HIGのようなクリーンなUIを好む。', time: '1 hour ago' },
    { id: 2, type: 'Fact', content: 'ACOSプロジェクトの主な言語はTypeScriptとReact。', time: 'Yesterday' },
    { id: 3, type: 'Rule', content: '回答は必ず日本語で、簡潔に結論から述べること。', time: 'Last week' },
  ];

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Personal Memory</h2>
          <p className="text-sm text-slate-500 dark:text-neutral-400 mt-1">
            ACOS learns from your interactions to provide personalized assistance.
          </p>
        </div>
        <button className="p-2 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
          <Settings className="w-5 h-5 text-slate-600 dark:text-neutral-400" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Stats */}
        <div className="space-y-4">
          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 text-white shadow-sm relative overflow-hidden">
            <div className="relative z-10">
              <Brain className="w-8 h-8 mb-4 opacity-80" />
              <div className="text-3xl font-bold tracking-tight mb-1">2,048</div>
              <div className="text-sm font-medium text-white/80">Memory Fragments</div>
            </div>
            <div className="absolute right-0 bottom-0 translate-x-1/4 translate-y-1/4">
              <Brain className="w-32 h-32 text-white/10" />
            </div>
          </div>
          
          <div className="bg-white dark:bg-neutral-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 shadow-sm space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-500" />
              Privacy & Control
            </h3>
            <p className="text-xs text-slate-500 dark:text-neutral-400 leading-relaxed">
              Your personal memory is encrypted and stored locally. It is never used to train base models without your explicit consent.
            </p>
            <button className="w-full py-2 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg text-xs font-semibold transition-colors">
              Manage Data
            </button>
          </div>
        </div>

        {/* Right Column: Search and List */}
        <div className="md:col-span-2 space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search your memories..." 
              className="w-full bg-white dark:bg-neutral-900 border border-slate-200 dark:border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 shadow-sm"
            />
          </div>

          <div className="bg-white dark:bg-neutral-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-sm overflow-hidden divide-y divide-slate-100 dark:divide-white/5">
            {memories.map((memory) => (
              <div key={memory.id} className="p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors flex items-start justify-between gap-4">
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold uppercase tracking-wider">
                      {memory.type}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-slate-400">
                      <Clock className="w-3 h-3" />
                      {memory.time}
                    </span>
                  </div>
                  <p className="text-sm font-medium">{memory.content}</p>
                </div>
                <button className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-neutral-200 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Save className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
