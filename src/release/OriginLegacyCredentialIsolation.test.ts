import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ORIGIN_LEGACY_BROWSER_CREDENTIAL_KEYS, purgeOriginLegacyBrowserCredentials } from '../security/legacyBrowserCredentialCleanup';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('retired browser credential surfaces', () => {
  it('purges all legacy GitHub browser credential keys without reading values', () => {
    const removeItem = vi.fn();
    purgeOriginLegacyBrowserCredentials({ removeItem });
    expect(removeItem.mock.calls.map(([key]) => key)).toEqual([...ORIGIN_LEGACY_BROWSER_CREDENTIAL_KEYS]);
  });

  it('purges legacy credentials before service-worker startup', () => {
    const main = read('src/main.tsx');
    const purge = main.indexOf('purgeOriginLegacyBrowserCredentials();');
    const serviceWorker = main.indexOf('registerOriginServiceWorker();');
    expect(purge).toBeGreaterThan(0);
    expect(serviceWorker).toBeGreaterThan(purge);
  });

  it('never persists GitHub access tokens or client secrets in browser localStorage', () => {
    for (const path of [
      'src/components/os/GitHubWorkspace.tsx',
      'src/components/os/OrganizationApp.tsx',
    ]) {
      const source = read(path);
      expect(source).not.toMatch(/localStorage\.(?:getItem|setItem)\(["']acos_github_token["']/);
      expect(source).not.toMatch(/localStorage\.(?:getItem|setItem)\(["']acos_github_client_secret["']/);
    }
  });

  it('keeps retired OS credential surfaces detached from the Personal entrypoint', () => {
    const active = [
      read('src/main.tsx'),
      read('src/components/personal/PersonalEditionApp.tsx'),
    ].join('\n');
    expect(active).not.toMatch(/components\/os\/(?:OrganizationApp|WorkspaceApp|GitHubWorkspace)/);
  });
});
