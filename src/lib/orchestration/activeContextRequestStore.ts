import { AsyncLocalStorage } from "node:async_hooks";

const MAX_CONTEXT_CHARS = 6_000;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const storage = new AsyncLocalStorage<string>();

export function sanitizeActiveContext(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, "").trim().slice(0, MAX_CONTEXT_CHARS);
}

export function withActiveContext<T>(value: unknown, callback: () => T): T {
  return storage.run(sanitizeActiveContext(value), callback);
}

export function enterActiveContext(value: unknown): void {
  const sanitized = sanitizeActiveContext(value);
  try {
    storage.enterWith(sanitized);
  } catch {
    // Cloudflare workerd may expose node:async_hooks without supporting
    // AsyncLocalStorage.enterWith(). Active context is optional metadata, so
    // unsupported runtimes must continue safely without turning /api/chat into
    // a 500. Node runtimes retain the normal request-scoped behavior above.
  }
}

export function getActiveContext(): string {
  return storage.getStore() ?? "";
}
