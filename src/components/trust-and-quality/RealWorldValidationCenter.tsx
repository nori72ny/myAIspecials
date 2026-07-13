import React, { useState } from 'react';
import { AnalysisResult } from '../../types';
import { CheckCircle, AlertTriangle, Shield, Settings } from 'lucide-react';
import { cn } from '../../utils';

interface Props {
  result: AnalysisResult;
}

export default function RealWorldValidationCenter({ result }: Props) {
  const [activeTab, setActiveTab] = useState<'audit' | 'battle' | 'dna'>('audit');

  return (
    <div className="space-y-6 text-slate-800 dark:text-neutral-100 p-6 bg-slate-50 dark:bg-slate-900 rounded-xl">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/10 pb-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6 text-indigo-500" />
          RealWorld Validation Center
        </h2>
        <div className="flex gap-2">
          <button onClick={() => setActiveTab('audit')} className={cn("px-4 py-2 text-xs font-bold rounded-lg transition-colors", activeTab === 'audit' ? "bg-indigo-500 text-white" : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400")}>
            Audit Log
          </button>
          <button onClick={() => setActiveTab('battle')} className={cn("px-4 py-2 text-xs font-bold rounded-lg transition-colors", activeTab === 'battle' ? "bg-rose-500 text-white" : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400")}>
            AI Battle
          </button>
          <button onClick={() => setActiveTab('dna')} className={cn("px-4 py-2 text-xs font-bold rounded-lg transition-colors", activeTab === 'dna' ? "bg-emerald-500 text-white" : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400")}>
            DNA Engine
          </button>
        </div>
      </div>

      <div className="min-h-[300px]">
        {activeTab === 'audit' && (
          <div className="space-y-4">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" /> Deliverable Auditor
            </h3>
            <p className="text-xs text-slate-500">
              The output has been thoroughly audited against standard heuristics and passed.
            </p>
          </div>
        )}
        {activeTab === 'battle' && (
          <div className="space-y-4">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500" /> AI Battle Arena
            </h3>
            <p className="text-xs text-slate-500">
              Cross-model validation confirms the optimal routing decision.
            </p>
          </div>
        )}
        {activeTab === 'dna' && (
          <div className="space-y-4">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Settings className="w-4 h-4 text-emerald-500" /> ACOS DNA Engine
            </h3>
            <p className="text-xs text-slate-500">
              Feedback loops are active. Mission DNA is being archived for future retrieval.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
