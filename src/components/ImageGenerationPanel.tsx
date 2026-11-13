import React, { useEffect, useMemo, useRef, useState } from 'react';

type ImageRatio = '1:1' | '16:9' | '9:16' | '4:5' | '3:2' | '2:3';
type ImageResolution = '1024' | '1536';

type Props = {
  language: 'ja' | 'en';
  onClose: () => void;
  onGenerate: (prompt: string, width: number, height: number) => void;
};

const RATIOS: readonly ImageRatio[] = ['1:1', '16:9', '9:16', '4:5', '3:2', '2:3'];

const RATIO_LABELS_JA: Record<ImageRatio, string> = {
  '1:1': '1:1（正方形）',
  '16:9': '16:9（横長）',
  '9:16': '9:16（縦長）',
  '4:5': '4:5（やや縦長）',
  '3:2': '3:2（やや横長）',
  '2:3': '2:3（縦長）',
};

export default function ImageGenerationPanel({ language, onClose, onGenerate }: Props) {
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState<ImageRatio>('1:1');
  const [resolution, setResolution] = useState<ImageResolution>('1024');
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    promptRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), select:not([disabled]), input:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => {
        // Controls inside a closed <details> are not rendered and cannot
        // take focus; its <summary> stays focusable so the disclosure can
        // still be opened from the keyboard.
        const details = element.closest('details');
        return !details || details.open || element.tagName === 'SUMMARY';
      });
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [onClose]);

  const dimensions = useMemo(() => {
    const [ratioWidthText, ratioHeightText] = ratio.split(':');
    const ratioWidth = Number(ratioWidthText);
    const ratioHeight = Number(ratioHeightText);
    const longestEdge = Number(resolution);
    const scale = longestEdge / Math.max(ratioWidth, ratioHeight);
    return {
      width: Math.max(256, Math.round(ratioWidth * scale)),
      height: Math.max(256, Math.round(ratioHeight * scale)),
    };
  }, [ratio, resolution]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = prompt.normalize('NFKC').trim();
    if (!value) {
      setError(language === 'ja' ? '画像の内容を入力してください。' : 'Enter what you want to create.');
      return;
    }
    if (value.length > 2_000) {
      setError(language === 'ja' ? 'プロンプトは2,000文字以内にしてください。' : 'Keep the prompt within 2,000 characters.');
      return;
    }
    onGenerate(value, dimensions.width, dimensions.height);
  };

  const ja = language === 'ja';
  // Availability is decided per request by the server-side free-proof
  // pipeline: it proves $0.00 cost before any inference runs and fails
  // closed when it cannot. The panel therefore does not pre-check a
  // status endpoint; it lets the generation result (or its failure
  // reason) speak for itself. The contract itself is unchanged, but it
  // is no longer restated as visible copy in the sheet (owner decision
  // 2026-11-11: keep the sheet to the essentials).

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-4 sm:pb-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="origin-image-panel-title" data-testid="origin-image-generation-panel" className="origin-surface origin-sheet-safe-area-bottom max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-[var(--border-default)] p-4 shadow-2xl sm:rounded-3xl sm:p-6">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="origin-muted m-0 text-xs font-semibold uppercase tracking-[0.16em]">ORIGIN · IMAGE STUDIO</p>
            <h2 id="origin-image-panel-title" className="m-0 mt-1 text-lg font-semibold">{ja ? '画像を生成' : 'Generate an image'}</h2>
            <p className="origin-muted m-0 mt-1 text-sm">{ja ? '内容を入力してください。縦横比・解像度は詳細設定で変更できます。' : 'Enter a prompt. Aspect ratio and resolution live under Advanced settings.'}</p>
          </div>
          <button type="button" aria-label={ja ? '閉じる' : 'Close'} onClick={onClose} className="origin-secondary-button inline-flex h-11 w-11 min-w-11 items-center justify-center rounded-full text-xl">×</button>
        </header>
        {/* The global light/dark overrides in index.css paint every <form>
            as a bordered pale card (built for the bottom composer). Inside
            this sheet that card became a second frame within the sheet's
            own frame and squeezed the content, so the form opts out with
            important utilities (layered !important outranks the unlayered
            !important overrides) and the sheet surface stays the only
            background. */}
        <form onSubmit={submit} className="grid gap-4 rounded-none! border-none! bg-transparent! shadow-none!">
          <label className="grid gap-2 text-sm font-medium">
            {ja ? '作りたい画像' : 'Image brief'}
            <textarea ref={promptRef} data-testid="origin-image-prompt" value={prompt} onChange={(event) => { setPrompt(event.target.value); setError(''); }} maxLength={2000} rows={4} placeholder={ja ? '例：夕暮れの海辺、映画のワンシーンのような光、人物なし' : 'Example: a quiet beach at sunset, cinematic lighting, no people'} className="origin-input min-h-28 w-full resize-y rounded-2xl border border-[var(--border-default)] bg-transparent p-3 text-base leading-6" />
          </label>
          <details data-testid="origin-image-advanced-settings">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{ja ? '詳細設定' : 'Advanced settings'}</summary>
            <div className="mt-3 grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-2 text-sm font-medium">
                  {ja ? '縦横比' : 'Aspect ratio'}
                  <select data-testid="origin-image-ratio" value={ratio} onChange={(event) => setRatio(event.target.value as ImageRatio)} className="origin-input min-h-11 rounded-xl border border-[var(--border-default)] bg-transparent px-3 text-base">
                    {RATIOS.map((value) => <option key={value} value={value}>{ja ? RATIO_LABELS_JA[value] : value}</option>)}
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  {ja ? '解像度（長辺）' : 'Resolution (long edge)'}
                  <select data-testid="origin-image-resolution" value={resolution} onChange={(event) => setResolution(event.target.value as ImageResolution)} className="origin-input min-h-11 rounded-xl border border-[var(--border-default)] bg-transparent px-3 text-base">
                    <option value="1024">1K · 1024px</option>
                    <option value="1536">1.5K · 1536px</option>
                  </select>
                </label>
              </div>
              <p data-testid="origin-image-dimensions" className="origin-muted m-0 text-xs tabular-nums">{dimensions.width} × {dimensions.height}px · {ratio}</p>
            </div>
          </details>
          {error && <p role="alert" className="m-0 text-sm text-[var(--danger)]">{error}</p>}
          <footer className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="submit" data-testid="origin-image-generate-submit" className="origin-primary-button min-h-11 rounded-xl px-5 text-sm font-semibold">{ja ? '画像を生成する' : 'Generate image'}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
