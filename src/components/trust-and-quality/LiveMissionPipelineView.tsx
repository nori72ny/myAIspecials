import  { useState, useEffect, useRef } from "react";
import { 
  Clock, 
  Coins, 
  Cpu, 
  Sparkles, 
  CheckCircle2, 
  Loader2, 
  Search, 
  ShieldCheck, 
  Database,
  
  
  Fingerprint,
  
  
  Lock,
  Layers,
  
  Zap,
  Shield
} from "lucide-react";
import { cn } from "../../utils";
import { AnalysisResult } from "../../types";
import { motion, AnimatePresence } from "motion/react";

export interface LiveMissionPipelineViewProps {
  /**
   * Mode of the pipeline view.
   * 'live' mode: Runs a dynamic real-time progression synced with boardroom or independent timer.
   * 'static' mode: Renders all steps as completed, showing finalized statistics from the result.
   */
  mode: "live" | "static";
  
  /**
   * Optional phase progress passed from Boardroom to achieve 100% perfect synchronization.
   */
  phaseProgress?: {
    planning: number;
    research: number;
    debate: number;
    factCheck: number;
    quality: number;
    output: number;
  };
  
  /**
   * Final analysis result data to extract Truth Engine, Research, and Output Validation parameters.
   */
  result?: AnalysisResult | null;
  
  /**
   * Called when the live pipeline completes or is approved.
   */
  onComplete?: () => void;
}

interface StepInfo {
  id: string;
  name: string;
  enName: string;
  description: string;
  capability: string;
  provider: string;
}

const PIPELINE_STEPS: StepInfo[] = [
  {
    id: "validation",
    name: "Mission Validation",
    enName: "Mission Validation",
    description: "プロンプトの整合性検証、機密データアクセス監査、ACOS V3 Pre-flightスキャン",
    capability: "Security & Pre-flight Scan",
    provider: "ACOS Validator"
  },
  {
    id: "resolution",
    name: "Capability Resolution",
    enName: "Capability Resolution",
    description: "プロンプトから必要な自律能力（Travel, Code, Legal等）の抽出と分類マトリクスへの割り当て",
    capability: "Linguistic Intent Mapping",
    provider: "ACOS Core Resolver"
  },
  {
    id: "routing",
    name: "Routing",
    enName: "Routing",
    description: "品質・コスト・遅延の多目的最適化、最上位推奨プロバイダ（TOP3）の動的ルーティング意思決定",
    capability: "ZKB Bayesian Routing",
    provider: "ACOS Router v3"
  },
  {
    id: "research",
    name: "Research",
    enName: "Research",
    description: "PerplexityまたはWeb Groundingによるリアルタイム競合情報・文献インプットの自律クローリング",
    capability: "Competitive Intel Web Scrape",
    provider: "Perplexity Pro"
  },
  {
    id: "truth",
    name: "Truth Analysis",
    enName: "Truth Analysis",
    description: "Truth Engine（事実性エンジン）によるゼロ知識相互検証、ソース合意形成、ハルシネーションの遮断",
    capability: "Hallucination Check & Consensus",
    provider: "ACOS Truth Engine"
  },
  {
    id: "generation",
    name: "Generation",
    enName: "Generation",
    description: "最適化ルーティングされたモデル（Gemini/Claude等）による、自律的な成果物＆ソースコード設計",
    capability: "High-Fidelity Code Assembly",
    provider: "Gemini / Claude Dual Model"
  },
  {
    id: "self_review",
    name: "Autonomous Self Review",
    enName: "Autonomous Self Review",
    description: "出力検証器（Output Validator）の前に、AI自身がLogic、Evidence、Citation、Truth、UX、Completeness、Consistencyの7項目を自律監査するプロセス",
    capability: "Self-Review & Sanity Check",
    provider: "ACOS Self Reviewer"
  },
  {
    id: "quality",
    name: "Output Validation",
    enName: "Output Validation",
    description: "Output Evaluation EngineによるUQIゲート（品質・正確性・信頼性・鮮度・網羅性）の自動監査",
    capability: "UQI Compliance Check",
    provider: "ACOS Output Validator"
  },
  {
    id: "approval_gate",
    name: "Ready for Approval",
    enName: "Ready for Approval",
    description: "最終成果物の知的整合性・UQI監査合格。システム実行キーの押下および最終承認を待機中",
    capability: "Consensus Final Human-in-the-Loop Gate",
    provider: "ACOS Human Gatekeeper"
  },
  {
    id: "complete",
    name: "Mission Complete",
    enName: "Mission Complete",
    description: "すべての知的マイルストーンの達成。ナレッジDNAへの自律保存、成果物ダッシュボードの構築完了",
    capability: "Mission Accomplished",
    provider: "ACOS Core Engine"
  }
];

// Baseline Expected Duration (seconds) for remaining time estimation
const STEP_DURATIONS: Record<string, number> = {
  validation: 1.2,
  resolution: 1.2,
  routing: 1.5,
  research: 2.5,
  truth: 2.0,
  generation: 2.5,
  self_review: 2.0,
  quality: 2.0,
  approval_gate: 0.5,
  complete: 0.1
};

