import { useCallback, useEffect, useRef, useState } from 'react';
import { User } from 'lucide-react';
import { getTranslations, type OriginLanguage } from '../i18n';
import { cn } from '../utils';
import {
  clearAll,
  clearBlockNotices,
  deleteMemoryItem,
  deleteProfileItem,
  getPersonalMemoryMigrationNotice,
  getPersonalMemoryUsage,
  listBlockNotices,
  listItems,
  listProposals,
  resolveActiveContextUserId,
  setProposalStatus,
  upsertMemoryItem,
  upsertProfileItem,
  type OriginBlockNotice,
  type OriginMemoryItem,
  type OriginMemoryKind,
  type OriginProfileCategory,
  type OriginProfileItem,
  type OriginProposal,
  type PersonalMemoryUsage,
} from '../services/activeContextGraph';

// ---------------------------------------------------------------------------
// "About you" settings section (Personalization Stage 1, PR P1-3).
//
// Implements the management UI of PERSONALIZATION_STAGE1_DESIGN_2026-11-16
// §7 inside the existing settings dialog (no new screen): the profile the
// owner writes (§3.1 categories only — stage-2 fields such as name, birth
// date, address and phone number have no place here by construction) and
// the memory accumulated from conversations (§3.2), each editable,
// deletable and individually excludable from what is shared with the chat
// AI. All data stays in the P1-1 on-device store; this component only
// calls its item-level CRUD API. Conversation history lives in a different
// store and is never touched here. The block-notice area (§5.3) shows the
// reason categories of memory candidates the §9.2 guard stopped during
// ingestion; the blocked content itself is never stored or shown.
// ---------------------------------------------------------------------------

interface Props {
  language: OriginLanguage;
  enabled: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  /** Ids of saved conversation sessions that still exist (for source links). */
  sourceSessionIds?: ReadonlySet<string>;
  /** Opens the conversation a memory item came from, when it still exists. */
  onOpenSourceSession?: (sessionId: string) => void;
}

const PROFILE_CATEGORIES: readonly OriginProfileCategory[] = ['about', 'personality', 'preference', 'goal'];
const MEMORY_KIND_ORDER: readonly OriginMemoryKind[] = ['request', 'decision', 'preference', 'fact', 'commitment'];
const HISTORY_STATUSES: ReadonlySet<string> = new Set(['superseded', 'done', 'archived']);

type Notice = { kind: 'info' | 'error'; message: string } | { kind: 'idle' };

function formatMonthDay(timestamp: number, language: OriginLanguage): string {
  return new Intl.DateTimeFormat(language === 'ja' ? 'ja-JP' : 'en-US', { month: 'long', day: 'numeric' }).format(new Date(timestamp));
}

function ToggleSwitch({ checked, onChange, ariaLabel }: { checked: boolean; onChange: (next: boolean) => void; ariaLabel: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={(event) => { event.stopPropagation(); onChange(!checked); }}
      className={cn('relative h-7 w-12 shrink-0 rounded-full border transition', checked ? 'origin-primary-button border-transparent' : 'origin-secondary-button')}
    >
      <span aria-hidden="true" className={cn('absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow', checked ? 'right-1' : 'left-1')} />
    </button>
  );
}

