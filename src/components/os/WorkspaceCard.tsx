import React from "react";
import { Sparkles, ChevronRight, Layers } from "lucide-react";
import { WorkspaceCategory } from "../../types";
import { cn } from "../../utils";
import { SovereignGlassCard } from "../SovereignComponents";

interface WorkspaceCardProps {
  category: WorkspaceCategory;
  onClick: (category: WorkspaceCategory) => void;
  index?: number;
}

export default function WorkspaceCard({ category, onClick, index = 0 }: WorkspaceCardProps) {
  return (
    <SovereignGlassCard
      id={`workspace-card-${category.id}`}
      delay={index * 0.05}
      onClick={() => onClick(category)}
      className={cn(
        "group relative p-6 cursor-pointer flex flex-col justify-between min-h-[180px] hover:shadow-lg hover:shadow-indigo-500/[0.02]",
        category.borderColor || "border-slate-200/40 dark:border-white/[0.03]",
        "hover:border-indigo-500/40 dark:hover:border-indigo-500/30"
      )}
    >
      {/* Background Interactive Ambient Glow */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500/[0.01] to-pink-500/[0.01] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

      <div className="space-y-4 relative z-10">
        <div className="flex items-start justify-between">
          <span className="text-2xl bg-slate-50 dark:bg-neutral-900 w-12 h-12 rounded-xl flex items-center justify-center border border-slate-100 dark:border-white/[0.04] group-hover:scale-105 group-hover:border-indigo-500/20 transition-all shadow-inner duration-300">
            {category.icon}
          </span>
          <span className={cn(
            "text-[10px] font-bold px-2.5 py-1 rounded-full border tracking-wide uppercase font-mono",
            category.bgColor || "bg-indigo-50 dark:bg-indigo-950/20",
            category.accentColor || "text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-950/40"
          )}>
            {category.templates.length} Templates
          </span>
        </div>

        <div className="space-y-1.5">
          <h4 className="text-md font-black text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors tracking-tight flex items-center gap-1.5">
            {category.name}
            <Sparkles className="w-3.5 h-3.5 text-indigo-500/0 group-hover:text-indigo-500/80 group-hover:animate-pulse transition-all duration-300" />
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
            {category.description}
          </p>
        </div>
      </div>
      
      <div className="pt-4 mt-4 border-t border-slate-50 dark:border-white/[0.03] flex items-center justify-between text-[10px] font-bold text-slate-400 dark:text-slate-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors relative z-10 font-mono tracking-wider">
        <span className="flex items-center gap-1">
          <Layers className="w-3 h-3 text-slate-300 dark:text-slate-600 group-hover:text-indigo-400/50 transition-colors" />
          ACOS COGNITIVE MATRIX
        </span>
        <span className="flex items-center gap-0.5 group-hover:translate-x-1 transition-transform duration-200">
          DEPLOY WORKSPACE
          <ChevronRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </SovereignGlassCard>
  );
}
