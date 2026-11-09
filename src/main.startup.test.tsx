// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({ render: vi.fn() })),
}));
vi.mock('./pwa/registerServiceWorker', () => ({ registerOriginServiceWorker: vi.fn() }));
vi.mock('./services/activeContextChatBridge', () => ({ installActiveContextChatBridge: vi.fn() }));

import { startupArchivedSession, withStartupArchivedSession } from './main';
import type { ConversationMessage, ConversationSession } from './App';

const previousConversation: ConversationMessage[] = [
  { id: 'm-1', role: 'user', content: '前回の相談です' },
  { id: 'm-2', role: 'assistant', content: '前回の回答です' },
];

const existingSession: ConversationSession = {
  id: 'session-old',
  title: 'もっと前の会話',
  createdAt: 100,
  messages: [{ id: 'x-1', role: 'user', content: 'もっと前の相談' }],
};

describe('startup archive of the previous in-progress conversation', () => {
  it('returns null when there is no stored conversation', () => {
    expect(startupArchivedSession([], 123)).toBeNull();
    expect(withStartupArchivedSession([existingSession], [], 123)).toEqual([existingSession]);
  });

  it('archives the stored conversation as a history session titled from its first user message', () => {
    const archived = startupArchivedSession(previousConversation, 456);
    expect(archived).not.toBeNull();
    expect(archived?.title).toBe('前回の相談です');
    expect(archived?.createdAt).toBe(456);
    expect(archived?.messages.map((message) => message.id)).toEqual(['m-1', 'm-2']);
    expect(archived?.messages.map((message) => message.content)).toEqual(['前回の相談です', '前回の回答です']);
  });

  it('prepends the archived conversation without dropping existing sessions', () => {
    const next = withStartupArchivedSession([existingSession], previousConversation, 456);
    expect(next).toHaveLength(2);
    expect(next[0]?.title).toBe('前回の相談です');
    expect(next[1]).toEqual(existingSession);
  });

  it('does not archive the same conversation twice', () => {
    const once = withStartupArchivedSession([existingSession], previousConversation, 456);
    const twice = withStartupArchivedSession(once, previousConversation, 789);
    expect(twice).toHaveLength(2);
    expect(twice.filter((session) => session.title === '前回の相談です')).toHaveLength(1);
  });

  it('caps the stored sessions at 24 entries', () => {
    const many: ConversationSession[] = Array.from({ length: 24 }, (_, index) => ({
      id: `s-${index}`,
      title: `会話 ${index}`,
      createdAt: index,
      messages: [{ id: `x-${index}`, role: 'user', content: `相談 ${index}` }],
    }));
    const next = withStartupArchivedSession(many, previousConversation, 999);
    expect(next).toHaveLength(24);
    expect(next[0]?.title).toBe('前回の相談です');
  });
});
