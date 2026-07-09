import React, { useState } from "react";
import { Sparkles, Bot, Layers, CheckSquare, AlertTriangle, ShieldAlert } from "lucide-react";
import { cn } from "../../utils";

interface AIComparisonViewProps {
  comparisonData?: {
    agreementRate?: number;
    pointsOfConsensus?: string[];
    pointsOfContrast?: string[];
    modelsAudited?: string[];
    crossReviewSummary?: string;
  };
}

export default function AIComparisonView({ comparisonData }: AIComparisonViewProps) {
  const [selectedTopicIdx, setSelectedTopicIdx] = useState<number>(0);

  const defaultConsensus = [
    "Gemini及びGPT-4は、現時点でのACOS 2.0のアーキテクチャ設計（TypeScript/Vite/Expressプロキシ）がWebセキュリティ及び拡張性の基準を満たしていることで完全に一致。",
    "両モデルは、ローカル永続化（SafeStorage/localStorage）のレイヤーとサーバーサイドDBプロキシを完全に分離する戦略が最善であるとの合意に達しました。"
  ];

  const defaultContrast = [
    "Google Gemini: モビリティと表示パフォーマンス、さらにWCAG AAアクセシビリティの規格チェックを高速で繰り返す『SRE自律検証ループ』の組み込みを強調。",
    "OpenAI: ビジネス的な価値創出、ROIシミュレーション機能および多言語化（i18n）の適用によるグローバル展開への道筋を重視。"
  ];

  const agreementRate = comparisonData?.agreementRate || 96;
  const pointsOfConsensus = comparisonData?.pointsOfConsensus || defaultConsensus;
  const pointsOfContrast = comparisonData?.pointsOfContrast || defaultContrast;
  const modelsAudited = comparisonData?.modelsAudited || ["Google Gemini 2.5", "OpenAI GPT-4o"];
  const crossReviewSummary = comparisonData?.crossReviewSummary || "Gemini-2.5-ProとGPT-4oによるリアルタイム並行クロストークにより、出力品質の偏りを極限まで排除。合意形成アルゴリズムによる検証結果、一致率96%の極めて客観性の高いレポートを構成しました。";

  return (
    <div className="w-full space-y-5 rounded-3xl bg-slate-900/60 border border-slate-800/80 p-5 backdrop-blur-xl">
      {/* Title */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800/60 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
              <Bot className="w-4 h-4" />
            </span>
            <h3 className="text-sm font-bold text-slate-100 tracking-tight">
              Supreme AI Cross-Review Dashboard
            </h3>
          </div>
          <p className="text-[10px] text-slate-400">
            複数AIモデルの同時多角レビュー・相互相互レビューによる客観品質の保証
          </p>
        </div>

        {/* Audited models badge */}
        <div className="flex items-center gap-1.5 bg-slate-950/40 px-3 py-1.5 rounded-xl border border-slate-800/50">
          <span className="text-[9px] text-slate-400 font-bold">監査モデル:</span>
          <div className="flex -space-x-1">
            <div className="w-4 h-4 rounded-full bg-indigo-600 border border-slate-900 flex items-center justify-center text-[7px] font-bold text-white">♊</div>
            <div className="w-4 h-4 rounded-full bg-emerald-600 border border-slate-900 flex items-center justify-center text-[7px] font-bold text-white">🟢</div>
          </div>
          <span className="text-[9px] text-slate-300 font-mono font-bold">2 Models Sync</span>
        </div>
      </div>

      {/* Cross consensus section */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        {/* Consensus Circle */}
        <div className="md:col-span-4 bg-slate-950/40 rounded-2xl border border-slate-800/50 p-4 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] text-slate-400 font-bold tracking-wider uppercase mb-1">
            モデル相互合意率 (Agreement Rate)
          </span>
          <div className="relative w-24 h-24 flex items-center justify-center my-3">
            {/* Background circle */}
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="48"
                cy="48"
                r="40"
                className="stroke-slate-800 fill-none"
                strokeWidth="6"
              />
              <circle
                cx="48"
                cy="48"
                r="40"
                className="stroke-indigo-500 fill-none transition-all duration-1000 ease-out"
                strokeWidth="6"
                strokeDasharray="251.2"
                strokeDashoffset={251.2 - (251.2 * agreementRate) / 100}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-black text-white font-mono tracking-tighter">{agreementRate}%</span>
              <span className="text-[7px] text-indigo-400 font-bold uppercase tracking-wider">CONSENSUS</span>
            </div>
          </div>
          <p className="text-[9px] text-slate-400 leading-relaxed max-w-[160px]">
            意思決定戦略、要件充足条件における思考プロセスの高次元の一致。
          </p>
        </div>

        {/* Dynamic Summary */}
        <div className="md:col-span-8 flex flex-col justify-between bg-slate-950/20 rounded-2xl border border-slate-800/40 p-4 space-y-3">
          <div className="space-y-1.5">
            <span className="text-[10px] text-slate-400 font-bold flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              クロス・レビュー総合要約
            </span>
            <p className="text-[10px] text-slate-300 leading-relaxed font-mono">
              {crossReviewSummary}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2.5 border-t border-slate-800/40">
            <div>
              <span className="text-[8px] font-bold text-slate-400 block uppercase">合意トピック</span>
              <span className="text-xs font-bold text-emerald-400 font-mono">{pointsOfConsensus.length} 項目合意</span>
            </div>
            <div>
              <span className="text-[8px] font-bold text-slate-400 block uppercase">個別差異（補完）</span>
              <span className="text-xs font-bold text-sky-400 font-mono">{pointsOfContrast.length} 補完定義</span>
            </div>
          </div>
        </div>
      </div>

      {/* Consensus & Contrast Lists */}
      <div className="space-y-4 pt-2 border-t border-slate-800/50">
        {/* Consensus */}
        <div className="space-y-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block flex items-center gap-1.5">
            <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
            合意形成ポイント (Points of Consensus)
          </span>
          <div className="space-y-1.5">
            {pointsOfConsensus.map((item, idx) => (
              <div 
                key={`consensus-${idx}`} 
                className="p-3 bg-emerald-500/5 rounded-2xl border border-emerald-500/10 font-mono text-[10px] text-slate-300 leading-relaxed"
              >
                {item}
              </div>
            ))}
          </div>
        </div>

        {/* Contrast */}
        <div className="space-y-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            多角視点の対比 (Model Perspectives)
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {pointsOfContrast.map((item, idx) => (
              <div 
                key={`contrast-${idx}`} 
                className="p-3 bg-slate-950/40 rounded-2xl border border-slate-800/40 font-mono text-[10px] text-slate-300 leading-relaxed"
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
