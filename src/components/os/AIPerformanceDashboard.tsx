import React, { useState } from "react";
import { Activity, Zap, DollarSign, Target, CheckCircle, BarChart3, Clock, AlertCircle } from "lucide-react";
import { cn } from "../../utils";

const PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI GPT-4o",
    latency: "450ms",
    tokens: "12.4M",
    cost: "$42.50",
    successRate: "99.8%",
    reviewScore: "4.8/5",
    confidence: "95%",
    health: "operational",
    color: "from-emerald-500 to-green-600",
    bgColor: "bg-emerald-50",
    textColor: "text-emerald-700",
  },
  {
    id: "gemini",
    name: "Google Gemini 1.5 Pro",
    latency: "320ms",
    tokens: "8.2M",
    cost: "$18.20",
    successRate: "99.9%",
    reviewScore: "4.7/5",
    confidence: "94%",
    health: "operational",
    color: "from-blue-500 to-indigo-600",
    bgColor: "bg-blue-50",
    textColor: "text-blue-700",
  },
  {
    id: "claude",
    name: "Anthropic Claude 3.5 Sonnet",
    latency: "510ms",
    tokens: "5.1M",
    cost: "$15.30",
    successRate: "99.5%",
    reviewScore: "4.9/5",
    confidence: "96%",
    health: "operational",
    color: "from-amber-500 to-orange-600",
    bgColor: "bg-amber-50",
    textColor: "text-amber-700",
  },
  {
    id: "deepseek",
    name: "DeepSeek Coder V2",
    latency: "850ms",
    tokens: "3.4M",
    cost: "$2.10",
    successRate: "98.2%",
    reviewScore: "4.5/5",
    confidence: "91%",
    health: "degraded",
    color: "from-rose-500 to-red-600",
    bgColor: "bg-rose-50",
    textColor: "text-rose-700",
  }
];

export default function AIPerformanceDashboard() {
  return (
    <div className="flex h-full w-full bg-slate-50/50 rounded-3xl overflow-hidden flex-col gap-6 p-6 overflow-y-auto">
      
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <Activity className="w-6 h-6 text-indigo-600 animate-pulse" />
            Activity Dashboard
          </h2>
          <p className="text-sm text-slate-500 font-medium mt-1">Real-time metrics and health status across all active LLM providers</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-bold text-slate-500 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
          <span className="relative flex h-2 w-2 mr-1">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          Live Monitoring Active
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {PROVIDERS.map(provider => (
          <div key={provider.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br text-white shadow-sm", provider.color)}>
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-slate-800">{provider.name}</h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {provider.health === 'operational' ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded uppercase">
                        <CheckCircle className="w-3 h-3" /> Operational
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded uppercase">
                        <AlertCircle className="w-3 h-3" /> Degraded
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Latency
                </div>
                <div className="text-lg font-black text-slate-800">{provider.latency}</div>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <BarChart3 className="w-3 h-3" /> Tokens
                </div>
                <div className="text-lg font-black text-slate-800">{provider.tokens}</div>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <DollarSign className="w-3 h-3" /> Cost (MTD)
                </div>
                <div className="text-lg font-black text-slate-800">{provider.cost}</div>
              </div>
              
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Target className="w-3 h-3" /> Success
                </div>
                <div className="text-lg font-black text-slate-800">{provider.successRate}</div>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <StarIcon className="w-3 h-3" /> Review Score
                </div>
                <div className="text-lg font-black text-slate-800">{provider.reviewScore}</div>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Activity className="w-3 h-3" /> Confidence
                </div>
                <div className="text-lg font-black text-slate-800">{provider.confidence}</div>
              </div>
            </div>
            
            {/* Background decoration */}
            <div className={cn("absolute -bottom-16 -right-16 w-32 h-32 rounded-full blur-3xl opacity-20 pointer-events-none", provider.bgColor)}></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StarIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
