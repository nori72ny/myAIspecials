import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Brain, 
  BrainCircuit, 
  Cpu, 
  Database, 
  ShieldCheck, 
  Sparkles, 
  Zap, 
  Activity, 
  Layers, 
  Compass, 
  MessageSquare, 
  Code, 
  Gauge, 
  LineChart, 
  Sliders, 
  History, 
  CheckCircle, 
  AlertTriangle, 
  Play, 
  Pause, 
  RefreshCw,
  Search,
  ChevronRight,
  TrendingUp,
  Workflow
} from "lucide-react";

// Types
interface BrainLayer {
  id: number;
  name: string;
  jpName: string;
  description: string;
  icon: React.ComponentType<any>;
  status: "active" | "debating" | "idle" | "filtering";
  health: number;
  latency: number; // ms
  activeModels: string[];
  metrics: { label: string; value: string }[];
  details: string;
}

interface DebateMessage {
  id: string;
  sender: string;
  avatarColor: string;
  timestamp: string;
  content: string;
  agreementRate: number;
}

export default function BrainOverview() {
  const [activeLayerId, setActiveLayerId] = useState<number>(10); // Default to Master Brain
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [consensusThreshold, setConsensusThreshold] = useState<number>(90);
  const [cognitiveSpeed, setCognitiveSpeed] = useState<number>(85); // %
  const [selectedTopic, setSelectedTopic] = useState<string>("saas-architecture");
  const [neuralPulses, setNeuralPulses] = useState<number[]>([1, 2, 3]);
  const [totalThoughts, setTotalThoughts] = useState<number>(43810);
  const [lastBpiScore, setLastBpiScore] = useState<number>(98.2);

  // Auto-increment some realistic live values for immersion
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setTotalThoughts(prev => prev + Math.floor(Math.random() * 3) + 1);
      if (Math.random() > 0.8) {
        setLastBpiScore(prev => {
          const delta = (Math.random() - 0.5) * 0.4;
          return parseFloat(Math.min(100, Math.max(95, prev + delta)).toFixed(1));
        });
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Dynamic neural pulses animation
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setNeuralPulses(prev => {
        const next = [...prev];
        if (next.length > 5) next.shift();
        next.push(Date.now());
        return next;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Topics for Simulated Debate
  const topics = {
    "saas-architecture": {
      title: "SaaS Architecture Optimization on Multi-Region Kubernetes",
      messages: [
        {
          id: "m1",
          sender: "Perplexity Pro (Grounding Engine)",
          avatarColor: "bg-teal-500",
          timestamp: "02:04:15",
          content: "Web search confirms multi-region GKE with Anthos provides a 99.99% SLA, but inter-region database latency averages 65ms on Spanner.",
          agreementRate: 88
        },
        {
          id: "m2",
          sender: "Claude 3.5 Sonnet (System Design)",
          avatarColor: "bg-amber-500",
          timestamp: "02:04:18",
          content: "To combat the 65ms Spanner write latency, we should implement a regional write-through Redis Cache. Reads are served locally; writes are batched asynchronously.",
          agreementRate: 94
        },
        {
          id: "m3",
          sender: "Gemini 1.5 Pro (Master Mediator)",
          avatarColor: "bg-indigo-600",
          timestamp: "02:04:22",
          content: "Claude's Redis write-through approach is approved. It lowers local read-latency to <2ms. Layer 6 Quality Brain scores this architecture at 98.4 points. Proceeding to compilation.",
          agreementRate: 98
        }
      ]
    },
    "customer-conversion": {
      title: "Self-Adaptive UX and Pricing Strategy Optimization",
      messages: [
        {
          id: "c1",
          sender: "GPT-4o (User DNA Analytics)",
          avatarColor: "bg-emerald-500",
          timestamp: "02:05:01",
          content: "Historical logs indicate enterprise workspace prospects bounce 42% faster when direct credit card requests are present on registration.",
          agreementRate: 91
        },
        {
          id: "c2",
          sender: "Claude 3.5 Sonnet (Strategic Reasoning)",
          avatarColor: "bg-amber-500",
          timestamp: "02:05:05",
          content: "Let us remove the credit card gating entirely for high-tier professional email domains. Replace with a single-click SAML SSO setup to maximize friction-free signups.",
          agreementRate: 95
        },
        {
          id: "c3",
          sender: "Gemini 1.5 Pro (Master Mediator)",
          avatarColor: "bg-indigo-600",
          timestamp: "02:05:09",
          content: "SSO-only gating for high-tier professional domains is validated. Truth Brain confirms high-trust intent. Conversion lift is estimated at +18.4%. Formulating layout.",
          agreementRate: 97
        }
      ]
    },
    "code-generation": {
      title: "Microservices Security Sandbox Isolation",
      messages: [
        {
          id: "g1",
          sender: "DeepSeek Coder (Security Audit)",
          avatarColor: "bg-cyan-500",
          timestamp: "02:06:10",
          content: "We detected standard microservice configurations expose the metadata endpoint (169.254.169.254). This is susceptible to SSRF exploits.",
          agreementRate: 93
        },
        {
          id: "g2",
          sender: "Claude 3.5 Sonnet (Secure Refactoring)",
          avatarColor: "bg-amber-500",
          timestamp: "02:06:14",
          content: "We must inject an iptables policy into the Docker network manifest and override default service account IAM permissions to read-only roles.",
          agreementRate: 96
        },
        {
          id: "g3",
          sender: "Gemini 1.5 Pro (Master Mediator)",
          avatarColor: "bg-indigo-600",
          timestamp: "02:06:19",
          content: "Docker isolation policy generated. Truth Brain confirms zero vulnerable endpoints found post-injection. Quality score: 100/100. Deploying to Sandbox Environment.",
          agreementRate: 99
        }
      ]
    }
  };

  // 10 Layers definition
  const layers: BrainLayer[] = [
    {
      id: 10,
      name: "Master Brain",
      jpName: "司令部・マスターブレイン",
      description: "Orchestrates, routes, and monitors all nine layers. Manages API token caps, recovers from failures silently, and delivers absolute success.",
      icon: Brain,
      status: "active",
      health: 100,
      latency: 4,
      activeModels: ["Gemini 1.5 Pro", "GPT-4o"],
      metrics: [
        { label: "Routing Success Rate", value: "99.98%" },
        { label: "Orchestration Depth", value: "10-Layer Cross" },
        { label: "Failure Recovery", value: "Auto-Healing" }
      ],
      details: "Top-level controller. Directly delegates cognitive threads across sub-brains. Standardizes context window utilization and prevents redundant queries."
    },
    {
      id: 9,
      name: "Memory Brain",
      jpName: "記憶脳・メモリーブレイン",
      description: "Compiles user preferences, workspace context, approved UI stylings, and business goals into a persistent User DNA Schema.",
      icon: Database,
      status: "active",
      health: 98,
      latency: 12,
      activeModels: ["Pinecone Vector", "GCP Spanner"],
      metrics: [
        { label: "DNA Context Recall", value: "0.4ms" },
        { label: "Persistent States", value: "12,408 records" },
        { label: "User Alignment", value: "98.7%" }
      ],
      details: "Bypasses typical stateless boundaries of LLMs. Remembers that you prefer a high-contrast dark theme, spacious paddings, and strict modular structures."
    },
    {
      id: 8,
      name: "Future Brain",
      jpName: "未来予測脳・フューチャーブレイン",
      description: "Projects future strategic challenges, scalability pain-points, and proposes proactive upgrades based on current milestones.",
      icon: TrendingUp,
      status: "active",
      health: 95,
      latency: 45,
      activeModels: ["Gemini 1.5 Pro", "Grok 2.0"],
      metrics: [
        { label: "Prediction Horizon", value: "12 Months" },
        { label: "Hypothesis Testing", value: "Active" },
        { label: "Predictive Accuracy", value: "94.2%" }
      ],
      details: "Looks ahead of the current task. Suggests adding custom authentication modules when you build a database or plans out scaling strategies ahead of launch."
    },
    {
      id: 7,
      name: "Experience Brain",
      jpName: "体験脳・エクスペリエンスブレイン",
      description: "Packs rich database assets and text insights into responsive, gorgeous, interactive layouts (inverted pyramids, SVGs, charts).",
      icon: Compass,
      status: "active",
      health: 99,
      latency: 15,
      activeModels: ["Claude 3.5 Sonnet", "Tailwind Compiler"],
      metrics: [
        { label: "Component Rigor", value: "Pruned Responsive" },
        { label: "Visual Fidelity Score", value: "99.4%" },
        { label: "Render Overhead", value: "0ms CSS" }
      ],
      details: "Ensures no 'AI-slop' or telemetry numbers leak to outer margins. Formulates layout hierarchies that guide the user's focus seamlessly."
    },
    {
      id: 6,
      name: "Quality Brain",
      jpName: "品質脳・クオリティブメイン",
      description: "Scans output against Quality Bible (Q5) and strict rubrics. Rejects anything scoring under 95, redirecting to Excellence Loops.",
      icon: LineChart,
      status: "filtering",
      health: 100,
      latency: 28,
      activeModels: ["Self-Reflection Agent", "Linter API"],
      metrics: [
        { label: "Minimum Pass Score", value: "95 / 100" },
        { label: "Average Output Score", value: "99.1 points" },
        { label: "Rejections / Redos", value: "1.4% avg" }
      ],
      details: "The gatekeeper of excellence. If a generated snippet misses a closing tag or has an un-imported enum, Quality Brain silently forces a rewrite."
    },
    {
      id: 5,
      name: "Creation Brain",
      jpName: "制作脳・クリエイションブレイン",
      description: "Compiles blueprints into fully functioning React code, vector graphics, structured JSON schemas, and professional documents.",
      icon: Code,
      status: "idle",
      health: 97,
      latency: 120,
      activeModels: ["Claude 3.5 Sonnet", "DeepSeek Coder"],
      metrics: [
        { label: "Build Concurrency", value: "4 Modules" },
        { label: "Compiled Packages", value: "Standard ESM" },
        { label: "Lint Validation Rate", value: "100%" }
      ],
      details: "Takes raw text recommendations and transforms them into real physical entities. Writes files directly and compiles them cleanly inside the sandbox."
    },
    {
      id: 4,
      name: "Truth Brain",
      jpName: "真実脳・トゥルースブレイン",
      description: "Runs real-time multi-agent fact-checking, citations cross-checking, and consensus scoring to ensure zero hallucination.",
      icon: ShieldCheck,
      status: "active",
      health: 100,
      latency: 35,
      activeModels: ["Fact Check Engine", "Perplexity Grounding"],
      metrics: [
        { label: "Fact Check Bulwark", value: "Active" },
        { label: "Consensus Agreement", value: "94.2%" },
        { label: "Citation Veracity", value: "100.0%" }
      ],
      details: "Validates all figures, dates, calculations, and URLs. Maps annotations explicitly to verified official manuals and live-server queries."
    },
    {
      id: 3,
      name: "Reasoning Brain",
      jpName: "推論脳・リーズニングブレイン",
      description: "Conducts multi-LLM debate protocols. Resolves logical loopholes, extreme edge cases, and optimizes business models.",
      icon: MessageSquare,
      status: "debating",
      health: 99,
      latency: 80,
      activeModels: ["Claude 3.5 Sonnet", "GPT-4o", "Gemini 1.5 Pro"],
      metrics: [
        { label: "Debate Rounds", value: "3 Cycles" },
        { label: "Active Contenders", value: "3 Top LLMs" },
        { label: "Resolution Consensus", value: "96.4%" }
      ],
      details: "Facilitates internal competitive thinking. One agent proposes a plan, another tries to find logical holes, and the third synthesizes the solution."
    },
    {
      id: 2,
      name: "Knowledge Brain",
      jpName: "知識脳・ナレッジブレイン",
      description: "Retrieves internal files, Google Maps location data, real-time Google search indices, and API specs.",
      icon: Search,
      status: "active",
      health: 100,
      latency: 18,
      activeModels: ["Google Search", "Vector Store"],
      metrics: [
        { label: "Indexed Records", value: "4.8M Nodes" },
        { label: "Grounding Latency", value: "12ms" },
        { label: "API Schema Matches", value: "99.8%" }
      ],
      details: "Feeds fresh, highly contextual data into reasoning pipelines. Eliminates stale data limitations typical in isolated AI weights."
    },
    {
      id: 1,
      name: "Intent Brain",
      jpName: "目的理解脳・インテントブレイン",
      description: "Translates human commands into high-level business goals, task DAGs, and implicit requirements.",
      icon: Sparkles,
      status: "active",
      health: 100,
      latency: 8,
      activeModels: ["Gemini 1.5 Flash", "GPT-4o Mini"],
      metrics: [
        { label: "Latent Goal Parsing", value: "Active" },
        { label: "Task Decomposition", value: "Auto DAG" },
        { label: "Intent Parsing Accuracy", value: "98.9%" }
      ],
      details: "Reconstructs ambiguous text commands into high-fidelity structured specifications. Bypasses simple literal keywords to find underlying goals."
    }
  ];

  const currentActiveLayer = layers.find(l => l.id === activeLayerId) || layers[0];
  const activeTopic = topics[selectedTopic as keyof typeof topics];

  return (
    <div className="flex flex-col h-full w-full bg-[#08080C] text-slate-100 font-sans rounded-3xl overflow-hidden border border-white/[0.06] shadow-2xl relative">
      {/* Background Ambience */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-1/4 w-[400px] h-[400px] bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header Panel */}
      <div className="p-6 border-b border-white/[0.06] flex flex-col sm:flex-row justify-between items-start sm:items-center bg-black/40 gap-4 backdrop-blur-md relative z-10">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/10 border border-white/10">
              <BrainCircuit className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
                ACOS 2.0 Unified Cognitive Brain
              </h2>
              <p className="text-[11px] font-medium font-mono text-indigo-400 uppercase tracking-widest mt-0.5">
                Multi-Agent Cognitive Engine & Neural Synaptic Grid
              </p>
            </div>
          </div>
        </div>
        
        {/* Status Indicators */}
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsPlaying(!isPlaying)}
            className={`p-2 rounded-xl border border-white/[0.08] hover:border-white/20 transition-all ${isPlaying ? "bg-white/5 text-emerald-400" : "bg-black/20 text-slate-400"}`}
            title={isPlaying ? "Pause neural simulations" : "Resume neural simulations"}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-xs font-mono font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping"></span>
            BPI: {lastBpiScore}%
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-xs font-mono font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            NEURAL GRID ACTIVE
          </div>
        </div>
      </div>

      {/* Main Panel Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 relative z-10">
        
        {/* TOP COGNITIVE STATS SECTION */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white/[0.02] border border-white/[0.04] p-4 rounded-2xl flex flex-col justify-between hover:bg-white/[0.03] transition-colors relative group">
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
              <span>Synaptic Throughput</span>
              <Zap className="w-4 h-4 text-amber-400" />
            </div>
            <div className="mt-2.5">
              <span className="text-2xl font-black text-white font-mono">14.8 GB/s</span>
              <p className="text-[10px] text-slate-500 mt-1 font-mono">Real-time vector streams</p>
            </div>
          </div>

          <div className="bg-white/[0.02] border border-white/[0.04] p-4 rounded-2xl flex flex-col justify-between hover:bg-white/[0.03] transition-colors relative group">
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
              <span>Cognitive Pulse Load</span>
              <Gauge className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="mt-2.5">
              <span className="text-2xl font-black text-white font-mono">{cognitiveSpeed}%</span>
              <div className="w-full bg-white/10 h-1.5 rounded-full mt-2 overflow-hidden">
                <div 
                  className="bg-indigo-500 h-full rounded-full transition-all duration-1000"
                  style={{ width: `${cognitiveSpeed}%` }}
                />
              </div>
            </div>
          </div>

          <div className="bg-white/[0.02] border border-white/[0.04] p-4 rounded-2xl flex flex-col justify-between hover:bg-white/[0.03] transition-colors relative group">
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
              <span>Consensus Rate</span>
              <Activity className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="mt-2.5">
              <span className="text-2xl font-black text-white font-mono">94.2%</span>
              <p className="text-[10px] text-emerald-400 mt-1 font-bold font-mono">✓ High Agreement Level</p>
            </div>
          </div>

          <div className="bg-white/[0.02] border border-white/[0.04] p-4 rounded-2xl flex flex-col justify-between hover:bg-white/[0.03] transition-colors relative group">
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
              <span>Total Thoughts Run</span>
              <Layers className="w-4 h-4 text-pink-400" />
            </div>
            <div className="mt-2.5">
              <span className="text-2xl font-black text-white font-mono">{totalThoughts.toLocaleString()}</span>
              <p className="text-[10px] text-slate-500 mt-1 font-mono">Across 10 logical layers</p>
            </div>
          </div>
        </div>

        {/* DOUBLE COLUMN ARCHITECTURAL MAIN SECTION */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* LEFT: THE 10 NEURAL LAYERS ENGINE MAP (8 COLS) */}
          <div className="lg:col-span-7 bg-white/[0.02] border border-white/[0.04] rounded-3xl p-5 sm:p-6 space-y-5 relative">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Layers className="w-4.5 h-4.5 text-indigo-400" />
                  10-Layer Cognitive Architecture Map
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Click layers to inspect current thread routing, active models, and real-time operational diagnostics
                </p>
              </div>
              <Sliders className="w-4 h-4 text-slate-500" />
            </div>

            {/* Neural Map Stack */}
            <div className="space-y-1.5 relative">
              {/* Dynamic Connecting Neural Synaptic Flow Line */}
              <div className="absolute left-6 top-6 bottom-6 w-0.5 bg-gradient-to-b from-indigo-500/20 via-purple-500/25 to-pink-500/20 pointer-events-none -z-10" />
              
              {/* Animated pulses going down the spine */}
              {isPlaying && neuralPulses.map((pulse, idx) => (
                <motion.div
                  key={pulse}
                  initial={{ y: "0%", opacity: 0.8 }}
                  animate={{ y: "90%", opacity: 0 }}
                  transition={{ duration: 4, repeat: Infinity, ease: "linear", delay: idx * 1.3 }}
                  className="absolute left-[23px] w-2 h-2 rounded-full bg-gradient-to-r from-cyan-400 to-indigo-500 blur-xs pointer-events-none -z-10"
                />
              ))}

              {layers.map((layer) => {
                const isActive = layer.id === activeLayerId;
                const statusColors = {
                  active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
                  debating: "bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse",
                  idle: "bg-slate-500/10 text-slate-400 border-slate-500/20",
                  filtering: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20"
                };

                return (
                  <button
                    key={layer.id}
                    onClick={() => setActiveLayerId(layer.id)}
                    className={`w-full text-left flex items-center justify-between p-3 rounded-2xl transition-all duration-300 relative group cursor-pointer ${
                      isActive 
                        ? "bg-gradient-to-r from-indigo-950/40 to-purple-950/10 border border-indigo-500/30 shadow-lg shadow-indigo-950/20 scale-[1.01]" 
                        : "bg-black/10 hover:bg-white/[0.02] border border-white/[0.03] hover:border-white/[0.08]"
                    }`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      {/* Node Circle with Layer Number */}
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border transition-colors ${
                        isActive 
                          ? "bg-indigo-600 text-white border-white/20" 
                          : "bg-white/[0.02] text-slate-400 border-white/[0.04] group-hover:border-white/[0.08] group-hover:text-slate-200"
                      }`}>
                        <span className="text-[10px] font-black font-mono">L{layer.id}</span>
                      </div>

                      {/* Icon */}
                      <div className={`p-2 rounded-lg shrink-0 ${isActive ? "text-indigo-400" : "text-slate-400"}`}>
                        <layer.icon className="w-4.5 h-4.5" />
                      </div>

                      {/* Info text */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors">{layer.name}</span>
                          <span className="text-[10px] text-slate-500 font-medium font-mono hidden sm:inline">{layer.jpName}</span>
                        </div>
                        <p className="text-xs text-slate-400 truncate mt-0.5 pr-2">{layer.description}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Active Status Badge */}
                      <span className={`text-[9px] font-bold font-mono px-2 py-0.5 rounded-full border hidden sm:inline uppercase tracking-wider ${statusColors[layer.status]}`}>
                        {layer.status}
                      </span>
                      <ChevronRight className={`w-4 h-4 text-slate-500 group-hover:text-slate-300 transition-all ${isActive ? "translate-x-0.5 text-indigo-400" : ""}`} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* RIGHT: LAYER DETAIL INSPECTOR + LIVE DEBATE (5 COLS) */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* ACTIVE LAYER DETAILS / TELEMETRY INSPECTOR */}
            <div className="bg-white/[0.02] border border-white/[0.04] rounded-3xl p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-3 border-b border-white/[0.06] pb-3.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                  <currentActiveLayer.icon className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-black text-indigo-400">LAYER {currentActiveLayer.id}</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  </div>
                  <h4 className="text-md font-bold text-white">{currentActiveLayer.name}</h4>
                </div>
              </div>

              {/* Description & Detailed mechanics */}
              <div className="space-y-3">
                <p className="text-xs text-slate-300 leading-relaxed bg-white/[0.02] p-3.5 rounded-2xl border border-white/[0.04]">
                  {currentActiveLayer.details}
                </p>
                
                {/* Active Models */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-wider">Assigned AI Engines:</span>
                  {currentActiveLayer.activeModels.map((model, idx) => (
                    <span key={idx} className="text-[10px] font-bold font-mono px-2 py-1 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                      {model}
                    </span>
                  ))}
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-white/[0.06]">
                {currentActiveLayer.metrics.map((metric, idx) => (
                  <div key={idx} className="bg-black/25 border border-white/[0.03] p-2.5 rounded-xl text-center">
                    <span className="text-[9px] font-mono text-slate-400 block truncate">{metric.label}</span>
                    <span className="text-xs font-black text-white font-mono block mt-1">{metric.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* LIVE AI DEBATE ARENA SIMULATION */}
            <div className="bg-white/[0.02] border border-white/[0.04] rounded-3xl p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-3.5">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-amber-400" />
                    Layer 3: Live Debate Arena
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-0.5">Consensus building across leading AI weights</p>
                </div>

                {/* Topic Select */}
                <select 
                  value={selectedTopic} 
                  onChange={(e) => setSelectedTopic(e.target.value)}
                  className="bg-black border border-white/[0.08] text-[11px] rounded-lg px-2 py-1 text-slate-300 font-medium focus:outline-none focus:border-indigo-500"
                >
                  <option value="saas-architecture">Kubernetes Arch</option>
                  <option value="customer-conversion">Conversion Opt</option>
                  <option value="code-generation">Sandbox Security</option>
                </select>
              </div>

              {/* Current Topic Indicator */}
              <div className="bg-amber-500/5 border border-amber-500/10 p-2.5 rounded-xl text-xs flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-amber-500 rounded-full shrink-0"></span>
                <span className="text-amber-300 font-semibold truncate">Target: {activeTopic.title}</span>
              </div>

              {/* Debate Feed */}
              <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1">
                {activeTopic.messages.map((msg) => (
                  <div key={msg.id} className="bg-black/35 border border-white/[0.03] p-3 rounded-2xl space-y-1.5 hover:border-white/[0.08] transition-all">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${msg.avatarColor}`} />
                        <span className="text-[11px] font-black text-white">{msg.sender}</span>
                      </div>
                      <span className="text-[9px] font-mono text-slate-500">{msg.timestamp}</span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed font-sans">{msg.content}</p>
                    <div className="flex justify-between items-center pt-1 border-t border-white/[0.03]">
                      <span className="text-[9px] text-slate-500 font-mono font-bold">Consensus Index</span>
                      <span className="text-[10px] font-bold font-mono text-emerald-400">{msg.agreementRate}% Match</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Consolidator Agreement Rate Slider */}
              <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Consensus Threshold</span>
                  <span className="text-amber-400 font-black">{consensusThreshold}%</span>
                </div>
                <input
                  type="range"
                  min="75"
                  max="98"
                  value={consensusThreshold}
                  onChange={(e) => setConsensusThreshold(parseInt(e.target.value))}
                  className="w-full accent-amber-500 bg-white/10 h-1 rounded-lg cursor-pointer"
                />
                <p className="text-[9px] text-slate-500 leading-normal">
                  Threshold of minimum token semantic agreement before compiling unified response. Higher values limit speed but maximize factual precision.
                </p>
              </div>
            </div>

          </div>

        </div>

        {/* NEURAL SYSTEM DIAGNOSTICS & TUNING PANEL */}
        <div className="bg-white/[0.02] border border-white/[0.04] rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-white/[0.06] pb-3.5">
            <Sliders className="w-4.5 h-4.5 text-indigo-400" />
            <h3 className="text-sm font-bold text-white">Quantum Engine Diagnostics & Custom Calibration</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono text-indigo-400 font-bold uppercase tracking-widest block">Cognitive Speed Tuner</span>
              <p className="text-xs text-slate-400 leading-normal">Adjust CPU throttling and memory alignment matrix.</p>
              <div className="flex items-center gap-3 pt-1">
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={cognitiveSpeed}
                  onChange={(e) => setCognitiveSpeed(parseInt(e.target.value))}
                  className="flex-1 accent-indigo-500 bg-white/10 h-1 rounded-lg cursor-pointer"
                />
                <span className="text-xs font-bold font-mono text-indigo-300 w-8 text-right">{cognitiveSpeed}%</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-[10px] font-mono text-purple-400 font-bold uppercase tracking-widest block">Memory Horizon Overfit</span>
              <p className="text-xs text-slate-400 leading-normal">Set temporal weighting for User DNA schema persistence.</p>
              <div className="flex items-center gap-3 pt-1">
                <span className="text-[10px] px-2 py-1 rounded bg-purple-500/10 text-purple-300 font-mono border border-purple-500/20">Short-term Only</span>
                <span className="text-slate-500">→</span>
                <span className="text-[10px] px-2 py-1 rounded bg-purple-500/20 text-purple-400 font-bold font-mono border border-purple-500/30">Complete DNA Match</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase tracking-widest block">Self-Healing Protocols</span>
              <p className="text-xs text-slate-400 leading-normal">Allows the Master Brain to rebuild broken structures silently.</p>
              <div className="flex items-center gap-2 pt-1.5">
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                <span className="text-xs font-bold font-mono text-emerald-400">ACTIVE &bull; 0 TIMEOUT FAILS DETECTED</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Footer Statement */}
      <div className="px-6 py-3 border-t border-white/[0.06] bg-black/60 flex items-center justify-between text-[10px] font-mono text-slate-500 relative z-10">
        <div>COGNITIVE MATRIX v2.0.4 &bull; INTEL ARCH SECURE</div>
        <div className="flex items-center gap-1">
          <span>COGNITIVE HEALTH LOG:</span>
          <span className="text-emerald-400 font-bold">100% EXCELLENCE GRADE</span>
        </div>
      </div>
    </div>
  );
}
