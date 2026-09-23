import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ArtifactBlock, ArtifactRevision, ConversationMessage, ConversationSession } from '../../App';
import { originIndexedDbAdapter } from '../../lib/local/OriginIndexedDb';

type OriginNavigationDrawerV31Props = {
  sessions: readonly ConversationSession[];
  artifacts: readonly ArtifactBlock[];
  onRestoreSession?: (session: ConversationSession) => void;
  onOpenArtifact?: (artifact: ArtifactBlock) => void;
  onNewConversation: () => void;
  onOpenSettings?: () => void;
  projectNavigation?: React.ReactNode;
};

function persistedSession(value: unknown): ConversationSession | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ConversationSession>;
  if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string' || typeof candidate.createdAt !== 'number' || !Array.isArray(candidate.messages)) return null;
  const messages = candidate.messages.flatMap((message): ConversationMessage[] => {
    if (!message || typeof message !== 'object') return [];
    const typed = message as Partial<ConversationMessage>;
    if ((typed.role !== 'user' && typed.role !== 'assistant') || typeof typed.content !== 'string') return [];
    return [{ id: typeof typed.id === 'string' ? typed.id : '', role: typed.role, content: typed.content, deliveryState: typed.deliveryState === 'verified' || typed.deliveryState === 'error' ? typed.deliveryState : undefined }];
  });
  return { id: candidate.id, title: candidate.title, createdAt: candidate.createdAt, messages };
}

function persistedArtifact(value: unknown): ArtifactBlock | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ArtifactBlock>;
  if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string' || typeof candidate.language !== 'string' || typeof candidate.content !== 'string' || typeof candidate.isComplete !== 'boolean') return null;
  if (candidate.type !== 'code' && candidate.type !== 'markdown' && candidate.type !== 'mermaid' && candidate.type !== 'html') return null;
  const revisions = Array.isArray(candidate.revisions) ? candidate.revisions.flatMap((revision): ArtifactRevision[] => {
    if (!revision || typeof revision !== 'object') return [];
    const typed = revision as Partial<ArtifactRevision>;
    if (typeof typed.id !== 'string' || typeof typed.content !== 'string' || typeof typed.createdAt !== 'number') return [];
    if (typed.source !== 'generated' && typed.source !== 'direct-touch' && typed.source !== 'restore') return [];
    return [{ id: typed.id, content: typed.content, createdAt: typed.createdAt, source: typed.source }];
  }) : undefined;
  return { id: candidate.id, type: candidate.type, title: candidate.title, language: candidate.language, content: candidate.content, isComplete: candidate.isComplete, revision: typeof candidate.revision === 'number' ? candidate.revision : undefined, revisions };
}

