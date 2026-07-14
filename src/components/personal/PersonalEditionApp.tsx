import React, { useState, useEffect } from "react";
import { AnimatePresence, motion } from 'motion/react';
import { 
  MessageSquare, LayoutDashboard, FolderKanban, Brain, 
  Menu, X, Plus,  Sparkles,   
     Activity
} from 'lucide-react';
import { cn } from '../../utils';
import PersonalDashboard from './PersonalDashboard';
import UnifiedChat from './UnifiedChat';
import ProjectWorkspace from './ProjectWorkspace';
import PersonalMemory from './PersonalMemory';
import { useAppState } from '../../hooks/useAppState';

type ViewState = 'dashboard' | 'chat' | 'workspace' | 'memory';

const PersonalEditionApp = React.memo(function PersonalEditionApp({ onSwitchToEnterprise }: { onSwitchToEnterprise: () => void }) {
  const [currentView, setCurrentView] = useState<ViewState>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [chatInitialPrompt, setChatInitialPrompt] = useState<string | undefined>(undefined);
  const [chatSessionId, setChatSessionId] = useState(0);

  const { settings } = useAppState();
  const isEn = settings.language === "en";

  const [aiCoreState, setAiCoreState] = useState<"UNKNOWN" | "CONNECTING" | "HEALTHY" | "DEGRADED" | "OFFLINE" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "NOT_CONFIGURED">("UNKNOWN");

  useEffect(() => {
    const handleAiCoreState = (e: any) => {
      setAiCoreState(e.detail);
    };
    window.addEventListener("aiCoreStateChange", handleAiCoreState);
    return () => window.removeEventListener("aiCoreStateChange", handleAiCoreState);
  }, []);

  const navigateToChat = (initialPrompt?: string) => {
    setChatInitialPrompt(initialPrompt);
    setCurrentView('chat');
  };

  const startNewChat = () => {
    setChatInitialPrompt(undefined);
    setChatSessionId((sessionId) => sessionId + 1);
    setCurrentView('chat');
  };

  const navItems = [
    { id: 'dashboard', label: isEn ? 'Dashboard' : 'ダッシュボード', icon: LayoutDashboard },
    { id: 'chat', label: isEn ? 'Unified Chat' : '統合チャット', icon: MessageSquare },
    { id: 'workspace', label: isEn ? 'Workspace' : 'ワークスペース', icon: FolderKanban },
    { id: 'memory', label: isEn ? 'Memory' : 'メモリ', icon: Brain },
  ] as const;

  const getAiCoreLabel = () => {
    if (isEn) {
      switch (aiCoreState) {
        case "HEALTHY": return "AI Core: Healthy";
        case "CONNECTING": return "AI Core: Connecting";
        case "DEGRADED": return "AI Core: Degraded";
        case "OFFLINE": return "AI Core: Offline";
        case "RATE_LIMITED": return "AI Core: Rate Limited";
        case "PROVIDER_UNAVAILABLE": return "AI Core: Unavailable";
        case "NOT_CONFIGURED": return "AI Core: Setup Required";
        default: return "AI Core: Unknown";
      }
    } else {
      switch (aiCoreState) {
        case "HEALTHY": return "AIコア：正常";
        case "CONNECTING": return "AIコア：接続中";
        case "DEGRADED": return "AIコア：一部制限";
        case "OFFLINE": return "AIコア：オフライン";
        case "RATE_LIMITED": return "AIコア：利用制限中";
        case "PROVIDER_UNAVAILABLE": return "AIコア：AIを利用できません";
        case "NOT_CONFIGURED": return "AIコア：設定が必要";
        default: return "AIコア：状態不明";
      }
    }
  };

  const getAiCoreColor = () => {
    switch (aiCoreState) {
      case "HEALTHY": return "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-500/20";
      case "CONNECTING": return "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-500/20";
      case "RATE_LIMITED":
      case "DEGRADED": return "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-500/20";
      case "OFFLINE":
      case "PROVIDER_UNAVAILABLE":
      case "NOT_CONFIGURED": return "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-100 dark:border-red-500/20";
      default: return "bg-slate-50 dark:bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-100 dark:border-slate-500/20";
    }
  };

  return (
    <div className="flex h-screen w-full bg-white dark:bg-black text-slate-900 dark:text-neutral-100 font-sans overflow-hidden">
      
      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/20 z-40 md:hidden backdrop-blur-sm"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ 
          width: isSidebarOpen ? 260 : 0,
          opacity: isSidebarOpen ? 1 : 0
        }}
        className={cn(
          "fixed md:relative z-50 h-full bg-slate-50 dark:bg-neutral-950 border-r border-slate-200 dark:border-white/10 flex flex-col shrink-0 overflow-hidden",
          !isSidebarOpen && "md:w-0 md:border-none"
        )}
      >
        <div className="p-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 px-2 font-bold tracking-tight text-sm">
            <div className="w-6 h-6 rounded-md bg-black dark:bg-white flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-white dark:text-black" />
            </div>
            <span>ACOS Personal</span>
          </div>
          <button 
            onClick={() => setIsSidebarOpen(false)}
            className="md:hidden p-1 rounded-md text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 pb-2">
          <button 
            onClick={startNewChat}
            data-testid="new-chat-button"
            className="w-full flex items-center gap-2 px-3 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            <span>{isEn ? "New Chat" : "新しいチャット"}</span>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              data-testid={`nav-${item.id}`}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                currentView === item.id 
                  ? "bg-slate-200/50 dark:bg-white/10 text-slate-900 dark:text-white" 
                  : "text-slate-600 dark:text-neutral-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white"
              )}
            >
              <item.icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          ))}

          <div className="pt-6 pb-2 px-3">
            <p className="text-[10px] font-bold text-slate-700 dark:text-neutral-300 uppercase tracking-wider">
              Recent Projects
            </p>
          </div>
          {['ACOS Development', 'Sales Deck', 'Marketing'].map((proj) => (
            <button
              key={proj}
              onClick={() => {
                setActiveProjectId(proj);
                setCurrentView('workspace');
              }}
              className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-white transition-colors group"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-neutral-700 group-hover:bg-indigo-500 transition-colors" />
              <span className="truncate text-left">{proj}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 shrink-0 border-t border-slate-200 dark:border-white/10 space-y-2">
          <button 
            onClick={onSwitchToEnterprise}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-widest border border-slate-200 dark:border-white/10 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
          >
            Switch to Enterprise
          </button>
          <button 
            onClick={() => window.dispatchEvent(new CustomEvent("openSettings"))}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-neutral-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
          >
            <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 text-white flex items-center justify-center text-[10px] font-bold">
              US
            </div>
            <span className="truncate">{isEn ? "User Settings" : "ユーザー設定"}</span>
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full min-w-0 relative">
        <header className="h-12 border-b border-slate-200 dark:border-white/10 flex items-center px-4 shrink-0">
          {!isSidebarOpen && (
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-1.5 -ml-1.5 mr-2 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
          <div className="flex-1 flex items-center justify-between">
            <h1 className="font-semibold text-sm capitalize">
              {currentView === 'workspace' && activeProjectId ? activeProjectId : currentView.replace('-', ' ')}
            </h1>
            <div className="flex items-center gap-3">
              <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border transition-colors duration-300", getAiCoreColor())}>
                <Activity className="w-3 h-3" />
                <span>{getAiCoreLabel()}</span>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${currentView}-${activeProjectId || ''}-${currentView === 'chat' ? chatSessionId : ''}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              {currentView === 'dashboard' && <PersonalDashboard onNavigateToChat={navigateToChat} />}
              {currentView === 'chat' && <UnifiedChat initialPrompt={chatInitialPrompt} />}
              {currentView === 'workspace' && <ProjectWorkspace activeProjectId={activeProjectId} />}
              {currentView === 'memory' && <PersonalMemory />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
});
export default PersonalEditionApp;
