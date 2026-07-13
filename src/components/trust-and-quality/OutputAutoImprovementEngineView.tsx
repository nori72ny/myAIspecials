import  { useState, useEffect } from 'react';
import { RefreshCw, ArrowRight, Zap, CheckCircle,  Activity,  ArrowUpRight, ShieldCheck, Cpu, XCircle } from 'lucide-react';
import { cn } from '../../utils';

interface ImprovementStep {
  iteration: number;
  beforeScore: number;
  afterScore: number;
  reason: string;
  changes: { type: 'add' | 'update' | 'remove'; desc: string }[];
  status: 'completed' | 'processing' | 'pending';
}

export default function OutputAutoImprovementEngineView() {
  const [currentStep, setCurrentStep] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  const initialScore = 82;
  const targetScore = 95;

  const steps: ImprovementStep[] = [
    {
      iteration: 1,
      beforeScore: 82,
      afterScore: 88,
      reason: "法務要件（TOSリンク）の欠落、および2026年最新市場データへの更新が必要",
      changes: [
        { type: "add", desc: "第3項免責事項に外部利用規約（TOS）へのリンクを追加" },
        { type: "update", desc: "市場規模予測データを2026年Q2版へ更新" }
      ],
      status: currentStep > 0 ? 'completed' : currentStep === 0 && isRunning ? 'processing' : 'pending'
    },
    {
      iteration: 2,
      beforeScore: 88,
      afterScore: 93,
      reason: "比較表の視覚的理解度が低い、アクションアイテムのステータス遷移が不明確",
      changes: [
        { type: "update", desc: "比較表にミニSparklineチャートを埋め込み視覚化" },
        { type: "update", desc: "Todo/In Progress/Doneのシグナリングを明確化" }
      ],
      status: currentStep > 1 ? 'completed' : currentStep === 1 ? 'processing' : 'pending'
    },
    {
      iteration: 3,
      beforeScore: 93,
      afterScore: 98,
      reason: "一次情報へのディープリンク不足、倫理的リスク評価の欠如",
      changes: [
        { type: "add", desc: "Google Scholar等の一次ソースへの構造化データリンクを追加" },
        { type: "add", desc: "潜在的バイアス・倫理的リスク評価セクションを追加" }
      ],
      status: currentStep > 2 ? 'completed' : currentStep === 2 ? 'processing' : 'pending'
    }
  ];

  useEffect(() => {
    if (!isRunning) return;

    if (currentStep >= steps.length) {
      setIsCompleted(true);
      setIsRunning(false);
      return;
    }

    const timer = setTimeout(() => {
      setCurrentStep(s => s + 1);
    }, 2500);

    return () => clearTimeout(timer);
  }, [isRunning, currentStep, steps.length]);

  const currentScore = currentStep === 0 && !isRunning 
    ? initialScore 
    : currentStep === 0 && isRunning 
      ? initialScore 
      : steps[currentStep - 1]?.afterScore || steps[steps.length - 1].afterScore;

  const improvementRate = ((currentScore - initialScore) / initialScore * 100).toFixed(1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 bg-slate-900 rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-emerald-500/10 to-transparent pointer-events-none" />
        
        <div className="relative flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-indigo-400" />
            <h3 className="text-xl font-bold text-white">Output Auto Improvement Engine</h3>
          </div>
          <p className="text-sm text-slate-400 leading-relaxed">
            初期スコアが目標基準（{targetScore}点）を下回った場合、AIが自律的に弱点を分析し、修正・加筆・再構成ループを実行して世界最高品質まで引き上げます。
          </p>
        </div>

        <div className="relative shrink-0 flex items-center gap-4">
          {!isRunning && !isCompleted ? (
            <button 
              onClick={() => setIsRunning(true)}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-xl shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              自律改善ループを開始
            </button>
          ) : isCompleted ? (
            <div className="px-6 py-3 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-sm font-bold rounded-xl flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              品質基準クリア
            </div>
          ) : (
            <div className="px-6 py-3 bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 text-sm font-bold rounded-xl flex items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              改善ループ実行中... ({currentStep + 1}/{steps.length})
            </div>
          )}
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-white/10 rounded-xl flex flex-col justify-center">
          <span className="text-[10px] font-bold text-slate-500 dark:text-neutral-400 uppercase tracking-wider mb-1">初期 UQI スコア</span>
          <div className="text-2xl font-black text-slate-800 dark:text-white">{initialScore}</div>
        </div>
        <div className="p-4 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-white/10 rounded-xl flex flex-col justify-center relative overflow-hidden">
          {isRunning && <div className="absolute inset-0 bg-indigo-500/5 animate-pulse pointer-events-none" />}
          <span className="text-[10px] font-bold text-slate-500 dark:text-neutral-400 uppercase tracking-wider mb-1">現在 UQI スコア</span>
          <div className="flex items-center gap-2">
            <div className={cn(
              "text-3xl font-black transition-colors duration-500",
              currentScore >= targetScore ? "text-emerald-500" : "text-amber-500"
            )}>
              {currentScore}
            </div>
            {currentScore >= targetScore && <ShieldCheck className="w-5 h-5 text-emerald-500" />}
          </div>
        </div>
        <div className="p-4 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-white/10 rounded-xl flex flex-col justify-center">
          <span className="text-[10px] font-bold text-slate-500 dark:text-neutral-400 uppercase tracking-wider mb-1">改善率</span>
          <div className="flex items-center gap-1.5 text-2xl font-black text-emerald-500">
            <ArrowUpRight className="w-5 h-5" />
            {improvementRate}%
          </div>
        </div>
        <div className="p-4 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-white/10 rounded-xl flex flex-col justify-center">
          <span className="text-[10px] font-bold text-slate-500 dark:text-neutral-400 uppercase tracking-wider mb-1">改善ループ回数</span>
          <div className="text-2xl font-black text-indigo-500">{currentStep} <span className="text-sm font-medium text-slate-400">回</span></div>
        </div>
      </div>

      {/* History Timeline */}
      <div className="space-y-4">
        <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
          <Activity className="w-4 h-4 text-indigo-500" />
          自律改善履歴 (Auto Improvement History)
        </h4>

        <div className="relative border-l-2 border-indigo-500/20 ml-3 pl-6 space-y-6">
          {steps.map((step, index) => {
            const isActive = currentStep === index && isRunning;
            const isDone = currentStep > index || isCompleted;
            const isPending = !isActive && !isDone;

            if (isPending && !isRunning && currentStep === 0 && index > 0) return null; // Hide future steps if not started

            return (
              <div key={index} className={cn(
                "relative transition-all duration-500",
                isPending ? "opacity-40" : "opacity-100"
              )}>
                {/* Timeline node */}
                <div className={cn(
                  "absolute -left-[35px] w-6 h-6 rounded-full border-2 flex items-center justify-center bg-zinc-950",
                  isDone ? "border-emerald-500 bg-emerald-500/20" : 
                  isActive ? "border-indigo-500 bg-indigo-500/20 shadow-lg shadow-indigo-500/50" : 
                  "border-slate-600 bg-slate-800"
                )}>
                  {isDone ? (
                    <CheckCircle className="w-3 h-3 text-emerald-500" />
                  ) : isActive ? (
                    <RefreshCw className="w-3 h-3 text-indigo-400 animate-spin" />
                  ) : (
                    <span className="text-[10px] font-bold text-slate-400">{index + 1}</span>
                  )}
                </div>

                <div className="bg-white dark:bg-zinc-900/80 border border-slate-200 dark:border-white/10 rounded-xl p-4 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-indigo-500 uppercase tracking-wider">Iteration {step.iteration}</span>
                      <span className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase",
                        isDone ? "bg-emerald-500/10 text-emerald-500" :
                        isActive ? "bg-indigo-500/10 text-indigo-400" :
                        "bg-slate-500/10 text-slate-400"
                      )}>
                        {isDone ? "Completed" : isActive ? "Processing" : "Pending"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-xs">
                      <span className="text-rose-500 font-bold">{step.beforeScore}</span>
                      <ArrowRight className="w-3 h-3 text-slate-500" />
                      <span className={cn("font-bold text-emerald-500")}>
                        {isDone ? step.afterScore : isActive ? "..." : step.afterScore}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <div className="text-[10px] font-bold text-slate-500 dark:text-neutral-500 uppercase mb-1">改善理由</div>
                      <p className="text-sm text-slate-800 dark:text-neutral-200 font-medium">
                        {step.reason}
                      </p>
                    </div>

                    <div className="bg-slate-50 dark:bg-black/20 rounded-lg p-3 border border-slate-100 dark:border-white/5">
                      <div className="text-[10px] font-bold text-slate-500 dark:text-neutral-500 uppercase mb-2">適用された修正 (Before/After)</div>
                      <ul className="space-y-2">
                        {step.changes.map((change, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-slate-700 dark:text-neutral-300">
                            {change.type === 'add' && <span className="text-emerald-500 mt-0.5"><Zap className="w-3 h-3" /></span>}
                            {change.type === 'update' && <span className="text-blue-500 mt-0.5"><RefreshCw className="w-3 h-3" /></span>}
                            {change.type === 'remove' && <span className="text-rose-500 mt-0.5"><XCircle className="w-3 h-3" /></span>}
                            <span>{change.desc}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
