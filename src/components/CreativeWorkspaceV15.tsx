import React, { useEffect, useMemo, useState } from 'react';

type VisualKind = 'social-card' | 'poster' | 'info-card';
type VisualPreset = 'square' | 'portrait' | 'story' | 'landscape';
type VisualLayout = 'editorial' | 'minimal' | 'split';

type CreativeStatus = {
  ok?: boolean;
  ready?: boolean;
  releaseStage?: string;
  externalNetworkRequests?: number;
  providerExecutions?: number;
  costUsd?: number;
  freeOnly?: boolean;
};

type CreativeDraft = {
  kind: VisualKind;
  preset: VisualPreset;
  layout: VisualLayout;
  title: string;
  subtitle: string;
  body: string;
  footer: string;
  background: string;
  foreground: string;
  accent: string;
  muted: string;
};

const INITIAL_DRAFT: CreativeDraft = {
  kind: 'social-card',
  preset: 'portrait',
  layout: 'editorial',
  title: '伝わるクリエイティブを、すぐ形に。',
  subtitle: 'ORIGIN Creative',
  body: '1080×1350を含む実ファイルを、外部画像モデルなし・通信なしで生成します。',
  footer: 'Verified SVG · $0',
  background: '#F7F7F4',
  foreground: '#151515',
  accent: '#315CFF',
  muted: '#686868',
};

const PRESET_LABELS: Record<VisualPreset, string> = {
  square: '正方形 1080×1080',
  portrait: '縦長 1080×1350',
  story: 'ストーリー 1080×1920',
  landscape: '横長 1200×630',
};

const PRESET_ASPECT: Record<VisualPreset, string> = {
  square: '1 / 1',
  portrait: '4 / 5',
  story: '9 / 16',
  landscape: '40 / 21',
};

function filenameFromDisposition(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8) {
    try { return decodeURIComponent(utf8); } catch { return fallback; }
  }
  return value.match(/filename="([^"]+)"/i)?.[1] || fallback;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.clone().json() as { code?: string; message?: string };
    return body.message || body.code || `生成に失敗しました（${response.status}）`;
  } catch {
    return `生成に失敗しました（${response.status}）`;
  }
}

