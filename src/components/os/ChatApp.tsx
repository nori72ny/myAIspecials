import  { useState, useRef, useEffect } from "react";
import { Send, User, Bot, Paperclip, Search, Plus, MessageSquare,  Folder } from "lucide-react";
import { motion } from "motion/react";
import ReactMarkdown from "react-markdown";

export default function ChatApp() {
  const [messages, setMessages] = useState<{role: "user"|"ai", text: string, time: string}[]>([
    { role: "ai", text: "ACOS Chatへようこそ。どのようなミッションを始めますか？", time: new Date().toLocaleTimeString() }
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const handleSend = () => {
    if (!input.trim() || isTyping) return;
    const newMsg = { role: "user" as const, text: input, time: new Date().toLocaleTimeString() };
    setMessages(prev => [...prev, newMsg]);
    setInput("");
    setIsTyping(true);
    
    // Simulate AI typing
    setTimeout(() => {
      setIsTyping(false);
      setMessages(prev => [...prev, { 
        role: "ai", 
        text: `「${newMsg.text}」に関する分析を開始します。OEEにタスクをキューイングしました。`, 
        time: new Date().toLocaleTimeString() 
      }]);
    }, 1200);
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  return (
    <div className="flex h-full w-full bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Sidebar - Chat History */}
      <div className="w-64 bg-slate-50 border-r border-slate-200 flex flex-col hidden md:flex">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <span className="font-bold text-sm text-slate-800">チャット履歴</span>
          <button className="p-1.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-100">
            <Plus className="w-4 h-4 text-slate-600" />
          </button>
        </div>
        <div className="p-2 space-y-1 overflow-y-auto">
          <div className="text-xs font-semibold text-slate-400 uppercase px-2 pt-2 pb-1">Today</div>
          <button className="w-full text-left flex items-center gap-2 p-2 rounded-lg bg-indigo-50 text-indigo-700 font-medium text-xs">
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="truncate">新規ミッションの作成</span>
          </button>
          <button className="w-full text-left flex items-center gap-2 p-2 rounded-lg text-slate-600 hover:bg-slate-100 font-medium text-xs">
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="truncate">OEvEの戦略確認</span>
          </button>
          
          <div className="text-xs font-semibold text-slate-400 uppercase px-2 pt-4 pb-1">Projects</div>
          <button className="w-full text-left flex items-center gap-2 p-2 rounded-lg text-slate-600 hover:bg-slate-100 font-medium text-xs">
            <Folder className="w-3.5 h-3.5" />
            <span className="truncate">Project Alpha</span>
          </button>
        </div>
      </div>
      
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full bg-white relative">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
              <Bot className="w-4 h-4 text-indigo-600" />
            </div>
            <div>
              <h2 className="font-bold text-slate-800 text-sm">ACOS Core Intelligence</h2>
              <p className="text-[10px] text-slate-500">Gemini 3.5 Pro • OEE Connected</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-2 text-slate-400 hover:text-slate-600"><Search className="w-4 h-4" /></button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {messages.map((msg, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-slate-800' : 'bg-indigo-600'}`}>
                {msg.role === 'user' ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-white" />}
              </div>
              <div className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} max-w-[80%]`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-slate-400 font-medium">{msg.time}</span>
                  <span className="text-xs font-bold text-slate-700">{msg.role === 'user' ? 'You' : 'ACOS AI'}</span>
                </div>
                <div className={`px-4 py-3 rounded-2xl text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-slate-50 border border-slate-200 text-slate-800 rounded-tl-none markdown-body'}`}>
                  {msg.role === 'user' ? msg.text : <ReactMarkdown>{msg.text}</ReactMarkdown>}
                </div>
              </div>
            </motion.div>
          ))}
          
          {isTyping && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-4"
            >
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-indigo-600 shrink-0">
                <Bot className="w-4 h-4 text-white animate-pulse" />
              </div>
              <div className="flex flex-col items-start max-w-[80%]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-slate-400 font-medium">Analyzing...</span>
                  <span className="text-xs font-bold text-slate-700">ACOS AI</span>
                </div>
                <div className="px-4 py-3 bg-slate-50 border border-slate-200 text-slate-800 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-bounce" />
                  <span className="w-1.5 h-1.5 bg-purple-600 rounded-full animate-bounce [animation-delay:0.2s]" />
                  <span className="w-1.5 h-1.5 bg-pink-600 rounded-full animate-bounce [animation-delay:0.4s]" />
                </div>
              </div>
            </motion.div>
          )}

          <div ref={endRef} />
        </div>
        
        <div className="p-4 bg-white border-t border-slate-100">
          <div className="max-w-4xl mx-auto flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 transition-all">
            <button className="p-3 text-slate-400 hover:text-indigo-600 rounded-xl hover:bg-indigo-50 transition-colors">
              <Paperclip className="w-5 h-5" />
            </button>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="メッセージを送信する... (Shift+Enterで改行)"
              className="flex-1 bg-transparent border-none resize-none max-h-32 min-h-[44px] py-3 px-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
              rows={1}
            />
            <button 
              onClick={handleSend}
              disabled={!input.trim()}
              className="p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors shadow-sm"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
          <div className="text-center mt-2 text-[9px] text-slate-400 font-medium">
            ACOS Intelligence OS - AI can make mistakes. Consider verifying important information.
          </div>
        </div>
      </div>
    </div>
  );
}
