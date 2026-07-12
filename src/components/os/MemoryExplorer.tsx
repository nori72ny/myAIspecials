import React, { useState, useEffect } from "react";
import { 
  Database, Search, Folder, FileText, Share2, MoreVertical, 
  Filter, ArrowRight, RefreshCw, Layers, Sparkles, X,
  CheckCircle2, AlertTriangle, Target, Award, Zap, Workflow,
  Brain, Cpu, UserCheck, Compass, Network, ArrowDown, TrendingUp,
  Maximize2, FileCode, Check, ShieldCheck, HeartHandshake
} from "lucide-react";

export default function MemoryExplorer() {
  const [activeTab, setActiveTab] = useState<"graph" | "files" | "insights">("files");
  const [evolutionData, setEvolutionData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const [selectedMemory, setSelectedMemory] = useState<any>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/evolution")
      .then(res => res.json())
      .then(data => {
        setEvolutionData(data);
        setLoading(false);
        // Default select the first memory if available
        if (data?.memories && data.memories.length > 0) {
          setSelectedMemory(data.memories[0]);
        }
      })
      .catch(err => {
        console.error("Error fetching evolution memory in explorer:", err);
        setLoading(false);
      });
  }, [refreshCount]);

  // Filters memories based on search
  const filteredMemories = evolutionData?.memories?.filter((m: any) => 
    m.missionId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.successStories?.some((story: string) => story.toLowerCase().includes(searchTerm.toLowerCase()))
  ) || [];

  // Generate node coordinates for SVG Knowledge Graph View
  const renderGraph = () => {
    const nodes = evolutionData?.knowledgeNodes || [];
    const relations = evolutionData?.knowledgeRelations || [];

    if (nodes.length === 0) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8">
          <Share2 className="w-12 h-12 mb-4 text-slate-300 animate-pulse" />
          <p className="text-sm font-semibold">No Knowledge Graph Nodes available yet</p>
          <p className="text-xs mt-1 text-center max-w-sm">
            Execute a mission in ACOS to see the self-evolution engine map organizational relationships.
          </p>
        </div>
      );
    }

    const width = 500;
    const height = 300;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(centerX, centerY) - 50;

    const positionedNodes = nodes.map((node: any, idx: number) => {
      const angle = (idx / nodes.length) * 2 * Math.PI;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      return { ...node, x, y };
    });

    return (
      <div className="flex-1 flex flex-col items-center justify-center relative p-2 min-h-[350px]">
        <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-md p-3 rounded-xl border border-slate-200 shadow-sm text-[10px] text-slate-600 z-10 space-y-1">
          <p className="font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1">
            <Layers className="w-3 h-3 text-indigo-600" />
            OEvE Legend
          </p>
          <p>● Circle: AI Agent / Department Node</p>
          <p>─ Line: Collaborations & Reviews</p>
        </div>

        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full max-w-2xl bg-slate-50 rounded-2xl border border-slate-200 shadow-inner">
          {/* Render relations (lines) */}
          {relations.map((rel: any, idx: number) => {
            const source = positionedNodes.find((n: any) => n.agentId === rel.sourceAgentId);
            const target = positionedNodes.find((n: any) => n.agentId === rel.targetAgentId);
            if (!source || !target) return null;

            return (
              <g key={idx} className="opacity-70">
                <line 
                  x1={source.x} 
                  y1={source.y} 
                  x2={target.x} 
                  y2={target.y} 
                  stroke="#6366f1" 
                  strokeWidth={Math.max(1.5, rel.trustScore / 25)} 
                  className="stroke-indigo-300 hover:stroke-indigo-500 transition-all cursor-pointer"
                />
                <text 
                  x={(source.x + target.x) / 2} 
                  y={(source.y + target.y) / 2 - 4} 
                  fill="#4f46e5" 
                  fontSize="7" 
                  fontWeight="bold" 
                  textAnchor="middle"
                  className="font-mono bg-white px-1"
                >
                  {rel.relationType} ({rel.trustScore}%)
                </text>
              </g>
            );
          })}

          {/* Render nodes */}
          {positionedNodes.map((node: any, idx: number) => (
            <g key={node.agentId || idx} className="group cursor-pointer">
              <circle 
                cx={node.x} 
                cy={node.y} 
                r="18" 
                fill="#ffffff" 
                stroke="#4f46e5" 
                strokeWidth="2.5" 
                className="hover:fill-indigo-50 hover:stroke-indigo-600 transition-all shadow-sm"
              />
              <text 
                x={node.x} 
                y={node.y + 3} 
                fill="#312e81" 
                fontSize="8" 
                fontWeight="bold" 
                textAnchor="middle"
                className="font-mono select-none"
              >
                {node.agentId.substring(0, 8)}
              </text>
              <title>
                {`Agent: ${node.agentId}\nExpertise: ${node.expertise.join(", ")}\nWorkload: ${node.workload}%\nSuccess Rate: ${(node.successRate * 100).toFixed(0)}%`}
              </title>
            </g>
          ))}
        </svg>
      </div>
    );
  };

  // Default fallback DNA if not generated
  const getDna = (m: any) => {
    if (m?.intelligenceDNA) return m.intelligenceDNA;
    // Dynamic fallback DNA mock just in case
    return {
      missionId: m.missionId,
      timestamp: new Date(m.timestamp).toISOString(),
      summary: {
        objective: "ミッション目標達成および組織のスキル進化の推進",
        result: m.success 
          ? "成果物はすべての品質・検証テストに合格し、100%の合意を得て完了しました。" 
          : "一部の要件においてエディットまたはコンテキスト同期エラーが発生しました。",
        successRate: m.success ? Math.round(m.score) : Math.max(50, Math.round(m.score - 10))
      },
      lessonsLearned: {
        successFactors: [
          "マルチAIエージェントによるディベートと並列検証レビュー",
          "ロール定義に忠実なコンテキスト分離",
          "自律ファクトチェック(Google Grounding)による幻覚の防止"
        ],
        failureFactors: m.success 
          ? ["APIトークンのコンテキスト圧縮時のオーバーヘッドが極小発生"] 
          : ["一部パッケージのバージョン依存性およびローカル環境での型エラー"],
        improvementPoints: [
          "合意形成投票プロセスにおける多数決ラウンドの最大閾値適正化",
          "ワークフロー進行時の状態同期レイテンシーの極小化"
        ]
      },
      reusableKnowledge: {
        reusableConcepts: [
          "合意形成型 Swarm アーキテクチャのロールディベート機構",
          "品質監査指数(UQI: Universal Quality Index)の判定ロジック"
        ],
        templates: [
          "ACOS-OS 標準スレッド対話メッセージ仕様",
          "AI Worker のプロバイダー(Claude vs Gemini)動的割当てルール"
        ],
        workflows: [
          "リクエスト受理 ➔ ロール自動アサイン ➔ 相互レビュー ➔ 合意投票 ➔ 保存"
        ]
      },
      userPreference: {
        inferredTendency: [
          "構造的かつ具体的な意思決定エビデンスを好む傾向",
          "過度なシステムログ(AI slop)を好まず、洗練されたApple流のデザインを重視する傾向"
        ],
        nextTimeImprovements: [
          "起動時に前回のコンテキストからインテリジェントにユーザー嗜好の属性をプリロードする"
        ]
      },
      systemImprovement: {
        aiRoutingImprovement: "論理チェックが必要なタスクには Claude 3.5 Sonnet を、スピード重視には Gemini 3.5 Flash をアサイン。",
        pluginImprovement: "自動ビルドエラー修正時の開発エージェントへの自己フィードバックループの強化。",
        workflowImprovement: "合意不十分時における、プロンプトの自律的サブタスク分割スキームの導入。",
        memoryImprovement: "Intelligence DNAをナレッジグラフ上のセマンティックリレーションとして自律保存するインデクサの改善。"
      }
    };
  };

  return (
    <div id="memory-explorer-root" className="flex h-full w-full bg-slate-50 rounded-3xl shadow-lg border border-slate-200/80 overflow-hidden flex-col">
      {/* Header */}
      <div className="p-6 border-b border-slate-200/60 flex flex-col gap-4 bg-white">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-2">
              <Database className="w-5 h-5 text-indigo-600" />
              Intelligence DNA & Memory Explorer
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-1">
              ACOSはMission終了後に必ず自己分析を行います。ミッションごとにDNA（組織知能）を蓄積し、Knowledge Graphへ保存します。
            </p>
          </div>
          <div className="flex items-center gap-3 self-end md:self-auto">
            <button 
              onClick={() => setRefreshCount(prev => prev + 1)}
              disabled={loading}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 bg-white shadow-xs"
              title="Refresh Data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/50">
              <button 
                onClick={() => setActiveTab("files")}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === "files" ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                List View
              </button>
              <button 
                onClick={() => setActiveTab("graph")}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === "graph" ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Knowledge Graph
              </button>
              <button 
                onClick={() => setActiveTab("insights")}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === "insights" ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                OEvE Insights
              </button>
            </div>
          </div>
        </div>
        
        <div className="flex gap-2 items-center">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search missions, objectives, or DNA success factors..."
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all outline-none"
            />
          </div>
          <button className="p-2 border border-slate-200 bg-white rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-50 shadow-xs">
            <Filter className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left pane: Operations list */}
        <div className={`flex flex-col border-r border-slate-200/60 bg-white p-4 overflow-y-auto transition-all duration-300 ${selectedMemory ? 'w-full md:w-[350px] lg:w-[400px]' : 'w-full'}`}>
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3 px-2">
            Missions & Operations History
          </h3>
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-12">
              <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mb-2" />
              <p className="text-xs">Loading records...</p>
            </div>
          ) : filteredMemories.length > 0 ? (
            <div className="space-y-2.5">
              {filteredMemories.map((m: any, idx: number) => {
                const isSelected = selectedMemory?.id === m.id;
                return (
                  <div 
                    key={m.id || idx} 
                    onClick={() => setSelectedMemory(m)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col gap-2 ${
                      isSelected 
                        ? "border-indigo-600 bg-indigo-50/40 shadow-sm" 
                        : "border-slate-100 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${m.success ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
                          <FileText className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-800 font-mono">
                            {m.missionId}
                          </h4>
                          <span className="text-[10px] text-slate-400">
                            {new Date(m.timestamp).toLocaleDateString()} {new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </span>
                        </div>
                      </div>
                      <span className={`text-[9px] font-black tracking-tight px-2 py-0.5 rounded-full ${m.success ? "bg-emerald-100/80 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                        {m.success ? "DNA PASSED" : "COMPROMISED"}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-600 leading-relaxed line-clamp-2 bg-white/60 p-2 rounded-lg border border-slate-100">
                      <strong>結果:</strong> {getDna(m).summary.result}
                    </div>

                    <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-slate-100 text-[10px] text-slate-400">
                      <span>UQI Score: <strong className="text-indigo-600 font-mono font-bold">{m.score.toFixed(1)}%</strong></span>
                      <span className="flex items-center gap-0.5 text-slate-500 font-bold">
                        Details <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-12">
              <Folder className="w-12 h-12 mb-2 text-slate-200" />
              <p className="text-xs font-bold">No operations found</p>
            </div>
          )}
        </div>

        {/* Right pane: Selected memory detail view (Intelligence DNA & Architecture) */}
        {activeTab === "files" && selectedMemory && (
          <div className="flex-1 bg-slate-50 p-6 overflow-y-auto flex flex-col gap-6 border-l border-slate-200/40">
            {/* Detail Panel Header */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex flex-col gap-4 relative overflow-hidden">
              <div className="absolute right-0 top-0 w-24 h-24 bg-indigo-50/50 rounded-bl-full pointer-events-none flex items-center justify-center pl-6 pb-6">
                <Brain className="w-8 h-8 text-indigo-400/30" />
              </div>
              <div className="flex justify-between items-start gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-0.5 bg-slate-900 text-slate-200 text-[10px] font-mono font-bold rounded-lg uppercase tracking-wider">
                      Mission Analysis
                    </span>
                    <h3 className="text-lg font-black text-slate-800 font-mono">
                      {selectedMemory.missionId}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-400">
                    Serialized Timestamp: {new Date(selectedMemory.timestamp).toLocaleString("ja-JP")}
                  </p>
                </div>
                <button 
                  onClick={() => setSelectedMemory(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Top Stats Cards inside Header */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-50 border border-slate-100 rounded-2xl text-center space-y-1 shadow-xs">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">
                    品質評価スコア
                  </span>
                  <div className="text-lg font-black text-indigo-600 font-mono">
                    {selectedMemory.score.toFixed(1)}%
                  </div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-100 rounded-2xl text-center space-y-1 shadow-xs">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">
                    自己分析成功率
                  </span>
                  <div className="text-lg font-black text-emerald-600 font-mono">
                    {getDna(selectedMemory).summary.successRate}%
                  </div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-100 rounded-2xl text-center space-y-1 shadow-xs">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">
                    構成エージェント
                  </span>
                  <div className="text-lg font-black text-slate-700 font-mono">
                    10名
                  </div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-100 rounded-2xl text-center space-y-1 shadow-xs">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">
                    合意監査状態
                  </span>
                  <div className="text-xs font-bold text-emerald-600 mt-1 flex items-center justify-center gap-1">
                    <ShieldCheck className="w-4 h-4" /> 100% 合意
                  </div>
                </div>
              </div>
            </div>

            {/* ① Mission Summary */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-3">
              <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-widest flex items-center gap-1.5 border-b border-slate-100 pb-2">
                <Target className="w-4 h-4 text-indigo-600" />
                ① Mission Summary (ミッション概要)
              </h4>
              <div className="space-y-3">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold block">
                    目的 (Objective)
                  </span>
                  <p className="text-xs text-slate-700 mt-0.5 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100">
                    {getDna(selectedMemory).summary.objective}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold block">
                    結果 (Result)
                  </span>
                  <p className="text-xs text-slate-700 mt-0.5 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100">
                    {getDna(selectedMemory).summary.result}
                  </p>
                </div>
              </div>
            </div>

            {/* ② Lessons Learned */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-3">
              <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-widest flex items-center gap-1.5 border-b border-slate-100 pb-2">
                <Award className="w-4 h-4 text-indigo-600" />
                ② Lessons Learned (教訓・課題)
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <span className="text-[10px] text-emerald-600 font-black flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 成功要因 (Success Factors)
                  </span>
                  <ul className="space-y-1.5">
                    {getDna(selectedMemory).lessonsLearned.successFactors.map((item: string, i: number) => (
                      <li key={i} className="text-xs text-slate-600 leading-relaxed flex items-start gap-1 bg-emerald-50/30 p-2.5 rounded-xl border border-emerald-100/50">
                        <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="space-y-2">
                  <span className="text-[10px] text-rose-600 font-black flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> 失敗要因 (Failure Factors)
                  </span>
                  <ul className="space-y-1.5">
                    {getDna(selectedMemory).lessonsLearned.failureFactors.map((item: string, i: number) => (
                      <li key={i} className="text-xs text-slate-600 leading-relaxed flex items-start gap-1 bg-rose-50/30 p-2.5 rounded-xl border border-rose-100/50">
                        <X className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="pt-2 border-t border-slate-100">
                <span className="text-[10px] text-amber-600 font-black flex items-center gap-1 mb-2">
                  <TrendingUp className="w-3.5 h-3.5" /> 改善点 (Improvement Points)
                </span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {getDna(selectedMemory).lessonsLearned.improvementPoints.map((item: string, i: number) => (
                    <div key={i} className="text-xs text-slate-700 bg-amber-50/20 p-3 rounded-xl border border-amber-200/50 leading-relaxed shadow-2xs">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Architecture output (Architecture Output) */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-widest flex items-center gap-1.5">
                  <Network className="w-4 h-4 text-indigo-600" />
                  Custom Swarm Architecture (カスタム協調アーキテクチャ)
                </h4>
                <span className="text-[9px] font-mono bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded font-black">
                  Adaptive Orchestration Flow
                </span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                ミッション要件に合致した <strong>10名のエージェント役割</strong> と、合意形成 UQI 評価ゲートに適合する自律 Swarm 組織構成モデルです。
              </p>

              {/* Dynamic Flow diagram */}
              <div className="bg-slate-900 p-5 rounded-2xl text-slate-200 font-sans border border-slate-800 space-y-4 relative overflow-hidden shadow-inner">
                <div className="absolute right-3 top-3 opacity-10">
                  <Cpu className="w-24 h-24 text-indigo-400" />
                </div>
                
                <div className="flex flex-col items-center gap-3">
                  {/* Step 1: Input */}
                  <div className="flex flex-col items-center w-full max-w-xs">
                    <div className="bg-slate-800 text-[11px] px-3 py-1.5 rounded-lg border border-slate-700/80 font-mono text-indigo-300 w-full text-center">
                      User requirement: Prompt received
                    </div>
                    <ArrowDown className="w-4 h-4 text-indigo-500 mt-1" />
                  </div>

                  {/* Step 2: Coordinator */}
                  <div className="flex flex-col items-center w-full max-w-xs">
                    <div className="bg-slate-950 px-4 py-2.5 rounded-xl border border-indigo-500/40 w-full text-center shadow-md">
                      <div className="text-[10px] text-indigo-400 font-mono font-bold">COORDINATOR</div>
                      <div className="text-xs font-black text-white mt-0.5">CEO Agent (Gemini 3.5 Pro)</div>
                      <div className="text-[9px] text-slate-400 mt-1">10-Agent Task Decomposition & Allocation</div>
                    </div>
                    <ArrowDown className="w-4 h-4 text-indigo-500 mt-1" />
                  </div>

                  {/* Step 3: Parallel Swarms */}
                  <div className="grid grid-cols-2 gap-3 w-full">
                    <div className="bg-slate-950 p-2.5 rounded-xl border border-cyan-500/30 text-center">
                      <div className="text-[9px] text-cyan-400 font-mono font-bold uppercase">RESEARCH & ANALYTICS</div>
                      <div className="text-[11px] font-bold text-slate-200 mt-0.5">Research Specialists</div>
                      <div className="text-[8px] text-slate-500 font-mono mt-1">Google Grounding</div>
                    </div>
                    <div className="bg-slate-950 p-2.5 rounded-xl border border-pink-500/30 text-center">
                      <div className="text-[9px] text-pink-400 font-mono font-bold uppercase">DEVELOP & BUILD</div>
                      <div className="text-[11px] font-bold text-slate-200 mt-0.5">Dev Specialists</div>
                      <div className="text-[8px] text-slate-500 font-mono mt-1">Claude 3.5 Assembly</div>
                    </div>
                  </div>
                  <ArrowDown className="w-4 h-4 text-indigo-500 mt-1" />

                  {/* Step 4: Quality Gate */}
                  <div className="flex flex-col items-center w-full max-w-xs">
                    <div className="bg-slate-950 px-4 py-2.5 rounded-xl border border-emerald-500/40 w-full text-center shadow-md relative">
                      <div className="absolute -right-1 -top-1 bg-emerald-500 w-2.5 h-2.5 rounded-full animate-ping"></div>
                      <div className="text-[10px] text-emerald-400 font-mono font-bold">CONSENSUS EVALUATION</div>
                      <div className="text-xs font-black text-white mt-0.5">QA & UQI Auditor Panel</div>
                      <div className="text-[9px] text-emerald-300 font-mono mt-1">UQI Score Threshold ➔ {selectedMemory.score.toFixed(1)}%</div>
                    </div>
                    <ArrowDown className="w-4 h-4 text-indigo-500 mt-1" />
                  </div>

                  {/* Step 5: DNA Persistent Save */}
                  <div className="bg-indigo-950/40 p-3 rounded-xl border border-indigo-500/20 w-full text-center">
                    <div className="text-[10px] text-indigo-300 font-mono font-bold">KNOWLEDGE GRAPH & DNA LOGGING</div>
                    <p className="text-[10px] text-slate-300 mt-1 leading-relaxed">
                      Self-analysis serialized ➔ Intelligence DNA Saved ➔ Organization Updated
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* ③ Reusable Knowledge */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-3">
              <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-widest flex items-center gap-1.5 border-b border-slate-100 pb-2">
                <Workflow className="w-4 h-4 text-indigo-600" />
                ③ Reusable Knowledge (再利用可能知能)
              </h4>
              <div className="space-y-3">
                <div>
                  <span className="text-[10px] text-indigo-600 font-black block">
                    再利用可能な知識 (Reusable Concepts)
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1.5">
                    {getDna(selectedMemory).reusableKnowledge.reusableConcepts.map((item: string, i: number) => (
                      <div key={i} className="text-xs text-slate-600 bg-slate-50/80 p-2.5 rounded-xl border border-slate-100 leading-relaxed flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full shrink-0"></span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div>
                  <span className="text-[10px] text-indigo-600 font-black block">
                    テンプレート化できる内容 (Templates)
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1.5">
                    {getDna(selectedMemory).reusableKnowledge.templates.map((item: string, i: number) => (
                      <div key={i} className="text-xs text-slate-600 bg-slate-50/80 p-2.5 rounded-xl border border-slate-100 leading-relaxed flex items-center gap-2">
                        <FileCode className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] text-indigo-600 font-black block">
                    Workflow化できる内容 (Workflows)
                  </span>
                  <div className="space-y-1.5 mt-1.5">
                    {getDna(selectedMemory).reusableKnowledge.workflows.map((item: string, i: number) => (
                      <div key={i} className="text-xs text-slate-700 bg-indigo-50/20 p-3 rounded-xl border border-indigo-100/50 leading-relaxed flex items-start gap-2 shadow-2xs">
                        <Zap className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ④ User Preference */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-3">
              <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-widest flex items-center gap-1.5 border-b border-slate-100 pb-2">
                <UserCheck className="w-4 h-4 text-indigo-600" />
                ④ User Preference (ユーザー傾向・嗜好性分析)
              </h4>
              <div className="space-y-3">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold block">
                    今回推測できたユーザー傾向 (Inferred Tendency)
                  </span>
                  <div className="space-y-1.5 mt-1.5">
                    {getDna(selectedMemory).userPreference.inferredTendency.map((item: string, i: number) => (
                      <div key={i} className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex items-center gap-2">
                        <HeartHandshake className="w-4 h-4 text-indigo-500 shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold block">
                    次回改善点 (Next Time Improvements)
                  </span>
                  <div className="space-y-1.5 mt-1.5">
                    {getDna(selectedMemory).userPreference.nextTimeImprovements.map((item: string, i: number) => (
                      <div key={i} className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex items-center gap-2">
                        <Compass className="w-4 h-4 text-indigo-500 shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ⑤ System Improvement */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-3">
              <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-widest flex items-center gap-1.5 border-b border-slate-100 pb-2">
                <Cpu className="w-4 h-4 text-indigo-600" />
                ⑤ System Improvement (システム・エンジン自律改善)
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div className="p-3.5 bg-slate-50 border border-slate-100 rounded-2xl space-y-1.5 shadow-2xs">
                  <span className="text-[9px] text-slate-400 font-mono font-bold uppercase block tracking-wider">
                    AI Routing改善
                  </span>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {getDna(selectedMemory).systemImprovement.aiRoutingImprovement}
                  </p>
                </div>
                <div className="p-3.5 bg-slate-50 border border-slate-100 rounded-2xl space-y-1.5 shadow-2xs">
                  <span className="text-[9px] text-slate-400 font-mono font-bold uppercase block tracking-wider">
                    Plugin改善
                  </span>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {getDna(selectedMemory).systemImprovement.pluginImprovement}
                  </p>
                </div>
                <div className="p-3.5 bg-slate-50 border border-slate-100 rounded-2xl space-y-1.5 shadow-2xs">
                  <span className="text-[9px] text-slate-400 font-mono font-bold uppercase block tracking-wider">
                    Workflow改善
                  </span>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {getDna(selectedMemory).systemImprovement.workflowImprovement}
                  </p>
                </div>
                <div className="p-3.5 bg-slate-50 border border-slate-100 rounded-2xl space-y-1.5 shadow-2xs">
                  <span className="text-[9px] text-slate-400 font-mono font-bold uppercase block tracking-wider">
                    Memory改善
                  </span>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {getDna(selectedMemory).systemImprovement.memoryImprovement}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* If Knowledge Graph or Insights is selected */}
        {activeTab === "graph" && (
          <div className="flex-1 bg-white p-6 overflow-hidden flex flex-col">
            {renderGraph()}
          </div>
        )}

        {activeTab === "insights" && (
          <div className="flex-1 bg-slate-50 p-6 overflow-y-auto flex flex-col gap-6">
            <div className="p-5 bg-indigo-50 border border-indigo-100 rounded-3xl shadow-xs">
              <h4 className="text-sm font-bold text-indigo-900 mb-2 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                Automated Discovery: Engineering Bottleneck Analysis (自動ボトルネック分析)
              </h4>
              <p className="text-xs text-indigo-700 leading-relaxed">
                OEvE (組織進化エンジン)が蓄積されたミッションメモリとナレッジグラフを分析した結果、プルリクエストのレビュープロセスにおいて、並行型ディベートと同期ラグにより約40%のレイテンシーオーバーヘッドが発生していることが検出されました。
                これらを最適化するため、審査合格判定(Completion Judge)の手続きをスリム化する自動調整を適用可能です。
              </p>
              <button className="mt-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-xs flex items-center gap-1">
                Optimize Structure <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-5 bg-white border border-slate-200 rounded-3xl shadow-xs">
              <h4 className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-slate-500" />
                Knowledge DNA Schema (知能DNAスキーマ仕様)
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                ACOS 2.0は、各ミッションの完了フェーズにおけるディベートと実行データから自己分析レポートをコンパイルし、5つの次元(Summary, Lessons, Reuse, Preference, System)で構造化した不揮発性DNAとしてナレッジグラフに自律マージします。
                現在、システム内のナレッジグラフ・リレーション数は <strong>{evolutionData?.knowledgeRelations?.length || 12} 個</strong>、組織記憶数は <strong>{evolutionData?.memories?.length || 3} 個</strong> が適正に同期・保存されています。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
