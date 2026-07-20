import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  Brain,
  FolderKanban,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Plus,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "../../utils";
import { useAppState } from "../../hooks/useAppState";
import PersonalDashboard from "./PersonalDashboard";
import PersonalMemory from "./PersonalMemory";
import ProjectWorkspace from "./ProjectWorkspace";
import UnifiedChat from "./UnifiedChat";

type ViewState = "dashboard" | "chat" | "workspace" | "memory";
type AiCoreState =
  | "UNKNOWN"
  | "CONNECTING"
  | "HEALTHY"
  | "DEGRADED"
  | "OFFLINE"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "NOT_CONFIGURED";

type PersonalEditionAppProps = {
  onSwitchToEnterprise: () => void;
};

const PersonalEditionApp = React.memo(function PersonalEditionApp(_props: PersonalEditionAppProps) {
  const [currentView, setCurrentView] = useState<ViewState>("dashboard");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [chatInitialPrompt, setChatInitialPrompt] = useState<string>();
  const [chatSessionId, setChatSessionId] = useState(0);
  const [aiCoreState, setAiCoreState] = useState<AiCoreState>("UNKNOWN");

  const { settings } = useAppState();
  const isEn = settings.language === "en";

  useEffect(() => {
    const handleAiCoreState = (event: Event) => {
      setAiCoreState((event as CustomEvent<AiCoreState>).detail);
    };

    window.addEventListener("aiCoreStateChange", handleAiCoreState);
    return () => window.removeEventListener("aiCoreStateChange", handleAiCoreState);
  }, []);

  useEffect(() => {
    if (!isSidebarOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && window.matchMedia("(max-width: 767px)").matches) {
        setIsSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSidebarOpen]);

  const closeSidebarOnMobile = () => {
    if (window.matchMedia("(max-width: 767px)").matches) setIsSidebarOpen(false);
  };

  const selectView = (view: ViewState) => {
    setCurrentView(view);
    closeSidebarOnMobile();
  };

  const navigateToChat = (initialPrompt?: string) => {
    setChatInitialPrompt(initialPrompt);
    setCurrentView("chat");
    closeSidebarOnMobile();
  };

  const startNewChat = () => {
    setChatInitialPrompt(undefined);
    setChatSessionId((sessionId) => sessionId + 1);
    setCurrentView("chat");
    closeSidebarOnMobile();
  };

  const navItems = [
    { id: "dashboard", label: isEn ? "Home" : "ホーム", icon: LayoutDashboard },
    { id: "chat", label: isEn ? "Chat" : "チャット", icon: MessageSquare },
    { id: "workspace", label: isEn ? "Projects" : "プロジェクト", icon: FolderKanban },
    { id: "memory", label: isEn ? "Memory" : "記憶", icon: Brain },
  ] as const;

  const viewLabels: Record<ViewState, [string, string]> = {
    dashboard: ["Home", "ホーム"],
    chat: ["Chat", "チャット"],
    workspace: ["Projects", "プロジェクト"],
    memory: ["Memory", "記憶"],
  };

  const currentViewLabel = currentView === "workspace" && activeProjectId
    ? activeProjectId
    : viewLabels[currentView][isEn ? 0 : 1];

  const getAiCoreLabel = () => {
    const labels: Record<AiCoreState, [string, string]> = {
      HEALTHY: ["Available", "利用可能"],
      CONNECTING: ["Working", "処理中"],
      DEGRADED: ["Some features are limited", "一部機能を利用できません"],
      OFFLINE: ["Could not connect to ORIGIN", "ORIGINに接続できません"],
      RATE_LIMITED: ["Free AI limit reached", "無料AIの利用上限に達しました"],
      PROVIDER_UNAVAILABLE: ["AI is currently unavailable", "AIを現在利用できません"],
      NOT_CONFIGURED: ["Connection setup required", "接続設定が必要です"],
      UNKNOWN: ["Status unavailable", "状態を確認できません"],
    };
    return labels[aiCoreState][isEn ? 0 : 1];
  };

  const getAiCoreColor = () => {
    switch (aiCoreState) {
      case "CONNECTING":
        return "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-500/20";
      case "RATE_LIMITED":
      case "DEGRADED":
        return "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-500/20";
      case "OFFLINE":
      case "PROVIDER_UNAVAILABLE":
      case "NOT_CONFIGURED":
        return "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-100 dark:border-red-500/20";
      default:
        return "bg-slate-50 dark:bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-100 dark:border-slate-500/20";
    }
  };

  const shouldShowAiStatus = aiCoreState !== "HEALTHY" && aiCoreState !== "UNKNOWN";

  return (
    <div className="flex h-screen w-full overflow-hidden bg-white font-sans text-slate-900 dark:bg-black dark:text-neutral-100">
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm md:hidden"
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      <motion.aside
        initial={false}
        animate={{ width: isSidebarOpen ? 260 : 0, opacity: isSidebarOpen ? 1 : 0 }}
        aria-label={isEn ? "Primary navigation" : "メインナビゲーション"}
        aria-hidden={!isSidebarOpen}
        className={cn(
          "fixed z-50 flex h-full shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-neutral-950 md:relative",
          !isSidebarOpen && "md:w-0 md:border-none",
        )}
      >
        <div className="flex shrink-0 items-center justify-between p-4">
          <div className="flex items-center gap-2 px-2 text-sm font-bold tracking-tight">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-black dark:bg-white">
              <Sparkles className="h-3.5 w-3.5 text-white dark:text-black" aria-hidden="true" />
            </div>
            <span>ORIGIN</span>
          </div>
          <button
            type="button"
            onClick={() => setIsSidebarOpen(false)}
            aria-label={isEn ? "Close sidebar" : "サイドバーを閉じる"}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10 md:hidden"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={startNewChat}
            data-testid="new-chat-button"
            className="flex w-full items-center gap-2 rounded-lg bg-black px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-black"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>{isEn ? "New request" : "新しい依頼"}</span>
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {navItems.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => selectView(item.id)}
              data-testid={`nav-${item.id}`}
              aria-current={currentView === item.id ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                currentView === item.id
                  ? "bg-slate-200/50 text-slate-900 dark:bg-white/10 dark:text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-white",
              )}
            >
              <item.icon className="h-4 w-4" aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          ))}

          <div className="px-3 pb-2 pt-6">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-neutral-300">
              {isEn ? "Recent projects" : "最近のプロジェクト"}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-neutral-500">
              {isEn ? "No projects yet." : "まだプロジェクトはありません。"}
            </p>
          </div>
        </nav>

        <div className="shrink-0 border-t border-slate-200 p-4 dark:border-white/10">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("openSettings"))}
            aria-label={isEn ? "User Settings" : "ユーザー設定"}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/5"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-neutral-300">
              <Settings className="h-4 w-4" aria-hidden="true" />
            </div>
            <span className="truncate">{isEn ? "Settings" : "設定"}</span>
          </button>
        </div>
      </motion.aside>

      <main className="relative flex h-full min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center border-b border-slate-200 px-4 dark:border-white/10">
          {!isSidebarOpen && (
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              aria-label={isEn ? "Open sidebar" : "サイドバーを開く"}
              className="-ml-1.5 mr-2 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          <div className="flex flex-1 items-center justify-between gap-3">
            <h1 className="truncate text-sm font-semibold">{currentViewLabel}</h1>
            {shouldShowAiStatus && (
              <div
                role="status"
                aria-live="polite"
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium transition-colors duration-300",
                  getAiCoreColor(),
                )}
              >
                <Activity className="h-3 w-3" aria-hidden="true" />
                <span>{getAiCoreLabel()}</span>
              </div>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${currentView}-${activeProjectId || ""}-${currentView === "chat" ? chatSessionId : ""}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              {currentView === "dashboard" && <PersonalDashboard onNavigateToChat={navigateToChat} />}
              {currentView === "chat" && <UnifiedChat initialPrompt={chatInitialPrompt} />}
              {currentView === "workspace" && <ProjectWorkspace activeProjectId={activeProjectId} />}
              {currentView === "memory" && <PersonalMemory />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
});

export default PersonalEditionApp;
