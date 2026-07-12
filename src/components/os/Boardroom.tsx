import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Cpu, 
  Terminal, 
  Activity, 
  Layers, 
  Compass, 
  HelpCircle, 
  TrendingUp, 
  Bot, 
  Database, 
  Shield, 
  Zap, 
  CheckCircle2, 
  Play, 
  Pause, 
  ZapOff,
  Sparkles,
  RefreshCw,
  Clock,
  Coins
} from "lucide-react";
import { cn } from "../../utils";
import { 
  SovereignGlassCard,
  SovereignButton,
  SovereignInput,
  SovereignBadge,
  SovereignDialog,
  SovereignSidebar,
  SovereignPanel,
  SovereignSegmentedControl
} from "../SovereignComponents";
import LiveMissionPipelineView from "../trust-and-quality/LiveMissionPipelineView";

// Interface for AI Agents
interface BoardroomAgent {
  id: string;
  name: string;
  logo: string;
  color: string;
  glowColor: string;
  angle: number; // For circular network rendering
}

export default function Boardroom({ onComplete, missionTitle }: { onComplete?: () => void, missionTitle?: string }) {
  // Get language from localStorage settings
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

  // Debate control state
  const [isPlaying, setIsPlaying] = useState(true);
  const [debateSpeed, setDebateSpeed] = useState<"normal" | "fast" | "hyper">("normal");

  // Dynamic AI statuses
  const [agentStatuses, setAgentStatuses] = useState<Record<string, string>>({
    gemini: isEn ? "Thinking" : "思考中",
    claude: isEn ? "Reasoning" : "推論中",
    openai: isEn ? "Fact Checking" : "ファクトチェック",
    perplexity: isEn ? "Researching" : "調査中",
    deepseek: isEn ? "Comparing" : "比較中",
    qwen: isEn ? "Synthesizing" : "統合中"
  });

  // Current perspectives displayed when clicking on an AI node
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  // Fluctuating Bottom Panel Metrics
  const [metrics, setMetrics] = useState({
    consensusScore: 91.4,
    confidence: 96.2,
    uqi: 94.8,
    roi: 245.0,
    risk: 12.4,
    accuracy: 98.6,
    tokenUsage: 312500,
    reasoningDepth: 12
  });

  // Real-time flowing console logs
  const [logs, setLogs] = useState<string[]>(
    isEn
      ? [
          "Initializing High-Fidelity Boardroom Matrix...",
          "Synchronizing multi-agent routing sockets...",
          "ACOS-Core: Fetching latest SWOT vectors...",
          "Consensus Engine initialized on thread #9"
        ]
      : [
          "高精度審議ボードルーム・マトリクスを起動中...",
          "マルチエージェント・ルーティングソケットを同期中...",
          "ACOSコア: 最新のSWOTベクトルを読み込んでいます...",
          "スレッド #9 にて合意エンジンが初期化されました"
        ]
  );

  // Right-panel Phase progress states (0 to 100)
  const [phaseProgress, setPhaseProgress] = useState({
    planning: 45,
    research: 32,
    debate: 15,
    factCheck: 8,
    quality: 5,
    output: 0
  });

  // Selected AI's current debate statement simulation
  const agentPerspectives = useMemo(() => ({
    gemini: isEn ? [
      "I recommend utilizing a dual-stage execution model to bypass standard token latency limits.",
      "Parsing semantic overlaps in the user's domain. Let's optimize for maximum parallel output.",
      "The ROI projection can be enhanced by about 12.4% if we route low-level items to sub-threads."
    ] : [
      "標準のトークン遅延限界をバイパスするために、2段階の実行モデルを使用することを推奨します。",
      "ユーザーのドメインでのセマンティックな重なりを解析しています。並列出力を最大化させましょう。",
      "低レベルなタスクをサブスレッドにルーティングすれば、ROIの予測値を約12.4%向上させることが可能です。"
    ],
    claude: isEn ? [
      "We must enforce strict compliance with Rule #4 (UQI) and not compromise on the code correctness.",
      "Analyzing the structural integrity of the requested deliverables. Applying robust type contracts.",
      "My reasoning depth suggests a slight bottleneck in the memory network layer. Rectifying schema paths now."
    ] : [
      "ルール#4（UQI）との厳格な適合を強制し、コードの正確さにおいて決して妥協すべきではありません。",
      "要求された成果物の構造的整合性を分析しています。堅牢な型規約を適用します。",
      "私の推論深度によれば、メモリネットワークレイヤーにわずかなボトルネックが検出されました。スキーマパスを修復中です。"
    ],
    openai: isEn ? [
      "Analyzing high-level risk audit trails. Financial projections look highly favorable, confidence index: 96.2%.",
      "Fact-checking the core claims with our unified cross-reference databases.",
      "I have finalized the primary consensus parameters. Let's initiate the next deliberation phase."
    ] : [
      "高度なリスク監査証跡を分析中。財務予測は非常に良好、信頼性インデックスは96.2%です。",
      "統合された相互参照データベースを用いて、コアとなる主張のファクトチェックを行っています。",
      "プライマリの合意パラメータを確定させました。次の審議フェーズを開始しましょう。"
    ],
    perplexity: isEn ? [
      "Freshness score is high. Retrieved 24 new papers and competitor pricing datasets from the web.",
      "Scanning latest market reports for GEO (Generative Engine Optimization) trends.",
      "No overlapping trademarks detected in the proposed system scope."
    ] : [
      "情報の鮮度スコアは極めて高値。ウェブから競合価格データセットと最新論文24報を収集しました。",
      "GEO（生成エンジン最適化）トレンドに関する最新の市場レポートをスキャンしています。",
      "提案されたシステムスコープにおいて、重複する商標や特許は検知されませんでした。"
    ],
    deepseek: isEn ? [
      "Let us formulate this task as a mathematically proven constraint satisfaction problem.",
      "Re-weighting current debate parameters. The consensus gradient is settling at 0.942.",
      "Simulating 1,000 parallel monte-carlo runs on the ROI outcomes."
    ] : [
      "この課題を数学的に実証可能な制約充足問題として定式化しましょう。",
      "現在の審議パラメータを再重み付け中。合意勾配は0.942に収束しつつあります。",
      "ROI結果に対して1,000回の並列モンテカルロ・シミュレーションを実行中。"
    ],
    qwen: isEn ? [
      "I am translating the parsed architecture into scalable technical system blueprints.",
      "Double-checking code snippets against world-class performance optimization presets.",
      "Formatting the final outcome files with elegant, error-free TypeScript structures."
    ] : [
      "解析されたアーキテクチャをスケーラブルな技術システム設計図に変換しています。",
      "世界最高峰のパフォーマンス最適化プリセットに対して、コードスニペットをダブルチェックしています。",
      "完成した成果物ファイルを、エラーのない洗練されたTypeScript構造にフォーマット中です。"
    ]
  }), [isEn]);

  // Set circular coordinates for neural net rendering
  const cx = 350;
  const cy = 200;
  const rOffset = 130;

  const agents: BoardroomAgent[] = useMemo(() => [
    { id: "gemini", name: "Gemini Pro", logo: "♊", color: "from-blue-500 to-indigo-600", glowColor: "rgba(59, 130, 246, 0.4)", angle: -Math.PI / 2 },
    { id: "claude", name: "Claude Sonnet", logo: "🍁", color: "from-amber-400 to-amber-600", glowColor: "rgba(245, 158, 11, 0.4)", angle: -Math.PI / 2 + (2 * Math.PI) / 6 },
    { id: "openai", name: "GPT-4o", logo: "🟢", color: "from-emerald-400 to-emerald-600", glowColor: "rgba(16, 185, 129, 0.4)", angle: -Math.PI / 2 + (2 * (2 * Math.PI)) / 6 },
    { id: "perplexity", name: "Perplexity", logo: "🔍", color: "from-blue-500 to-indigo-500", glowColor: "rgba(59, 130, 246, 0.4)", angle: -Math.PI / 2 + (3 * (2 * Math.PI)) / 6 },
    { id: "deepseek", name: "DeepSeek-R1", logo: "🐳", color: "from-indigo-500 to-indigo-600", glowColor: "rgba(99, 102, 241, 0.4)", angle: -Math.PI / 2 + (4 * (2 * Math.PI)) / 6 },
    { id: "qwen", name: "Qwen Coder", logo: "🚀", color: "from-pink-500 to-pink-600", glowColor: "rgba(236, 72, 153, 0.4)", angle: -Math.PI / 2 + (5 * (2 * Math.PI)) / 6 }
  ], []);

  // Neural net secondary nodes
  const coreNodes = useMemo(() => [
    { id: "neural-core", label: isEn ? "Neural Core" : "神経コア", x: cx, y: cy, color: "rgba(99, 102, 241, 0.8)" },
    { id: "consensus", label: isEn ? "Consensus Engine" : "合意エンジン", x: cx - 60, y: cy + 90, color: "rgba(236, 72, 153, 0.8)" },
    { id: "memory", label: isEn ? "Knowledge Memory" : "知識メモリ", x: cx + 60, y: cy + 90, color: "rgba(20, 184, 166, 0.8)" }
  ], [isEn, cx, cy]);

  // Dynamic status triggers & logging stream
  useEffect(() => {
    if (!isPlaying) return;

    const intervalTime = debateSpeed === "hyper" ? 600 : debateSpeed === "fast" ? 1500 : 2500;

    const possibleStatuses = isEn
      ? ["Thinking", "Researching", "Reasoning", "Comparing", "Synthesizing", "Fact Checking", "Debating", "Verifying Code"]
      : ["思考中", "調査中", "推論中", "比較検証中", "統合中", "事実検証中", "審議中", "コード検証中"];

    const possibleLogs = isEn
      ? [
          "Comparing competitive price dynamics...",
          "Analyzing legal compliance templates...",
          "Resolving logical conflicts via debate matrix...",
          "Analyzing potential hallucination vectors...",
          "Syncing with cloud Spanner databases...",
          "Extracting semantic embeddings for deliverables...",
          "UQI Gate: Compliance validation level set to 95%...",
          "Optimizing cost models based on token footprint...",
          "Assembling robust ROI projections...",
          "Consensus Engine: Harmonizing multi-agent outputs...",
          "Updating knowledge DNA graphs..."
        ]
      : [
          "競合価格のダイナミクスを比較中...",
          "法的事実・適合性テンプレートを分析中...",
          "審議マトリクスによる論理的衝突の解決中...",
          "潜在的なハルシネーション領域の分析中...",
          "クラウドSpannerデータベースと同期中...",
          "成果物用セマンティック・エンベディングの抽出中...",
          "UQIゲート: 品質適合レベルを95%以上に設定中...",
          "トークン消費量に基づくコスト構造最適化中...",
          "信頼性の高いROI予測値を組み立て中...",
          "合意エンジン: マルチエージェント出力を調和中...",
          "知識DNAグラフをアップデート中..."
        ];

    const interval = setInterval(() => {
      // Fluctuate statuses
      setAgentStatuses(prev => {
        const next = { ...prev };
        const keys = Object.keys(next);
        const randomKey = keys[Math.floor(Math.random() * keys.length)];
        next[randomKey] = possibleStatuses[Math.floor(Math.random() * possibleStatuses.length)];
        return next;
      });

      // Stream logs
      setLogs(prev => {
        const nextLog = possibleLogs[Math.floor(Math.random() * possibleLogs.length)];
        const agentName = agents[Math.floor(Math.random() * agents.length)].name;
        const formattedLog = `[${agentName}] ${nextLog}`;
        const updated = [...prev, formattedLog];
        if (updated.length > 8) updated.shift();
        return updated;
      });

      // Fluctuate metrics
      setMetrics(prev => {
        const speedMultiplier = debateSpeed === "hyper" ? 3 : debateSpeed === "fast" ? 1.8 : 1;
        return {
          consensusScore: parseFloat(Math.min(99.8, Math.max(88.0, prev.consensusScore + (Math.random() - 0.4) * 0.4)).toFixed(1)),
          confidence: parseFloat(Math.min(100, Math.max(92.0, prev.confidence + (Math.random() - 0.3) * 0.3)).toFixed(1)),
          uqi: parseFloat(Math.min(99.5, Math.max(93.0, prev.uqi + (Math.random() - 0.4) * 0.2)).toFixed(1)),
          roi: parseFloat(Math.min(450, Math.max(180, prev.roi + (Math.random() - 0.48) * 4.5)).toFixed(1)),
          risk: parseFloat(Math.min(30, Math.max(2.1, prev.risk + (Math.random() - 0.52) * 0.8)).toFixed(1)),
          accuracy: parseFloat(Math.min(100, Math.max(96.5, prev.accuracy + (Math.random() - 0.35) * 0.15)).toFixed(1)),
          tokenUsage: prev.tokenUsage + Math.floor(Math.random() * 850 * speedMultiplier),
          reasoningDepth: Math.random() > 0.8 ? Math.min(24, Math.max(8, prev.reasoningDepth + (Math.random() > 0.5 ? 1 : -1))) : prev.reasoningDepth
        };
      });

      // Progress Phase progress bars
      setPhaseProgress(prev => {
        const rate = debateSpeed === "hyper" ? 4.5 : debateSpeed === "fast" ? 2.5 : 1.2;
        let newPlanning = Math.min(100, prev.planning + Math.random() * 0.5 * rate);
        let newResearch = prev.planning > 60 ? Math.min(100, prev.research + Math.random() * 0.8 * rate) : prev.research;
        let newDebate = prev.research > 50 ? Math.min(100, prev.debate + Math.random() * 0.9 * rate) : prev.debate;
        let newFactCheck = prev.debate > 45 ? Math.min(100, prev.factCheck + Math.random() * 0.7 * rate) : prev.factCheck;
        let newQuality = prev.factCheck > 50 ? Math.min(100, prev.quality + Math.random() * 0.6 * rate) : prev.quality;
        let newOutput = prev.quality > 40 ? Math.min(100, prev.output + Math.random() * 0.5 * rate) : prev.output;

        // Note: Automatic simulation completion is removed in favor of the Mission Approval Human-in-the-Loop Gate.
        // The LiveMissionPipelineView will trigger the onComplete callback when the user clicks "Authorize & Complete Mission".

        return {
          planning: parseFloat(newPlanning.toFixed(1)),
          research: parseFloat(newResearch.toFixed(1)),
          debate: parseFloat(newDebate.toFixed(1)),
          factCheck: parseFloat(newFactCheck.toFixed(1)),
          quality: parseFloat(newQuality.toFixed(1)),
          output: parseFloat(newOutput.toFixed(1))
        };
      });

    }, intervalTime);

    return () => clearInterval(interval);
  }, [isPlaying, debateSpeed, onComplete, agents, isEn]);

  return (
    <div data-testid="boardroom-screen" className="bg-[#030306]/98 text-white min-h-[640px] border border-white/[0.06] rounded-3xl p-6 overflow-hidden relative shadow-2xl font-sans flex flex-col justify-between"> {/* design-token-lock-ignore */}
      
      {/* Background cinematic visuals (Apple Vision Pro style) */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(99,102,241,0.06),transparent_60%)] pointer-events-none" />
      <div className="absolute -left-20 -top-20 w-[400px] h-[400px] bg-indigo-600/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute -right-20 -bottom-20 w-[400px] h-[400px] bg-pink-500/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Top Header Row with controls */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-white/[0.04] pb-4 z-10 relative">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 border border-indigo-400/20 rounded-full text-[10px] font-bold text-indigo-300 uppercase tracking-widest font-mono">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
            <span>{isEn ? "Multi-Agent Executive Boardroom" : "マルチエージェント・エグゼクティブ審議会"}</span>
          </div>
          <h2 className="text-xl font-black tracking-tight bg-gradient-to-r from-white via-indigo-100 to-indigo-300 bg-clip-text text-transparent">
            {missionTitle || (isEn ? "Autonomous Business Intelligence Matrix" : "自律型ビジネス・インテリジェンス・マトリクス")}
          </h2>
        </div>

        {/* Speed & Pause/Play Control Panels */}
        <div className="flex items-center gap-2.5 bg-neutral-900/80 border border-white/[0.05] p-1.5 rounded-2xl backdrop-blur-xl">
          <SovereignButton 
            onClick={() => setIsPlaying(!isPlaying)}
            variant={isPlaying ? "primary" : "secondary"}
            size="sm"
            className="p-2"
            title={isPlaying ? (isEn ? "Pause debate simulation" : "審議シミュレーションを一時停止") : (isEn ? "Play debate simulation" : "審議シミュレーションを開始")}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </SovereignButton>

          <div className="flex border-l border-white/5 pl-2 gap-1 font-mono text-[9px] font-bold">
            {[
              { id: "normal", label: "1x" },
              { id: "fast", label: "2x" },
              { id: "hyper", label: "HYPER" }
            ].map((sp) => (
              <SovereignButton
                key={sp.id}
                onClick={() => setDebateSpeed(sp.id as any)}
                variant={debateSpeed === sp.id ? "primary" : "secondary"}
                size="sm"
                className="px-2 py-1 text-[9px]"
              >
                {sp.label}
              </SovereignButton>
            ))}
          </div>

          {onComplete && (
            <SovereignButton
              onClick={onComplete}
              variant="primary"
              size="sm"
              className="px-3 py-1 text-[10px] bg-emerald-600 hover:bg-emerald-700 font-mono shrink-0 ml-1 flex items-center gap-1"
            >
              <CheckCircle2 className="w-3 h-3" />
              <span>{isEn ? "DELIVER" : "成果物を保存"}</span>
            </SovereignButton>
          )}
        </div>
      </div>

      {/* Main Grid View */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 my-6 flex-1 min-h-0 relative z-10">

        {/* Column 1: AI Agents list & Continuous stream (Left) */}
        <div className="lg:col-span-1 space-y-4 flex flex-col h-full">
          
          {/* Active Agents list */}
          <div className="bg-neutral-900/40 border border-white/[0.04] p-4 rounded-2xl space-y-3.5 flex-1 min-h-[220px]">
            <h3 className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5 text-indigo-400" />
              {isEn ? "Intelligence Board" : "審議メンバー / Board"}
            </h3>

            <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
              {agents.map((ag) => {
                const status = agentStatuses[ag.id] || "Thinking";
                const isSelected = selectedAgentId === ag.id;

                return (
                  <div
                    key={ag.id}
                    onClick={() => setSelectedAgentId(isSelected ? null : ag.id)}
                    className={cn(
                      "flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-all",
                      isSelected
                        ? "bg-indigo-500/10 border-indigo-400/40"
                        : "bg-[#0b0c10]/40 border-white/[0.02] hover:border-white/[0.06]" // design-token-lock-ignore
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center text-sm font-sans bg-neutral-950 border border-white/[0.06]",
                        isPlaying && "animate-pulse"
                      )}>
                        {ag.logo}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10.5px] font-bold text-white truncate">{ag.name}</p>
                        <p className="text-[8px] text-indigo-300 font-mono tracking-wide uppercase font-black">
                          {status}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Real-time debate logging terminal console */}
          <div className="bg-neutral-950 border border-white/[0.05] p-3.5 rounded-2xl h-[170px] flex flex-col justify-between">
            <div className="flex items-center justify-between border-b border-white/[0.03] pb-1.5">
              <span className="font-mono text-[9px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-1">
                <Terminal className="w-3 h-3 animate-spin" />
                <span>{isEn ? "Live Stream logs" : "リアルタイム審議ログ"}</span>
              </span>
              <span className="text-[7.5px] font-mono text-slate-500 uppercase">SYS_ACTIVE</span>
            </div>

            <div className="my-1.5 font-mono text-[8.5px] leading-relaxed text-slate-400 space-y-1 flex-1 overflow-hidden flex flex-col justify-end">
              {logs.map((log, idx) => (
                <div key={idx} className="flex items-start gap-1 truncate">
                  <span className="text-pink-400 select-none">&gt;&gt;</span>
                  <span className={cn(
                    "truncate",
                    idx === logs.length - 1 ? "text-indigo-200 font-bold" : "text-slate-500"
                  )}>
                    {log}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Column 2 & 3: Large Central Neural Network visualization (Center) */}
        <div className="lg:col-span-2 bg-neutral-950/40 border border-white/[0.04] rounded-2xl p-4 overflow-hidden shadow-inner relative flex items-center justify-center min-h-[380px]">
          
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(99,102,241,0.06),transparent_60%)] pointer-events-none" />

          {/* SVG Animated Neural Net Mesh */}
          <svg viewBox="0 0 700 400" className="w-full h-full max-w-xl relative z-10 select-none overflow-visible">
            <defs>
              <radialGradient id="matrixGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#818cf8" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="linkStream" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ec4899" stopOpacity="0.9" />
                <stop offset="50%" stopColor="#6366f1" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.9" />
              </linearGradient>
            </defs>

            {/* Neural Connections (SVG lines with slow glowing keyframes) */}
            <g className="synapse-connections">
              {agents.map((agent) => {
                const ax = cx + rOffset * Math.cos(agent.angle);
                const ay = cy + rOffset * Math.sin(agent.angle);

                return (
                  <g key={`link-${agent.id}`}>
                    {/* Glowing wide base line */}
                    <motion.line
                      x1={cx}
                      y1={cy}
                      x2={ax}
                      y2={ay}
                      stroke="rgba(99, 102, 241, 0.2)"
                      strokeWidth={1.5}
                      animate={{ 
                        opacity: isPlaying ? [0.2, 0.45, 0.2] : 0.25,
                      }}
                      transition={{
                        opacity: { repeat: Infinity, duration: 3, ease: "easeInOut" }
                      }}
                    />

                    {/* Stream flow particle circles running through connections */}
                    <motion.circle
                      r="4"
                      fill={selectedAgentId === agent.id ? "#ec4899" : "#6366f1"}
                      filter="drop-shadow(0 0 6px #6366f1)"
                      animate={{
                        cx: [cx, ax],
                        cy: [cy, ay],
                        opacity: [0, 0.9, 0.9, 0]
                      }}
                      transition={{
                        duration: 1.8 + Math.random() * 1.2,
                        repeat: Infinity,
                        ease: "linear",
                        delay: agents.indexOf(agent) * 0.3
                      }}
                    />

                    {/* Secondary inter-agent connectivity grid */}
                    {agents.map((other, oIdx) => {
                      const nextIdx = (agents.indexOf(agent) + 1) % agents.length;
                      if (agents[nextIdx].id === other.id) {
                        const ox = cx + rOffset * Math.cos(other.angle);
                        const oy = cy + rOffset * Math.sin(other.angle);

                        return (
                          <motion.line
                            key={`adj-${agent.id}-${other.id}`}
                            x1={ax}
                            y1={ay}
                            x2={ox}
                            y2={oy}
                            stroke="rgba(236, 72, 153, 0.08)"
                            strokeWidth={0.8}
                          />
                        );
                      }
                      return null;
                    })}
                  </g>
                );
              })}
            </g>

            {/* Inner primary Core system */}
            <g className="primary-subsystems">
              {coreNodes.map((n) => (
                <g key={n.id}>
                  <circle cx={n.x} cy={n.y} r="45" fill="url(#matrixGlow)" className="pointer-events-none" />

                  {/* Pulsing ring outline */}
                  <motion.circle
                    cx={n.x}
                    cy={n.y}
                    r={n.id === "neural-core" ? 22 : 16}
                    fill="none"
                    stroke={n.color}
                    strokeWidth="1.2"
                    animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.7, 0.3] }}
                    transition={{ duration: n.id === "neural-core" ? 2.5 : 4, repeat: Infinity, ease: "easeInOut" }}
                  />

                  {/* Inner physical body */}
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.id === "neural-core" ? 14 : 10}
                    fill="#0e0e13"
                    stroke={n.color}
                    strokeWidth="2"
                    filter="drop-shadow(0 0 10px rgba(99,102,241,0.5))"
                  />

                  <text
                    x={n.x}
                    y={n.y + 34}
                    textAnchor="middle"
                    className="text-[8px] font-mono tracking-widest fill-slate-400 font-bold uppercase"
                  >
                    {n.label}
                  </text>
                </g>
              ))}
            </g>

            {/* Orbiting individual agent nodes */}
            <g className="agent-orbitals">
              {agents.map((agent) => {
                const ax = cx + rOffset * Math.cos(agent.angle);
                const ay = cy + rOffset * Math.sin(agent.angle);
                const isSelected = selectedAgentId === agent.id;

                return (
                  <motion.g
                    key={agent.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedAgentId(isSelected ? null : agent.id)}
                    whileHover={{ scale: 1.15 }}
                    animate={{
                      y: isSelected ? -4 : 0
                    }}
                  >
                    <circle
                      cx={ax}
                      cy={ay}
                      r="18"
                      fill="#0e0e12"
                      stroke={isSelected ? "#ffffff" : "rgba(255,255,255,0.06)"}
                      strokeWidth={isSelected ? 1.5 : 1}
                      filter={`drop-shadow(0 0 8px ${isSelected ? agent.glowColor : 'rgba(0,0,0,0.5)'})`}
                    />

                    {/* Centered Logo text */}
                    <text
                      x={ax}
                      y={ay + 4}
                      textAnchor="middle"
                      className="text-xs fill-white select-none pointer-events-none"
                    >
                      {agent.logo}
                    </text>

                    {/* Short name indicator tag */}
                    <text
                      x={ax}
                      y={ay + 26}
                      textAnchor="middle"
                      className={cn(
                        "text-[7px] font-mono font-bold tracking-widest uppercase transition-colors",
                        isSelected ? "fill-pink-400" : "fill-slate-500"
                      )}
                    >
                      {agent.name.split(" ")[0]}
                    </text>
                  </motion.g>
                );
              })}
            </g>
          </svg>

          {/* Dialogue overlay: Clicking an agent reveals its active thought snippet */}
          <AnimatePresence mode="wait">
            {selectedAgentId && (
              <motion.div
                key={selectedAgentId}
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12, scale: 0.96 }}
                className="absolute inset-x-4 bottom-4 bg-[#0a0a0f]/95 border border-indigo-500/25 p-3.5 rounded-2xl backdrop-blur-xl z-20 flex gap-3 items-start" // design-token-lock-ignore
              >
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-400/20 flex items-center justify-center text-lg shrink-0">
                  {agents.find(a => a.id === selectedAgentId)?.logo}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-[10.5px] font-black text-indigo-300 font-mono tracking-wider uppercase">
                      {agents.find(a => a.id === selectedAgentId)?.name} {isEn ? "Perspicacity" : "見解・洞察"}
                    </h4>
                    <span className="text-[8px] bg-pink-500/10 text-pink-400 px-1.5 py-0.5 rounded font-mono font-black animate-pulse">
                      {isEn ? "DELIBERATING" : "審議中"}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-200 mt-1 leading-relaxed font-sans">
                    &quot;{agentPerspectives[selectedAgentId as keyof typeof agentPerspectives][
                      Math.floor(metrics.tokenUsage / 4000) % 3
                    ]}&quot;
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Column 4: ACOS Live Mission Pipeline (Right) */}
        <div className="lg:col-span-1 flex flex-col justify-between max-h-[580px] overflow-y-auto pr-1">
          <LiveMissionPipelineView mode="live" phaseProgress={phaseProgress} onComplete={onComplete} />
        </div>

      </div>

      {/* Bottom Panel: Global Consensus Metrics */}
      <div className="bg-[#0b0c10]/80 border border-white/[0.05] p-4 rounded-2xl backdrop-blur-3xl z-10 relative"> {/* design-token-lock-ignore */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
          {[
            { label: isEn ? "Consensus" : "合意スコア", val: `${metrics.consensusScore}%`, icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> },
            { label: isEn ? "Confidence" : "信頼性インデックス", val: `${metrics.confidence}%`, icon: <Shield className="w-3.5 h-3.5 text-indigo-400" /> },
            { label: isEn ? "UQI Gate" : "UQI適合度", val: `${metrics.uqi}%`, icon: <Sparkles className="w-3.5 h-3.5 text-pink-400" /> },
            { label: isEn ? "Est. ROI" : "想定利益率 / ROI", val: `${metrics.roi}%`, icon: <TrendingUp className="w-3.5 h-3.5 text-amber-400" /> },
            { label: isEn ? "Risk Factor" : "リスク要因", val: `${metrics.risk}%`, icon: <Activity className="w-3.5 h-3.5 text-rose-400" /> },
            { label: isEn ? "Accuracy" : "総合精度", val: `${metrics.accuracy}%`, icon: <Compass className="w-3.5 h-3.5 text-cyan-400" /> },
            { label: isEn ? "Token Usage" : "消費トークン量", val: metrics.tokenUsage.toLocaleString(), icon: <Coins className="w-3.5 h-3.5 text-slate-400" /> },
            { label: isEn ? "Reasoning Depth" : "推論深度", val: `Lvl ${metrics.reasoningDepth}`, icon: <Cpu className="w-3.5 h-3.5 text-indigo-400" /> }
          ].map((m, index) => (
            <div key={index} className="flex flex-col gap-1 border-r border-white/5 last:border-0 pr-2">
              <div className="flex items-center gap-1.5 text-slate-400">
                {m.icon}
                <span className="text-[8.5px] font-bold uppercase tracking-wider font-mono">{m.label}</span>
              </div>
              <div className="text-[12px] font-black tracking-tight text-white font-mono">
                {m.val}
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
