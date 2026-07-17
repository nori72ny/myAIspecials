import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CheckCircle2, ShieldCheck, X, XCircle } from 'lucide-react';
import { evaluateAnswerQuality, type AnswerQualityResult } from '../lib/evaluation/AnswerQualityEvaluation';
import {
  ANSWER_QUALITY_FIXTURES_V1,
  getAnswerQualityFixture,
} from '../lib/evaluation/AnswerQualityFixtures';

const FOCUSABLE =
  "button:not([disabled]),textarea:not([disabled]),select:not([disabled]),[href],[tabindex]:not([tabindex='-1'])";

const AXIS_LABELS: Record<string, string> = {
  'instruction-adherence': '指示への準拠',
  relevance: '関連性',
  clarity: '明確さ',
  'safety-privacy': '安全性・プライバシー',
  'japanese-quality': '日本語品質',
  'structured-output': '構造化出力',
};

export default function AnswerQualityEvaluationPanel() {
  const [open, setOpen] = useState(false);
  const [fixtureId, setFixtureId] = useState(ANSWER_QUALITY_FIXTURES_V1[0]?.id ?? '');
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<AnswerQualityResult | null>(null);
  const [error, setError] = useState('');
  const openerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const wasOpen = useRef(false);

  const fixture = useMemo(() => getAnswerQualityFixture(fixtureId), [fixtureId]);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) openerRef.current?.focus();
      wasOpen.current = false;
      return;
    }

    wasOpen.current = true;
    answerRef.current?.focus();

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (event.key !== 'Tab') return;
      const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const evaluate = () => {
    const trimmed = answer.trim();
    if (!trimmed) {
      setResult(null);
      setError('評価する回答を入力してください。');
      return;
    }

    setError('');
    setResult(evaluateAnswerQuality(fixture, trimmed));
  };

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        data-testid="answer-quality-preview-open"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 left-5 z-[80] flex min-h-11 items-center gap-2 rounded-full bg-emerald-800 px-4 py-3 text-sm font-semibold text-white shadow-xl transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400"
      >
        <BarChart3 className="h-4 w-4" /> 回答品質を評価
      </button>

      {open && (
        <div className="fixed inset-0 z-[95] flex items-end bg-black/45 p-2 sm:items-center sm:justify-center sm:p-5">
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="answer-quality-title"
            className="max-h-[96vh] w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl sm:max-h-[92vh] sm:max-w-4xl dark:border-white/10 dark:bg-neutral-950"
          >
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-6 dark:border-white/10 dark:bg-neutral-950/95">
              <div>
                <h2 id="answer-quality-title" className="text-lg font-bold text-slate-950 dark:text-white">
                  回答品質評価プレビュー
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-neutral-300">
                  回答を端末内で採点します。外部送信・保存・有料API利用はありません。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className="min-h-11 min-w-11 rounded-xl p-3 text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:text-neutral-300 dark:hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
              <div className="space-y-4">
                <label className="block text-sm font-semibold text-slate-700 dark:text-neutral-200">
                  評価fixture
                  <select
                    value={fixtureId}
                    onChange={(event) => {
                      setFixtureId(event.target.value);
                      setResult(null);
                      setError('');
                    }}
                    className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-white/15 dark:bg-neutral-900 dark:text-white"
                  >
                    {ANSWER_QUALITY_FIXTURES_V1.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-neutral-900">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                    テスト依頼
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-800 dark:text-neutral-100">{fixture.prompt}</p>
                </div>

                <label className="block text-sm font-semibold text-slate-700 dark:text-neutral-200">
                  評価する回答
                  <textarea
                    ref={answerRef}
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder="ここにAIの回答を貼り付けてください"
                    className="mt-2 min-h-56 w-full resize-y rounded-xl border border-slate-300 bg-slate-50 p-3 text-base leading-7 text-slate-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-white/15 dark:bg-neutral-900 dark:text-white"
                  />
                </label>

                {error && (
                  <p role="alert" className="text-sm leading-6 text-red-600 dark:text-red-400">
                    {error}
                  </p>
                )}

                <button
                  type="button"
                  onClick={evaluate}
                  className="min-h-12 w-full rounded-xl bg-emerald-800 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  この回答を評価
                </button>
              </div>

              <aside className="space-y-4" aria-live="polite">
                {!result && (
                  <div className="rounded-xl border border-dashed border-slate-300 p-5 text-sm leading-6 text-slate-600 dark:border-white/15 dark:text-neutral-300">
                    fixtureを選び、回答を入力して評価してください。
                  </div>
                )}

                {result && (
                  <>
                    <div
                      data-testid="answer-quality-result"
                      className={`rounded-2xl border p-5 ${
                        result.passed
                          ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10'
                          : 'border-red-300 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {result.passed ? (
                          <CheckCircle2 className="h-6 w-6 text-emerald-700 dark:text-emerald-300" />
                        ) : (
                          <XCircle className="h-6 w-6 text-red-700 dark:text-red-300" />
                        )}
                        <div>
                          <p className="font-bold text-slate-950 dark:text-white">
                            {result.passed ? '合格' : '要改善'}
                          </p>
                          <p className="text-sm text-slate-700 dark:text-neutral-200">
                            {result.score}点 / 合格基準 {result.minimumScore}点
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {result.axisResults.map((axis) => (
                        <div
                          key={axis.axis}
                          className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-900"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-slate-900 dark:text-white">
                              {AXIS_LABELS[axis.axis] ?? axis.axis}
                            </span>
                            <span className="text-sm font-bold text-slate-700 dark:text-neutral-200">{axis.score}点</span>
                          </div>
                          {axis.reasons.length > 0 && (
                            <ul className="mt-2 space-y-1 text-sm leading-6 text-red-700 dark:text-red-300">
                              {axis.reasons.map((reason) => (
                                <li key={reason}>・{reason}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-200">
                      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-300" />
                      <p>評価結果にはfixture ID、得点、失敗理由だけを使用し、回答本文は保存しません。</p>
                    </div>
                  </>
                )}
              </aside>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
