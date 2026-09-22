import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('retired browser credential surfaces', () => {
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
