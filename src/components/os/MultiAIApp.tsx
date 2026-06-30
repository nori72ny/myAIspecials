import React, { useState } from "react";
import { Cpu, Play, Settings } from "lucide-react";

export default function MultiAIApp() {
  const [prompt, setPrompt] = useState("AIの進化が今後5年で社会に与える最も大きな影響について分析してください。");
  const [running, setRunning] = useState(false);
  
  return (
    <div className="flex h-full w-full bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex-col">
      <div className="p-6 border-b border-slate-100 flex flex-col gap-4 bg-slate-50">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-black text-slate-800 tracking-tight">Multi-AI Workspace</h2>
            <p className="text-xs text-slate-500 font-medium mt-1">Compare outputs across multiple LLM providers</p>
          </div>
          <button className="p-2 text-slate-400 hover:text-slate-600 bg-white border border-slate-200 rounded-lg shadow-sm">
            <Settings className="w-4 h-4" />
          </button>
        </div>
        
        <div className="flex gap-2">
          <textarea 
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            className="flex-1 p-3 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none h-20"
            placeholder="プロンプトを入力..."
          />
          <button 
            onClick={() => setRunning(true)}
            className="px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition-colors"
          >
            <Play className="w-4 h-4" />
            <span>Run All</span>
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-x-auto p-6 bg-slate-50/50 flex gap-4 h-full">
        {/* Model Column 1 */}
        <div className="flex flex-col w-[350px] shrink-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-full">
          <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">♊</span>
              <span className="font-bold text-sm text-slate-700">Gemini 3.5 Pro</span>
            </div>
            {running && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-bold">Done (1.2s)</span>}
          </div>
          <div className="flex-1 p-4 overflow-y-auto text-sm text-slate-600 leading-relaxed">
            {running ? (
              <div className="space-y-2">
                <p>今後5年間で、AIは「自律的な組織運営」と「パーソナライズされた知的労働」に最大の革命をもたらします。</p>
                <p>OEE（Organization Execution Engine）のようなシステムが一般化し、人間は「実行」ではなく「ディレクション」に専念するようになります。</p>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-300">
                <Cpu className="w-8 h-8 opacity-50" />
              </div>
            )}
          </div>
          <div className="p-3 border-t border-slate-50 text-[10px] text-slate-400 flex justify-between bg-slate-50/50">
            <span>245 tokens</span>
            <span>$0.0012</span>
          </div>
        </div>
        
        {/* Model Column 2 */}
        <div className="flex flex-col w-[350px] shrink-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-full">
          <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">🧠</span>
              <span className="font-bold text-sm text-slate-700">GPT-4o</span>
            </div>
            {running && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-bold">Done (1.8s)</span>}
          </div>
          <div className="flex-1 p-4 overflow-y-auto text-sm text-slate-600 leading-relaxed">
             {running ? (
              <div className="space-y-2">
                <p>社会構造への最も大きな影響は「労働の再定義」です。定型的な認知タスクがAIに置き換わることで、クリエイティビティや感情的知性（EQ）の価値が相対的に高まります。</p>
                <p>企業はAIエージェントを社員として雇う「ハイブリッド・ワークフォース」へ移行するでしょう。</p>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-300">
                <Cpu className="w-8 h-8 opacity-50" />
              </div>
            )}
          </div>
          <div className="p-3 border-t border-slate-50 text-[10px] text-slate-400 flex justify-between bg-slate-50/50">
            <span>210 tokens</span>
            <span>$0.0031</span>
          </div>
        </div>
        
        {/* Model Column 3 */}
        <div className="flex flex-col w-[350px] shrink-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-full">
          <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">🤖</span>
              <span className="font-bold text-sm text-slate-700">Claude 3.5 Sonnet</span>
            </div>
            {running && <span className="text-[10px] text-indigo-500 font-bold flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span> Generating</span>}
          </div>
          <div className="flex-1 p-4 overflow-y-auto text-sm text-slate-600 leading-relaxed">
             {running ? (
              <div className="space-y-2">
                <p>最も顕著な変化は「ソフトウェア開発の民主化」と「教育の個別最適化」の2点に集約されます。</p>
                <span className="inline-block w-1 h-4 bg-indigo-500 animate-pulse"></span>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-300">
                <Cpu className="w-8 h-8 opacity-50" />
              </div>
            )}
          </div>
          <div className="p-3 border-t border-slate-50 text-[10px] text-slate-400 flex justify-between bg-slate-50/50">
            <span>-- tokens</span>
            <span>--</span>
          </div>
        </div>
        
      </div>
    </div>
  );
}
