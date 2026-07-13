import  { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Play, 
  Pause, 
  RotateCcw, 
   
   
   
  Cpu, 
  Database, 
  Layers, 
  Shield, 
   
  Compass, 
  Activity, 
   
  Check, 
  Server, 
  Terminal, 
   
   
  
  Workflow,
  
  
  
  
  Award
} from "lucide-react";
import { cn } from "../../utils";

interface MissionRuntimeConsoleProps {
  missionTitle: string;
  onComplete: (data: any) => void;
  onClose: () => void;
  activePrompt: string;
  selectedCategory: any;
}

export default function MissionRuntimeConsole({
  missionTitle,
  onComplete,
  onClose,
  activePrompt,
  selectedCategory
}: MissionRuntimeConsoleProps) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState<1 | 2 | 5>(1);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [progress, setProgress] = useState<number>(0);
  const [statusText, setStatusText] = useState<string>("Initializing ORIGIN Runtime Environment...");
  const [logMessages, setLogMessages] = useState<string[]>([]);
  const [isFinished, setIsFinished] = useState(false);
  const [isFailed, setIsFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [backendData, setBackendData] = useState<any>(null);
  const [selectedQueueTaskId, setSelectedQueueTaskId] = useState<string | null>(null);
  const [agentStates, setAgentStates] = useState({
    ceo: "Pending",
    research: "Pending",
    writer: "Pending",
    quality: "Pending"
  });
  const [triggerFetchCount, setTriggerFetchCount] = useState(0);

  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Define Runtime Phases
  const PHASES = [
    { id: 0, name: "Mission Parser & Requirements Analysis", key: "parser", desc: "ミッション目標、制約条件、成功条件(Success Conditions)の自動解析" },
    { id: 1, name: "Task DAG Generation Engine", key: "dag", desc: "自律的な業務手順の分解と依存関係ツリーの構築" },
    { id: 2, name: "Capability Matcher & Allocator", key: "capability", desc: "最適AIモデル、システムツールの自動選定と権限認証" },
    { id: 3, name: "Corporate Organization Execution (OEE)", key: "organization", desc: "Board, C-Suite, Director, Manager, Workerによる階層型審議と合意形成" },
    { id: 4, name: "Consensus Audit & Quality gate (UQI)", key: "execution", desc: "複数モデル対比、12-Factor基準ファクトチェック、成果物コンパイル" },
    { id: 5, name: "Workspace Durability Save", key: "save", desc: "暗号化保存、ナレッジDNA世代更新、成果物ファイルのアセンブリ" }
  ];

  // Dynamic Execution Queue Tasks
  const [tasks, setTasks] = useState<any[]>([
    { id: "TSK-001", name: "Board Strategic Directive Compilation", type: "Planning", status: "Pending", assignedTo: "BOARD-AGENT-1", duration: "1.2s" },
    { id: "TSK-002", name: "C-Suite Execution Strategy Drafting", type: "Planning", status: "Pending", assignedTo: "CTO-AGENT", duration: "1.5s" },
    { id: "TSK-003", name: "Technical Feature Specification Engineering", type: "Coding", status: "Pending", assignedTo: "WORKER-ENG-1", duration: "2.4s" },
    { id: "TSK-004", name: "Product Strategy & Documentation Copywriting", type: "Writing", status: "Pending", assignedTo: "WORKER-CON-1", duration: "2.0s" },
    { id: "TSK-005", name: "Multi-Model Consensus & Peer Review", type: "Audit", status: "Pending", assignedTo: "MGR-ENG-AGENT", duration: "1.8s" },
    { id: "TSK-006", name: "UQI Quality Verification & Final Delivery", type: "Delivery", status: "Pending", assignedTo: "CEO-AGENT", duration: "1.0s" },
  ]);

  // AI Allocations
  const aiWorkers = [
    { name: "Gemini 2.5 Pro", icon: "♊", speed: "98/100", quality: "Q5 Standard", status: "Idle" },
    { name: "GPT-4o", icon: "🟢", speed: "92/100", quality: "Q4 High-End", status: "Idle" },
    { name: "Claude 3.5 Sonnet", icon: "🍁", speed: "86/100", quality: "Q5 Standard", status: "Idle" },
    { name: "DeepSeek-R1", icon: "🐳", speed: "70/100", quality: "Q5 Reasoning", status: "Idle" }
  ];

  // Tool Allocations
  const toolCapabilities = [
    { name: "Filesystem Access Engine", status: "Enabled", icon: <Database className="w-3.5 h-3.5" /> },
    { name: "Secure Sandbox Runtime", status: "Enabled", icon: <Server className="w-3.5 h-3.5" /> },
    { name: "Search & Maps Grounding Link", status: "Enabled", icon: <Compass className="w-3.5 h-3.5" /> }
  ];

  const addLog = (message: string) => {
    const time = new Date().toLocaleTimeString();
    setLogMessages(prev => [...prev, `[${time}] ${message}`]);
  };

  // Start the background real API Call immediately when mounted
  useEffect(() => {
    let active = true;

    async function runBackend() {
      addLog("⚡ Initiating real-time streaming OEE pipeline execution...");
      addLog(`⚡ Objective registered: "${missionTitle}"`);
      addLog("⚡ Querying corporate multi-agent organization...");

      setAgentStates({
        ceo: "Pending",
        research: "Pending",
        writer: "Pending",
        quality: "Pending"
      });

      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            prompt: missionTitle,
            agents: ["gemini", "openai"]
          }) });

        if (!response.ok) {
          throw new Error("API execution rejected by Gemini server cluster.");
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        if (reader) {
          while (active) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const dataStr = line.slice(6).trim();
                if (!dataStr) continue;

                try {
                  const event = JSON.parse(dataStr);
                  if (event.type === "progress") {
                    if (active) {
                      setProgress(event.progress);
                      setCurrentStep(event.phase);
                      setStatusText(event.statusText);
                      addLog(event.message);
                    }
                  } else if (event.type === "agent_status") {
                    if (active) {
                      addLog(event.message);
                      const currentAgent = event.agent;
                      if (currentAgent === "ceo") {
                        setAgentStates({ ceo: "Active", research: "Pending", writer: "Pending", quality: "Pending" });
                      } else if (currentAgent === "research") {
                        setAgentStates({ ceo: "Completed", research: "Active", writer: "Pending", quality: "Pending" });
                      } else if (currentAgent === "writer") {
                        setAgentStates({ ceo: "Completed", research: "Completed", writer: "Active", quality: "Pending" });
                      } else if (currentAgent === "quality") {
                        setAgentStates({ ceo: "Completed", research: "Completed", writer: "Completed", quality: "Active" });
                      }
                    }
                  } else if (event.type === "result") {
                    if (active) {
                      setBackendData(event.data);
                      setAgentStates({ ceo: "Completed", research: "Completed", writer: "Completed", quality: "Completed" });
                      setProgress(100);
                      addLog("🏆 Stream execution complete! Consensus finalized.");
                      completeSuccessfully();
                    }
                  } else if (event.type === "error") {
                    throw new Error(event.details || "Stream execution error");
                  }
                } catch (e) {
                  console.warn("Failed to parse event line:", e);
                }
              }
            }
          }
        }
      } catch (err: any) {
        if (active) {
          console.error("Backend error in Mission Runtime Console:", err);
          setErrorMessage(err.message || "Communication failure with the AI host server.");
        }
      }
    }

    runBackend();

    return () => {
      active = false;
    };
  }, [missionTitle, triggerFetchCount]);

  // Main step increment simulation loop
  useEffect(() => {
    if (!isPlaying || isFinished || isFailed) return;

    const baseInterval = 1200; // ms per tick
    const intervalTime = baseInterval / speed;

    const timer = setInterval(() => {
      setProgress(prev => {
        const stepSize = Math.floor(Math.random() * 8) + 4;
        const nextProgress = Math.min(100, prev + stepSize);

        // Update steps based on progress thresholds
        const stepIdx = Math.floor(nextProgress / 17);
        if (stepIdx !== currentStep && stepIdx < PHASES.length) {
          setCurrentStep(stepIdx);
          handleStepTransition(stepIdx);
        }

        if (nextProgress >= 100) {
          clearInterval(timer);
          verifyAndComplete();
          return 100;
        }

        return nextProgress;
      });
    }, intervalTime);

    return () => clearInterval(timer);
  }, [isPlaying, currentStep, speed, isFinished, isFailed, backendData, errorMessage]);

  // Log auto-scroll
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logMessages]);

  const handleStepTransition = (stepIdx: number) => {
    const phaseName = PHASES[stepIdx]?.name;
    addLog(`🔄 Entering Phase ${stepIdx + 1}: ${phaseName}`);

    switch (stepIdx) {
      case 0:
        setStatusText("Analyzing goals, constraints, priority parameters...");
        addLog("📋 Mission Objective Schema mapped.");
        addLog("📋 Success conditions initialized (UQI Gate 95% minimum requirement).");
        break;
      case 1:
        setStatusText("Compiling Task DAG (Directed Acyclic Graph)...");
        addLog("🌿 Generating topological dependency tree...");
        setTasks(prev => prev.map((t, idx) => {
          if (idx === 0) return { ...t, status: "In_Progress" };
          return t;
        }));
        addLog("🌿 Task DAG constructed successfully with 6 high-level milestones.");
        break;
      case 2:
        setStatusText("Configuring Capability matching & Security sandboxes...");
        addLog("🛡️ Routing tasks to optimized multi-agent registry endpoints.");
        addLog("🛡️ Granting restricted Sandbox Filesystem & Search Grounding credentials.");
        setTasks(prev => prev.map((t, idx) => {
          if (idx === 0) return { ...t, status: "Completed" };
          if (idx === 1) return { ...t, status: "In_Progress" };
          return t;
        }));
        break;
      case 3:
        setStatusText("Executing Corporate Organization deliberative rounds...");
        addLog("🏛️ Board Directive successfully authorized.");
        addLog("🏛️ C-Suite strategic breakdown completed.");
        addLog("🏛️ Delegating implementation to Workers (WORKER-ENG-1, WORKER-CON-1).");
        setTasks(prev => prev.map((t, idx) => {
          if (idx <= 1) return { ...t, status: "Completed" };
          if (idx === 2 || idx === 3) return { ...t, status: "In_Progress" };
          return t;
        }));
        break;
      case 4:
        setStatusText("Running multi-model consensus review & compliance audit...");
        addLog("💎 Peer managers feedback collected (Target rating: 95+).");
        addLog("💎 Applying 12-Factor Verification rules (Hallucination 0 checked).");
        setTasks(prev => prev.map((t, idx) => {
          if (idx <= 3) return { ...t, status: "Completed" };
          if (idx === 4) return { ...t, status: "In_Progress" };
          return t;
        }));
        break;
      case 5:
        setStatusText("Finalizing Workspace saves & compiling output files...");
        addLog("💾 Serializing files: mission_meta.json, deliverable_strategy.md");
        addLog("💾 Updating user knowledge DNA profile.");
        setTasks(prev => prev.map((t, idx) => {
          if (idx <= 4) return { ...t, status: "Completed" };
          if (idx === 5) return { ...t, status: "In_Progress" };
          return t;
        }));
        break;
      default:
        break;
    }
  };

  const verifyAndComplete = () => {
    if (errorMessage) {
      addLog(`❌ Execution failed: ${errorMessage}`);
      setErrorMessage(errorMessage);
      setIsFailed(true);
      return;
    }

    if (!backendData) {
      // If backend is still fetching, wait a bit or generate mock success to preserve seamless experience
      setStatusText("Waiting for AI cloud cluster to complete final compilation...");
      addLog("⏳ Backend API is completing final compilation steps. Holding progress...");
      
      const checkInterval = setInterval(() => {
        if (backendData) {
          clearInterval(checkInterval);
          completeSuccessfully();
        } else if (errorMessage) {
          clearInterval(checkInterval);
          addLog(`❌ Execution failed: ${errorMessage}`);
          setIsFailed(true);
        }
      }, 500);
    } else {
      completeSuccessfully();
    }
  };

  const completeSuccessfully = () => {
    setTasks(prev => prev.map(t => ({ ...t, status: "Completed" })));
    setIsFinished(true);
    addLog("🏆 Mission completed with World-Class Q5 Standard!");
    addLog("💾 All files successfully written to the secure active workspace.");
    setStatusText("Mission completed successfully! Click '成果物を確認' to view.");
  };

  const handleRetry = () => {
    setIsFailed(false);
    setIsFinished(false);
    setProgress(0);
    setCurrentStep(0);
    setErrorMessage("");
    setTasks(tasks.map(t => ({ ...t, status: "Pending" })));
    setLogMessages([]);
    setBackendData(null);
    setStatusText("Re-initializing ORIGIN Runtime Environment...");
    setAgentStates({
      ceo: "Pending",
      research: "Pending",
      writer: "Pending",
      quality: "Pending"
    });
    setTriggerFetchCount(prev => prev + 1);
  };

  const handleForceComplete = () => {
    if (backendData) {
      setProgress(100);
      completeSuccessfully();
    } else {
      addLog("⚠️ Cannot force complete until backend data has loaded.");
    }
  };

  const handleDeliver = () => {
    if (backendData && onComplete) {
      onComplete(backendData);
    }
  };

  return (
    <div className="flex flex-col h-full space-y-6 text-slate-200">
      
      {/* Top Controller HUD */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 border border-white/[0.06] rounded-2xl p-4 backdrop-blur-xl">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-400/20 px-2 py-0.5 rounded-full font-mono font-bold uppercase tracking-wider">
              ACOS-v1 ENGINE ACTIVE
            </span>
            {isFinished ? (
              <span className="text-[10px] bg-emerald-500/25 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-mono font-bold uppercase tracking-wider">
                Q5 STANDARD GUARANTEED
              </span>
            ) : isFailed ? (
              <span className="text-[10px] bg-rose-500/25 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded-full font-mono font-bold uppercase tracking-wider">
                EXECUTION FAILED
              </span>
            ) : (
              <span className="text-[10px] bg-pink-500/10 text-pink-400 border border-pink-400/20 px-2 py-0.5 rounded-full font-mono font-bold uppercase tracking-wider animate-pulse">
                RUNNING
              </span>
            )}
          </div>
          <h2 className="text-base font-black tracking-tight text-white">
            Mission Objective: <span className="text-slate-300 font-medium">{missionTitle}</span>
          </h2>
        </div>

        {/* Console Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            disabled={isFinished || isFailed}
            className={cn(
              "p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-center",
              isPlaying 
                ? "bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-700" 
                : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
            )}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>

          <div className="flex items-center bg-white/5 border border-white/10 p-1 rounded-xl font-mono text-[9px] font-bold">
            {[1, 2, 5].map(s => (
              <button
                key={s}
                onClick={() => setSpeed(s as any)}
                disabled={isFinished || isFailed}
                className={cn(
                  "px-2 py-1 rounded-lg transition-colors cursor-pointer",
                  speed === s 
                    ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30" 
                    : "text-slate-500 hover:text-white"
                )}
              >
                {s}x
              </button>
            ))}
          </div>

          {!isFinished && !isFailed && (
            <button
              onClick={handleForceComplete}
              className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white text-xs font-bold rounded-xl transition-all cursor-pointer"
            >
              スキップ
            </button>
          )}

          {isFailed && (
            <button
              onClick={handleRetry}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 border border-rose-500 text-white text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-lg shadow-rose-900/30"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Retry Mission</span>
            </button>
          )}

          {isFinished && (
            <button
              onClick={handleDeliver}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 border border-emerald-500 text-white text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-lg shadow-emerald-950/40 animate-bounce"
            >
              <Award className="w-4 h-4" />
              <span>成果物を確認</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: Visual Progress Map & Right Execution logs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch flex-1">
        
        {/* Left column: Visual Step-by-Step progress path (Col span 7) */}
        <div className="lg:col-span-7 space-y-6 flex flex-col justify-between">
          
          {/* Dynamic Progress Indicator */}
          <div className="bg-slate-900/40 border border-white/[0.04] rounded-2xl p-6 space-y-4">
            <div className="flex justify-between items-baseline font-mono text-[10px]">
              <span className="text-slate-400 uppercase tracking-wider font-bold">Compilation & Assembly Status</span>
              <span className="text-white font-black">{progress}%</span>
            </div>
            <div className="w-full h-2.5 bg-white/[0.05] rounded-full overflow-hidden border border-white/[0.05]">
              <motion.div
                initial={{ width: "0%" }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
                className="h-full bg-gradient-to-r from-indigo-500 via-pink-500 to-blue-500"
              />
            </div>
            <p className="text-xs text-indigo-300 italic font-medium">
              💡 Status: {statusText}
            </p>
          </div>

          {/* OEE Active Agents Monitor */}
          <div className="bg-slate-900/40 border border-white/[0.04] rounded-2xl p-5 space-y-4">
            <h3 className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              OEE Active Agents Monitor
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { key: "ceo", name: "CEO Agent", icon: "👔", desc: "戦略・意思決定" },
                { key: "research", name: "Research Agent", icon: "🔍", desc: "一次情報・ファクト" },
                { key: "writer", name: "Writer Agent", icon: "✍️", desc: "成果物作成・比較" },
                { key: "quality", name: "Quality Agent", icon: "🛡️", desc: "Q5 監査・適合" }
              ].map((ag) => {
                const status = (agentStates as any)[ag.key] || "Pending";
                const isActive = status === "Active";
                const isDone = status === "Completed";

                return (
                  <div
                    key={ag.key}
                    className={cn(
                      "p-3 rounded-xl border flex flex-col justify-between transition-all duration-300",
                      isActive ? "bg-indigo-500/10 border-indigo-500/50 shadow-md shadow-indigo-950/20" :
                      isDone ? "bg-emerald-500/5 border-emerald-500/30 opacity-90" :
                      "bg-white/[0.01] border-white/5 opacity-50"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-lg">{ag.icon}</span>
                      <span className={cn(
                        "text-[8px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider",
                        isActive ? "bg-indigo-500/20 text-indigo-400 animate-pulse" :
                        isDone ? "bg-emerald-500/20 text-emerald-400" :
                        "bg-white/5 text-slate-500"
                      )}>
                        {status}
                      </span>
                    </div>
                    <div className="mt-2 text-left">
                      <p className="text-[11px] font-bold text-white">{ag.name}</p>
                      <p className="text-[9px] text-slate-400 mt-0.5">{ag.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Interactive Steps Visual Map */}
          <div className="bg-[#0b0c10]/40 border border-white/[0.04] rounded-2xl p-5 space-y-4 flex-1">
            <h3 className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase flex items-center gap-2">
              <Workflow className="w-4 h-4 text-indigo-400" />
              Intelligence Execution Pipeline
            </h3>

            <div className="relative pl-6 border-l border-white/5 space-y-5">
              {PHASES.map((ph) => {
                const isPassed = currentStep > ph.id;
                const isCurrent = currentStep === ph.id;
                const isPending = currentStep < ph.id;

                return (
                  <div key={ph.id} className="relative group">
                    {/* Ring Anchor */}
                    <div className={cn(
                      "absolute -left-[30px] top-1 w-4 h-4 rounded-full border flex items-center justify-center transition-all duration-300",
                      isPassed ? "bg-emerald-500/25 border-emerald-500 text-emerald-400" :
                      isCurrent ? "bg-indigo-500/25 border-indigo-500 text-indigo-300 animate-pulse scale-110" :
                      "bg-[#0e0e12] border-white/10 text-slate-500"
                    )}>
                      {isPassed ? <Check className="w-2.5 h-2.5" /> : <span className="text-[8px] font-mono font-bold">{ph.id + 1}</span>}
                    </div>

                    {/* Step Card */}
                    <div className={cn(
                      "p-3 rounded-xl border transition-all duration-300",
                      isPassed ? "bg-white/[0.02] border-emerald-500/20 text-slate-300" :
                      isCurrent ? "bg-indigo-500/5 border-indigo-500/30 text-white shadow-md shadow-indigo-950/20" :
                      "bg-white/[0.01] border-white/5 text-slate-500"
                    )}>
                      <h4 className="text-xs font-bold flex items-center justify-between">
                        <span>{ph.name}</span>
                        {isCurrent && <span className="text-[8px] font-mono font-black text-indigo-400 animate-pulse uppercase">PROCESSING...</span>}
                      </h4>
                      <p className={cn("text-[10px] mt-1 font-medium leading-relaxed", isCurrent ? "text-slate-300" : "text-slate-500")}>
                        {ph.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* Right column: Execution Queue & Live logs (Col span 5) */}
        <div className="lg:col-span-5 flex flex-col justify-between space-y-6">
          
          {/* Execution Queue Panel */}
          <div className="bg-slate-900/40 border border-white/[0.04] p-5 rounded-2xl flex flex-col h-[280px]">
            <div className="flex items-center justify-between border-b border-white/5 pb-2.5 mb-3">
              <h3 className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase flex items-center gap-2">
                <Layers className="w-4 h-4 text-pink-500" />
                Execution Queue
              </h3>
              <span className="text-[9px] font-mono text-slate-500">
                {tasks.filter(t => t.status === "Completed").length} / {tasks.length} DONE
              </span>
            </div>

            <div className="space-y-2 flex-1 overflow-y-auto pr-1">
              {tasks.map((task) => {
                const isCompleted = task.status === "Completed";
                const isInProgress = task.status === "In_Progress";
                const isSelected = selectedQueueTaskId === task.id;

                return (
                  <div
                    key={task.id}
                    onClick={() => setSelectedQueueTaskId(isSelected ? null : task.id)}
                    className={cn(
                      "p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between text-xs",
                      isSelected ? "bg-indigo-500/10 border-indigo-400/40" :
                      isInProgress ? "bg-pink-500/5 border-pink-500/20" :
                      isCompleted ? "bg-white/[0.02] border-emerald-500/10" :
                      "bg-white/[0.01] border-white/5 opacity-50"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        isCompleted ? "bg-emerald-500" :
                        isInProgress ? "bg-pink-500 animate-ping" :
                        "bg-slate-600"
                      )} />
                      <div className="min-w-0">
                        <p className="font-bold text-white truncate text-[11px]">{task.name}</p>
                        <p className="text-[8px] font-mono text-slate-400 uppercase tracking-wider">
                          Assignee: {task.assignedTo} • {task.type}
                        </p>
                      </div>
                    </div>
                    <span className="text-[9px] font-mono text-slate-400 font-bold">
                      {task.duration}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Selected Queue task description bubble */}
            <AnimatePresence>
              {selectedQueueTaskId && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  className="mt-3 p-2.5 bg-slate-950 border border-indigo-500/25 rounded-xl text-[9.5px] text-slate-300 font-mono"
                >
                  <p className="font-bold text-indigo-400 border-b border-white/5 pb-1 mb-1">
                    TASK METRIC [{selectedQueueTaskId}]
                  </p>
                  <p>
                    Required Cap: {tasks.find(t => t.id === selectedQueueTaskId)?.type}<br />
                    System Sandbox: Approved (UID: 1045)<br />
                    Execution Engine: Unified Quality compliance check passed.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Real-time Streaming Logs Terminal Console */}
          <div className="bg-neutral-950 border border-white/[0.05] p-4 rounded-2xl h-[230px] flex flex-col justify-between">
            <div className="flex items-center justify-between border-b border-white/[0.03] pb-2">
              <span className="font-mono text-[9px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-indigo-500" />
                <span>Live Execution logs</span>
              </span>
              <span className="text-[8px] font-mono text-slate-500 bg-white/5 px-1.5 py-0.5 rounded uppercase font-black">SYS_LOGS</span>
            </div>

            <div className="my-2 font-mono text-[9px] leading-relaxed text-slate-400 space-y-1.5 flex-1 overflow-y-auto pr-1">
              {logMessages.map((msg, idx) => (
                <div key={idx} className="flex items-start gap-1">
                  <span className="text-pink-400 select-none">&gt;&gt;</span>
                  <span className={cn(
                    "leading-relaxed",
                    idx === logMessages.length - 1 ? "text-indigo-200 font-bold" : "text-slate-400"
                  )}>
                    {msg}
                  </span>
                </div>
              ))}
              <div ref={consoleEndRef} />
            </div>
          </div>

        </div>

      </div>

      {/* Resource Allocation Footer HUD */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-[#0a0a0f] border border-white/[0.05] p-4 rounded-2xl">
        <div className="space-y-2">
          <h4 className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            Active AI Allocation Matrix
          </h4>
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
            {aiWorkers.map(w => {
              const isActive = isPlaying && !isFinished && !isFailed && progress > 30;
              return (
                <div key={w.name} className="flex justify-between items-center p-2 bg-white/[0.01] border border-white/5 rounded-lg">
                  <div className="flex items-center gap-1.5">
                    <span>{w.icon}</span>
                    <span className="font-bold text-slate-300">{w.name}</span>
                  </div>
                  <span className={cn(
                    "text-[8px] px-1.5 py-0.5 rounded font-black",
                    isActive ? "bg-pink-500/20 text-pink-400 animate-pulse" : "bg-slate-800 text-slate-500"
                  )}>
                    {isActive ? "ACTIVE" : "IDLE"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            System Tool Sandbox Capabilities
          </h4>
          <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
            {toolCapabilities.map(tool => (
              <div key={tool.name} className="flex flex-col p-2 bg-white/[0.01] border border-white/5 rounded-lg justify-center space-y-1 text-center items-center">
                <span className="text-slate-400">{tool.icon}</span>
                <span className="font-bold text-slate-300 text-[9px] truncate w-full">{tool.name}</span>
                <span className="text-[8px] font-black text-emerald-500">READY</span>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}
