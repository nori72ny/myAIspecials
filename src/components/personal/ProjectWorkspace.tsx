import { FolderKanban } from 'lucide-react';

export default function ProjectWorkspace() {
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50/50 px-4 py-12 dark:bg-black">
      <section
        aria-labelledby="project-workspace-title"
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-neutral-950"
      >
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 dark:bg-white/10">
          <FolderKanban className="h-7 w-7 text-slate-600 dark:text-neutral-300" aria-hidden="true" />
        </div>
        <h2 id="project-workspace-title" className="text-xl font-bold tracking-tight">
          プロジェクト機能は準備中です
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-neutral-400">
          現在、保存済みのプロジェクトはありません。この機能は一次リリースの画面には表示されません。
        </p>
      </section>
    </div>
  );
}
