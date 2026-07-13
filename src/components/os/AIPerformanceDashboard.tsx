import  { useState, useEffect } from "react";
import { 
  Activity,  DollarSign, Target, CheckCircle, BarChart3, Clock, 
  AlertCircle, Star, Shield, ArrowLeftRight, Settings, RefreshCw, 
   Play, Cpu, AlertTriangle, Layers, TrendingUp, Sparkles, 
    Scale, ChevronRight, Gauge } from "lucide-react";
import { cn } from "../../utils";

// Types
interface ModelMetrics {
  id: string;
  name: string;
  latency: number; // ms
  tokens: number; // total tokens
  cost: number; // USD
  successRate: number; // %
  qualityScore: number; // out of 100
  coherence: number; // out of 10
  factuality: number; // out of 10
  safety: number; // out of 10
  alignment: number; // out of 10
  health: "operational" | "degraded" | "failed";
  color: string;
  gradient: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
}

interface SwitchLog {
  id: string;
  timestamp: string;
  event: string;
  fromModel: string;
  toModel: string;
  reason: string;
  status: "success" | "warning" | "info";
}

interface EvaluationResult {
  modelId: string;
  modelName: string;
  response: string;
  latency: number;
  tokens: number;
  cost: number;
  score: number;
  status: "success" | "warning";
}

