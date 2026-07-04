import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Settings, AnalysisResult, WorkspaceCategory, TaskTemplate } from "./types";
import SettingsModal from "./components/SettingsModal";
import ResultDashboard from "./components/ResultDashboard";
import MissionInput from "./components/MissionInput";
import ChatApp from "./components/os/ChatApp";
import MultiAIApp from "./components/os/MultiAIApp";
import DashboardApp from "./components/os/DashboardApp";
import WorkspaceSelector from "./components/os/WorkspaceSelector";
import NotificationCenter from "./components/os/NotificationCenter";
import MemoryExplorer from "./components/os/MemoryExplorer";
import PromptLibrary from "./components/os/PromptLibrary";
import AIPerformanceDashboard from "./components/os/AIPerformanceDashboard";
import ObservabilityCenter from "./components/os/ObservabilityCenter";
import UniversalSearch from "./components/os/UniversalSearch";
import AIAssistantSidebar from "./components/os/AIAssistantSidebar";
import BrainOverview from "./components/os/BrainOverview";
import WorkspaceCard from "./components/os/WorkspaceCard";
import HomeScreen from "./components/os/HomeScreen";
import WorkspaceApp from "./components/os/WorkspaceApp";
import OrganizationApp from "./components/os/OrganizationApp";
import Boardroom from "./components/os/Boardroom";
import MissionRuntimeConsole from "./components/os/MissionRuntimeConsole";
import RealTimeSwarmDebugger from "./components/os/RealTimeSwarmDebugger";
import DesignSystemV3 from "./components/os/DesignSystemV3";
import { 
  Search, 
  Shield,
  Briefcase, 
  Activity,
  FileText, 
  Code, 
  PenTool, 
  Settings2, 
  History, 
  Trash2, 
  Sparkles, 
  Loader2, 
  Command, 
  ArrowLeft, 
  Cpu, 
  Layers, 
  CheckCircle2, 
  PlusCircle,
  Clock,
  HelpCircle,
  Menu,
  X,
  Compass,
  Zap,
  Layout,
  BookOpen,
  Database,
  Target,
  BrainCircuit,
  Home,
  MessageSquare,
  Award
} from "lucide-react";
import { cn } from "./utils";

const CATEGORIES: WorkspaceCategory[] = [
  {
    id: "search",
    name: "調査・検索",
    icon: "🔍",
    description: "市場・競合・Web情報の包括的な調査",
    color: "from-blue-500 to-indigo-600",
    bgColor: "bg-blue-50/50",
    borderColor: "border-blue-100",
    accentColor: "text-blue-600",
    templates: [
      { id: "web_search", name: "Web検索・要約", placeholder: "〇〇に関する最新動向と要点を要約してください。", hint: "最新トピックやニュースなどの概要把握に最適" },
      { id: "market_research", name: "市場調査", placeholder: "〇〇市場の現在の規模、今後の成長率、主要なトレンドについて分析してください。", hint: "市場規模や将来性のクイック調査" },
      { id: "competitor", name: "競合分析", placeholder: "〇〇分野における主要競合3社の強み・弱み、ポジショニングについて調査・比較してください。", hint: "競合他社の強み・弱みの比較" },
      { id: "info_gathering", name: "情報収集・整理", placeholder: "〇〇技術についての基礎知識、仕組み、メリット・デメリットをわかりやすく整理してください。", hint: "新技術や用語の体系的なまとめ" }
    ]
  },
  {
    id: "business",
    name: "ビジネス・戦略",
    icon: "💼",
    description: "提案・企画書作成、SWOT・マーケ戦略",
    color: "from-emerald-500 to-teal-600",
    bgColor: "bg-emerald-50/50",
    borderColor: "border-emerald-100",
    accentColor: "text-emerald-600",
    templates: [
      { id: "sales_prop", name: "営業提案書骨子", placeholder: "〇〇業界のクライアントに対して、当社の〇〇サービスを提案するための営業ストーリーと提案骨子を作成してください。", hint: "クライアントの課題解決に響く構成案" },
      { id: "aio_prop", name: "AIO提案（AI最適化）", placeholder: "当社のWebサービスが、各種AI（ChatGPTやGemini等）の検索結果で推奨されやすくなるためのAI検索エンジン最適化（AIO/GEO）の具体策を提示してください。", hint: "AI検索時代に生き残るためのマーケ戦略" },
      { id: "planning", name: "新規事業・企画書作成", placeholder: "「〇〇を活用した新サービス」の企画書を作成してください。ターゲット、課題解決、マネタイズモデルを含めてください。", hint: "説得力のある新規事業アイデアの構築" },
      { id: "swot", name: "SWOT分析", placeholder: "〇〇ビジネスにおける、強み(S)・弱み(W)・機会(O)・脅威(T)を整理し、クロスSWOT分析による戦略を導き出してください。", hint: "現状の強みと外部機会を活かす戦略立案" },
      { id: "marketing", name: "マーケティング戦略", placeholder: "〇〇（ターゲット層）に向けた、新しい〇〇商品のプロモーション戦略および販売チャネルの最適化案を策定してください。", hint: "4P・STP分析に基づく実用的なアプローチ" }
    ]
  },
  {
    id: "docs",
    name: "資料作成・要約",
    icon: "📝",
    description: "提案書・PowerPoint構成・議事録作成",
    color: "from-purple-500 to-pink-600",
    bgColor: "bg-purple-50/50",
    borderColor: "border-purple-100",
    accentColor: "text-purple-600",
    templates: [
      { id: "proposal_doc", name: "提案書ドキュメント", placeholder: "〇〇プロジェクトの導入に向けて、社内承認を得るための稟議書・提案用ドキュメントを作成してください。", hint: "社内・社外向けの公式ドキュメント生成" },
      { id: "ppt_outline", name: "PowerPointスライド構成", placeholder: "「〇〇の紹介」をテーマにした、全10スライドからなるプレゼン資料の構成案（各スライドのタイトルと話す内容・ビジュアルイメージ）を作成してください。", hint: "スライドごとの構成・台本の一括作成" },
      { id: "pdf_report", name: "レポート・報告書作成", placeholder: "〇〇プロジェクトの実施結果と、そこから得られた課題・今後の改善アクションプランをまとめた週次レポートを作成してください。", hint: "分析や結果報告をスマートに文書化" },
      { id: "meeting_notes", name: "議事録作成・整理", placeholder: "以下の会議の発言メモから、決定事項、各自のToDo、次回の議論点を抽出した綺麗な議事録を作成してください。\n\n【発言メモ】\n・...", hint: "箇条書きメモからスマートな議事録を生成" }
    ]
  },
  {
    id: "dev",
    name: "開発・技術サポート",
    icon: "💻",
    description: "コード生成・バグ修正・アプリ作成支援",
    color: "from-amber-500 to-orange-600",
    bgColor: "bg-amber-50/50",
    borderColor: "border-amber-100",
    accentColor: "text-amber-600",
    templates: [
      { id: "code_gen", name: "コード自動生成", placeholder: "TypeScript/Reactで、〇〇機能（例: アニメーション付きのドラッグ＆ドロップカード）を実装するための、再利用可能なコンポーネントコードを生成してください。", hint: "高品質でエラーの少ないコードを一発作成" },
      { id: "bug_fix", name: "バグ修正・デバッグ", placeholder: "以下のコードで〇〇エラーが発生します。原因を特定し、修正済みのコードを提示してください。\n\n【コード】\n...", hint: "エラーメッセージやソースコードの解析" },
      { id: "web_site", name: "HTML/CSS Webサイト作成", placeholder: "〇〇向け（例: カフェ、個人のポートフォリオ）の、レスポンシブ対応でモダンなシングルページHTML/CSSの構成とTailwind CSSスタイルを提示してください。", hint: "美しく反応性の高い静的サイトの作成" },
      { id: "react_app", name: "Reactアプリ設計", placeholder: "〇〇アプリ（例: 習慣トラッカーアプリ）を構築するための、フォルダ構造、必要なState設計、コンポーネント分割、および主要なhooksの設計図を作成してください。", hint: "クリーンアーキテクチャに則った全体設計" }
    ]
  },
  {
    id: "creative",
    name: "クリエイティブ・発信",
    icon: "🎨",
    description: "ブログ・SNS・LP・動画台本のライティング",
    color: "from-rose-500 to-red-600",
    bgColor: "bg-rose-50/50",
    borderColor: "border-rose-100",
    accentColor: "text-rose-600",
    templates: [
      { id: "blog_post", name: "ブログ記事執筆", placeholder: "「〇〇（トピック）」をテーマに、SEOに配慮した魅力的なブログ記事を作成してください。見出し構成（H2, H3）と、読者の興味を惹きつける導入文、本文を記述してください。", hint: "SEOに強く読みやすい長文の作成" },
      { id: "sns_post", name: "SNS投稿（X / Instagram）", placeholder: "〇〇（新商品、イベント、役立つ情報）について、SNS（XやInstagram）でバズるためのハッシュタグ付きの投稿案を3パターン作成してください。", hint: "各SNSのアルゴリズムや文脈に合わせた訴求" },
      { id: "lp_text", name: "LP（ランディングページ）構成", placeholder: "〇〇サービスを紹介するLPのコピーライティング（ヘッドコピー、サブコピー、ベネフィット、CTA部分）を作成してください。", hint: "成約率（CVR）を高めるための刺さる言葉" },
      { id: "video_script", name: "動画台本・シナリオ", placeholder: "YouTubeやTikTok向けの、〇〇について解説する3分間のショート動画の台本（イントロ、本編、アウトロの構成とナレーション案）を作成してください。", hint: "視聴維持率を最大化する台本構成" }
    ]
  }
];