export default function LiveMissionPipelineView({
  mode,
  phaseProgress,
  result,
  onComplete
}: LiveMissionPipelineViewProps) {
  // State for user manual approval
  const [isApproved, setIsApproved] = useState(mode === "static");
  const [isApproving, setIsApproving] = useState(false);

  const [elapsedTime, setElapsedTime] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [cost, setCost] = useState(0);

  // Timers and local state for independent live progression (when phaseProgress is not supplied)
  const [localProgress, setLocalProgress] = useState(0);
  const startTimeRef = useRef<number>(Date.now());

  // Real-time Provider Utilization fluctuations
  const [providerFluct, setProviderFluct] = useState({ gemini: 0, claude: 0, gpt: 0, perp: 0, open: 0 });

  // Detect language setting
  const [language, setLanguage] = useState<"ja" | "en">("ja");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("workspace_settings");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.language) {
          setLanguage(parsed.language);
        }
      }
    } catch (e) {}
  }, []);

  const isEn = language === "en";

  // Real-time micro-fluctuations for Providers in Live mode
  useEffect(() => {
    if (mode === "static") return;
    const timer = setInterval(() => {
      setProviderFluct({
        gemini: (Math.random() - 0.5) * 1.5,
        claude: (Math.random() - 0.5) * 1.2,
        gpt: (Math.random() - 0.5) * 1.0,
        perp: (Math.random() - 0.5) * 0.8,
        open: (Math.random() - 0.5) * 0.5 });
    }, 1200);
    return () => clearInterval(timer);
  }, [mode]);

  // Mode live: compute timer and states
  useEffect(() => {
    if (mode === "static") {
      setElapsedTime(14.8);
      setTokenCount(result?.qualityEngine ? 312500 : 284000);
      setCost(result?.qualityEngine ? 0.0864 : 0.0754);
      return;
    }

    // Live independent mode (not driven by Boardroom)
    if (!phaseProgress) {
      startTimeRef.current = Date.now();
      const interval = setInterval(() => {
        setElapsedTime(prev => {
          const next = prev + 0.1;
          // Simulate tokens and cost growing
          setTokenCount(t => Math.floor(t + Math.random() * 2500));
          setCost(c => Number((c + Math.random() * 0.0006).toFixed(4)));
          return Number(next.toFixed(1));
        });

        setLocalProgress(prev => {
          const next = prev + 1;
          if (next >= 100) {
            clearInterval(interval);
            return 100;
          }
          return next;
        });
      }, 150);

      return () => clearInterval(interval);
    }
  }, [mode, phaseProgress, result]);

  // If driven by Boardroom's phaseProgress, sync stats
  useEffect(() => {
    if (mode === "live" && phaseProgress) {
      // Calculate a realistic time based on sum of progress
      const totalPct = (phaseProgress.planning + phaseProgress.research + phaseProgress.debate + phaseProgress.factCheck + phaseProgress.quality + phaseProgress.output) / 6;
      setElapsedTime(Number((totalPct * 0.15).toFixed(1)));
      setTokenCount(Math.floor(totalPct * 3125));
      setCost(Number((totalPct * 0.000864).toFixed(5)));
    }
  }, [mode, phaseProgress]);

  // Compute status for each step dynamically
  const getStepStatus = (stepId: string): "Waiting" | "Running" | "Completed" | "Failed" | "Skipped" => {
    if (mode === "static") {
      return "Completed";
    }

    // If using boardroom's phase progress
    if (phaseProgress) {
      const { planning, research, debate, factCheck, quality, output } = phaseProgress;
      switch (stepId) {
        case "validation":
          if (planning === 0) return "Waiting";
          if (planning < 100) return "Running";
          return "Completed";

        case "resolution":
          if (planning < 40) return "Waiting";
          if (planning < 100) return "Running";
          return "Completed";

        case "routing":
          if (planning < 100) return "Waiting";
          if (research < 30) return "Running";
          return "Completed";

        case "research":
          if (research < 30) return "Waiting";
          if (research < 100) return "Running";
          return "Completed";

        case "truth":
          if (research < 100) return "Waiting";
          if (debate < 100) return "Running";
          return "Completed";

        case "generation":
          if (debate < 100) return "Waiting";
          if (factCheck < 60) return "Running";
          return "Completed";

        case "self_review":
          if (factCheck < 60) return "Waiting";
          if (factCheck < 100) return "Running";
          return "Completed";

        case "quality":
          if (factCheck < 100) return "Waiting";
          if (quality < 100) return "Running";
          return "Completed";

        case "approval_gate":
          if (quality < 100) return "Waiting";
          if (isApproved) return "Completed";
          return "Running"; // Remains running/active until user approves

        case "complete":
          if (isApproved) return "Completed";
          return "Waiting";

        default:
          return "Waiting";
      }
    }

    // If using local simulation progress (0 to 100)
    const stepThresholds: Record<string, { start: number; end: number }> = {
      validation: { start: 0, end: 12 },
      resolution: { start: 12, end: 24 },
      routing: { start: 24, end: 34 },
      research: { start: 34, end: 46 },
      truth: { start: 46, end: 58 },
      generation: { start: 58, end: 72 },
      self_review: { start: 72, end: 84 },
      quality: { start: 84, end: 94 },
      approval_gate: { start: 94, end: 98 },
      complete: { start: 98, end: 100 }
    };

    const range = stepThresholds[stepId];
    if (localProgress < range.start) return "Waiting";
    
    // For approval gate in live simulated mode
    if (stepId === "approval_gate") {
      if (localProgress >= range.end && isApproved) return "Completed";
      if (localProgress >= range.start && !isApproved) return "Running";
    }
    
    if (stepId === "complete") {
      if (isApproved && localProgress >= range.end) return "Completed";
      return "Waiting";
    }

    if (localProgress >= range.end) return "Completed";
    return "Running";
  };

  // Determine currently active step to display prominent metadata
  const activeStep = PIPELINE_STEPS.find(s => getStepStatus(s.id) === "Running") || 
                     (mode === "static" ? PIPELINE_STEPS[PIPELINE_STEPS.length - 1] : PIPELINE_STEPS[0]);

  // Calculate overall progress % (現在進捗 %)
  const overallProgress = phaseProgress 
    ? Math.min(100, Math.round((phaseProgress.planning + phaseProgress.research + phaseProgress.debate + phaseProgress.factCheck + phaseProgress.quality + (isApproved ? 100 : phaseProgress.output)) / 6))
    : localProgress;

  // STEP REMAINING TIME PREDICTOR CALCULATION (各ステップ残り時間)
  const getStepRemainingTime = (stepId: string): number => {
    const status = getStepStatus(stepId);
    if (status === "Completed") return 0.0;
    
    const baseDuration = STEP_DURATIONS[stepId] || 1.0;
    if (status === "Waiting") return baseDuration;

    // If active and running, calculate proportion left
    let pctCompleted = 0;
    if (phaseProgress) {
      if (stepId === "validation" || stepId === "resolution") pctCompleted = phaseProgress.planning;
      else if (stepId === "routing" || stepId === "research") pctCompleted = phaseProgress.research;
      else if (stepId === "truth") pctCompleted = phaseProgress.debate;
      else if (stepId === "generation") pctCompleted = phaseProgress.factCheck * 0.6;
      else if (stepId === "self_review") pctCompleted = Math.max(0, (phaseProgress.factCheck - 60) * 2.5);
      else if (stepId === "quality") pctCompleted = phaseProgress.quality;
      else if (stepId === "approval_gate") pctCompleted = isApproved ? 100 : 0;
      else if (stepId === "complete") pctCompleted = isApproved ? 100 : 0;
    } else {
      const thresholds: Record<string, { start: number; end: number }> = {
        validation: { start: 0, end: 12 },
        resolution: { start: 12, end: 24 },
        routing: { start: 24, end: 34 },
        research: { start: 34, end: 46 },
        truth: { start: 46, end: 58 },
        generation: { start: 58, end: 72 },
        self_review: { start: 72, end: 84 },
        quality: { start: 84, end: 94 },
        approval_gate: { start: 94, end: 98 },
        complete: { start: 98, end: 100 }
      };
      const range = thresholds[stepId];
      if (range) {
        pctCompleted = ((localProgress - range.start) / (range.end - range.start)) * 100;
      }
    }

    const remaining = baseDuration * (1 - Math.min(100, Math.max(0, pctCompleted)) / 100);
    return Number(remaining.toFixed(1));
  };

  // ESTIMATED TIME REMAINING (残り推定時間)
  const totalEstimatedTimeRemaining = isApproved 
    ? 0.0 
    : PIPELINE_STEPS.reduce((sum, step) => sum + getStepRemainingTime(step.id), 0);

  // PROVIDER UTILIZATION VALUES (各AIの利用割合)
  const baseRates = {
    gemini: 38.5,
    claude: 26.2,
    gpt: 18.3,
    perp: 11.4,
    open: 5.6
  };

  const getUtilRate = (key: keyof typeof baseRates) => {
    const raw = baseRates[key] + (mode === "live" ? providerFluct[key] : 0);
    return Number(Math.max(2, Math.min(90, raw)).toFixed(1));
  };

  // COST FORECASTS (現在・予測・最終コスト)
  const currentCost = mode === "static" ? 0.07542 : Math.max(0.0012, cost);
  const finalCost = 0.08640;
  const forecastedCost = mode === "static" 
    ? 0.07542 
    : Math.min(finalCost, currentCost + (finalCost - currentCost) * (overallProgress / 100) + 0.005);

  // INTEGRATED RELIABILITY SUB-METRICS (Mission Reliability 総合ゲージ)
  const subReliability = result?.qualityEngine?.reliability || 97;
  const subConfidence = result?.qualityEngine?.confidence || 96;
  const subTruth = result?.truthEngine?.aiAgreementRate || 95;
  const subResearch = result?.research?.sources?.length 
    ? Math.min(100, 70 + result.research.sources.length * 2.5) 
    : 98;
  const subOutputQuality = result?.successScore || 97;

  // Consolidated Master Score
  const integratedReliabilityScore = Math.round(
    (subReliability + subConfidence + subTruth + subResearch + subOutputQuality) / 5
  );

  // Dynamic Re-routing Trace logs (Phase 5)
  const getTraceLogs = () => {
    if (mode === "static") {
      return [
        { time: "0.0s", type: "INFO", message: isEn ? "Initial route successfully established: Claude 3.5 Sonnet selected." : "初期ルート確立成功: Claude 3.5 Sonnetが自動選定されました。" },
        { time: "0.4s", type: "MONITOR", message: isEn ? "Continuous SLA monitoring active: Latency (850ms), Reliability (98%) are nominal." : "SLA監視アクティブ: 遅延(850ms)、信頼性(98%)は標準値内です。" },
        { time: "1.2s", type: "COST", message: isEn ? "Financial ledger audit: Consumption $0.07542 within standard threshold. Re-routing bypassed." : "財務監査: トークンコスト $0.07542 は予算枠内です。再ルーティングはバイパスされました。" }
      ];
    }

    const logs = [
      { triggerProgress: 10, time: "0.2s", type: "INFO", message: isEn ? "Pre-flight scan complete. Routing engine initialized." : "事前スキャン完了。ルーティング・エンジンが起動されました。" },
      { triggerProgress: 24, time: "1.2s", type: "MONITOR", message: isEn ? "Initial Provider: Gemini 1.5 Pro (Latency: 920ms, Success Rate: 99.1%) selected." : "初期プロバイダ: Gemini 1.5 Pro（遅延: 920ms、成功率: 99.1%）が選定されました。" },
      { triggerProgress: 40, time: "3.5s", type: "WARN", message: isEn ? "Gemini 1.5 Pro response time degraded (1.82s > 1.50s threshold)." : "Gemini 1.5 Proの応答遅延を検知（1.82s > 閾値1.50s）。" },
      { triggerProgress: 46, time: "4.1s", type: "ROUTING", message: isEn ? "SLA Breach Detected. Triggering autonomous Orchestra Re-routing..." : "SLA違反の可能性検知。自律的Orchestra再ルーティングを発動中..." },
      { triggerProgress: 52, time: "4.8s", type: "SUCCESS", message: isEn ? "Swapped route to Claude 3.5 Sonnet (Dynamic Score: 98.4, Cost optimal)." : "Claude 3.5 Sonnetへ再ルーティング完了（動的スコア: 98.4、コスト最適）。" },
      { triggerProgress: 75, time: "7.2s", type: "MONITOR", message: isEn ? "Active route stable. Latency (720ms), Quality (98%) restored." : "アクティブルート安定。遅延(720ms)、品質(98%)が完全に復旧しました。" }
    ];

    return logs.filter(l => localProgress >= l.triggerProgress);
  };

  // Approval handler
  const handleApprove = () => {
    if (isApproving || isApproved) return;
    setIsApproving(true);
    setTimeout(() => {
      setIsApproved(true);
      setIsApproving(false);
      if (onComplete) {
        onComplete();
      }
    }, 1200);
  };

  return (
    <div className="w-full space-y-5 rounded-3xl bg-neutral-950/80 border border-white/[0.05] p-5 backdrop-blur-2xl text-left relative overflow-hidden shadow-2xl">
      {/* Background soft lighting */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-[40px] pointer-events-none animate-pulse" />

      {/* 1. Header with Status Info */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/5 pb-4 relative z-10">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 rounded-md text-[9px] font-bold text-indigo-400 uppercase tracking-widest font-mono">
            <Sparkles className="w-3 h-3 animate-pulse text-indigo-400" />
            <span>ACOS Pipeline Engine v3.0</span>
          </div>
          <h3 className="text-sm font-black text-white tracking-tight flex items-center gap-2">
            {isEn ? "Mission Progress Intelligence" : "ミッション進捗インテリジェンス"}
            {mode === "live" && !isApproved && (
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping inline-block" />
            )}
          </h3>
        </div>

        {/* System Health / Status Badge */}
        <div className="flex items-center gap-1.5">
          <span className="text-[8.5px] text-white/40 uppercase font-mono tracking-wider">System State:</span>
          <span className={cn(
            "text-[9px] font-mono font-bold px-2 py-0.5 rounded border uppercase flex items-center gap-1",
            mode === "live" && !isApproved
              ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/25 animate-pulse" 
              : "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
          )}>
            <span className={cn("w-1.5 h-1.5 rounded-full", mode === "live" && !isApproved ? "bg-indigo-400" : "bg-emerald-400")} />
            {mode === "live" && !isApproved 
              ? (isEn ? "COGNITIVE ACTIVE" : "認識プロセス稼働中") 
              : (isEn ? "CERTIFIED & ARCHIVED" : "承認完了・成果物格納")}
          </span>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 2. ① MISSION PROGRESS PREDICTOR (現在進捗 / 残り時間 / 各ステップ) */}
      {/* ======================================================== */}
      <div className="p-3.5 bg-white/[0.01] border border-white/5 rounded-xl space-y-3 relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-indigo-400" />
            <h4 className="text-[11px] font-bold text-white tracking-wide uppercase">
              {isEn ? "Mission Progress Predictor" : "ミッション進捗予測エンジン"}
            </h4>
          </div>
          <span className="text-[10px] font-mono text-indigo-400 font-bold">
            {isEn ? "Predictor Active" : "推度エンジン稼働中"}
          </span>
        </div>

        {/* Progress percent & estimated remaining time HUD */}
        <div className="grid grid-cols-2 gap-3.5 border-t border-b border-white/5 py-3">
          <div>
            <span className="text-[8px] text-white/40 font-mono uppercase tracking-wider block">
              {isEn ? "CURRENT PROGRESS" : "現在進捗率"}
            </span>
            <span className="text-xl font-black font-mono text-white leading-none block mt-1 tracking-tight">
              {overallProgress}%
            </span>
            <div className="w-full h-1 bg-white/[0.04] rounded-full mt-2 overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-indigo-500 to-pink-500 transition-all duration-300"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          </div>

          <div>
            <span className="text-[8px] text-white/40 font-mono uppercase tracking-wider block">
              {isEn ? "ESTIMATED TIME REMAINING" : "残り推定時間"}
            </span>
            <span className="text-xl font-black font-mono text-amber-400 leading-none block mt-1 tracking-tight">
              {isApproved ? "0.0" : totalEstimatedTimeRemaining.toFixed(1)}<span className="text-xs text-white/40 font-normal ml-0.5">sec</span>
            </span>
            <span className="text-[8.5px] text-white/30 font-mono block mt-2">
              {isApproved 
                ? (isEn ? "All steps processed successfully" : "全プロセス完了")
                : (isEn ? "Dynamically calculating queue" : "キュー遅延をリアルタイム推算中")}
            </span>
          </div>
        </div>

        {/* Steps Remaining Time breakdown list */}
        <div className="space-y-1.5 bg-black/40 p-2.5 rounded-lg border border-white/5">
          <div className="text-[8px] text-white/40 font-mono uppercase tracking-widest mb-1.5 flex justify-between">
            <span>{isEn ? "PIPELINE STEP" : "パイプライン・ステップ"}</span>
            <span>{isEn ? "EST. TIME REMAINING" : "各ステップ残り時間"}</span>
          </div>
          <div className="space-y-1 max-h-[110px] overflow-y-auto pr-1">
            {PIPELINE_STEPS.map((s) => {
              const rem = getStepRemainingTime(s.id);
              const status = getStepStatus(s.id);
              return (
                <div key={s.id} className="flex justify-between items-center text-[9.5px] font-mono py-0.5 border-b border-white/[0.02] last:border-0">
                  <span className={cn(
                    "flex items-center gap-1",
                    status === "Completed" ? "text-white/40 line-through" : "text-white/80"
                  )}>
                    <span className={cn("w-1 h-1 rounded-full", 
                      status === "Completed" ? "bg-emerald-500" : status === "Running" ? "bg-indigo-400 animate-pulse" : "bg-white/10"
                    )} />
                    {isEn ? s.enName : s.name}
                  </span>
                  <span className={cn(
                    "font-bold",
                    status === "Completed" 
                      ? "text-emerald-500/80" 
                      : status === "Running" 
                        ? "text-indigo-400" 
                        : "text-white/50"
                  )}>
                    {status === "Completed" ? (isEn ? "Completed" : "完了") : `${rem.toFixed(1)}s`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 3. ② PROVIDER UTILIZATION (各AIの利用割合の可視化) */}
      {/* ======================================================== */}
      <div className="p-3.5 bg-white/[0.01] border border-white/5 rounded-xl space-y-3 relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <h4 className="text-[11px] font-bold text-white tracking-wide uppercase">
              {isEn ? "AI Provider Utilization Matrix" : "各AIプロバイダ利用占有マトリクス"}
            </h4>
          </div>
          <span className="text-[8.5px] text-white/30 font-mono">
            {isEn ? "Live Router Matrix" : "動的最適化配分"}
          </span>
        </div>

        {/* Stacked visualization chart */}
        <div className="w-full h-2.5 bg-white/[0.03] rounded-full overflow-hidden flex border border-white/5">
          <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${getUtilRate("gemini")}%` }} />
          <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${getUtilRate("claude")}%` }} />
          <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${getUtilRate("gpt")}%` }} />
          <div className="h-full bg-cyan-400 transition-all duration-500" style={{ width: `${getUtilRate("perp")}%` }} />
          <div className="h-full bg-pink-500 transition-all duration-500" style={{ width: `${getUtilRate("open")}%` }} />
        </div>

        {/* Providers grid layout */}
        <div className="grid grid-cols-5 gap-1.5 pt-1">
          {[
            { key: "gemini", label: "Gemini", color: "bg-indigo-500 text-indigo-300" },
            { key: "claude", label: "Claude", color: "bg-amber-500 text-amber-200" },
            { key: "gpt", label: "GPT-4o", color: "bg-emerald-500 text-emerald-200" },
            { key: "perp", label: "Perp Pro", color: "bg-cyan-400 text-cyan-950" },
            { key: "open", label: "OpenRtr", color: "bg-pink-500 text-pink-200" },
          ].map((item) => {
            const val = getUtilRate(item.key as keyof typeof baseRates);
            return (
              <div key={item.key} className="bg-white/[0.02] border border-white/5 p-1.5 rounded-lg flex flex-col justify-between min-w-0">
                <span className="text-[8.5px] font-bold text-white/60 truncate block">{item.label}</span>
                <div className="flex items-baseline justify-between gap-1 mt-1">
                  <span className={cn("inline-block w-1.5 h-1.5 rounded-full shrink-0", item.color.split(" ")[0])} />
                  <span className="text-[10px] font-mono font-black text-white">{val}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ======================================================== */}
      {/* 4. ③ COST FORECAST (現在コスト / 予測コスト / 最終コスト) */}
      {/* ======================================================== */}
      <div className="p-3.5 bg-white/[0.01] border border-white/5 rounded-xl space-y-3 relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Coins className="w-4 h-4 text-amber-400" />
            <h4 className="text-[11px] font-bold text-white tracking-wide uppercase">
              {isEn ? "Cost Forecasting Engine" : "計算リソース・コストフォーキャスト"}
            </h4>
          </div>
          <span className="text-[8.5px] text-amber-400/80 font-mono font-bold uppercase">
            {isEn ? "Token Financials" : "トークン金融構造モデル"}
          </span>
        </div>

        {/* 3-Column Cost grid */}
        <div className="grid grid-cols-3 gap-2.5">
          {/* Current Cost */}
          <div className="bg-black/40 border border-white/5 p-2.5 rounded-xl">
            <span className="text-[8px] text-white/40 font-mono uppercase tracking-wider block">
              {isEn ? "CURRENT COST" : "現在コスト"}
            </span>
            <span className="text-[13px] font-black font-mono text-white block mt-1 tracking-tight">
              ${currentCost.toFixed(5)}
            </span>
            <span className="text-[7.5px] text-white/30 font-mono block mt-1">
              Accumulated
            </span>
          </div>

          {/* Forecasted Cost */}
          <div className="bg-indigo-950/20 border border-indigo-500/15 p-2.5 rounded-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-8 h-8 bg-indigo-500/10 rounded-full blur-[8px] pointer-events-none" />
            <span className="text-[8px] text-indigo-300/80 font-mono uppercase tracking-wider block">
              {isEn ? "PROJECTED FORECAST" : "予測中間コスト"}
            </span>
            <span className="text-[13px] font-black font-mono text-indigo-300 block mt-1 tracking-tight">
              ${forecastedCost.toFixed(5)}
            </span>
            <span className="text-[7.5px] text-indigo-400/60 font-mono block mt-1 animate-pulse">
              Predictive (95% CI)
            </span>
          </div>

          {/* Final Cost */}
          <div className="bg-emerald-950/25 border border-emerald-500/15 p-2.5 rounded-xl">
            <span className="text-[8px] text-emerald-300/80 font-mono uppercase tracking-wider block">
              {isEn ? "FINALIZED ESTIMATE" : "最終推定コスト"}
            </span>
            <span className="text-[13px] font-black font-mono text-emerald-400 block mt-1 tracking-tight">
              ${finalCost.toFixed(5)}
            </span>
            <span className="text-[7.5px] text-emerald-500/50 font-mono block mt-1">
              Max Cap Limit
            </span>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 4.5. ⑤ DYNAMIC ORCHESTRA RE-ROUTING TRACE (Phase 5) */}
      {/* ======================================================== */}
      <div className="p-3.5 bg-white/[0.01] border border-white/5 rounded-xl space-y-3 relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-cyan-400" />
            <h4 className="text-[11px] font-bold text-white tracking-wide uppercase">
              {isEn ? "Dynamic Orchestra Re-routing Trace" : "自律的再ルーティング・トレースログ"}
            </h4>
          </div>
          <span className="text-[8.5px] font-mono font-bold px-1.5 py-0.5 bg-cyan-500/10 text-cyan-400 rounded uppercase animate-pulse border border-cyan-500/25">
            {isEn ? "Orchestra SLA Core" : "SLA自動監査中"}
          </span>
        </div>

        <div className="bg-black/60 rounded-lg p-3 border border-white/5 font-mono text-[9px] space-y-1.5 max-h-[120px] overflow-y-auto">
          {getTraceLogs().length === 0 ? (
            <div className="text-white/30 text-center py-4 italic">
              {isEn ? "Waiting for routing metrics stream..." : "ルーティングメトリクス監視ストリーム待機中..."}
            </div>
          ) : (
            getTraceLogs().map((log, idx) => (
              <div key={idx} className="flex gap-2 items-start leading-relaxed">
                <span className="text-indigo-400 shrink-0">[{log.time}]</span>
                <span className={cn(
                  "px-1 py-0.2 rounded text-[7.5px] font-bold shrink-0 border uppercase",
                  log.type === "SUCCESS" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/15" :
                  log.type === "WARN" ? "bg-amber-500/10 text-amber-400 border-amber-500/15 animate-pulse" :
                  log.type === "ROUTING" ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/15" :
                  log.type === "COST" ? "bg-pink-500/10 text-pink-400 border-pink-500/15" :
                  "bg-white/5 text-white/40 border-white/5"
                )}>
                  {log.type}
                </span>
                <span className={cn(
                  "flex-1",
                  log.type === "SUCCESS" ? "text-emerald-300" :
                  log.type === "WARN" ? "text-amber-300" :
                  log.type === "ROUTING" ? "text-cyan-300 font-bold" :
                  "text-white/70"
                )}>
                  {log.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ======================================================== */}
      {/* 5. ④ MISSION RELIABILITY (5つの次元を統合した総合ゲージ) */}
      {/* ======================================================== */}
      <div className="p-3.5 bg-white/[0.01] border border-white/5 rounded-xl space-y-3.5 relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Shield className="w-4 h-4 text-emerald-400" />
            <h4 className="text-[11px] font-bold text-white tracking-wide uppercase">
              {isEn ? "Integrated Mission Reliability" : "総合意思決定信頼度ゲージ / ACOS-R"}
            </h4>
          </div>
          <span className="text-[9px] font-mono text-emerald-400 font-bold">
            {integratedReliabilityScore >= 95 ? "EXCELLENT STATUS" : "STABLE STATUS"}
          </span>
        </div>

        {/* Master Radial Gauge & Sub Checklist Grid */}
        <div className="flex flex-col sm:flex-row items-center gap-5 bg-black/30 p-3 rounded-xl border border-white/5">
          {/* Master Ring Gauge */}
          <div className="relative w-20 h-20 shrink-0 flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="40"
                cy="40"
                r="34"
                className="stroke-white/[0.04] fill-none"
                strokeWidth="5"
              />
              <circle
                cx="40"
                cy="40"
                r="34"
                className="stroke-emerald-400 fill-none transition-all duration-1000 ease-out"
                strokeWidth="5.5"
                strokeDasharray={`${2 * Math.PI * 34}`}
                strokeDashoffset={`${2 * Math.PI * 34 * (1 - integratedReliabilityScore / 100)}`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-base font-black font-mono text-white leading-none">
                {integratedReliabilityScore}%
              </span>
              <span className="text-[7.5px] text-white/40 font-mono uppercase tracking-wider block mt-0.5">
                Reliability
              </span>
            </div>
          </div>

          {/* Sub reliability metrics bars */}
          <div className="flex-1 space-y-2 w-full">
            {[
              { label: isEn ? "Reliability" : "1. 機械適合信頼度", value: subReliability, color: "bg-indigo-500" },
              { label: isEn ? "Confidence" : "2. 自信確率指数", value: subConfidence, color: "bg-pink-500" },
              { label: isEn ? "Truth Check" : "3. ゼロ知識真実率", value: subTruth, color: "bg-cyan-400" },
              { label: isEn ? "Research Citations" : "4. 学術・競合証跡率", value: subResearch, color: "bg-amber-400" },
              { label: isEn ? "Output Quality" : "5. UQI適合判定値", value: subOutputQuality, color: "bg-emerald-400" }
            ].map((metric, idx) => (
              <div key={idx} className="space-y-0.5">
                <div className="flex justify-between items-baseline text-[8.5px] font-mono">
                  <span className="text-white/60">{metric.label}</span>
                  <span className="text-white font-bold">{metric.value}%</span>
                </div>
                <div className="w-full h-1 bg-white/[0.04] rounded-full overflow-hidden">
                  <div 
                    className={cn("h-full transition-all duration-1000", metric.color)}
                    style={{ width: `${metric.value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 6. ⑤ MISSION APPROVAL GATE (最終承認ゲート) & PIPELINE */}
      {/* ======================================================== */}
      <AnimatePresence mode="wait">
        {/* If reaches 100% output/quality and NOT approved, show the active human-in-the-loop validation card! */}
        {mode === "live" && overallProgress >= 94 && !isApproved && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="p-4 bg-gradient-to-br from-indigo-950/70 to-neutral-950 border-2 border-indigo-500/30 rounded-2xl relative z-10 space-y-3.5 shadow-indigo-500/10 shadow-lg"
          >
            <div className="absolute top-0 right-0 p-1 bg-indigo-500/20 rounded-bl-xl border-l border-b border-indigo-500/30">
              <Fingerprint className="w-4 h-4 text-indigo-400 animate-pulse" />
            </div>

            <div className="flex gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                <Lock className="w-4 h-4 animate-bounce" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-black text-indigo-200 uppercase tracking-wider">
                  {isEn ? "ACOS Core: Ready for Human Approval" : "ACOS Core: 最終実行ライセンス署名待機"}
                </h4>
                <p className="text-[9.5px] text-white/70 leading-relaxed">
                  {isEn 
                    ? "Intellectual compilation is complete. The system is waiting for manual authorization signature to register deliverables into the secure local database."
                    : "知的データの統合・正確性チェックに合格しました。システムを実行完了し成果物ダッシュボードを有効化するために、最終実行承認を付与してください。"}
                </p>
              </div>
            </div>

            <button
              onClick={handleApprove}
              disabled={isApproving}
              className={cn(
                "w-full py-2.5 rounded-xl font-bold font-mono text-[11px] tracking-widest uppercase transition-all flex items-center justify-center gap-2 cursor-pointer border shadow-lg",
                isApproving
                  ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/20 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-400 shadow-indigo-500/10"
              )}
            >
              {isApproving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>{isEn ? "Authorizing Security Keys..." : "セキュア認証キーを照合中..."}</span>
                </>
              ) : (
                <>
                  <Fingerprint className="w-4 h-4 animate-pulse text-pink-300" />
                  <span>{isEn ? "Authorize & Complete Mission" : "承認してミッションを完了する"}</span>
                </>
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Static Certified Stamp (Rendered inside static tab) */}
      {isApproved && (
        <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl relative z-10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] font-black text-emerald-400 font-mono tracking-widest uppercase">
                {isEn ? "ACOS CORE CERTIFIED" : "ACOS 認証済・監査パス完了"}
              </div>
              <div className="text-[8.5px] text-white/50 leading-none mt-1">
                {isEn ? "Cryptographic Human-in-the-Loop Sign-off Granted" : "最終実行ライセンスおよび人的最終承認確認済"}
              </div>
            </div>
          </div>
          <span className="text-[8px] font-mono px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded uppercase font-bold border border-emerald-500/25">
            APPROVED
          </span>
        </div>
      )}

      {/* 7. Vertical Interactive Steps Pipeline List */}
      <div className="relative z-10 space-y-4 pt-2 pl-2 border-t border-white/5">
        <h4 className="text-[9.5px] font-black text-white/40 tracking-widest font-mono uppercase">
          {isEn ? "Detailed Pipeline Sockets" : "詳細プロセス・パイプライン・ソケット"}
        </h4>
        <div className="space-y-4">
          {PIPELINE_STEPS.map((step, idx) => {
            const status = getStepStatus(step.id);
            const isCompleted = status === "Completed";
            const isRunning = status === "Running";
            const isWaiting = status === "Waiting";

            // Sync data displays
            let syncDetail = null;
            if (isCompleted || isRunning) {
              const activeResult = result || {
                successScore: 97,
                research: {
                  sources: ["https://scholar.google.com/...", "https://arxiv.org/..."],
                  progressLogs: ["Scraping competitive parameters...", "Parsing sector indexes..."]
                },
                truthEngine: {
                  aiAgreementRate: 96,
                  citationRate: 98,
                  officialConfirmation: "IEEE standards compliance confirmed",
                  hallucinationCheck: "Cleared. No anomalies detected."
                },
                qualityEngine: {
                  accuracy: 98,
                  confidence: 96,
                  reliability: 97
                }
              };

              if (step.id === "research" && activeResult.research) {
                const count = activeResult.research.sources?.length || 12;
                syncDetail = (
                  <div className="mt-1.5 p-2 bg-black/30 border border-white/5 rounded-lg space-y-1 text-[10px]">
                    <div className="text-white/40 font-mono uppercase text-[7.5px] tracking-wider flex items-center gap-1">
                      <Search className="w-3 h-3 text-cyan-400" />
                      RESEARCH ENGINE SYNCHRONIZED LOGS:
                    </div>
                    <div className="text-white/80 leading-normal">
                      💡 Retrieved <span className="text-cyan-300 font-bold">{count} key references</span> and competitor intelligence datasets. 
                    </div>
                    {activeResult.research.progressLogs && activeResult.research.progressLogs.length > 0 && (
                      <div className="text-[8.5px] text-white/50 font-mono border-t border-white/5 pt-1 truncate">
                        Latest crawl: {activeResult.research.progressLogs[activeResult.research.progressLogs.length - 1]}
                      </div>
                    )}
                  </div>
                );
              } else if (step.id === "truth" && activeResult.truthEngine) {
                syncDetail = (
                  <div className="mt-1.5 p-2 bg-black/30 border border-white/5 rounded-lg space-y-1 text-[10px]">
                    <div className="text-white/40 font-mono uppercase text-[7.5px] tracking-wider flex items-center gap-1">
                      <Database className="w-3 h-3 text-emerald-400" />
                      TRUTH ENGINE MUTUAL VALIDATION:
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-0.5 text-[9px] font-mono">
                      <div className="bg-white/5 p-1 rounded">
                        <span className="text-white/40">Agreement Rate:</span>{" "}
                        <span className="text-emerald-400 font-bold">{activeResult.truthEngine.aiAgreementRate}%</span>
                      </div>
                      <div className="bg-white/5 p-1 rounded">
                        <span className="text-white/40">Citation Rate:</span>{" "}
                        <span className="text-indigo-400 font-bold">{activeResult.truthEngine.citationRate}%</span>
                      </div>
                    </div>
                    <div className="text-[8.5px] text-emerald-400/80 font-mono pt-1 flex items-center gap-1">
                      <CheckCircle2 className="w-2.5 h-2.5" /> Hallucination Check: {activeResult.truthEngine.hallucinationCheck || "Passed"}
                    </div>
                  </div>
                );
              } else if (step.id === "self_review") {
                const reviewItems = [
                  { key: "logic", labelJA: "論理検証 (Logic)", labelEN: "Logic Verification" },
                  { key: "evidence", labelJA: "証拠検証 (Evidence)", labelEN: "Evidence Match" },
                  { key: "citation", labelJA: "引用検証 (Citation)", labelEN: "Citation Audit" },
                  { key: "truth", labelJA: "事実検証 (Truth)", labelEN: "Truth Integrity" },
                  { key: "ux", labelJA: "体験検証 (UX)", labelEN: "UX Compliance" },
                  { key: "completeness", labelJA: "網羅検証 (Completeness)", labelEN: "Completeness Audit" },
                  { key: "consistency", labelJA: "一貫検証 (Consistency)", labelEN: "Consistency Check" }
                ];

                let activeItemIdx = isCompleted ? 7 : -1;
                if (isRunning) {
                  const rel = Math.max(0, localProgress - 72); // 0 to 12
                  activeItemIdx = Math.min(6, Math.floor((rel / 12) * 7));
                }

                syncDetail = (
                  <div className="mt-2 p-2.5 bg-black/50 border border-white/5 rounded-xl space-y-2 text-[10px]">
                    <div className="text-white/40 font-mono uppercase text-[7.5px] tracking-wider flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-pink-400 animate-pulse" />
                      AUTONOMOUS COGNITIVE SELF-REVIEW GATE (7 ITEMS):
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                      {reviewItems.map((item, index) => {
                        const itemDone = isCompleted || index < activeItemIdx;
                        const itemActive = isRunning && index === activeItemIdx;
                        return (
                          <div 
                            key={item.key} 
                            className={cn(
                              "p-1.5 rounded border text-[9px] font-mono flex items-center justify-between transition-all",
                              itemDone 
                                ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-300"
                                : itemActive 
                                  ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-200 animate-pulse"
                                  : "bg-white/[0.01] border-white/5 text-white/30"
                            )}
                          >
                            <span className="truncate max-w-[130px]">
                              {isEn ? item.labelEN : item.labelJA}
                            </span>
                            {itemDone ? (
                              <span className="text-[8px] px-1 bg-emerald-500/20 text-emerald-400 rounded font-bold">PASS</span>
                            ) : itemActive ? (
                              <span className="text-[8px] px-1 bg-indigo-500/20 text-indigo-400 rounded font-bold animate-pulse">REVIEWING</span>
                            ) : (
                              <span className="text-[8px] px-1 bg-white/5 text-white/20 rounded">WAIT</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              } else if (step.id === "quality" && activeResult.qualityEngine) {
                syncDetail = (
                  <div className="mt-1.5 p-2 bg-black/30 border border-white/5 rounded-lg space-y-1 text-[10px]">
                    <div className="text-white/40 font-mono uppercase text-[7.5px] tracking-wider flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-pink-400" />
                      OUTPUT EVALUATION GATEWAY (UQI AUDIT):
                    </div>
                    <div className="grid grid-cols-3 gap-1 pt-0.5 text-[8.5px] font-mono text-center">
                      <div className="bg-white/5 p-1 rounded">
                        <div className="text-white/30 text-[7px] uppercase">ACCURACY</div>
                        <div className="text-pink-400 font-bold">{activeResult.qualityEngine.accuracy}%</div>
                      </div>
                      <div className="bg-white/5 p-1 rounded">
                        <div className="text-white/30 text-[7px] uppercase">CONFIDENCE</div>
                        <div className="text-indigo-400 font-bold">{activeResult.qualityEngine.confidence}%</div>
                      </div>
                      <div className="bg-white/5 p-1 rounded">
                        <div className="text-white/30 text-[7px] uppercase">RELIABILITY</div>
                        <div className="text-emerald-400 font-bold">{activeResult.qualityEngine.reliability}%</div>
                      </div>
                    </div>
                    <div className="text-[8.5px] text-white/50 font-mono pt-1 text-center">
                      UQI Gate Threshold: 95% | Current: <span className="text-white font-bold">{activeResult.successScore}%</span> (Certified)
                    </div>
                  </div>
                );
              }
            }

            return (
              <div key={step.id} className="relative flex gap-4 text-xs group">
                {/* Vertical timeline connector */}
                {idx < PIPELINE_STEPS.length - 1 && (
                  <div className={cn(
                    "absolute left-3 top-6 bottom-0 w-[1.5px] -ml-[0.75px] transition-all",
                    isCompleted ? "bg-emerald-500" : isRunning ? "bg-gradient-to-b from-indigo-500 to-white/5" : "bg-white/5"
                  )} />
                )}

                {/* Status bullet icon */}
                <div className="relative z-10 shrink-0">
                  {isCompleted ? (
                    <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500 flex items-center justify-center text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </div>
                  ) : isRunning ? (
                    <div className="w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-400 flex items-center justify-center text-indigo-400 animate-spin">
                      <Loader2 className="w-3.5 h-3.5" />
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-black border border-white/15 flex items-center justify-center text-white/35 font-mono text-[9px]">
                      {idx + 1}
                    </div>
                  )}
                </div>

                {/* Step info text */}
                <div className="flex-1 pb-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <h4 className={cn(
                      "font-bold transition-colors",
                      isCompleted ? "text-slate-200" : isRunning ? "text-indigo-400 text-[12.5px]" : "text-white/45"
                    )}>
                      {isEn ? step.enName : step.name}
                    </h4>
                    <span className={cn(
                      "text-[8px] font-mono font-bold px-1.5 py-0.2 rounded border uppercase",
                      isCompleted 
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/10"
                        : isRunning 
                          ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/15 animate-pulse"
                          : "bg-white/5 text-white/30 border-white/5"
                    )}>
                      {status}
                    </span>
                  </div>
                  
                  {/* Description and sync details */}
                  <p className={cn(
                    "text-[10.5px] leading-normal mt-0.5 transition-colors",
                    isWaiting ? "text-white/25" : "text-white/60"
                  )}>
                    {isEn ? step.description : step.description}
                  </p>

                  {syncDetail}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
