import React, { useState, useEffect } from "react";
import { useReducedMotion } from "motion/react";
import { Settings, AnalysisResult, WorkspaceCategory, TaskTemplate } from "../types";
import { cn, ProductionLogger, SafeStorage } from "../utils";

export const CATEGORIES: WorkspaceCategory[] = [
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
      { id: "react_app", name: "Reactアプリ設計", placeholder: "〇〇アプリ（例: 習慣トラッカーアプリ）を構築するための、フォルダ構造、必要なState設計、コンポーネント分割、および主要なhooks of 設計図を作成してください。", hint: "クリーンアーキテクチャに則った全体設計" }
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

export type AppView = "personal" | "mission" | "dashboard" | "chat" | "routing-tester" | "multi-ai" | "workflows" | "memory" | "prompt-library" | "ai-performance" | "observability-center" | "settings" | "brain" | "workspace" | "organization" | "marketplace" | "swarm-debugger";
export type TaskStateMode = "categories" | "input" | "loading" | "result";

export function useAppState() {
  const prefersReducedMotion = useReducedMotion();
  const transitionY = prefersReducedMotion ? 0 : 15;
  const transitionX = prefersReducedMotion ? "0%" : "-100%";

  const [currentApp, setCurrentApp] = useState<AppView>("personal");
  const [taskMode, setTaskMode] = useState<TaskStateMode>("categories");

  // Persistent workspace saved missions state
  const [savedMissions, setSavedMissions] = useState<any[]>(() => {
    const defaultMissions = [
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
    const stored = SafeStorage.get<any[]>("acos_saved_missions", (data) => Array.isArray(data));
    return stored || defaultMissions;
  });

  const [homeTab, setHomeTab] = useState<string>("missions");
  const [selectedCategory, setSelectedCategory] = useState<WorkspaceCategory | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<TaskTemplate | null>(null);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [rawError, setRawError] = useState<{ code: string; status: string; message: string } | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [booting, setBooting] = useState(true);
  const [loadingStep, setLoadingStep] = useState(1);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);

  const [settings, setSettings] = useState<Settings>(() => {
    const defaultSettings: Settings = {
      autoRoute: true,
      selectedAgents: ["gemini", "openai"],
      language: "ja",
      developerMode: false
    };
    const stored = SafeStorage.get<Settings>("acos_settings", (data) => typeof data === "object" && data !== null);
    if (stored) {
      if (!stored.language) stored.language = "ja";
      if (stored.developerMode === undefined) stored.developerMode = false;
      return stored;
    }
    return defaultSettings;
  });

  const [history, setHistory] = useState<string[]>(() => {
    const stored = SafeStorage.get<string[]>("workspace_query_history", (data) => Array.isArray(data));
    return stored || [];
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setBooting(false);
    }, 950);
    return () => clearTimeout(timer);
  }, []);

  // Keyboard accessibility listeners (Raycast style)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsSearchOpen(prev => !prev);
      }
      if (e.key === "Escape") {
        if (taskMode === "result" || taskMode === "loading") {
          setTaskMode("categories");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [taskMode]);

  const updateSettings = (newSettings: Settings) => {
    setSettings(newSettings);
    SafeStorage.set("acos_settings", newSettings);
  };

  const saveToHistory = (newPrompt: string) => {
    const trimmed = newPrompt.trim();
    if (!trimmed) return;
    const updated = [trimmed, ...history.filter((h) => h !== trimmed)].slice(0, 10);
    setHistory(updated);
    SafeStorage.set("workspace_query_history", updated);
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
    setCurrentApp("mission");
    setLoadingStep(1);
    setResult(null);

    if (!selectedCategory) {
      setSelectedCategory(CATEGORIES[0]);
    }

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

      // Read streamed SSE events
      const reader = response.body?.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const dataStr = line.slice(6).trim();
              if (!dataStr) continue;
              try {
                const event = JSON.parse(dataStr);
                if (event.type === "result") {
                  fetchedData = event.data;
                  fetchSuccess = true;
                } else if (event.type === "error") {
                  throw new Error(event.details || "API Stream error");
                }
              } catch (e) {
                console.warn("Failed to parse SSE line in useAppState:", e);
              }
            }
          }
        }
      }
    } catch (err: any) {
      ProductionLogger.error("Failed to analyze task prompt via backend API", err);
      fetchErrorMsg = err instanceof Error ? err.message : "AIバックエンドとの通信中にエラーが発生しました。";
    }

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
      
      const newMission = {
        id: fetchedData.mission?.id || `m-${Date.now()}`,
        title: activePrompt,
        timestamp: new Date().toISOString(),
        category: selectedCategory?.id || "search",
        successScore: fetchedData.successScore || Math.floor(Math.random() * 5) + 95,
        roi: fetchedData.successPrediction?.roi || fetchedData.mission?.roiPrediction || "150% ROI 予測 / 意思決定の最大化",
        status: "Completed" as const,
        resultData: fetchedData
      };

      setSavedMissions(prev => {
        const updated = [newMission, ...prev.filter(m => m.title !== activePrompt)].slice(0, 15);
        SafeStorage.set("acos_saved_missions", updated);
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
    SafeStorage.remove("workspace_query_history");
  };

  return {
    prefersReducedMotion,
    transitionY,
    transitionX,
    currentApp,
    setCurrentApp,
    taskMode,
    setTaskMode,
    savedMissions,
    setSavedMissions,
    homeTab,
    setHomeTab,
    selectedCategory,
    setSelectedCategory,
    selectedTemplate,
    setSelectedTemplate,
    prompt,
    setPrompt,
    result,
    setResult,
    error,
    setError,
    rawError,
    setRawError,
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    booting,
    setBooting,
    loadingStep,
    setLoadingStep,
    isSettingsOpen,
    setIsSettingsOpen,
    isSearchOpen,
    setIsSearchOpen,
    isAssistantOpen,
    setIsAssistantOpen,
    settings,
    setSettings: updateSettings,
    updateSettings,
    history,
    clearHistory,
    handleAnalyze,
    selectCategoryHandler,
    selectTemplateHandler,
    resetToHome,
  };
}