export default function OriginNavigationDrawerV31({
  sessions,
  artifacts,
  onRestoreSession,
  onOpenArtifact,
  onNewConversation,
  onOpenSettings,
  projectNavigation,
}: OriginNavigationDrawerV31Props) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [storedSessions, setStoredSessions] = useState<ConversationSession[] | null>(null);
  const [storedArtifacts, setStoredArtifacts] = useState<ArtifactBlock[] | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    void originIndexedDbAdapter.load().then((snapshot) => {
      if (!active || !snapshot) return;
      setStoredSessions(snapshot.sessions.flatMap((value) => {
        const parsed = persistedSession(value);
        return parsed ? [parsed] : [];
      }));
      setStoredArtifacts(snapshot.artifacts.flatMap((value) => {
        const parsed = persistedArtifact(value);
        return parsed ? [parsed] : [];
      }));
    }).catch(() => { /* Keep in-memory navigation available if durable history cannot be read. */ });
    return () => { active = false; };
  }, [isOpen]);

  const searchableSessions = useMemo(() => {
    const merged = new Map<string, ConversationSession>();
    (storedSessions ?? []).forEach((session) => merged.set(session.id, session));
    sessions.forEach((session) => merged.set(session.id, session));
    return Array.from(merged.values()).sort((a, b) => b.createdAt - a.createdAt);
  }, [sessions, storedSessions]);
  const searchableArtifacts = useMemo(() => {
    const merged = new Map<string, ArtifactBlock>();
    (storedArtifacts ?? []).forEach((artifact) => merged.set(artifact.id, artifact));
    artifacts.forEach((artifact) => merged.set(artifact.id, artifact));
    return Array.from(merged.values());
  }, [artifacts, storedArtifacts]);

  const visibleSessions = useMemo(() => {
    if (!deferredQuery) return searchableSessions.slice(0, 12);
    return searchableSessions.filter((session) => `${session.title}\n${session.messages.map((message) => message.content).join('\n')}`.toLocaleLowerCase().includes(deferredQuery)).slice(0, 12);
  }, [deferredQuery, searchableSessions]);
  const visibleArtifacts = useMemo(() => {
    const ranked = [...searchableArtifacts].reverse();
    if (!deferredQuery) return ranked.slice(0, 8);
    return ranked.filter((artifact) => `${artifact.title}\n${artifact.language}\n${artifact.content}\n${artifact.revisions?.map((revision) => revision.content).join('\n') ?? ''}`.toLocaleLowerCase().includes(deferredQuery)).slice(0, 8);
  }, [deferredQuery, searchableArtifacts]);
  const knowledgeNodes = useMemo(() => searchableSessions.slice(0, 12).map((session, index, all) => {
    const angle = (Math.PI * 2 * index) / Math.max(all.length, 1) - Math.PI / 2;
    return { session, x: 150 + Math.cos(angle) * 105, y: 135 + Math.sin(angle) * 82 };
  }), [searchableSessions]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    const background = Array.from(document.body.children).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlayRef.current);
    const priorInert = background.map(element => element.inert);
    background.forEach(element => { element.inert = true; });
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button, input, select, summary, [tabindex="0"]') ?? [])
      .filter(element => !element.hasAttribute('disabled') && !element.closest('details:not([open]) > :not(summary)'));
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setIsOpen(false); }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      background.forEach((element, index) => { element.inert = priorInert[index]; });
      window.removeEventListener('keydown', onKeyDown);
      triggerRef.current?.focus();
    };
  }, [isOpen]);

  return <div className="relative shrink-0">
    <button
      type="button"
      ref={triggerRef}
      aria-label="Open navigation"
      aria-hidden={isOpen || undefined}
      tabIndex={isOpen ? -1 : 0}
      aria-expanded={isOpen}
      onClick={() => setIsOpen((current) => !current)}
      className="origin-secondary-button inline-flex h-11 min-h-11 w-11 min-w-11 items-center justify-center rounded-full text-base"
    >
      <span aria-hidden="true">☰</span>
    </button>
    {isOpen && createPortal(<div ref={overlayRef}>
      <button
        type="button"
        aria-label="Close navigation backdrop"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => setIsOpen(false)}
        className="fixed inset-0 z-[60] cursor-default bg-black/20 backdrop-blur-[1px]"
      />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="ORIGIN navigation"
        className="origin-card fixed left-3 top-12 z-[70] flex max-h-[min(82dvh,760px)] w-[min(23rem,calc(100vw-1.5rem))] flex-col overflow-hidden border shadow-2xl"
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
          <button type="button" onClick={() => { setIsOpen(false); requestAnimationFrame(() => { triggerRef.current?.focus(); onOpenSettings?.(); }); }} className="origin-secondary-button min-h-11 rounded-xl px-3 text-sm font-semibold">設定</button>
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
          {projectNavigation}

          <details className="mb-4 rounded-xl border border-origin-border p-2">
            <summary className="origin-secondary-button flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg px-3 text-sm font-semibold">
              <span>◎ Knowledge Map</span>
              <span className="origin-muted text-xs">{knowledgeNodes.length}</span>
            </summary>
            {knowledgeNodes.length ? <>
              <svg viewBox="0 0 300 270" role="img" aria-label="セッション関連ノード" className="mt-3 h-52 w-full rounded-xl bg-black/10">
                {knowledgeNodes.slice(1).map((node) => <line key={`edge-${node.session.id}`} x1="150" y1="135" x2={node.x} y2={node.y} stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />)}
                {knowledgeNodes.map((node, index) => <g
                  key={node.session.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.session.title}を復元`}
                  onClick={() => { onRestoreSession?.(node.session); setIsOpen(false); }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    onRestoreSession?.(node.session);
                    setIsOpen(false);
                  }}
                  className="cursor-pointer outline-none"
                >
                  <circle cx={node.x} cy={node.y} r="15" fill={index === 0 ? '#22d3ee' : '#334155'} stroke="#64748b" strokeWidth="2" />
                  <text x={node.x} y={node.y + 4} textAnchor="middle" fill="#f8fafc" fontSize="13" fontWeight="700">{index + 1}</text>
                </g>)}
              </svg>
              <div className="mt-2 grid max-h-32 gap-1 overflow-y-auto">
                {knowledgeNodes.map(({ session }, index) => <button key={session.id} type="button" onClick={() => { onRestoreSession?.(session); setIsOpen(false); }} className="origin-secondary-button min-h-11 truncate rounded-lg px-3 text-left text-xs font-semibold">{index + 1}. {session.title}</button>)}
              </div>
            </> : <p className="origin-muted m-0 p-3 text-sm">復元できる過去セッションはまだありません。</p>}
          </details>

          <section aria-label="Conversation history">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="m-0 text-xs font-black uppercase tracking-wide">履歴</h2>
              <span className="origin-muted text-xs">{searchableSessions.length}</span>
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

          {searchableArtifacts.length > 0 && <section aria-label="Artifact history" className="mt-4 border-t border-origin-border pt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="m-0 text-xs font-black uppercase tracking-wide">成果物</h2>
              <span className="origin-muted text-xs">{searchableArtifacts.length}</span>
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
    </div>, document.body)}
  </div>;
}
