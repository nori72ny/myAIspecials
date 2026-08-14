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
    <div className="origin-dashboard mx-auto flex min-h-full w-full max-w-[880px] flex-col px-4 py-7 sm:px-6 sm:py-10 md:py-14">
      <section className="flex w-full flex-1 flex-col justify-center">
        <div className="mb-7 text-center sm:mb-9">
          <p
            className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-origin-brand-border bg-origin-brand-soft px-3 py-1.5 text-[13px] font-semibold leading-5 text-origin-brand dark:border-origin-brand-border dark:bg-origin-brand-soft dark:text-origin-brand"
            aria-label={isEn ? 'Execution guarantees' : '実行条件'}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-origin-brand" aria-hidden="true" />
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
                <span className="block">断片的なメモや、うまく言葉にできない状態で構いません。</span>
                <span className="block">
                  ORIGINが一緒に整理し、<span className="whitespace-nowrap">次の一歩が見える形に整えます。</span>
                </span>
              </>
            )}
          </p>
        </div>

        <div className="origin-composer rounded-[1.25rem] border border-origin-control bg-white/96 p-4 shadow-lg transition focus-within:border-origin-brand focus-within:ring-2 focus-within:ring-origin-brand/20 dark:border-origin-control dark:bg-origin-surface dark:focus-within:border-origin-brand dark:focus-within:ring-origin-brand/20 sm:p-5">
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
              ? 'Write a memo, a question, or what you want to move forward.'
              : 'メモ、悩み、進めたいことを、そのまま入力してください'}
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

        <div className="mt-7 sm:mt-8">
          <p className="mb-3 text-[13px] font-semibold leading-5 text-origin-muted dark:text-origin-muted">
            {isEn ? 'Not sure what to write? Start with an example.' : '何を書けばよいか迷ったら、近い例から始められます'}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {examples.map((example, index) => (
              <button
                type="button"
                key={example}
                onClick={() => setInput(example)}
                aria-label={example}
                className="group flex min-h-[4.5rem] w-full items-start gap-3 rounded-xl border border-origin-border bg-white/70 px-3 py-3 text-left text-[14px] leading-6 text-origin-ink outline-none transition hover:-translate-y-0.5 hover:border-origin-brand-border hover:bg-white hover:shadow-sm focus-visible:ring-2 focus-visible:ring-origin-brand dark:border-origin-border dark:bg-origin-surface/70 dark:text-origin-ink dark:hover:border-origin-brand-border dark:hover:bg-origin-surface dark:focus-visible:ring-origin-brand"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-origin-surface-muted font-mono text-[11px] font-semibold text-origin-muted transition group-hover:bg-origin-brand-soft group-hover:text-origin-brand dark:bg-origin-surface-muted dark:text-origin-muted dark:group-hover:bg-origin-brand-soft dark:group-hover:text-origin-brand">
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
