import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, User, Sparkles, Activity, CheckCircle2, ChevronDown, Zap } from 'lucide-react';
import { cn } from '../../utils';
import ReactMarkdown from 'react-markdown';

type Message = {
  id: string;
  role: 'user' | 'ai';
  content: string;
  routing?: {
    model: string;
    reason: string;
    score: number;
    timeMs: number;
    cost: number;
  };
};

export default function UnifiedChat({ initialPrompt }: { initialPrompt?: string }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'ai',
      content: 'Hello! I am ACOS Unified AI. How can I assist you today?'
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialPrompt) {
      handleSend(initialPrompt);
    }
  }, [initialPrompt]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSend = (overrideInput?: string) => {
    const textToSend = overrideInput || input;
    if (!textToSend.trim()) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: textToSend };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    // Simulate Intent Analysis and AI Routing
    setTimeout(() => {
      setIsTyping(false);
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: `Based on your request, I've compiled the following information:\n\n1. **Analysis**: We've processed the intent seamlessly.\n2. **Strategy**: The unified core determined the most efficient path.\n\nLet me know if you need further refinement.`,
        routing: {
          model: 'gemini-3.5-flash',
          reason: 'High speed and adequate reasoning capability for general query.',
          score: 98,
          timeMs: 450,
          cost: 0.0001
        }
      };
      setMessages(prev => [...prev, aiMsg]);
    }, 1500);
  };

  return (
    <div className="flex flex-col h-full bg-slate-50/50 dark:bg-black">
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-6 max-w-4xl mx-auto w-full pb-32"
      >
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "flex gap-4 w-full",
                msg.role === 'user' ? "flex-row-reverse" : "flex-row"
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                msg.role === 'user' 
                  ? "bg-slate-200 dark:bg-neutral-800" 
                  : "bg-black dark:bg-white"
              )}>
                {msg.role === 'user' ? (
                  <User className="w-4 h-4 text-slate-600 dark:text-neutral-300" />
                ) : (
                  <Sparkles className="w-4 h-4 text-white dark:text-black" />
                )}
              </div>

              <div className="flex flex-col gap-2 max-w-[80%]">
                <div className={cn(
                  "p-4 rounded-2xl text-sm leading-relaxed",
                  msg.role === 'user' 
                    ? "bg-indigo-600 text-white rounded-tr-none" 
                    : "bg-white dark:bg-neutral-900 border border-slate-200 dark:border-white/10 rounded-tl-none shadow-sm"
                )}>
                  <div className={cn(
                    "markdown-body", 
                    msg.role === 'user' && "text-white prose-p:text-white prose-strong:text-white"
                  )}>
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>

                {/* AI Routing Data */}
                {msg.routing && (
                  <div className="flex items-center gap-3 px-1 text-[10px] font-mono text-slate-400 dark:text-neutral-500">
                    <div className="flex items-center gap-1">
                      <Zap className="w-3 h-3 text-amber-500" />
                      <span>{msg.routing.model}</span>
                    </div>
                    <div className="w-1 h-1 rounded-full bg-slate-300 dark:bg-neutral-700" />
                    <div className="flex items-center gap-1" title="Quality Score">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                      <span>{msg.routing.score}% QS</span>
                    </div>
                    <div className="w-1 h-1 rounded-full bg-slate-300 dark:bg-neutral-700" />
                    <span>{msg.routing.timeMs}ms</span>
                    <div className="w-1 h-1 rounded-full bg-slate-300 dark:bg-neutral-700" />
                    <span>${msg.routing.cost.toFixed(4)}</span>
                    <div className="w-1 h-1 rounded-full bg-slate-300 dark:bg-neutral-700" />
                    <span className="truncate max-w-[150px]" title={msg.routing.reason}>
                      {msg.routing.reason}
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
          {isTyping && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-4"
            >
              <div className="w-8 h-8 rounded-full bg-black dark:bg-white flex items-center justify-center shrink-0">
                <Activity className="w-4 h-4 text-white dark:text-black animate-pulse" />
              </div>
              <div className="bg-white dark:bg-neutral-900 border border-slate-200 dark:border-white/10 rounded-2xl rounded-tl-none px-4 py-3 shadow-sm flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" />
                <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce delay-75" />
                <span className="w-1.5 h-1.5 bg-pink-500 rounded-full animate-bounce delay-150" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="absolute bottom-0 w-full bg-gradient-to-t from-slate-50 via-slate-50 to-transparent dark:from-black dark:via-black p-4 pb-6 pt-10">
        <div className="max-w-3xl mx-auto relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500" />
          <div className="relative flex items-end gap-2 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-white/10 p-2 rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-indigo-500/50">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message ACOS..."
              className="flex-1 max-h-32 min-h-[44px] bg-transparent border-none resize-none p-3 focus:outline-none text-sm leading-relaxed"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button 
              onClick={() => handleSend()}
              disabled={!input.trim() || isTyping}
              className="p-3 mb-0.5 mr-0.5 bg-black dark:bg-white text-white dark:text-black rounded-xl hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 transition-all shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
