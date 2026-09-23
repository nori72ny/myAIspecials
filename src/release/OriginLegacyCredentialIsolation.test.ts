// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ORIGIN_LEGACY_BROWSER_CREDENTIAL_KEYS,
  purgeOriginLegacyBrowserCredentials,
} from "../security/legacyBrowserCredentialCleanup";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("legacy browser credential isolation", () => {
  it("removes legacy GitHub browser state without reading or exporting values", () => {
    const removeItem = vi.fn();
    purgeOriginLegacyBrowserCredentials({ removeItem });
    expect(removeItem.mock.calls.map(([key]) => key)).toEqual([...ORIGIN_LEGACY_BROWSER_CREDENTIAL_KEYS]);
  });

  it("purges legacy browser credentials before Personal runtime startup", () => {
    const main = read("src/main.tsx");
    const purge = main.indexOf("purgeOriginLegacyBrowserCredentials();");
    const serviceWorker = main.indexOf("registerOriginServiceWorker();");
    expect(purge).toBeGreaterThan(0);
    expect(serviceWorker).toBeGreaterThan(purge);
  });

  it("does not rehydrate or persist GitHub PAT/client-secret in legacy UI code", () => {
    for (const path of [
      "src/components/os/OrganizationApp.tsx",
      "src/components/os/GitHubWorkspace.tsx",
    ]) {
      const source = read(path);
      expect(source).not.toContain('localStorage.getItem("acos_github_token")');
      expect(source).not.toContain('localStorage.setItem("acos_github_token"');
      expect(source).not.toContain('localStorage.getItem("acos_github_client_secret")');
      expect(source).not.toContain('localStorage.setItem("acos_github_client_secret"');
      expect(source).toContain("approved server-side GitHub integration");
    }
  });

  it("keeps Personal release isolated from legacy OS GitHub credential UIs", () => {
    const main = read("src/main.tsx");
    expect(main).not.toContain("OrganizationApp");
    expect(main).not.toContain("GitHubWorkspace");
  });
});
