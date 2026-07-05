import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../utils";

// ==========================================
// 1. SOVEREIGN_GLASS_CARD
// ==========================================
interface SovereignGlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  id?: string;
  animate?: boolean;
  delay?: number;
}

export function SovereignGlassCard({
  children,
  className,
  id,
  animate = true,
  delay = 0,
  ...props
}: SovereignGlassCardProps) {
  const cardClass = cn(
    "rounded-3xl border border-slate-200/40 dark:border-white/[0.03] backdrop-blur-2xl bg-white/40 dark:bg-neutral-900/10 shadow-sm transition-all duration-300",
    className
  );

  if (animate) {
    return (
      <motion.div
        id={id}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          type: "spring",
          stiffness: 100,
          damping: 15,
          delay: delay,
        }}
        className={cardClass}
        {...(props as any)}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <div id={id} className={cardClass} {...props}>
      {children}
    </div>
  );
}

// ==========================================
// 2. SOVEREIGN_BUTTON
// ==========================================
interface SovereignButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export function SovereignButton({
  variant = "primary",
  size = "md",
  children,
  className,
  id,
  ...props
}: SovereignButtonProps) {
  const baseClass = "inline-flex items-center justify-center font-semibold tracking-tight transition-all duration-300 cursor-pointer active:scale-95 disabled:opacity-50 disabled:pointer-events-none rounded-xl";
  
  const variantClasses = {
    primary: "bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm border border-indigo-500/10",
    secondary: "bg-slate-100 hover:bg-slate-200/80 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-white/[0.03]",
    danger: "bg-red-600 hover:bg-red-700 text-white shadow-sm border border-red-500/10",
    ghost: "hover:bg-slate-100 dark:hover:bg-white/5 text-slate-600 dark:text-slate-400 border border-transparent"
  };

  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs gap-1.5",
    md: "px-4 py-2 text-sm gap-2",
    lg: "px-6 py-3 text-base gap-2.5"
  };

  return (
    <button
      id={id}
      className={cn(baseClass, variantClasses[variant], sizeClasses[size], className)}
      {...props}
    >
      {children}
    </button>
  );
}

// ==========================================
// 3. SOVEREIGN_INPUT
// ==========================================
interface SovereignInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  className?: string;
  id?: string;
}

export const SovereignInput = React.forwardRef<HTMLInputElement, SovereignInputProps>(
  ({ className, id, ...props }, ref) => {
    return (
      <input
        ref={ref}
        id={id}
        className={cn(
          "w-full bg-slate-50/50 dark:bg-neutral-900/40 border border-slate-200/60 dark:border-white/[0.04] rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-8 focus:ring-indigo-500/5 focus:border-indigo-500/40 transition-all duration-300 shadow-inner",
          className
        )}
        {...props}
      />
    );
  }
);
SovereignInput.displayName = "SovereignInput";

// ==========================================
// 4. SOVEREIGN_BADGE
// ==========================================
interface SovereignBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "indigo" | "pink" | "emerald" | "amber" | "red" | "cyan" | "slate";
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export function SovereignBadge({
  variant = "slate",
  children,
  className,
  id,
  ...props
}: SovereignBadgeProps) {
  const baseClass = "inline-flex items-center text-[10px] font-bold px-2.5 py-1 rounded-full border tracking-wide uppercase font-mono transition-all duration-300";
  
  const variantClasses = {
    indigo: "bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-950/40",
    pink: "bg-pink-50 dark:bg-pink-950/20 text-pink-600 dark:text-pink-400 border-pink-100 dark:border-pink-950/40",
    emerald: "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-950/40",
    amber: "bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-950/40",
    red: "bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 border-red-100 dark:border-red-950/40",
    cyan: "bg-cyan-50 dark:bg-cyan-950/20 text-cyan-600 dark:text-cyan-400 border-cyan-100 dark:border-cyan-950/40",
    slate: "bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 border-slate-100 dark:border-white/[0.03]"
  };

  return (
    <span
      id={id}
      className={cn(baseClass, variantClasses[variant], className)}
      {...props}
    >
      {children}
    </span>
  );
}

// ==========================================
// 5. SOVEREIGN_DIALOG
// ==========================================
interface SovereignDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  id?: string;
  className?: string;
}

export function SovereignDialog({
  isOpen,
  onClose,
  title,
  children,
  id,
  className
}: SovereignDialogProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div id={id} className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            onClick={onClose}
          />
          
          {/* Dialog Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{
              type: "spring",
              stiffness: 120,
              damping: 18
            }}
            className={cn(
              "relative w-full max-w-lg bg-[#0D0D11] border border-white/[0.08] rounded-3xl shadow-2xl overflow-hidden flex flex-col p-6 max-h-[90vh]", // design-token-lock-ignore
              className
            )}
          >
            {title && (
              <div className="flex items-center justify-between pb-4 border-b border-white/[0.04] mb-4">
                <h3 className="text-sm font-black text-white font-mono uppercase tracking-wider">{title}</h3>
                <button
                  onClick={onClose}
                  className="text-slate-400 hover:text-white transition-colors cursor-pointer text-xs"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto pr-1">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// ==========================================
// 6. SOVEREIGN_SIDEBAR
// ==========================================
interface SovereignSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  id?: string;
  className?: string;
  title?: string;
}

export function SovereignSidebar({
  isOpen,
  onClose,
  children,
  id,
  className,
  title
}: SovereignSidebarProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop on mobile */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-xs z-40"
            onClick={onClose}
          />
          
          {/* Sidebar element */}
          <motion.div
            id={id}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{
              type: "spring",
              stiffness: 110,
              damping: 16
            }}
            className={cn(
              "fixed right-0 top-0 bottom-0 w-80 max-w-[85vw] bg-[#0A0A0C] border-l border-slate-800/80 dark:border-white/[0.03] text-white flex flex-col h-full shadow-2xl z-50", // design-token-lock-ignore
              className
            )}
          >
            {title && (
              <div className="p-5 border-b border-slate-800/80 dark:border-white/[0.03] flex items-center justify-between">
                <span className="text-xs font-black font-mono tracking-widest uppercase text-slate-400">{title}</span>
                <button
                  onClick={onClose}
                  className="p-1 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ==========================================
// 7. SOVEREIGN_PANEL
// ==========================================
interface SovereignPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export function SovereignPanel({
  children,
  className,
  id,
  ...props
}: SovereignPanelProps) {
  return (
    <div
      id={id}
      className={cn(
        "bg-slate-50/40 dark:bg-neutral-900/10 border border-slate-200/40 dark:border-white/[0.03] rounded-3xl p-6 shadow-xs",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// ==========================================
// 8. SOVEREIGN_SEGMENTED_CONTROL
// ==========================================
interface SegmentOption {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface SovereignSegmentedControlProps {
  options: SegmentOption[];
  selectedValue: string;
  onChange: (value: string) => void;
  id?: string;
  className?: string;
}

export function SovereignSegmentedControl({
  options,
  selectedValue,
  onChange,
  id,
  className
}: SovereignSegmentedControlProps) {
  return (
    <div
      id={id}
      className={cn(
        "flex bg-slate-100 dark:bg-neutral-900/60 p-1 rounded-full border border-slate-200/30 dark:border-white/[0.02] relative",
        className
      )}
    >
      {options.map((opt) => {
        const isActive = opt.id === selectedValue;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-full transition-all duration-300 relative cursor-pointer z-10",
              isActive
                ? "bg-white dark:bg-neutral-800 text-indigo-600 dark:text-indigo-400 shadow-xs"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            )}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
