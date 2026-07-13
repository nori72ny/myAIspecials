import React from 'react';
import { Shield, CheckCircle,   Zap, Activity, Award, Briefcase,  Globe } from 'lucide-react';
import { cn } from '../../utils';

export default function OutputEvaluationEngineView() {
  const uqi = 96;

  const categories = [
    { name: 'Accuracy', label: '正確性', score: 98, grade: 'S' },
    { name: 'FactCheck', label: 'ファクトチェック', score: 99, grade: 'S' },
    { name: 'Freshness', label: '最新情報', score: 95, grade: 'S' },
    { name: 'Logic', label: '論理性', score: 97, grade: 'S' },
    { name: 'Comprehensiveness', label: '網羅性', score: 94, grade: 'A' },
    { name: 'Readability', label: '読みやすさ', score: 96, grade: 'S' },
    { name: 'JapaneseQuality', label: '日本語品質', score: 98, grade: 'S' },
    { name: 'Design', label: 'デザイン性', score: 92, grade: 'A' },
    { name: 'Practicality', label: '実用性', score: 95, grade: 'S' },
    { name: 'Hallucination', label: 'ハルシネーション', score: 100, grade: 'S' },
    { name: 'Confidence', label: '信頼度', score: 99, grade: 'S' },
    { name: 'Reusability', label: '再利用性', score: 91, grade: 'A' },
    { name: 'PromptQuality', label: 'プロンプト品質', score: 97, grade: 'S' },
    { name: 'StructuralQuality', label: '構造品質', score: 95, grade: 'S' },
    { name: 'WorldGap', label: '世界トップ企業差', score: 90, grade: 'A' },
  ];

  const readiness = [
    { id: 'sales', label: '営業先への提出', status: true, icon: <Briefcase className="w-4 h-4" /> },
    { id: 'legal', label: '法務レビューなしでの提出', status: false, icon: <Shield className="w-4 h-4" /> },
    { id: 'board', label: '経営会議への提出', status: true, icon: <Award className="w-4 h-4" /> },
    { id: 'public', label: '社外公開', status: false, icon: <Globe className="w-4 h-4" /> },
  ];

  const perspectives = [
    { company: 'Apple', feedback: 'タイポグラフィと余白の扱いをさらに洗練させ、視覚的ノイズを極限まで減らすべき。' },
    { company: 'Google', feedback: 'データの裏付け（Google Scholar等の一次ソース）へのディープリンクを構造化データとして埋め込むべき。' },
    { company: 'OpenAI', feedback: 'プロンプトの再利用性を高めるため、変数（Few-shot例）を外部化するモジュール構造を採用すべき。' },
    { company: 'Anthropic', feedback: '潜在的なバイアスや倫理的リスク（Constitutional AIの観点）に関する自己評価セクションを追加すべき。' },
    { company: 'Linear', feedback: 'アクションアイテムのステータス遷移（Todo/In Progress/Done）をより明確にシグナリングすべき。' },
    { company: 'Notion', feedback: '他ドキュメントとの双方向リンク（バックリンク）を前提としたブロック単位の構成にすべき。' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-center gap-6 bg-slate-900 rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-purple-500/10 to-transparent pointer-events-none" />
        <div className="relative shrink-0 text-center">
          <div className="w-24 h-24 rounded-full border-4 border-emerald-500/30 flex items-center justify-center bg-slate-800">
            <span className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-br from-emerald-400 to-teal-400">
              {uqi}
            </span>
          </div>
          <div className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase mt-2">
            UQI Score
          </div>
        </div>
        <div className="relative flex-1 space-y-2">
          <h3 className="text-xl font-bold text-white">Output Evaluation Engine (OEE)</h3>
          <p className="text-sm text-slate-400 leading-relaxed">
            AI間での自動品質監査を行うための評価エンジン。15の品質指標、4つの提出要件、および世界トップ企業基準での改善点を自律的に算出します。
          </p>
        </div>
      </div>

      {/* Categories Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {categories.map(c => (
          <div key={c.name} className="p-3 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-white/10 rounded-xl flex flex-col items-center justify-center gap-1">
            <span className={cn(
              "text-lg font-black",
              c.grade === 'S' ? "text-emerald-500" :
              c.grade === 'A' ? "text-blue-500" :
              c.grade === 'B' ? "text-amber-500" : "text-rose-500"
            )}>{c.grade}</span>
            <span className="text-xs font-bold text-slate-700 dark:text-neutral-200">{c.score}</span>
            <span className="text-[9px] text-slate-500 dark:text-neutral-400 text-center uppercase tracking-wider">{c.label}</span>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Readiness */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-indigo-500" />
            提出・公開要件 (Readiness)
          </h4>
          <div className="space-y-2">
            {readiness.map(r => (
              <div key={r.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-zinc-900/50 rounded-xl border border-slate-100 dark:border-white/5">
                <div className="flex items-center gap-2.5">
                  <div className={cn("text-slate-400", r.status ? "text-emerald-500" : "text-amber-500")}>
                    {r.icon}
                  </div>
                  <span className="text-sm font-medium text-slate-700 dark:text-neutral-200">{r.label}</span>
                </div>
                {r.status ? (
                  <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase">Ready</span>
                ) : (
                  <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase">Requires Review</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Improvements */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" />
            自動改善提案
          </h4>
          <div className="space-y-2">
            <div className="p-3 bg-rose-50 dark:bg-rose-500/5 rounded-xl border border-rose-100 dark:border-rose-500/10">
              <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase mb-1 block">必須修正 (Mandatory)</span>
              <p className="text-xs text-slate-700 dark:text-neutral-300">法務確認待ち：第3項の免責事項について、外部の利用規約（TOS）へのリンクと同意要件を追加する必要があります。</p>
            </div>
            <div className="p-3 bg-amber-50 dark:bg-amber-500/5 rounded-xl border border-amber-100 dark:border-amber-500/10">
              <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase mb-1 block">推奨修正 (Recommended)</span>
              <p className="text-xs text-slate-700 dark:text-neutral-300">最新情報：2026年Q2の最新市場統計を反映することで、説得力がさらに2%向上します。</p>
            </div>
            <div className="p-3 bg-blue-50 dark:bg-blue-500/5 rounded-xl border border-blue-100 dark:border-blue-500/10">
              <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase mb-1 block">あると良い (Nice to have)</span>
              <p className="text-xs text-slate-700 dark:text-neutral-300">デザイン：比較表にミニSparklineチャートを埋め込むと視覚的理解が促進されます。</p>
            </div>
          </div>
        </div>
      </div>

      {/* Top Company Perspectives */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
          <Activity className="w-4 h-4 text-purple-500" />
          世界トップ基準との比較 (Gap Analysis)
        </h4>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {perspectives.map(p => (
            <div key={p.company} className="p-4 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-white/10 rounded-xl space-y-2">
              <div className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest">{p.company}</div>
              <p className="text-xs text-slate-600 dark:text-neutral-400 leading-relaxed">{p.feedback}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
