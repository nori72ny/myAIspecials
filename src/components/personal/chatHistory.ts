export const CHAT_SESSIONS_STORAGE_KEY = 'origin_chat_sessions_v1';
export const DELETED_SESSION_IDS_STORAGE_KEY = 'origin_deleted_chat_session_ids_v1';

export type StoredChatSession<TMessage = unknown> = {
  id: string;
  title: string;
  updatedAt: string;
  messages: TMessage[];
};

function readSessions<TMessage>(): StoredChatSession<TMessage>[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((session): session is StoredChatSession<TMessage> => (
      Boolean(session)
      && typeof session.id === 'string'
      && typeof session.title === 'string'
      && typeof session.updatedAt === 'string'
      && Array.isArray(session.messages)
    ));
  } catch {
    return [];
  }
}

export function listChatSessions<TMessage = unknown>(): StoredChatSession<TMessage>[] {
  return readSessions<TMessage>()
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function loadChatSession<TMessage = unknown>(sessionId: string): StoredChatSession<TMessage> | undefined {
  return readSessions<TMessage>().find((session) => session.id === sessionId);
}

export function saveChatSession<TMessage>(
  session: StoredChatSession<TMessage>,
): StoredChatSession<TMessage>[] {
  const sessions = readSessions<TMessage>().filter((item) => item.id !== session.id);
  const next = [session, ...sessions].slice(0, 100);
  window.localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('originChatHistoryChanged'));
  return next;
}

export function deleteChatSession(sessionId: string): StoredChatSession[] {
  const next = readSessions().filter((session) => session.id !== sessionId);
  window.localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(next));

  let deletedIds: string[] = [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DELETED_SESSION_IDS_STORAGE_KEY) ?? '[]');
    if (Array.isArray(parsed)) deletedIds = parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    deletedIds = [];
  }
  window.localStorage.setItem(
    DELETED_SESSION_IDS_STORAGE_KEY,
    JSON.stringify(Array.from(new Set([sessionId, ...deletedIds])).slice(0, 500)),
  );
  window.dispatchEvent(new CustomEvent('originChatHistoryChanged'));
  return next;
}

export function createChatSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `origin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createChatTitle(content: string, fallback: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > 42 ? `${normalized.slice(0, 42)}…` : normalized;
}
