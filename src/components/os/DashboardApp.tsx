import React, { useState, useEffect } from "react";
import { 
  Cpu, Activity, Zap, Shield, Sparkles, CheckCircle2, Clock, 
  MessageSquare, AlertCircle, TrendingUp, RefreshCw, Layers 
} from "lucide-react";

export default function DashboardApp() {
  const [strategicData, setStrategicData] = useState<any>(null);
  const [evolutionData, setEvolutionData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshCount, setRefreshCount] = useState(0);

  const fetchDashboardData = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/strategic").then(res => res.json()),
      fetch("/api/evolution").then(res => res.json())
    ])
      .then(([sil, eve]) => {
        setStrategicData(sil);
        setEvolutionData(eve);
        setLoading(false);
      })
      .catch(err => {
        console.error("Error fetching integrated dashboard data:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchDashboardData();
  }, [refreshCount]);

  // Derived metrics from OEE, OEvE, and SIL
  const activeAgentsCount = evolutionData?.knowledgeNodes?.length || 12;
  const activeMissionsCount = evolutionData?.memories?.length || 4;
  const pendingReviewsCount = strategicData?.risks?.length || 3;
  const alignmentScore = strategicData?.alignmentScore || 95;
  const successProbability = strategicData?.prediction?.successProbability 
    ? `${(strategicData.prediction.successProbability * 100).toFixed(0)}%` 
    : "98%";

  return (
    <div id="dashboard-app-root" className="flex h-full w-full bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex-col">
      {/* Header */}
      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
        <div>
          <h2 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-600" />
            ACOS 2.0 Enterprise Control Center
          </h2>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Real-time operations dashboard monitoring OEE, OEvE, SIL, and AI Kernel
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setRefreshCount(prev => prev + 1)}
            disabled={loading}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200 bg-white shadow-xs disabled:opacity-50"
            title="Refresh System Metrics"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 text-xs font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            SYSTEM ONLINE
          </span>
        </div>
      </div>
      
      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
        <div className="max-w-6xl mx-auto space-y-6">
          
          {/* Top KPI Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Active Agents */}
            <div id="kpi-active-agents" className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 mb-3 text-indigo-600">
                <Cpu className="w-5 h-5" />
                <span className="font-bold text-sm">Active Agents (OEE)</span>
              </div>
              <div>
                <div className="text-3xl font-black text-slate-800">{activeAgentsCount}</div>
                <div className="text-xs text-emerald-500 font-bold mt-1">Integrated AI Staff</div>
              </div>
            </div>

            {/* Active Missions */}
            <div id="kpi-active-missions" className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 mb-3 text-amber-500">
                <Zap className="w-5 h-5" />
                <span className="font-bold text-sm">Total Missions (MOS)</span>
              </div>
              <div>
                <div className="text-3xl font-black text-slate-800">{activeMissionsCount}</div>
                <div className="text-xs text-amber-500 font-bold mt-1">Processed in queue</div>
              </div>
            </div>

            {/* Pending Reviews */}
            <div id="kpi-pending-reviews" className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 mb-3 text-rose-500">
                <AlertCircle className="w-5 h-5" />
                <span className="font-bold text-sm">Risk Profiles (SIL)</span>
              </div>
              <div>
                <div className="text-3xl font-black text-slate-800">{pendingReviewsCount}</div>
                <div className="text-xs text-rose-500 font-bold mt-1">Monitored continuously</div>
              </div>
            </div>

            {/* Organization Health */}
            <div id="kpi-org-health" className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 mb-3 text-emerald-500">
                <Shield className="w-5 h-5" />
                <span className="font-bold text-sm">Strategic Alignment</span>
              </div>
              <div>
                <div className="text-3xl font-black text-slate-800">{alignmentScore}%</div>
                <div className="text-xs text-emerald-500 font-bold mt-1">Success probability: {successProbability}</div>
              </div>
            </div>
          </div>
          
          {/* Main Layout Split */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Left Column: Today's Missions & Live Activity */}
            <div className="space-y-6">
              {/* Today's Missions (MOS/OOS) */}
              <div id="todays-missions-card" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
                <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  Mission Operations (OEE)
                </h3>
                <div className="space-y-3">
                  {evolutionData?.memories && evolutionData.memories.length > 0 ? (
                    evolutionData.memories.slice(0, 4).map((m: any, idx: number) => (
                      <div key={m.id || idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 hover:bg-slate-100/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${m.success ? "bg-emerald-500" : "bg-amber-500"}`}></div>
                          <div>
                            <p className="text-xs font-bold text-slate-800">Mission: {m.missionId}</p>
                            <p className="text-[10px] text-slate-500">Score: {m.score.toFixed(1)}% • Active Tasks: {m.kpiSnapshot?.activeTasks || 0}</p>
                          </div>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-1 rounded ${m.success ? "text-emerald-600 bg-emerald-50" : "text-amber-600 bg-amber-50"}`}>
                          {m.success ? "Success" : "Review Needed"}
                        </span>
                      </div>
                    ))
                  ) : (
                    <>
                      <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></div>
                          <div>
                            <p className="text-xs font-bold text-slate-800">Strategic Alignment Optimization</p>
                            <p className="text-[10px] text-slate-500">OEE executing data collection</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded">In Progress</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                          <div>
                            <p className="text-xs font-bold text-slate-800">Dynamic Org Chart Refactoring</p>
                            <p className="text-[10px] text-slate-500">Waiting for human review</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">Review Needed</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
              
              {/* OEvE Recent Activity Log */}
              <div id="recent-activity-card" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
                <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-500" />
                  Recent Activity (OEvE Memory)
                </h3>
                <div className="relative border-l border-slate-200 ml-2 pl-4 space-y-4">
                  {evolutionData?.memories && evolutionData.memories.length > 0 ? (
                    evolutionData.memories.slice(-3).reverse().map((m: any, idx: number) => (
                      <div key={m.id || idx} className="relative">
                        <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white ${m.success ? "bg-emerald-500" : "bg-amber-500"}`}></div>
                        <p className="text-xs font-bold text-slate-700">Memory Consolidated: {m.missionId}</p>
                        <p className="text-[10px] text-slate-500">
                          Score {m.score.toFixed(1)}% • Saved {new Date(m.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    ))
                  ) : (
                    <>
                      <div className="relative">
                        <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-slate-300 border-2 border-white"></div>
                        <p className="text-xs font-bold text-slate-700">Memory Graph Updated</p>
                        <p className="text-[10px] text-slate-500">10 mins ago • OEvE synthesized new insights</p>
                      </div>
                      <div className="relative">
                        <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white"></div>
                        <p className="text-xs font-bold text-slate-700">Mission Completed: Security Audit</p>
                        <p className="text-[10px] text-slate-500">1 hour ago • Agent Team Alpha</p>
                      </div>
                      <div className="relative">
                        <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-slate-300 border-2 border-white"></div>
                        <p className="text-xs font-bold text-slate-700">Workspace "Engineering" Created</p>
                        <p className="text-[10px] text-slate-500">3 hours ago • Admin</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            
            {/* Right Column: SIL Recommendations & Decisions */}
            <div className="space-y-6">
              {/* AI Recommendations from SIL */}
              <div id="sil-recommendations-card" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
                <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-500" />
                  AI Strategic Recommendations (SIL)
                </h3>
                <ul className="space-y-3">
                  {strategicData?.risks && strategicData.risks.length > 0 ? (
                    strategicData.risks.slice(0, 3).map((risk: any, idx: number) => (
                      <li key={risk.id || idx} className="flex items-start gap-3 p-3 bg-rose-50/50 rounded-xl border border-rose-100">
                        <div className="w-2 h-2 mt-1.5 rounded-full bg-rose-500 shrink-0"></div>
                        <div>
                          <div className="text-xs font-bold text-rose-900">{risk.title}</div>
                          <div className="text-[10px] text-rose-600 mt-0.5">{risk.description} (Priority: {risk.priority})</div>
                        </div>
                      </li>
                    ))
                  ) : (
                    <li className="flex items-start gap-3 p-3 bg-indigo-50/50 rounded-xl border border-indigo-100">
                      <div className="w-2 h-2 mt-1.5 rounded-full bg-indigo-500 shrink-0"></div>
                      <div>
                        <div className="text-xs font-bold text-indigo-900">Optimize API usage for GPT-4o</div>
                        <div className="text-[10px] text-indigo-600 mt-0.5">SIL detected a 12% increase in token usage. Recommend caching strategy.</div>
                      </div>
                    </li>
                  )}
                  
                  {strategicData?.innovations && strategicData.innovations.length > 0 ? (
                    strategicData.innovations.slice(0, 2).map((proposal: any, idx: number) => (
                      <li key={proposal.id || idx} className="flex items-start gap-3 p-3 bg-emerald-50/50 rounded-xl border border-emerald-100">
                        <div className="w-2 h-2 mt-1.5 rounded-full bg-emerald-500 shrink-0"></div>
                        <div>
                          <div className="text-xs font-bold text-emerald-900">{proposal.title}</div>
                          <div className="text-[10px] text-emerald-600 mt-0.5">{proposal.description} (Impact: {proposal.expectedImpact})</div>
                        </div>
                      </li>
                    ))
                  ) : (
                    <li className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="w-2 h-2 mt-1.5 rounded-full bg-emerald-500 shrink-0"></div>
                      <div>
                        <div className="text-xs font-bold text-slate-700">New Workflow automation available</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">Based on your recent activities, a new "Weekly Reporting" workflow can save 4 hours.</div>
                      </div>
                    </li>
                  )}
                </ul>
              </div>

              {/* Strategic Decisions (DecisionIntelligence) */}
              <div id="sil-decisions-card" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
                <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                  Operational Decisions (SIL Engine)
                </h3>
                <div className="space-y-3">
                  {strategicData?.decisions && strategicData.decisions.length > 0 ? (
                    strategicData.decisions.slice(0, 3).map((dec: any, idx: number) => (
                      <div key={dec.id || idx} className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-black text-slate-800">{dec.title}</span>
                          <span className={`text-[8px] font-bold font-mono uppercase px-1.5 py-0.5 rounded ${
                            dec.status === "Approved" ? "text-emerald-700 bg-emerald-100" : "text-amber-700 bg-amber-100"
                          }`}>{dec.status}</span>
                        </div>
                        <p className="text-[10px] text-slate-500">{dec.description}</p>
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-400 text-xs py-4 text-center">No active decisions recorded. Runs automatically as OEE triggers.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
