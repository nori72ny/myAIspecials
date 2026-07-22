import { Brain } from 'lucide-react';

export default function PersonalMemory() {
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50/50 px-4 py-12 dark:bg-black">
      <section
        aria-labelledby="personal-memory-title"
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-neutral-950"
      >
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 dark:bg-white/10">
          <Brain className="h-7 w-7 text-slate-600 dark:text-neutral-300" aria-hidden="true" />
        </div>
        <h2 id="personal-memory-title" className="text-xl font-bold tracking-tight">
          記憶機能は準備中です
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-neutral-400">
          現時点では、会話内容を個人記憶として保存しません。この機能は一次リリースの画面には表示されません。
        </p>
      </section>
    </div>
  );
}
