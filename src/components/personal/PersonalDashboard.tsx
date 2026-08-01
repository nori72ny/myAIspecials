import { useState } from 'react';
import { ArrowUp, ShieldCheck, Sparkles } from 'lucide-react';

type PersonalDashboardProps = {
  onNavigateToChat: (prompt?: string) => void;
  language?: 'ja' | 'en';
};

export default function PersonalDashboard({ onNavigateToChat, language }: PersonalDashboardProps) {
  const isEn = language === 'en';
  const [input, setInput] = useState('');

  const examples = isEn
    ? [
        'Help me organize my thoughts and decide the next step',
        'Paste the option details and compare the differences',
        'Turn these notes into a clear document',
      ]
    : [
        '考えを整理して、次にやることを決めたい',
        '候補の情報を貼り付けて、違いを比較したい',
        'メモから、読みやすい文書を作りたい',
      ];

  const submit = () => {
    const prompt = input.trim();
    if (!prompt) return;
    onNavigateToChat(prompt);
  };

  return (
    <div className="origin-dashboard mx-auto flex min-h-full w-full max-w-7xl flex-col px-4 py-8 sm:px-6 md:px-10 md:py-14">
      <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center">
        <div className="mb-8 text-left md:mb-10">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/80 px-3 py-1.5 text-xs font-semibold tracking-[0.04em] text-slate-700 shadow-sm dark:border-white/10 dark:bg-neutral-950/80 dark:text-neutral-300">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{isEn ? 'ORIGIN · From request to result' : 'ORIGIN · 相談から成果物まで'}</span>
          </div>
          <h2 className="max-w-3xl text-[2.15rem] font-semibold leading-[1.18] tracking-[-0.035em] text-slate-950 dark:text-white sm:text-5xl md:text-[3.5rem]">
            {isEn ? 'What can I help you with?' : '何を手伝えばよいですか？'}
          </h2>
          <p className="mt-5 max-w-2xl text-[0.95rem] leading-7 text-slate-600 dark:text-neutral-300 md:text-base md:leading-8">
            {isEn
              ? 'Start with a rough thought. ORIGIN organizes it into a usable result. It uses only AI confirmed as free and stops when cost or the actual route cannot be verified.'
              : 'まだ曖昧な考えでも、そのまま書いてください。ORIGINが整理し、使える成果へ進めます。無料と確認できるAIだけを使い、費用や実行先を確認できない場合は回答を表示しません。'}
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-slate-600 dark:text-neutral-300" aria-label={isEn ? 'Execution guarantees' : '実行条件'}>
            <span className="origin-trust-chip">{isEn ? '$0.00 maximum' : '$0.00上限'}</span>
            <span className="origin-trust-chip">{isEn ? 'Fixed free model' : '無料モデル固定'}</span>
            <span className="origin-trust-chip">{isEn ? 'No automatic switching' : '自動切替なし'}</span>
          </div>
        </div>

        <div className="origin-composer rounded-[1.5rem] border border-slate-200/90 bg-white/95 p-3 shadow-[0_20px_60px_rgba(15,23,42,0.10)] transition focus-within:border-teal-600/40 focus-within:ring-4 focus-within:ring-teal-600/10 dark:border-white/10 dark:bg-neutral-950/95 dark:shadow-black/30 dark:focus-within:border-teal-300/40 dark:focus-within:ring-teal-300/10">
          <label htmlFor="origin-home-request" className="sr-only">
            {isEn ? 'Describe what you want help with' : 'やりたいことを入力'}
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
            className="min-h-[168px] w-full resize-none border-none bg-transparent px-3 py-3 text-[1.05rem] leading-8 text-slate-950 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-neutral-500 md:text-lg"
            placeholder={isEn
              ? 'Example: Organize my product idea and create a simple proposal.'
              : '例：新商品のアイデアを整理して、提案文のたたき台を作りたい'}
          />
          <div className="flex items-end justify-between gap-3 border-t border-slate-100 px-2 pt-3 dark:border-white/5">
            <p className="flex max-w-xl items-start gap-1.5 text-xs leading-5 text-slate-500 dark:text-neutral-400">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {isEn
                ? 'Do not enter personal information, confidential data, passwords, API keys, or private keys.'
                : '個人情報、社外秘、パスワード、APIキー、秘密鍵は入力しないでください。'}
            </p>
            <button
              type="button"
              onClick={submit}
              disabled={!input.trim()}
              aria-label={isEn ? 'Send request' : '依頼を送信'}
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-sm outline-none transition hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:bg-white dark:text-black dark:hover:bg-neutral-200 dark:focus-visible:ring-teal-300 dark:focus-visible:ring-offset-neutral-950"
            >
              <ArrowUp className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-8">
          <p className="mb-3 text-left text-xs font-semibold tracking-[0.04em] text-slate-500 dark:text-neutral-400">
            {isEn ? 'Examples — you can edit them before sending' : '入力例 — 選んだ後に書き換えられます'}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {examples.map((example) => (
              <button
                type="button"
                key={example}
                onClick={() => setInput(example)}
                className="min-h-12 rounded-2xl border border-slate-200/90 bg-white/80 px-4 py-3 text-left text-sm leading-6 text-slate-700 shadow-sm outline-none transition hover:-translate-y-0.5 hover:border-teal-600/30 hover:bg-white hover:text-slate-950 hover:shadow-md focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-white/10 dark:bg-neutral-950/80 dark:text-neutral-300 dark:hover:border-teal-300/30 dark:hover:bg-neutral-950 dark:hover:text-white"
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
