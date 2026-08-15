import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_SESSIONS_STORAGE_KEY,
  DELETED_SESSION_IDS_STORAGE_KEY,
  createChatTitle,
  deleteChatSession,
  listChatSessions,
  saveChatSession,
} from '../chatHistory';

describe('chatHistory', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('saves sessions newest first and restores their messages', () => {
    saveChatSession({
      id: 'older',
      title: '古い依頼',
      updatedAt: '2026-08-15T00:00:00.000Z',
      messages: [{ role: 'user', content: '古い依頼' }],
    });
    saveChatSession({
      id: 'newer',
      title: '新しい依頼',
      updatedAt: '2026-08-15T01:00:00.000Z',
      messages: [{ role: 'user', content: '新しい依頼' }],
    });

    expect(listChatSessions().map((session) => session.id)).toEqual(['newer', 'older']);
    expect(window.localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY)).toContain('新しい依頼');
  });

  it('deletes a session and records a tombstone so it cannot silently return', () => {
    saveChatSession({
      id: 'delete-me',
      title: '削除する依頼',
      updatedAt: '2026-08-15T01:00:00.000Z',
      messages: [{ role: 'user', content: '削除する依頼' }],
    });

    deleteChatSession('delete-me');

    expect(listChatSessions()).toEqual([]);
    expect(JSON.parse(
      window.localStorage.getItem(DELETED_SESSION_IDS_STORAGE_KEY) ?? '[]',
    )).toContain('delete-me');
  });

  it('creates a compact title from the first request', () => {
    expect(createChatTitle('  お不動様について   詳しく教えて下さい  ', '無題')).toBe(
      'お不動様について 詳しく教えて下さい',
    );
  });
});
