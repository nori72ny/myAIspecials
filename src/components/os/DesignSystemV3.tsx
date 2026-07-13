import  { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Palette, 
  Type, 
  Grid, 
  Sliders, 
  Zap, 
  Sparkles, 
  CheckCircle2, 
  Copy, 
  Check, 
  Play, 
  Layers, 
   
   
   
  PlusCircle, 
  ChevronRight } from "lucide-react";
import { cn } from "../../utils";

export default function DesignSystemV3() {
  const [isEn, setIsEn] = useState(false);
  const [copiedColor, setCopiedColor] = useState<string | null>(null);
  
  // Interactive glass states
  const [glassBlur, setGlassBlur] = useState<number>(16);
  const [glassOpacity, setGlassOpacity] = useState<number>(20);
  const [glassBorderOpacity, setGlassBorderOpacity] = useState<number>(10);
  const [glassBackground, setGlassBackground] = useState<"cosmic" | "aurora" | "void">("cosmic");

  // Interactive animation states
  const [selectedCurve, setSelectedCurve] = useState<"apple" | "quantum" | "linear">("apple");
  const [animationTrigger, setAnimationTrigger] = useState<boolean>(false);
  const [measuredTime, setMeasuredTime] = useState<number>(0);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);

  // Typography interactive sizing scale
  const [fontScaleFactor, setFontScaleFactor] = useState<number>(1);

  // Three-click capability simulator
  const [simulatorStep, setSimulatorStep] = useState<number>(1);
  const [simulatorCategory, setSimulatorCategory] = useState<string | null>(null);
  const [simulatorCapability, setSimulatorCapability] = useState<string | null>(null);
  const [isSimulatorDeploying, setIsSimulatorDeploying] = useState<boolean>(false);

  // Monitor language settings from localStorage
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

  // Copy to clipboard helper
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedColor(label);
    setTimeout(() => setCopiedColor(null), 2000);
  };

  // Run animation playground measurement
  const triggerAnimationTest = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    setAnimationTrigger(prev => !prev);
    const startTime = performance.now();
    
    // Simulate end of animation based on the duration of transition
    const duration = selectedCurve === "linear" ? 300 : selectedCurve === "apple" ? 240 : 280;
    setTimeout(() => {
      const endTime = performance.now();
      setMeasuredTime(Math.round(endTime - startTime));
      setIsAnimating(false);
    }, duration);
  };

  // Categories & Capabilities for the 3-click simulator
  const simCategories = [
    { id: "tech", label: isEn ? "Tech & Engineering" : "技術開発 & エンジニアリング", icon: "💻" },
    { id: "business", label: isEn ? "Business Strategy" : "経営戦略 & 事業開発", icon: "📊" },
    { id: "marketing", label: isEn ? "Creative & Marketing" : "クリエイティブ & マーケティング", icon: "🎨" }
  ];

  const simCapabilities: Record<string, { id: string; name: string; desc: string }[]> = {
    tech: [
      { id: "auth", name: isEn ? "NextAuth v5 Integrator" : "NextAuth v5 統合モジュール", desc: isEn ? "3-click secure OAuth setup" : "3クリックでセキュアなOAuthを構築" },
      { id: "db", name: isEn ? "Drizzle schema optimizer" : "Drizzle スキーマ自動最適化", desc: isEn ? "Real-time query tuning and index generation" : "リアルタイムクエリチューニングとインデックス作成" }
    ],
    business: [
      { id: "swot", name: isEn ? "SWOT Strategy Planner" : "SWOT戦略プランナー", desc: isEn ? "Deploys multi-agent consensus analysis" : "複数AIのコンセンサス分析をデプロイ" },
      { id: "roi", name: isEn ? "ROI Forecasting Model" : "ROI予測モデラー", desc: isEn ? "High-precision investment outcomes projection" : "高精度の投資成果予測モデルを構築" }
    ],
    marketing: [
      { id: "branding", name: isEn ? "Brand Identity Engine" : "ブランドアイデンティティ生成エンジン", desc: isEn ? "Synthesizes competitive color tokens and moodboards" : "競合に勝るカラートークンとムードボードを作成" },
      { id: "content", name: isEn ? "Autonomous Copy Generator" : "自律型広告コピーライター", desc: isEn ? "Generates highly persuasive visual captions" : "説得力の高いビジュアルキャプションを生成" }
    ]
  };

  const handleSimReset = () => {
    setSimulatorStep(1);
    setSimulatorCategory(null);
    setSimulatorCapability(null);
    setIsSimulatorDeploying(false);
  };

  const executeSimulatorDeploy = () => {
    setIsSimulatorDeploying(true);
    setTimeout(() => {
      setSimulatorStep(4);
      setIsSimulatorDeploying(false);
    }, 1500);
  };

  return (
    <div className="space-y-12 pb-16">
      
      {/* HEADER BANNER */}
      <div className="p-8 bg-gradient-to-br from-indigo-950 via-slate-900 to-black border border-indigo-500/20 rounded-3xl space-y-4 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl -mr-20 -mt-20"></div>
        <div className="absolute bottom-0 left-0 w-72 h-72 bg-pink-500/5 rounded-full blur-3xl -ml-20 -mb-20"></div>
        
        <div className="relative z-10 space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-[10px] text-indigo-300 font-bold font-mono uppercase tracking-widest">
            <Sparkles className="w-3 h-3 text-indigo-400" />
            ORIGIN Design System v3.0
          </div>
          <h2 className="text-3xl font-black text-white tracking-tight">
            {isEn ? "The Sovereign User Interface System" : "ORIGIN 統合UIデザインシステム v3.0"}
          </h2>
          <p className="text-sm text-slate-300 max-w-2xl leading-relaxed font-medium">
            {isEn 
              ? "Bridging physical clarity and mathematical grace. Adhering to Apple Human Interface guidelines, limiting accent glows to Intellect Indigo, Success Pink, and Confidence Blue on an off-black silent spatial grid."
              : "物理的な明瞭さと数学的優美の融合。AppleのHIG（Human Interface Guidelines）に準拠し、インテリジェンスを象徴するインディゴ、成功のピンク、信頼のブルーのみをアクセントとして、静寂なダークスペース上に構成されたFigmaレベルのデザインシステム仕様。"}
          </p>
        </div>
      </div>

      {/* THREE-CLICK WORKFLOW HIGHLIGHT (Apple UX Constraint Demo) */}
      <div className="bg-white/40 dark:bg-neutral-900/10 backdrop-blur-2xl border border-slate-200/40 dark:border-white/[0.03] rounded-3xl p-6 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-white/[0.02] pb-4">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest font-mono">
              3-Clicks Capability Addition UX (Apple Standard Verification)
            </span>
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white">
              {isEn ? "Continuous Capability Integration Simulator" : "3クリック能力追加 UXシミュレーター"}
            </h3>
          </div>
          <span className="text-[10px] font-mono text-slate-400 dark:text-neutral-500">
            CONSTRAINT: CLICK COUNT &le; 3
          </span>
        </div>

        {/* Interactive Steps Visualizer */}
        <div className="grid grid-cols-4 gap-2 text-center text-xs font-bold text-slate-500 font-mono">
          {[
            { step: 1, label: isEn ? "1. Select Domain" : "1. 領域選択" },
            { step: 2, label: isEn ? "2. Choose Capability" : "2. 能力選択" },
            { step: 3, label: isEn ? "3. Deploy & Boot" : "3. 展開・起動" },
            { step: 4, label: isEn ? "4. Ready" : "4. 完了" }
          ].map((s) => (
            <div 
              key={s.step} 
              className={cn(
                "py-2 px-1 rounded-xl border transition-all duration-300",
                simulatorStep === s.step 
                  ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-400 shadow-sm"
                  : simulatorStep > s.step
                    ? "bg-emerald-500/5 border-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-slate-50 dark:bg-neutral-900/30 border-transparent text-slate-400"
              )}
            >
              {s.label}
            </div>
          ))}
        </div>

        {/* Simulator Area */}
        <div className="bg-slate-50/50 dark:bg-neutral-950/20 border border-slate-200/50 dark:border-white/[0.02] rounded-2xl p-6 min-h-[180px] flex flex-col justify-between">
          
          <AnimatePresence mode="wait">
            {simulatorStep === 1 && (
              <motion.div 
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-4"
              >
                <p className="text-xs text-slate-400 dark:text-neutral-500 font-bold uppercase tracking-wider">
                  {isEn ? "Click 1: Select Capability Domain" : "クリック 1: 能力の領域（カテゴリー）を選択してください"}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {simCategories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => {
                        setSimulatorCategory(cat.id);
                        setSimulatorStep(2);
                      }}
                      className="p-4 bg-white dark:bg-neutral-900/40 border border-slate-200/50 dark:border-white/[0.04] hover:border-indigo-500/30 dark:hover:border-indigo-500/30 rounded-xl flex items-center gap-3 transition-all duration-300 cursor-pointer text-left hover:-translate-y-0.5"
                    >
                      <span className="text-xl">{cat.icon}</span>
                      <span className="text-xs font-black text-slate-800 dark:text-neutral-200">{cat.label}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {simulatorStep === 2 && (
              <motion.div 
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-4"
              >
                <div className="flex justify-between items-center">
                  <p className="text-xs text-slate-400 dark:text-neutral-500 font-bold uppercase tracking-wider">
                    {isEn ? "Click 2: Choose Specific Capability to Load" : "クリック 2: デプロイする具体的な能力を選択してください"}
                  </p>
                  <button onClick={handleSimReset} className="text-[10px] text-indigo-500 font-bold hover:underline">
                    &larr; {isEn ? "Back" : "戻る"}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {simCapabilities[simulatorCategory || "tech"]?.map((cap) => (
                    <button
                      key={cap.id}
                      onClick={() => {
                        setSimulatorCapability(cap.name);
                        setSimulatorStep(3);
                      }}
                      className="p-4 bg-white dark:bg-neutral-900/40 border border-slate-200/50 dark:border-white/[0.04] hover:border-pink-500/30 dark:hover:border-pink-500/30 rounded-xl text-left transition-all duration-300 cursor-pointer hover:-translate-y-0.5 space-y-1"
                    >
                      <span className="text-xs font-black text-slate-800 dark:text-neutral-200 flex items-center gap-1.5">
                        <PlusCircle className="w-3.5 h-3.5 text-pink-500" />
                        {cap.name}
                      </span>
                      <p className="text-[10px] text-slate-400 dark:text-neutral-500 font-medium pl-5">{cap.desc}</p>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {simulatorStep === 3 && (
              <motion.div 
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-4"
              >
                <div className="flex justify-between items-center">
                  <p className="text-xs text-slate-400 dark:text-neutral-500 font-bold uppercase tracking-wider">
                    {isEn ? "Click 3: Deploy Capability to Workspace Active DNA" : "クリック 3: アクティブDNAとしてワークスペースに展開・同期"}
                  </p>
                  <button onClick={handleSimReset} className="text-[10px] text-indigo-500 font-bold hover:underline">
                    {isEn ? "Reset" : "リセット"}
                  </button>
                </div>
                
                <div className="p-4 bg-white dark:bg-neutral-900/30 border border-slate-200/50 dark:border-white/[0.04] rounded-xl flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-[9px] font-bold text-indigo-500 bg-indigo-500/5 px-2 py-0.5 rounded font-mono">SELECTED CAPABILITY</span>
                    <h4 className="text-xs font-black text-slate-800 dark:text-neutral-200">{simulatorCapability}</h4>
                  </div>
                  
                  <button
                    onClick={executeSimulatorDeploy}
                    disabled={isSimulatorDeploying}
                    className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-pink-600 text-white font-black text-xs rounded-xl shadow-lg shadow-indigo-500/10 cursor-pointer active:scale-95 transition-all duration-300 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isSimulatorDeploying ? (
                      <>
                        <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin"></span>
                        <span>{isEn ? "Deploying..." : "展開中..."}</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5" />
                        <span>{isEn ? "Deploy instantly (3rd Click)" : "今すぐデプロイ (第3クリック)"}</span>
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            )}

            {simulatorStep === 4 && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="text-center py-6 space-y-4"
              >
                <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center mx-auto text-emerald-500">
                  <CheckCircle2 className="w-6 h-6 animate-pulse" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-black text-slate-800 dark:text-neutral-200">
                    {isEn ? "Capability Added Successfully!" : "能力のデプロイが完了しました！"}
                  </h4>
                  <p className="text-xs text-slate-400 dark:text-neutral-500 max-w-md mx-auto leading-relaxed">
                    {isEn 
                      ? `"${simulatorCapability}" has been loaded and integrated into the Sovereign Workspace's intelligence graph in exactly 3 clicks.`
                      : `"${simulatorCapability}" は正確に3クリックでSovereignワークスペースのインテリジェンスグラフに読み込まれ、統合されました。`}
                  </p>
                </div>
                <button
                  onClick={handleSimReset}
                  className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-slate-700 dark:text-neutral-300 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                >
                  {isEn ? "Test Again" : "もう一度シミュレート"}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>

      {/* CORE DESIGN TOKENS GRID (2 Columns: Left is colors & spacing, right is typography & glass) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* LEFT COLUMN: COLOR & SPACING */}
        <div className="space-y-8">
          
          {/* COLOR TOKENS */}
          <div className="bg-white/40 dark:bg-neutral-900/10 backdrop-blur-2xl border border-slate-200/40 dark:border-white/[0.03] rounded-3xl p-6 shadow-xs space-y-6">
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-white/[0.02] pb-4">
              <Palette className="w-5 h-5 text-indigo-500" />
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">
                  {isEn ? "Color System Tokens (Sovereign Gamut)" : "カラーシステムトークン"}
                </h3>
                <p className="text-[11px] text-slate-400 dark:text-neutral-500 font-medium">
                  {isEn ? "Strict accent gating. Click swatches to copy variables." : "厳密なアクセント統制。クリックしてクリップボードにコピー可能。"}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {[
                { 
                  name: isEn ? "Silent Slate (Sovereign Canvas)" : "サイレントスレート (静寂の空間)", 
                  hex: "#09090b", 
                  tailwind: "bg-neutral-950", 
                  text: "text-white", 
                  desc: isEn ? "Base space container void." : "ベースとなる宇宙的空間、ノイズを極限まで低減。" 
                },
                { 
                  name: isEn ? "Intellect Indigo (Decision Matrix)" : "インテレクトインディゴ (知的探求)", 
                  hex: "#4f46e5", 
                  tailwind: "bg-indigo-600", 
                  text: "text-white", 
                  desc: isEn ? "Core intelligence pathing, logic links." : "AIの思考経路、ロジック接続、主要フォーカスに使用。" 
                },
                { 
                  name: isEn ? "Success Pink (Strategic Outcomes)" : "サクセスピンク (成果の証明)", 
                  hex: "#ec4899", 
                  tailwind: "bg-pink-500", 
                  text: "text-white", 
                  desc: isEn ? "Strategic ROI metrics and Q5 conditions." : "戦略的ROI指標、ミッション達成、成果物基準に使用。" 
                },
                { 
                  name: isEn ? "Confidence Blue (Evidence Trust)" : "コンフィデンスブルー (信頼性の指標)", 
                  hex: "#3b82f6", 
                  tailwind: "bg-blue-500", 
                  text: "text-white", 
                  desc: isEn ? "Evidence auditing, UQI factor validation." : "根拠情報の妥当性、ファクトチェック評価、監査に使用。" 
                },
                { 
                  name: isEn ? "Q5 Standard Amber (Supreme Release)" : "Q5基準アンバー (最高品質の証明)", 
                  hex: "#fbbf24", 
                  tailwind: "bg-amber-400", 
                  text: "text-neutral-950", 
                  desc: isEn ? "Sovereign quality benchmarks validation." : "ORIGIN Standard (Q5) 合格、最上位品質判定に使用。" 
                }
              ].map((swatch, idx) => (
                <div 
                  key={idx} 
                  onClick={() => copyToClipboard(swatch.hex, swatch.name)}
                  className="p-3 bg-slate-50/50 dark:bg-neutral-950/20 hover:bg-slate-100 dark:hover:bg-neutral-900/40 border border-slate-100 dark:border-white/[0.02] hover:border-slate-200 dark:hover:border-white/[0.06] rounded-2xl flex items-center gap-4 cursor-pointer group transition-all duration-300"
                >
                  <div className={cn("w-14 h-14 rounded-xl shrink-0 border border-black/10 flex items-center justify-center font-mono text-[9px] font-black tracking-tight shadow-sm group-hover:scale-105 transition-transform", swatch.tailwind, swatch.text)}>
                    HEX
                  </div>
                  <div className="space-y-1 w-full truncate">
                    <div className="flex justify-between items-center pr-2">
                      <span className="text-xs font-black text-slate-800 dark:text-neutral-200">{swatch.name}</span>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-mono text-slate-400 dark:text-neutral-500">{swatch.hex}</span>
                        {copiedColor === swatch.name ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="w-3 h-3 text-slate-400 dark:text-neutral-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-400 dark:text-neutral-500 font-medium leading-relaxed truncate">{swatch.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* SPACING GRID */}
          <div className="bg-white/40 dark:bg-neutral-900/10 backdrop-blur-2xl border border-slate-200/40 dark:border-white/[0.03] rounded-3xl p-6 shadow-xs space-y-6">
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-white/[0.02] pb-4">
              <Grid className="w-5 h-5 text-indigo-500" />
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">
                  {isEn ? "Spacing Scales (8px Fluid Grid)" : "スペーシングスケール (8px グリッド基準)"}
                </h3>
                <p className="text-[11px] text-slate-400 dark:text-neutral-500 font-medium">
                  {isEn ? "Rhythm through mathematical variation. Avoid uniform spacing." : "一様さを排除した美しさを担保するための数学的間隔規則。"}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {[
                { size: "8px", label: "0.5rem", tw: "h-2 w-2", desc: "Micro components gap, tiny margins" },
                { size: "16px", label: "1rem", tw: "h-4 w-4", desc: "Standard block paddings, lists items margin" },
                { size: "24px", label: "1.5rem", tw: "h-6 w-6", desc: "Responsive desktop grids gutter, mid headings gap" },
                { size: "32px", label: "2rem", tw: "h-8 w-8", desc: "Major card internal padding, screen side margins" },
                { size: "48px", label: "3rem", tw: "h-12 w-12", desc: "Section gutters, dramatic vertical separation" },
                { size: "64px", label: "4rem", tw: "h-16 w-16", desc: "Absolute display margin, sovereign header spacing" }
              ].map((sp, idx) => (
                <div key={idx} className="flex items-center gap-4 text-xs">
                  <span className="w-12 font-mono font-black text-indigo-500 text-right">{sp.size}</span>
                  <div className="flex-1 bg-slate-50 dark:bg-neutral-950/20 p-2 border border-slate-100 dark:border-white/[0.02] rounded-xl flex items-center gap-3">
                    <div className={cn("bg-indigo-500/10 border border-indigo-500/20 rounded-lg shrink-0 flex items-center justify-center text-[10px] font-bold text-indigo-600 dark:text-indigo-400 font-mono", sp.tw)}>
                    </div>
                    <div className="truncate">
                      <span className="text-[11px] font-bold text-slate-800 dark:text-neutral-200">{sp.label}</span>
                      <p className="text-[10px] text-slate-400 dark:text-neutral-500 font-medium truncate">{sp.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN: TYPOGRAPHY & GLASS */}
        <div className="space-y-8">
          
          {/* TYPOGRAPHY SCALE */}
          <div className="bg-white/40 dark:bg-neutral-900/10 backdrop-blur-2xl border border-slate-200/40 dark:border-white/[0.03] rounded-3xl p-6 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/[0.02] pb-4 gap-2">
              <div className="flex items-center gap-2">
                <Type className="w-5 h-5 text-indigo-500" />
                <div>
                  <h3 className="text-sm font-black text-slate-800 dark:text-white">
                    {isEn ? "Typography System (Inter & Mono)" : "タイポグラフィシステム仕様"}
                  </h3>
                  <p className="text-[11px] text-slate-400 dark:text-neutral-500 font-medium">
                    {isEn ? "Inter (UI elements & copy) paired with JetBrains Mono." : "Inter(汎用UI/文章) と JetBrains Mono(メタデータ/指標) の強固な対比。"}
                  </p>
                </div>
              </div>
            </div>

            {/* Scale adjustment slider */}
            <div className="p-3 bg-slate-50/50 dark:bg-neutral-950/20 rounded-2xl border border-slate-100 dark:border-white/[0.02] flex items-center justify-between gap-4">
              <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-neutral-500">
                {isEn ? "INTERACTIVE SIZE SCALE" : "インタラクティブ・プレビュー調整"}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button 
                  onClick={() => setFontScaleFactor(prev => Math.max(0.8, prev - 0.1))}
                  className="w-7 h-7 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-white/[0.04] rounded-lg text-xs font-bold hover:bg-slate-50 active:scale-95 cursor-pointer flex items-center justify-center text-slate-600 dark:text-neutral-300"
                >
                  -
                </button>
                <span className="text-xs font-mono font-bold text-indigo-500 w-12 text-center">{Math.round(fontScaleFactor * 100)}%</span>
                <button 
                  onClick={() => setFontScaleFactor(prev => Math.min(1.3, prev + 0.1))}
                  className="w-7 h-7 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-white/[0.04] rounded-lg text-xs font-bold hover:bg-slate-50 active:scale-95 cursor-pointer flex items-center justify-center text-slate-600 dark:text-neutral-300"
                >
                  +
                </button>
              </div>
            </div>

            <div className="space-y-4 pt-2">
              {/* Display Heading */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[9px] font-mono text-slate-400 dark:text-neutral-500 font-bold uppercase">
                  <span>Display (Inter Bold Tracking-tight)</span>
                  <span>30px</span>
                </div>
                <div 
                  style={{ fontSize: `${30 * fontScaleFactor}px` }} 
                  className="font-bold text-slate-900 dark:text-white leading-none tracking-tight font-sans"
                >
                  What is your next mission?
                </div>
              </div>

              {/* H1 Title */}
              <div className="space-y-1 border-t border-slate-100 dark:border-white/[0.01] pt-3">
                <div className="flex justify-between items-center text-[9px] font-mono text-slate-400 dark:text-neutral-500 font-bold uppercase">
                  <span>H1 Title (Inter Black)</span>
                  <span>24px</span>
                </div>
                <div 
                  style={{ fontSize: `${24 * fontScaleFactor}px` }} 
                  className="font-black text-slate-900 dark:text-white leading-tight font-sans"
                >
                  Sovereign Decision Matrix
                </div>
              </div>

              {/* H2 Title */}
              <div className="space-y-1 border-t border-slate-100 dark:border-white/[0.01] pt-3">
                <div className="flex justify-between items-center text-[9px] font-mono text-slate-400 dark:text-neutral-500 font-bold uppercase">
                  <span>H2 Header (Inter ExtraBold)</span>
                  <span>18px</span>
                </div>
                <div 
                  style={{ fontSize: `${18 * fontScaleFactor}px` }} 
                  className="font-extrabold text-slate-800 dark:text-slate-200 leading-snug font-sans"
                >
                  Specialized Autonomous Capability
                </div>
              </div>

              {/* Body Paragraph */}
              <div className="space-y-1 border-t border-slate-100 dark:border-white/[0.01] pt-3">
                <div className="flex justify-between items-center text-[9px] font-mono text-slate-400 dark:text-neutral-500 font-bold uppercase">
                  <span>Body Copy (Inter Medium Leading-relaxed)</span>
                  <span>12px</span>
                </div>
                <div 
                  style={{ fontSize: `${12 * fontScaleFactor}px` }} 
                  className="font-medium text-slate-500 dark:text-neutral-400 leading-relaxed font-sans"
                >
                  {isEn 
                    ? "Our strategic intelligence engine performs rigorous multi-agent reasoning, validating all evidence against primary factual databases before outputting deliverables."
                    : "私たちの戦略的インテリジェンスエンジンは、厳格なマルチエージェント推論を実行し、一次ファクトデータベースに照らして証拠を検証した上で成果物を出力します。"}
                </div>
              </div>

              {/* Monospace Metric */}
              <div className="space-y-1 border-t border-slate-100 dark:border-white/[0.01] pt-3">
                <div className="flex justify-between items-center text-[9px] font-mono text-slate-400 dark:text-neutral-500 font-bold uppercase">
                  <span>Metric Indicator (JetBrains Mono Bold)</span>
                  <span>10px</span>
                </div>
                <div 
                  style={{ fontSize: `${10 * fontScaleFactor}px` }} 
                  className="font-bold text-pink-600 dark:text-pink-400 font-mono tracking-wider"
                >
                  UQI_EVAL_FACTOR = 98.42% [VERIFIED]
                </div>
              </div>
            </div>
          </div>

          {/* GLASS SYSTEM SIMULATOR */}
          <div className="bg-white/40 dark:bg-neutral-900/10 backdrop-blur-2xl border border-slate-200/40 dark:border-white/[0.03] rounded-3xl p-6 shadow-xs space-y-6">
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-white/[0.02] pb-4">
              <Sliders className="w-5 h-5 text-indigo-500" />
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">
                  {isEn ? "Interactive Glassmorphism System" : "グラスモルフィズム設計シミュレーター"}
                </h3>
                <p className="text-[11px] text-slate-400 dark:text-neutral-500 font-medium">
                  {isEn ? "Configure backdrop blur, transparency layers, and borders." : "背景のぼかし、白色レイヤー不透明度、境界線の細部を直感的にシミュレート可能。"}
                </p>
              </div>
            </div>

            {/* Backplate Selection */}
            <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 dark:bg-neutral-900/60 rounded-full border border-slate-200/40 dark:border-white/[0.02]">
              {[
                { id: "cosmic", label: "Cosmic" },
                { id: "aurora", label: "Aurora" },
                { id: "void", label: "Void" }
              ].map((bg) => (
                <button
                  key={bg.id}
                  onClick={() => setGlassBackground(bg.id as any)}
                  className={cn(
                    "py-1 rounded-full text-[10px] font-bold transition-all duration-300 cursor-pointer",
                    glassBackground === bg.id
                      ? "bg-white dark:bg-neutral-800 text-indigo-600 dark:text-indigo-400 shadow-xs"
                      : "text-slate-400 hover:text-slate-700 dark:hover:text-neutral-300"
                  )}
                >
                  {bg.label}
                </button>
              ))}
            </div>

            {/* Simulation Canvas with background glows */}
            <div className="h-44 w-full rounded-2xl relative overflow-hidden flex items-center justify-center p-6 border border-slate-200/20 shadow-inner">
              
              {/* Animated glow backgrounds depending on selection */}
              {glassBackground === "cosmic" && (
                <div className="absolute inset-0 bg-slate-950 flex items-center justify-center">
                  <div className="w-48 h-48 rounded-full bg-indigo-500/40 blur-3xl animate-pulse"></div>
                  <div className="w-32 h-32 rounded-full bg-pink-500/30 blur-2xl animate-bounce -mt-10 -ml-10"></div>
                </div>
              )}
              {glassBackground === "aurora" && (
                <div className="absolute inset-0 bg-neutral-900 flex items-center justify-center">
                  <div className="w-64 h-64 rounded-full bg-emerald-500/35 blur-3xl animate-pulse -mt-12"></div>
                  <div className="w-48 h-48 rounded-full bg-indigo-500/25 blur-3xl animate-pulse ml-12"></div>
                </div>
              )}
              {glassBackground === "void" && (
                <div className="absolute inset-0 bg-zinc-950">
                  <div className="absolute top-2 left-10 w-2 h-2 rounded-full bg-white/25"></div>
                  <div className="absolute bottom-6 right-12 w-1.5 h-1.5 rounded-full bg-white/10"></div>
                </div>
              )}

              {/* Simulated Glass Panel */}
              <div 
                style={{ 
                  backdropFilter: `blur(${glassBlur}px)`,
                  backgroundColor: `rgba(255, 255, 255, ${glassOpacity / 100})`,
                  borderColor: `rgba(255, 255, 255, ${glassBorderOpacity / 100})`
                }}
                className="w-full h-full rounded-2xl border relative z-10 p-4 flex flex-col justify-between shadow-lg text-white"
              >
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-bold tracking-widest font-mono text-white/80">SOVEREIGN_GLASS_B3</span>
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-black">Visual Readability Confirmed</div>
                  <p className="text-[9px] text-white/70 font-medium leading-relaxed max-w-xs">
                    This spatial container matches the premium design standard. Adjust values to verify contrasting read behaviors.
                  </p>
                </div>
              </div>
            </div>

            {/* Control Sliders */}
            <div className="space-y-4 text-xs font-mono font-bold text-slate-500">
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span>BACKDROP BLUR (px)</span>
                  <span className="text-indigo-500">{glassBlur}px</span>
                </div>
                <input 
                  type="range" 
                  min="4" 
                  max="40" 
                  value={glassBlur} 
                  onChange={(e) => setGlassBlur(Number(e.target.value))} 
                  className="w-full accent-indigo-600"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span>WHITE BACKPLATE OPACITY (%)</span>
                  <span className="text-indigo-500">{glassOpacity}%</span>
                </div>
                <input 
                  type="range" 
                  min="5" 
                  max="60" 
                  value={glassOpacity} 
                  onChange={(e) => setGlassOpacity(Number(e.target.value))} 
                  className="w-full accent-indigo-600"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span>BORDER LAYER OPACITY (%)</span>
                  <span className="text-indigo-500">{glassBorderOpacity}%</span>
                </div>
                <input 
                  type="range" 
                  min="2" 
                  max="40" 
                  value={glassBorderOpacity} 
                  onChange={(e) => setGlassBorderOpacity(Number(e.target.value))} 
                  className="w-full accent-indigo-600"
                />
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* INTERACTIVE ANIMATION & micro-INTERACTION MATRIX */}
      <div className="bg-white/40 dark:bg-neutral-900/10 backdrop-blur-2xl border border-slate-200/40 dark:border-white/[0.03] rounded-3xl p-6 shadow-xs space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-white/[0.02] pb-4">
          <div className="space-y-1 flex items-center gap-2">
            <Zap className="w-5 h-5 text-pink-500 animate-pulse" />
            <div>
              <h3 className="text-sm font-black text-slate-800 dark:text-white">
                {isEn ? "Quantum Animation & Interactive Physics Playground" : "アニメーション物理挙動検証パネル"}
              </h3>
              <p className="text-[11px] text-slate-400 dark:text-neutral-500 font-medium">
                {isEn ? "All transitions must achieve purpose and resolve in <300ms. Select curve parameters to test." : "全ての画面遷移・フィードバックは300ms以内に静かに完了すること。"}
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono font-bold text-pink-600 bg-pink-500/5 px-2 py-0.5 rounded border border-pink-500/10">
            MAX ALLOWED LATENCY: 300ms
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Curve Selector */}
          <div className="space-y-4">
            <span className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest font-mono block">
              Cubic Bezier Preset Curves
            </span>
            
            <div className="space-y-2">
              {[
                { 
                  id: "apple", 
                  title: "Apple Human Spring (Calm)", 
                  bezier: "cubic-bezier(0.16, 1, 0.3, 1)", 
                  desc: isEn ? "Ultra-smooth decelerated flow, highly organic." : "極めて滑らかで自然な減速。迷わせない主要遷移に使用。" 
                },
                { 
                  id: "quantum", 
                  title: "Quantum Spring (Bounce)", 
                  bezier: "cubic-bezier(0.34, 1.56, 0.64, 1)", 
                  desc: isEn ? "Dynamic overshoot spring. Great for visual achievements." : "確固たる達成感。カードのポップアップや成功判定に使用。" 
                },
                { 
                  id: "linear", 
                  title: "Strict Corporate Linear", 
                  bezier: "cubic-bezier(0.25, 0.25, 0.75, 0.75)", 
                  desc: isEn ? "No micro-spring curves. Rigid standard." : "物理的なエッジのない直進型、標準的なデータの更新等に使用。" 
                }
              ].map((curve) => (
                <button
                  key={curve.id}
                  onClick={() => setSelectedCurve(curve.id as any)}
                  className={cn(
                    "w-full p-4 rounded-2xl border text-left transition-all duration-300 cursor-pointer flex flex-col justify-between min-h-[100px]",
                    selectedCurve === curve.id
                      ? "bg-indigo-500/5 border-indigo-500/30 text-indigo-600 dark:text-indigo-400 shadow-sm"
                      : "bg-slate-50 dark:bg-neutral-900/30 border-transparent hover:border-slate-200 text-slate-500 dark:text-neutral-400"
                  )}
                >
                  <div className="space-y-1">
                    <span className="text-xs font-black">{curve.title}</span>
                    <p className="text-[10px] text-slate-400 dark:text-neutral-500 font-medium leading-relaxed">{curve.desc}</p>
                  </div>
                  <span className="text-[9px] font-mono font-bold text-slate-400 mt-2">{curve.bezier}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Test Physics Arena */}
          <div className="lg:col-span-2 space-y-4">
            <span className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest font-mono block">
              Physics Sandbox Area
            </span>

            <div className="h-48 w-full bg-slate-50/50 dark:bg-neutral-950/20 border border-slate-200/50 dark:border-white/[0.02] rounded-2xl relative overflow-hidden flex flex-col justify-between p-4">
              
              {/* Grid Lines in sandbox */}
              <div className="absolute inset-0 bg-grid-slate-200/5 bg-[size:16px_16px] pointer-events-none opacity-40"></div>

              {/* Start & End boundaries */}
              <div className="flex justify-between text-[9px] font-mono text-slate-400 dark:text-neutral-500">
                <span>START_X (0%)</span>
                <span>TARGET_X (100%)</span>
              </div>

              {/* Physics Object Block */}
              <div className="relative h-14 w-full flex items-center px-4">
                <motion.div
                  animate={{ 
                    x: animationTrigger ? "calc(100% - 40px)" : "0px" 
                  }}
                  transition={{ 
                    duration: selectedCurve === "linear" ? 0.3 : 0.4, 
                    ease: selectedCurve === "apple" ? [0.16, 1, 0.3, 1] : selectedCurve === "quantum" ? [0.34, 1.56, 0.64, 1] : "linear"
                  }}
                  className="w-10 h-10 rounded-xl bg-gradient-to-r from-indigo-500 to-pink-500 flex items-center justify-center text-white text-xs font-black shrink-0 shadow-lg shadow-indigo-500/10 z-10"
                >
                  OS3
                </motion.div>
                
                {/* Horizontal reference track */}
                <div className="absolute left-4 right-10 h-0.5 bg-slate-200 dark:bg-white/[0.04]"></div>
              </div>

              {/* Performance Telemetry */}
              <div className="flex justify-between items-center text-[10px] font-mono font-bold">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping"></span>
                  <span className="text-slate-500">{isEn ? "TELEMETRY:" : "物理テレメトリー:"}</span>
                  <span className="text-indigo-600 dark:text-indigo-400">
                    {isAnimating ? (isEn ? "TESTING..." : "測定中...") : `${measuredTime}ms`}
                  </span>
                </div>
                
                <button
                  onClick={triggerAnimationTest}
                  disabled={isAnimating}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-sm font-sans"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{isEn ? "Trigger Physics" : "挙動テスト実行"}</span>
                </button>
              </div>
            </div>

            {/* Constraints Audit Rules */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="p-3 bg-white dark:bg-neutral-900/30 border border-slate-200/50 dark:border-white/[0.04] rounded-xl flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                <div>
                  <h4 className="text-[11px] font-black text-slate-800 dark:text-neutral-200">{isEn ? "Zero gratuitous motion" : "目的のないアニメーション排除"}</h4>
                  <p className="text-[10px] text-slate-400 dark:text-neutral-500 font-medium leading-normal">
                    {isEn ? "Only animate when changing hierarchy context or confirming strategic deliverables." : "階層構造の変化や、戦略的決定を下した際の通知のみアニメーションを許容。"}
                  </p>
                </div>
              </div>

              <div className="p-3 bg-white dark:bg-neutral-900/30 border border-slate-200/50 dark:border-white/[0.04] rounded-xl flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                <div>
                  <h4 className="text-[11px] font-black text-slate-800 dark:text-neutral-200">{isEn ? "Immediate spatial feedback" : "即時の空間フィードバック"}</h4>
                  <p className="text-[10px] text-slate-400 dark:text-neutral-500 font-medium leading-normal">
                    {isEn ? "Inputs and button triggers should reflect a slight shrink (active:scale-95) to emulate hardware clicking." : "ボタン押下は物理的なキーボードを叩くように極めて僅かな縮小(active:scale-95)を実行。"}
                  </p>
                </div>
              </div>
            </div>

          </div>

        </div>
      </div>

      {/* COMPONENT SPECIFICATIONS (Figma-level Interactive Library) */}
      <div className="bg-white/40 dark:bg-neutral-900/10 backdrop-blur-2xl border border-slate-200/40 dark:border-white/[0.03] rounded-3xl p-6 shadow-xs space-y-6">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/[0.02] pb-4">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest font-mono">
              Figma UI Component Specifications
            </span>
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white">
              {isEn ? "Active System-Styled Core Components" : "コアUIコンポーネント・ショーケース"}
            </h3>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Glass Card Component Description & Spec */}
          <div className="p-5 bg-slate-50/50 dark:bg-neutral-950/20 border border-slate-200/50 dark:border-white/[0.02] rounded-2xl space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-white/[0.01]">
              <span className="text-[10px] font-black text-indigo-500 font-mono">01_SOVEREIGN_GLASS_CARD</span>
              <span className="text-[9px] font-mono text-slate-400">Figma Layer Standard</span>
            </div>

            {/* Component Demo */}
            <div className="p-4 bg-gradient-to-br from-indigo-950/30 via-slate-900/20 to-black/10 border border-indigo-500/10 rounded-2xl backdrop-blur-md relative overflow-hidden">
              <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse"></div>
              <h4 className="text-xs font-black text-slate-800 dark:text-white flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-indigo-500" />
                Fidelity Asset Card
              </h4>
              <p className="text-[10px] text-slate-400 dark:text-neutral-500 mt-1 leading-relaxed">
                Rendered container with fine high-contrast thin outline mimicking Apple.
              </p>
            </div>

            {/* Spec breakdown */}
            <ul className="text-[10px] font-mono font-bold text-slate-400 dark:text-neutral-500 space-y-1.5">
              <li>• BACKDROP-BLUR: 24px (backdrop-blur-2xl)</li>
              <li>• BORDER: 1px SOLID white/[0.03] (dark) | slate-200/40 (light)</li>
              <li>• CORNER-RADIUS: 24px (rounded-3xl)</li>
              <li>• SHADOW: Subtle slate elevation / no pitch dark shadow</li>
            </ul>
          </div>

          {/* Segmented Controller Description & Spec */}
          <div className="p-5 bg-slate-50/50 dark:bg-neutral-950/20 border border-slate-200/50 dark:border-white/[0.02] rounded-2xl space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-white/[0.01]">
              <span className="text-[10px] font-black text-pink-500 font-mono">02_SEGMENTED_CONTROLLER</span>
              <span className="text-[9px] font-mono text-slate-400">iOS-Inspired Selector</span>
            </div>

            {/* Component Demo */}
            <div className="flex bg-slate-100 dark:bg-neutral-900/40 p-1 rounded-full border border-slate-200/30 dark:border-white/[0.02] max-w-xs mx-auto">
              <div className="flex-1 text-center py-1 bg-white dark:bg-neutral-800 rounded-full text-[10px] font-bold text-indigo-600 dark:text-indigo-400 shadow-xs">
                Active View
              </div>
              <div className="flex-1 text-center py-1 text-[10px] font-bold text-slate-400">
                Secondary
              </div>
            </div>

            {/* Spec breakdown */}
            <ul className="text-[10px] font-mono font-bold text-slate-400 dark:text-neutral-500 space-y-1.5">
              <li>• INNER CONTAINER: bg-slate-100 | dark:bg-neutral-900/60</li>
              <li>• ACTIVE HIGHLIGHTER: bg-white | dark:bg-neutral-800 with fine shadow</li>
              <li>• TEXT ACTIVE: Indigo-600 | Indigo-400</li>
              <li>• TRANSITION: ease-out 300ms</li>
            </ul>
          </div>

          {/* Commander Input Description & Spec */}
          <div className="p-5 bg-slate-50/50 dark:bg-neutral-950/20 border border-slate-200/50 dark:border-white/[0.02] rounded-2xl space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-white/[0.01]">
              <span className="text-[10px] font-black text-indigo-500 font-mono">03_COMMANDER_INPUT_FIELD</span>
              <span className="text-[9px] font-mono text-slate-400">Direct Entry Matrix</span>
            </div>

            {/* Component Demo */}
            <div className="bg-white/80 dark:bg-neutral-950/20 rounded-2xl border border-indigo-500/20 p-2.5 flex items-center justify-between shadow-sm max-w-md mx-auto">
              <span className="text-[10px] font-semibold text-slate-400 pl-2">Describe target outcome...</span>
              <button className="px-3 py-1.5 bg-indigo-600 text-white font-bold text-[10px] rounded-lg">Execute</button>
            </div>

            {/* Spec breakdown */}
            <ul className="text-[10px] font-mono font-bold text-slate-400 dark:text-neutral-500 space-y-1.5">
              <li>• FOCUS RING: ring-8 ring-indigo-500/5 scale-[1.002]</li>
              <li>• PLACEHOLDER: Slate-400 | Neutral-600 font-semibold</li>
              <li>• ACTIVE SCALING: Scale transition on command submit</li>
              <li>• BORDER TRANSITION: 500ms ease border-indigo-500/40</li>
            </ul>
          </div>

          {/* Action List items Description & Spec */}
          <div className="p-5 bg-slate-50/50 dark:bg-neutral-950/20 border border-slate-200/50 dark:border-white/[0.02] rounded-2xl space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-white/[0.01]">
              <span className="text-[10px] font-black text-pink-500 font-mono">04_ACTION_GLOW_LIST_ITEM</span>
              <span className="text-[9px] font-mono text-slate-400">Interaction Trigger</span>
            </div>

            {/* Component Demo */}
            <div className="p-3 bg-white/40 dark:bg-neutral-900/10 border border-pink-500/10 rounded-2xl hover:border-pink-500/20 hover:bg-white/80 dark:hover:bg-neutral-900/30 transition-all flex items-center justify-between cursor-pointer max-w-sm mx-auto group">
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-lg bg-pink-500/10 flex items-center justify-center text-pink-500 font-bold text-[10px]">P</div>
                <span className="text-xs font-black text-slate-800 dark:text-neutral-200 group-hover:text-pink-600">Strategic SWOT Analysis</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
            </div>

            {/* Spec breakdown */}
            <ul className="text-[10px] font-mono font-bold text-slate-400 dark:text-neutral-500 space-y-1.5">
              <li>• CONTAINER HOVER: bg-pink-500/[0.03] or white/80</li>
              <li>• ICON SCALE: Scale item up by 105% on hover</li>
              <li>• TEXT HOVER TRANSITION: color fade to pink-600 | pink-400</li>
              <li>• CHEVRON BEHAVIOR: translate X by 2px on item focus</li>
            </ul>
          </div>

        </div>
      </div>

      {/* FINAL RULE BANNER */}
      <div className="p-5 bg-indigo-50 border border-indigo-100 dark:bg-indigo-950/20 dark:border-indigo-500/20 rounded-2xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-950/60 flex items-center justify-center shrink-0">
            <span className="text-indigo-600 dark:text-indigo-400 font-black text-lg">!</span>
          </div>
          <div>
            <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider font-mono">
              The Sovereign Design Rule
            </p>
            <p className="text-sm text-indigo-900 dark:text-slate-300 font-black leading-relaxed">
              {isEn 
                ? "Simplicity is the ultimate sophistication. Under 3 clicks to load resources, under 300ms to resolve transitions, zero visual noise in margins."
                : "シンプルさは究極の洗練である。能力追加は3クリック以内、画面遷移は300ms以内、余白のノイズは完全に排除すること。"}
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}