export default function PersonalizationSettings({ language, enabled, onToggleEnabled, sourceSessionIds, onOpenSourceSession }: Props) {
  const p = getTranslations(language).personal;
  const userIdRef = useRef<string | null>(null);
  const [profileItems, setProfileItems] = useState<OriginProfileItem[]>([]);
  const [memoryItems, setMemoryItems] = useState<OriginMemoryItem[]>([]);
  const [proposals, setProposals] = useState<OriginProposal[]>([]);
  const [blockNotices, setBlockNotices] = useState<OriginBlockNotice[]>([]);
  const [usage, setUsage] = useState<PersonalMemoryUsage | null>(null);
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>({ kind: 'idle' });
  const [loadFailed, setLoadFailed] = useState(false);
  const [newCategory, setNewCategory] = useState<OriginProfileCategory>('about');
  const [newText, setNewText] = useState('');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearIncludeProfile, setClearIncludeProfile] = useState(false);

  const userId = (): string => {
    if (!userIdRef.current) userIdRef.current = resolveActiveContextUserId();
    return userIdRef.current;
  };

  const reload = useCallback(async () => {
    const id = userId();
    const [items, nextUsage, nextProposals, nextBlockNotices] = await Promise.all([listItems(id), getPersonalMemoryUsage(id), listProposals(id), listBlockNotices(id)]);
    setProfileItems(items.profile);
    setMemoryItems(items.memory);
    setUsage(nextUsage);
    setProposals(nextProposals);
    setBlockNotices(nextBlockNotices);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const id = userId();
        const noticeRecord = getPersonalMemoryMigrationNotice(id);
        if (active && noticeRecord) {
          setMigrationMessage(noticeRecord.status === 'migrated' && noticeRecord.migratedCount > 0
            ? p.migrationMigrated(noticeRecord.migratedCount)
            : noticeRecord.status === 'failed' ? p.migrationFailed : null);
        }
        await reload();
      } catch {
        if (active) setLoadFailed(true);
      }
    })();
    return () => { active = false; };
    // The migration notice wording follows the current language; the item
    // load itself runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  const runMutation = async (action: () => Promise<void>) => {
    try {
      await action();
      await reload();
    } catch {
      setNotice({ kind: 'error', message: p.loadFailed });
    }
  };

  // --- Profile actions ------------------------------------------------------

  const addProfileItem = async () => {
    const text = newText.trim();
    if (!text) return;
    const now = Date.now();
    const item: OriginProfileItem = {
      id: crypto.randomUUID(),
      category: newCategory,
      text,
      sendToModel: true,
      createdAt: now,
      updatedAt: now,
    };
    try {
      const result = await upsertProfileItem(userId(), item);
      if (!result.saved) {
        // Pre-save guard (§9.2): keep the draft so the owner can fix it.
        setNotice({ kind: 'error', message: p.blockedSave });
        return;
      }
      setNewText('');
      setNotice({ kind: 'idle' });
      await reload();
    } catch {
      setNotice({ kind: 'error', message: p.loadFailed });
    }
  };

  const saveProfileEdit = async (item: OriginProfileItem) => {
    const text = editDraft.trim();
    if (!text) return;
    try {
      const result = await upsertProfileItem(userId(), { ...item, text, updatedAt: Date.now() });
      if (!result.saved) {
        setNotice({ kind: 'error', message: p.blockedSave });
        return;
      }
      setEditingProfileId(null);
      setNotice({ kind: 'idle' });
      await reload();
    } catch {
      setNotice({ kind: 'error', message: p.loadFailed });
    }
  };

  // --- Memory actions ---------------------------------------------------------

  const saveMemoryEdit = async (item: OriginMemoryItem) => {
    const text = editDraft.trim();
    if (!text) return;
    try {
      const result = await upsertMemoryItem(userId(), { ...item, text, updatedAt: Date.now() });
      if (!result.saved) {
        setNotice({ kind: 'error', message: p.blockedSave });
        return;
      }
      setEditingMemoryId(null);
      setNotice({ kind: 'idle' });
      await reload();
    } catch {
      setNotice({ kind: 'error', message: p.loadFailed });
    }
  };

  const resolveNeedsCheck = async (chosen: OriginMemoryItem, group: OriginMemoryItem[]) => {
    await runMutation(async () => {
      const now = Date.now();
      await upsertMemoryItem(userId(), { ...chosen, status: 'active', updatedAt: now });
      for (const other of group) {
        if (other.id !== chosen.id) {
          await upsertMemoryItem(userId(), { ...other, status: 'superseded', updatedAt: now });
        }
      }
    });
  };

  // --- Proposal actions (design §6.4, PR P1-6) --------------------------------
  //
  // Approving a combination lets the context assembly promote its items
  // into the proposal tier; approving a needs-check proposal resolves the
  // group in favor of the newest statement (the storage layer performs
  // the transition). Dismissing records the pair so it is never proposed
  // again. Resolved proposals leave the list either way.

  const resolveProposal = async (proposal: OriginProposal, next: 'approved' | 'dismissed') => {
    await runMutation(async () => {
      await setProposalStatus(userId(), proposal.id, next);
    });
  };

  // --- Block notice actions (design §5.3) -------------------------------------
  //
  // The notices report memory candidates the §9.2 guard stopped during
  // conversation ingestion, with the reason categories only (the blocked
  // content itself is never stored). Acknowledging clears them all.

  const dismissBlockNotices = async () => {
    await runMutation(async () => {
      await clearBlockNotices(userId());
    });
  };

  const deleteNeedsCheckGroup = async (group: OriginMemoryItem[]) => {
    await runMutation(async () => {
      for (const item of group) await deleteMemoryItem(userId(), item.id);
    });
  };

  const confirmClearAll = async () => {
    await runMutation(async () => {
      await clearAll(userId(), clearIncludeProfile ? 'all' : 'memory');
    });
    setClearConfirmOpen(false);
    setClearIncludeProfile(false);
    setEditingMemoryId(null);
    setEditingProfileId(null);
    setNotice({ kind: 'info', message: p.clearAllDone });
  };

  // --- Derived groupings ------------------------------------------------------

  const activeMemory = memoryItems.filter((item) => item.status === 'active');
  const needsCheckGroups = MEMORY_KIND_ORDER
    .map((kind) => ({ kind, items: memoryItems.filter((item) => item.status === 'needs-check' && item.kind === kind) }))
    .filter((group) => group.items.length > 0);
  const activeGroups = MEMORY_KIND_ORDER
    .map((kind) => ({ kind, items: activeMemory.filter((item) => item.kind === kind) }))
    .filter((group) => group.items.length > 0);
  const historyItems = memoryItems.filter((item) => HISTORY_STATUSES.has(item.status));

  // Pending proposals whose items are still in the state the proposal was
  // made for (a combination whose items were deleted or replaced since,
  // or a needs-check group the owner already settled by hand, is stale
  // and simply not shown; its record still suppresses re-proposal).
  const memoryById = new Map(memoryItems.map((item) => [item.id, item]));
  const profileById = new Map(profileItems.map((item) => [item.id, item]));
  const pendingProposals = proposals
    .filter((proposal) => proposal.status === 'pending')
    .filter((proposal) => (proposal.kind === 'needs-check'
      ? proposal.memoryItemIds.filter((id) => memoryById.get(id)?.status === 'needs-check').length >= 2
      : proposal.memoryItemIds.length > 0 && proposal.memoryItemIds.every((id) => memoryById.get(id)?.status === 'active')));

  const originLabel = (item: OriginMemoryItem): string => (
    item.origin === 'explicit' ? p.originExplicit : item.origin === 'legacy-acg' ? p.originLegacy : p.originInferred
  );

  const renderSource = (item: OriginMemoryItem) => {
    if (!item.source || item.source.at <= 0) return <span>{p.sourceMissing}</span>;
    const label = p.sourceFromConversation(formatMonthDay(item.source.at, language));
    const sessionId = item.source.sessionId;
    if (sessionId && onOpenSourceSession && sourceSessionIds?.has(sessionId)) {
      return (
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onOpenSourceSession(sessionId); }}
          className="font-semibold underline decoration-dotted underline-offset-2"
        >
          {label}
        </button>
      );
    }
    return <span>{label}</span>;
  };

  const renderMemoryItem = (item: OriginMemoryItem, inNeedsCheckGroup = false, group: OriginMemoryItem[] = []) => (
    <li key={item.id} data-testid={`memory-item-${item.id}`} className="origin-surface-muted space-y-2 rounded-xl border p-3">
      {editingMemoryId === item.id ? (
        <div className="space-y-2">
          <textarea
            aria-label={p.edit}
            value={editDraft}
            onChange={(event) => setEditDraft(event.target.value)}
            rows={3}
            className="w-full rounded-xl border bg-transparent px-3 py-2 text-sm leading-6"
          />
          <div className="flex gap-2">
            <button type="button" onClick={(event) => { event.stopPropagation(); void saveMemoryEdit(item); }} className="origin-primary-button min-h-11 rounded-xl px-3 text-sm font-semibold">{p.saveEdit}</button>
            <button type="button" onClick={(event) => { event.stopPropagation(); setEditingMemoryId(null); }} className="origin-secondary-button min-h-11 rounded-xl border px-3 text-sm font-semibold">{p.cancelEdit}</button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm leading-6">{item.text}</p>
          <p className="origin-muted text-[13px] leading-5">{originLabel(item)} ・ {renderSource(item)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="origin-muted text-[13px]">{p.sendToModel}</span>
            <ToggleSwitch
              checked={item.sendToModel}
              ariaLabel={`${p.sendToModel}: ${item.text}`}
              onChange={(next) => { void runMutation(async () => { await upsertMemoryItem(userId(), { ...item, sendToModel: next }); }); }}
            />
            {inNeedsCheckGroup ? (
              <button type="button" onClick={(event) => { event.stopPropagation(); void resolveNeedsCheck(item, group); }} className="origin-primary-button min-h-11 rounded-xl px-3 text-sm font-semibold">{p.useThis}</button>
            ) : (
              <button type="button" onClick={(event) => { event.stopPropagation(); setEditingMemoryId(item.id); setEditDraft(item.text); }} className="origin-secondary-button min-h-11 rounded-xl border px-3 text-sm font-semibold">{p.edit}</button>
            )}
            <button type="button" onClick={(event) => { event.stopPropagation(); void runMutation(async () => { await deleteMemoryItem(userId(), item.id); }); }} className="origin-danger-button min-h-11 rounded-xl border px-3 text-sm font-semibold">{p.delete}</button>
          </div>
          {!item.sendToModel && <p className="origin-muted text-[13px] leading-5">{p.deviceOnlyNote}</p>}
        </>
      )}
    </li>
  );

  const renderProposal = (proposal: OriginProposal) => {
    const memoryBasis = proposal.memoryItemIds
      .map((id) => memoryById.get(id))
      .filter((item): item is OriginMemoryItem => Boolean(item));
    const profileBasis = proposal.profileItemIds
      .map((id) => profileById.get(id))
      .filter((item): item is OriginProfileItem => Boolean(item));
    return (
      <li key={proposal.id} data-testid={`proposal-${proposal.id}`} className="origin-surface-muted space-y-2 rounded-xl border p-3">
        {proposal.kind === 'needs-check' ? (
          <>
            <p className="text-sm font-bold">{p.proposalNeedsCheckTitle}</p>
            <p className="origin-muted text-[13px] leading-5">{p.proposalNeedsCheckBody}</p>
            <ul className="space-y-1">
              {memoryBasis.map((item) => (
                <li key={item.id} className="text-sm leading-6">
                  {item.text}
                  <span className="origin-muted text-[13px]">（{formatMonthDay(item.createdAt, language)}）</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={(event) => { event.stopPropagation(); void resolveProposal(proposal, 'approved'); }} className="origin-primary-button min-h-11 rounded-xl px-3 text-sm font-semibold">{p.proposalNeedsCheckApprove}</button>
              <button type="button" onClick={(event) => { event.stopPropagation(); void resolveProposal(proposal, 'dismissed'); }} className="origin-secondary-button min-h-11 rounded-xl border px-3 text-sm font-semibold">{p.proposalNeedsCheckDismiss}</button>
            </div>
          </>
        ) : (
          <>
            <p className="origin-muted text-[13px] leading-5">{p.proposalFromRequest(proposal.promptExcerpt)}</p>
            <ul className="space-y-1">
              {memoryBasis.map((item) => (
                <li key={item.id} className="text-sm leading-6">
                  <span className="origin-muted text-[13px]">{p.memoryKinds[item.kind]}：</span>{item.text}
                </li>
              ))}
              {profileBasis.map((item) => (
                <li key={item.id} className="text-sm leading-6">
                  <span className="origin-muted text-[13px]">{p.profileCategories[item.category]}：</span>{item.text}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={(event) => { event.stopPropagation(); void resolveProposal(proposal, 'approved'); }} className="origin-primary-button min-h-11 rounded-xl px-3 text-sm font-semibold">{p.proposalApproveCombination}</button>
              <button type="button" onClick={(event) => { event.stopPropagation(); void resolveProposal(proposal, 'dismissed'); }} className="origin-secondary-button min-h-11 rounded-xl border px-3 text-sm font-semibold">{p.proposalDismiss}</button>
            </div>
          </>
        )}
      </li>
    );
  };

  return (
    <section aria-labelledby="personal-heading" data-testid="personalization-section" className="space-y-3 border-t border-[var(--border-default)] pt-5">
      <h3 id="personal-heading" className="flex items-center gap-2 text-sm font-bold"><User className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />{p.heading}</h3>
      <p className="origin-muted text-[13px] leading-5">{p.description}</p>
      <p className="origin-muted text-[13px] leading-5">{p.groundedNote}</p>

      <div className="flex items-center justify-between gap-3">
        <span id="personal-toggle-label" className="text-sm font-semibold">{p.toggleLabel}</span>
        <ToggleSwitch checked={enabled} ariaLabel={p.toggleLabel} onChange={onToggleEnabled} />
      </div>
      {!enabled && <p className="origin-muted text-[13px] leading-5">{p.toggleOffNote}</p>}
      {migrationMessage && <p role="status" className="origin-muted text-[13px] leading-5">{migrationMessage}</p>}
      {usage && <p className="origin-muted text-[13px] leading-5">{p.usageSummary(usage.itemCount, usage.maxItems)}</p>}
      {usage?.limitReached && <p className="text-sm leading-5">{p.limitReachedNote}</p>}
      {usage && !usage.limitReached && usage.nearLimit && <p className="text-sm leading-5">{p.nearLimitNote}</p>}
      {loadFailed && <p role="status" className="text-sm leading-5 text-[var(--danger)]">{p.loadFailed}</p>}
      <p role="status" aria-live="polite" className={cn('text-sm leading-5', notice.kind === 'error' ? 'text-[var(--danger)]' : 'origin-muted')}>
        {notice.kind !== 'idle' ? notice.message : ''}
      </p>

      <div className="space-y-3 pt-2">
        <h4 className="text-sm font-bold">{p.profileHeading}</h4>
        {profileItems.length === 0
          ? <p className="origin-muted text-[13px] leading-5">{p.profileEmpty}</p>
          : (
            <ul className="space-y-2">
              {profileItems.map((item) => (
                <li key={item.id} data-testid={`profile-item-${item.id}`} className="origin-surface-muted space-y-2 rounded-xl border p-3">
                  {editingProfileId === item.id ? (
                    <div className="space-y-2">
                      <textarea
                        aria-label={p.edit}
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value)}
                        rows={3}
                        className="w-full rounded-xl border bg-transparent px-3 py-2 text-sm leading-6"
                      />
                      <div className="flex gap-2">
                        <button type="button" onClick={(event) => { event.stopPropagation(); void saveProfileEdit(item); }} className="origin-primary-button min-h-11 rounded-xl px-3 text-sm font-semibold">{p.saveEdit}</button>
                        <button type="button" onClick={(event) => { event.stopPropagation(); setEditingProfileId(null); }} className="origin-secondary-button min-h-11 rounded-xl border px-3 text-sm font-semibold">{p.cancelEdit}</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm leading-6">{item.text}</p>
                      <p className="origin-muted text-[13px] leading-5">{p.profileCategories[item.category]} ・ {p.updatedOn(formatMonthDay(item.updatedAt, language))}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="origin-muted text-[13px]">{p.sendToModel}</span>
                        <ToggleSwitch
                          checked={item.sendToModel}
                          ariaLabel={`${p.sendToModel}: ${item.text}`}
                          onChange={(next) => { void runMutation(async () => { await upsertProfileItem(userId(), { ...item, sendToModel: next }); }); }}
                        />
                        <button type="button" onClick={(event) => { event.stopPropagation(); setEditingProfileId(item.id); setEditDraft(item.text); }} className="origin-secondary-button min-h-11 rounded-xl border px-3 text-sm font-semibold">{p.edit}</button>
                        <button type="button" onClick={(event) => { event.stopPropagation(); void runMutation(async () => { await deleteProfileItem(userId(), item.id); }); }} className="origin-danger-button min-h-11 rounded-xl border px-3 text-sm font-semibold">{p.delete}</button>
                      </div>
                      {!item.sendToModel && <p className="origin-muted text-[13px] leading-5">{p.deviceOnlyNote}</p>}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <label className="sr-only" htmlFor="personal-profile-category">{p.profileCategoryLabel}</label>
            <select
              id="personal-profile-category"
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value as OriginProfileCategory)}
              className="min-h-12 rounded-xl border bg-transparent px-3 text-sm"
            >
              {PROFILE_CATEGORIES.map((category) => <option key={category} value={category}>{p.profileCategories[category]}</option>)}
            </select>
            <label className="sr-only" htmlFor="personal-profile-text">{p.profileTextLabel}</label>
            <input
              id="personal-profile-text"
              type="text"
              value={newText}
              onChange={(event) => setNewText(event.target.value)}
              placeholder={p.profileTextPlaceholder}
              className="min-h-12 rounded-xl border bg-transparent px-3 text-sm"
            />
            <button type="button" onClick={(event) => { event.stopPropagation(); void addProfileItem(); }} className="origin-primary-button min-h-12 rounded-xl px-4 text-sm font-semibold">{p.profileAdd}</button>
          </div>
          <p className="origin-muted text-[13px] leading-5">{p.profileWarning}</p>
        </div>
      </div>

      {pendingProposals.length > 0 && (
        <div className="space-y-3 pt-2">
          <h4 className="text-sm font-bold">{p.proposalsHeading}</h4>
          <p className="origin-muted text-[13px] leading-5">{p.proposalsIntro}</p>
          <ul className="space-y-2">
            {pendingProposals.map((proposal) => renderProposal(proposal))}
          </ul>
        </div>
      )}

      {blockNotices.length > 0 && (
        <div className="space-y-3 pt-2" data-testid="block-notices">
          <h4 className="text-sm font-bold">{p.blockNoticesHeading}</h4>
          <p className="origin-muted text-[13px] leading-5">{p.blockNoticesIntro}</p>
          <ul className="space-y-2">
            {blockNotices.map((notice) => (
              <li key={notice.id} data-testid={`block-notice-${notice.id}`} className="origin-surface-muted rounded-xl border p-3">
                <p className="text-sm leading-6">
                  {p.blockNoticeEntry(
                    formatMonthDay(notice.at, language),
                    notice.categories.map((category) => p.blockCategories[category]).join('・'),
                  )}
                  {notice.kind ? <span className="origin-muted text-[13px]">（{p.memoryKinds[notice.kind]}）</span> : null}
                </p>
              </li>
            ))}
          </ul>
          <button type="button" onClick={(event) => { event.stopPropagation(); void dismissBlockNotices(); }} className="origin-secondary-button min-h-11 rounded-xl border px-3 text-sm font-semibold">{p.blockNoticesDismiss}</button>
        </div>
      )}

      <div className="space-y-3 pt-2">
        <h4 className="text-sm font-bold">{p.memoryHeading}</h4>
        {needsCheckGroups.map((group) => (
          <div key={group.kind} className="space-y-2 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-3">
            <p className="text-sm font-bold">{p.needsCheckHeading}（{p.memoryKinds[group.kind]}）</p>
            <p className="text-sm leading-5">{p.needsCheckPrompt}</p>
            <ul className="space-y-2">
              {group.items.map((item) => renderMemoryItem(item, true, group.items))}
            </ul>
            {group.items.length === 2 && (
              <button type="button" onClick={(event) => { event.stopPropagation(); void deleteNeedsCheckGroup(group.items); }} className="origin-danger-button min-h-11 rounded-xl border px-3 text-sm font-semibold">{p.deleteBoth}</button>
            )}
          </div>
        ))}
        {activeGroups.length === 0 && needsCheckGroups.length === 0
          ? <p className="origin-muted text-[13px] leading-5">{p.memoryEmpty}</p>
          : activeGroups.map((group) => (
            <div key={group.kind} className="space-y-2">
              <h5 className="origin-muted text-sm font-semibold">{p.memoryKinds[group.kind]}</h5>
              <ul className="space-y-2">
                {group.items.map((item) => renderMemoryItem(item))}
              </ul>
            </div>
          ))}
        {historyItems.length > 0 && (
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">{p.historyFold}</summary>
            <ul className="space-y-2 pt-1">
              {historyItems.map((item) => (
                <li key={item.id} data-testid={`memory-item-${item.id}`} className="origin-surface-muted space-y-1 rounded-xl border p-3">
                  <p className="origin-muted text-sm leading-6">{item.text}</p>
                  <p className="origin-muted text-[13px] leading-5">{p.memoryKinds[item.kind]} ・ {originLabel(item)}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="space-y-2 pt-1">
          {!clearConfirmOpen ? (
            <button
              type="button"
              data-testid="personal-clear-all-button"
              onClick={(event) => { event.stopPropagation(); setClearConfirmOpen(true); }}
              className="origin-danger-button inline-flex min-h-12 items-center justify-center rounded-xl border px-3 text-sm font-semibold"
            >
              {p.clearAll}
            </button>
          ) : (
            <div className="space-y-2 rounded-xl border p-3">
              <p className="text-sm font-bold">{p.clearAllConfirmTitle}</p>
              <p className="origin-muted text-[13px] leading-5">{p.clearAllConfirmBody}</p>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={clearIncludeProfile}
                  onChange={(event) => setClearIncludeProfile(event.target.checked)}
                  className="h-5 w-5"
                />
                {p.clearAllIncludeProfile}
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={(event) => { event.stopPropagation(); void confirmClearAll(); }} className="origin-danger-button min-h-11 rounded-xl border px-3 text-sm font-semibold">{p.clearAllConfirm}</button>
                <button type="button" onClick={(event) => { event.stopPropagation(); setClearConfirmOpen(false); }} className="origin-secondary-button min-h-11 rounded-xl border px-3 text-sm font-semibold">{p.clearAllCancel}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
