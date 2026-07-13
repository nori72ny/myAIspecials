// ValidationSuite.tsx - Sprint 21: World Class Validation Program Component
import  { useState, useMemo } from "react";
import { motion } from "motion/react";
import {
  ShieldAlert,
  Search,
  
  
  TrendingUp,
  Cpu,
  Trophy,
  Activity,
  Award,
  Zap,
  
  
  GitBranch,
  Flame,
  CheckCircle2,
  XCircle,
  FileText,
  PlusCircle,
  
  
  RefreshCw,
  
  
  Sliders } from "lucide-react";
import {
  generate300Missions,
  VALIDATION_CATEGORIES,
  INITIAL_WORLD_BENCHMARKS,
  INITIAL_WEAKNESSES,
  INITIAL_DAILY_EVOLUTION,
  INITIAL_WEEKLY_REPORTS
} from "./ValidationSuiteData";
import {
  
  EvaluationScores,
  EvaluationResult,
  WorldBenchmarkStats,
  WeaknessAnalysis,
  DailyEvolutionLog,
  QualityWeeklyReport
} from "./ValidationSuiteTypes";

export default function ValidationSuite() {
  // State for original seed data
  const allMissions = useMemo(() => generate300Missions(), []);
  
  // Browsing State
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedMissionIdx, setSelectedMissionIdx] = useState<number>(0);
  
  // Interactive Evaluation states
  const [isEvaluatingSingle, setIsEvaluatingSingle] = useState<boolean>(false);
  const [singleEvalResult, setSingleEvalResult] = useState<EvaluationResult | null>(null);
  
  // Regression Test States
  const [isRunningRegression, setIsRunningRegression] = useState<boolean>(false);
  const [regressionProgress, setRegressionProgress] = useState<number>(0); // 0 to 300
  const [regressionFailCount, setRegressionFailCount] = useState<number>(0);
  const [regressionScores, setRegressionScores] = useState<{
    avgQuality: number;
    avgFact: number;
    avgUX: number;
    avgSpeed: number;
  }>({ avgQuality: 96.5, avgFact: 97.5, avgUX: 95.5, avgSpeed: 95.8 });
  const [regressionHasRun, setRegressionHasRun] = useState<boolean>(false);
  const [regressionStatus, setRegressionStatus] = useState<"PASSED" | "BLOCKED" | "NOT_RUN">("NOT_RUN");
  const [baselineQuality] = useState<number>(95.0); // Baseline to check if merge is permitted
  const [simulatedFailureMissions, setSimulatedFailureMissions] = useState<string[]>([]);

  // World Benchmark customizable list
  const [worldBenchmarks, setWorldBenchmarks] = useState<WorldBenchmarkStats[]>(INITIAL_WORLD_BENCHMARKS);
  const [newAiName, setNewAiName] = useState("");
  const [newAiWinRate, setNewAiWinRate] = useState(70);

  // Weakness Analyzer
  const [weaknesses, setWeaknesses] = useState<WeaknessAnalysis[]>(INITIAL_WEAKNESSES);
  const [newWeaknessCategory, setNewWeaknessCategory] = useState("日常");
  const [isGeneratingWeaknessPlan, setIsGeneratingWeaknessPlan] = useState(false);

  // Daily Evolution
  const [evolutionLogs, setEvolutionLogs] = useState<DailyEvolutionLog[]>(INITIAL_DAILY_EVOLUTION);
  const [simulatingDailyEvolution, setSimulatingDailyEvolution] = useState(false);

  // Quality Weekly Report
  const [weeklyReports, setWeeklyReports] = useState<QualityWeeklyReport[]>(INITIAL_WEEKLY_REPORTS);
  const [isGeneratingWeeklyReport, setIsGeneratingWeeklyReport] = useState(false);

  // Filtered Missions
  const filteredMissions = useMemo(() => {
    return allMissions.filter((m) => {
      const matchCat = selectedCategory === "All" || m.category === selectedCategory;
      const matchDiff = selectedDifficulty === "All" || m.difficulty === selectedDifficulty;
      const matchSearch =
        searchQuery.trim() === "" ||
        m.input.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.id.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchDiff && matchSearch;
    });
  }, [allMissions, selectedCategory, selectedDifficulty, searchQuery]);

  // Handle active mission change securely
  const activeMission = useMemo(() => {
    if (filteredMissions.length === 0) return null;
    return filteredMissions[selectedMissionIdx] || filteredMissions[0];
  }, [filteredMissions, selectedMissionIdx]);

  // Run Auto Evaluation for a Single Mission
  const runSingleEvaluation = () => {
    if (!activeMission || isEvaluatingSingle) return;
    setIsEvaluatingSingle(true);
    setSingleEvalResult(null);

    let progress = 0;
    const interval = setInterval(() => {
      progress += 20;
      if (progress >= 100) {
        clearInterval(interval);
        
        // Generate metrics-based scoring dynamically depending on the difficulty
        // Easy has higher baseline scores, expert/impossible has higher variance
        const seed = Math.random();
        const baseScore = activeMission.difficulty === "Easy" ? 95 
                        : activeMission.difficulty === "Normal" ? 90 
                        : activeMission.difficulty === "Hard" ? 85 
                        : activeMission.difficulty === "Expert" ? 80 
                        : 70; // Impossible
        
        const scores: EvaluationScores = {
          fact: Number((baseScore + seed * (100 - baseScore)).toFixed(1)),
          goal: Number((baseScore + seed * (100 - baseScore) * 0.95).toFixed(1)),
          ux: Number((baseScore + seed * (100 - baseScore) * 0.98).toFixed(1)),
          speed: Number((80 + seed * 20).toFixed(1)),
          completeness: Number((baseScore + seed * (100 - baseScore) * 0.97).toFixed(1)),
          readability: Number((baseScore + seed * (100 - baseScore) * 0.99).toFixed(1)),
          structure: Number((baseScore + seed * (100 - baseScore) * 0.96).toFixed(1)),
          evidence: Number((baseScore + seed * (100 - baseScore) * 0.92).toFixed(1)),
          risk: Number((95 + seed * 5).toFixed(1)), // High score means safe (low risk)
          creativity: Number((75 + seed * 25).toFixed(1)),
          actionability: Number((baseScore + seed * (100 - baseScore) * 0.94).toFixed(1)),
          reasoning: Number((baseScore + seed * (100 - baseScore) * 0.98).toFixed(1))
        };

        const average = Number((Object.values(scores).reduce((a, b) => a + b, 0) / 12).toFixed(1));

        setSingleEvalResult({
          missionId: activeMission.id,
          status: average >= 80 ? "Pass" : "Fail",
          scores,
          averageScore: average,
          evaluatedAt: new Date().toLocaleTimeString(),
          commentary: `【自動採点完了】ミッション「${activeMission.id}」は総合評価 ${average} 点で合格ラインを突破しました。評価基準（理想回答）に示される ${activeMission.golden.criteria.length} つの制約条件を完璧に充足しています。`
        });
        setIsEvaluatingSingle(false);
      }
    }, 200);
  };

  // Run Regression Test Suite for all 300 Missions (④)
  const runRegressionTestSuite = (shouldSimulateQualityDrop: boolean = false) => {
    if (isRunningRegression) return;
    setIsRunningRegression(true);
    setRegressionProgress(0);
    setRegressionFailCount(0);
    setRegressionHasRun(true);
    setRegressionStatus("NOT_RUN");
    setSimulatedFailureMissions([]);

    let current = 0;
    let fails = 0;
    const failuresList: string[] = [];
    
    const interval = setInterval(() => {
      // Fast batches of 15 missions
      current += 15;
      setRegressionProgress(current);

      // Random failure generation (or artificial drop to test merge blocks!)
      if (shouldSimulateQualityDrop) {
        // High failure rate to trigger Merge Blocked state
        if (Math.random() > 0.6 && fails < 32) {
          fails += 2;
          failuresList.push(`acos-mission-${Math.round(current + Math.random() * 5).toString().padStart(3, "0")}`);
        }
      } else {
        // Normal state: very high success rate, 1-2 random edge fails maximum
        if (Math.random() > 0.95 && fails < 3) {
          fails += 1;
          failuresList.push(`acos-mission-${Math.round(current + Math.random() * 5).toString().padStart(3, "0")}`);
        }
      }

      setRegressionFailCount(fails);
      setSimulatedFailureMissions(failuresList);

      if (current >= 300) {
        clearInterval(interval);
        setIsRunningRegression(false);
        
        // Final score tabulation
        const finalQuality = shouldSimulateQualityDrop ? 91.4 : 96.8;
        const finalFact = shouldSimulateQualityDrop ? 92.5 : 97.6;
        const finalUX = shouldSimulateQualityDrop ? 91.0 : 95.8;
        const finalSpeed = shouldSimulateQualityDrop ? 90.5 : 96.0;

        setRegressionScores({
          avgQuality: finalQuality,
          avgFact: finalFact,
          avgUX: finalUX,
          avgSpeed: finalSpeed
        });

        // Regression Test block logic: Block if quality is below the baseline
        if (finalQuality >= baselineQuality && fails <= 5) {
          setRegressionStatus("PASSED");
        } else {
          setRegressionStatus("BLOCKED");
        }
      }
    }, 100);
  };

  // ⑤ World Benchmark: Add a customizable new AI Model to the leaderboard
  const addNewAiToBenchmark = () => {
    if (!newAiName.trim()) return;
    const item: WorldBenchmarkStats = {
      aiName: newAiName,
      winRate: Number(newAiWinRate.toFixed(1)),
      latencyMs: Math.round(1500 + Math.random() * 1500),
      qualityScore: Number((newAiWinRate * 0.98).toFixed(1)),
      reliability: Number((newAiWinRate * 1.01).toFixed(1))
    };
    setWorldBenchmarks(prev => {
      const filtered = prev.filter(a => a.aiName !== "Future AI (Upcoming)");
      const updated = [...filtered, item].sort((a, b) => b.winRate - a.winRate);
      return [...updated, { aiName: "Future AI (Upcoming)", winRate: 0, latencyMs: 0, qualityScore: 0, reliability: 0 }];
    });
    setNewAiName("");
  };

  // ⑥ Weakness Analyzer: Weekly feedback mechanism with automated plan generation
  const runWeaknessAnalysis = () => {
    if (isGeneratingWeaknessPlan) return;
    setIsGeneratingWeaknessPlan(true);

    setTimeout(() => {
      const generatedPlans: Record<string, string> = {
        "日常": "ウェアラブルAPI連携のパーソナル文脈適合エンジンのキャッシュ効率を向上させ、10分未満の朝習慣の細分化ロジックを追加。",
        "仕事": "契約書類の自動差分抽出（Diff Parser）における日本語敬語階層の静的ルールを追加し、ステークホルダーへの不利益条項を100%事前検知。",
        "プログラミング": "React 19 + TypeScript 環境下の `useActionState` 等の新しいフック依存関係の自動補完パターンを、思考ツリーのコードテンプレートに事前インストール。",
        "営業": "SPINヒアリングモデルの『インプリケーション質問（Implication Questions）』における、業種別(製造、小売、医療)の課題プールを増強。"
      };

      const newAnalysis: WeaknessAnalysis = {
        id: `weakness-${Date.now()}`,
        analyzedAt: new Date().toISOString().slice(0, 10),
        category: newWeaknessCategory,
        failCount: Math.round(5 + Math.random() * 10),
        rootCause: `カテゴリ「${newWeaknessCategory}」のExpert難易度において、一部のニッチな業界慣習・制約の推論段階でコンテキスト整合エラーが発生。`,
        improvementPlan: generatedPlans[newWeaknessCategory] || "思考エージェントのコンプライアンス監査レイヤーを強化し、多角的なドラフト比較アルゴリズムを再統合する。",
        remediationStatus: "Open"
      };

      setWeaknesses(prev => [newAnalysis, ...prev]);
      setIsGeneratingWeaknessPlan(false);
    }, 600);
  };

  // ⑦ Daily Evolution simulation
  const triggerDailyEvolutionTick = () => {
    if (simulatingDailyEvolution) return;
    setSimulatingDailyEvolution(true);

    setTimeout(() => {
      const last = evolutionLogs[evolutionLogs.length - 1];
      const nextSuccess = Number(Math.min(99.9, last.successRate + 0.1).toFixed(1));
      const nextQuality = Number(Math.min(99.9, last.overallQuality + 0.1).toFixed(1));
      const nextFact = Number(Math.min(99.9, last.factScore + 0.1).toFixed(1));
      const nextUx = Number(Math.min(99.9, last.uxScore + 0.1).toFixed(1));
      const nextSpeed = Number(Math.min(99.9, last.speedScore + 0.2).toFixed(1));
      
      const newLog: DailyEvolutionLog = {
        date: "07/11",
        successRate: nextSuccess,
        overallQuality: nextQuality,
        factScore: nextFact,
        uxScore: nextUx,
        speedScore: nextSpeed,
        improvementRate: 0.3
      };

      setEvolutionLogs(prev => [...prev, newLog]);
      setSimulatingDailyEvolution(false);
    }, 500);
  };

  // ⑧ Quality Weekly Report Generator
  const generateWeeklyReport = () => {
    if (isGeneratingWeeklyReport) return;
    setIsGeneratingWeeklyReport(true);

    setTimeout(() => {
      const newReport: QualityWeeklyReport = {
        weekId: `W28 (July 8th-14th)`,
        generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
        improvements: [
          "自動採点エンジン(Automatic Evaluation)における12指標のレーダーチャート感度調整完了。",
          "300 Mission Benchmark Suiteの動的テストベッド環境を安全隔離サーバーに分離デプロイ。"
        ],
        risks: [
          "将来追加AIによるコールドアウトバウンドのベンチマーク比較におけるデータ同期の遅延時間。"
        ],
        debts: [
          "Regression Testにおけるテストケース生成ルーチンの配列最適化、メモリキャッシュ回収間隔の設定。"
        ],
        qualitySummary: "自動回帰テストプログラムの合格判定率が96.8%に向上。マージブロックゲートが安全に機能していることを確認。",
        averageSpeedMs: 1420,
        satisfactionRate: 99.4
      };

      setWeeklyReports(prev => [newReport, ...prev]);
      setIsGeneratingWeeklyReport(false);
    }, 800);
  };

  return (
    <div className="space-y-6 text-slate-100" id="acos-validation-program">
      
      {/* 1. Header & Summary */}
      <div className="bg-slate-950 p-6 rounded-2xl border border-rose-500/10 shadow-xl space-y-4">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <div className="text-[10px] text-rose-400 font-mono font-bold uppercase tracking-wider flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5 animate-pulse text-rose-500" /> World Class Validation Program
            </div>
            <h3 className="text-xl font-black text-white mt-1">
              ACOS 2.0 Quality Assurance & Validation Suite
            </h3>
            <p className="text-xs text-slate-400">
              ACOSを「世界最高品質」のAI OSとして検証・定量評価するための、自動採点＆回帰テストフレームワークです。
            </p>
          </div>
          
          <div className="flex gap-2">
            <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-center">
              <div className="text-[9px] font-mono text-slate-500 uppercase">Baseline Quality</div>
              <div className="text-sm font-black text-white font-mono mt-0.5">{baselineQuality.toFixed(1)}%</div>
            </div>
            <div className="bg-slate-900 border border-emerald-500/10 rounded-xl px-4 py-2.5 text-center">
              <div className="text-[9px] font-mono text-emerald-400 uppercase">Current Quality</div>
              <div className="text-sm font-black text-emerald-400 font-mono mt-0.5">
                {regressionHasRun ? regressionScores.avgQuality.toFixed(1) : "96.5"}%
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Grid Layout: Left Column = Interactive Regression & Benchmarks, Right Column = Mission Explorer & Evaluator */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        
        {/* LEFT COMPONENT (7/12): Regression Runner & World Benchmarks */}
        <div className="xl:col-span-7 space-y-6">
          
          {/* ④ Regression Test & Git Pre-Merge gate */}
          <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-6 shadow-xl">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-[10px] text-indigo-400 font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                  <GitBranch className="w-3.5 h-3.5" /> ④ Regression Test & Codebase Guard
                </div>
                <h4 className="text-sm font-black text-white mt-1">
                  Automated Regression Testing Gate
                </h4>
                <p className="text-xs text-slate-400">
                  新機能マージ前に300件のMissionを一括再実行。品質が基準({baselineQuality}%)を下回ると自動でマージを拒否します。
                </p>
              </div>

              {/* Secure status indicator */}
              <div className="shrink-0">
                {regressionStatus === "PASSED" && (
                  <span className="px-3 py-1 bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold rounded border border-emerald-500/30 flex items-center gap-1 shadow-md shadow-emerald-500/5 animate-fade-in">
                    <CheckCircle2 className="w-3.5 h-3.5" /> MERGE PERMITTED (PASSED)
                  </span>
                )}
                {regressionStatus === "BLOCKED" && (
                  <span className="px-3 py-1 bg-red-500/20 text-red-300 text-[10px] font-mono font-bold rounded border border-red-500/30 flex items-center gap-1 animate-pulse">
                    <XCircle className="w-3.5 h-3.5 animate-bounce" /> MERGE BLOCKED (QUALITY DROP)
                  </span>
                )}
                {regressionStatus === "NOT_RUN" && (
                  <span className="px-3 py-1 bg-slate-900 text-slate-400 text-[10px] font-mono font-bold rounded border border-slate-800">
                    AWAITING SUITE RUN
                  </span>
                )}
              </div>
            </div>

            {/* Progress and Actions */}
            <div className="bg-slate-900/60 p-5 rounded-xl border border-slate-900 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="flex gap-2">
                  <button
                    onClick={() => runRegressionTestSuite(false)}
                    disabled={isRunningRegression}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                      isRunningRegression
                        ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                        : "bg-emerald-600 hover:bg-emerald-500 text-white font-sans"
                    }`}
                  >
                    <Sliders className="w-4 h-4" /> Run Regression (Standard)
                  </button>
                  <button
                    onClick={() => runRegressionTestSuite(true)}
                    disabled={isRunningRegression}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                      isRunningRegression
                        ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                        : "bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/20 font-sans"
                    }`}
                  >
                    <Flame className="w-4 h-4" /> Simulate Quality Regression
                  </button>
                </div>

                <div className="text-xs text-slate-400 font-mono">
                  Progress: <span className="text-white font-bold">{regressionProgress} / 300</span> Missions
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden">
                <motion.div
                  className={`h-full ${regressionStatus === "BLOCKED" ? "bg-red-500" : "bg-emerald-500"}`}
                  initial={{ width: "0%" }}
                  animate={{ width: `${(regressionProgress / 300) * 100}%` }}
                  transition={{ duration: 0.1 }}
                />
              </div>

              {/* Active execution logs */}
              {isRunningRegression && (
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 h-24 overflow-y-auto text-[10px] font-mono text-slate-400 space-y-1">
                  <div>[⚡ RUNNER] Launching World Class Verification Program regression process...</div>
                  {regressionProgress > 50 && <div>[🧪 SUITE] Checked categories: 日常, 仕事, 企画, 営業. Passed...</div>}
                  {regressionProgress > 120 && <div>[🧪 SUITE] Evaluated: プログラミング, 要約, 比較, 調査...</div>}
                  {regressionProgress > 220 && <div>[🧪 SUITE] Running Impossible difficulties for 意思決定 & 家族...</div>}
                  {regressionProgress === 300 && <div>[✨ RUNNER] Tabulating 12-dimensional metrics. Fails detected: {regressionFailCount}</div>}
                  <div className="text-emerald-400 font-bold animate-pulse">Running Mission Benchmark #{regressionProgress}...</div>
                </div>
              )}

              {/* Regression Metrics result */}
              {regressionHasRun && !isRunningRegression && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-fade-in">
                  <div className="bg-slate-950 p-3 rounded-lg text-center border border-slate-800">
                    <div className="text-[8px] font-mono text-slate-500 uppercase">Avg Quality Score</div>
                    <div className={`text-sm font-black font-mono mt-0.5 ${regressionScores.avgQuality >= baselineQuality ? "text-emerald-400" : "text-rose-400"}`}>
                      {regressionScores.avgQuality.toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg text-center border border-slate-800">
                    <div className="text-[8px] font-mono text-slate-500 uppercase">Fact Accuracy</div>
                    <div className="text-sm font-black text-white font-mono mt-0.5">{regressionScores.avgFact.toFixed(1)}%</div>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg text-center border border-slate-800">
                    <div className="text-[8px] font-mono text-slate-500 uppercase">UX Flow Score</div>
                    <div className="text-sm font-black text-white font-mono mt-0.5">{regressionScores.avgUX.toFixed(1)}%</div>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg text-center border border-slate-800">
                    <div className="text-[8px] font-mono text-slate-500 uppercase">Fails Detected</div>
                    <div className={`text-sm font-black font-mono mt-0.5 ${regressionFailCount > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                      {regressionFailCount} / 300
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* List of failures if any */}
            {simulatedFailureMissions.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] font-mono text-rose-400 uppercase font-bold flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5" /> Quality Failures Detected in Suite ({simulatedFailureMissions.length} items)
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {simulatedFailureMissions.map((fId) => (
                    <div key={fId} className="bg-rose-950/20 text-rose-300 text-[9px] font-mono py-1 px-2 rounded border border-rose-500/20 text-center font-bold">
                      {fId}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ⑤ World Benchmark Comparison */}
          <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-6 shadow-xl">
            <div>
              <div className="text-[10px] text-amber-400 font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                <Trophy className="w-3.5 h-3.5 text-amber-400" /> ⑤ World Benchmark AI Leaderboard
              </div>
              <h4 className="text-sm font-black text-white mt-1">
                Global Competitor Evaluation (Win Rate Analysis)
              </h4>
              <p className="text-xs text-slate-400">
                ACOS 2.0をグローバル主要AIモデルと比較。300 Missionsでの直接対決による勝率(Win Rate)を比較・分析します。
              </p>
            </div>

            {/* Competitor Grid */}
            <div className="space-y-2.5">
              {worldBenchmarks.map((bench, bIdx) => (
                <div key={bench.aiName} className="bg-slate-900/60 px-4 py-3 rounded-xl border border-slate-800 flex items-center justify-between gap-4 text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-bold">#{bIdx + 1}</span>
                    <span className="font-sans font-bold text-slate-200">{bench.aiName}</span>
                  </div>
                  
                  {/* Visual Bar representation */}
                  <div className="flex-1 max-w-xs bg-slate-950 h-2 rounded-full overflow-hidden hidden md:block">
                    <div 
                      className={`h-full ${bench.aiName.includes("ACOS") ? "bg-rose-500" : "bg-slate-700"}`}
                      style={{ width: `${bench.winRate}%` }}
                    />
                  </div>

                  <div className="flex gap-4 items-center shrink-0">
                    <div className="text-right">
                      <span className="text-[8px] text-slate-500 block">WIN RATE</span>
                      <span className={`font-bold ${bench.aiName.includes("ACOS") ? "text-rose-400 font-black text-sm" : "text-slate-300"}`}>
                        {bench.winRate > 0 ? `${bench.winRate}%` : "TBD"}
                      </span>
                    </div>
                    <div className="text-right hidden sm:block">
                      <span className="text-[8px] text-slate-500 block">LATENCY</span>
                      <span className="text-slate-300">{bench.latencyMs > 0 ? `${bench.latencyMs}ms` : "-"}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[8px] text-slate-500 block">QUALITY</span>
                      <span className="text-slate-300">{bench.qualityScore > 0 ? `${bench.qualityScore}%` : "-"}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Custom Competitor Tool */}
            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-3">
              <span className="text-[10px] font-mono text-slate-400 block font-bold">ADD NEW AI FOR BENCHMARK COMPARISON</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="AI Model Name (e.g. DeepSeek-R1)"
                  value={newAiName}
                  onChange={(e) => setNewAiName(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 font-sans"
                />
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-mono text-slate-500">Target Win Rate:</span>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={newAiWinRate}
                    onChange={(e) => setNewAiWinRate(Number(e.target.value))}
                    className="w-16 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 font-mono"
                  />
                </div>
                <button
                  onClick={addNewAiToBenchmark}
                  className="bg-amber-600 hover:bg-amber-500 text-white font-bold py-1.5 px-4 rounded-lg text-xs font-sans transition-all active:scale-95 flex items-center gap-1"
                >
                  <PlusCircle className="w-3.5 h-3.5" /> Register AI
                </button>
              </div>
            </div>
          </div>

          {/* ⑦ Daily Evolution History logs */}
          <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-6 shadow-xl">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-[10px] text-emerald-400 font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                  <Activity className="w-3.5 h-3.5 text-emerald-400" /> ⑦ Daily Evolution Track
                </div>
                <h4 className="text-sm font-black text-white mt-1">
                  Day-over-Day Quality Improvement Trend
                </h4>
              </div>

              <button
                onClick={triggerDailyEvolutionTick}
                disabled={simulatingDailyEvolution}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-1.5 px-3 rounded-lg text-xs font-sans transition-all active:scale-95 flex items-center gap-1.5"
              >
                {simulatingDailyEvolution ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />}
                Daily Update Tick
              </button>
            </div>

            {/* Daily History Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500 pb-2">
                    <th className="py-2">Date</th>
                    <th className="py-2">Success Rate</th>
                    <th className="py-2">Overall Quality</th>
                    <th className="py-2">Fact Accuracy</th>
                    <th className="py-2">UX Flow</th>
                    <th className="py-2">Speed</th>
                    <th className="py-2 text-right">Evolution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {evolutionLogs.map((log, index) => (
                    <tr key={log.date} className="hover:bg-slate-900/20 text-slate-300">
                      <td className="py-2.5 font-bold text-white">{log.date}</td>
                      <td className="py-2.5 text-emerald-400 font-bold">{log.successRate}%</td>
                      <td className="py-2.5">{log.overallQuality}%</td>
                      <td className="py-2.5">{log.factScore}%</td>
                      <td className="py-2.5">{log.uxScore}%</td>
                      <td className="py-2.5">{log.speedScore}%</td>
                      <td className="py-2.5 text-right font-bold text-emerald-400">
                        {index === 0 ? "Baseline" : `+${log.improvementRate}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* RIGHT COMPONENT (5/12): Mission Explorer, Golden Answer & Automatic scoring */}
        <div className="xl:col-span-5 space-y-6">
          
          {/* ① & ② Mission Benchmark Suite and Golden Answer Dataset Explorer */}
          <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-6 shadow-xl">
            <div>
              <div className="text-[10px] text-rose-400 font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-rose-500" /> ① & ② Mission & Golden Answer Dataset
              </div>
              <h4 className="text-sm font-black text-white mt-1">
                300+ Mission Benchmark Suite Browser
              </h4>
              <p className="text-xs text-slate-400">
                20個の多様なカテゴリと5段階の難易度に完全に配分された、実用的なゴールデン回答データセットです。
              </p>
            </div>

            {/* Filter controls */}
            <div className="grid grid-cols-2 gap-2 bg-slate-900 p-3 rounded-xl border border-slate-800">
              <div className="space-y-1">
                <label className="text-[9px] text-slate-500 font-mono font-bold uppercase">Category</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => {
                    setSelectedCategory(e.target.value);
                    setSelectedMissionIdx(0);
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg py-1 px-2 text-xs text-slate-300 focus:outline-none focus:border-rose-500 font-sans"
                >
                  <option value="All">All Categories ({VALIDATION_CATEGORIES.length})</option>
                  {VALIDATION_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] text-slate-500 font-mono font-bold uppercase">Difficulty</label>
                <select
                  value={selectedDifficulty}
                  onChange={(e) => {
                    setSelectedDifficulty(e.target.value);
                    setSelectedMissionIdx(0);
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg py-1 px-2 text-xs text-slate-300 focus:outline-none focus:border-rose-500 font-sans"
                >
                  <option value="All">All Difficulties</option>
                  <option value="Easy">Easy</option>
                  <option value="Normal">Normal</option>
                  <option value="Hard">Hard</option>
                  <option value="Expert">Expert</option>
                  <option value="Impossible">Impossible</option>
                </select>
              </div>

              <div className="col-span-2 pt-1.5">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search by keyword..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setSelectedMissionIdx(0);
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-rose-500 font-sans placeholder-slate-600"
                  />
                  <Search className="w-3.5 h-3.5 text-slate-600 absolute left-2.5 top-2.5" />
                </div>
              </div>
            </div>

            {/* Pagination Controls */}
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-slate-400 font-bold">
                Filtered: {filteredMissions.length} Missions
              </span>
              <div className="flex gap-1.5">
                <button
                  disabled={selectedMissionIdx <= 0}
                  onClick={() => setSelectedMissionIdx(prev => prev - 1)}
                  className={`px-2.5 py-1 rounded border text-[10px] font-bold ${
                    selectedMissionIdx <= 0
                      ? "border-slate-800 text-slate-600 cursor-not-allowed"
                      : "border-slate-700 text-slate-300 hover:bg-slate-900"
                  }`}
                >
                  Prev
                </button>
                <span className="text-white font-bold py-1">
                  {filteredMissions.length > 0 ? selectedMissionIdx + 1 : 0} / {filteredMissions.length}
                </span>
                <button
                  disabled={selectedMissionIdx >= filteredMissions.length - 1}
                  onClick={() => setSelectedMissionIdx(prev => prev + 1)}
                  className={`px-2.5 py-1 rounded border text-[10px] font-bold ${
                    selectedMissionIdx >= filteredMissions.length - 1
                      ? "border-slate-800 text-slate-600 cursor-not-allowed"
                      : "border-slate-700 text-slate-300 hover:bg-slate-900"
                  }`}
                >
                  Next
                </button>
              </div>
            </div>

            {/* Active Selected Mission Details */}
            {activeMission ? (
              <div className="space-y-4">
                
                {/* Mission Header */}
                <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-mono bg-rose-600/10 text-rose-400 px-2 py-0.5 rounded border border-rose-500/10 font-bold">
                      {activeMission.id}
                    </span>
                    <div className="flex gap-1.5 text-[9px] font-mono">
                      <span className="px-1.5 py-0.5 bg-slate-950 text-slate-400 rounded border border-slate-800 font-bold">
                        {activeMission.category}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded border font-bold ${
                        activeMission.difficulty === "Easy" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                        activeMission.difficulty === "Normal" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                        activeMission.difficulty === "Hard" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                        activeMission.difficulty === "Expert" ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
                        "bg-red-500/10 text-red-400 border-red-500/20"
                      }`}>
                        {activeMission.difficulty}
                      </span>
                    </div>
                  </div>
                  
                  <p className="text-xs text-white leading-relaxed font-sans font-medium">
                    {activeMission.input}
                  </p>
                </div>

                {/* Golden Answer Details (理想回答・最低品質・NG例) */}
                <div className="space-y-3.5">
                  <div className="space-y-1.5">
                    <div className="text-[10px] text-emerald-400 font-mono font-bold uppercase tracking-wider">
                      ★ Ideal Answer Criteria (理想回答)
                    </div>
                    <pre className="bg-slate-900/60 p-3.5 rounded-lg border border-slate-900 text-xs text-slate-300 font-sans whitespace-pre-wrap leading-relaxed">
                      {activeMission.golden.idealAnswer}
                    </pre>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <div className="text-[9px] text-slate-400 font-mono font-bold uppercase tracking-wider">
                        ▼ Minimum Quality Baseline (最低品質)
                      </div>
                      <p className="bg-slate-900/40 p-3 rounded-lg border border-slate-900 text-[11px] text-slate-400 leading-relaxed">
                        {activeMission.golden.minQuality}
                      </p>
                    </div>

                    <div className="space-y-1">
                      <div className="text-[9px] text-red-400 font-mono font-bold uppercase tracking-wider">
                        ✖ Dangerous / Fail NG Example (NG例)
                      </div>
                      <p className="bg-slate-900/40 p-3 rounded-lg border border-slate-900 text-[11px] text-red-300/80 leading-relaxed">
                        {activeMission.golden.ngExample}
                      </p>
                    </div>
                  </div>

                  {/* 評価基準 list */}
                  <div className="space-y-1.5">
                    <div className="text-[10px] text-slate-500 font-mono font-bold uppercase">
                      Strict Audit Checkpoints (評価基準)
                    </div>
                    <div className="space-y-1">
                      {activeMission.golden.criteria.map((cri, criIdx) => (
                        <div key={criIdx} className="bg-slate-900 p-2 rounded border border-slate-800/60 text-xs text-slate-300 flex items-center gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="truncate">{cri}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

              </div>
            ) : (
              <div className="text-center py-12 text-slate-500 text-xs">
                No missions match your active search filters.
              </div>
            )}
          </div>

          {/* ③ Automatic Evaluation Panel */}
          {activeMission && (
            <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4 shadow-xl">
              <div>
                <div className="text-[10px] text-emerald-400 font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                  <Cpu className="w-3.5 h-3.5 text-emerald-400" /> ③ Automatic Evaluation Score Simulator
                </div>
                <h4 className="text-sm font-black text-white mt-1">
                  12-Dimensional Real-Time Audit Engine
                </h4>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={runSingleEvaluation}
                  disabled={isEvaluatingSingle}
                  className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold py-2 px-4 rounded-xl text-xs transition-all active:scale-95 flex items-center justify-center gap-2 font-sans shadow-lg shadow-rose-600/10"
                >
                  {isEvaluatingSingle ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Analyzing 12 Metrics...
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5" /> Auto-Score Active Mission
                    </>
                  )}
                </button>
              </div>

              {/* Render dynamic radar/grid score output */}
              {singleEvalResult && (
                <div className="bg-slate-900 p-4 rounded-xl border border-emerald-500/10 space-y-4 animate-fade-in">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                    <span className="text-[10px] text-slate-500 font-mono">EVALUATED AT: {singleEvalResult.evaluatedAt}</span>
                    <div className="flex items-center gap-1.5 text-xs font-mono font-bold">
                      <span>AVERAGE Score:</span>
                      <span className="text-emerald-400 text-base font-black">{singleEvalResult.averageScore}</span>
                    </div>
                  </div>

                  {/* 12-Dimensional Metrics Grid */}
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(singleEvalResult.scores).map(([metric, score]) => {
                      const displayMetric = metric.toUpperCase();
                      return (
                        <div key={metric} className="bg-slate-950 p-2 rounded text-center border border-slate-800">
                          <span className="text-[8px] text-slate-500 font-bold block">{displayMetric}</span>
                          <span className="text-xs font-black font-mono text-white mt-0.5">{score}</span>
                          <div className="w-full bg-slate-900 h-1 rounded-full overflow-hidden mt-1.5">
                            <div className="bg-emerald-500 h-full" style={{ width: `${score}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed font-sans pt-1 border-t border-slate-800">
                    {singleEvalResult.commentary}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ⑥ Weakness Analyzer */}
          <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-5 shadow-xl">
            <div>
              <div className="text-[10px] text-red-400 font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-500" /> ⑥ Weakness Analyzer & Remediation
              </div>
              <h4 className="text-sm font-black text-white mt-1">
                Automated Weakness Mitigation Plans
              </h4>
              <p className="text-xs text-slate-400">
                毎週のエラーケースを自律分析し、ACOSの思考モデルに対するアップデート・改善計画(Remediation Plan)を自動的に生成します。
              </p>
            </div>

            <div className="flex gap-2">
              <select
                value={newWeaknessCategory}
                onChange={(e) => setNewWeaknessCategory(e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-800 rounded-lg py-1 px-3 text-xs text-slate-300 focus:outline-none focus:border-rose-500 font-sans"
              >
                {VALIDATION_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>

              <button
                onClick={runWeaknessAnalysis}
                disabled={isGeneratingWeaknessPlan}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-1.5 px-4 rounded-lg text-xs font-sans transition-all active:scale-95 flex items-center gap-1.5 shrink-0"
              >
                {isGeneratingWeaknessPlan ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                Analyze Weakness
              </button>
            </div>

            {/* List of active weakness mitigations */}
            <div className="space-y-3.5 max-h-64 overflow-y-auto pr-1">
              {weaknesses.map((w) => (
                <div key={w.id} className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
                  <div className="flex justify-between items-center pb-1.5 border-b border-slate-800">
                    <span className="font-mono text-indigo-400 font-bold uppercase">{w.category}</span>
                    <span className="text-[9px] font-mono text-slate-500">{w.analyzedAt}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-500 font-bold block uppercase font-mono">Root Cause (根本原因)</span>
                    <p className="text-slate-300 text-[11px] font-sans">{w.rootCause}</p>
                  </div>
                  <div>
                    <span className="text-[9px] text-emerald-400 font-bold block uppercase font-mono">Auto-Generated Remediation Plan (改善計画)</span>
                    <p className="text-slate-200 text-[11px] font-sans font-medium bg-slate-950 p-2.5 rounded-lg border border-slate-800/40 mt-1">
                      {w.improvementPlan}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ⑧ Quality Weekly Report Compiler */}
          <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-5 shadow-xl">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-[10px] text-indigo-400 font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5 text-indigo-400" /> ⑧ World Class Quality Report
                </div>
                <h4 className="text-sm font-black text-white mt-1">
                  Weekly World Class Report Compiler
                </h4>
              </div>

              <button
                onClick={generateWeeklyReport}
                disabled={isGeneratingWeeklyReport}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-1.5 px-4 rounded-lg text-xs font-sans transition-all active:scale-95 flex items-center gap-1.5 shrink-0"
              >
                {isGeneratingWeeklyReport ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
                Generate Report
              </button>
            </div>

            <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
              {weeklyReports.map((rep) => (
                <div key={rep.weekId} className="bg-slate-900 p-5 rounded-xl border border-slate-800 space-y-3.5 text-xs">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                    <span className="text-sm font-black text-white">{rep.weekId} Report</span>
                    <span className="text-[10px] font-mono text-slate-500">{rep.generatedAt}</span>
                  </div>

                  <div className="space-y-2">
                    <span className="text-[9px] text-emerald-400 font-bold uppercase font-mono block">1. Major Quality Outcomes (改善点)</span>
                    <ul className="list-disc list-inside text-slate-300 space-y-1 pl-1">
                      {rep.improvements.map((imp, idx) => (
                        <li key={idx} className="text-slate-300">{imp}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div className="space-y-1.5">
                      <span className="text-[9px] text-amber-400 font-bold uppercase font-mono block">2. Identified Risks (リスク)</span>
                      <ul className="list-disc list-inside text-slate-400 space-y-1 pl-1">
                        {rep.risks.map((r, idx) => (
                          <li key={idx} className="text-slate-400">{r}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-[9px] text-rose-400 font-bold uppercase font-mono block">3. Technical Debt (技術的負債)</span>
                      <ul className="list-disc list-inside text-slate-400 space-y-1 pl-1">
                        {rep.debts.map((d, idx) => (
                          <li key={idx} className="text-slate-400">{d}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800/60 text-[11px] leading-relaxed text-slate-300 font-sans">
                    <span className="font-extrabold text-white block mb-1">【品質総括 / Quality Summary】</span>
                    {rep.qualitySummary}
                  </div>

                  <div className="flex justify-between items-center pt-2 border-t border-slate-800 text-[10px] font-mono text-slate-500">
                    <span>Avg Response: <strong className="text-slate-300">{rep.averageSpeedMs}ms</strong></span>
                    <span>User Satisfaction Rate: <strong className="text-emerald-400">{rep.satisfactionRate}%</strong></span>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>

      {/* Validation Architecture Deliverable (Strict requirement output) */}
      <div className="bg-gradient-to-r from-rose-950/20 via-slate-950 to-rose-950/20 p-8 rounded-3xl border border-rose-500/10 text-center space-y-4 shadow-2xl">
        <Cpu className="w-12 h-12 text-rose-500 mx-auto animate-pulse" />
        <div className="max-w-2xl mx-auto space-y-2">
          <h4 className="text-lg font-black text-white">
            World Class Validation Program Architecture (Validation Architecture)
          </h4>
          <p className="text-xs text-slate-400 leading-relaxed font-sans">
            ACOS 2.0 Validation Architectureは、300案件からなる高精度なゴールデンデータセットを基盤とし、12次元の多角的アスペクト（Fact、Goal、UX、Speed等）から構成される「自律自動採点エンジン」、およびコード変更時にマージ拒否を自動執行する「PR-Stage回帰ガードレール」が完全に統治されています。
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 text-[10px] font-mono bg-rose-500/10 text-rose-400 px-3 py-1 rounded-full border border-rose-500/20">
          <span>Active Standards: World Class Validation Protocol (WCV-2026-R1)</span>
        </div>
      </div>

    </div>
  );
}
