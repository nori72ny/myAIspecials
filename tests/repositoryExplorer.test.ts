import { describe, expect, it } from 'vitest';
import { exploreRepository, readRepositoryFile } from '../src/agent/repositoryExplorer';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('repository explorer', () => {
  it('discovers files while ignoring dependency/build directories', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'origin-explorer-'));
    await writeFile(path.join(root, 'package.json'), '{}');
    await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;');
    await mkdir(path.join(root, 'dist'), { recursive: true });
    await writeFile(path.join(root, 'dist', 'bundle.js'), 'ignored');

    const entries = await exploreRepository(root);
    expect(entries.some((entry) => entry.path === 'package.json' && entry.kind === 'file')).toBe(true);
    expect(entries.some((entry) => entry.path.startsWith('node_modules/'))).toBe(false);
    expect(entries.some((entry) => entry.path.startsWith('dist/'))).toBe(false);
  });

  it('prevents reads outside the repository root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'origin-explorer-'));
    await expect(readRepositoryFile(root, '../package.json')).rejects.toThrow('PATH_OUTSIDE_REPOSITORY');
  });
});
