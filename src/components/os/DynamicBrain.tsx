import React, { useState, useEffect, useRef } from "react";
import { Brain, Database, Shield, Zap, RefreshCw, Terminal, Cpu } from "lucide-react";
import { cn } from "../../utils";

export default function DynamicBrain() {
  const [bpiActive, setBpiActive] = useState(98.4);
  const [activeThoughts, setActiveThoughts] = useState<string[]>([
    "Initializing cognitive core...",
    "ACOS 2.0 Boardroom standby."
  ]);
  const [nodesSynced, setNodesSynced] = useState(142);
  const [rulesCompliance, setRulesCompliance] = useState(98.4);
  
  // Real-time canvas for the Knowledge Graph particle system
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Particle System Effect for Knowledge Graph
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = canvas.offsetWidth;
    let height = canvas.offsetHeight;
    canvas.width = width;
    canvas.height = height;

    // Responsive sizing
    const handleResize = () => {
      if (!canvas) return;
      width = canvas.offsetWidth;
      height = canvas.offsetHeight;
      canvas.width = width;
      canvas.height = height;
    };
    window.addEventListener("resize", handleResize);

    // Node particle definition
    const particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
      glow: number;
    }> = Array.from({ length: 15 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      radius: Math.random() * 2 + 1.5,
      glow: Math.random() * 5 + 2
    }));

    // Paint loop
    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Draw connections
      ctx.strokeStyle = "rgba(99, 102, 241, 0.08)";
      ctx.lineWidth = 0.8;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 55) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw and update particles
      particles.forEach((p, idx) => {
        p.x += p.vx;
        p.y += p.vy;

        // Bounce borders
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        // Draw particle node
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = idx === 0 ? "rgba(236, 72, 153, 0.8)" : "rgba(99, 102, 241, 0.8)";
        ctx.shadowBlur = p.glow;
        ctx.shadowColor = "rgba(99, 102, 241, 0.4)";
        ctx.fill();
        ctx.shadowBlur = 0; // reset
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // Live thinking pulse log scrolling
  useEffect(() => {
    const logPhrases = [
      "Evaluating cognitive nodes...",
      "Consolidating SWOT strategy factors...",
      "UQI fact compliance verified: 98.4%",
      "Memory synapsis cache refreshed",
      "Analyzing ROI predictions...",
      "Broadcasting cross-model boardroom weights...",
      "Updating semantic vector alignments...",
      "Reinforcing system safety protocols...",
      "Grounded source materials matching completed",
      "Adjusting agent allocation matrix (OEE: 98.8%)",
      "Synthesizing OEvE core consensus...",
      "Assembling tactical company deliverables..."
    ];

    const timer = setInterval(() => {
      setBpiActive(prev => {
        const delta = (Math.random() - 0.5) * 0.15;
        return parseFloat(Math.min(100, Math.max(97.5, prev + delta)).toFixed(2));
      });

      setNodesSynced(prev => {
        const delta = Math.random() > 0.7 ? (Math.random() > 0.5 ? 1 : -1) : 0;
        return Math.min(250, Math.max(120, prev + delta));
      });

      setRulesCompliance(prev => {
        const delta = (Math.random() - 0.5) * 0.05;
        return parseFloat(Math.min(100, Math.max(98, prev + delta)).toFixed(2));
      });

      setActiveThoughts(prev => {
        const nextPhrase = logPhrases[Math.floor(Math.random() * logPhrases.length)];
        const updated = [...prev, nextPhrase];
        if (updated.length > 5) updated.shift();
        return updated;
      });
    }, 2800);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
          </span>
          <h3 className="text-[11px] font-black text-slate-400 dark:text-neutral-500 uppercase tracking-widest font-mono">
            Supreme Live Cognitive Core (Dynamic Brain)
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold text-indigo-500 dark:text-indigo-400 px-2 py-0.5 bg-indigo-500/5 dark:bg-indigo-500/15 border border-indigo-500/10 rounded-full">
            BPI: {bpiActive}% Active Efficiency
          </span>
        </div>
      </div>

      {/* Grid of the 4 interactive animated cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        
        {/* Card 1: Knowledge DNA / Particle network graph */}
        <div className="bg-white/80 dark:bg-neutral-900/40 backdrop-blur-md border border-slate-200/60 dark:border-white/[0.04] p-5 rounded-2xl shadow-xs hover:border-indigo-500/30 transition-all flex flex-col justify-between group overflow-hidden relative min-h-[155px]">
          <div className="absolute inset-0 z-0 opacity-40">
            <canvas ref={canvasRef} className="w-full h-full" />
          </div>
          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
              <Brain className="w-4 h-4 animate-pulse text-pink-500" />
              <span className="font-bold text-xs font-mono tracking-wide uppercase">Knowledge DNA</span>
            </div>
            <span className="text-[9px] font-bold bg-pink-500/10 text-pink-500 px-1.5 py-0.5 rounded font-mono animate-pulse">
              LIVE GRAPH
            </span>
          </div>
          <div className="mt-4 relative z-10 bg-gradient-to-t from-white/90 dark:from-neutral-900/90 pt-2">
            <div className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-baseline gap-1.5">
              4.82<span className="text-xs font-medium text-slate-400">GB</span>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-neutral-500 font-medium mt-1 leading-normal">
              Self-balancing node matrix compiling neural connection paths.
            </p>
          </div>
        </div>

        {/* Card 2: Memory Sync */}
        <div className="bg-white/80 dark:bg-neutral-900/40 backdrop-blur-md border border-slate-200/60 dark:border-white/[0.04] p-5 rounded-2xl shadow-xs hover:border-emerald-500/30 transition-all flex flex-col justify-between group overflow-hidden relative min-h-[155px]">
          <div className="absolute right-0 bottom-0 translate-x-3 translate-y-3 opacity-[0.02] group-hover:opacity-[0.05] pointer-events-none duration-500">
            <Database className="w-32 h-32 text-emerald-500" />
          </div>
          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <Database className="w-4 h-4 text-emerald-500" />
              <span className="font-bold text-xs font-mono tracking-wide uppercase">OEvE Memory Sync</span>
            </div>
            <span className="text-[9px] font-bold bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded font-mono flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
              {nodesSynced} SYNAPSE
            </span>
          </div>

          {/* Animated sound/pulse wave SVGs */}
          <div className="my-2 h-6 flex items-end gap-0.5 overflow-hidden justify-center opacity-70">
            {Array.from({ length: 16 }).map((_, i) => (
              <span 
                key={i} 
                className="w-1 bg-gradient-to-t from-emerald-500 to-teal-400 rounded-full transition-all duration-300"
                style={{
                  height: `${Math.sin(i * 0.4 + Date.now() / 300) * 8 + 12}px`,
                  animation: `bounce 1s ease-in-out infinite alternate`,
                  animationDelay: `${i * 0.08}s`
                }}
              />
            ))}
          </div>

          <div className="relative z-10">
            <p className="text-[10px] text-slate-400 dark:text-neutral-500 font-medium leading-normal">
              Consolidated long-term vector embeddings synchronized with active context.
            </p>
          </div>
        </div>

        {/* Card 3: Thinking Pulse Terminal */}
        <div className="md:col-span-2 bg-neutral-950 border border-white/[0.06] p-4 rounded-2xl shadow-xs hover:border-indigo-500/30 transition-all flex flex-col justify-between relative min-h-[155px]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-indigo-400">
              <Terminal className="w-4 h-4 text-indigo-400" />
              <span className="font-bold text-xs font-mono tracking-wide uppercase">Thinking Pulse Log</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
              <span className="text-[9px] font-mono text-slate-400 font-bold uppercase">Consensus Active</span>
            </div>
          </div>

          {/* Live terminal-style scroll log */}
          <div className="my-3 font-mono text-[9.5px] leading-relaxed text-slate-300 space-y-1 h-[68px] overflow-hidden pr-2 flex flex-col justify-end">
            {activeThoughts.map((t, idx) => (
              <div key={idx} className="flex items-start gap-1.5 truncate">
                <span className="text-indigo-400 select-none shrink-0">&gt;&gt;</span>
                <span className={cn(
                  "truncate",
                  idx === activeThoughts.length - 1 ? "text-indigo-300 font-bold" : "text-slate-500"
                )}>
                  {t}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between text-[8px] text-slate-500 font-mono border-t border-white/[0.04] pt-2">
            <span>THREAD ID: OS-COGNITIVE-MAIN</span>
            <span>SYSTEM AUDIT RATE: 100%</span>
          </div>
        </div>

      </div>
    </div>
  );
}