export default function AIPerformanceDashboard() {
  const [activeTab, setActiveTab] = useState<"overview" | "benchmarks" | "cost" | "failover">("overview");
  const [timeRange, setTimeRange] = useState<"24h" | "7d" | "30d">("24h");
  
  // Rules and Thresholds
  const [latencyThreshold, setLatencyThreshold] = useState<number>(650); // ms
  const [errorThreshold, setErrorThreshold] = useState<number>(3); // %
  const [enableAutoSwitch, setEnableAutoSwitch] = useState<boolean>(true);
  const [budgetLimit, setBudgetLimit] = useState<number>(100); // USD
  
  // State for AI model metrics
  const [models, setModels] = useState<ModelMetrics[]>([
    {
      id: "openai",
      name: "OpenAI GPT-4o",
      latency: 480,
      tokens: 12450000,
      cost: 42.50,
      successRate: 99.8,
      qualityScore: 95.5,
      coherence: 9.7,
      factuality: 9.5,
      safety: 9.8,
      alignment: 9.6,
      health: "operational",
      color: "emerald-500",
      gradient: "from-emerald-500 to-green-600",
      bgColor: "bg-emerald-50/50",
      textColor: "text-emerald-700",
      borderColor: "border-emerald-200"
    },
    {
      id: "gemini",
      name: "Google Gemini 1.5 Pro",
      latency: 310,
      tokens: 8200000,
      cost: 18.20,
      successRate: 99.9,
      qualityScore: 94.2,
      coherence: 9.4,
      factuality: 9.2,
      safety: 9.6,
      alignment: 9.5,
      health: "operational",
      color: "blue-500",
      gradient: "from-blue-500 to-indigo-600",
      bgColor: "bg-blue-50/50",
      textColor: "text-blue-700",
      borderColor: "border-blue-200"
    },
    {
      id: "claude",
      name: "Anthropic Claude 3.5 Sonnet",
      latency: 520,
      tokens: 5120000,
      cost: 15.30,
      successRate: 99.6,
      qualityScore: 97.1,
      coherence: 9.9,
      factuality: 9.7,
      safety: 9.8,
      alignment: 9.7,
      health: "operational",
      color: "amber-500",
      gradient: "from-amber-500 to-orange-600",
      bgColor: "bg-amber-50/50",
      textColor: "text-amber-700",
      borderColor: "border-amber-200"
    },
    {
      id: "deepseek",
      name: "DeepSeek Coder V2",
      latency: 820,
      tokens: 3400000,
      cost: 2.10,
      successRate: 98.1,
      qualityScore: 89.4,
      coherence: 8.8,
      factuality: 8.5,
      safety: 9.1,
      alignment: 8.9,
      health: "degraded",
      color: "rose-500",
      gradient: "from-rose-500 to-red-600",
      bgColor: "bg-rose-50/50",
      textColor: "text-rose-700",
      borderColor: "border-rose-200"
    }
  ]);

  // Sync with dynamic local storage values (Phase 7)
  useEffect(() => {
    try {
      const storedStr = localStorage.getItem("acos_provider_performance_metrics");
      if (storedStr) {
        const storedMetrics = JSON.parse(storedStr);
        setModels(prev => prev.map(m => {
          let matchingKey = "";
          if (m.id === "openai") matchingKey = "openrouter/openai/gpt-4o";
          else if (m.id === "gemini") matchingKey = "openrouter/google/gemini-1.5-pro";
          else if (m.id === "claude") matchingKey = "openrouter/anthropic/claude-3.5-sonnet";
          else if (m.id === "deepseek") matchingKey = "openrouter/deepseek/deepseek-coder";

          const metrics = storedMetrics[matchingKey];
          if (metrics) {
            return {
              ...m,
              latency: metrics.latency || m.latency,
              successRate: metrics.successRate || m.successRate,
              qualityScore: (metrics.quality * 10) || m.qualityScore,
              cost: Number((metrics.cost + (metrics.runsCount * 0.0008)).toFixed(2)) || m.cost
            };
          }
          return m;
        }));
      }
    } catch (e) {
      console.error("Failed to load custom provider metrics into dashboard", e);
    }
  }, []);

  // Failover and Routing logs
  const [switchLogs, setSwitchLogs] = useState<SwitchLog[]>([
    {
      id: "log-1",
      timestamp: "2026-07-07 05:12:43",
      event: "High Latency Warning",
      fromModel: "Anthropic Claude 3.5 Sonnet",
      toModel: "Google Gemini 1.5 Pro",
      reason: "Response time reached 980ms (threshold: 650ms)",
      status: "warning"
    },
    {
      id: "log-2",
      timestamp: "2026-07-07 04:35:12",
      event: "Automatic Failover",
      fromModel: "DeepSeek Coder V2",
      toModel: "OpenAI GPT-4o",
      reason: "API rate limits reached / Token quota exhausted",
      status: "success"
    },
    {
      id: "log-3",
      timestamp: "2026-07-07 03:04:19",
      event: "Optimized Quality Routing",
      fromModel: "Google Gemini 1.5 Pro",
      toModel: "Anthropic Claude 3.5 Sonnet",
      reason: "High reasoning complexity detected in prompt parameters",
      status: "info"
    },
    {
      id: "log-4",
      timestamp: "2026-07-07 01:22:50",
      event: "Cost Control Auto-Switch",
      fromModel: "OpenAI GPT-4o",
      toModel: "Google Gemini 1.5 Pro",
      reason: "Simple text summarization request routed to low-cost tier",
      status: "success"
    }
  ]);

  // Live Playground State
  const [playgroundPrompt, setPlaygroundPrompt] = useState<string>("Analyze multi-agent self-repair mechanisms for enterprise cloud networks.");
  const [playgroundCategory, setPlaygroundCategory] = useState<"reasoning" | "coding" | "writing">("reasoning");
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [evaluationStage, setEvaluationStage] = useState<string>("");
  const [activeEvaluation, setActiveEvaluation] = useState<EvaluationResult[] | null>(null);
  const [systemAlerts, setSystemAlerts] = useState<string[]>([]);

  // Calculate dynamic stats
  const totalTokens = models.reduce((acc, m) => acc + m.tokens, 0);
  const totalCost = models.reduce((acc, m) => acc + m.cost, 0);
  const avgLatency = Math.round(models.reduce((acc, m) => acc + m.latency, 0) / models.length);
  const globalQualityScore = Number((models.reduce((acc, m) => acc + m.qualityScore, 0) / models.length).toFixed(1));
  const globalSLA = Number((models.reduce((acc, m) => acc + m.successRate, 0) / models.length).toFixed(2));

  // Run a real-looking interactive benchmark evaluation
  const handleRunEvaluation = () => {
    if (!playgroundPrompt.trim()) return;
    setIsEvaluating(true);
    setActiveEvaluation(null);
    setEvaluationStage("Initializing multi-model gateway diagnostic...");

    setTimeout(() => {
      setEvaluationStage("Broadcasting requests to all active providers...");
      
      setTimeout(() => {
        setEvaluationStage("Validating semantic coherence and safety rules...");
        
        setTimeout(() => {
          setEvaluationStage("Calculating answer accuracy and pricing weights...");
          
          setTimeout(() => {
            // Generate responses based on category
            const responses: Record<string, string> = {
              openai: playgroundCategory === "coding" 
                ? "```typescript\n// GPT-4o Solution\nexport function resolveSwarmConflict(agents: Agent[]) {\n  const votes = agents.map(a => a.vote);\n  return consensus(votes);\n}\n```"
                : "Multi-agent self-repair relies on a decentralized consensus layer where health metadata is verified against a secure knowledge graph, triggering auto-rollback sequences.",
              gemini: playgroundCategory === "coding"
                ? "```typescript\n// Gemini 1.5 Pro Solution\nexport function selfHealNetworkSwarm(nodes: NetworkNode[]) {\n  return nodes.filter(n => n.health < 1.0).map(n => n.reboot());\n}\n```"
                : "Gemini 1.5 Pro Analysis: Enterprise cloud networks require strict topology monitoring. Self-repair is handled via continuous feedback loops and automated rollbacks of faulty containers.",
              claude: playgroundCategory === "coding"
                ? "```typescript\n// Claude 3.5 Sonnet Solution\nexport function selfRepairEngine(agents: Agent[], topology: MeshNetwork) {\n  const activeAnomalies = detectAnomalies(topology);\n  return heal(agents, activeAnomalies);\n}\n```"
                : "Claude 3.5 Sonnet Analysis: Dynamic multi-agent self-repair operates by deploying isolated diagnostics pods that execute state reconciliation algorithms while isolating failed nodes.",
              deepseek: playgroundCategory === "coding"
                ? "```typescript\n// DeepSeek Coder V2 Optimized\nvoid repair_swarm(Agent* list, int len) {\n  for(int i=0; i<len; i++) {\n    if(list[i].state == CRITICAL) restart(&list[i]);\n  }\n}\n```"
                : "DeepSeek Code Analysis: Autonomous system-level diagnostics are triggered through real-time telemetry processing inside a dedicated micro-kernel loop."
            };

            // Calculate speeds & scores dynamically, potentially triggering switch warnings
            const results: EvaluationResult[] = models.map(m => {
              // Add slight random factors to make it feel extremely live
              const latencyVar = Math.round(m.latency * (0.85 + Math.random() * 0.3));
              const scoreVar = Math.min(100, Number((m.qualityScore * (0.96 + Math.random() * 0.08)).toFixed(1)));
              const tokenCount = Math.round(400 + Math.random() * 120);
              const calculatedCost = Number((tokenCount * (m.id === "openai" ? 0.000015 : m.id === "claude" ? 0.00002 : m.id === "gemini" ? 0.000007 : 0.000001)).toFixed(5));

              const isWarning = latencyVar > latencyThreshold;

              return {
                modelId: m.id,
                modelName: m.name,
                response: responses[m.id] || "Coherent response generated successfully.",
                latency: latencyVar,
                tokens: tokenCount,
                cost: calculatedCost,
                score: scoreVar,
                status: isWarning ? "warning" : "success"
              };
            });

            // Update model metrics based on this run
            setModels(prev => prev.map(m => {
              const runRes = results.find(r => r.modelId === m.id);
              if (runRes) {
                const newLatency = Math.round((m.latency * 4 + runRes.latency) / 5);
                const newScore = Number(((m.qualityScore * 4 + runRes.score) / 5).toFixed(1));
                const newTokens = m.tokens + runRes.tokens;
                const newCost = Number((m.cost + runRes.cost).toFixed(2));
                
                // Determine health based on threshold
                const healthState = runRes.latency > latencyThreshold ? "degraded" : "operational";

                return {
                  ...m,
                  latency: newLatency,
                  qualityScore: newScore,
                  tokens: newTokens,
                  cost: newCost,
                  health: healthState
                };
              }
              return m;
            }));

            // Check for Auto-Switch trigger
            const slowModel = results.find(r => r.latency > latencyThreshold);
            if (slowModel && enableAutoSwitch) {
              const fastModel = [...results].sort((a, b) => a.latency - b.latency)[0];
              
              const newLog: SwitchLog = {
                id: `log-${Date.now()}`,
                timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
                event: "Failover Auto-Switch",
                fromModel: slowModel.modelName,
                toModel: fastModel.modelName,
                reason: `Response latency (${slowModel.latency}ms) exceeded maximum set SLA threshold (${latencyThreshold}ms)`,
                status: "warning"
              };

              setSwitchLogs(prev => [newLog, ...prev]);
              
              // Push alert
              setSystemAlerts(prev => [
                `ALERT: ${slowModel.modelName} degraded (latency ${slowModel.latency}ms). Redirecting active workloads to ${fastModel.modelName}.`,
                ...prev
              ]);
            }

            setActiveEvaluation(results);
            setIsEvaluating(false);
          }, 1000);
        }, 1000);
      }, 1000);
    }, 1000);
  };

  // Pre-populate with a few template prompts
  const samplePrompts = [
    { text: "Implement a fault-tolerant multi-threaded worker pool in TypeScript.", category: "coding" },
    { text: "Compare proof-of-authority consensus with proof-of-stake in edge networks.", category: "reasoning" },
    { text: "Draft a high-conversion technical release note for an enterprise AI system.", category: "writing" }
  ];

  return (
    <div className="flex h-full w-full bg-slate-900 rounded-3xl overflow-hidden flex-col md:flex-row text-slate-100">
      
      {/* LEFT NAVIGATION COLUMN */}
      <div className="w-full md:w-64 bg-slate-950 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col justify-between p-6">
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-md shadow-indigo-900/30">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-black text-sm tracking-wide text-white uppercase">ACOS Guard</h2>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">AI Quality Monitor</p>
            </div>
          </div>

          <div className="h-px bg-slate-800" />

          {/* Nav Items */}
          <nav className="flex flex-col gap-1">
            <button
              onClick={() => setActiveTab("overview")}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all text-left",
                activeTab === "overview"
                  ? "bg-slate-800 text-white shadow-sm border-l-4 border-indigo-500"
                  : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
              )}
            >
              <Activity className="w-4 h-4" />
              <span>利用統計ダッシュボード</span>
            </button>

            <button
              onClick={() => setActiveTab("benchmarks")}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all text-left",
                activeTab === "benchmarks"
                  ? "bg-slate-800 text-white shadow-sm border-l-4 border-indigo-500"
                  : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
              )}
            >
              <Target className="w-4 h-4" />
              <span>AI精度・速度比較</span>
            </button>

            <button
              onClick={() => setActiveTab("cost")}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all text-left",
                activeTab === "cost"
                  ? "bg-slate-800 text-white shadow-sm border-l-4 border-indigo-500"
                  : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
              )}
            >
              <DollarSign className="w-4 h-4" />
              <span>コスト・トークン管理</span>
            </button>

            <button
              onClick={() => setActiveTab("failover")}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all text-left",
                activeTab === "failover"
                  ? "bg-slate-800 text-white shadow-sm border-l-4 border-indigo-500"
                  : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
              )}
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>障害検知・切替履歴</span>
            </button>
          </nav>
        </div>

        {/* Global Health and Version */}
        <div className="mt-8 pt-4 border-t border-slate-800/60 flex flex-col gap-3">
          <div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
            <span>GATEWAY STATUS</span>
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              ACTIVE
            </span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono">ACOS Production RC8</div>
        </div>
      </div>

      {/* RIGHT CONTENT STAGE */}
      <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-slate-900/40 flex flex-col gap-6">
        
        {/* TOP STATUS ALERTS PANEL */}
        {systemAlerts.length > 0 && (
          <div className="bg-amber-950/40 border border-amber-800/60 rounded-2xl p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-black uppercase tracking-wider">
                <AlertTriangle className="w-4 h-4" />
                Active Gateway Incidents
              </div>
              <button 
                onClick={() => setSystemAlerts([])}
                className="text-[10px] font-bold text-amber-500 hover:text-amber-300 uppercase underline"
              >
                Dismiss Alerts
              </button>
            </div>
            <div className="flex flex-col gap-1 max-h-24 overflow-y-auto">
              {systemAlerts.map((alert, i) => (
                <div key={i} className="text-xs text-amber-200 font-medium">
                  • {alert}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ======================================= */}
        {/* TAB 1: OVERVIEW STATISTICS DASHBOARD & LIVE SIMULATOR */}
        {/* ======================================= */}
        {activeTab === "overview" && (
          <div className="flex flex-col gap-6">
            
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-black text-white flex items-center gap-2">
                  <Activity className="w-7 h-7 text-indigo-400 animate-pulse" />
                  利用統計ダッシュボード
                </h1>
                <p className="text-slate-400 text-xs font-medium mt-1">
                  全LLMプロバイダーのリアルタイム・レスポンス監視および総合AI品質スコアの追跡
                </p>
              </div>

              {/* Timeframe selector */}
              <div className="flex items-center bg-slate-800 border border-slate-700 rounded-xl p-1 gap-1 self-start">
                {(["24h", "7d", "30d"] as const).map(tr => (
                  <button
                    key={tr}
                    onClick={() => setTimeRange(tr)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all",
                      timeRange === tr 
                        ? "bg-indigo-600 text-white" 
                        : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    {tr}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Metrics Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              
              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between hover:border-slate-700 transition-all">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">AI回答品質スコア</span>
                  <div className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                    <Star className="w-4 h-4 text-indigo-400" />
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-black text-white">{globalQualityScore} <span className="text-xs text-slate-400">/100</span></div>
                  <div className="flex items-center gap-1 text-[10px] text-indigo-400 font-bold mt-1 uppercase tracking-wide">
                    <TrendingUp className="w-3 h-3" /> Excellent Alignment
                  </div>
                </div>
              </div>

              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between hover:border-slate-700 transition-all">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">グローバルSLA</span>
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-black text-white">{globalSLA}%</div>
                  <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wide flex items-center gap-1 mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span> High Reliability
                  </span>
                </div>
              </div>

              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between hover:border-slate-700 transition-all">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">累積リクエスト</span>
                  <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                    <Layers className="w-4 h-4 text-blue-400" />
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-black text-white">{(totalTokens / 1000).toFixed(0)}K <span className="text-xs text-slate-400">tokens</span></div>
                  <div className="text-[10px] text-slate-500 font-bold mt-1 uppercase">Avg: 480ms response</div>
                </div>
              </div>

              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between hover:border-slate-700 transition-all">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">当月予算 / コスト</span>
                  <div className="w-7 h-7 rounded-lg bg-rose-500/10 flex items-center justify-center border border-rose-500/20">
                    <DollarSign className="w-4 h-4 text-rose-400" />
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-black text-white">${totalCost.toFixed(2)} <span className="text-xs text-slate-500">/ ${budgetLimit}</span></div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden border border-slate-700">
                    <div 
                      className="bg-indigo-500 h-full rounded-full transition-all duration-500" 
                      style={{ width: `${Math.min(100, (totalCost / budgetLimit) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>

            </div>

            {/* Model Comparison Grid (Overview Mode) */}
            <div className="bg-slate-950/40 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-white">AI回答品質スコア ＆ 稼働状況</h3>
                  <p className="text-xs text-slate-500 font-medium">各LLMモデルの最終評価、平均速度、稼働状況</p>
                </div>
                <button 
                  onClick={() => setActiveTab("benchmarks")}
                  className="text-xs font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 hover:underline"
                >
                  詳細な精度・速度比較 <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {models.map(m => (
                  <div 
                    key={m.id} 
                    className="bg-slate-950/90 rounded-xl border border-slate-800 p-4 relative overflow-hidden flex flex-col justify-between gap-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={cn("w-2 h-2 rounded-full", m.health === 'operational' ? "bg-emerald-400" : "bg-amber-400")} />
                        <span className="font-black text-xs text-white truncate max-w-[130px]">{m.name}</span>
                      </div>
                      <span className={cn("text-[10px] font-black uppercase px-1.5 py-0.5 rounded", 
                        m.health === 'operational' ? "text-emerald-400 bg-emerald-500/10" : "text-amber-400 bg-amber-500/10"
                      )}>
                        {m.health}
                      </span>
                    </div>

                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Quality Score</div>
                        <div className="text-xl font-black text-white">{m.qualityScore} <span className="text-[10px] text-slate-400">/100</span></div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Avg Speed</div>
                        <div className="text-sm font-black text-slate-200">{m.latency}ms</div>
                      </div>
                    </div>

                    {/* Progress representation for Quality */}
                    <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                      <div 
                        className="bg-indigo-500 h-full rounded-full" 
                        style={{ width: `${m.qualityScore}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* LIVE EVALUATION & BENCHMARK DIAGNOSTIC PLAYGROUND */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-6 flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-black text-white flex items-center gap-1.5">
                    <Sparkles className="w-5 h-5 text-indigo-400" />
                    Live 評価・ベンチマーク診断プレイグラウンド
                  </h3>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">
                    独自の診断用プロンプトを送信し、全モデルのレスポンス速度、トークン使用、回答品質スコアをリアルタイム測定
                  </p>
                </div>
              </div>

              {/* Input Area */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs text-slate-400 font-bold self-center mr-2">テスト用プロンプトテンプレート:</span>
                  {samplePrompts.map((p, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setPlaygroundPrompt(p.text);
                        setPlaygroundCategory(p.category as any);
                      }}
                      className="bg-slate-800/80 hover:bg-slate-800 text-[10px] text-slate-300 font-bold px-2.5 py-1.5 rounded-lg border border-slate-700 transition-all"
                    >
                      {p.category.toUpperCase()}: {p.text.substring(0, 30)}...
                    </button>
                  ))}
                </div>

                <div className="flex flex-col md:flex-row gap-3">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      value={playgroundPrompt}
                      onChange={(e) => setPlaygroundPrompt(e.target.value)}
                      placeholder="Enter a prompt to evaluate AI models..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-xs font-medium text-white focus:outline-none focus:border-indigo-500 transition-all pr-10"
                    />
                    <div className="absolute right-3 top-3.5 text-slate-500">
                      <Cpu className="w-4 h-4" />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={playgroundCategory}
                      onChange={(e) => setPlaygroundCategory(e.target.value as any)}
                      className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="reasoning">Logical Reasoning (論理・推論)</option>
                      <option value="coding">Code Generation (コーディング)</option>
                      <option value="writing">Creative Writing (文章生成)</option>
                    </select>

                    <button
                      onClick={handleRunEvaluation}
                      disabled={isEvaluating}
                      className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white px-5 py-3 rounded-xl text-xs font-black tracking-wide flex items-center gap-2 shadow-lg shadow-indigo-900/20 transition-all"
                    >
                      {isEvaluating ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>診断中...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 fill-current" />
                          <span>診断実行</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Progress Stage overlay */}
              {isEvaluating && (
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 flex flex-col items-center justify-center gap-3 animate-pulse">
                  <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
                  <div className="text-xs font-mono text-slate-300">{evaluationStage}</div>
                  <div className="w-64 bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1">
                    <div className="bg-indigo-500 h-full w-1/2 rounded-full animate-pulse" />
                  </div>
                </div>
              )}

              {/* Active Evaluation Output Section */}
              {activeEvaluation && !isEvaluating && (
                <div className="flex flex-col gap-4 mt-2">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                      <Gauge className="w-4 h-4 text-emerald-400" />
                      診断テスト結果・精度比較
                    </div>
                    <span className="text-[10px] font-mono text-slate-500">Test evaluated at: {new Date().toLocaleTimeString()}</span>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {activeEvaluation.map((result) => {
                      const isWarning = result.latency > latencyThreshold;
                      return (
                        <div 
                          key={result.modelId} 
                          className={cn(
                            "bg-slate-950 border rounded-xl p-4 flex flex-col justify-between gap-3 relative overflow-hidden transition-all",
                            isWarning ? "border-amber-900/60 bg-amber-950/5" : "border-slate-800"
                          )}
                        >
                          <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                            <span className="font-black text-xs text-white">{result.modelName}</span>
                            <div className="flex items-center gap-2">
                              {isWarning && (
                                <span className="flex items-center gap-1 text-[9px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded uppercase">
                                  <AlertCircle className="w-3 h-3" /> Degradation Detected
                                </span>
                              )}
                              <span className="text-xs font-black text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">
                                Score: {result.score}/100
                              </span>
                            </div>
                          </div>

                          {/* Response Text Preview */}
                          <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
                            <p className="text-[11px] font-mono text-slate-300 leading-relaxed max-h-20 overflow-y-auto whitespace-pre-wrap">
                              {result.response}
                            </p>
                          </div>

                          {/* Interactive diagnostic metrics */}
                          <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-bold">
                            <div className="bg-slate-900/30 p-2 rounded-lg border border-slate-900">
                              <span className="text-slate-500 block uppercase mb-0.5">Response Time</span>
                              <span className={cn("text-xs font-black", isWarning ? "text-amber-400" : "text-white")}>
                                {result.latency}ms
                              </span>
                            </div>
                            <div className="bg-slate-900/30 p-2 rounded-lg border border-slate-900">
                              <span className="text-slate-500 block uppercase mb-0.5">Tokens Used</span>
                              <span className="text-xs font-black text-white">{result.tokens}</span>
                            </div>
                            <div className="bg-slate-900/30 p-2 rounded-lg border border-slate-900">
                              <span className="text-slate-500 block uppercase mb-0.5">API Cost</span>
                              <span className="text-xs font-black text-emerald-400">${result.cost.toFixed(4)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>

          </div>
        )}

        {/* ======================================= */}
        {/* TAB 2: ACCURACY COMPARISON & LATENCY BENCHMARKS */}
        {/* ======================================= */}
        {activeTab === "benchmarks" && (
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="text-2xl font-black text-white flex items-center gap-2">
                <Target className="w-7 h-7 text-indigo-400" />
                AI精度 ＆ レスポンス速度比較
              </h1>
              <p className="text-slate-400 text-xs font-medium mt-1">
                各LLMの品質指標、応答時間、ベンチマークスコアの詳細比較マトリクス
              </p>
            </div>

            {/* Custom Interactive SVG Latency Comparison Chart */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm font-black text-white mb-4 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-indigo-400" />
                レスポンス速度比較 (P95 Latency)
              </h3>
              
              <div className="flex flex-col gap-4">
                {models.map(m => {
                  const maxLatency = 1000; // max expected latency for scaling
                  const percentage = Math.min(100, (m.latency / maxLatency) * 100);
                  return (
                    <div key={m.id} className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                      <div className="w-44 text-xs font-bold text-slate-300 truncate">{m.name}</div>
                      <div className="flex-1 bg-slate-900 border border-slate-800 h-8 rounded-xl flex items-center p-1 relative overflow-hidden">
                        <div 
                          className={cn("h-full rounded-lg transition-all duration-700 bg-gradient-to-r", 
                            m.id === 'openai' ? "from-emerald-500 to-green-600" :
                            m.id === 'gemini' ? "from-blue-500 to-indigo-600" :
                            m.id === 'claude' ? "from-amber-500 to-orange-600" : "from-rose-500 to-red-600"
                          )}
                          style={{ width: `${percentage}%` }}
                        />
                        <span className="absolute right-4 text-[10px] font-mono font-bold text-slate-400">
                          {m.latency}ms
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Chart footer */}
              <div className="flex justify-between text-[10px] font-bold text-slate-500 mt-4 border-t border-slate-900 pt-3 pl-44">
                <span>0ms (Instant)</span>
                <span>250ms</span>
                <span>500ms (SLA target)</span>
                <span>750ms</span>
                <span>1000ms (Degraded)</span>
              </div>
            </div>

            {/* Quality Score Breakdown / Alignment Criteria */}
            <div className="bg-slate-950/40 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm font-black text-white mb-4 flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-indigo-400" />
                AI回答品質スコア詳細・評価クライテリア
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Visual Radar Score Simulator */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 flex flex-col gap-4">
                  <div className="text-xs font-black text-white uppercase tracking-wider">
                    多角的評価レーティング
                  </div>

                  <div className="flex flex-col gap-3">
                    {models.map(m => (
                      <div key={m.id} className="bg-slate-900/60 border border-slate-800 p-3 rounded-lg">
                        <div className="flex justify-between items-center text-xs font-bold mb-2">
                          <span className="text-slate-300">{m.name}</span>
                          <span className="text-indigo-400">Score: {m.qualityScore}/100</span>
                        </div>

                        {/* Visual breakdown bars */}
                        <div className="grid grid-cols-2 gap-2 text-[9px] text-slate-400 font-bold">
                          <div>
                            <span className="block mb-1">Coherence (一貫性): {m.coherence}/10</span>
                            <div className="bg-slate-800 h-1 rounded-full overflow-hidden">
                              <div className="bg-indigo-500 h-full" style={{ width: `${m.coherence * 10}%` }} />
                            </div>
                          </div>
                          <div>
                            <span className="block mb-1">Factuality (正確性): {m.factuality}/10</span>
                            <div className="bg-slate-800 h-1 rounded-full overflow-hidden">
                              <div className="bg-emerald-500 h-full" style={{ width: `${m.factuality * 10}%` }} />
                            </div>
                          </div>
                          <div>
                            <span className="block mb-1">Safety (安全性・倫理): {m.safety}/10</span>
                            <div className="bg-slate-800 h-1 rounded-full overflow-hidden">
                              <div className="bg-blue-500 h-full" style={{ width: `${m.safety * 10}%` }} />
                            </div>
                          </div>
                          <div>
                            <span className="block mb-1">Alignment (システム整合): {m.alignment}/10</span>
                            <div className="bg-slate-800 h-1 rounded-full overflow-hidden">
                              <div className="bg-amber-500 h-full" style={{ width: `${m.alignment * 10}%` }} />
                            </div>
                          </div>
                        </div>

                      </div>
                    ))}
                  </div>
                </div>

                {/* Benchmark benchmarks table */}
                <div className="flex flex-col justify-between gap-4">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
                    <h4 className="text-xs font-black text-white uppercase tracking-wider mb-3">標準学術ベンチマーク精度スコア</h4>
                    
                    <div className="flex flex-col gap-3">
                      <div className="grid grid-cols-4 text-[10px] text-slate-500 font-black uppercase tracking-wider border-b border-slate-900 pb-2">
                        <span>Model</span>
                        <span className="text-center">MMLU (Reasoning)</span>
                        <span className="text-center">GSM8k (Math)</span>
                        <span className="text-center">HumanEval (Code)</span>
                      </div>

                      <div className="flex flex-col gap-2.5">
                        <div className="grid grid-cols-4 text-xs font-bold text-slate-300">
                          <span>GPT-4o</span>
                          <span className="text-center text-emerald-400">88.7%</span>
                          <span className="text-center">92.0%</span>
                          <span className="text-center">87.2%</span>
                        </div>
                        <div className="grid grid-cols-4 text-xs font-bold text-slate-300">
                          <span>Gemini 1.5 Pro</span>
                          <span className="text-center">85.9%</span>
                          <span className="text-center text-emerald-400">91.7%</span>
                          <span className="text-center">84.1%</span>
                        </div>
                        <div className="grid grid-cols-4 text-xs font-bold text-slate-300">
                          <span>Claude 3.5 Sonnet</span>
                          <span className="text-center text-emerald-400">90.4%</span>
                          <span className="text-center text-emerald-400">96.4%</span>
                          <span className="text-center text-emerald-400">92.0%</span>
                        </div>
                        <div className="grid grid-cols-4 text-xs font-bold text-slate-300">
                          <span>DeepSeek Coder</span>
                          <span className="text-center text-rose-500">79.2%</span>
                          <span className="text-center">82.5%</span>
                          <span className="text-center text-emerald-400">89.5%</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-indigo-950/20 border border-indigo-900/30 rounded-xl p-4 flex gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 text-indigo-400 shrink-0">
                      <Shield className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white mb-0.5">精度 ＆ 速度に基づいたスマート・ルーター機能</h4>
                      <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
                        ACOS Guardは、プロンプトのセマンティクス（推論複雑度、コーディング要件、予算の優先度など）を自動検知。
                        適切なモデルへ動的マッピングを行います。
                      </p>
                    </div>
                  </div>
                </div>

              </div>
            </div>

          </div>
        )}

        {/* ======================================= */}
        {/* TAB 3: COST & TOKEN MANAGEMENT */}
        {/* ======================================= */}
        {activeTab === "cost" && (
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="text-2xl font-black text-white flex items-center gap-2">
                <DollarSign className="w-7 h-7 text-indigo-400" />
                コスト ＆ トークン管理
              </h1>
              <p className="text-slate-400 text-xs font-medium mt-1">
                APIトークン使用量の統計、プロバイダーごとのコスト集計、予算監視
              </p>
            </div>

            {/* Token Consumption Share */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-6">
                <h3 className="text-sm font-black text-white mb-4 flex items-center gap-1.5">
                  <BarChart3 className="w-4 h-4 text-indigo-400" />
                  モデル別のトークン累積使用率
                </h3>

                <div className="flex flex-col gap-5 mt-2">
                  {models.map(m => {
                    const ratio = Number(((m.tokens / totalTokens) * 100).toFixed(1));
                    return (
                      <div key={m.id} className="flex flex-col gap-1.5">
                        <div className="flex justify-between items-center text-xs font-bold">
                          <span className="text-slate-300">{m.name}</span>
                          <span className="text-slate-400">
                            {(m.tokens / 1000000).toFixed(2)}M tokens ({ratio}%)
                          </span>
                        </div>
                        <div className="w-full bg-slate-900 border border-slate-800/80 h-3 rounded-full overflow-hidden">
                          <div 
                            className={cn("h-full rounded-full transition-all duration-700 bg-gradient-to-r", 
                              m.id === 'openai' ? "from-emerald-500 to-green-600" :
                              m.id === 'gemini' ? "from-blue-500 to-indigo-600" :
                              m.id === 'claude' ? "from-amber-500 to-orange-600" : "from-rose-500 to-red-600"
                            )} 
                            style={{ width: `${ratio}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* API Budget & Cost Tracker */}
              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between gap-6">
                <div>
                  <h3 className="text-sm font-black text-white mb-2 flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4 text-indigo-400" />
                    月間予算しきい値コントロール
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    月の累計使用料がしきい値を超過した場合、自動的に低コストの最適プロバイダー（DeepSeek/Gemini等）へ切り替える設定を行います。
                  </p>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-400">月間API予算上限</span>
                    <span className="text-sm font-black text-white">${budgetLimit} USD</span>
                  </div>

                  <input 
                    type="range"
                    min="10"
                    max="500"
                    step="10"
                    value={budgetLimit}
                    onChange={(e) => setBudgetLimit(Number(e.target.value))}
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />

                  <div className="flex justify-between text-[10px] text-slate-500 font-bold">
                    <span>$10</span>
                    <span>$250</span>
                    <span>$500</span>
                  </div>
                </div>

                <div className="bg-slate-900/40 p-4 border border-slate-800 rounded-xl flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-slate-400 font-black uppercase tracking-wider mb-0.5">当月累計コスト</div>
                    <div className="text-xl font-black text-white">${totalCost.toFixed(2)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400 font-black uppercase tracking-wider mb-0.5">予算消化率</div>
                    <div className="text-sm font-black text-indigo-400">{((totalCost / budgetLimit) * 100).toFixed(1)}%</div>
                  </div>
                </div>
              </div>

            </div>

            {/* Standard pricing table */}
            <div className="bg-slate-950/40 border border-slate-800 rounded-2xl p-5">
              <h3 className="text-xs font-black text-white uppercase tracking-wider mb-3">APIプロバイダー別 料金定義 (目安値/1M Tokens)</h3>
              
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-4 text-[10px] text-slate-500 font-black uppercase tracking-wider border-b border-slate-900 pb-2">
                  <span>Model</span>
                  <span>Input Token Cost</span>
                  <span>Output Token Cost</span>
                  <span>推定コスト比率</span>
                </div>

                <div className="flex flex-col gap-2 text-xs font-medium text-slate-300">
                  <div className="grid grid-cols-4">
                    <span>OpenAI GPT-4o</span>
                    <span>$5.00 / 1M</span>
                    <span>$15.00 / 1M</span>
                    <span className="text-slate-400 font-bold">標準 (1.0x)</span>
                  </div>
                  <div className="grid grid-cols-4">
                    <span>Google Gemini 1.5 Pro</span>
                    <span>$1.25 / 1M</span>
                    <span>$5.00 / 1M</span>
                    <span className="text-indigo-400 font-bold">低コスト (0.3x)</span>
                  </div>
                  <div className="grid grid-cols-4">
                    <span>Anthropic Claude 3.5 Sonnet</span>
                    <span>$3.00 / 1M</span>
                    <span>$15.00 / 1M</span>
                    <span className="text-slate-400 font-bold">標準 (0.8x)</span>
                  </div>
                  <div className="grid grid-cols-4">
                    <span>DeepSeek Coder V2</span>
                    <span>$0.14 / 1M</span>
                    <span>$0.28 / 1M</span>
                    <span className="text-emerald-400 font-bold">最安 (0.02x)</span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ======================================= */}
        {/* TAB 4: AUTOMATED FAILURE DETECTION & SWITCH LOGS */}
        {/* ======================================= */}
        {activeTab === "failover" && (
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="text-2xl font-black text-white flex items-center gap-2">
                <ArrowLeftRight className="w-7 h-7 text-indigo-400" />
                自動障害検知 ＆ AI切替履歴
              </h1>
              <p className="text-slate-400 text-xs font-medium mt-1">
                レスポンス異常値による自動切替ルールの設定および切り替え履歴の監査ログ
              </p>
            </div>

            {/* Threshold Configuration Controls */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm font-black text-white mb-4 flex items-center gap-1.5">
                <Settings className="w-4 h-4 text-indigo-400" />
                自動切替 (Automated Failover) 閾値ルール定義
              </h3>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Latency Rule Slider */}
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col gap-3">
                  <div className="flex justify-between items-center text-xs font-bold">
                    <span className="text-slate-300">レスポンス遅延（Latency）許容限界</span>
                    <span className="text-indigo-400 font-mono font-black">{latencyThreshold}ms</span>
                  </div>
                  <p className="text-[10px] text-slate-500 font-medium">この応答時間を超えた場合に「警告・自動切り替え」を行います。</p>
                  <input
                    type="range"
                    min="300"
                    max="1500"
                    step="50"
                    value={latencyThreshold}
                    onChange={(e) => setLatencyThreshold(Number(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 mt-2"
                  />
                  <div className="flex justify-between text-[9px] text-slate-500 font-bold">
                    <span>300ms</span>
                    <span>900ms</span>
                    <span>1500ms</span>
                  </div>
                </div>

                {/* Error Rate Rule Slider */}
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col gap-3">
                  <div className="flex justify-between items-center text-xs font-bold">
                    <span className="text-slate-300">リクエストエラー率閾値</span>
                    <span className="text-rose-400 font-mono font-black">{errorThreshold}%</span>
                  </div>
                  <p className="text-[10px] text-slate-500 font-medium">過去5分間のAPIエラー率がこれを超えた場合に「障害」と認定します。</p>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    step="1"
                    value={errorThreshold}
                    onChange={(e) => setErrorThreshold(Number(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500 mt-2"
                  />
                  <div className="flex justify-between text-[9px] text-slate-500 font-bold">
                    <span>1%</span>
                    <span>5%</span>
                    <span>10%</span>
                  </div>
                </div>

                {/* Auto Switch Master Toggle */}
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col justify-between">
                  <div>
                    <span className="text-xs font-bold text-slate-300 block mb-1">自動モデルフェイルオーバー</span>
                    <p className="text-[10px] text-slate-500 font-medium">
                      異常検知時、他の健全なOperationalモデルへ動的にリクエストをバックアップ転送します。
                    </p>
                  </div>

                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs font-bold text-slate-400">機能有効化ステータス:</span>
                    <button
                      onClick={() => setEnableAutoSwitch(!enableAutoSwitch)}
                      className={cn(
                        "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all",
                        enableAutoSwitch 
                          ? "bg-emerald-600 text-white" 
                          : "bg-slate-800 text-slate-400"
                      )}
                    >
                      {enableAutoSwitch ? "ENABLED" : "DISABLED"}
                    </button>
                  </div>
                </div>

              </div>
            </div>

            {/* Switching History Audit Table */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm font-black text-white mb-4 flex items-center gap-1.5">
                <ArrowLeftRight className="w-4 h-4 text-indigo-400" />
                AI切替履歴 監査ログ
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[10px] text-slate-500 font-black uppercase tracking-wider border-b border-slate-800 pb-2">
                      <th className="pb-3">発生日時</th>
                      <th className="pb-3">検知イベント</th>
                      <th className="pb-3">切替元</th>
                      <th className="pb-3">切替先</th>
                      <th className="pb-3">切替の契機 / 障害詳細</th>
                      <th className="pb-3 text-right">自動切替</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {switchLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-900/30">
                        <td className="py-3.5 font-mono text-slate-400 text-[11px]">{log.timestamp}</td>
                        <td className="py-3.5">
                          <span className={cn("inline-flex items-center gap-1 font-bold", 
                            log.status === "warning" ? "text-amber-400" :
                            log.status === "success" ? "text-emerald-400" : "text-blue-400"
                          )}>
                            {log.event}
                          </span>
                        </td>
                        <td className="py-3.5 text-slate-300">{log.fromModel}</td>
                        <td className="py-3.5 text-slate-200 font-bold">{log.toModel}</td>
                        <td className="py-3.5 text-slate-400 text-[11px] font-medium leading-relaxed max-w-xs truncate">{log.reason}</td>
                        <td className="py-3.5 text-right">
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full uppercase">
                            <CheckCircle className="w-3 h-3" /> ACTIVE
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

      </div>

    </div>
  );
}
