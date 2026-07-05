import React, { useState, useEffect } from "react";
import { 
  Database, Search, Folder, FileText, Share2, MoreVertical, 
  Filter, ArrowRight, RefreshCw, Layers, Sparkles 
} from "lucide-react";

export default function MemoryExplorer() {
  const [activeTab, setActiveTab] = useState<"graph" | "files" | "insights">("files");
  const [evolutionData, setEvolutionData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    setLoading(true);
    fetch("/api/evolution")
      .then(res => res.json())
      .then(data => {
        setEvolutionData(data);
        setLoading(false);
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
          <p className="text-xs mt-1 text-center max-w-sm">Execute a mission in ACOS to see the self-evolution engine map organizational relationships.</p>
        </div>
      );
    }

    // Positioning algorithm: arrange nodes in a circular or staggered grid
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
        <div className="absolute top-4 left-4 bg-white/80 backdrop-blur-xs p-3 rounded-xl border border-slate-200 shadow-xs text-[10px] text-slate-500 z-10 space-y-1">
          <p className="font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1">
            <Layers className="w-3 h-3 text-indigo-600" />
            OEvE Legend
          </p>
          <p>● Circle: AI Agent / Department Node</p>
          <p>─ Line: Collaborations & Reviews</p>
        </div>

        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full max-w-2xl bg-slate-50 rounded-2xl border border-slate-200">
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
                  strokeWidth={rel.trustScore / 25} 
                  className="stroke-indigo-300 hover:stroke-indigo-500 transition-all cursor-pointer"
                />
                <text 
                  x={(source.x + target.x) / 2} 
                  y={(source.y + target.y) / 2 - 4} 
                  fill="#4f46e5" 
                  fontSize="7" 
                  fontWeight="bold" 
                  textAnchor="middle"
                  className="font-mono bg-white"
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
                className="hover:fill-indigo-50 hover:stroke-indigo-600 transition-all"
              />
              <text 
                x={node.x} 
                y={node.y + 4} 
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

  return (
    <div id="memory-explorer-root" className="flex h-full w-full bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex-col">
      {/* Header */}
      <div className="p-6 border-b border-slate-100 flex flex-col gap-4 bg-slate-50">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
              <Database className="w-5 h-5 text-indigo-600 animate-pulse" />
              Memory Explorer (OEvE)
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-1">
              Browse and visualize the organization's long-term knowledge and dynamic graph relationships
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setRefreshCount(prev => prev + 1)}
              disabled={loading}
              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200 bg-white"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
            <div className="flex bg-slate-200/50 p-1 rounded-xl">
              <button 
                onClick={() => setActiveTab("graph")}
                className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-colors ${activeTab === "graph" ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Graph View
              </button>
              <button 
                onClick={() => setActiveTab("files")}
                className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-colors ${activeTab === "files" ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                List View
              </button>
              <button 
                onClick={() => setActiveTab("insights")}
                className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-colors ${activeTab === "insights" ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
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
              placeholder="Search organizational memories and mission context..."
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
            />
          </div>
          <button className="p-2 border border-slate-200 bg-white rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-50">
            <Filter className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 border-r border-slate-100 bg-slate-50/50 p-4 flex flex-col gap-4 overflow-y-auto hidden md:flex">
          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">Projects / Missions</h3>
            <div className="space-y-1">
              <button className="w-full flex items-center gap-2 p-2 bg-indigo-50/50 hover:bg-indigo-50 rounded-lg text-left group">
                <Folder className="w-4 h-4 text-indigo-600" />
                <span className="text-sm font-semibold text-indigo-900">All Operations</span>
              </button>
              {evolutionData?.memories?.slice(0, 5).map((m: any, idx: number) => (
                <button key={m.id || idx} className="w-full flex items-center gap-2 p-2 hover:bg-slate-100 rounded-lg text-left group">
                  <Folder className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                  <span className="text-sm font-medium text-slate-700 line-clamp-1">{m.missionId}</span>
                </button>
              ))}
            </div>
          </div>
          
          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">Knowledge Types</h3>
            <div className="space-y-1">
              <button className="w-full flex items-center justify-between p-2 hover:bg-slate-100 rounded-lg text-left group">
                <span className="text-sm font-medium text-slate-600">Core Principles</span>
                <span className="text-xs bg-indigo-50 text-indigo-600 font-mono font-bold px-1.5 rounded-full">15</span>
              </button>
              <button className="w-full flex items-center justify-between p-2 hover:bg-slate-100 rounded-lg text-left group">
                <span className="text-sm font-medium text-slate-600">Mission Memories</span>
                <span className="text-xs bg-indigo-50 text-indigo-600 font-mono font-bold px-1.5 rounded-full">
                  {evolutionData?.memories?.length || 0}
                </span>
              </button>
              <button className="w-full flex items-center justify-between p-2 hover:bg-slate-100 rounded-lg text-left group">
                <span className="text-sm font-medium text-slate-600">Semantic Relations</span>
                <span className="text-xs bg-indigo-50 text-indigo-600 font-mono font-bold px-1.5 rounded-full">
                  {evolutionData?.knowledgeRelations?.length || 0}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 p-6 overflow-y-auto bg-white flex flex-col">
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mb-2" />
              <p className="text-xs">Loading evolution records...</p>
            </div>
          ) : (
            <>
              {activeTab === "files" && (
                <div className="space-y-3 flex-1">
                  {filteredMemories.length > 0 ? (
                    filteredMemories.map((m: any, idx: number) => (
                      <div key={m.id || idx} className="flex items-center justify-between p-4 rounded-xl border border-slate-100 hover:border-indigo-100 hover:bg-indigo-50/30 transition-all cursor-pointer group">
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${m.success ? "bg-indigo-50" : "bg-rose-50"}`}>
                            <FileText className={`w-5 h-5 ${m.success ? "text-indigo-600" : "text-rose-600"}`} />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-slate-800 group-hover:text-indigo-700 transition-colors">
                              Mission: {m.missionId}
                            </h4>
                            <p className="text-xs text-slate-500 mt-0.5">
                              Consolidated Score: {m.score.toFixed(1)}% • Tasks Processed: {m.kpiSnapshot?.activeTasks || 0} • {new Date(m.timestamp).toLocaleTimeString()}
                            </p>
                            {m.successStories && m.successStories.length > 0 && (
                              <p className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded mt-1.5 inline-block font-medium">
                                Story: {m.successStories[0]}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-2 py-1 rounded ${m.success ? "text-indigo-600 bg-indigo-50" : "text-rose-600 bg-rose-50"}`}>
                            {m.success ? "DNA SUCCESS" : "DNA COMPROMISED"}
                          </span>
                          <button className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-all">
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8">
                      <Folder className="w-12 h-12 mb-2 text-slate-200" />
                      <p className="text-sm font-bold">No memories found</p>
                      <p className="text-xs mt-1">Try executing a mission first or adjusting your search term.</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "graph" && renderGraph()}

              {activeTab === "insights" && (
                <div className="space-y-4 flex-1">
                  <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl">
                    <h4 className="text-sm font-bold text-indigo-900 mb-2 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-indigo-600" />
                      Automated Discovery: Engineering Bottleneck Analysis
                    </h4>
                    <p className="text-xs text-indigo-700 leading-relaxed">
                      OEvE has analyzed memory across our executed missions and identified that PR reviews and manual validation cycles are causing up to a 40% delay in overall deployment throughput. 
                      Recommends adjusting the organization's dynamic structure to include a continuous pre-review stage before escalations are triggered.
                    </p>
                    <button className="mt-3 text-xs font-bold text-indigo-600 flex items-center gap-1 hover:text-indigo-800 transition-colors">
                      Optimize Structure <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                    <h4 className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-slate-500" />
                      Knowledge DNA (Knowledge DNA Schema)
                    </h4>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      ACOS 2.0 automatically serializes success rules and consensus models into reusable operational files in the background. The current Knowledge DNA database has self-synchronized {evolutionData?.memories?.length || 0} core operations.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