export default function CreativeWorkspaceV15() {
  const [draft, setDraft] = useState<CreativeDraft>(INITIAL_DRAFT);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [downloadName, setDownloadName] = useState('origin-creative.svg');
  const [sha256, setSha256] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/creative/v1.5/status', { signal: controller.signal, credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error('status');
        const body = await response.json() as CreativeStatus;
        const valid = body.ready === true
          && body.releaseStage === 'verified-vector-foundation'
          && body.externalNetworkRequests === 0
          && body.providerExecutions === 0
          && body.costUsd === 0
          && body.freeOnly === true;
        setStatus(valid ? 'ready' : 'unavailable');
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) setStatus('unavailable');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const canGenerate = status === 'ready' && !busy && draft.title.trim().length > 0;
  const verificationText = useMemo(() => status === 'ready'
    ? '検証済みローカル生成 · 外部通信 0 · Provider 0 · $0'
    : status === 'loading' ? 'Creative engine を確認中…' : 'Creative engine は現在利用できません', [status]);

  const update = <K extends keyof CreativeDraft>(key: K, value: CreativeDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const generate = async () => {
    if (!canGenerate) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/creative/v1.5/generate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: draft.kind,
          preset: draft.preset,
          layout: draft.layout,
          title: draft.title,
          subtitle: draft.subtitle,
          body: draft.body,
          footer: draft.footer,
          theme: {
            background: draft.background,
            foreground: draft.foreground,
            accent: draft.accent,
            muted: draft.muted,
          },
        }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      if (response.headers.get('x-origin-visual-verified') !== 'true') throw new Error('成果物の検証証拠を確認できませんでした。');
      if (!response.headers.get('content-type')?.toLowerCase().includes('image/svg+xml')) throw new Error('想定外の成果物形式が返されました。');
      const blob = await response.blob();
      if (blob.size <= 0) throw new Error('空の成果物が返されました。');
      const nextUrl = URL.createObjectURL(blob);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
      setDownloadName(filenameFromDisposition(response.headers.get('content-disposition'), 'origin-creative.svg'));
      setSha256(response.headers.get('x-origin-visual-sha256') || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-5 lg:px-8" aria-label="Creative workspace">
      <section className="mb-4 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200">
              <span aria-hidden="true">✦</span> V1.5 Creative / Visual Generation
            </div>
            <h1 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl dark:text-white">作る・確認する・保存するを、1画面で。</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base dark:text-slate-300">まずは安全な実Visual Artifactから。生成したSVGは自己検証され、プレビュー後そのまま保存できます。</p>
          </div>
          <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${status === 'ready' ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : status === 'loading' ? 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300' : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`} role="status">
            {verificationText}
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-800 dark:bg-slate-950" aria-label="Creative controls">
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">用途
                <select value={draft.kind} onChange={(event) => update('kind', event.target.value as VisualKind)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                  <option value="social-card">SNSカード</option><option value="poster">ポスター</option><option value="info-card">情報カード</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">サイズ
                <select value={draft.preset} onChange={(event) => update('preset', event.target.value as VisualPreset)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                  {(Object.keys(PRESET_LABELS) as VisualPreset[]).map((preset) => <option key={preset} value={preset}>{PRESET_LABELS[preset]}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">レイアウト
                <select value={draft.layout} onChange={(event) => update('layout', event.target.value as VisualLayout)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                  <option value="editorial">Editorial</option><option value="minimal">Minimal</option><option value="split">Split</option>
                </select>
              </label>
            </div>

            <label className="grid gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">タイトル
              <input value={draft.title} maxLength={240} onChange={(event) => update('title', event.target.value)} className="min-h-12 rounded-xl border border-slate-300 bg-white px-3 text-base font-semibold text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
            </label>
            <label className="grid gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">サブタイトル
              <input value={draft.subtitle} maxLength={320} onChange={(event) => update('subtitle', event.target.value)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
            </label>
            <label className="grid gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">本文
              <textarea value={draft.body} maxLength={2200} rows={5} onChange={(event) => update('body', event.target.value)} className="rounded-xl border border-slate-300 bg-white p-3 text-sm leading-6 text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
            </label>
            <label className="grid gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">フッター
              <input value={draft.footer} maxLength={240} onChange={(event) => update('footer', event.target.value)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
            </label>

            <fieldset className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
              <legend className="px-1 text-xs font-bold text-slate-600 dark:text-slate-300">カラー</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {([
                  ['background', '背景'], ['foreground', '文字'], ['accent', 'アクセント'], ['muted', '補助'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-2 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-200">
                    <input type="color" value={draft[key]} onChange={(event) => update(key, event.target.value.toUpperCase())} className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent p-0" aria-label={`${label}色`} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}
            <button type="button" disabled={!canGenerate} onClick={() => void generate()} className="min-h-12 rounded-2xl bg-slate-950 px-5 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">
              {busy ? '生成・検証中…' : 'Visualを生成'}
            </button>
          </div>
        </section>

        <section className="flex min-h-[520px] flex-col rounded-3xl border border-slate-200 bg-slate-100 p-3 shadow-sm sm:p-5 dark:border-slate-800 dark:bg-slate-900" aria-label="Creative preview">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-black text-slate-950 dark:text-white">Preview</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{PRESET_LABELS[draft.preset]} · SVG</p>
            </div>
            {previewUrl && <a href={previewUrl} download={downloadName} className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-950 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:hover:bg-slate-800">保存</a>}
          </div>
          <div className="flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-[linear-gradient(45deg,#eef2f7_25%,transparent_25%),linear-gradient(-45deg,#eef2f7_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eef2f7_75%),linear-gradient(-45deg,transparent_75%,#eef2f7_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] p-4 dark:border-slate-800 dark:bg-slate-950">
            {previewUrl ? (
              <img src={previewUrl} alt={`生成済みVisual: ${draft.title}`} className="max-h-[72vh] max-w-full rounded-lg bg-white object-contain shadow-xl" style={{ aspectRatio: PRESET_ASPECT[draft.preset] }} />
            ) : (
              <div className="max-w-sm text-center text-slate-500 dark:text-slate-400">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-300 bg-white text-2xl shadow-sm dark:border-slate-700 dark:bg-slate-900" aria-hidden="true">✦</div>
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">まだ生成されていません</p>
                <p className="mt-1 text-xs leading-5">左の内容を整えて「Visualを生成」を押すと、検証済み成果物だけをここに表示します。</p>
              </div>
            )}
          </div>
          {previewUrl && <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            <strong>Verified</strong>{sha256 ? ` · SHA-256 ${sha256.slice(0, 12)}…` : ''} · 外部通信なし
          </div>}
        </section>
      </div>
    </main>
  );
}
