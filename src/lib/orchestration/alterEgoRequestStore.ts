import { AsyncLocalStorage } from "node:async_hooks";

// Request-scoped alter-ego mode flag (design: ALTER_EGO_MODE_DESIGN
// 2026-11-27). The client bridge sends `alterEgoMode: true` — a boolean
// marker only, carrying no personal data — when the owner has the
// alter-ego mode toggle on; the persona instruction itself lives in
// code (alterEgoPersona.ts) and is appended server-side by the answer
// quality policy. Mirrors activeContextRequestStore's discipline: only
// the literal boolean true enables the mode, anything else is off.

const storage = new AsyncLocalStorage<boolean>();

export function enterAlterEgoMode(value: unknown): void {
  try {
    storage.enterWith(value === true);
  } catch {
    // Cloudflare workerd may expose node:async_hooks without supporting
    // AsyncLocalStorage.enterWith(). Alter-ego mode is optional, so an
    // unsupported runtime continues with the mode off instead of
    // turning /api/chat into a 500 (same fallback as active context).
  }
}

export function withAlterEgoMode<T>(value: unknown, callback: () => T): T {
  return storage.run(value === true, callback);
}

export function isAlterEgoMode(): boolean {
  return storage.getStore() === true;
}