export default function App() {
  const [currentApp, setCurrentApp] = useState<"mission" | "chat" | "multi-ai" | "workflows" | "memory" | "prompt-library" | "ai-performance" | "observability-center" | "dashboard" | "settings" | "brain" | "workspace" | "organization" | "marketplace" | "swarm-debugger">("dashboard");
  const [taskMode, setTaskMode] = useState<"categories" | "input" | "loading" | "result">("categories");

  // Persistent workspace saved missions state
  const [savedMissions, setSavedMissions] = useState<any[]>(() => {
    try {
      const stored = localStorage.getItem("acos_saved_missions");
      return stored ? JSON.parse(stored) : [
        {
          id: "m-001",
          title: "交通事故に強い弁護士を比較し、勝率が高く、口コミも優れた候補を提案する",
          timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
          category: "search",
          successScore: 98,
          roi: "150% ROI / 弁護士選定の最適化",
          status: "Completed",
          resultData: null
        },
        {
          id: "m-002",
          title: "新規AI SaaS事業のSWOT分析とROI予測",
          timestamp: new Date(Date.now() - 3600000 * 24).toISOString(),
          category: "business",
          successScore: 96,
          roi: "年間50万ドルのコスト削減効果",
          status: "Completed",
          resultData: null
        }
      ];
    } catch {
      return [];
    }
  });
  const [homeTab, setHomeTab] = useState<"missions" | "constitution" | "quality" | "thinking" | "experience" | "design" | "pie" | "blueprint" | "core" | "arch" | "missionEngine">("missions");
  const [selectedCategory, setSelectedCategory] = useState<WorkspaceCategory | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<TaskTemplate | null>(null);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [rawError, setRawError] = useState<{ code: string; status: string; message: string } | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [booting, setBooting] = useState(true);
  const [loadingStep, setLoadingStep] = useState(1);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setBooting(false);
    }, 950);
    return () => clearTimeout(timer);
  }, []);

  // Keyboard First UI listeners (Raycast, ChatGPT, Slack style)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K to toggle search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsSearchOpen(prev => !prev);
      }
      // Esc to exit overlay
      if (e.key === "Escape") {
        if (taskMode === "result" || taskMode === "loading") {
          setTaskMode("categories");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [taskMode]);
  
  // Local state for search history
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("workspace_query_history");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(true);
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const stored = localStorage.getItem("acos_settings");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (!parsed.language) parsed.language = "ja";
        return parsed;
      }
    } catch (e) {
      console.warn("localStorage settings read error", e);
    }
    return {
      autoRoute: true,
      selectedAgents: ["gemini", "openai"],
      language: "ja"
    };
  });

  const updateSettings = (newSettings: Settings) => {
    setSettings(newSettings);
    try {
      localStorage.setItem("acos_settings", JSON.stringify(newSettings));
    } catch (e) {
      console.warn("localStorage settings write error", e);
    }
  };

  const saveToHistory = (newPrompt: string) => {
    const trimmed = newPrompt.trim();
    if (!trimmed) return;
    const updated = [trimmed, ...history.filter((h) => h !== trimmed)].slice(0, 10);
    setHistory(updated);
    try {
      localStorage.setItem("workspace_query_history", JSON.stringify(updated));
    } catch (e) {
      console.warn("localStorage quota exceeded or generic storage error", e);
    }
  };

  const handleAnalyze = async (e?: React.FormEvent, customPrompt?: string) => {
    if (e) e.preventDefault();
    const activePrompt = customPrompt || prompt;
    if (!activePrompt.trim()) return;

    if (customPrompt) {
      setPrompt(customPrompt);
    }

    setError("");
    setRawError(null);
    setTaskMode("loading");
    setLoadingStep(1);
    setResult(null);

    // If selectedCategory is not set, set a generic one so that layout continues cleanly
    if (!selectedCategory) {
      setSelectedCategory(CATEGORIES[0]);
    }

    // Start loading step simulation (Step 3, 4, 5, 6 over 5.2 seconds total)
    const stepsInterval = setInterval(() => {
      setLoadingStep((prev) => {
        if (prev < 4) {
          return prev + 1;
        } else {
          clearInterval(stepsInterval);
          return 4;
        }
      });
    }, 1300);

    let fetchSuccess = false;
    let fetchedData: AnalysisResult | null = null;
    let fetchErrorMsg = "";
    let fetchRawErr: any = null;

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          prompt: activePrompt,
          agents: settings.selectedAgents
        }),
      });

      if (!response.ok) {
        let errMsg = "タスクの解析に失敗しました。";
        try {
          const errData = await response.json();
          const is503 = errData.errorCode === "503" || errData.errorStatus === "UNAVAILABLE" || response.status === 503;
          
          if (is503) {
            errMsg = "現在Google Gemini側が混雑しています。\n数分後に再度お試しください";
          } else {
            if (errData.details) {
              errMsg = errData.details;
            }
            if (errData.errorCode || errData.errorStatus || errData.errorMessage) {
              fetchRawErr = {
                code: errData.errorCode || "Unknown Code",
                status: errData.errorStatus || "Unknown Status",
                message: errData.errorMessage || "Unknown Message"
              };
            }
          }
        } catch (e) {}
        throw new Error(errMsg);
      }

      fetchedData = await response.json() as AnalysisResult;
      fetchSuccess = true;
    } catch (err: any) {
      console.error(err);
      fetchErrorMsg = err instanceof Error ? err.message : "AIバックエンドとの通信中にエラーが発生しました。";
    }

    // Wait until steps simulation reaches step 4 or has completed 5.2 seconds
    // to give the user a full immersive, theatrical "世界最高" experience.
    const startTime = Date.now();
    const ensureTheatricalTime = async () => {
      const elapsed = Date.now() - startTime;
      const remaining = 5200 - elapsed;
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
    };

    await ensureTheatricalTime();
    clearInterval(stepsInterval);

    if (fetchSuccess && fetchedData) {
      setResult(fetchedData);
      saveToHistory(activePrompt);
      
      // Auto-save completed mission to the Active Workspace
      const newMission = {
        id: fetchedData.mission?.id || `m-${Date.now()}`,
        title: activePrompt,
        timestamp: new Date().toISOString(),
        category: selectedCategory?.id || "search",
        successScore: fetchedData.successScore || Math.floor(Math.random() * 5) + 95,
        roi: fetchedData.successPrediction?.roi || fetchedData.mission?.roiPrediction || "150% ROI 予測 / 意思決定の最大化",
        status: "Completed" as const,
        resultData: fetchedData // Cache complete result data!
      };

      setSavedMissions(prev => {
        const updated = [newMission, ...prev.filter(m => m.title !== activePrompt)].slice(0, 15);
        try {
          localStorage.setItem("acos_saved_missions", JSON.stringify(updated));
        } catch (e) {
          console.warn("localStorage write error", e);
        }
        return updated;
      });

      setTaskMode("result");
    } else {
      setError(fetchErrorMsg || "通信エラーが発生しました。");
      if (fetchRawErr) {
        setRawError(fetchRawErr);
      }
      setTaskMode("input");
    }
  };

  const selectCategoryHandler = (category: WorkspaceCategory) => {
    setSelectedCategory(category);
    setSelectedTemplate(category.templates[0]);
    setPrompt(category.templates[0].placeholder);
    setTaskMode("input");
  };

  const selectTemplateHandler = (template: TaskTemplate) => {
    setSelectedTemplate(template);
    setPrompt(template.placeholder);
  };

  const resetToHome = () => {
    setSelectedCategory(null);
    setSelectedTemplate(null);
    setPrompt("");
    setError("");
    setRawError(null);
    setTaskMode("categories");
  };

  const clearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem("workspace_query_history");
    } catch (e) {}
  };

  const renderSidebarBody = (onItemClick?: () => void) => {
    const isEn = settings.language === "en";

    return (
      <>
        <div className="p-4 space-y-1 overflow-y-auto flex-1">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-3 mb-2">
            {isEn ? "ACOS Applications" : "ACOS アプリケーション"}
          </div>
          <button
            onClick={() => {
              setCurrentApp("dashboard");
              onItemClick?.();
            }}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all text-left cursor-pointer",
              currentApp === "dashboard"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/10"
                : "text-slate-400 hover:text-white hover:bg-slate-800/50"
            )}
          >
            <Home className="w-4 h-4" />
            <span>{isEn ? "Home" : "ホーム"}</span>
          </button>

          <button
            onClick={() => {
              setCurrentApp("workspace");
              onItemClick?.();
            }}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all text-left cursor-pointer",
              currentApp === "workspace"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/10"
                : "text-slate-400 hover:text-white hover:bg-slate-800/50"
            )}
          >
            <Briefcase className="w-4 h-4" />
            <span>{isEn ? "Workspace" : "ワークスペース"}</span>
          </button>

          <button
            onClick={() => {
              setCurrentApp("brain");
              onItemClick?.();
            }}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all text-left cursor-pointer",
              currentApp === "brain"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/10"
                : "text-slate-400 hover:text-white hover:bg-slate-800/50"
            )}
          >
            <BrainCircuit className="w-4 h-4" />
            <span>{isEn ? "Brain" : "ブレイン"}</span>
          </button>

          <button
            onClick={() => {
              setCurrentApp("marketplace");
              onItemClick?.();
            }}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all text-left cursor-pointer",
              currentApp === "marketplace"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/10"
                : "text-slate-400 hover:text-white hover:bg-slate-800/50"
            )}
          >
            <Sparkles className="w-4 h-4" />
            <span>{isEn ? "Marketplace" : "マーケットプレイス"}</span>
          </button>

          <button
            onClick={() => {
              setCurrentApp("organization");
              onItemClick?.();
            }}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all text-left cursor-pointer",
              currentApp === "organization"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/10"
                : "text-slate-400 hover:text-white hover:bg-slate-800/50"
            )}
          >
            <Shield className="w-4 h-4" />
            <span>{isEn ? "Organization" : "組織設定 / Cockpit"}</span>
          </button>

          <button
            onClick={() => {
              setCurrentApp("swarm-debugger");
              onItemClick?.();
            }}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all text-left cursor-pointer",
              currentApp === "swarm-debugger"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/10"
                : "text-slate-400 hover:text-white hover:bg-slate-800/50"
            )}
          >
            <Activity className="w-4 h-4 text-indigo-400 animate-pulse" />
            <span>{isEn ? "Swarm Debugger" : "Real-Time Swarm デバッガー"}</span>
          </button>

          {/* Active Agents status panel */}
          <div className="pt-6 border-t border-slate-800/80 mt-4 space-y-3">
            <div className="flex items-center justify-between px-3">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                {isEn ? "Active Agents" : "稼働AIメンバー"}
              </span>
              <button
                onClick={() => {
                  setCurrentApp("organization");
                  onItemClick?.();
                }}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
                title={isEn ? "Model Settings" : "モデル設定"}
              >
                <Settings2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-1.5 px-2">
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-800/50 text-[10px] text-slate-300 font-medium border border-slate-800/50">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs">♊</span>
                  <span>Google Gemini</span>
                </div>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-800/50 text-[10px] text-slate-300 font-medium border border-slate-800/50">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs">🟢</span>
                  <span>OpenAI / Router</span>
                </div>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>

              <div className="p-2 rounded-lg bg-slate-900/30 text-[9px] text-slate-500 border border-dashed border-slate-800 leading-relaxed">
                {isEn ? "Coming Soon: Claude, Perplexity, DeepSeek..." : "将来対応予定: Claude, Perplexity, DeepSeek..."}
              </div>
            </div>
          </div>

          {/* History */}
          {history.length > 0 && (
            <div className="pt-6 border-t border-slate-800/80 mt-4 space-y-2">
              <div className="flex items-center justify-between px-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
                  <History className="w-3 h-3" />
                  {isEn ? "Task History" : "タスク履歴"}
                </span>
                <button
                  onClick={clearHistory}
                  className="p-1 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                  title={isEn ? "Clear all history" : "履歴を全削除"}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto px-1">
                {history.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      handleAnalyze(undefined, h);
                      onItemClick?.();
                    }}
                    className="w-full text-left text-[10px] text-slate-400 hover:text-white truncate py-1.5 px-2.5 rounded-md hover:bg-slate-800/40 font-mono cursor-pointer"
                    title={h}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40 text-[10px] text-slate-500 text-center flex flex-col gap-1 font-medium mt-auto">
          <div>Intelligence OS v2.0</div>
          <div className="text-[9px] opacity-70">Supreme Intellect Parallel Boardroom</div>
        </div>
      </>
    );
  };

  if (booting) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center z-50 select-none">
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="flex flex-col items-center gap-4 text-center"
        >
          {/* Logo */}
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center shadow-2xl shadow-indigo-500/30 animate-pulse">
            <Layers className="w-9 h-9 text-white" />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-black tracking-widest text-white uppercase bg-gradient-to-r from-white via-indigo-100 to-indigo-300 bg-clip-text text-transparent">
              Intelligence OS
            </h1>
            <p className="text-[10px] text-indigo-400 font-mono tracking-widest uppercase">
              Supreme Intellect System
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-800 flex flex-col md:flex-row selection:bg-[#4F46E5]/20">
      
      {/* MOBILE SIDEBAR DRAWER */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <div className="fixed inset-0 z-50 md:hidden flex">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm"
            />
            
            {/* Drawer Content */}
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="relative w-80 max-w-[85vw] bg-slate-900 text-white flex flex-col h-full shadow-2xl z-50 border-r border-slate-800"
            >
              {/* Drawer Close Button & Brand Header */}
              <div className="p-5 border-b border-slate-800 flex items-center justify-between">
                <div 
                  className="flex items-center gap-2.5 cursor-pointer" 
                  onClick={() => { 
                    resetToHome(); 
                    setIsMobileMenuOpen(false); 
                  }}
                >
                  <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-md shadow-indigo-600/30">
                    <Layers className="w-4.5 h-4.5 text-white" />
                  </div>
                  <div>
                    <h1 className="text-sm font-black tracking-wider bg-gradient-to-r from-white via-slate-100 to-indigo-200 bg-clip-text text-transparent">
                      Intelligence OS
                    </h1>
                    <p className="text-[9px] text-slate-400 font-medium">Supreme Intellect OS</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
                  title="メニューを閉じる"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {renderSidebarBody(() => setIsMobileMenuOpen(false))}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* DESKTOP SIDEBAR */}
      <aside className="hidden md:flex md:w-64 bg-slate-900 text-white flex-col border-r border-slate-800 h-screen sticky top-0 z-40 shrink-0">
        {/* Brand Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={resetToHome}>
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-md shadow-indigo-600/30">
              <Layers className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-wider bg-gradient-to-r from-white via-slate-100 to-indigo-200 bg-clip-text text-transparent">
                Intelligence OS
              </h1>
              <p className="text-[9px] text-slate-400 font-medium">Supreme Intellect OS</p>
            </div>
          </div>
        </div>

        {renderSidebarBody()}
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col min-h-screen overflow-x-hidden">
        
        {/* Top bar (Apple HIG Compliant Navigation Bar) */}
        <header className="h-14 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/40 dark:border-white/[0.04] px-6 flex items-center justify-between sticky top-0 z-30 shadow-[0_1px_3px_rgba(0,0,0,0.01)] transition-all duration-200">
          <div className="flex items-center gap-3">
            {/* Hamburger button for mobile */}
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="md:hidden w-9 h-9 flex items-center justify-center -ml-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100/80 rounded-full transition-all cursor-pointer active:scale-90"
              title="メニューを開く"
            >
              <Menu className="w-5 h-5" />
            </button>

            <WorkspaceSelector />
          </div>
          
          <div className="flex items-center gap-3">
            <button
              id="universal-search-trigger"
              onClick={() => setIsSearchOpen(true)}
              className="hidden md:flex items-center gap-2 px-4 py-1.5 bg-slate-100/50 dark:bg-neutral-800/40 hover:bg-slate-100/80 dark:hover:bg-neutral-800/60 border border-slate-200/40 dark:border-neutral-700/30 rounded-full text-slate-400 dark:text-neutral-500 hover:text-slate-600 dark:hover:text-neutral-300 transition-all cursor-pointer w-64 justify-between shadow-inner"
            >
              <div className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold tracking-wide">Spotlight Search...</span>
              </div>
              <div className="flex items-center gap-0.5">
                <kbd className="px-1.5 py-0.5 bg-white dark:bg-neutral-900 border border-slate-200/80 dark:border-neutral-700/40 rounded text-[9px] font-bold text-slate-400 dark:text-neutral-500">⌘</kbd>
                <kbd className="px-1.5 py-0.5 bg-white dark:bg-neutral-900 border border-slate-200/80 dark:border-neutral-700/40 rounded text-[9px] font-bold text-slate-400 dark:text-neutral-500">K</kbd>
              </div>
            </button>
            <button
              onClick={() => setIsSearchOpen(true)}
              className="md:hidden w-9 h-9 flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-full transition-all cursor-pointer active:scale-90"
            >
              <Search className="w-5 h-5" />
            </button>

            <div className="h-5 w-px bg-slate-200 dark:bg-neutral-800 mx-1"></div>

            <div className="flex items-center gap-2">
              <NotificationCenter />
              
              <button
                onClick={() => setIsAssistantOpen(!isAssistantOpen)}
                className={cn(
                  "w-9 h-9 flex items-center justify-center rounded-full transition-all cursor-pointer active:scale-90",
                  isAssistantOpen 
                    ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100/50 dark:border-indigo-900/40" 
                    : "text-slate-500 dark:text-neutral-400 hover:text-slate-800 dark:hover:text-neutral-100 hover:bg-slate-100 dark:hover:bg-neutral-800/60 border border-transparent"
                )}
                title="Toggle AI Assistant"
              >
                <Sparkles className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>
        </header>

        {/* Screen layout */}
        <div className={cn("flex-1 p-4 md:p-6 w-full mx-auto space-y-6 flex flex-col transition-all duration-300", isAssistantOpen ? "pr-80 max-w-7xl" : "max-w-6xl")}>

          
          <AnimatePresence mode="wait">
            {currentApp === "dashboard" && (
              <motion.div key="dashboard" initial={{opacity: 0, y: 15}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -15}} className="flex-1 min-h-0">
                <HomeScreen
                  prompt={prompt}
                  setPrompt={setPrompt}
                  handleAnalyze={handleAnalyze}
                  categories={CATEGORIES}
                  history={history}
                  clearHistory={clearHistory}
                  savedMissions={savedMissions}
                  onViewMissionResult={(mission) => {
                    if (mission.resultData) {
                      setResult(mission.resultData);
                    } else {
                      setResult({
                        successScore: mission.successScore,
                        mission: {
                          id: mission.id,
                          title: mission.title,
                        },
                        chiefAgents: [],
                        workflowGraph: { nodes: [], links: [] },
                        deliverables: [],
                        riskAudit: [],
                        rulesFollowed: [],
                        roiPrediction: { roi: mission.roi }
                      } as any);
                    }
                    setSelectedCategory(CATEGORIES.find(c => c.id === mission.category) || CATEGORIES[0]);
                    setPrompt(mission.title);
                    setTaskMode("result");
                  }}
                  onSelectCategory={(cat) => {
                    setSelectedCategory(cat);
                  }}
                />
              </motion.div>
            )}
            {currentApp === "workspace" && (
              <motion.div key="workspace" initial={{opacity: 0, y: 15}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -15}} className="flex-1 min-h-0">
                <WorkspaceApp 
                  savedMissions={savedMissions}
                  onViewMissionResult={(mission) => {
                    if (mission.resultData) {
                      setResult(mission.resultData);
                    } else {
                      setResult({
                        successScore: mission.successScore,
                        mission: {
                          id: mission.id,
                          title: mission.title,
                        },
                        chiefAgents: [],
                        workflowGraph: { nodes: [], links: [] },
                        deliverables: [],
                        riskAudit: [],
                        rulesFollowed: [],
                        roiPrediction: { roi: mission.roi }
                      } as any);
                    }
                    setTaskMode("result");
                  }}
                  onNavigateToApp={(app) => {
                    if (app === "chat") setCurrentApp("chat");
                    if (app === "multi-ai") setCurrentApp("multi-ai");
                    if (app === "brain") setCurrentApp("brain");
                  }}
                />
              </motion.div>
            )}
            {currentApp === "chat" && (
              <motion.div key="chat" initial={{opacity: 0, y: 15}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -15}} className="flex-1 min-h-0 h-[calc(100vh-140px)]">
                <ChatApp />
              </motion.div>
            )}
            {currentApp === "multi-ai" && (
              <motion.div key="multi-ai" initial={{opacity: 0, y: 15}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -15}} className="flex-1 min-h-0 h-[calc(100vh-140px)]">
                <MultiAIApp />
              </motion.div>
            )}
            {currentApp === "brain" && (
              <motion.div key="brain" initial={{opacity: 0, y: 15}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -15}} className="flex-1 min-h-0">
                <BrainOverview />
              </motion.div>
            )}
            {currentApp === "marketplace" && (
              <motion.div key="marketplace" initial={{opacity: 0, y: 15}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -15}} className="flex-1 min-h-0">
                <PromptLibrary />
              </motion.div>
            )}
            {currentApp === "organization" && (
              <motion.div key="organization" initial={{opacity: 0, y: 15}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -15}} className="flex-1 min-h-0">
                <OrganizationApp settings={settings} updateSettings={updateSettings} />
              </motion.div>
            )}
            {currentApp === "swarm-debugger" && (
              <motion.div key="swarm-debugger" initial={{opacity: 0, y: 15}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -15}} className="flex-1 min-h-0">
                <RealTimeSwarmDebugger />
              </motion.div>
            )}

            {currentApp === "mission" && (
              <motion.div key="mission" initial={{opacity: 0, y: 15}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -15}} className="flex-1 flex flex-col gap-6">
                {/* 1. HOMEPAGE: CATEGORY SELECTION CARDS */}
                {taskMode === "categories" && (
              <motion.div
                key="categories"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-8 py-4"
              >
                {/* Visual Banner */}
                <div className="bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-white rounded-3xl p-6 md:p-8 shadow-xl shadow-indigo-950/10 flex flex-col md:flex-row justify-between items-center gap-6 overflow-hidden relative border border-white/5">
                  <div className="absolute right-0 bottom-0 top-0 opacity-5 flex items-center justify-center text-[180px] pointer-events-none pr-10 font-black">
                    OS
                  </div>
                  <div className="space-y-3.5 max-w-2xl text-center md:text-left z-10">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-500/20 border border-indigo-400/30 rounded-full text-xs text-indigo-200 font-bold font-mono">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
                      CORE SPECIFICATION 001 COMPLIANT
                    </div>
                    <h2 className="text-2xl md:text-3.5xl font-black tracking-tight leading-none bg-gradient-to-r from-white via-indigo-100 to-indigo-300 bg-clip-text text-transparent">
                      Intelligence OS
                    </h2>
                    <p className="text-sm font-semibold text-indigo-300 leading-relaxed font-sans max-w-xl">
                      「質問に答えるAIではない。成功を導くAIである。」
                    </p>
                    <p className="text-xs text-slate-400 leading-relaxed max-w-xl font-medium">
                      回答の枠組みを突破し、品質95%以上の完成された成果物を自律的に組み立てる、世界標準の知的活動司令室。AI Companyが裏で動き、あなたの成功を保証します。
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setHomeTab("missions");
                      selectCategoryHandler(CATEGORIES[0]);
                    }}
                    className="px-6 py-3.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-bold text-xs shadow-lg shadow-indigo-500/25 transition-all shrink-0 active:scale-95 z-10 border border-indigo-400/30 cursor-pointer"
                  >
                    Missionを開始する 🚀
                  </button>
                </div>

                {/* Unified Cockpit Input (Core Journey Step 2) */}
                <div className="bg-white border border-slate-200/80 rounded-3xl p-6 md:p-8 shadow-sm space-y-6">
                  <div className="text-center space-y-2">
                    <h2 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
                      今日は何を成功させますか？
                    </h2>
                    <p className="text-xs text-slate-500 font-medium max-w-lg mx-auto">
                      AI Companyがあなたの目標を自律的に構造化し、品質95%以上の最高峰成果物を作ります。
                    </p>
                  </div>

                  <form onSubmit={(e) => handleAnalyze(e)} className="max-w-2xl mx-auto relative flex items-center gap-2">
                    <input
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="例: 交通事故に強い弁護士を比較し、勝率が高く、口コミも優れた候補を提案する"
                      className="w-full bg-slate-50 border border-slate-200/80 rounded-2xl py-4 pl-5 pr-20 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-semibold transition-all shadow-inner"
                    />
                    <button
                      type="submit"
                      disabled={!prompt.trim()}
                      className="absolute right-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-indigo-200 animate-pulse" />
                      <span>実行</span>
                    </button>
                  </form>
                  
                  {/* Quick success presets */}
                  <div className="flex flex-wrap justify-center gap-2 max-w-xl mx-auto pt-1">
                    {[
                      "交通事故に強い弁護士を比較し、勝率が高く、口コミも優れた候補を提案する",
                      "新規AI SaaS事業のSWOT分析とROI予測",
                      "React向けアニメーション付きカードコンポーネント設計",
                      "最新のAI検索エンジン最適化（AIO/GEO）の具体策"
                    ].map((preset, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => {
                          setPrompt(preset);
                        }}
                        className="px-3 py-1.5 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-200 border border-slate-200 rounded-xl text-[11px] font-bold text-slate-600 hover:text-indigo-600 transition-all cursor-pointer truncate max-w-full"
                        title={preset}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Home Sub-Tab Switcher */}
                <div className="flex bg-slate-200/60 p-1 rounded-2xl max-w-sm border border-slate-200/30">
                  <button
                    onClick={() => setHomeTab("missions")}
                    className={cn(
                      "flex-1 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                      homeTab === "missions"
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    <span>🛡</span>
                    Mission Command (業務設計)
                  </button>
                  <button
                    onClick={() => setHomeTab("constitution")}
                    className={cn(
                      "flex-1 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                      homeTab === "constitution"
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    <span>⚖</span>
                    Mission Core 憲章
                  </button>
                  <button
                    onClick={() => setHomeTab("quality")}
                    className={cn(
                      "flex-1 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                      homeTab === "quality"
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    <span>💎</span>
                    Quality Bible
                  </button>
                  <button
                    onClick={() => setHomeTab("thinking")}
                    className={cn(
                      "flex-1 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                      homeTab === "thinking"
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    <span>🧠</span>
                    Thinking Bible
                  </button>
                  <button
                    onClick={() => setHomeTab("experience")}
                    className={cn(
                      "flex-1 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                      homeTab === "experience"
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    <span>✨</span>
                    Experience Bible
                  </button>
                  <button
                    onClick={() => setHomeTab("design")}
                    className={cn(
                      "flex-1 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                      homeTab === "design"
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    <span>🎨</span>
                    Design System
                  </button>
                  <button
                    onClick={() => setHomeTab("pie")}
                    className={cn(
                      "flex-1 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                      homeTab === "pie"
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    <span>⚡</span>
                    PIE (Build 011)
                  </button>
                  <button
                    onClick={() => setHomeTab("blueprint")}
                    className={cn(
                      "flex-1 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                      homeTab === "blueprint"
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    <span>📐</span>
                    Blueprint 001
                  </button>
                  <button
                    onClick={() => setHomeTab("core")}
                    className={cn(
                      "flex-1 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                      homeTab === "core"
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    <span>📖</span>
                    Core Spec
                  </button>
                  <button
                    onClick={() => setHomeTab("arch")}
                    className={cn(
                      "flex-1 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                      homeTab === "arch"
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    <span>🏛️</span>
                    Arch Bible
                  </button>
                  <button
                    onClick={() => setHomeTab("missionEngine")}
                    className={cn(
                      "flex-1 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                      homeTab === "missionEngine"
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    <span>🎯</span>
                    Mission Engine
                  </button>
                </div>

                {homeTab === "missions" && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6"
                  >
                    {/* Section Title */}
                    <div className="space-y-1">
                      <h3 className="text-base font-black text-slate-800 tracking-tight flex items-center gap-2">
                        <Layers className="w-5 h-5 text-indigo-600" />
                        Missionカテゴリを選択する
                      </h3>
                      <p className="text-xs text-slate-500 font-medium">目的に応じた最適なテンプレート成果物と成功条件を展開します。</p>
                    </div>

                    {/* Categories Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                      {CATEGORIES.map((cat, index) => (
                        <WorkspaceCard
                          key={cat.id}
                          category={cat}
                          onClick={selectCategoryHandler}
                          index={index}
                        />
                      ))}
                    </div>
                  </motion.div>
                )}

                {homeTab === "constitution" && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6"
                  >
                    <div className="p-6 bg-gradient-to-br from-indigo-950 via-slate-900 to-black border border-indigo-500/20 rounded-2xl space-y-4">
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">⚖</span>
                        <div>
                          <h3 className="text-base font-black text-white">Core Specification 001 — Mission Core</h3>
                          <p className="text-xs text-indigo-300">本システム（Intelligence OS）が絶対にブレてはいけない最高憲法</p>
                        </div>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed font-medium">
                        本OSは利用者を単に「操作させる」だけの受動的スペースではなく、自律的に仕事を組み立て、品質95%以上の完成された成果物（Deliverables）を創出して「真の成功（Success）」へとナビゲートする自律司令システムです。
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {[
                        { num: "01", title: "Intelligence OS", desc: "単なるAI Workspaceではない。能動的かつ知的進化を遂げる完結型システムである。", highlight: true },
                        { num: "02", title: "成功を導くAI", desc: "単なる質問応答ボットではない。目標に到達するための最良のマイルストーンを自律展開する。" },
                        { num: "03", title: "成果物（Deliverable）", desc: "テキスト回答で終わらせない。構造化カード、対比、タイムライン、ロードマップ等の完璧な構成物を出す。" },
                        { num: "04", title: "Mission管理", desc: "チャット欄ではない。成功条件（Success Conditions）と完了期限（Deadlines）を統合管理する。" },
                        { num: "05", title: "Success管理", desc: "単なるプロジェクトファイルの保管庫ではない。目標達成確率であるSuccess Score（%）を計算し、担保する。" },
                        { num: "06", title: "Knowledge DNA", desc: "一時的なブラウザメモリではない。利用するほど固有のナレッジを蓄積し、世代交代可能なDNAを構築する。" },
                        { num: "07", title: "AI Company", desc: "単一のAI Agentではない。5大AI（Boardroom）が並列かつ有機的に合意形成して稼働する。" },
                        { num: "08", title: "Knowledge Graph", desc: "フラットな検索エンジンではない。物事の繋がりをNetwork Graphノードで視覚的に構造理解する。" },
                        { num: "09", title: "品質保証付き成果物", desc: "単純制作ではない。UQI 12-Factor基準による厳密なファクト監査をパスしたモデルのみを出力する。" },
                        { num: "10", title: "自律アセンブリ", desc: "利用者はAIを細かく操作しない。AIが最適なステップ・構成を自発的に提案・組織化する。" },
                        { num: "11", title: "品質制限 (UQI 95%超)", desc: "品質95点未満の不完全な成果物は、システム上での「提出（表示）を厳重に禁止」する。", highlight: true },
                        { num: "12", title: "超越価値", desc: "単なる一問一答を超え、利用者の質問「以上の価値」（行動可能な戦略・多視点対比・実動ツール）を返す。" },
                        { num: "13", title: "指数関数的学習", desc: "利用すればするほど、過去の対話やDNAに基づき、驚異的なスピードで知能が進化する。" },
                        { num: "14", title: "利用者専用OS", desc: "最終的には各ユーザー専用のライフコア、専用司令部OSとしての進化形態へと至る。" },
                        { num: "15", title: "絶対的最終目標", desc: "世界中のあらゆる高度知的活動を、このOS一つだけで完結させることを究極目的とする。", highlight: true }
                      ].map((item) => (
                        <div 
                          key={item.num}
                          className={cn(
                            "p-4 rounded-2xl border flex flex-col justify-between min-h-[140px] transition-all hover:scale-[1.02]",
                            item.highlight 
                              ? "bg-indigo-950/40 border-indigo-500/30 text-white shadow-md shadow-indigo-950/20" 
                              : "bg-white border-slate-200 text-slate-800"
                          )}
                        >
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className={cn("text-[10px] font-mono font-bold px-2 py-0.5 rounded", item.highlight ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-500")}>
                                SPEC {item.num}
                              </span>
                              {item.highlight && <span className="text-xs text-indigo-400 font-black">★ CORE</span>}
                            </div>
                            <h4 className={cn("text-xs font-black", item.highlight ? "text-indigo-200" : "text-slate-900")}>
                              {item.title}
                            </h4>
                            <p className={cn("text-[11px] leading-relaxed font-medium", item.highlight ? "text-slate-300 animate-pulse" : "text-slate-500")}>
                              {item.desc}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {homeTab === "quality" && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6"
                  >
                    <div className="p-6 bg-gradient-to-br from-amber-950 via-slate-900 to-black border border-amber-500/20 rounded-2xl space-y-4">
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">💎</span>
                        <div>
                          <h3 className="text-base font-black text-white">ORIGIN Quality Bible (Version 1.0)</h3>
                          <p className="text-xs text-amber-300">Mission: ORIGINの品質を永久に保証する。</p>
                        </div>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed font-medium">
                        Q5未満は正式リリースしない。「Q5 (ORIGIN Standard)」のみが本システムから提供される究極の成果物基準となります。
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                          <Layers className="w-4 h-4 text-amber-500" />
                          Quality Levels
                        </h4>
                        <div className="space-y-2">
                          {[
                            { level: "Q0", name: "試作", color: "bg-slate-100 text-slate-500" },
                            { level: "Q1", name: "動作確認", color: "bg-slate-100 text-slate-600" },
                            { level: "Q2", name: "利用可能", color: "bg-slate-100 text-slate-700" },
                            { level: "Q3", name: "商用品質", color: "bg-indigo-50 text-indigo-700" },
                            { level: "Q4", name: "世界最高品質候補", color: "bg-purple-50 text-purple-700" },
                            { level: "Q5", name: "ORIGIN Standard", color: "bg-amber-100 text-amber-700 font-bold border-amber-300 bg-amber-50" }
                          ].map(item => (
                            <div key={item.level} className={cn("flex justify-between items-center p-3 rounded-xl border", item.color, item.level === "Q5" ? "shadow-sm border border-amber-400" : "border-transparent")}>
                              <span className="font-mono text-sm">{item.level}</span>
                              <span className="text-sm font-medium">{item.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-amber-500" />
                          Q5 Conditions
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {[
                            { key: "Accuracy", val: "99%以上" },
                            { key: "Evidence", val: "必須" },
                            { key: "Hallucination", val: "重大0件" },
                            { key: "Mission Success", val: "95%以上" },
                            { key: "UI", val: "説明不要" },
                            { key: "UX", val: "迷わない" },
                            { key: "Performance", val: "3秒以内" },
                            { key: "Accessibility", val: "世界基準" },
                            { key: "Security", val: "最高レベル" },
                            { key: "Learning", val: "毎回改善" },
                          ].map(cond => (
                            <div key={cond.key} className="p-3 bg-white border border-slate-200 rounded-xl flex flex-col justify-center">
                              <span className="text-xs text-slate-500 font-medium mb-1">{cond.key}</span>
                              <span className="text-sm font-black text-slate-800">{cond.val}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-red-600 font-black text-lg">!</span>
                        </div>
                        <div>
                          <p className="text-xs text-red-600 font-bold mb-0.5">Final Rule</p>
                          <p className="text-sm text-red-800 font-black">Q5未満は正式リリースしない。</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {homeTab === "thinking" && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6"
                  >
                    <div className="p-6 bg-gradient-to-br from-indigo-950 via-slate-900 to-black border border-indigo-500/20 rounded-2xl space-y-4">
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">🧠</span>
                        <div>
                          <h3 className="text-base font-black text-white">ORIGIN Thinking Bible (Version 1.0)</h3>
                          <p className="text-xs text-indigo-300">Mission: AIの思考順序を標準化する。</p>
                        </div>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed font-medium">
                        11ステップの思考パイプラインを厳格に実行し、Mission成功率を最優先します。
                      </p>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <Layers className="w-4 h-4 text-indigo-500" />
                        Thinking Pipeline
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {[
                          { step: 1, name: "Mission理解", items: ["目的", "成功条件", "制約条件"] },
                          { step: 2, name: "不足情報確認", items: ["必要情報", "不明点", "追加取得項目"] },
                          { step: 3, name: "Knowledge確認", items: ["内部Knowledge", "Memory", "Project", "DNA"] },
                          { step: 4, name: "外部Evidence取得", items: ["公式情報", "論文", "一次情報", "信頼できる情報源"] },
                          { step: 5, name: "AI Consensus", items: ["複数AIによる比較"] },
                          { step: 6, name: "反証探索", items: ["反対意見", "例外条件", "失敗事例"] },
                          { step: 7, name: "Quality判定", items: ["Evidence", "Reasoning", "Freshness", "Confidence"] },
                          { step: 8, name: "Mission Success判定", items: ["本当にMission成功へ近づくか"] },
                          { step: 9, name: "Result生成", items: ["文章", "図", "比較", "行動提案"] },
                          { step: 10, name: "Self Review", items: ["自分の回答を再評価"] },
                          { step: 11, name: "Master Decision", items: ["提出可否判断"] },
                        ].map(step => (
                          <div key={step.step} className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">Step {step.step}</span>
                              <span className="text-sm font-bold text-slate-800">{step.name}</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {step.items.map((item, idx) => (
                                <span key={idx} className="text-[10px] font-medium text-slate-500 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded">
                                  {item}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-indigo-600 font-black text-lg">!</span>
                        </div>
                        <div>
                          <p className="text-xs text-indigo-600 font-bold mb-0.5">Final Rule</p>
                          <p className="text-sm text-indigo-900 font-black">思考を省略しない。Mission成功率を最優先する。</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {homeTab === "experience" && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6"
                  >
                    <div className="p-6 bg-gradient-to-br from-emerald-950 via-slate-900 to-black border border-emerald-500/20 rounded-2xl space-y-4">
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">✨</span>
                        <div>
                          <h3 className="text-base font-black text-white">ORIGIN Experience Bible (Version 1.0)</h3>
                          <p className="text-xs text-emerald-300">Mission: 利用者の体験を設計する。</p>
                        </div>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed font-medium">
                        時間経過に伴う体験の変遷を定義し、期待を超え続ける体験を提供します。
                      </p>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <Compass className="w-4 h-4 text-emerald-500" />
                        Experience Timeline
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {[
                          { time: "第一印象", desc: "世界最高品質を感じる。" },
                          { time: "3秒後", desc: "安心感。" },
                          { time: "10秒後", desc: "理解されていると感じる。" },
                          { time: "30秒後", desc: "期待以上を感じる。" },
                          { time: "1分後", desc: "任せられると思う。" },
                          { time: "5分後", desc: "仕事が進んだと感じる。" },
                          { time: "30分後", desc: "成果が出そうだと思う。" },
                          { time: "Mission完了後", desc: "また使いたいと思う。" },
                          { time: "1週間後", desc: "ORIGINがないと困る。" },
                          { time: "1か月後", desc: "仕事の中心になる。" },
                          { time: "1年後", desc: "知的パートナーになる。" },
                        ].map((phase, idx) => (
                          <div key={idx} className="p-4 bg-white border border-slate-200 rounded-xl space-y-2 flex flex-col justify-center">
                            <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full w-fit">
                              {phase.time}
                            </span>
                            <span className="text-sm font-bold text-slate-800 leading-snug">{phase.desc}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-emerald-600 font-black text-lg">!</span>
                        </div>
                        <div>
                          <p className="text-xs text-emerald-600 font-bold mb-0.5">Final Rule</p>
                          <p className="text-sm text-emerald-900 font-black">毎回、期待を少し超える。</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {homeTab === "design" && (
                  <DesignSystemV3 />
                )}

                {homeTab === "pie" && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6"
                  >
                    <div className="p-6 bg-gradient-to-br from-amber-950 via-slate-900 to-black border border-amber-500/20 rounded-2xl space-y-4">
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">⚡</span>
                        <div>
                          <h3 className="text-base font-black text-white">Proactive Intelligence Engine (Build 011)</h3>
                          <p className="text-xs text-amber-300">Mission: 質問を待たない。Mission成功のために自ら提案する。</p>
                        </div>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed font-medium">
                        PIEはAIの自律的な提案を管理し、Missionに影響がある場合のみ通知します。
                      </p>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <Zap className="w-4 h-4 text-amber-500" />
                        PIE Triggers & Suggestions
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
                          <span className="text-xs font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full w-fit">
                            Triggers
                          </span>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {["新しい情報", "市場変化", "競合変化", "法律改正", "AI進化", "Mission停滞", "品質低下", "期限接近"].map((t, idx) => (
                              <span key={idx} className="text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-100 px-2 py-1 rounded">
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
                          <span className="text-xs font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full w-fit">
                            Suggestions
                          </span>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {["改善案", "追加調査", "新AI採用候補", "新Evidence", "リスク", "成功率向上案"].map((s, idx) => (
                              <span key={idx} className="text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-100 px-2 py-1 rounded">
                                {s}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-amber-600 font-black text-lg">!</span>
                        </div>
                        <div>
                          <p className="text-xs text-amber-600 font-bold mb-0.5">Final Rule</p>
                          <p className="text-sm text-amber-900 font-black">通知の数ではなく価値で評価する。</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {homeTab === "blueprint" && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6"
                  >
                    <div className="p-6 bg-gradient-to-br from-indigo-950 via-slate-900 to-black border border-indigo-500/20 rounded-2xl space-y-4">
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">📐</span>
                        <div>
                          <h3 className="text-base font-black text-white">ORIGIN Blueprint 001</h3>
                          <p className="text-xs text-indigo-300">Mission: ホーム画面だけで、利用者が全ての知的作業を開始できる状態を設計する。</p>
                        </div>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed font-medium">
                        Home Screen Complete Specification
                      </p>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <Layout className="w-4 h-4 text-indigo-500" />
                        Screen Sections
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {[
                          { title: "Header", details: ["ORIGINロゴ", "Mission Health", "通知", "プロフィール"] },
                          { title: "Mission Input", details: ["画面中央", "最も大きい要素", "プレースホルダー例「達成したいことを入力してください」"] },
                          { title: "Quick Action", details: ["押した時のみ展開", "画像生成", "動画生成", "資料作成", "Webサイト生成", "アプリ生成", "エージェント実行", "ファイル解析", "音声", "コード"] },
                          { title: "Mission Summary", details: ["入力後自動表示", "Mission", "Goal", "成功条件", "想定成果物"] },
                          { title: "Result Area", details: ["回答", "Evidence", "次の行動をカード表示"] },
                          { title: "Detail Mode", details: ["必要時のみ表示", "Thinking", "Evidence", "Confidence", "AI Team"] }
                        ].map((sec, idx) => (
                          <div key={idx} className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
                            <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full w-fit">
                              {idx + 1}. {sec.title}
                            </span>
                            <ul className="space-y-1.5 mt-2">
                              {sec.details.map((detail, dIdx) => (
                                <li key={dIdx} className="text-xs font-medium text-slate-700 leading-snug flex items-start gap-1.5">
                                  <span className="text-indigo-400 mt-0.5">•</span>
                                  {detail}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
                        <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full w-fit">UI Rule</span>
                        <ul className="space-y-1.5 mt-2 text-xs font-medium text-slate-700">
                          <li>• 画面は1枚。</li>
                          <li>• スクロール最小。</li>
                          <li>• 説明不要。</li>
                        </ul>
                      </div>
                      <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
                        <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full w-fit">UX Rule</span>
                        <ul className="space-y-1.5 mt-2 text-xs font-medium text-slate-700">
                          <li>• 入力から3秒以内に<br/>最初の価値を返す。</li>
                        </ul>
                      </div>
                      <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
                        <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full w-fit">Design Rule</span>
                        <ul className="space-y-1.5 mt-2 text-xs font-medium text-slate-700">
                          <li>• 静か</li>
                          <li>• 知的</li>
                          <li>• 高級感</li>
                          <li>• 余白重視</li>
                        </ul>
                      </div>
                    </div>

                    <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-indigo-600 font-black text-lg">!</span>
                        </div>
                        <div>
                          <p className="text-xs text-indigo-600 font-bold mb-0.5">Final Rule</p>
                          <p className="text-sm text-indigo-900 font-black">ホーム画面だけでMissionを開始・理解・完了できる。</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {homeTab === "core" && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6"
                  >
                    <div className="p-6 bg-gradient-to-br from-red-950 via-slate-900 to-black border border-red-500/20 rounded-2xl space-y-4">
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">📖</span>
                        <div>
                          <h3 className="text-base font-black text-white">ORIGIN Core Specification (Version 1.0)</h3>
                          <p className="text-xs text-red-300">Mission: ORIGINの全仕様を永久に統一する。</p>
                        </div>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed font-medium">
                        全機能・仕様の単一情報源（SSOT）となる最高位のバイブルです。
                      </p>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-red-500" />
                        Specification Chapters
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto pr-2 pb-2">
                        {[
                          { num: 1, title: "Product Philosophy", desc: "製品の根本哲学" },
                          { num: 2, title: "Mission System", desc: "タスクではなくMissionで動く" },
                          { num: 3, title: "Thinking Engine", desc: "思考のパイプライン" },
                          { num: 4, title: "Evidence Engine", desc: "情報の裏付け" },
                          { num: 5, title: "Knowledge DNA", desc: "自己学習の仕組み" },
                          { num: 6, title: "AI Company", desc: "AIエージェントの組織化" },
                          { num: 7, title: "Master Intelligence", desc: "最高知能の定義" },
                          { num: 8, title: "Outcome Engine", desc: "成果の定義と管理" },
                          { num: 9, title: "Quality Bible", desc: "品質基準のバイブル" },
                          { num: 10, title: "Experience Bible", desc: "ユーザー体験のバイブル" },
                          { num: 11, title: "Design System", desc: "デザインシステム" },
                          { num: 12, title: "UI Components", desc: "UIコンポーネント" },
                          { num: 13, title: "UX Rules", desc: "UXのルール" },
                          { num: 14, title: "Security", desc: "セキュリティ要件" },
                          { num: 15, title: "Privacy", desc: "プライバシー要件" },
                          { num: 16, title: "API Standard", desc: "APIの標準規格" },
                          { num: 17, title: "Data Structure", desc: "データ構造" },
                          { num: 18, title: "Database", desc: "データベース要件" },
                          { num: 19, title: "Performance", desc: "パフォーマンス要件" },
                          { num: 20, title: "Release Rules", desc: "リリースのルール" },
                        ].map((ch) => (
                          <div key={ch.num} className="p-3 bg-white border border-slate-200 rounded-xl space-y-1.5 hover:border-red-200 transition-colors">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-black text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                                Chapter {ch.num}
                              </span>
                              <span className="text-xs font-bold text-slate-800">{ch.title}</span>
                            </div>
                            <p className="text-[11px] text-slate-500 font-medium ml-1">
                              {ch.desc}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-red-600 font-black text-lg">!</span>
                        </div>
                        <div>
                          <p className="text-xs text-red-600 font-bold mb-0.5">Final Rule</p>
                          <p className="text-sm text-red-900 font-black">新機能はCore Specificationを更新してから実装する。</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {homeTab === "arch" && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6"
                  >
                    <div className="p-6 bg-gradient-to-br from-cyan-950 via-slate-900 to-black border border-cyan-500/20 rounded-2xl space-y-4">
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">🏛️</span>
                        <div>
                          <h3 className="text-base font-black text-white">ORIGIN System Architecture Bible (Version 1.0)</h3>
                          <p className="text-xs text-cyan-300">Mission: ORIGIN全体を一つのOSとして設計する。</p>
                        </div>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed font-medium">
                        7つのレイヤーで構成される独立・進化可能なアーキテクチャ定義
                      </p>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <Database className="w-4 h-4 text-cyan-500" />
                        7-Layer OS Architecture
                      </h4>
                      
                      <div className="p-4 bg-slate-900 rounded-2xl space-y-3">
                        <p className="text-xs font-bold text-cyan-400 mb-2 border-b border-cyan-500/20 pb-2">Core Rule: 各Layerは独立して進化できる。</p>
                        {[
                          { layer: "1", name: "Presentation Layer", components: ["UI", "UX", "Interaction"] },
                          { layer: "2", name: "Mission Layer", components: ["Mission Parser", "Mission Manager", "Mission Health"] },
                          { layer: "3", name: "Intelligence Layer", components: ["Thinking Engine", "Decision Engine", "Evidence Engine", "Quality Engine"] },
                          { layer: "4", name: "AI Layer", components: ["AI Company", "AI Routing", "AI Benchmark", "AI Consensus"] },
                          { layer: "5", name: "Knowledge Layer", components: ["Knowledge DNA", "Memory Network", "Relationship Graph"] },
                          { layer: "6", name: "Data Layer", components: ["Project", "User", "Mission", "Outcome", "Evidence"] },
                          { layer: "7", name: "Infrastructure Layer", components: ["Authentication", "Security", "Storage", "API", "Monitoring"] }
                        ].map((l) => (
                          <div key={l.layer} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                            <div className="flex items-center gap-2 sm:w-1/3">
                              <span className="text-[10px] font-mono font-bold text-cyan-300 bg-cyan-900/50 px-2 py-0.5 rounded">
                                L{l.layer}
                              </span>
                              <span className="text-xs font-bold text-slate-200">{l.name}</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 sm:w-2/3">
                              {l.components.map((c, idx) => (
                                <span key={idx} className="text-[10px] font-medium text-slate-400 bg-slate-800/80 border border-slate-700 px-2 py-1 rounded">
                                  {c}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="p-4 bg-cyan-50 border border-cyan-100 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-cyan-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-cyan-600 font-black text-lg">!</span>
                        </div>
                        <div>
                          <p className="text-xs text-cyan-600 font-bold mb-0.5">Final Rule</p>
                          <p className="text-sm text-cyan-900 font-black">AIを変更してもArchitectureは変わらない。</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {homeTab === "missionEngine" && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6"
                  >
                    <div className="p-6 bg-gradient-to-br from-fuchsia-950 via-slate-900 to-black border border-fuchsia-500/20 rounded-2xl space-y-4">
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">🎯</span>
                        <div>
                          <h3 className="text-base font-black text-white">ORIGIN Mission Engine Specification (Document 001)</h3>
                          <p className="text-xs text-fuchsia-300">Mission: 利用者が入力した内容からMissionを生成する。</p>
                        </div>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed font-medium">
                        ORIGIN v1.0 Requirements Specification
                      </p>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <Target className="w-4 h-4 text-fuchsia-500" />
                        Mission Object Schema
                      </h4>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                          <span className="text-xs font-black text-fuchsia-600 bg-fuchsia-50 px-2 py-0.5 rounded-full">Inputs</span>
                          <div className="flex flex-wrap gap-2">
                            {['自然言語', '音声', '画像', 'PDF', 'URL', '動画'].map(input => (
                              <span key={input} className="text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded">
                                {input}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                          <span className="text-xs font-black text-fuchsia-600 bg-fuchsia-50 px-2 py-0.5 rounded-full">API</span>
                          <div className="flex flex-wrap gap-2">
                            {['Mission.create()', 'Mission.update()', 'Mission.validate()', 'Mission.complete()', 'Mission.cancel()'].map(api => (
                              <span key={api} className="text-[10px] font-mono font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-1 rounded">
                                {api}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="p-4 bg-slate-900 rounded-2xl">
                         <div className="flex flex-wrap gap-2">
                            {['Mission ID', 'Title', 'Description', 'Goal', 'Constraints', 'Priority', 'Expected Outcome', 'Required AI Teams', 'Evidence Level', 'Estimated Time', 'Risk Level'].map(obj => (
                               <div key={obj} className="flex items-center gap-2 bg-slate-800/80 border border-slate-700 rounded-lg p-2 flex-grow sm:flex-grow-0">
                                  <span className="text-fuchsia-400 font-black text-[10px]">•</span>
                                  <span className="text-xs font-bold text-slate-200">{obj}</span>
                               </div>
                            ))}
                         </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-1">
                          <span className="text-[10px] font-black text-fuchsia-500 uppercase">Validation</span>
                          <p className="text-xs font-bold text-slate-700">Missionが曖昧なら追加質問を行う。</p>
                        </div>
                        <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-1">
                          <span className="text-[10px] font-black text-fuchsia-500 uppercase">Performance</span>
                          <p className="text-xs font-bold text-slate-700">Mission解析2秒以内。</p>
                        </div>
                        <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl space-y-1">
                          <span className="text-[10px] font-black text-emerald-600 uppercase">Success Condition</span>
                          <p className="text-xs font-bold text-emerald-900">Mission成功条件を必ず定義する。</p>
                        </div>
                        <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl space-y-1">
                          <span className="text-[10px] font-black text-rose-600 uppercase">Failure Condition</span>
                          <p className="text-xs font-bold text-rose-900">Mission失敗条件を定義する。</p>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-fuchsia-50 border border-fuchsia-100 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-fuchsia-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-fuchsia-600 font-black text-lg">!</span>
                        </div>
                        <div>
                          <p className="text-xs text-fuchsia-600 font-bold mb-0.5">Final Rule</p>
                          <p className="text-sm text-fuchsia-900 font-black">Mission未確定ではAI Companyを起動しない。</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* 2. CHAT & TEMPLATE WORKSPACE */}
            {(taskMode === "input" || taskMode === "result" || taskMode === "loading") && selectedCategory && (
              <motion.div
                key="workspace"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6"
              >
                {/* Category header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 bg-white rounded-xl border border-slate-200/80 gap-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl bg-slate-100 w-12 h-12 rounded-xl flex items-center justify-center border border-slate-200/50">
                      {selectedCategory.icon}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-black text-slate-900">{selectedCategory.name} コントロール</h2>
                        <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded", selectedCategory.bgColor, selectedCategory.accentColor)}>
                          ACTIVE
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">{selectedCategory.description}</p>
                    </div>
                  </div>
                  
                  {/* Category resets */}
                  <button
                    onClick={resetToHome}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors self-end sm:self-auto cursor-pointer"
                  >
                    ← カテゴリを変更する
                  </button>
                </div>

                {/* Templates sub-navigation inside category */}
                <div className="space-y-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">
                    タスクテンプレート
                  </span>
                  <div className="flex md:flex-wrap gap-2 overflow-x-auto pb-2 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0 scrollbar-none">
                    {selectedCategory.templates.map((temp) => {
                      const isSelected = selectedTemplate?.id === temp.id;
                      return (
                        <button
                          key={temp.id}
                          onClick={() => selectTemplateHandler(temp)}
                          className={cn(
                            "px-3.5 py-2 rounded-xl text-xs font-bold transition-all border text-left cursor-pointer shrink-0",
                            isSelected
                              ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                              : "bg-white text-slate-600 hover:text-slate-900 border-slate-200 hover:border-slate-300"
                          )}
                        >
                          {temp.name}
                        </button>
                      );
                    })}
                  </div>
                  {selectedTemplate && (
                    <p className="text-[11px] text-slate-500 italic px-1 pt-0.5">
                      💡 特徴: {selectedTemplate.hint}
                    </p>
                  )}
                </div>

                {/* Main Action Input Box */}
                {taskMode === "input" && (
                  <div className="space-y-4 w-full">
                    <MissionInput
                      onSubmit={(customPrompt) => handleAnalyze(undefined, customPrompt)}
                      initialValue={prompt}
                      placeholder={selectedTemplate?.placeholder}
                    />

                    {error && (
                      <motion.div 
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        className="text-rose-600 text-xs flex flex-col gap-3 font-medium bg-rose-50 border border-rose-100 rounded-xl p-4 shadow-sm"
                      >
                        <p className="font-semibold text-rose-700 text-center">{error}</p>
                        {rawError && (
                          <div className="text-left bg-white border border-rose-200 rounded-lg p-3 font-mono text-[10px] text-slate-800 space-y-1 leading-relaxed">
                            <div className="font-semibold text-rose-800 border-b border-rose-100 pb-1 mb-1 flex items-center justify-between">
                              <span>Gemini API Response Details:</span>
                              <span className="px-1 bg-rose-100 rounded text-[8px]">DEBUG</span>
                            </div>
                            <div>Error Code: {rawError.code}</div>
                            <div>Error Status: {rawError.status}</div>
                            <div>Error Message: {rawError.message}</div>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </div>
                )}

                {/* LOADING SCREEN (Steps 3, 4, 5, 6 from Core Journey replaced with high-end Boardroom matrix) */}
                {taskMode === "loading" && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full"
                  >
                    <Boardroom 
                      missionTitle={prompt} 
                      onComplete={() => {
                        setTaskMode("result");
                      }} 
                    />
                  </motion.div>
                )}

                {/* RESULTS VIEW */}
                {taskMode === "result" && result && (
                  <motion.div 
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }}
                    className="space-y-6"
                  >
                    <div className="flex justify-between items-center">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest px-1">
                        分析・生成結果
                      </h3>
                      <button
                        onClick={() => setTaskMode("input")}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        プロンプトを再編集する
                      </button>
                    </div>

                    <ResultDashboard result={result} />
                  </motion.div>
                )}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

          {/* Premium Apple HIG Compliant Footer */}
          <footer id="app-footer" className="mt-auto pt-10 pb-4 border-t border-slate-200/40 dark:border-white/[0.04] text-[11px] font-medium text-slate-400 dark:text-neutral-500">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight bg-gradient-to-r from-slate-500 to-slate-400 bg-clip-text text-transparent">Intelligence OS</span>
                <span>•</span>
                <span>Copyright © {new Date().getFullYear()} Enterprise Squad. All rights reserved.</span>
              </div>
              
              <div className="flex flex-wrap items-center justify-center gap-4">
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/10 dark:border-emerald-500/20 rounded-full text-emerald-600 dark:text-emerald-400 font-mono text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>System Status: Operational</span>
                </div>
                
                <div className="hidden sm:block h-3 w-px bg-slate-200 dark:bg-neutral-800" />
                
                <div className="flex items-center gap-3">
                  <a href="#" className="hover:text-slate-600 dark:hover:text-neutral-300 transition-colors">Privacy Policy</a>
                  <a href="#" className="hover:text-slate-600 dark:hover:text-neutral-300 transition-colors">Terms of Service</a>
                  <a href="#" className="hover:text-slate-600 dark:hover:text-neutral-300 transition-colors">Support</a>
                </div>
              </div>
            </div>
          </footer>

        </div>
      </main>

      {/* Settings Modal */}
      <SettingsModal 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        updateSettings={setSettings}
      />
      
      {/* Universal Search Modal */}
      <UniversalSearch
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectApp={(app) => setCurrentApp(app as any)}
        onViewMission={(mission) => {
          if (mission.resultData) {
            setResult(mission.resultData);
          } else {
            setResult({
              successScore: mission.successScore,
              mission: {
                id: mission.id,
                title: mission.title,
              },
              chiefAgents: [],
              workflowGraph: { nodes: [], links: [] },
              deliverables: [],
              riskAudit: [],
              rulesFollowed: [],
              roiPrediction: { roi: mission.roi }
            } as any);
          }
          setTaskMode("result");
        }}
      />

      {/* AI Assistant Sidebar */}
      <AIAssistantSidebar
        isOpen={isAssistantOpen}
        onClose={() => setIsAssistantOpen(false)}
      />

      {/* Immersive Glassmorphic Overlay Layer for Mission Execution */}
      <AnimatePresence>
        {(taskMode === "loading" || taskMode === "result") && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 bg-slate-950/80 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="w-full max-w-5xl bg-[#0D0D11] border border-white/[0.08] rounded-3xl shadow-2xl h-[90vh] overflow-y-auto relative flex flex-col p-6 md:p-8"
            >
              {/* Overlay header */}
              <div className="flex justify-between items-center pb-4 border-b border-white/[0.06] mb-6 shrink-0">
                <div className="flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
                  <h3 className="text-xs font-black tracking-widest text-indigo-400 uppercase font-mono">
                    Active Mission Cockpit (Overlay Layer)
                  </h3>
                </div>
                <button
                  onClick={() => setTaskMode("categories")}
                  className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold text-slate-300 hover:text-white transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <X className="w-4 h-4" />
                  <span>Close Overlay (Esc)</span>
                </button>
              </div>

              {/* Inner content */}
              <div className="flex-1 min-h-0 overflow-y-auto pr-2">
                {taskMode === "loading" && (
                  <MissionRuntimeConsole
                    missionTitle={prompt}
                    selectedCategory={selectedCategory}
                    activePrompt={prompt}
                    onClose={() => setTaskMode("categories")}
                    onComplete={(data) => {
                      setResult(data);
                      saveToHistory(prompt);
                      
                      // Auto-save completed mission to the Active Workspace
                      const newMission = {
                        id: data.mission?.id || `m-${Date.now()}`,
                        title: prompt,
                        timestamp: new Date().toISOString(),
                        category: selectedCategory?.id || "search",
                        successScore: data.successScore || Math.floor(Math.random() * 5) + 95,
                        roi: data.successPrediction?.roi || data.mission?.roiPrediction || "150% ROI 予測 / 意思決定 of 最大化",
                        status: "Completed" as const,
                        resultData: data // Cache complete result data!
                      };

                      setSavedMissions(prev => {
                        const updated = [newMission, ...prev.filter(m => m.title !== prompt)].slice(0, 15);
                        try {
                          localStorage.setItem("acos_saved_missions", JSON.stringify(updated));
                        } catch (e) {
                          console.warn("localStorage write error", e);
                        }
                        return updated;
                      });

                      setTaskMode("result");
                    }}
                  />
                )}

                {taskMode === "result" && result && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center border-b border-white/5 pb-4">
                      <div className="flex items-center gap-2.5">
                        <Award className="w-5 h-5 text-indigo-400 animate-pulse" />
                        <div>
                          <h3 className="text-xs font-black text-white uppercase tracking-widest font-mono">
                            Mission Deliverables Analytics Scoreboard
                          </h3>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setTaskMode("categories");
                          setPrompt("");
                        }}
                        className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
                      >
                        Start another mission
                      </button>
                    </div>
                    
                    {/* Themed result wrapper */}
                    <div className="bg-[#121214] rounded-3xl p-1 text-slate-100 overflow-x-hidden">
                      <ResultDashboard result={result} />
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
