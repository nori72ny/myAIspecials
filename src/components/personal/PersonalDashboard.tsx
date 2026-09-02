import { useRef, useState } from 'react';
import { ArrowRight, Compass, GitCompareArrows, PenLine, ShieldCheck, Sparkles } from 'lucide-react';

type PersonalDashboardProps = { onNavigateToChat: (prompt?: string) => void; language?: 'ja' | 'en' };
type Starter = { label: string; description: string; prompt: string; icon: typeof Compass };

const ENGLISH_STARTERS: readonly Starter[] = [
  { label: 'Frame', description: 'Clarify the objective and the decision.', prompt: 'Frame this context as an executive brief with a recommendation, evidence, risks, and next action', icon: Compass },
  { label: 'Evaluate', description: 'Compare options and expose trade-offs.', prompt: 'Evaluate these options against clear decision criteria and recommend a course of action', icon: GitCompareArrows },
  { label: 'Draft', description: 'Turn rough notes into a finished deliverable.', prompt: 'Transform these notes into a concise, executive-ready deliverable', icon: PenLine },
  { label: 'Plan', description: 'Convert the goal into an executable path.', prompt: 'Build an execution roadmap with priorities, owners, milestones, risks, and the immediate next action', icon: Sparkles },
];
const JAPANESE_STARTERS: readonly Starter[] = [
  { label: '整理する', description: '断片的な考えを、判断できる形へ。', prompt: '考えを整理して、次にやることを決めたい', icon: Compass },
  { label: '比較する', description: '候補と判断基準を明確にする。', prompt: '候補の情報を貼り付けて、違いを比較したい', icon: GitCompareArrows },
  { label: '文章にする', description: 'メモを、伝わる成果物へ。', prompt: 'メモから、読みやすい文書を作りたい', icon: PenLine },
  { label: '計画する', description: '目的から、実行順序を組み立てる。', prompt: 'この目標を、実行できる計画に整理したい', icon: Sparkles },
];

export default function PersonalDashboard({ onNavigateToChat, language }: PersonalDashboardProps) {
  const isEn = language === 'en';
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const starters = isEn ? ENGLISH_STARTERS : JAPANESE_STARTERS;
  const submit = () => { const prompt = input.trim(); if (prompt) onNavigateToChat(prompt); };
  const selectStarter = (starter: Starter) => { setInput(starter.prompt); window.requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.scrollIntoView?.({ block: 'center' }); }); };

  return (
    <div className="origin-dashboard mx-auto flex min-h-full w-full max-w-[920px] flex-col px-4 py-8 sm:px-6 sm:py-12 md:py-16">
      <section className="flex w-full flex-1 flex-col justify-center">
        <div className="mb-8 text-center sm:mb-10">
          <div className="mx-auto mb-6 grid h-[92px] w-[92px] place-items-center rounded-[28px] border border-origin-border bg-origin-surface shadow-2xl shadow-black/10">
            <span className="text-[38px] font-semibold tracking-[-0.12em] text-origin-brand">◈</span>
          </div>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.28em] text-origin-brand">ORIGIN Personal</p>
          <h1 className="origin-display text-[2.25rem] font-semibold leading-[1.12] tracking-[-0.045em] text-origin-ink sm:text-[3rem] md:text-[3.35rem]">
            {isEn ? 'What would you like to accomplish?' : '何を実現したいですか？'}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-7 text-origin-muted sm:text-[16px]">
            {isEn ? 'Bring the objective, decision, or unfinished idea. ORIGIN turns it into a clear next move.' : '考えがまとまっていなくても構いません。目的と条件を一緒に整理し、次の一歩へ変えます。'}
          </p>
        </div>

        <div className="origin-composer rounded-[28px] bg-origin-surface p-2 shadow-2xl shadow-black/10">
          <label htmlFor="origin-home-request" className="sr-only">{isEn ? 'Describe what you want to accomplish' : '実現したいことを入力'}</label>
          <textarea
            id="origin-home-request"
            ref={inputRef}
            value={input}
            aria-describedby="origin-home-description origin-home-safety"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); submit(); } }}
            className="min-h-[104px] w-full resize-none border-0 bg-transparent px-5 py-4 text-[17px] leading-7 text-origin-ink outline-none placeholder:text-origin-placeholder focus:ring-0 dark:text-origin-ink dark:placeholder:text-origin-placeholder sm:min-h-[116px]"
            placeholder={isEn ? 'Tell ORIGIN what you need — a decision, plan, document, or idea.' : '実現したいこと、迷っていること、途中のメモをそのまま入力'}
          />
          <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-1">
            <p id="origin-home-safety" className="flex min-w-0 items-start gap-2 text-[11px] leading-5 text-origin-muted sm:text-[12px]">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-origin-brand" aria-hidden="true" />
              <span>{isEn ? 'Free AI only. Never auto-switches to paid AI.' : '無料AIのみ。有料AIへ自動で切り替えません。'}</span>
            </p>
            <button type="button" onClick={submit} disabled={!input.trim()} aria-label={isEn ? 'Start request' : '依頼を始める'} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-origin-brand px-5 text-[14px] font-bold text-white shadow-lg shadow-origin-brand/20 outline-none transition hover:bg-origin-brand-hover focus-visible:ring-2 focus-visible:ring-origin-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-origin-placeholder">
              <span>{isEn ? 'Start' : '始める'}</span><ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-8 sm:mt-10">
          <div className="mb-3 flex items-end justify-between gap-3 px-1">
            <p className="text-[13px] font-bold text-origin-ink">{isEn ? 'Start from a workflow' : 'すぐに始める'}</p>
            <p className="text-[11px] text-origin-muted">{isEn ? 'Choose a direction, then edit the prompt.' : '選んだ内容は自由に編集できます'}</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {starters.map((starter) => {
              const Icon = starter.icon;
              return <button type="button" key={starter.label} onClick={() => selectStarter(starter)} aria-label={starter.label} className="group min-h-[112px] rounded-2xl border border-origin-border bg-origin-surface/70 p-4 text-left outline-none transition hover:-translate-y-0.5 hover:border-origin-brand-border hover:bg-origin-surface hover:shadow-lg focus-visible:ring-2 focus-visible:ring-origin-brand">
                <span className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-origin-brand-soft text-origin-brand"><Icon className="h-4 w-4" aria-hidden="true" /></span>
                <span className="block text-[14px] font-bold text-origin-ink group-hover:text-origin-brand">{starter.label}</span>
                <span className="mt-1 block text-[11px] leading-[1.55] text-origin-muted">{starter.description}</span>
              </button>;
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
