import React, { useState } from 'react';
import { RoutingEngine } from '../../lib/routing-engine/RoutingEngine';
import { RoutingResponse } from '../../lib/routing-engine/types';
import { Zap, DollarSign, Award, Settings, Brain, Bot, Network } from 'lucide-react';

export default function RoutingTester() {
  const [input, setInput] = useState('');
  const [priority, setPriority] = useState<"speed" | "cost" | "quality">("quality");
  const [result, setResult] = useState<RoutingResponse | null>(null);

  const handleTest = () => {
    if (!input.trim()) return;
    const engine = new RoutingEngine();
    const res = engine.route({ input, priority });
    setResult(res);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400">
          <Network className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">AI Routing Engine v2</h1>
          <p className="text-slate-400">Test the dynamic capability-based routing</p>
        </div>
      </div>

      <div className="bg-slate-900 rounded-xl p-6 border border-slate-800 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Input Prompt</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. 犬のイラストを描いて、そして数学の計算をして"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-300 h-24 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Routing Priority</label>
          <div className="flex gap-4">
            {(['quality', 'speed', 'cost'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  priority === p 
                  ? 'bg-indigo-600 border-indigo-500 text-white' 
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                {p === 'quality' && <Award className="w-4 h-4" />}
                {p === 'speed' && <Zap className="w-4 h-4" />}
                {p === 'cost' && <DollarSign className="w-4 h-4" />}
                <span className="capitalize">{p}</span>
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleTest}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold flex items-center justify-center gap-2"
        >
          <Settings className="w-4 h-4" />
          Test Routing
        </button>
      </div>

      {result && (
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-800 space-y-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Bot className="w-5 h-5 text-indigo-400" />
            Routing Result
          </h2>
          
          <div>
            <h3 className="text-sm font-medium text-slate-400 mb-2">Extracted Capabilities</h3>
            <div className="flex flex-wrap gap-2">
              {result.extractedCapabilities.map(c => (
                <span key={c} className="px-2 py-1 bg-blue-500/10 text-blue-400 text-xs rounded border border-blue-500/20">
                  {c}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-slate-950 border border-slate-800">
              <div className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-2">Primary AI</div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-bold text-white">{result.primaryAI.name}</div>
                  <div className="text-sm text-slate-400">{result.primaryAI.provider}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Speed: {result.primaryAI.speed}/10</div>
                  <div className="text-xs text-slate-500">Quality: {result.primaryAI.quality}/10</div>
                </div>
              </div>
            </div>

            {result.secondaryAIs.length > 0 && (
              <div className="p-4 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-2">Secondary AIs</div>
                <div className="space-y-3">
                  {result.secondaryAIs.map(ai => (
                    <div key={ai.id} className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold text-slate-300">{ai.name}</div>
                        <div className="text-xs text-slate-500">{ai.provider}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.integrationAI && (
              <div className="p-4 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                <div className="text-xs text-indigo-400 font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                  <Brain className="w-4 h-4" />
                  Integration AI
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-indigo-300">{result.integrationAI.name}</div>
                    <div className="text-xs text-indigo-500/70">{result.integrationAI.provider}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
