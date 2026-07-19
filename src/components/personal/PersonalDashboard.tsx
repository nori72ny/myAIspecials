import React, { useState } from 'react';
import { ArrowUp, ShieldCheck, Sparkles } from 'lucide-react';
import { useAppState } from '../../hooks/useAppState';

export default function PersonalDashboard({ onNavigateToChat }: { onNavigateToChat: (prompt?: string) => void }) {
  const { settings } = useAppState();
  const isEn = settings.language === 'en';
  const [input, setInput] = useState('');

  const examples = isEn
    ? [
        'Organize my idea and identify the next steps',
        'Research and compare the available options',
        'Create a clear document from these notes',
        'Summarize this information and highlight decisions',
      ]
    : [
        '考えを整理して、次にやることを決めたい',
        '候補を調べて、分かりやすく比較したい',
        'メモをもとに、伝わる資料を作りたい',
        '情報を要約して、判断ポイントを知りたい',
      ];

  const submit = () => {
    const prompt = input.trim();
    if (!prompt) return;
    onNavigateToChat(prompt);
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-10 md:px-8 md:py-16">
      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center">
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm dark:border-white/10 dark:bg-neutral-950 dark:text-neutral-300">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            <span>ORIGIN Personal</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white md:text-5xl">
            {isEn ? 'What would you like to achieve?' : '何を実現したいですか？'}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-600 dark:text-neutral-400 md:text-base">
            {isEn
              ? 'Describe the outcome in your own words. ORIGIN decides the suitable AI and approach under its safety and free-only rules.'
              : '目的や困っていることを、そのまま書いてください。ORIGINが内容に合わせて、使うAIと進め方を安全・無料限定の条件内で判断します。'}
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-200/40 transition focus-within:border-slate-400 focus-within:ring-4 focus-within:ring-slate-100 dark:border-white/10 dark:bg-neutral-950 dark:shadow-black/30 dark:focus-within:border-white/30 dark:focus-within:ring-white/5">
          <label htmlFor="origin-home-request" className="sr-only">
            {isEn ? 'Describe what you want ORIGIN to help you achieve' : 'ORIGINに実現してほしいことを入力'}
          </label>
          <textarea
            id="origin-home-request"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            className="min-h-[150px] w-full resize-none border-none bg-transparent px-3 py-3 text-base leading-7 text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-neutral-600"
            placeholder={isEn
              ? 'Example: Help me plan a new product, compare the options, and prepare a clear proposal.'
              : '例：新商品の企画を整理し、候補を比較して、提案資料のたたき台まで作りたい'}
          />
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-2 pt-3 dark:border-white/5">
            <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-neutral-500">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {isEn ? 'Do not enter passwords, API keys, or other secrets.' : 'パスワードやAPIキーなどの秘密情報は入力しないでください。'}
            </p>
            <button
              type="button"
              onClick={submit}
              disabled={!input.trim()}
              aria-label={isEn ? 'Send request to ORIGIN' : 'ORIGINに依頼を送信'}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-white dark:text-black"
            >
              <ArrowUp className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-7">
          <p className="mb-3 text-center text-xs font-medium text-slate-500 dark:text-neutral-500">
            {isEn ? 'Examples — edit before sending' : '入力例 — 選んだ後に自由に書き換えられます'}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {examples.map((example) => (
              <button
                type="button"
                key={example}
                onClick={() => setInput(example)}
                className="rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-white/10 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:border-white/30 dark:hover:bg-white/5"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
