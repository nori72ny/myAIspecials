import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Mic, Send, Sparkles, Sun, Moon, Check, CornerDownLeft, Volume2 } from "lucide-react";

export interface MissionInputProps {
  /**
   * Callback function called when the user submits a mission
   */
  onSubmit?: (prompt: string) => void;
  /**
   * Initial value of the prompt input field
   */
  initialValue?: string;
  /**
   * Placeholder text for the input field
   */
  placeholder?: string;
}

export default function MissionInput({
  onSubmit,
  initialValue = "",
  placeholder = "プロフェッショナルな市場調査、システム設計、戦略策定など、あなたのミッションを詳細に入力してください..."
}: MissionInputProps) {
  const [prompt, setPrompt] = useState(initialValue);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Suggested quick prompts to help the user get started
  const suggestions = [
    "AIシステムの全体システム設計図を作成して",
    "新規事業に向けた競合調査とSWOT分析",
    "React+Tailwindを使った高機能UIコンポーネント"
  ];

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim()) return;

    setIsSubmitted(true);
    setTimeout(() => {
      setIsSubmitted(false);
    }, 2000);

    if (onSubmit) {
      onSubmit(prompt);
    }
  };

  const handleSuggestClick = (suggestion: string) => {
    setPrompt(suggestion);
  };

  const toggleVoiceInput = () => {
    setIsListening(prev => !prev);
    // Voice input is UI-only as requested, but we can simulate a temporary typing effect
    if (!isListening) {
      const phrases = [
        "世界中のAIを公平・定量的に評価する...",
        "新規事業のマーケティング戦略を立案...",
        "マイクロサービス構成の設計書を策定して..."
      ];
      const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];
      
      let currentText = "";
      let i = 0;
      const interval = setInterval(() => {
        if (i < randomPhrase.length) {
          currentText += randomPhrase[i];
          setPrompt(prev => prev + randomPhrase[i]);
          i++;
        } else {
          clearInterval(interval);
          setIsListening(false);
        }
      }, 70);
    }
  };

  return (
    <div className={isDarkMode ? "dark" : ""}>
      <div 
        id="mission-input-container"
        className="min-h-[500px] w-full flex flex-col items-center justify-center p-4 sm:p-8 transition-colors duration-500 bg-slate-50 dark:bg-[#08080c] text-slate-800 dark:text-slate-100 font-sans"
      >
        {/* Theme Switcher and Indicators */}
        <div className="w-full max-w-2xl flex justify-end mb-6">
          <button
            type="button"
            id="theme-toggle-btn"
            onClick={() => setIsDarkMode(prev => !prev)}
            className="p-2.5 rounded-xl border bg-white dark:bg-[#121218] border-slate-200 dark:border-white/10 hover:border-indigo-500/50 dark:hover:border-indigo-500/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all shadow-sm cursor-pointer text-slate-500 dark:text-slate-400"
            title={isDarkMode ? "ライトモードに切り替え" : "ダークモードに切り替え"}
          >
            {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        {/* Brand Header */}
        <div className="text-center space-y-4 mb-8 max-w-xl">
          {/* Logo Animation */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="flex items-center justify-center gap-2"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/25 dark:shadow-indigo-500/10">
              <Sparkles className="w-5 h-5 text-white animate-pulse" />
            </div>
            <span className="text-xl font-black tracking-[0.2em] bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 dark:from-white dark:via-slate-200 dark:to-slate-400 font-mono">
              ORIGIN OS
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.8 }}
            className="text-2xl sm:text-3.5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-slate-900 to-slate-700 dark:from-white dark:to-slate-300"
          >
            今日は何を達成しますか？
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.8 }}
            className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-medium font-mono uppercase tracking-wider"
          >
            Intelligence Orchestrator &bull; Mission Success Engine
          </motion.p>
        </div>

        {/* Input Card Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="w-full max-w-2xl bg-white dark:bg-[#121218] border border-slate-200 dark:border-white/5 rounded-3xl p-5 sm:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.03)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.3)] transition-all duration-300 relative overflow-hidden"
        >
          {/* Active listening glow overlay */}
          <AnimatePresence>
            {isListening && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-purple-500/5 dark:from-indigo-500/10 dark:to-purple-500/10 animate-pulse pointer-events-none"
              />
            )}
          </AnimatePresence>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Input Text Area */}
            <div className="relative group">
              <textarea
                id="mission-textarea"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={placeholder}
                rows={5}
                className="w-full bg-slate-50 dark:bg-[#171722]/50 border border-slate-200 dark:border-white/5 group-hover:border-slate-300 dark:group-hover:border-white/10 focus:border-indigo-500 dark:focus:border-indigo-500 focus:bg-white dark:focus:bg-[#14141d] rounded-2xl py-4 pl-4 pr-12 text-sm sm:text-base text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none transition-all duration-300 leading-relaxed font-sans"
              />

              {/* Character Count */}
              <div className="absolute bottom-3 right-3 text-[10px] font-mono text-slate-400 dark:text-white/20">
                {prompt.length} chars
              </div>
            </div>

            {/* Bottom Controls */}
            <div className="flex flex-col sm:flex-row justify-between items-center pt-2 gap-4">
              <div className="flex items-center gap-2">
                {/* Voice Input Button */}
                <button
                  type="button"
                  id="voice-input-btn"
                  onClick={toggleVoiceInput}
                  className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center gap-1.5 ${
                    isListening
                      ? "bg-rose-500/10 text-rose-500 border-rose-500/30 dark:bg-rose-500/20 dark:text-rose-400 dark:border-rose-500/40 animate-pulse"
                      : "bg-slate-50 dark:bg-[#171722] text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10 hover:text-slate-800 dark:hover:text-white"
                  }`}
                  title="音声入力をシミュレート"
                >
                  <Mic className="w-4 h-4" />
                  {isListening && <Volume2 className="w-3.5 h-3.5" />}
                  <span className="text-[11px] font-bold font-mono">
                    {isListening ? "RECORDING..." : "VOICE"}
                  </span>
                </button>
              </div>

              {/* Submit Action Button */}
              <button
                type="submit"
                id="submit-mission-btn"
                disabled={!prompt.trim()}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:from-slate-100 disabled:to-slate-100 dark:disabled:from-[#171722] dark:disabled:to-[#171722] disabled:text-slate-400 dark:disabled:text-white/10 text-white rounded-2xl font-black text-xs sm:text-sm transition-all duration-300 shadow-md shadow-indigo-600/10 hover:shadow-lg hover:shadow-indigo-600/20 active:scale-98 disabled:pointer-events-none cursor-pointer tracking-wider"
              >
                {isSubmitted ? (
                  <>
                    <Check className="w-4 h-4 animate-scale-in" />
                    <span>MISSION LOCKED</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>LAUNCH MISSION</span>
                    <CornerDownLeft className="w-3.5 h-3.5 opacity-60 hidden sm:inline" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Prompt Suggestions */}
          <div className="mt-6 pt-5 border-t border-slate-100 dark:border-white/5 space-y-2.5">
            <span className="text-[10px] font-mono tracking-wider text-slate-400 dark:text-white/30 uppercase block font-black">
              Recommended Starter Blueprints
            </span>
            <div className="flex flex-col gap-1.5">
              {suggestions.map((sug, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSuggestClick(sug)}
                  className="w-full text-left text-xs text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300 hover:bg-slate-50 dark:hover:bg-white/2 p-2 rounded-xl transition-all border border-transparent hover:border-slate-200/50 dark:hover:border-white/5 cursor-pointer flex items-center gap-2 font-medium"
                >
                  <span className="text-indigo-500/50 dark:text-indigo-400/50 font-mono font-black">0{idx + 1}</span>
                  <span className="flex-1 truncate">{sug}</span>
                </button>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Universal Blueprint Footer Statement */}
        <div className="mt-8 text-center max-w-sm space-y-1.5">
          <p className="text-[10px] text-slate-400 dark:text-white/20 font-medium font-mono">
            BUILD 020 &bull; SYSTEM ARCHITECTURE BIBLE COMPLIANT
          </p>
          <p className="text-[9px] text-slate-400/80 dark:text-white/15 leading-relaxed font-mono">
            All AI operations are strictly sandboxed, self-audited via Quality Bible (Q5), and governed by the Core Constitution.
          </p>
        </div>
      </div>
    </div>
  );
}
