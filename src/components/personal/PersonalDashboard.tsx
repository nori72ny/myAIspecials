import React from 'react';
import { FileText, Search, Sparkles, TrendingUp, Image as ImageIcon, MessageCircle } from 'lucide-react';
import { cn } from '../../utils';

export default function PersonalDashboard({ onNavigateToChat }: { onNavigateToChat: (prompt?: string) => void }) {
  const quickActions = [
    { id: 'proposal', label: '提案資料作成', icon: FileText, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10' },
    { id: 'sales', label: '営業資料作成', icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
    { id: 'competitor', label: '競合分析', icon: Search, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-500/10' },
    { id: 'seo', label: 'SEO/AIO分析', icon: Sparkles, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10' },
    { id: 'image', label: '画像生成', icon: ImageIcon, color: 'text-pink-500', bg: 'bg-pink-50 dark:bg-pink-500/10' },
    { id: 'sns', label: 'SNS投稿', icon: MessageCircle, color: 'text-indigo-500', bg: 'bg-indigo-50 dark:bg-indigo-500/10' },
  ];

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-12">
      {/* Header */}
      <div className="text-center space-y-4 pt-10">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
          What can I help you with today?
        </h2>
        <p className="text-slate-500 dark:text-neutral-400">
          ACOS Unified AI will automatically route your request to the best model.
        </p>
      </div>

      {/* Main Input */}
      <div className="max-w-2xl mx-auto relative group">
        <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500" />
        <div className="relative bg-white dark:bg-neutral-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-sm p-2 flex flex-col focus-within:ring-2 focus-within:ring-indigo-500/50">
          <textarea
            className="w-full bg-transparent border-none resize-none p-3 focus:outline-none text-sm min-h-[100px]"
            placeholder="Ask anything or run a quick action..."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onNavigateToChat(e.currentTarget.value);
              }
            }}
          />
          <div className="flex justify-between items-center p-2 border-t border-slate-100 dark:border-white/5 mt-2">
            <div className="flex gap-2">
               {/* Tool attachments could go here */}
            </div>
            <button 
              className="px-4 py-1.5 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
              onClick={() => onNavigateToChat()}
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Quick Actions Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-3xl mx-auto">
        {quickActions.map((action) => (
          <button
            key={action.id}
            onClick={() => onNavigateToChat(`${action.label}の作成をお願いします。`)}
            className="flex flex-col items-center justify-center gap-3 p-4 bg-white dark:bg-neutral-950 border border-slate-200 dark:border-white/5 rounded-2xl hover:border-indigo-500/50 hover:shadow-md transition-all text-center group"
          >
            <div className={cn("p-3 rounded-full transition-transform group-hover:scale-110", action.bg, action.color)}>
              <action.icon className="w-5 h-5" />
            </div>
            <span className="text-sm font-medium">{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
