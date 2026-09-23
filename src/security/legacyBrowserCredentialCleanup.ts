export const ORIGIN_LEGACY_BROWSER_CREDENTIAL_KEYS = Object.freeze([
  "acos_github_token",
  "acos_github_client_secret",
  "acos_github_client_id",
  "acos_github_user",
] as const);

export function purgeOriginLegacyBrowserCredentials(
  storage: Pick<Storage, "removeItem"> = window.localStorage,
): void {
  for (const key of ORIGIN_LEGACY_BROWSER_CREDENTIAL_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // Fail closed: never read, copy, log, export, or rehydrate legacy credentials.
    }
  }
}
