import { generateProposalsForPrompt, resolveActiveContextUserId, retrieveRelevantContext } from "./activeContextGraph.js";
import { readPersonalizationEnabled, readPersonalLanguage } from "../hooks/usePersonalSettings";

const installedKey = "__originActiveContextChatBridgeInstalled";

type WindowWithBridgeFlag = Window & { [installedKey]?: boolean };

function ensureLocalContextUserId(): string {
  // User id generation is unified in the storage layer (design §5.2); an
  // already-persisted id is always kept.
  return resolveActiveContextUserId();
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

    // Master toggle (design §7.2): while personalization is off, no personal
    // context block is attached at all — the request goes out exactly as the
    // app built it. (PR P1-3 wired the extraction side of this gate; this is
    // the reflection side, completed in PR P1-4.)
    if (!readPersonalizationEnabled()) return originalFetch(input, init);

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message && typeof message === "object" && (message as { role?: unknown }).role === "user");
    const prompt = lastUserMessage && typeof (lastUserMessage as { content?: unknown }).content === "string"
      ? (lastUserMessage as { content: string }).content
      : "";

    let activeContext = "";
    try {
      activeContext = await retrieveRelevantContext(prompt, { language: readPersonalLanguage() });
    } catch {
      // Fail closed: a local-memory failure must never block or alter the chat request.
      activeContext = "";
    }

    try {
      // Combination proposals (design §6.4, PR P1-6): deterministic and
      // on-device, no extra request. This only records pending proposals
      // for the owner to review in settings — nothing about a proposal is
      // added to the outgoing request — and a failure here must never
      // block or alter the chat request either.
      await generateProposalsForPrompt(prompt);
    } catch {
      // Ignored by design (see above).
    }

    // The assembled block already respects the client-side 2,000-char cap
    // (design §6.2); the server's 6,000-char acceptance limit is unchanged
    // and stays as the outer guard.
    const nextInit: RequestInit = {
      ...init,
      body: JSON.stringify({
        ...body,
        activeContext,
      }),
    };
    return originalFetch(input, nextInit);
  };
}
