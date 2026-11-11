import React from 'react';
import {
  CREATIVE_PRESET_LABELS_V15,
  type CreativeDraftV15,
  type CreativeVisualKindV15,
  type CreativeVisualLayoutV15,
  type CreativeVisualPresetV15,
} from '../creative/creativeStudioV15';

/**
 * Structured draft fields for a Creative (card / poster / info-card)
 * deliverable, shared by the create panel (CreativePanelV15) and the
 * artifact-panel editor (CreativeArtifactEditorV15) so both surfaces edit
 * exactly the same draft shape. Title and body start empty with
 * placeholders — the slogan-like prefilled copy of the retired Create
 * screen is intentionally not carried over (screen necessity review,
 * 2026-11-09).
 */

type CreativeDraftFieldsV15Props = {
  draft: CreativeDraftV15;
  onChange: (draft: CreativeDraftV15) => void;
  disabled?: boolean;
  idPrefix: string;
};

export default function CreativeDraftFieldsV15({ draft, onChange, disabled = false, idPrefix }: CreativeDraftFieldsV15Props) {
  const update = <K extends keyof CreativeDraftV15>(key: K, value: CreativeDraftV15[K]) => {
    onChange({ ...draft, [key]: value });
  };

  const inputClass = 'min-w-0 w-full rounded-xl border border-[var(--border-default)] bg-transparent px-3 text-base text-[var(--text-primary)]';
  const labelClass = 'grid gap-1.5 text-sm font-bold';
  const detailLabelClass = 'grid gap-1.5 text-xs font-bold';

  return (
    <div className="grid gap-4">
      <label className={labelClass} htmlFor={`${idPrefix}-title`}>タイトル
        <textarea id={`${idPrefix}-title`} aria-label="タイトル" value={draft.title} maxLength={240} rows={2} disabled={disabled}
          placeholder="例：新商品のお知らせ"
          onChange={(event) => update('title', event.target.value)}
          className={`${inputClass} min-h-12 resize-y p-3 font-semibold leading-6`} />
      </label>

      <label className={labelClass} htmlFor={`${idPrefix}-body`}>内容
        <textarea id={`${idPrefix}-body`} aria-label="内容" value={draft.body} maxLength={2200} rows={6} disabled={disabled}
          placeholder="伝えたい内容を書きます"
          onChange={(event) => update('body', event.target.value)}
          className={`${inputClass} resize-y p-3 leading-6`} />
      </label>

      <details className="rounded-2xl border border-[var(--border-default)] px-3">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">詳細設定</summary>
        <div className="grid gap-4 pb-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={detailLabelClass}>用途
              <select aria-label="用途" value={draft.kind} disabled={disabled} onChange={(event) => update('kind', event.target.value as CreativeVisualKindV15)} className={`${inputClass} min-h-11`}>
                <option value="social-card">SNSカード</option><option value="poster">ポスター</option><option value="info-card">情報カード</option>
              </select>
            </label>
            <label className={detailLabelClass}>サイズ
              <select aria-label="サイズ" value={draft.preset} disabled={disabled} onChange={(event) => update('preset', event.target.value as CreativeVisualPresetV15)} className={`${inputClass} min-h-11`}>
                {(Object.keys(CREATIVE_PRESET_LABELS_V15) as CreativeVisualPresetV15[]).map((preset) => <option key={preset} value={preset}>{CREATIVE_PRESET_LABELS_V15[preset]}</option>)}
              </select>
            </label>
            <label className={detailLabelClass}>レイアウト
              <select aria-label="レイアウト" value={draft.layout} disabled={disabled} onChange={(event) => update('layout', event.target.value as CreativeVisualLayoutV15)} className={`${inputClass} min-h-11`}>
                <option value="editorial">見出し型</option><option value="minimal">シンプル</option><option value="split">左右分割</option>
              </select>
            </label>
          </div>

          <label className={detailLabelClass}>サブタイトル
            <input aria-label="サブタイトル" value={draft.subtitle} maxLength={320} disabled={disabled} onChange={(event) => update('subtitle', event.target.value)} className={`${inputClass} min-h-11`} />
          </label>
          <label className={detailLabelClass}>フッター
            <input aria-label="フッター" value={draft.footer} maxLength={240} disabled={disabled} onChange={(event) => update('footer', event.target.value)} className={`${inputClass} min-h-11`} />
          </label>

          <fieldset className="rounded-2xl border border-[var(--border-default)] p-3">
            <legend className="px-1 text-xs font-bold">カラー</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([
                ['background', '背景'], ['foreground', '文字'], ['accent', 'アクセント'], ['muted', '補助'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border-default)] px-2 text-xs font-semibold">
                  <input type="color" value={draft[key]} disabled={disabled} onChange={(event) => update(key, event.target.value.toUpperCase())} className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent p-0" aria-label={`${label}色`} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </details>
    </div>
  );
}
