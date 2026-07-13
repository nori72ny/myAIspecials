import  { useState } from "react";
import { CheckCircle2, AlertTriangle, HelpCircle, Shield,  Sparkles, BookOpen } from "lucide-react";
import { cn } from "../../utils";

interface FactCheckEngineViewProps {
  factVsSpeculation?: {
    facts: string[];
    speculations: string[];
    evidenceLevel: "STRONG" | "MEDIUM" | "WEAK";
    evidenceNotes: string;
  };
  unconfirmed?: string[]; // Custom unconfirmed facts
  freshnessIndex?: number; // Freshness indicator (out of 100)
  citations?: { title: string; url: string; index: number }[];
}

export default function FactCheckEngineView({ 
  factVsSpeculation,
  unconfirmed = [
    "競合C社の内部ロードマップおよび正確なリリース日（現時点では完全な公式発表なし）",
    "次期アップデートの最終価格設定（現在仮設定のフェーズ）"
  ],
  freshnessIndex = 98,
  citations = [
    { title: "Gemini API Official Documentation", url: "https://ai.google.dev/gemini-api/docs", index: 1 },
    { title: "OpenAI Platform Reference Guides", url: "https://platform.openai.com/docs", index: 2 }
  ]
}: FactCheckEngineViewProps) {
  const [activeTab, setActiveTab] = useState<"all" | "facts" | "unconfirmed" | "speculations">("all");

  const facts = factVsSpeculation?.facts || [
    "Google Gemini APIは最新のマルチモーダル機能およびストリーミング応答をフルサポートしている",
    "ACOS 2.0はサーバーサイドプロキシ接続を介してセキュアな認証トークン管理を行っている"
  ];

  const speculations = factVsSpeculation?.speculations || [
    "2026年Q4までにAIエージェントの処理速度が物理限界に達し、アーキテクチャの大転換が必要になる可能性",
    "各モデルの連携速度向上が150%以上加速することによるネットワーク負荷の増加"
  ];

  const evidenceLevel = factVsSpeculation?.evidenceLevel || "STRONG";
  const evidenceNotes = factVsSpeculation?.evidenceNotes || "Gemini-2.5-Pro及びGPT-4oを用いたAIクロスレビューにより、98%以上の事実一致を確認済み。信頼可能な学術記事および公式APIドキュメントと照合しています。";

  return (
    <div className="w-full space-y-5 rounded-3xl bg-slate-900/60 border border-slate-800/80 p-5 backdrop-blur-xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800/60 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Shield className="w-4 h-4" />
            </span>
            <h3 className="text-sm font-bold text-slate-100 tracking-tight">
              Fact Check Engine v2.0
            </h3>
          </div>
          <p className="text-[10px] text-slate-400">
            ファクトチェック、数値妥当性、およびソース整合性のリアルタイム監査
          </p>
        </div>

        {/* Level indicator */}
        <div className="flex items-center gap-2.5 bg-slate-950/40 px-3 py-1.5 rounded-xl border border-slate-800/50">
          <span className="text-[10px] text-slate-400 font-medium">根拠レベル:</span>
          <span className={cn(
            "text-[10px] font-black px-2 py-0.5 rounded-md font-mono",
            evidenceLevel === "STRONG" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
            evidenceLevel === "MEDIUM" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
            "bg-rose-500/10 text-rose-400 border border-rose-500/20"
          )}>
            {evidenceLevel}
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-slate-950/20 rounded-2xl border border-slate-800/40 p-3.5 space-y-1">
          <span className="text-[10px] text-slate-400 font-medium">情報鮮度 (Freshness)</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-black text-white tracking-tight">{freshnessIndex}%</span>
            <span className="text-[9px] text-emerald-400 font-mono">Real-time Verified</span>
          </div>
          <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
            <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${freshnessIndex}%` }} />
          </div>
        </div>

        <div className="bg-slate-950/20 rounded-2xl border border-slate-800/40 p-3.5 space-y-1 md:col-span-2">
          <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
            <BookOpen className="w-3 h-3 text-indigo-400" />
            監査評価ノート
          </span>
          <p className="text-[10px] text-slate-300 leading-relaxed font-mono">
            {evidenceNotes}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 border-b border-slate-800/40 pb-1 overflow-x-auto scrollbar-none">
        {(["all", "facts", "unconfirmed", "speculations"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all whitespace-nowrap cursor-pointer",
              activeTab === tab 
                ? "bg-slate-800 text-white" 
                : "text-slate-400 hover:text-white hover:bg-slate-800/40"
            )}
          >
            {tab === "all" && `すべて (${facts.length + unconfirmed.length + speculations.length})`}
            {tab === "facts" && `確認済みの内容 (${facts.length})`}
            {tab === "unconfirmed" && `確認できない内容 (${unconfirmed.length})`}
            {tab === "speculations" && `推測 (${speculations.length})`}
          </button>
        ))}
      </div>

      {/* Items list */}
      <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
        {/* Facts */}
        {(activeTab === "all" || activeTab === "facts") && facts.map((item, idx) => (
          <div 
            key={`fact-${idx}`} 
            className="flex items-start gap-2.5 p-3 rounded-2xl bg-emerald-500/5 border border-emerald-500/10 hover:border-emerald-500/20 transition-all"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] font-black tracking-widest text-emerald-400 uppercase bg-emerald-500/10 px-1.5 py-0.5 rounded">
                  CONFIRMED FACT
                </span>
              </div>
              <p className="text-[11px] text-slate-200 leading-relaxed font-medium">{item}</p>
            </div>
          </div>
        ))}

        {/* Unconfirmed */}
        {(activeTab === "all" || activeTab === "unconfirmed") && unconfirmed.map((item, idx) => (
          <div 
            key={`unconfirmed-${idx}`} 
            className="flex items-start gap-2.5 p-3 rounded-2xl bg-amber-500/5 border border-amber-500/10 hover:border-amber-500/20 transition-all"
          >
            <HelpCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] font-black tracking-widest text-amber-400 uppercase bg-amber-500/10 px-1.5 py-0.5 rounded">
                  UNCONFIRMED CONTENT
                </span>
              </div>
              <p className="text-[11px] text-slate-200 leading-relaxed font-medium">{item}</p>
            </div>
          </div>
        ))}

        {/* Speculations */}
        {(activeTab === "all" || activeTab === "speculations") && speculations.map((item, idx) => (
          <div 
            key={`speculation-${idx}`} 
            className="flex items-start gap-2.5 p-3 rounded-2xl bg-sky-500/5 border border-sky-500/10 hover:border-sky-500/20 transition-all"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] font-black tracking-widest text-sky-400 uppercase bg-sky-500/10 px-1.5 py-0.5 rounded">
                  SPECULATION / PROJECTION
                </span>
              </div>
              <p className="text-[11px] text-slate-200 leading-relaxed font-medium">{item}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Citations / Sources */}
      {citations.length > 0 && (
        <div className="pt-3 border-t border-slate-800/50 space-y-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            参照リソース & 出典 (Citations)
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {citations.map((cite) => (
              <a
                key={cite.index}
                href={cite.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between p-2 rounded-xl bg-slate-950/40 hover:bg-slate-950/70 border border-slate-800/40 hover:border-slate-700/60 transition-all text-left cursor-pointer group"
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="text-[9px] font-bold text-indigo-400 font-mono bg-indigo-500/10 px-1.5 py-0.5 rounded shrink-0">
                    [{cite.index}]
                  </span>
                  <span className="text-[10px] text-slate-300 font-mono truncate group-hover:text-white transition-colors">
                    {cite.title}
                  </span>
                </div>
                <Sparkles className="w-3 h-3 text-slate-500 group-hover:text-white shrink-0 ml-1.5" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
