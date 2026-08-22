import { useRef, useState } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';

type PersonalDashboardProps = {
  onNavigateToChat: (prompt?: string) => void;
  language?: 'ja' | 'en';
};

type Starter = {
  label: string;
  description: string;
  prompt: string;
};

const ENGLISH_STARTERS: readonly Starter[] = [
  { label: 'Frame', description: 'Turn incomplete context into a crisp decision brief', prompt: 'Frame this context as an executive brief with a recommendation, evidence, risks, and next action' },
  { label: 'Evaluate', description: 'Compare strategic options and surface the trade-offs', prompt: 'Evaluate these options against clear decision criteria and recommend a course of action' },
  { label: 'Draft', description: 'Create an executive-ready deliverable from working notes', prompt: 'Transform these notes into a concise, executive-ready deliverable' },
  { label: 'Plan', description: 'Translate the objective into owners, milestones, and actions', prompt: 'Build an execution roadmap with priorities, owners, milestones, risks, and the immediate next action' },
];

const JAPANESE_STARTERS: readonly Starter[] = [
  { label: '整理する', description: '断片的な考えから、次の一歩を明確にする', prompt: '考えを整理して、次にやることを決めたい' },
  { label: '比較する', description: '候補の違いと判断基準を見える形にする', prompt: '候補の情報を貼り付けて、違いを比較したい' },
  { label: '文章にする', description: 'メモを、伝わる文書へ整える', prompt: 'メモから、読みやすい文書を作りたい' },
  { label: '計画する', description: '目的から、実行できる順序を組み立てる', prompt: 'この目標を、実行できる計画に整理したい' },
];

export default function PersonalDashboard({ onNavigateToChat, language }: PersonalDashboardProps) {
  const isEn = language === 'en';
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const starters = isEn ? ENGLISH_STARTERS : JAPANESE_STARTERS;

  const submit = () => {
    const prompt = input.trim();
    if (!prompt) return;
    onNavigateToChat(prompt);
  };

  const selectStarter = (starter: Starter) => {
    setInput(starter.prompt);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView?.({ block: 'center' });
    });
  };

  return (
    <div className="origin-dashboard mx-auto flex min-h-full w-full max-w-[840px] flex-col px-4 py-6 sm:px-6 sm:py-9 md:py-12">
      <section className="flex w-full flex-1 flex-col justify-center">
        <div className="mb-6 text-center sm:mb-8">
          <p className="mb-3 text-[12px] font-semibold tracking-[0.14em] text-origin-brand">
            ORIGIN
          </p>
          <h2 className="origin-display auto-phrase text-[1.9rem] font-semibold leading-[1.28] text-origin-ink dark:text-origin-ink sm:text-[2.25rem] md:text-[2.65rem]">
            {isEn ? 'What would you like to accomplish?' : '何を実現したいですか？'}
          </h2>
          <p
            id="origin-home-description"
            className="mx-auto mt-3 max-w-xl text-[15px] leading-[1.75] text-origin-muted dark:text-origin-muted sm:text-base"
          >
            {isEn
              ? 'Bring an objective, decision, or unfinished brief. ORIGIN will turn it into an executive-ready next step.'
              : '考えがまとまっていなくても構いません。目的と条件を一緒に整理し、次の一歩が見える形に整えます。'}
          </p>
        </div>

        <div className="origin-composer rounded-[1.125rem] border border-origin-control bg-origin-surface p-4 shadow-lg transition focus-within:border-origin-brand focus-within:ring-2 focus-within:ring-origin-brand/20 dark:border-origin-control dark:bg-origin-surface dark:focus-within:border-origin-brand dark:focus-within:ring-origin-brand/20 sm:p-5">
          <label htmlFor="origin-home-request" className="sr-only">
            {isEn ? 'Describe what you want to accomplish' : '実現したいことを入力'}
          </label>
          <textarea
            id="origin-home-request"
            ref={inputRef}
            value={input}
            aria-describedby="origin-home-description origin-home-safety"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter'
                && !event.shiftKey
                && !event.nativeEvent.isComposing
                && event.keyCode !== 229
              ) {
                event.preventDefault();
                submit();
              }
            }}
            className="min-h-[112px] w-full resize-none border-none bg-transparent p-0 text-base leading-7 text-origin-ink outline-none placeholder:text-origin-placeholder focus:ring-0 dark:text-origin-ink dark:placeholder:text-origin-placeholder sm:min-h-[132px]"
            placeholder={isEn
              ? 'Describe the decision, outcome, or deliverable you need.'
              : '実現したいこと、迷っていること、途中のメモをそのまま入力'}
          />
          <div className="mt-3 flex flex-col gap-3 border-t border-origin-border pt-3 dark:border-origin-border sm:flex-row sm:items-center sm:justify-between">
            <p id="origin-home-safety" className="flex items-start gap-2 text-[12px] leading-5 text-origin-muted dark:text-origin-muted sm:text-[13px]">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-origin-brand dark:text-origin-brand" aria-hidden="true" />
              {isEn
                ? 'Do not enter personal information, passwords, API keys, or private keys.'
                : '個人情報、社外秘、パスワード、APIキー、秘密鍵は入力しないでください。'}
            </p>
            <button
              type="button"
              onClick={submit}
              disabled={!input.trim()}
              aria-label={isEn ? 'Start request' : '依頼を始める'}
              className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-origin-brand px-5 text-[15px] font-semibold text-white outline-none transition hover:bg-origin-brand-hover focus-visible:ring-2 focus-visible:ring-origin-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-origin-placeholder dark:bg-origin-brand dark:text-origin-paper dark:hover:bg-origin-brand-hover dark:focus-visible:ring-origin-brand dark:focus-visible:ring-offset-origin-surface sm:w-auto"
            >
              <span>{isEn ? 'Start' : '始める'}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-6 sm:mt-7">
          <div className="mb-3 flex items-end justify-between gap-3">
            <p className="text-[13px] font-semibold leading-5 text-origin-ink dark:text-origin-ink">
              {isEn ? 'Start with an executive workflow' : '始め方を選ぶ'}
            </p>
            <p className="text-[12px] leading-5 text-origin-muted dark:text-origin-muted">
              {isEn ? 'Adds an editable decision brief' : '選んだ後に編集できます'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {starters.map((starter) => (
              <button
                type="button"
                key={starter.label}
                onClick={() => selectStarter(starter)}
                aria-label={starter.label}
                className="group min-h-[5.5rem] w-full rounded-xl border border-origin-border bg-origin-surface/75 px-3 py-3 text-left outline-none transition hover:border-origin-brand-border hover:bg-origin-surface focus-visible:ring-2 focus-visible:ring-origin-brand dark:border-origin-border dark:bg-origin-surface/75 dark:hover:border-origin-brand-border dark:hover:bg-origin-surface dark:focus-visible:ring-origin-brand"
              >
                <span className="block text-[14px] font-semibold leading-5 text-origin-ink group-hover:text-origin-brand dark:text-origin-ink dark:group-hover:text-origin-brand">
                  {starter.label}
                </span>
                <span className="mt-1 block text-[12px] leading-[1.55] text-origin-muted dark:text-origin-muted">
                  {starter.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        <p className="mt-4 text-center text-[12px] leading-5 text-origin-muted dark:text-origin-muted">
          {isEn
            ? 'Currently uses free AI only and never switches automatically to paid AI.'
            : '現在は無料AIのみを使用し、有料AIへ自動で切り替えません。'}
        </p>
      </section>
    </div>
  );
}
