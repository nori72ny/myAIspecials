import { useState } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';

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
    <div className="origin-dashboard mx-auto flex min-h-full w-full max-w-[800px] flex-col px-4 py-8 sm:px-6 sm:py-12 md:py-16">
      <section className="flex w-full flex-1 flex-col justify-center">
        <div className="mb-8 text-center sm:mb-10">
          <p
            className="mb-5 text-[13px] font-medium leading-5 text-origin-muted dark:text-origin-muted"
            aria-label={isEn ? 'Execution guarantees' : '実行条件'}
          >
            {isEn
              ? 'AI usage $0.00 · fixed free model · no automatic switching'
              : 'AI利用料 $0.00 · 無料モデル固定 · 自動切替なし'}
          </p>
          <h2 className="origin-display auto-phrase text-[1.75rem] font-semibold leading-[1.3] text-origin-ink dark:text-origin-ink sm:text-[2.125rem] md:text-[2.5rem]">
            {isEn ? 'Start before your thoughts are fully formed.' : '考えがまとまる前から、始められます。'}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-[1.75] text-origin-muted dark:text-origin-muted sm:text-base">
            {isEn ? (
              'Write whatever you have. ORIGIN organizes it into something you can use next.'
            ) : (
              <>
                <span className="block">断片のまま入力してください。</span>
                <span className="block">
                  ORIGINが整理し、<span className="whitespace-nowrap">次に使える形へ整えます。</span>
                </span>
              </>
            )}
          </p>
        </div>

        <div className="origin-composer rounded-2xl border border-origin-control bg-white p-4 shadow-sm transition focus-within:border-origin-brand focus-within:ring-2 focus-within:ring-origin-brand/20 dark:border-origin-control dark:bg-origin-surface dark:focus-within:border-origin-brand dark:focus-within:ring-origin-brand/20 sm:p-5">
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
            className="min-h-[136px] w-full resize-none border-none bg-transparent p-0 text-base leading-7 text-origin-ink outline-none placeholder:text-origin-placeholder focus:ring-0 dark:text-origin-ink dark:placeholder:text-origin-placeholder sm:min-h-[152px]"
            placeholder={isEn
              ? 'Example: Organize my product idea and create a simple proposal.'
              : '例：新商品のアイデアを整理して、提案文のたたき台を作りたい'}
          />
          <div className="mt-3 flex flex-col gap-3 border-t border-origin-border pt-3 dark:border-origin-border sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-[13px] leading-5 text-origin-muted dark:text-origin-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-origin-brand dark:text-origin-brand" aria-hidden="true" />
              {isEn
                ? 'Do not enter personal information, passwords, API keys, or private keys.'
                : '個人情報、社外秘、パスワード、APIキー、秘密鍵は入力しないでください。'}
            </p>
            <button
              type="button"
              onClick={submit}
              disabled={!input.trim()}
              aria-label={isEn ? 'Send request' : '依頼を送信'}
              className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-origin-brand px-5 text-[15px] font-semibold text-white outline-none transition hover:bg-origin-brand-hover focus-visible:ring-2 focus-visible:ring-origin-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-origin-placeholder dark:bg-origin-brand dark:text-origin-paper dark:hover:bg-origin-brand-hover dark:focus-visible:ring-origin-brand dark:focus-visible:ring-offset-origin-surface sm:w-auto"
            >
              <span>{isEn ? 'Start organizing' : '整理を始める'}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-8">
          <p className="mb-2 text-[13px] font-semibold leading-5 text-origin-muted dark:text-origin-muted">
            {isEn ? 'Examples — select one, then edit it' : '入力例 — 選んだあとに書き換えられます'}
          </p>
          <div className="divide-y divide-origin-border border-y border-origin-border dark:divide-origin-border dark:border-origin-border">
            {examples.map((example, index) => (
              <button
                type="button"
                key={example}
                onClick={() => setInput(example)}
                aria-label={example}
                className="group flex min-h-12 w-full items-center gap-3 px-2 py-3 text-left text-[14px] leading-6 text-origin-ink outline-none transition hover:bg-origin-surface-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-origin-brand dark:text-origin-ink dark:hover:bg-origin-surface-muted dark:focus-visible:ring-origin-brand"
              >
                <span className="w-7 shrink-0 font-mono text-[13px] text-origin-muted dark:text-origin-muted">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>{example}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
