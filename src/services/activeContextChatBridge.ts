import { retrieveRelevantContext, setActiveContextUserId } from "./activeContextGraph.js";

const ACTIVE_CONTEXT_USER_ID_KEY = "origin-active-context-user-id:v1";
const installedKey = "__originActiveContextChatBridgeInstalled";

type WindowWithBridgeFlag = Window & { [installedKey]?: boolean };

function ensureLocalContextUserId(): string {
  const existing = window.localStorage.getItem(ACTIVE_CONTEXT_USER_ID_KEY)?.trim();
  if (existing) {
    setActiveContextUserId(existing);
    return existing;
  }
  const created = `local-${window.crypto.randomUUID()}`;
  window.localStorage.setItem(ACTIVE_CONTEXT_USER_ID_KEY, created);
  setActiveContextUserId(created);
  return created;
}

function isChatRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "POST") return false;
  const url = input instanceof Request ? input.url : String(input);
  try {
    return new URL(url, window.location.origin).pathname === "/api/chat";
  } catch {
    return false;
  }
}

function readJsonBody(body: BodyInit | null | undefined): Record<string, unknown> | null {
  if (typeof body !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function installActiveContextChatBridge(): void {
  if (typeof window === "undefined" || !window.fetch) return;
  const target = window as WindowWithBridgeFlag;
  if (target[installedKey]) return;
  target[installedKey] = true;

  ensureLocalContextUserId();
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isChatRequest(input, init)) return originalFetch(input, init);

    const sourceBody = init?.body ?? (input instanceof Request ? input.clone().body : undefined);
    const body = readJsonBody(sourceBody);
    if (!body) return originalFetch(input, init);

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message && typeof message === "object" && (message as { role?: unknown }).role === "user");
    const prompt = lastUserMessage && typeof (lastUserMessage as { content?: unknown }).content === "string"
      ? (lastUserMessage as { content: string }).content
      : "";

    let activeContext = "";
    try {
      activeContext = await retrieveRelevantContext(prompt);
    } catch {
      // Fail closed: a local-memory failure must never block or alter the chat request.
      activeContext = "";
    }

    const nextInit: RequestInit = {
      ...init,
      body: JSON.stringify({
        ...body,
        activeContext: activeContext.slice(0, 6_000),
      }),
    };
    return originalFetch(input, nextInit);
  };
}
