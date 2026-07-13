import React from "react";
import  { useState } from 'react';
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

type ViewState = 'dashboard' | 'chat' | 'workspace' | 'memory';

const PersonalEditionApp = React.memo(function PersonalEditionApp({ onSwitchToEnterprise }: { onSwitchToEnterprise: () => void }) {
  const [currentView, setCurrentView] = useState<ViewState>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [chatInitialPrompt, setChatInitialPrompt] = useState<string | undefined>(undefined);

  const navigateToChat = (initialPrompt?: string) => {
    setChatInitialPrompt(initialPrompt);
    setCurrentView('chat');
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'chat', label: 'Unified Chat', icon: MessageSquare },
    { id: 'workspace', label: 'Workspace', icon: FolderKanban },
    { id: 'memory', label: 'Memory', icon: Brain },
  ] as const;

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
            onClick={() => {
              setChatInitialPrompt(undefined);
              setCurrentView('chat');
            }}
            className="w-full flex items-center gap-2 px-3 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            <span>New Chat</span>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id)}
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
            <p className="text-[10px] font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-wider">
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
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-neutral-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
            <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 text-white flex items-center justify-center text-[10px] font-bold">
              US
            </div>
            <span className="truncate">User Settings</span>
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
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium border border-emerald-100 dark:border-emerald-500/20">
                <Activity className="w-3 h-3" />
                <span>AI Core: Optimal</span>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentView + (activeProjectId || '')}
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
