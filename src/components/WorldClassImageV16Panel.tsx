import React, { useEffect, useState } from 'react';
import { prepareRasterReferenceDataUrlV15 } from '../creative/rasterReferenceEditClientV15';
import { readVerifiedWorldClassImageBlobV16 } from '../creative/worldClassImageClientDeliveryV16';

const MODEL = '@cf/black-forest-labs/flux-2-klein-9b';
const PROVIDER = 'cloudflare-workers-ai-free';
const FULL_SHA = /^[a-f0-9]{40}$/i;
const IMAGE_HASH = /^[a-f0-9]{64}$/i;
type ImageStatus = {
  ready?: boolean; qualified?: boolean; primaryReady?: boolean;
  model?: string; provider?: string; releaseSha?: string; qualifiedSha?: string;
  freeOnly?: boolean; costUsd?: number; paidFallbackEnabled?: boolean;
  paymentMethodRequired?: boolean;
};
function approvedStatus(s: ImageStatus): boolean {
  return s.ready === true && s.qualified === true && s.primaryReady === true
    && s.model === MODEL && s.provider === PROVIDER
    && s.freeOnly === true && s.costUsd === 0
    && s.paidFallbackEnabled === false && s.paymentMethodRequired === false
    && typeof s.releaseSha === 'string' && FULL_SHA.test(s.releaseSha)
    && s.qualifiedSha === s.releaseSha;
}
function imageMime(value: string | null): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  const mime = (value ?? '').split(';')[0].trim().toLowerCase();
  if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp') return mime;
  return null;
}
function extension(mime: string): string {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
}
async function checkedImage(response: Response, status: ImageStatus, editing: boolean): Promise<Blob> {
  if (!response.ok) throw new Error('高画質画像の生成・編集に失敗しました。');
  const mime = imageMime(response.headers.get('content-type'));
  const sha = response.headers.get('x-origin-visual-sha256') ?? '';
  if (!mime || !IMAGE_HASH.test(sha)
    || response.headers.get('x-origin-visual-verified') !== 'true'
    || response.headers.get('x-origin-visual-provider') !== PROVIDER
    || response.headers.get('x-origin-visual-model') !== MODEL
    || response.headers.get('x-origin-visual-task') !== (editing ? 'edit' : 'generate')
    || response.headers.get('x-origin-visual-reference-count') !== (editing ? '1' : '0')
    || response.headers.get('x-origin-visual-semantic-verified') !== 'true'
    || response.headers.get('x-origin-visual-quality-tier') !== 'world-class-free'
    || response.headers.get('x-origin-free-only') !== 'true'
    || response.headers.get('x-origin-cost-usd') !== '0'
    || response.headers.get('x-origin-paid-fallback') !== 'false'
    || response.headers.get('x-origin-secret-delivery') !== 'server-only'
    || response.headers.get('x-origin-release-sha') !== status.releaseSha
    || response.headers.get('x-origin-world-class-qualified-sha') !== status.releaseSha) {
    throw new Error('公開済みの無料9B画像モデルと出力の検証証拠が一致しません。');
  }
  return readVerifiedWorldClassImageBlobV16(response, mime, sha);

}

/** Build-time UI flag alone never authorizes inference; the V1.6 server remains the release gate. */
export default function WorldClassImageV16Panel() {
  const [status, setStatus] = useState<ImageStatus | null>(null);
  const [readiness, setReadiness] = useState<'checking' | 'ready' | 'unavailable'>('checking');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState(768);
  const [selected, setSelected] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [downloadName, setDownloadName] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/creative/v1.6/world-class/status', {
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
    }).then(async (response) => {
      const json = await response.json() as ImageStatus;
      if (!response.ok || !approvedStatus(json)) throw new Error('not-qualified');
      if (!controller.signal.aborted) { setStatus(json); setReadiness('ready'); }
    }).catch(() => {
      if (!controller.signal.aborted) setReadiness('unavailable');
    });
    return () => controller.abort();
  }, []);
  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);
  const allowed = readiness === 'ready' && status !== null
    && !busy && consent && prompt.trim().length >= 2 && prompt.trim().length <= 1400;
  async function generate() {
    if (!allowed || !status) return;
    setBusy(true);
    setError('');
    setImageUrl('');
    setDownloadName('');
    try {
      const editing = selected !== null;
      const source = selected ? await prepareRasterReferenceDataUrlV15(selected) : null;
      const endpoint = editing ? 'edit' : 'generate';
      const body = {
        prompt: prompt.normalize('NFKC').trim(), width: size, height: size,
        ...(source ? { referenceImages: [source.dataUrl] } : {}),
      };
      const response = await fetch('/api/creative/v1.6/world-class/' + endpoint, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const blob = await checkedImage(response, status, editing);
      setImageUrl(URL.createObjectURL(blob));
      setDownloadName('origin-world-class-' + endpoint + '.' + extension(blob.type));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '画像の検証に失敗しました。');
    } finally {
      setBusy(false);
    }
  }
  return <section aria-label="高品質画像生成と編集" className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-800 dark:bg-slate-950">
    <h2 className="text-base font-bold text-slate-950 dark:text-white">高品質画像生成・編集</h2>
    <p className="mt-1 text-xs leading-6 text-slate-600 dark:text-slate-300">
      Cloudflare Workers AIの無料モデルを使用します。実行時には指示文と、編集時は参照画像がCloudflareへ送信されます。
    </p>
    {readiness !== 'ready' ? <p role="status" className="mt-3 text-sm text-amber-700 dark:text-amber-300">
      {readiness === 'checking' ? '公開承認と無料モデルの利用状態を確認しています。' : '現在、承認済みの高品質画像機能を利用できません。'}
    </p> : <>
      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">画像にしたい内容・編集指示
          <textarea aria-label="高品質画像の指示" rows={3} maxLength={1400} value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="min-h-24 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
        </label>
        <label className="grid content-start gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">出力サイズ
          <select aria-label="高品質画像のサイズ" value={size} onChange={(event) => setSize(Number(event.target.value))}
            className="min-h-12 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
            <option value={512}>512 × 512</option><option value={768}>768 × 768</option><option value={1024}>1024 × 1024</option>
          </select>
        </label>
      </div>
      <label className="mt-3 grid min-w-0 gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">参照画像（任意・選択すると画像編集）
        <input aria-label="編集用参照画像" type="file" accept="image/png,image/jpeg,image/webp"
          onChange={(event) => setSelected(event.target.files?.[0] ?? null)}
          className="min-h-11 w-full min-w-0 text-sm" />
      </label>
      <label className="mt-3 flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1" />
        <span>指示文と参照画像が外部のCloudflare AIへ送信されることに同意します。</span>
      </label>
      {error && <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      <button type="button" disabled={!allowed} onClick={() => void generate()}
        className="mt-3 min-h-12 w-full rounded-xl bg-slate-950 px-4 text-sm font-bold text-white disabled:opacity-40 dark:bg-white dark:text-slate-950">
        {busy ? '生成・検証中…' : selected ? '参照画像を編集' : '画像を生成'}
      </button>
      {imageUrl && <div className="mt-4 grid gap-3">
        <img src={imageUrl} alt="検証済みの高品質生成画像" className="max-h-[65vh] w-full rounded-xl object-contain" />
        <a href={imageUrl} download={downloadName} className="inline-flex min-h-11 items-center justify-center rounded-xl border px-4 text-sm font-bold">検証済み画像を保存</a>
      </div>}
    </>}
  </section>;
}
