import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, User, Sparkles, Activity, CheckCircle2, Zap, AlertTriangle, RefreshCw, Settings } from 'lucide-react';
import { cn } from '../../utils';
import ReactMarkdown from 'react-markdown';
import { useAppState } from '../../hooks/useAppState';

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
  error?: {
    code: string;
    messageKey: string;
    retryable: boolean;
    requestId: string;
    description: string;
  };
};

export default function UnifiedChat({ initialPrompt }: { initialPrompt?: string }) {
  const { settings } = useAppState();
  const isEn = settings.language === "en";

  const defaultGreeting = isEn 
    ? 'Hello! I am ACOS Unified AI. How can I assist you today?'
    : 'こんにちは！ACOS統合AIです。何かお手伝いしましょうか？';

  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'ai',
      content: defaultGreeting
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

  const dispatchAiCoreState = (state: "UNKNOWN" | "CONNECTING" | "HEALTHY" | "DEGRADED" | "OFFLINE" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "NOT_CONFIGURED") => {
    window.dispatchEvent(new CustomEvent("aiCoreStateChange", { detail: state }));
  };

  const processSend = async (messageList: Message[]) => {
    setIsTyping(true);
    dispatchAiCoreState("CONNECTING");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ 
          messages: messageList.filter(m => !m.error).map(m => ({ role: m.role, content: m.content })),
          userLocation: (settings as any).location // fallback type if it's not strictly defined
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw data;
      }

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: data.content,
        routing: data.routing
      };
      setMessages(prev => [...prev, aiMsg]);
      dispatchAiCoreState("HEALTHY");
    } catch (error: any) {
      console.error(error);
      
      let aiCoreState: any = "OFFLINE";
      let title = isEn ? "Could not connect to ACOS" : "ACOSに接続できませんでした";
      let desc = isEn 
        ? "Failed to communicate with AI processing system.\nPlease try again later."
        : "AI処理システムとの通信に失敗しました。\nしばらくしてから再試行してください。";
        
      if (error?.code === "PROVIDER_RATE_LIMITED") {
        aiCoreState = "RATE_LIMITED";
        title = isEn ? "Rate Limit Exceeded" : "レートリミット超過";
        desc = isEn ? "Please wait a moment before trying again." : "しばらく待ってから再度お試しください。";
      } else if (error?.code === "PROVIDER_NOT_CONFIGURED" || error?.code === "API_KEY_INVALID") {
        aiCoreState = "NOT_CONFIGURED";
        title = isEn ? "Configuration Required" : "設定が必要です";
        desc = isEn ? "Please configure your API keys in User Settings." : "ユーザー設定からAPIキーを設定してください。";
      } else if (error?.code === "PROVIDER_UNAVAILABLE" || error?.code === "MODEL_NOT_FOUND") {
        aiCoreState = "PROVIDER_UNAVAILABLE";
        title = isEn ? "Service Unavailable" : "サービス利用不可";
        desc = isEn ? "The AI provider is currently unavailable or the model is not found." : "現在AIプロバイダーが利用できないか、モデルが見つかりません。無料モデルが存在しない可能性もあります。";
      } else if (error?.code === "PROVIDER_TIMEOUT") {
        aiCoreState = "OFFLINE";
        title = isEn ? "Request Timeout" : "タイムアウト";
        desc = isEn ? "The request took too long to complete." : "リクエストの処理に時間がかかりすぎました。";
      } else if (error?.code === "INVALID_ARGUMENT" || error?.code === "INVALID_CHAT_MESSAGES") {
        aiCoreState = "DEGRADED";
      }

      dispatchAiCoreState(aiCoreState);

      const errMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: title,
        error: {
          code: error?.code || "BRAIN_UNREACHABLE",
          messageKey: error?.messageKey || "errors.network",
          retryable: error?.retryable !== false,
          requestId: error?.requestId || "UNKNOWN",
          description: desc
        }
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSend = async (overrideInput?: string) => {
    if (isTyping) return;
    const textToSend = overrideInput || input;
    if (!textToSend.trim()) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: textToSend };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    
    await processSend(updatedMessages);
  };

  const handleRetry = async () => {
    if (isTyping) return;
    // Remove the last error message(s)
    const validMessages = [...messages];
    while (validMessages.length > 0 && validMessages[validMessages.length - 1].error) {
      validMessages.pop();
    }
    setMessages(validMessages);
    await processSend(validMessages);
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
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1",
                msg.role === 'user' 
                  ? "bg-slate-200 dark:bg-neutral-800" 
                  : msg.error ? "bg-red-100 dark:bg-red-500/20" : "bg-black dark:bg-white"
              )}>
                {msg.role === 'user' ? (
                  <User className="w-4 h-4 text-slate-600 dark:text-neutral-300" />
                ) : msg.error ? (
                  <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
                ) : (
                  <Sparkles className="w-4 h-4 text-white dark:text-black" />
                )}
              </div>

              <div className="flex flex-col gap-2 max-w-[80%]">
                {msg.error ? (
                  <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-4 rounded-2xl rounded-tl-none shadow-sm flex flex-col gap-3">
                    <h4 className="text-sm font-bold text-red-800 dark:text-red-300">{msg.content}</h4>
                    <p className="text-sm text-red-700 dark:text-red-400 whitespace-pre-wrap">{msg.error.description}</p>
                    
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {msg.error.retryable && (
                        <button
                          onClick={handleRetry}
                          disabled={isTyping}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 dark:bg-red-500/20 hover:bg-red-200 dark:hover:bg-red-500/30 text-red-700 dark:text-red-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          {isEn ? "Retry" : "再試行"}
                        </button>
                      )}
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent("openSettings"))}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-neutral-800 hover:bg-slate-50 dark:hover:bg-neutral-700 text-slate-700 dark:text-neutral-300 border border-slate-200 dark:border-neutral-700 text-xs font-medium rounded-lg transition-colors"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        {isEn ? "Check Settings" : "接続設定を確認"}
                      </button>
                    </div>

                    <div className="flex items-center gap-4 text-[10px] text-red-500/70 font-mono mt-1 border-t border-red-200/50 dark:border-red-500/20 pt-2">
                      <span>Error Code: {msg.error.code}</span>
                      <span>Req: {msg.error.requestId}</span>
                    </div>
                  </div>
                ) : (
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
                )}

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
                      <span>{msg.routing.score != null ? `${msg.routing.score}% QS` : (isEn ? 'NOT MEASURED' : '未測定')}</span>
                    </div>
                    <div className="w-1 h-1 rounded-full bg-slate-300 dark:bg-neutral-700" />
                    <span>{msg.routing.timeMs}ms</span>
                    <div className="w-1 h-1 rounded-full bg-slate-300 dark:bg-neutral-700" />
                    <span>{msg.routing.cost != null ? `$${msg.routing.cost.toFixed(4)}` : (isEn ? 'NOT MEASURED' : '未測定')}</span>
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
              <div className="w-8 h-8 rounded-full bg-black dark:bg-white flex items-center justify-center shrink-0 mt-1">
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
              placeholder={isEn ? "Message ACOS..." : "ACOSにメッセージを入力..."}
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
