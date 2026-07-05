import React, { useState } from "react";
import { BookOpen, Search, Star, Clock, Download, Plus, Play, MoreHorizontal } from "lucide-react";

const PROMPTS = [
  { id: 1, title: "Executive Summary Generator", category: "Writing", uses: 124, isStarred: true, description: "Creates a concise executive summary from long-form documents." },
  { id: 2, title: "Code Review Assistant", category: "Development", uses: 89, isStarred: false, description: "Analyzes code for performance, security, and style issues." },
  { id: 3, title: "Product Requirements Doc", category: "Product", uses: 45, isStarred: true, description: "Generates a standard PRD from a brief feature description." },
  { id: 4, title: "Weekly Status Report", category: "Management", uses: 210, isStarred: true, description: "Compiles activity logs into a formatted weekly report." },
  { id: 5, title: "SEO Blog Post Writer", category: "Marketing", uses: 56, isStarred: false, description: "Writes an SEO-optimized article based on target keywords." },
];

export default function PromptLibrary() {
  const [activeCategory, setActiveCategory] = useState("All");

  return (
    <div data-testid="marketplace-screen" className="flex h-full w-full bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex-col">
      <div className="p-6 border-b border-slate-100 flex flex-col gap-4 bg-slate-50">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-indigo-600" />
              Prompt Library
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-1">Reusable, version-controlled prompt templates</p>
          </div>
          <button className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors shadow-sm">
            <Plus className="w-4 h-4" />
            New Template
          </button>
        </div>
        
        <div className="flex gap-4 items-center">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text"
              placeholder="Search prompts..."
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
            />
          </div>
          <button className="flex items-center gap-2 px-3 py-2 border border-slate-200 bg-white rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            <Download className="w-4 h-4" />
            Import/Export
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 border-r border-slate-100 bg-slate-50/50 p-4 flex flex-col gap-2 overflow-y-auto hidden md:flex">
          <button onClick={() => setActiveCategory("All")} className={`w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${activeCategory === "All" ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>All Prompts</button>
          <button onClick={() => setActiveCategory("Favorites")} className={`w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center justify-between ${activeCategory === "Favorites" ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>
            <span>Favorites</span>
            <Star className="w-3.5 h-3.5" />
          </button>
          
          <div className="pt-4 pb-1 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Categories</div>
          {["Writing", "Development", "Product", "Management", "Marketing"].map(cat => (
            <button 
              key={cat}
              onClick={() => setActiveCategory(cat)} 
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeCategory === cat ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Main Content */}
        <div className="flex-1 p-6 overflow-y-auto bg-white">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {PROMPTS.filter(p => activeCategory === "All" || (activeCategory === "Favorites" && p.isStarred) || p.category === activeCategory).map(prompt => (
              <div key={prompt.id} className="border border-slate-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-md transition-all group relative bg-white flex flex-col">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-slate-800 text-sm pr-8">{prompt.title}</h3>
                  <button className="absolute right-4 top-4 text-slate-300 hover:text-amber-400 transition-colors">
                    <Star className={`w-4 h-4 ${prompt.isStarred ? 'fill-amber-400 text-amber-400' : ''}`} />
                  </button>
                </div>
                <p className="text-xs text-slate-500 mb-4 flex-1">{prompt.description}</p>
                <div className="flex items-center justify-between pt-3 border-t border-slate-50">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">{prompt.category}</span>
                    <span className="text-[10px] font-medium text-slate-400 flex items-center gap-1"><Clock className="w-3 h-3" /> {prompt.uses} uses</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    <button className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded">
                      <Play className="w-4 h-4" />
                    </button>
                    <button className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
