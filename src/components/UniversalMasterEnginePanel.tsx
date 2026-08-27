import { useEffect, useMemo, useState } from 'react';
import { localFirstSyncEngine, type LocalNote } from '../services/localFirstSyncEngine';
import { VisualKnowledgeGraph, type KnowledgeNode } from './VisualKnowledgeGraph';

export function UniversalMasterEnginePanel({ onContextReady }: { onContextReady?: (context: string) => void }) {
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [status, setStatus] = useState<'idle' | 'syncing' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => localFirstSyncEngine.onChange(setNotes), []);

  const nodes = useMemo<KnowledgeNode[]>(() => notes.slice(0, 80).map((note) => ({ id: note.id, title: note.name, content: note.content, kind: 'note' })), [notes]);

  const sync = async () => {
    setStatus('syncing'); setError(null);
    try {
      if (!localFirstSyncEngine.isSupported()) throw new Error('このブラウザはFile System Access APIに対応していません。Chrome/Edge等の対応ブラウザをご利用ください。');
      await localFirstSyncEngine.chooseDirectory();
      setStatus('ready');
    } catch (caught) {
      setStatus('error');
      setError(caught instanceof Error ? caught.message : 'ローカル同期を開始できませんでした。');
    }
  };

  return (
    <aside className="mx-auto w-full max-w-5xl border-b border-slate-700 bg-slate-950/95 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">ORIGIN Universal Master Engine</h2>
          <p className="text-xs text-slate-400">Local-first · Knowledge Graph · PWA</p>
        </div>
        <button type="button" onClick={() => void sync()} disabled={status === 'syncing'} className="min-h-11 rounded-xl border border-cyan-400/40 px-4 text-sm font-medium text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-50">
          {status === 'syncing' ? '同期中…' : notes.length ? 'ローカルノートを再同期' : 'ローカルフォルダを接続'}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
      {notes.length > 0 && <div className="mt-4"><VisualKnowledgeGraph nodes={nodes} onNodeSelect={(node) => onContextReady?.(`以下のローカルノートを文脈として参照してください。\n\n## ${node.title}\n\n${node.content.slice(0, 12000)}`)} /></div>}
      <p className="mt-3 text-[11px] leading-5 text-slate-500">ファイル本文はサーバーへ送信せず、選択したフォルダからブラウザが直接読み書きします。暗号化インデックスはAES-GCM-256で端末内に保存します。</p>
    </aside>
  );
}
