import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  ShieldCheck, 
  ShieldAlert, 
  RefreshCw, 
  Play, 
  CheckCircle2, 
  XCircle, 
  ArrowRight, 
  Sparkles, 
  BookOpen, 
  Terminal,
  HelpCircle
} from "lucide-react";
import { AnalysisResult } from "../../types";
import { 
  validateMissionQuality, 
  VALIDATION_TEST_CASES, 
  ValidationResult, 
  ValidationTestCase 
} from "../../utils/MissionValidator";
import { SovereignGlassCard, SovereignButton } from "../SovereignComponents";

interface Props {
  result: AnalysisResult;
  onValidationSuccess?: (isValid: boolean) => void;
}

export default function MissionValidatorView({ result, onValidationSuccess }: Props) {
  // Use current mission data as default inputs
  const defaultRequest = result.mission?.goal || "旅行日程の作成：京都に2泊3日で観光、美味しい温泉や寺院を巡りたい";
  const defaultOutput = result.result?.executiveSummary || "京都観光プラン：初日は嵐山温泉、2日目は金閣寺と清水寺を巡る最高の日程表を完全アセンブル提供";

  const [requestInput, setRequestInput] = useState(defaultRequest);
  const [outputInput, setOutputInput] = useState(defaultOutput);
  
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [activeTestCase, setActiveTestCase] = useState<string | null>(null);

  // Run the validator using the backend endpoint
  const runValidator = async (reqText: string, outText: string) => {
    setIsValidating(true);
    try {
      const response = await fetch("/api/v1/validate-mission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: reqText, output: outText })
      });
      if (!response.ok) throw new Error("Backend validation failed");
      const data: ValidationResult & { engine?: string } = await response.json();
      setValidationResult(data);
      if (onValidationSuccess) {
        onValidationSuccess(data.success);
      }
    } catch (err) {
      console.error("Fetch validator error, using fallback local engine:", err);
      // Local fallback
      const local = validateMissionQuality(reqText, outText);
      setValidationResult(local);
      if (onValidationSuccess) {
        onValidationSuccess(local.success);
      }
    } finally {
      setIsValidating(false);
    }
  };

  const handleTestBenchClick = (tc: ValidationTestCase) => {
    setActiveTestCase(tc.id);
    setRequestInput(tc.request);
    setOutputInput(tc.output);
    // Run validation immediately for the selected test case
    runValidator(tc.request, tc.output);
  };

  const getCategoryColor = (cat: string) => {
    const lower = (cat || "").toLowerCase();
    if (lower.includes("code") || lower.includes("database") || lower.includes("security") || lower.includes("network") || lower.includes("math")) {
      return "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20";
    }
    if (lower.includes("legal") || lower.includes("compliance")) {
      return "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20";
    }
    if (lower.includes("marketing") || lower.includes("finance") || lower.includes("project") || lower.includes("consulting") || lower.includes("spreadsheet") || lower.includes("presentation")) {
      return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
    }
    if (lower.includes("creative") || lower.includes("image") || lower.includes("voice") || lower.includes("video") || lower.includes("design") || lower.includes("game")) {
      return "bg-pink-500/10 text-pink-400 border border-pink-500/20";
    }
    if (lower.includes("travel")) {
      return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
    }
    return "bg-teal-500/10 text-teal-400 border border-teal-500/20";
  };

  return (
    <div className="space-y-6" id="mission-quality-validator-root">
      
      {/* 1. Header Banner */}
      <div className="bg-zinc-950 border border-white/5 rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-400" />
              <span className="text-[10px] bg-indigo-500/15 text-indigo-300 font-mono font-bold px-2.5 py-0.5 rounded-full border border-indigo-500/20 uppercase tracking-widest">
                ACOS Build 013 : Mission Quality Validator
              </span>
            </div>
            <h3 className="text-lg font-black text-white tracking-tight">Mission Quality Validator (MQV)</h3>
            <p className="text-xs text-white/50">
              ユーザーの「本音・依頼内容」と「AI成果物（アウトプット）」の整合性をコード化されたルールおよび認知モデルで自動検知します。不整合を検出し、ミッションの品質を保証します。
            </p>
          </div>
          
          <button
            onClick={() => runValidator(requestInput, outputInput)}
            disabled={isValidating}
            aria-label="ミッション整合性検証を実行"
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 disabled:from-white/10 disabled:to-white/10 text-black text-xs font-bold font-mono transition-all shadow-lg shadow-indigo-500/10 flex items-center justify-center gap-2 shrink-0 cursor-pointer"
          >
            {isValidating ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {isValidating ? "スキャニング中..." : "整合性検証を起動"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* 2. Left side: Playground / Workspace */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-black/40 border border-white/5 rounded-2xl p-5 space-y-4">
            <span className="text-[10px] font-mono tracking-wider text-white/45 uppercase block border-b border-white/5 pb-2">
              検証用データ入力（ライブ検証）
            </span>
            
            {/* Request Field */}
            <div className="space-y-1.5">
              <label htmlFor="user-request-input" className="text-[10px] text-white/50 font-mono uppercase block">
                ユーザーの依頼・目的 (User Request Goal)
              </label>
              <textarea
                id="user-request-input"
                className="w-full h-24 bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-white/30 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-sans resize-none"
                placeholder="ユーザーが入力した依頼プロンプト..."
                value={requestInput}
                onChange={(e) => {
                  setRequestInput(e.target.value);
                  setActiveTestCase(null);
                }}
              />
            </div>

            {/* Output Field */}
            <div className="space-y-1.5">
              <label htmlFor="ai-output-input" className="text-[10px] text-white/50 font-mono uppercase block">
                AI成果物 (Generated Mission Artifact)
              </label>
              <textarea
                id="ai-output-input"
                className="w-full h-28 bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-white/30 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-mono resize-none"
                placeholder="AIが生成した成果物文書..."
                value={outputInput}
                onChange={(e) => {
                  setOutputInput(e.target.value);
                  setActiveTestCase(null);
                }}
              />
            </div>

            {/* Hint Box */}
            <div className="flex items-start gap-2 p-3 bg-white/5 rounded-xl text-[10px] text-white/45">
              <HelpCircle className="w-4 h-4 text-white/35 shrink-0 mt-0.5" />
              <p className="leading-normal">
                上記のテキストは自由に変更可能です。カテゴリ（旅行、法律、営業、技術、デザイン、汎用）を表すキーワードが含まれている場合、コード化された判定規則がそれを自動分類し、不整合をあぶり出します。
              </p>
            </div>
          </div>
        </div>

        {/* 3. Right side: Scan & Results Panel */}
        <div className="lg:col-span-5 space-y-4">
          <AnimatePresence mode="wait">
            
            {/* Case: Validating animation */}
            {isValidating && (
              <motion.div
                key="validating"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="bg-zinc-950 border border-indigo-500/20 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[300px] text-center space-y-4"
              >
                <div className="relative">
                  <div className="absolute inset-0 bg-indigo-500/20 rounded-full blur-xl animate-pulse" />
                  <RefreshCw className="w-10 h-10 text-indigo-400 animate-spin relative" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-white font-mono tracking-widest uppercase">SCANNING ALIGNMENT</h4>
                  <p className="text-[10px] text-white/50">カテゴリ不整合・認知適合性をスキャンしています...</p>
                </div>
                <div className="w-32 bg-white/10 h-1 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 animate-pulse" style={{ width: "60%" }} />
                </div>
              </motion.div>
            )}

            {/* Case: Result is present */}
            {!isValidating && validationResult && (
              <motion.div
                key="result"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`border rounded-2xl p-6 min-h-[300px] flex flex-col justify-between space-y-4 ${
                  validationResult.success 
                    ? "bg-emerald-950/10 border-emerald-500/30" 
                    : "bg-rose-950/10 border-rose-500/30"
                }`}
              >
                <div className="space-y-4">
                  {/* Status header */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono tracking-wider text-white/50 uppercase">VALIDATION RESULTS</span>
                    <span className={`text-[10px] font-black font-mono tracking-wider px-2.5 py-0.5 rounded border uppercase ${
                      validationResult.success
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                    }`}>
                      {validationResult.success ? "SUCCESS" : "FAILED (MISMATCH)"}
                    </span>
                  </div>

                  {/* Big visual indicator */}
                  <div className="flex items-center gap-4">
                    {validationResult.success ? (
                      <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                    ) : (
                      <div className="w-12 h-12 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-full flex items-center justify-center shrink-0">
                        <ShieldAlert className="w-6 h-6 animate-bounce" />
                      </div>
                    )}
                    <div>
                      <h4 className="text-sm font-extrabold text-white">
                        {validationResult.success ? "依頼と成果物が適合しています" : "依頼と成果物に不整合を検出"}
                      </h4>
                      <p className="text-[9.5px] text-white/40 font-mono">
                        Alignment Score: <span className={validationResult.success ? "text-emerald-400" : "text-rose-400"}>{validationResult.matchScore}%</span>
                      </p>
                    </div>
                  </div>

                  {/* Category matching visualization */}
                  <div className="p-3.5 bg-black/40 border border-white/5 rounded-xl space-y-4">
                    
                    {/* Mission Complexity Badge & Explanation */}
                    <div className="space-y-1.5 border-b border-white/5 pb-3">
                      <div className="flex items-center justify-between text-[9px] text-white/40 uppercase font-mono">
                        <span>Mission Complexity</span>
                        <span className="text-[8.5px] bg-white/5 px-1.5 py-0.2 rounded font-mono">AUTO DETECTED</span>
                      </div>
                      <div className="flex items-center gap-2 text-left">
                        <span className={`text-[9.5px] font-black font-mono tracking-wider px-2 py-0.5 rounded border uppercase shrink-0 ${
                          validationResult.complexity === "Very High"
                            ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                            : validationResult.complexity === "High"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                              : validationResult.complexity === "Medium"
                                ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        }`}>
                          {validationResult.complexity || "Medium"}
                        </span>
                        <p className="text-[10px] text-white/70 leading-normal font-sans">
                          {validationResult.complexityReason || "標準的な難易度のタスク構成です。"}
                        </p>
                      </div>
                    </div>

                    {/* Category Matching with Keyword Evidence */}
                    <div className="space-y-2 border-b border-white/5 pb-3">
                      <div className="grid grid-cols-2 gap-3 text-center text-[10px]">
                        <div className="space-y-1 text-left">
                          <div className="text-white/40 font-mono uppercase text-[8px] tracking-wider">Request Category</div>
                          <div className={`px-2 py-1 rounded text-[10px] font-bold text-center ${getCategoryColor(validationResult.requestCategory)}`}>
                            {validationResult.requestCategory}
                          </div>
                          
                          <div className="pt-1.5 space-y-1">
                            <span className="text-[8.5px] text-white/35 uppercase font-mono block">理由 (抽出キーワード):</span>
                            <div className="flex flex-wrap gap-1">
                              {validationResult.requestEvidence && validationResult.requestEvidence.length > 0 ? (
                                validationResult.requestEvidence.map((word, idx) => (
                                  <span key={idx} className="bg-white/5 border border-white/5 text-white/60 text-[8.5px] px-1 py-0.2 rounded font-mono">
                                    ・{word}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[8px] text-white/30 italic">文脈キーワード</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1 text-left border-l border-white/5 pl-3">
                          <div className="text-white/40 font-mono uppercase text-[8px] tracking-wider">Output Category</div>
                          <div className={`px-2 py-1 rounded text-[10px] font-bold text-center ${getCategoryColor(validationResult.outputCategory)}`}>
                            {validationResult.outputCategory}
                          </div>
                          
                          <div className="pt-1.5 space-y-1">
                            <span className="text-[8.5px] text-white/35 uppercase font-mono block">理由 (抽出キーワード):</span>
                            <div className="flex flex-wrap gap-1">
                              {validationResult.outputEvidence && validationResult.outputEvidence.length > 0 ? (
                                validationResult.outputEvidence.map((word, idx) => (
                                  <span key={idx} className="bg-white/5 border border-white/5 text-white/60 text-[8.5px] px-1 py-0.2 rounded font-mono">
                                    ・{word}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[8px] text-white/30 italic">成果物キーワード</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Why this Provider Card */}
                    {validationResult.recommendedProvider && (
                      <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl space-y-2 text-left">
                        <div className="flex items-center justify-between text-[9px] border-b border-indigo-500/15 pb-1">
                          <span className="text-indigo-300 font-mono font-bold uppercase flex items-center gap-1">
                            <Sparkles className="w-2.5 h-2.5 animate-pulse" />
                            Why this Provider? (選定理由)
                          </span>
                          <span className="text-indigo-200 font-mono font-bold bg-indigo-500/25 px-1.5 py-0.2 rounded text-[8.5px]">
                            Overall Score: {validationResult.recommendedProvider.overallScore || 0}
                          </span>
                        </div>
                        
                        <div className="text-[11px] font-bold text-white">
                          {validationResult.recommendedProvider.name} <span className="text-[8.5px] text-white/40 font-mono font-normal">({validationResult.recommendedProvider.provider})</span>
                        </div>
                        
                        <p className="text-[10px] text-indigo-100/85 leading-relaxed italic">
                          💡 {validationResult.recommendedProvider.selectionReason || "要求された能力の適合性、高水準な品質スコア、健全な稼働ステータスを総合的に評価し、最適にルーティングされました。"}
                        </p>

                        {/* Detailed Metrics */}
                        <div className="grid grid-cols-4 gap-1 text-center text-[8.5px] font-mono font-bold pt-1.5">
                          <div className="bg-black/40 border border-white/5 p-1 rounded">
                            <div className="text-white/40 text-[7px] uppercase">Quality</div>
                            <div className="text-indigo-300">{validationResult.recommendedProvider.quality}/10</div>
                          </div>
                          <div className="bg-black/40 border border-white/5 p-1 rounded">
                            <div className="text-white/40 text-[7px] uppercase">Cost</div>
                            <div className="text-emerald-400">{11 - validationResult.recommendedProvider.cost}/10</div>
                          </div>
                          <div className="bg-black/40 border border-white/5 p-1 rounded">
                            <div className="text-white/40 text-[7px] uppercase">Latency</div>
                            <div className="text-cyan-300">{validationResult.recommendedProvider.latency}ms</div>
                          </div>
                          <div className="bg-black/40 border border-white/5 p-1 rounded">
                            <div className="text-white/40 text-[7px] uppercase">Health</div>
                            <div className="text-emerald-400">10/10</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* TOP3 Recommended Providers Rankings */}
                    {validationResult.top3Providers && validationResult.top3Providers.length > 0 && (
                      <div className="space-y-1.5 pt-2 border-t border-white/5">
                        <div className="text-[9px] text-white/40 font-mono uppercase tracking-wider text-left">Recommended Provider TOP3</div>
                        <div className="space-y-1">
                          {validationResult.top3Providers.map((prov: any, idx: number) => {
                            const rankLabel = idx === 0 ? "1位" : idx === 1 ? "2位" : "3位";
                            const rankColor = idx === 0 ? "text-indigo-400 font-bold" : idx === 1 ? "text-slate-300" : "text-amber-600/80";
                            return (
                              <div key={prov.id} className="flex items-center justify-between p-1.5 rounded bg-white/[0.01] border border-white/5 text-[10.5px] hover:bg-white/[0.03] transition-colors text-left">
                                <div className="flex items-center gap-1.5">
                                  <span className={`text-[9.5px] w-5 font-mono ${rankColor}`}>{rankLabel}</span>
                                  <span className="font-semibold text-white truncate max-w-[120px]">{prov.name}</span>
                                  <span className="text-[7.5px] text-white/35 font-mono">({prov.provider})</span>
                                </div>
                                <div className="flex items-center gap-1.5 justify-end font-mono">
                                  <span className="text-[8.5px] text-white/45 hidden sm:inline">Q:{prov.quality} L:{prov.latency}ms</span>
                                  <span className="font-bold text-indigo-300">Score: {prov.overallScore}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  </div>

                  {/* Details box */}
                  <p className="text-xs text-white/70 leading-relaxed font-sans bg-white/5 p-3.5 border border-white/5 rounded-xl">
                    {validationResult.details}
                  </p>
                </div>

                {/* Engine indicator */}
                <div className="flex items-center justify-between text-[9px] text-white/40 font-mono pt-2 border-t border-white/5">
                  <span>ENGINE: {(validationResult as any).engine || "Code-Engine"}</span>
                  <span className="bg-white/5 px-2 py-0.5 rounded">MQV v1.2</span>
                </div>
              </motion.div>
            )}

            {/* Case: Waiting for validation */}
            {!isValidating && !validationResult && (
              <div className="bg-zinc-950 border border-white/5 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[300px] text-center space-y-3">
                <ShieldCheck className="w-10 h-10 text-white/25" />
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-white uppercase tracking-widest font-mono">Validator Status: Ready</h4>
                  <p className="text-[10px] text-white/45 max-w-xs">
                    整合性検証が待機状態です。上のボタンを押すか、右下の「テストベンチ」からサンプルケースを選択して判定を開始してください。
                  </p>
                </div>
              </div>
            )}

          </AnimatePresence>
        </div>

      </div>

      {/* 4. Predefined Test Bench */}
      <div className="bg-zinc-950 border border-white/5 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <h4 className="text-xs font-bold uppercase tracking-widest text-white font-mono">
            ③ Pre-Configured Validation Test Bench (テストベンチ)
          </h4>
        </div>
        <p className="text-xs text-white/55">
          ユーザーの指示した全ての不適合テストケースを網羅しています。クリックすると、即座にライブ分類と整合性判定ロジックをテストできます。
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {VALIDATION_TEST_CASES.map((tc) => {
            const isActive = activeTestCase === tc.id;
            return (
              <button
                key={tc.id}
                onClick={() => handleTestBenchClick(tc)}
                aria-label={`テストケース実行: ${tc.name}`}
                className={`text-left p-3.5 rounded-xl border transition-all text-xs flex flex-col justify-between space-y-2.5 cursor-pointer ${
                  isActive 
                    ? "bg-indigo-500/10 border-indigo-500/40 shadow-lg" 
                    : "bg-white/5 border-white/5 hover:border-white/10"
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white text-[11px] font-mono leading-none">{tc.name}</span>
                    <span className={`text-[8.5px] px-1.5 py-0.2 rounded font-mono font-bold uppercase ${
                      tc.expectedSuccess 
                        ? "bg-emerald-400/10 text-emerald-400" 
                        : "bg-rose-400/10 text-rose-400"
                    }`}>
                      {tc.expectedSuccess ? "Expected: SUCCESS" : "Expected: FAIL"}
                    </span>
                  </div>
                  <p className="text-[10px] text-white/40 line-clamp-1">
                    Req: {tc.request}
                  </p>
                </div>
                
                <div className="flex items-center justify-between pt-1 text-[9.5px] border-t border-white/5 font-mono">
                  <span className="text-white/45">Click to Run Test</span>
                  <ArrowRight className={`w-3.5 h-3.5 transition-transform ${isActive ? "text-indigo-400 translate-x-1" : "text-white/30"}`} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

    </div>
  );
}
