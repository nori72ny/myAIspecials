import { describe, expect, it } from 'vitest';
import { exploreRepository, readRepositoryFile } from '../src/agent/repositoryExplorer';

describe('repository explorer', () => {
  it('discovers files while ignoring dependency/build directories', async () => {
    const entries = await exploreRepository(process.cwd());
    expect(entries.some((entry) => entry.path === 'package.json' && entry.kind === 'file')).toBe(true);
    expect(entries.some((entry) => entry.path.startsWith('node_modules/'))).toBe(false);
  });

  it('prevents reads outside the repository root', async () => {
    await expect(readRepositoryFile(process.cwd(), '../package.json')).rejects.toThrow('Path escapes repository root');
  });
});
