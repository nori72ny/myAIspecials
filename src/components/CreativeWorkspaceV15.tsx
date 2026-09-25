import React, { useEffect, useMemo, useState } from 'react';
import {
  pngFilenameFromSvg,
  rasterizeVerifiedSvgToPng,
  verifyVisualBlobSha256V15,
  type VisualRasterPresetV15,
} from '../creative/localVisualExportV15';
import {
  deleteCreativeHistoryV15,
  loadCreativeHistoryV15,
  saveCreativeHistoryV15,
  type CreativeHistoryEntryV15,
} from '../creative/localVisualHistoryV15';

type VisualKind = 'social-card' | 'poster' | 'info-card';
type VisualPreset = VisualRasterPresetV15;
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

type VerifiedCreativeArtifact = {
  blob: Blob;
  preset: VisualPreset;
  title: string;
  downloadName: string;
  sha256: string;
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

const HISTORY_DATE = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

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

function historyStorageMessage(status: 'unavailable' | 'quota' | 'failed'): string {
  if (status === 'quota') return '端末の保存容量が不足しているため、この作成物は履歴に保存できませんでした。';
  if (status === 'unavailable') return 'この環境では端末内のCreative履歴を利用できません。生成と保存は引き続き利用できます。';
  return '端末内のCreative履歴を更新できませんでした。生成済み作成物はそのまま保存できます。';
}

export default function CreativeWorkspaceV15() {
  const [draft, setDraft] = useState<CreativeDraft>(INITIAL_DRAFT);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [busy, setBusy] = useState(false);
  const [pngBusy, setPngBusy] = useState(false);
  const [historyBusyId, setHistoryBusyId] = useState('');
  const [error, setError] = useState('');
  const [historyNotice, setHistoryNotice] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [pngUrl, setPngUrl] = useState('');
  const [artifact, setArtifact] = useState<VerifiedCreativeArtifact | null>(null);
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [history, setHistory] = useState<CreativeHistoryEntryV15[]>([]);

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

  useEffect(() => {
    let active = true;
    void loadCreativeHistoryV15().then((result) => {
      if (!active) return;
      setHistory(result.entries);
      setHistoryStatus(result.status === 'ready' ? 'ready' : 'unavailable');
      if (result.status === 'failed') setHistoryNotice(historyStorageMessage('failed'));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => () => {
    if (pngUrl) URL.revokeObjectURL(pngUrl);
  }, [pngUrl]);

  const canGenerate = status === 'ready' && !busy && !pngBusy && !historyBusyId && draft.title.trim().length > 0;
  const canPreparePng = artifact !== null && !busy && !pngBusy && !historyBusyId;
  const verificationText = useMemo(() => status === 'ready'
    ? '検証済みローカル生成 · 外部通信 0 · Provider 0 · $0'
    : status === 'loading' ? 'Creative engine を確認中…' : 'Creative engine は現在利用できません', [status]);

  const update = <K extends keyof CreativeDraft>(key: K, value: CreativeDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const applyArtifact = (nextArtifact: VerifiedCreativeArtifact) => {
    setArtifact(nextArtifact);
    setPreviewUrl(URL.createObjectURL(nextArtifact.blob));
    setPngUrl('');
  };

  const persistHistory = async (nextArtifact: VerifiedCreativeArtifact) => {
    const result = await saveCreativeHistoryV15({
      sha256: nextArtifact.sha256,
      title: nextArtifact.title,
      preset: nextArtifact.preset,
      downloadName: nextArtifact.downloadName,
      svgBlob: nextArtifact.blob,
    });
    if (result.status === 'saved') {
      setHistoryStatus('ready');
      setHistory((current) => [result.entry, ...current.filter(entry => entry.id !== result.entry.id)].slice(0, 12));
      setHistoryNotice('端末内履歴に保存しました。SVGは再読み込み後もこの端末から開けます。');
      return;
    }
    if (result.status === 'unavailable') setHistoryStatus('unavailable');
    setHistoryNotice(historyStorageMessage(result.status));
  };

  const generate = async () => {
    if (!canGenerate) return;
    setBusy(true);
    setError('');
    setHistoryNotice('');
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
      if (response.headers.get('x-origin-visual-verified') !== 'true') throw new Error('作成物の検証証拠を確認できませんでした。');
      if (response.headers.get('x-origin-free-only') !== 'true'
        || response.headers.get('x-origin-cost-usd') !== '0'
        || response.headers.get('x-origin-external-network') !== 'false') {
        throw new Error('作成物のゼロコスト境界を確認できませんでした。');
      }
      if (!response.headers.get('content-type')?.toLowerCase().includes('image/svg+xml')) throw new Error('想定外の作成物形式が返されました。');
      const artifactSha256 = response.headers.get('x-origin-visual-sha256') || '';
      if (!/^[a-f0-9]{64}$/i.test(artifactSha256)) throw new Error('作成物のSHA-256証拠を確認できませんでした。');
      const blob = await response.blob();
      if (blob.size <= 0) throw new Error('空の作成物が返されました。');
      if (!(await verifyVisualBlobSha256V15(blob, artifactSha256))) {
        throw new Error('作成物の実バイトとSHA-256証拠が一致しませんでした。');
      }

      const nextArtifact: VerifiedCreativeArtifact = {
        blob,
        preset: draft.preset,
        title: draft.title,
        downloadName: filenameFromDisposition(response.headers.get('content-disposition'), 'origin-creative.svg'),
        sha256: artifactSha256.toLowerCase(),
      };
      applyArtifact(nextArtifact);
      await persistHistory(nextArtifact);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const preparePng = async () => {
    if (!artifact || !canPreparePng) return;
    setPngBusy(true);
    setError('');
    try {
      if (!(await verifyVisualBlobSha256V15(artifact.blob, artifact.sha256))) {
        throw new Error('artifact-integrity');
      }
      const pngBlob = await rasterizeVerifiedSvgToPng(artifact.blob, artifact.preset);
      setPngUrl(URL.createObjectURL(pngBlob));
    } catch {
      setError('PNGの端末内変換に失敗しました。SVGはそのまま保存できます。');
    } finally {
      setPngBusy(false);
    }
  };

  const openHistoryEntry = async (entry: CreativeHistoryEntryV15) => {
    if (busy || pngBusy || historyBusyId) return;
    setHistoryBusyId(entry.id);
    setError('');
    setHistoryNotice('');
    try {
      if (!(await verifyVisualBlobSha256V15(entry.svgBlob, entry.sha256))) {
        setHistoryNotice('履歴の整合性を確認できなかったため、この作成物は開きませんでした。');
        return;
      }
      applyArtifact({
        blob: entry.svgBlob,
        preset: entry.preset,
        title: entry.title,
        downloadName: entry.downloadName,
        sha256: entry.sha256,
      });
      setHistoryNotice('端末内履歴から検証済みSVGを開きました。');
    } catch {
      setHistoryNotice('履歴の整合性を確認できなかったため、この作成物は開きませんでした。');
    } finally {
      setHistoryBusyId('');
    }
  };

  const removeHistoryEntry = async (entry: CreativeHistoryEntryV15) => {
    if (busy || pngBusy || historyBusyId) return;
    setHistoryBusyId(entry.id);
    setHistoryNotice('');
    try {
      const result = await deleteCreativeHistoryV15(entry.id);
      if (result === 'deleted') {
        setHistory((current) => current.filter(item => item.id !== entry.id));
        setHistoryNotice('端末内履歴から削除しました。');
      } else {
        setHistoryNotice(historyStorageMessage(result === 'unavailable' ? 'unavailable' : 'failed'));
      }
    } finally {
      setHistoryBusyId('');
    }
  };

  const previewPreset = artifact?.preset ?? draft.preset;
  const pngDownloadName = artifact ? pngFilenameFromSvg(artifact.downloadName) : 'origin-creative.png';

  return (
    <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-5 lg:px-8" aria-label="Creative workspace">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 px-1">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-500">Create</p>
          <h1 className="mt-1 text-xl font-black text-slate-950 dark:text-white">作りたいものを入力</h1>
          <p className="mt-1 text-sm leading-6 text-slate-500">ORIGINが生成・検証し、保存できる作成物として仕上げます。</p>
        </div>
        <span className={`shrink-0 text-xs font-semibold ${status === 'ready' ? 'text-emerald-700 dark:text-emerald-300' : status === 'loading' ? 'text-slate-500' : 'text-amber-700 dark:text-amber-300'}`} role="status">{verificationText}</span>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-800 dark:bg-slate-950" aria-label="Creative controls">
          <div className="grid gap-4">
            <label className="grid gap-1.5 text-sm font-bold text-slate-700 dark:text-slate-200">タイトル
              <input value={draft.title} maxLength={240} onChange={(event) => update('title', event.target.value)} className="min-h-12 rounded-xl border border-slate-300 bg-white px-3 text-base font-semibold text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
            </label>

            <label className="grid gap-1.5 text-sm font-bold text-slate-700 dark:text-slate-200">内容
              <textarea value={draft.body} maxLength={2200} rows={6} onChange={(event) => update('body', event.target.value)} className="rounded-xl border border-slate-300 bg-white p-3 text-sm leading-6 text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
            </label>

            <details className="rounded-2xl border border-slate-200 px-3 dark:border-slate-800">
              <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">詳細設定</summary>
              <div className="grid gap-4 pb-4">
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

                <label className="grid gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">サブタイトル
                  <input value={draft.subtitle} maxLength={320} onChange={(event) => update('subtitle', event.target.value)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
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
              </div>
            </details>

            {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}
            <button type="button" disabled={!canGenerate} onClick={() => void generate()} className="min-h-12 rounded-2xl bg-slate-950 px-5 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">
              {busy ? '生成・検証中…' : 'Visualを生成'}
            </button>
          </div>
        </section>
        <section className="flex min-h-[320px] flex-col rounded-3xl sm:min-h-[420px] lg:min-h-[520px] border border-slate-200 bg-slate-100 p-3 shadow-sm sm:p-5 dark:border-slate-800 dark:bg-slate-900" aria-label="Creative preview">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-black text-slate-950 dark:text-white">Preview</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{PRESET_LABELS[previewPreset]} · {pngUrl ? 'SVG + PNG' : 'SVG'}</p>
            </div>
            {artifact && previewUrl && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <a href={previewUrl} download={artifact.downloadName} className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-950 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:hover:bg-slate-800">SVG保存</a>
                <button type="button" disabled={!canPreparePng} onClick={() => void preparePng()} className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-950 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:hover:bg-slate-800">
                  {pngBusy ? 'PNG変換中…' : pngUrl ? 'PNGを再作成' : 'PNGを作成'}
                </button>
                {pngUrl && <a href={pngUrl} download={pngDownloadName} className="inline-flex min-h-11 items-center rounded-xl bg-slate-950 px-4 text-sm font-black text-white shadow-sm hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">PNG保存</a>}
              </div>
            )}
          </div>
          <div className="flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-[linear-gradient(45deg,#eef2f7_25%,transparent_25%),linear-gradient(-45deg,#eef2f7_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eef2f7_75%),linear-gradient(-45deg,transparent_75%,#eef2f7_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] p-4 dark:border-slate-800 dark:bg-slate-950">
            {previewUrl && artifact ? (
              <img src={previewUrl} alt={`生成済みVisual: ${artifact.title}`} className="max-h-[72vh] max-w-full rounded-lg bg-white object-contain shadow-xl" style={{ aspectRatio: PRESET_ASPECT[artifact.preset] }} />
            ) : (
              <div className="max-w-sm text-center text-slate-500 dark:text-slate-400">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-300 bg-white text-2xl shadow-sm dark:border-slate-700 dark:bg-slate-900" aria-hidden="true">✦</div>
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">まだ生成されていません</p>
                <p className="mt-1 text-xs leading-5">左の内容を整えて「Visualを生成」を押すと、検証済み作成物だけをここに表示します。</p>
              </div>
            )}
          </div>
          {artifact && previewUrl && <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            <strong>Verified</strong> · SHA-256 {artifact.sha256.slice(0, 12)}… · 実バイト照合済み · 外部通信なし · PNGは端末内変換
          </div>}
        </section>
      </div>

      {(history.length > 0 || historyNotice) && <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-800 dark:bg-slate-950" aria-label="Creative local history">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-black text-slate-950 dark:text-white">履歴</h2>
          <span className="text-xs text-slate-500">{historyStatus === 'unavailable' ? '保存不可' : `${history.length}/12`}</span>
        </div>

        {historyNotice && <div role="status" className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">{historyNotice}</div>}

        {history.length > 0 && (
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {history.map((entry) => {
              const active = artifact?.sha256 === entry.sha256;
              const waiting = historyBusyId === entry.id;
              return (
                <article key={entry.id} className={`rounded-2xl border p-3 ${active ? 'border-indigo-300 bg-indigo-50/70 dark:border-indigo-800 dark:bg-indigo-950/20' : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900'}`}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-950 dark:text-white" title={entry.title}>{entry.title}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{PRESET_LABELS[entry.preset]} · {HISTORY_DATE.format(new Date(entry.createdAt))}</p>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled={Boolean(historyBusyId) || busy || pngBusy} onClick={() => void openHistoryEntry(entry)} aria-label={`履歴を開く: ${entry.title}`} className="min-h-11 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-900 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                      {waiting ? '確認中…' : active ? '表示中' : '開く'}
                    </button>
                    <button type="button" disabled={Boolean(historyBusyId) || busy || pngBusy} onClick={() => void removeHistoryEntry(entry)} aria-label={`履歴から削除: ${entry.title}`} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">削除</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>}
    </main>
  );
}
