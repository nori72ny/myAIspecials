import React, { useEffect, useState } from 'react';
import { Play, Sparkles } from 'lucide-react';
import {
  pngFilenameFromSvg,
  rasterizeVerifiedSvgToPng,
  verifyVisualBlobSha256V15,
} from '../creative/localVisualExportV15';
import {
  deleteCreativeHistoryV15,
  loadCreativeHistoryV15,
  saveCreativeHistoryV15,
  type CreativeHistoryEntryV15,
} from '../creative/localVisualHistoryV15';
import {
  CREATIVE_PRESET_ASPECT_V15,
  CREATIVE_PRESET_LABELS_V15,
  creativeDraftFromRequestV15,
  creativeMetaFromVerifiedV15,
  EMPTY_CREATIVE_DRAFT_V15,
  fetchCreativeStatusV15,
  generateCreativeArtifactV15,
  type CreativeDraftV15,
  type VerifiedCreativeArtifactV15,
} from '../creative/creativeStudioV15';
import type { ArtifactBlock } from '../App';
import KenBurnsVideoDialog from '../creative/KenBurnsVideoDialog';
import CreativeDraftFieldsV15 from './CreativeDraftFieldsV15';

/**
 * Create panel (screen-structure migration stage 3, 2026-11-09).
 *
 * The standalone "作る" workspace screen is retired: creation now starts
 * in chat and the deliverable lives in a panel beside the conversation
 * (Claude Artifacts / Gemini Canvas pattern). This panel carries the
 * structured editor, the verified generation flow, the preview and the
 * device-local history that used to be on the separate screen. Every
 * successful generation is also registered as a chat ArtifactBlock
 * (SVG + structured editing metadata) so the deliverable joins the
 * conversation record and can be re-edited later from the artifact panel.
 */

type CreativePanelV15Props = {
  initialRequest?: string;
  onClose: () => void;
  onArtifactCreated?: (artifact: ArtifactBlock) => void;
};

const HISTORY_DATE = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function historyStorageMessage(status: 'unavailable' | 'quota' | 'failed'): string {
  if (status === 'quota') return '端末の保存容量が不足しているため、この作成物は履歴に保存できませんでした。';
  if (status === 'unavailable') return 'この環境では端末内の作成履歴を利用できません。生成と保存は引き続き利用できます。';
  return '端末内の作成履歴を更新できませんでした。生成済み作成物はそのまま保存できます。';
}

