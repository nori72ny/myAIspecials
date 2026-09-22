import React, { useEffect, useMemo, useState } from 'react';
import type { ArtifactBlock, ConversationSession } from '../../App';

type OriginNavigationDrawerV31Props = {
  sessions: readonly ConversationSession[];
  artifacts: readonly ArtifactBlock[];
  onRestoreSession?: (session: ConversationSession) => void;
  onOpenArtifact?: (artifact: ArtifactBlock) => void;
  onNewConversation: () => void;
  onOpenSettings?: () => void;
};

export default function OriginNavigationDrawerV31({
  sessions,
  artifacts,
  onRestoreSession,
  onOpenArtifact,
  onNewConversation,
  onOpenSettings,
}: OriginNavigationDrawerV31Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSessions = useMemo(() => {
    const ranked = [...sessions].sort((a, b) => b.createdAt - a.createdAt);
    if (!normalizedQuery) return ranked.slice(0, 12);
    return ranked.filter((session) => `${session.title}\n${session.messages.map((message) => message.content).join('\n')}`.toLocaleLowerCase().includes(normalizedQuery)).slice(0, 12);
  }, [normalizedQuery, sessions]);
  const visibleArtifacts = useMemo(() => {
    const ranked = [...artifacts].reverse();
    if (!normalizedQuery) return ranked.slice(0, 8);
    return ranked.filter((artifact) => `${artifact.title}\n${artifact.language}\n${artifact.content}`.toLocaleLowerCase().includes(normalizedQuery)).slice(0, 8);
  }, [artifacts, normalizedQuery]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  return <div className="relative shrink-0">
    <button
      type="button"
      aria-label={isOpen ? 'Close navigation' : 'Open navigation'}
      aria-expanded={isOpen}
      onClick={() => setIsOpen((current) => !current)}
      className="origin-secondary-button inline-flex h-11 min-h-11 w-11 min-w-11 items-center justify-center rounded-full text-base"
    >
      <span aria-hidden="true">☰</span>
    </button>
    {isOpen && <>
      <button
        type="button"
        aria-label="Close navigation backdrop"
        onClick={() => setIsOpen(false)}
        className="fixed inset-0 z-[60] cursor-default bg-black/20 backdrop-blur-[1px]"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="ORIGIN navigation"
        className="origin-card absolute left-0 top-12 z-[70] flex max-h-[min(78dvh,720px)] w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden border shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-origin-border p-3">
          <div>
            <p className="m-0 text-sm font-black">ORIGIN</p>
            <p className="origin-muted m-0 mt-0.5 text-xs">Navigation</p>
          </div>
          <button type="button" aria-label="Close navigation" onClick={() => setIsOpen(false)} className="origin-secondary-button h-11 min-h-11 w-11 min-w-11 rounded-full">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-2 p-3">
          <button type="button" onClick={() => { onNewConversation(); setIsOpen(false); }} className="origin-primary-button min-h-11 rounded-xl px-3 text-sm font-semibold">＋ 新規対話</button>
          <button type="button" onClick={() => { onOpenSettings?.(); setIsOpen(false); }} className="origin-secondary-button min-h-11 rounded-xl px-3 text-sm font-semibold">設定</button>
        </div>

        <div className="px-3 pb-3">
          <label htmlFor="origin-global-history-search" className="sr-only">履歴を検索</label>
          <input
            id="origin-global-history-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="会話・成果物を検索"
            className="origin-input min-h-11 w-full rounded-xl border bg-transparent px-3 text-base"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-origin-border p-3">
          <section aria-label="Conversation history">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="m-0 text-xs font-black uppercase tracking-wide">履歴</h2>
              <span className="origin-muted text-xs">{sessions.length}</span>
            </div>
            <div className="grid gap-1.5">
              {visibleSessions.length ? visibleSessions.map((session) => <button
                key={session.id}
                type="button"
                onClick={() => { onRestoreSession?.(session); setIsOpen(false); }}
                className="origin-secondary-button min-h-11 rounded-xl px-3 py-2 text-left"
              >
                <span className="block truncate text-sm font-semibold">{session.title}</span>
                <span className="origin-muted mt-0.5 block truncate text-xs">{session.messages.at(-1)?.content || '会話'}</span>
              </button>) : <p className="origin-muted m-0 py-3 text-sm">一致する会話はありません。</p>}
            </div>
          </section>

          {artifacts.length > 0 && <section aria-label="Artifact history" className="mt-4 border-t border-origin-border pt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="m-0 text-xs font-black uppercase tracking-wide">成果物</h2>
              <span className="origin-muted text-xs">{artifacts.length}</span>
            </div>
            <div className="grid gap-1.5">
              {visibleArtifacts.length ? visibleArtifacts.map((artifact) => <button
                key={artifact.id}
                type="button"
                onClick={() => { onOpenArtifact?.(artifact); setIsOpen(false); }}
                className="origin-secondary-button min-h-11 rounded-xl px-3 py-2 text-left"
              >
                <span className="block truncate text-sm font-semibold">{artifact.title}</span>
                <span className="origin-muted mt-0.5 block text-xs">{artifact.language}</span>
              </button>) : <p className="origin-muted m-0 py-3 text-sm">一致する成果物はありません。</p>}
            </div>
          </section>}
        </div>
      </aside>
    </>}
  </div>;
}
