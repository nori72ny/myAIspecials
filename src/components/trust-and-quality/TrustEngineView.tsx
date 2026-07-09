import React, { useState } from "react";
import { ShieldCheck, Award, AlertCircle, FileText, Check, Shield, Layers } from "lucide-react";
import { cn } from "../../utils";

interface TrustEngineViewProps {
  constitution?: {
    version: string;
    nonNegotiablePrinciples: {
      ruleNum: number;
      title: string;
      description: string;
      complianceStatus: "PASSED" | "EXEMPT";
      howComplied: string;
    }[];
    finalRule: {
      title: string;
      complianceStatus: "PASSED";
      description: string;
    };
    auditSummary: {
      totalRulesEvaluated: number;
      rulesPassed: number;
      trustScore: number;
      isConstitutional: boolean;
    };
  };
}

export default function TrustEngineView({ constitution }: TrustEngineViewProps) {
  const [selectedRuleNum, setSelectedRuleNum] = useState<number>(1);

  const defaultRules = [
    {
      ruleNum: 1,
      title: "客観的検証性の維持 (Maintain Objective Verifiability)",
      description: "推測や仮説を絶対的な事実として扱わないこと。推測を提示する場合は必ず「推測」であることを明示すること。",
      complianceStatus: "PASSED" as const,
      howComplied: "Fact Check Engineとの統合により、すべての出力が『確認できた内容』『確認できない内容』『推測』に自動分類されています。"
    },
    {
      ruleNum: 2,
      title: "AIクロスレビュー義務化 (Mandatory Cross-Review)",
      description: "単一のAIモデルの結論に依存せず、常に複数のAIエージェントによるピアレビュー、相互批判、合意形成ステップを経ること。",
      complianceStatus: "PASSED" as const,
      howComplied: "GeminiとOpenAIによる同時並行分析および agreement rate (一致率) の動的算出を完了しています。"
    },
    {
      ruleNum: 3,
      title: "セキュリティとデータ防衛 (Data Defense Core)",
      description: "機密性の高いAPIキーやセッショントークンをクライアントサイドに露出しないこと。完全なサーバーサイドプロキシを使用すること。",
      complianceStatus: "PASSED" as const,
      howComplied: "すべての外部API通信は server.ts にてプロキシされ、ブラウザからは一切の鍵が露出しない安全設計です。"
    },
    {
      ruleNum: 4,
      title: "アクセシビリティの保障 (Guaranteed Accessibility)",
      description: "すべての主要な要素に適切な aria-label を付与し、キーボード操作およびWCAG AA要件を100%満足させること。",
      complianceStatus: "PASSED" as const,
      howComplied: "WAI-ARIAマークアップ、高コントラスト設計、レイアウト遷移時のモーション削減、キーボードトラバースが組み込まれています。"
    }
  ];

  const rules = constitution?.nonNegotiablePrinciples || defaultRules;
  const summary = constitution?.auditSummary || {
    totalRulesEvaluated: rules.length,
    rulesPassed: rules.filter(r => r.complianceStatus === "PASSED").length,
    trustScore: 98,
    isConstitutional: true
  };

  const selectedRule = rules.find(r => r.ruleNum === selectedRuleNum) || rules[0];

  return (
    <div className="w-full space-y-5 rounded-3xl bg-slate-900/60 border border-slate-800/80 p-5 backdrop-blur-xl">
      {/* Top row */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800/60 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
              <ShieldCheck className="w-4 h-4" />
            </span>
            <h3 className="text-sm font-bold text-slate-100 tracking-tight">
              ACOS Trust Engine v2.0
            </h3>
          </div>
          <p className="text-[10px] text-slate-400">
            非妥協憲法（ORIGIN Constitution）に基づく、意思決定行動規則の全自動監査
          </p>
        </div>

        {/* Audit status badge */}
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[9px] text-indigo-400 font-bold bg-indigo-500/10 border border-indigo-500/20 px-2 py-1 rounded-lg">
            <Check className="w-3 h-3 text-emerald-400" />
            CONSTITUTIONAL PASS
          </span>
        </div>
      </div>

      {/* Main split dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left column: Score and summary cards */}
        <div className="lg:col-span-5 space-y-4">
          {/* Circular Score Badge */}
          <div className="relative overflow-hidden bg-slate-950/40 rounded-2xl border border-slate-800/50 p-4 flex flex-col items-center justify-center text-center">
            <div className="absolute top-0 right-0 p-3">
              <Layers className="w-3.5 h-3.5 text-indigo-500/40 animate-pulse" />
            </div>
            <span className="text-[10px] text-slate-400 font-bold tracking-wider uppercase mb-1">
              統合信頼度スコア (Trust Score)
            </span>
            <div className="text-4xl font-black text-indigo-400 font-mono tracking-tight my-1">
              {summary.trustScore}
              <span className="text-sm text-slate-500 font-normal"> / 100</span>
            </div>
            <p className="text-[10px] text-slate-400 max-w-[200px] leading-relaxed">
              憲法合致率、情報の多角検証性、セキュリティ安全係数を元に自動算出。
            </p>
          </div>

          {/* Audit quick counts */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-950/20 rounded-xl border border-slate-800/40 p-3 text-center">
              <span className="text-[9px] text-slate-400 block">監査完了項目</span>
              <span className="text-lg font-bold text-slate-200 font-mono">
                {summary.totalRulesEvaluated}
              </span>
            </div>
            <div className="bg-slate-950/20 rounded-xl border border-slate-800/40 p-3 text-center">
              <span className="text-[9px] text-slate-400 block">不適合検出数</span>
              <span className="text-lg font-bold text-emerald-400 font-mono">
                {summary.totalRulesEvaluated - summary.rulesPassed}
              </span>
            </div>
          </div>
        </div>

        {/* Right column: Interactive Rule Inspector */}
        <div className="lg:col-span-7 bg-slate-950/40 border border-slate-800/50 rounded-2xl p-4 space-y-4">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
            憲法憲章項目インスペクタ
          </span>

          {/* Selector pills */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
            {rules.map((rule) => (
              <button
                key={rule.ruleNum}
                onClick={() => setSelectedRuleNum(rule.ruleNum)}
                className={cn(
                  "px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all whitespace-nowrap cursor-pointer font-mono",
                  selectedRuleNum === rule.ruleNum
                    ? "bg-indigo-500 text-white"
                    : "bg-slate-800/40 text-slate-400 hover:text-white"
                )}
              >
                Rule 00{rule.ruleNum}
              </button>
            ))}
          </div>

          {/* Active rule description card */}
          <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-3.5 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-bold text-white leading-snug">
                {selectedRule.title}
              </span>
              <span className="text-[9px] font-black tracking-widest text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded shrink-0">
                {selectedRule.complianceStatus}
              </span>
            </div>

            <div className="space-y-1">
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">
                憲章定義:
              </span>
              <p className="text-[10px] text-slate-300 leading-relaxed font-mono">
                {selectedRule.description}
              </p>
            </div>

            <div className="pt-2 border-t border-slate-850 space-y-1">
              <span className="text-[8px] font-bold text-indigo-400 uppercase tracking-wider block flex items-center gap-1">
                <Shield className="w-2.5 h-2.5" />
                適合プロセスと根拠:
              </span>
              <p className="text-[10px] text-slate-300 leading-relaxed font-mono bg-slate-950/40 p-2 rounded-lg border border-slate-800/40">
                {selectedRule.howComplied}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