export default function CreativePanelV15({ initialRequest = '', onClose, onArtifactCreated }: CreativePanelV15Props) {
  const [draft, setDraft] = useState<CreativeDraftV15>(() => initialRequest.trim()
    ? creativeDraftFromRequestV15(initialRequest)
    : { ...EMPTY_CREATIVE_DRAFT_V15 });
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [busy, setBusy] = useState(false);
  const [pngBusy, setPngBusy] = useState(false);
  const [historyBusyId, setHistoryBusyId] = useState('');
  const [error, setError] = useState('');
  const [historyNotice, setHistoryNotice] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [pngUrl, setPngUrl] = useState('');
  const [motionOpen, setMotionOpen] = useState(false);
  const [artifact, setArtifact] = useState<VerifiedCreativeArtifactV15 | null>(null);
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [history, setHistory] = useState<CreativeHistoryEntryV15[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchCreativeStatusV15(controller.signal).then((ready) => {
      if (!controller.signal.aborted) setStatus(ready ? 'ready' : 'unavailable');
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
  const verificationText = status === 'ready'
    ? '利用できます'
    : status === 'loading' ? '準備を確認中…' : '現在利用できません';

  const applyArtifact = (nextArtifact: VerifiedCreativeArtifactV15) => {
    setArtifact(nextArtifact);
    setPreviewUrl(URL.createObjectURL(nextArtifact.blob));
    setPngUrl('');
  };

  const persistHistory = async (nextArtifact: VerifiedCreativeArtifactV15) => {
    const result = await saveCreativeHistoryV15({
      sha256: nextArtifact.sha256,
      title: nextArtifact.title,
      preset: nextArtifact.preset,
      downloadName: nextArtifact.downloadName,
      svgBlob: nextArtifact.blob,
      generationId: nextArtifact.generationId,
      visualBrainVersion: nextArtifact.visualBrainVersion,
      providerId: nextArtifact.providerId,
      planSha256: nextArtifact.planSha256,
      relation: 'generated',
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
      const nextArtifact = await generateCreativeArtifactV15(draft);
      applyArtifact(nextArtifact);
      await persistHistory(nextArtifact);
      onArtifactCreated?.({
        id: `creative-${nextArtifact.sha256}`,
        type: 'html',
        language: 'svg',
        title: nextArtifact.title,
        content: nextArtifact.svgText,
        isComplete: true,
        creative: creativeMetaFromVerifiedV15(nextArtifact, draft),
      });
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
        svgText: await entry.svgBlob.text(),
        preset: entry.preset,
        title: entry.title,
        downloadName: entry.downloadName,
        sha256: entry.sha256,
        generationId: entry.generationId,
        visualBrainVersion: entry.visualBrainVersion,
        providerId: entry.providerId,
        planSha256: entry.planSha256,
      });
      setHistoryNotice('端末内履歴から確認済みの画像を開きました。');
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
    <aside aria-label="作る（カード・ポスターの作成）" data-testid="creative-panel" className="origin-workspace fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l shadow-2xl sm:w-[76vw] sm:max-w-[880px]">
      <div className="flex min-h-16 items-start justify-between gap-3 border-b border-[var(--border-default)] px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-black">カード・ポスターを作る</h2>
          <p className={`mt-0.5 text-xs font-semibold ${status === 'ready' ? 'text-emerald-700 dark:text-emerald-300' : status === 'loading' ? '' : 'text-amber-700 dark:text-amber-300'}`} role="status">{verificationText}</p>
        </div>
        <button type="button" aria-label="会話に戻る" onClick={onClose} className="origin-secondary-button inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-lg">✕</button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="grid items-start gap-4 md:grid-cols-2">
          <section className="origin-surface rounded-2xl border border-[var(--border-default)] p-4" aria-label="作成の設定">
            <CreativeDraftFieldsV15 idPrefix="creative-panel" draft={draft} onChange={setDraft} disabled={busy || pngBusy || Boolean(historyBusyId)} />
            {error && <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}
            <button type="button" disabled={!canGenerate} onClick={() => void generate()} className="origin-primary-button mt-4 min-h-12 w-full rounded-2xl px-5 text-sm font-black shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40">
              {busy ? '作成・確認中…' : '画像を作成'}
            </button>
          </section>

          <section className="origin-surface-muted flex min-h-[320px] flex-col rounded-2xl border border-[var(--border-default)] p-3" aria-label="プレビュー">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-black">プレビュー</h3>
                <p className="text-xs opacity-70">{CREATIVE_PRESET_LABELS_V15[previewPreset]} · {pngUrl ? 'SVG + PNG' : 'SVG'}</p>
              </div>
              {artifact && previewUrl && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <a href={previewUrl} download={artifact.downloadName} className="origin-secondary-button inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold shadow-sm">SVG保存</a>
                  <button type="button" disabled={!canPreparePng} onClick={() => void preparePng()} className="origin-secondary-button inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold shadow-sm disabled:cursor-not-allowed disabled:opacity-40">
                    {pngBusy ? 'PNG変換中…' : pngUrl ? 'PNGを再作成' : 'PNGを作成'}
                  </button>
                  {pngUrl && <a href={pngUrl} download={pngDownloadName} className="origin-primary-button inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-black shadow-sm">PNG保存</a>}
                  <button type="button" onClick={() => setMotionOpen(true)} className="origin-secondary-button inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-bold shadow-sm"><Play aria-hidden="true" className="h-4 w-4" />動画化</button>
                </div>
              )}
            </div>
            <div className="flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[linear-gradient(45deg,#eef2f7_25%,transparent_25%),linear-gradient(-45deg,#eef2f7_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eef2f7_75%),linear-gradient(-45deg,transparent_75%,#eef2f7_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] p-4">
              {previewUrl && artifact ? (
                <img src={previewUrl} alt={`作成した画像: ${artifact.title}`} className="max-h-[64vh] max-w-full rounded-lg bg-white object-contain shadow-xl" style={{ aspectRatio: CREATIVE_PRESET_ASPECT_V15[artifact.preset] }} />
              ) : (
                <div className="max-w-sm text-center opacity-80">
                  <div className="origin-surface mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border-default)] shadow-sm" aria-hidden="true"><Sparkles className="h-6 w-6" /></div>
                  <p className="text-sm font-bold">まだ作成されていません</p>
                  <p className="mt-1 text-xs leading-5">内容を整えて「画像を作成」を押すと、確認済みの画像だけをここに表示します。</p>
                </div>
              )}
            </div>
            {artifact && previewUrl && <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"><strong>確認済み</strong></p>}
          </section>
        </div>

        {(history.length > 0 || historyNotice) && <section className="origin-surface mt-4 rounded-2xl border border-[var(--border-default)] p-4" aria-label="作成履歴">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-black">履歴</h3>
            <span className="text-xs opacity-70">{historyStatus === 'unavailable' ? '保存不可' : `${history.length}/12`}</span>
          </div>

          {historyNotice && <div role="status" className="origin-surface-muted mt-3 rounded-xl border border-[var(--border-default)] px-3 py-2 text-xs font-medium">{historyNotice}</div>}

          {history.length > 0 && (
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {history.map((entry) => {
                const active = artifact?.sha256 === entry.sha256;
                const waiting = historyBusyId === entry.id;
                return (
                  <article key={entry.id} className={`rounded-2xl border p-3 ${active ? 'border-[var(--accent-primary)]' : 'border-[var(--border-default)]'}`}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold" title={entry.title}>{entry.title}</p>
                      <p className="mt-1 text-xs opacity-70">{CREATIVE_PRESET_LABELS_V15[entry.preset]} · {HISTORY_DATE.format(new Date(entry.createdAt))}</p>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button type="button" disabled={Boolean(historyBusyId) || busy || pngBusy} onClick={() => void openHistoryEntry(entry)} aria-label={`履歴を開く: ${entry.title}`} className="origin-secondary-button min-h-11 flex-1 rounded-xl px-3 text-xs font-bold disabled:opacity-40">
                        {waiting ? '確認中…' : active ? '表示中' : '開く'}
                      </button>
                      <button type="button" disabled={Boolean(historyBusyId) || busy || pngBusy} onClick={() => void removeHistoryEntry(entry)} aria-label={`履歴から削除: ${entry.title}`} className="origin-secondary-button min-h-11 rounded-xl px-3 text-xs font-bold disabled:opacity-40">削除</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>}
      </div>

      {motionOpen && artifact && previewUrl && (
        <KenBurnsVideoDialog
          imageUrl={pngUrl || previewUrl}
          downloadName={pngUrl ? pngDownloadName : artifact.downloadName}
          language="ja"
          onClose={() => setMotionOpen(false)}
        />
      )}
    </aside>
  );
}
