import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
   
  Database, 
  Shield, 
   
  RefreshCw, 
  Terminal, 
  Cpu, 
  BookOpen, 
  Sparkles, 
  Target, 
  Briefcase, 
  TrendingUp, 
  Bot, 
  Activity, 
  
  
  
  Compass
} from "lucide-react";
import { cn } from "../../utils";

// Types for our node system
interface NeuralNode {
  id: string;
  label: string;
  jpLabel: string;
  icon: React.ReactNode;
  color: string;
  glowColor: string;
  angle: number; // in radians, for circular layout
  description: string;
  jpDescription: string;
}

export default function DynamicBrain() {
  // Load settings for isEn localization
  const [isEn, setIsEn] = useState(false);

  useEffect(() => {
    const handleSettingsChange = () => {
      try {
        const stored = localStorage.getItem("workspace_settings");
        if (stored) {
          const parsed = JSON.parse(stored);
          setIsEn(parsed.language === "en");
        }
      } catch (e) {
        console.error(e);
      }
    };

    handleSettingsChange();
    window.addEventListener("storage", handleSettingsChange);
    return () => window.removeEventListener("storage", handleSettingsChange);
  }, []);

  // Live states for thinking and metrics
  const [thinkingMode, setThinkingMode] = useState<string>("Thinking");
  const [activeThoughts, setActiveThoughts] = useState<string[]>([
    "Initializing neural core matrix...",
    "Synchronizing organizational knowledge layers..."
  ]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [synapticBursts, setSynapticBursts] = useState<{ id: number; x: number; y: number }[]>([]);
  const [burstCounter, setBurstCounter] = useState(0);

  // Fluctuating real-time cognitive metrics
  const [metrics, setMetrics] = useState({
    thinkingSpeed: 1240,
    knowledgeDensity: 4.82,
    accuracy: 98.4,
    reasoningDepth: 8,
    contextUsage: 64,
    learningRate: 0.0035
  });

  // Active agents status tracking
  const [agentPulses, setAgentPulses] = useState({
    gemini: true,
    claude: true,
    openai: true,
    perplexity: true,
    deepseek: false,
    qwen: false
  });

  // Circular layout parameters
  const cx = 400;
  const cy = 250;
  const rOffset = 180; // Distance of nodes from center

  // Node Definitions
  const nodes: NeuralNode[] = useMemo(() => [
    {
      id: "mission",
      label: "Mission",
      jpLabel: "ミッション",
      icon: <Target className="w-4 h-4" />,
      color: "from-pink-500 to-pink-600",
      glowColor: "rgba(236, 72, 153, 0.4)",
      angle: -Math.PI / 2, // 12 o'clock
      description: "Manage autonomous tasks, strategic goal settings, and context parameters.",
      jpDescription: "自律タスク、戦略ゴール設定、コンテキスト制約パラメータの管理"
    },
    {
      id: "workspace",
      label: "Workspace",
      jpLabel: "ワークスペース",
      icon: <Briefcase className="w-4 h-4" />,
      color: "from-amber-400 to-amber-600",
      glowColor: "rgba(245, 158, 11, 0.4)",
      angle: -Math.PI / 2 + (2 * Math.PI) / 7,
      description: "Storage of deliverables, intelligent attachments, and deep debate logs.",
      jpDescription: "成果物、添付のインテリジェンス資料、および詳細なDebate審議記録の保存"
    },
    {
      id: "marketplace",
      label: "Marketplace",
      jpLabel: "マーケットプレイス",
      icon: <Sparkles className="w-4 h-4" />,
      color: "from-indigo-500 to-pink-500",
      glowColor: "rgba(99, 102, 241, 0.4)",
      angle: -Math.PI / 2 + (2 * (2 * Math.PI)) / 7,
      description: "Pre-configured validation templates and specialized intelligence pipelines.",
      jpDescription: "プロフェッショナルな事前構成済み検証テンプレートとインテリジェンス構造"
    },
    {
      id: "agent",
      label: "Agent",
      jpLabel: "エージェント",
      icon:Bot ? <Bot className="w-4 h-4" /> : <Cpu className="w-4 h-4" />,
      color: "from-red-500 to-red-600",
      glowColor: "rgba(239, 68, 68, 0.4)",
      angle: -Math.PI / 2 + (3 * (2 * Math.PI)) / 7,
      description: "Execution of collaborative reasoning engines (Gemini, Claude, OpenAI, etc.).",
      jpDescription: "Gemini / Claude / OpenAI などの複数協調推論エンジンの並列実行"
    },
    {
      id: "organization",
      label: "Organization",
      jpLabel: "オーガニゼーション",
      icon: <Shield className="w-4 h-4" />,
      color: "from-blue-500 to-blue-600",
      glowColor: "rgba(59, 130, 246, 0.4)",
      angle: -Math.PI / 2 + (4 * (2 * Math.PI)) / 7,
      description: "Monitor UQI quality gates, risk levels, and organizational policy constraints.",
      jpDescription: "UQI品質ゲート、監査検証スコア、ポリシー制約の動的リアルタイム監視"
    },
    {
      id: "knowledge",
      label: "Knowledge",
      jpLabel: "ナレッジベース",
      icon: <BookOpen className="w-4 h-4" />,
      color: "from-emerald-400 to-emerald-600",
      glowColor: "rgba(16, 185, 129, 0.4)",
      angle: -Math.PI / 2 + (5 * (2 * Math.PI)) / 7,
      description: "Consolidation of fact storage and long-term memory via OEvE engine.",
      jpDescription: "OEvE（組織進化エンジン）によるファクト蓄積と長期永続化メモリ"
    },
    {
      id: "memory",
      label: "Memory",
      jpLabel: "メモリ・シンク",
      icon: <Database className="w-4 h-4" />,
      color: "from-indigo-500 to-indigo-600",
      glowColor: "rgba(99, 102, 241, 0.4)",
      angle: -Math.PI / 2 + (6 * (2 * Math.PI)) / 7,
      description: "Synchronize index pathways and historic vector session embeddings.",
      jpDescription: "過去の意思決定パスとセッション・ベクトル表現 of インデックス同期"
    }
  ], []);

  // Compute node coordinate positions on the 800x500 viewport
  const positionedNodes = useMemo(() => {
    return nodes.map(n => ({
      ...n,
      x: cx + rOffset * Math.cos(n.angle),
      y: cy + rOffset * Math.sin(n.angle)
    }));
  }, [nodes]);

  // Handle clicking the neural core to trigger dynamic bursts
  const triggerSynapticBurst = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Only trigger if click is relatively close to the center neural core
    const distToCenter = Math.sqrt(Math.pow(clickX - cx, 2) + Math.pow(clickY - cy, 2));
    if (distToCenter < 70) {
      const newBurst = {
        id: burstCounter,
        x: cx,
        y: cy
      };
      setSynapticBursts(prev => [...prev, newBurst]);
      setBurstCounter(prev => prev + 1);

      // Clean up burst after animation finishes
      setTimeout(() => {
        setSynapticBursts(prev => prev.filter(b => b.id !== newBurst.id));
      }, 1000);

      // Momentarily boost metrics!
      setMetrics(prev => ({
        ...prev,
        thinkingSpeed: Math.min(2200, prev.thinkingSpeed + 180),
        accuracy: Math.min(100, prev.accuracy + 0.3)
      }));
    }
  };

  // Real-time Thinking Mode and Log fluctuation
  useEffect(() => {
    const thinkingModesEn = [
      "Thinking", "Planning", "Reasoning", "Learning", "Researching", "Comparing", "Synthesizing"
    ];
    const thinkingModesJp = [
      "思考中", "計画中", "推論中", "学習中", "調査中", "比較中", "統合中"
    ];

    const thinkingLogsEn = [
      "Analyzing organizational risk postures...",
      "Synthesizing high-value SWOT deliverables...",
      "Evaluating financial ROI forecasts...",
      "Verifying structural task compliance (UQI)...",
      "Retrieving long-term vector synapses...",
      "Consolidating multiple cross-model debate pools...",
      "Aligning model weights with consensus parameters...",
      "Running semantic validation heuristics...",
      "Scanning legal precedent libraries...",
      "Compiling tactical execution blueprints...",
      "Balancing knowledge network node density..."
    ];

    const thinkingLogsJp = [
      "組織のリスク姿勢を分析中...",
      "高価値SWOT成果物の統合中...",
      "財務的なROI予測値を検証中...",
      "構造的タスク適合性（UQI）を検証中...",
      "長期的なベクトル・シナプスの呼び出し中...",
      "複数モデルによるクロス審議プールを統合中...",
      "モデルの重みパラメータと合意定義を調和中...",
      "セマンティック妥当性のヒューリスティックを走査中...",
      "法的判例・前提条件ライブラリを精査中...",
      "戦術的実行ブループリントを構築中...",
      "ナレッジネットワークのノード密度を平滑化中..."
    ];

    const thinkingModes = isEn ? thinkingModesEn : thinkingModesJp;
    const thinkingLogs = isEn ? thinkingLogsEn : thinkingLogsJp;

    let step = 0;
    const interval = setInterval(() => {
      step += 1;
      // Toggle thinking mode deterministically
      const nextMode = thinkingModes[step % thinkingModes.length];
      setThinkingMode(nextMode);

      // Fluctuate metrics realistically and deterministically using Math.sin/Math.cos waves
      setMetrics(prev => {
        const sin1 = Math.sin(step);
        const cos1 = Math.cos(step * 1.3);
        const sin2 = Math.sin(step * 2.1);
        
        const speedDelta = Math.floor(sin1 * 40);
        const accuracyDelta = parseFloat((cos1 * 0.04).toFixed(2));
        const contextDelta = sin2 > 0.7 ? 1 : (sin2 < -0.7 ? -1 : 0);
        const learningDelta = sin1 * 0.0001;

        return {
          thinkingSpeed: Math.min(1900, Math.max(950, prev.thinkingSpeed + speedDelta)),
          knowledgeDensity: parseFloat(Math.min(5.2, Math.max(4.4, prev.knowledgeDensity + cos1 * 0.008)).toFixed(2)),
          accuracy: parseFloat(Math.min(100, Math.max(97.8, prev.accuracy + accuracyDelta)).toFixed(2)),
          reasoningDepth: sin2 > 0.8 ? Math.min(10, Math.max(6, prev.reasoningDepth + 1)) : (sin2 < -0.8 ? Math.min(10, Math.max(6, prev.reasoningDepth - 1)) : prev.reasoningDepth),
          contextUsage: Math.min(100, Math.max(40, prev.contextUsage + contextDelta)),
          learningRate: parseFloat(Math.min(0.005, Math.max(0.001, prev.learningRate + learningDelta)).toFixed(4))
        };
      });

      // Fluctuate active agents deterministically
      setAgentPulses({
        gemini: (step % 2) === 0,
        claude: (step % 3) !== 0,
        openai: (step % 4) !== 1,
        perplexity: (step % 5) < 3,
        deepseek: (step % 7) > 2,
        qwen: (step % 8) === 3
      });

      // Add thinking log stream deterministically
      setActiveThoughts(prev => {
        const nextLog = thinkingLogs[step % thinkingLogs.length];
        const updated = [...prev, `[${nextMode.toUpperCase()}] ${nextLog}`];
        if (updated.length > 5) updated.shift();
        return updated;
      });
    }, 2800);

    return () => clearInterval(interval);
  }, [isEn]);

  return (
    <div className="space-y-6 w-full">
      {/* High-level system info bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-1 border-b border-slate-200/50 dark:border-white/[0.04] pb-4">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <div className="space-y-0.5">
            <h3 className="text-[11px] font-black text-slate-600 dark:text-neutral-400 uppercase tracking-widest font-mono flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
              {isEn ? "Organizational Neuralink Sphere (ACOS-Core)" : "組織内ニューラリンク・スフィア (ACOS-Core)"}
            </h3>
            <p className="text-[10px] text-slate-600 dark:text-neutral-400 font-semibold font-mono">STATUS: HIGH_FIDELITY_LIVE • SYNC_RATE: 100%</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[9.5px] font-mono font-bold text-indigo-700 dark:text-indigo-300 px-2.5 py-1 bg-indigo-500/5 dark:bg-indigo-500/15 border border-indigo-500/10 rounded-full flex items-center gap-1.5">
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span>{isEn ? "NEURAL CORE EFFICIENCY" : "神経コア伝達効率"}: {metrics.accuracy}%</span>
          </span>
        </div>
      </div>

      {/* Main glassmorphic layout panel split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* SVG Neural Interactive Arena (Takes 2 columns) */}
        <div className="lg:col-span-2 bg-[#08080C]/90 dark:bg-neutral-950/60 backdrop-blur-3xl border border-white/[0.06] rounded-3xl p-4 overflow-hidden shadow-2xl relative min-h-[510px] flex items-center justify-center group/arena">
          
          {/* Immersive background glow elements (Apple Vision Pro style) */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(99,102,241,0.08),transparent_50%)] pointer-events-none" />
          <div className="absolute -left-20 -top-20 w-80 h-80 bg-pink-500/5 rounded-full blur-[80px] pointer-events-none transition-transform duration-300 group-hover/arena:translate-x-5" />
          <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-indigo-500/5 rounded-full blur-[80px] pointer-events-none transition-transform duration-300 group-hover/arena:-translate-x-5" />

          {/* Core instructions helper label */}
          <div className="absolute top-4 left-4 z-10 bg-white/5 border border-white/[0.04] px-3 py-1.5 rounded-xl pointer-events-none">
            <p className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-indigo-400" />
              <span>{isEn ? "Click core or hover nodes to sync" : "コアをクリック、またはノードホバーで同期"}</span>
            </p>
          </div>

          {/* Real-time thinking tag */}
          <div className="absolute top-4 right-4 z-10">
            <span className="text-[9.5px] font-mono font-bold bg-pink-500/10 text-pink-400 border border-pink-500/20 px-2.5 py-1 rounded-full uppercase tracking-widest animate-pulse flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-pink-500" />
              {thinkingMode}...
            </span>
          </div>

          {/* SVG Graph Canvas */}
          <svg 
            viewBox="0 0 800 500" 
            className="w-full h-full max-w-2xl relative z-10 cursor-default select-none overflow-visible"
            onClick={triggerSynapticBurst}
          >
            {/* Defs for absolute gradients & styling */}
            <defs>
              <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#818cf8" stopOpacity="0.45" />
                <stop offset="60%" stopColor="#6366f1" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#4338ca" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="glowLine" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ec4899" stopOpacity="0.8" />
                <stop offset="50%" stopColor="#6366f1" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.8" />
              </linearGradient>
            </defs>

            {/* Neural connection line network (slow breathing lines) */}
            <g className="connections">
              {positionedNodes.map((node) => {
                const isHovered = hoveredNode === node.id;
                return (
                  <g key={`link-${node.id}`}>
                    {/* Glowing wider shadow line */}
                    <motion.line
                      x1={cx}
                      y1={cy}
                      x2={node.x}
                      y2={node.y}
                      stroke={isHovered ? "url(#glowLine)" : "rgba(99, 102, 241, 0.25)"}
                      strokeWidth={isHovered ? 3 : 1.2}
                      className="transition-all duration-300"
                      initial={{ opacity: 0.3 }}
                      animate={{ 
                        opacity: isHovered ? 0.9 : [0.3, 0.5, 0.3] }}
                      transition={{
                        opacity: { repeat: Infinity, duration: 4, ease: "easeInOut" }
                      }}
                    />

                    {/* Secondary mesh outer loop connections (Neuralink mesh effect) */}
                    {positionedNodes.map((otherNode, idx) => {
                      // Connect adjacent nodes
                      const otherIdx = (positionedNodes.indexOf(node) + 1) % positionedNodes.length;
                      if (positionedNodes[otherIdx].id === otherNode.id) {
                        return (
                          <motion.line
                            key={`adjacent-${node.id}-${otherNode.id}`}
                            x1={node.x}
                            y1={node.y}
                            x2={otherNode.x}
                            y2={otherNode.y}
                            stroke="rgba(99, 102, 241, 0.08)"
                            strokeWidth={0.8}
                            strokeDasharray="4 4"
                          />
                        );
                      }
                      return null;
                    })}

                    {/* Knowledge Flow (flowing light particles travelling along the lines) */}
                    <motion.circle
                      r={isHovered ? 5.5 : 3.5}
                      fill={isHovered ? "#ec4899" : "#818cf8"}
                      filter={isHovered ? "drop-shadow(0 0 8px #ec4899)" : "drop-shadow(0 0 5px #818cf8)"}
                      animate={{
                        cx: [cx, node.x],
                        cy: [cy, node.y],
                        opacity: [0, 0.9, 0.9, 0]
                      }}
                      transition={{
                        duration: isHovered ? 1.8 : (2.8 + ((nodes.indexOf(node) % 5) * 0.3)),
                        repeat: Infinity,
                        ease: "linear",
                        delay: nodes.indexOf(node) * 0.35
                      }}
                    />
                  </g>
                );
              })}
            </g>

            {/* Tap Cognitive Core Shockwave bursts */}
            <AnimatePresence>
              {synapticBursts.map((b) => (
                <motion.circle
                  key={b.id}
                  cx={b.x}
                  cy={b.y}
                  initial={{ r: 10, opacity: 0.8, strokeWidth: 2 }}
                  animate={{ r: 240, opacity: 0, strokeWidth: 0.5 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.2, ease: "easeOut" }}
                  stroke="url(#glowLine)"
                  fill="none"
                  className="pointer-events-none"
                />
              ))}
            </AnimatePresence>

            {/* Neural Center Core (The main nucleus) */}
            <g className="neural-core">
              {/* Outer massive ambient glow orb */}
              <circle cx={cx} cy={cy} r="100" fill="url(#coreGlow)" className="pointer-events-none" />

              {/* Breathing neon outline orbits */}
              <motion.circle
                cx={cx}
                cy={cy}
                r="45"
                fill="none"
                stroke="rgba(129, 140, 248, 0.3)"
                strokeWidth="1"
                animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0.6, 0.3] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              />

              <motion.circle
                cx={cx}
                cy={cy}
                r="55"
                fill="none"
                stroke="rgba(236, 72, 153, 0.2)"
                strokeWidth="0.8"
                strokeDasharray="6 12"
                animate={{ rotate: 360 }}
                transition={{ duration: 16, repeat: Infinity, ease: "linear" }}
              />

              {/* Central glowing core body */}
              <motion.circle
                cx={cx}
                cy={cy}
                r="30"
                className="fill-indigo-600/80 dark:fill-indigo-950/90 filter drop-shadow-[0_0_15px_rgba(99,102,241,0.6)] cursor-pointer"
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.93 }}
                animate={{
                  boxShadow: ["0 0 10px rgba(99,102,241,0.4)", "0 0 25px rgba(236,72,153,0.5)", "0 0 10px rgba(99,102,241,0.4)"]
                }}
              />

              {/* Innermost pulsing light center */}
              <motion.circle
                cx={cx}
                cy={cy}
                r="10"
                fill="#ffffff"
                filter="drop-shadow(0 0 10px #ffffff)"
                animate={{
                  scale: [1, 1.35, 1],
                  opacity: [0.7, 1, 0.7]
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
                className="pointer-events-none"
              />

              <motion.circle
                cx={cx}
                cy={cy}
                r="22"
                fill="none"
                stroke="#6366f1"
                strokeWidth="1.5"
                strokeDasharray="4 8"
                animate={{ rotate: -360 }}
                transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                className="pointer-events-none"
              />
            </g>

            {/* Circular surrounding nodes */}
            <g className="surrounding-nodes">
              {positionedNodes.map((node) => {
                const isHovered = hoveredNode === node.id;
                
                return (
                  <motion.g
                    key={node.id}
                    onMouseEnter={() => setHoveredNode(node.id)}
                    onMouseLeave={() => setHoveredNode(null)}
                    className="cursor-pointer"
                    initial={{ scale: 1 }}
                    animate={{ 
                      scale: isHovered ? 1.15 : [1, 1.04, 1],
                      y: isHovered ? -4 : 0
                    }}
                    transition={{
                      scale: isHovered 
                        ? { type: "spring", stiffness: 400, damping: 20 }
                        : { duration: 2.2 + ((positionedNodes.indexOf(node) % 4) * 0.25), repeat: Infinity, ease: "easeInOut" }
                    }}
                  >
                    {/* High-quality Glass node backing */}
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r="26"
                      fill="#0e0e12"
                      stroke={isHovered ? "#ffffff" : "rgba(255,255,255,0.08)"}
                      strokeWidth={isHovered ? 1.5 : 1}
                      filter={`drop-shadow(0 0 15px ${isHovered ? node.glowColor : 'rgba(0,0,0,0.5)'})`}
                      className="transition-colors duration-300"
                    />

                    {/* Gradient colored accent ring */}
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r="21"
                      fill="none"
                      stroke={isHovered ? "#6366f1" : "rgba(255,255,255,0.03)"}
                      strokeWidth="1"
                      className="transition-colors duration-300"
                    />

                    {/* Node Lucide Icon centered inside circle */}
                    <g transform={`translate(${node.x - 8}, ${node.y - 8})`} className="text-white/80">
                      <div className={cn(
                        "w-4 h-4 flex items-center justify-center transition-colors duration-300",
                        isHovered ? "text-pink-400" : "text-indigo-300"
                      )}>
                        {node.icon}
                      </div>
                    </g>

                    {/* Label Pair (English display + Japanese display according to isEn) */}
                    <text
                      x={node.x}
                      y={node.y + 42}
                      textAnchor="middle"
                      className={cn(
                        "text-[10px] font-mono tracking-wider font-black uppercase transition-colors duration-300",
                        isHovered ? "fill-white" : "fill-slate-400"
                      )}
                    >
                      {isEn ? node.label : node.jpLabel}
                    </text>

                    <text
                      x={node.x}
                      y={node.y + 53}
                      textAnchor="middle"
                      className="text-[8px] font-sans text-neutral-600 fill-slate-500 font-bold tracking-wide"
                    >
                      {isEn ? node.jpLabel : node.label}
                    </text>
                  </motion.g>
                );
              })}
            </g>
          </svg>

          {/* Interactive contextual description (Apple Vision Pro HUD vibe) */}
          <div className="absolute bottom-5 inset-x-5 text-center pointer-events-none">
            <AnimatePresence mode="wait">
              {hoveredNode ? (
                <motion.div
                  key={hoveredNode}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="bg-slate-900/90 border border-white/[0.08] p-3 rounded-2xl max-w-md mx-auto backdrop-blur-xl"
                >
                  <div className="flex items-center gap-2 justify-center">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                    <h4 className="text-[11px] font-black tracking-widest text-indigo-300 uppercase font-mono">
                      {isEn ? `${positionedNodes.find(n => n.id === hoveredNode)?.label} SPECIFICATION` : `${positionedNodes.find(n => n.id === hoveredNode)?.jpLabel} 仕様定義`}
                    </h4>
                  </div>
                  <p className="text-[10px] text-slate-300 font-semibold mt-1 font-sans">
                    {isEn 
                      ? positionedNodes.find(n => n.id === hoveredNode)?.description 
                      : positionedNodes.find(n => n.id === hoveredNode)?.jpDescription}
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="default"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.6 }}
                  className="text-[9.5px] font-mono text-slate-500 tracking-widest uppercase"
                >
                  {isEn 
                    ? "SYSTEM ENGAGED • HOVER SEGMENTS TO EXPLORE INTERNAL SPECIFICATIONS" 
                    : "システム起動中 • 各セグメントへのホバーで詳細な内部仕様を展開"}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Side Controls, Agents pulses & Live metrics panel */}
        <div className="space-y-6">
          
          {/* Section 1: Real-time Fluctuating Cognitive Analytics */}
          <div className="bg-white/80 dark:bg-neutral-900/40 backdrop-blur-md border border-slate-200/60 dark:border-white/[0.04] p-5 rounded-3xl space-y-4">
            <h4 className="text-[10px] font-black text-slate-600 dark:text-neutral-400 uppercase tracking-widest font-mono flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-pink-500 animate-bounce" />
              {isEn ? "Cognitive Performance Metrics" : "認知能力・パフォーマンス統計指標"}
            </h4>

            <div className="grid grid-cols-2 gap-4">
              
              {/* Thinking Speed */}
              <div className="bg-slate-50 dark:bg-neutral-950/40 p-3 rounded-2xl border border-slate-100 dark:border-white/[0.02]">
                <span className="text-[9px] font-bold text-slate-600 dark:text-neutral-400 uppercase tracking-wider font-mono">
                  {isEn ? "Thinking Speed" : "思考処理速度"}
                </span>
                <div className="text-sm font-black text-slate-800 dark:text-white mt-1 font-mono tracking-tight flex items-baseline gap-1">
                  {metrics.thinkingSpeed}
                  <span className="text-[8px] font-medium text-slate-600 dark:text-neutral-400 font-sans">T/S</span>
                </div>
              </div>

              {/* Knowledge Density */}
              <div className="bg-slate-50 dark:bg-neutral-950/40 p-3 rounded-2xl border border-slate-100 dark:border-white/[0.02]">
                <span className="text-[9px] font-bold text-slate-600 dark:text-neutral-400 uppercase tracking-wider font-mono">
                  {isEn ? "Knowledge DNA" : "知識DNA蓄積"}
                </span>
                <div className="text-sm font-black text-slate-800 dark:text-white mt-1 font-mono tracking-tight flex items-baseline gap-1">
                  {metrics.knowledgeDensity}
                  <span className="text-[8px] font-medium text-slate-600 dark:text-neutral-400 font-sans">GB</span>
                </div>
              </div>

              {/* Alignment / Accuracy */}
              <div className="bg-slate-50 dark:bg-neutral-950/40 p-3 rounded-2xl border border-slate-100 dark:border-white/[0.02]">
                <span className="text-[9px] font-bold text-slate-600 dark:text-neutral-400 uppercase tracking-wider font-mono">
                  {isEn ? "UQI Accuracy" : "UQI適合精度"}
                </span>
                <div className="text-sm font-black text-emerald-800 dark:text-emerald-400 mt-1 font-mono tracking-tight">
                  {metrics.accuracy}%
                </div>
              </div>

              {/* Reasoning depth */}
              <div className="bg-slate-50 dark:bg-neutral-950/40 p-3 rounded-2xl border border-slate-100 dark:border-white/[0.02]">
                <span className="text-[9px] font-bold text-slate-600 dark:text-neutral-400 uppercase tracking-wider font-mono">
                  {isEn ? "Reasoning Depth" : "推論処理深度"}
                </span>
                <div className="text-sm font-black text-indigo-800 dark:text-indigo-300 mt-1 font-mono tracking-tight flex items-baseline gap-1">
                  Lvl {metrics.reasoningDepth}
                  <span className="text-[8px] font-medium text-slate-600 dark:text-neutral-400 font-sans">Mesh</span>
                </div>
              </div>

              {/* Context window */}
              <div className="bg-slate-50 dark:bg-neutral-950/40 p-3 rounded-2xl border border-slate-100 dark:border-white/[0.02]">
                <span className="text-[9px] font-bold text-slate-600 dark:text-neutral-400 uppercase tracking-wider font-mono">
                  {isEn ? "Context Load" : "文脈リソース負荷"}
                </span>
                <div className="text-sm font-black text-slate-800 dark:text-white mt-1 font-mono tracking-tight flex items-baseline gap-1">
                  {metrics.contextUsage}%
                  <span className="text-[8px] font-medium text-slate-600 dark:text-neutral-400 font-sans">Active</span>
                </div>
              </div>

              {/* Learning Rate */}
              <div className="bg-slate-50 dark:bg-neutral-950/40 p-3 rounded-2xl border border-slate-100 dark:border-white/[0.02]">
                <span className="text-[9px] font-bold text-slate-600 dark:text-neutral-400 uppercase tracking-wider font-mono">
                  {isEn ? "Learning Rate" : "動的学習効率"}
                </span>
                <div className="text-sm font-black text-amber-800 dark:text-amber-400 mt-1 font-mono tracking-tight">
                  η={metrics.learningRate}
                </div>
              </div>

            </div>
          </div>

          {/* Section 2: Active AI Agent Ticker rail */}
          <div className="bg-white/80 dark:bg-neutral-900/40 backdrop-blur-md border border-slate-200/60 dark:border-white/[0.04] p-5 rounded-3xl space-y-3.5">
            <h4 className="text-[10px] font-black text-slate-600 dark:text-neutral-400 uppercase tracking-widest font-mono flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-indigo-500" />
              {isEn ? "Active Synapse Agents" : "アクティブ同期エージェント"}
            </h4>

            <div className="grid grid-cols-2 gap-2">
              {[
                { key: "gemini", name: "Gemini Flash", logo: "♊", desc: isEn ? "Parallel reasoning" : "高速並列推論" },
                { key: "claude", name: "Claude Sonnet", logo: "🍁", desc: isEn ? "High-quality code" : "高品質コード" },
                { key: "openai", name: "OpenAI GPT", logo: "🟢", desc: isEn ? "Global logic check" : "総合論理判定" },
                { key: "perplexity", name: "Perplexity", logo: "🔍", desc: isEn ? "Real-time search" : "リアルタイム検索" },
                { key: "deepseek", name: "DeepSeek-R1", logo: "🐳", desc: isEn ? "Math & reasoning" : "数理推論・Standby" },
                { key: "qwen", name: "Qwen Coder", logo: "🚀", desc: isEn ? "Tech & coding" : "技術コード・Standby" }
              ].map((ag) => {
                const isPulse = agentPulses[ag.key as keyof typeof agentPulses];
                return (
                  <div
                    key={ag.key}
                    className={cn(
                      "flex items-center gap-2 p-2 rounded-xl border select-none transition-all",
                      isPulse 
                        ? "bg-indigo-500/[0.03] border-indigo-500/25 dark:border-indigo-500/15" 
                        : "bg-transparent border-slate-100 dark:border-neutral-900"
                    )}
                  >
                    <div className="relative flex items-center justify-center w-7 h-7 bg-slate-100 dark:bg-neutral-900 border border-slate-200/60 dark:border-white/[0.05] rounded-lg text-sm font-sans">
                      {ag.logo}
                      {isPulse && (
                        <span className="absolute -top-1 -right-1 flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-pink-500"></span>
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9.5px] font-black text-slate-700 dark:text-neutral-300 truncate">{ag.name}</p>
                      <p className="text-[8px] text-slate-600 dark:text-neutral-400 truncate">{ag.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 3: Live AI Thinking Console logs (Raycast/Claude terminal style) */}
          <div className="bg-neutral-950 border border-white/[0.06] p-4 rounded-3xl space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-indigo-400">
                <Terminal className="w-4 h-4 animate-pulse" />
                <span className="font-bold text-[9.5px] font-mono uppercase tracking-widest">
                  {isEn ? "Cognitive Core Stream" : "認知コア・ストリームログ"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                <span className="text-[8.5px] font-mono text-slate-300 uppercase font-black">LOG_ACTIVE</span>
              </div>
            </div>

            {/* Live active logging console */}
            <div className="my-1 font-mono text-[9px] leading-relaxed text-slate-300 space-y-1.5 h-[100px] overflow-hidden flex flex-col justify-end">
              {activeThoughts.map((t, idx) => (
                <div key={idx} className="flex items-start gap-1.5 truncate">
                  <span className="text-pink-400 select-none shrink-0 font-bold">&gt;&gt;</span>
                  <span className={cn(
                    "truncate",
                    idx === activeThoughts.length - 1 ? "text-indigo-300 font-bold" : "text-slate-300"
                  )}>
                    {t}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between text-[7.5px] text-slate-300 font-mono border-t border-white/[0.04] pt-2">
              <span>THREAD_ID: OS-LIVE-NEURALINK</span>
              <span>Uptime: 2,410 pulses</span>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
