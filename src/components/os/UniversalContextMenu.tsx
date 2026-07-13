import  { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, PenTool, Sparkles, Languages, Settings2 } from "lucide-react";

interface Point {
  x: number;
  y: number;
}

export default function UniversalContextMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 });
  const [selectedText, setSelectedText] = useState("");

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Only show if text is selected
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      
      if (text) {
        e.preventDefault();
        setSelectedText(text);
        setPosition({ x: e.clientX, y: e.clientY });
        setIsOpen(true);
      }
    };

    const handleClick = () => {
      if (isOpen) setIsOpen(false);
    };

    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("click", handleClick);

    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("click", handleClick);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, filter: "blur(4px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, scale: 0.95, filter: "blur(4px)" }}
        transition={{ duration: 0.15 }}
        style={{
          position: "fixed",
          left: position.x,
          top: position.y,
          zIndex: 9999 }}
        className="w-64 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl border border-slate-200/50 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden p-1.5"
      >
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 py-2 border-b border-slate-200 dark:border-white/10 mb-1 flex items-center justify-between">
          <span>ACOS Quick Action</span>
          <Sparkles className="w-3 h-3 text-indigo-400" />
        </div>
        
        <div className="space-y-0.5">
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 transition-colors text-left text-xs font-semibold text-slate-700 dark:text-neutral-200 cursor-pointer">
            <Search className="w-4 h-4 text-slate-400" />
            「{selectedText.substring(0, 10)}...」について調査
          </button>
          
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 transition-colors text-left text-xs font-semibold text-slate-700 dark:text-neutral-200 cursor-pointer">
            <PenTool className="w-4 h-4 text-emerald-400" />
            文章を推敲・改善する
          </button>

          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 transition-colors text-left text-xs font-semibold text-slate-700 dark:text-neutral-200 cursor-pointer">
            <Languages className="w-4 h-4 text-amber-400" />
            翻訳する (Translate)
          </button>

          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 transition-colors text-left text-xs font-semibold text-slate-700 dark:text-neutral-200 cursor-pointer">
            <Settings2 className="w-4 h-4 text-purple-400" />
            アクションのカスタマイズ...
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
