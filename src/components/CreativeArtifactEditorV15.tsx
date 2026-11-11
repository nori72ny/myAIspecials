import React, { useEffect, useState } from 'react';
import { saveCreativeHistoryV15 } from '../creative/localVisualHistoryV15';
import {
  creativeDraftFromMetaV15,
  creativeMetaFromVerifiedV15,
  fetchCreativeStatusV15,
  generateCreativeArtifactV15,
  type CreativeDraftV15,
} from '../creative/creativeStudioV15';
import type { ArtifactBlock, ArtifactRevision } from '../App';
import CreativeDraftFieldsV15 from './CreativeDraftFieldsV15';

/**
 * Structured editor for Creative deliverables inside the artifact panel
 * (screen-structure migration stage 3, 2026-11-09).
 *
 * Rendered by ArtifactWorkspace when the open artifact carries Creative
 * metadata (an SVG card/poster generated through the verified Creative
 * flow). The fields are the ones the retired "作る" screen had — title,
 * body, kind, size, layout, subtitle, footer, colors — and applying them
 * regenerates the deliverable through the same verified generation path,
 * appending an artifact revision instead of silently replacing content.
 * The free-text code editor remains available for raw SVG edits.
 */

type CreativeArtifactEditorV15Props = {
  artifact: ArtifactBlock;
  onRegenerated: (artifact: ArtifactBlock) => void;
};

export default function CreativeArtifactEditorV15({ artifact, onRegenerated }: CreativeArtifactEditorV15Props) {
  const meta = artifact.creative;
  const [draft, setDraft] = useState<CreativeDraftV15 | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setDraft(meta ? creativeDraftFromMetaV15(meta, artifact.title) : null);
    setError('');
    setNotice('');
  }, [artifact.id, artifact.title, meta]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchCreativeStatusV15(controller.signal).then((ready) => {
      if (!controller.signal.aborted) setStatus(ready ? 'ready' : 'unavailable');
    });
    return () => controller.abort();
  }, [artifact.id]);

  if (!meta || !draft) return null;

  const canRegenerate = status === 'ready' && !busy && draft.title.trim().length > 0;

  const regenerate = async () => {
    if (!canRegenerate) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const verified = await generateCreativeArtifactV15(draft);
      const history = artifact.revisions ?? [{ id: `${artifact.id}:v1`, content: artifact.content, createdAt: 0, source: 'generated' as const }];
      const revision: ArtifactRevision = { id: `${artifact.id}:v${history.length + 1}`, content: verified.svgText, createdAt: Date.now(), source: 'generated' };
      onRegenerated({
        ...artifact,
        title: draft.title,
        content: verified.svgText,
        revision: history.length + 1,
        revisions: [...history, revision],
        creative: creativeMetaFromVerifiedV15(verified, draft),
      });
      await saveCreativeHistoryV15({
        sha256: verified.sha256,
        title: verified.title,
        preset: verified.preset,
        downloadName: verified.downloadName,
        svgBlob: verified.blob,
        generationId: verified.generationId,
        visualBrainVersion: verified.visualBrainVersion,
        providerId: verified.providerId,
        planSha256: verified.planSha256,
        relation: 'generated',
      });
      setNotice('デザインを再作成しました。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '再作成に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="デザインを編集" className="origin-surface mb-4 rounded-2xl border border-[var(--border-default)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black">デザインを編集</h3>
        <span className="text-xs font-semibold" role="status">{status === 'ready' ? '利用できます' : status === 'loading' ? '準備を確認中…' : '現在利用できません'}</span>
      </div>
      <p className="mt-1 text-xs leading-5 opacity-70">タイトル・内容・種類・レイアウト・色を変えて、確認済みの画像を作り直せます。</p>
      <div className="mt-3">
        <CreativeDraftFieldsV15 idPrefix={`creative-artifact-${artifact.id}`} draft={draft} onChange={setDraft} disabled={busy} />
      </div>
      {error && <div role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}
      {notice && <p role="status" className="mt-3 text-xs font-semibold">{notice}</p>}
      <button type="button" data-testid="creative-artifact-regenerate" disabled={!canRegenerate} onClick={() => void regenerate()} className="origin-primary-button mt-4 min-h-12 w-full rounded-2xl px-5 text-sm font-black shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40">
        {busy ? '再作成・確認中…' : 'デザインを再作成'}
      </button>
    </section>
  );
}
