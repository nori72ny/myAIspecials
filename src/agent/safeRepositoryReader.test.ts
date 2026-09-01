import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listRepository, readRepositoryFile } from './safeRepositoryReader';

describe('safeRepositoryReader', () => {
  it('lists bounded repository contents and excludes protected paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'origin-agent-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await mkdir(path.join(root, 'node_modules'), { recursive: true });
    await writeFile(path.join(root, 'src', 'app.ts'), 'export const ok = true;');
    await writeFile(path.join(root, '.env'), 'SECRET=value');
    const entries = await listRepository(root);
    expect(entries.some((entry) => entry.path === 'src/app.ts')).toBe(true);
    expect(entries.some((entry) => entry.path === '.env')).toBe(false);
    expect(entries.some((entry) => entry.path.startsWith('node_modules'))).toBe(false);
  });

  it('rejects traversal and protected files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'origin-agent-'));
    await writeFile(path.join(root, 'app.ts'), 'ok');
    await expect(readRepositoryFile(root, '../outside.txt')).rejects.toThrow('PATH_OUTSIDE_REPOSITORY');
    await writeFile(path.join(root, '.env.local'), 'SECRET=value');
    await expect(readRepositoryFile(root, '.env.local')).rejects.toThrow('PROTECTED_PATH');
    await expect(readRepositoryFile(root, 'app.ts')).resolves.toBe('ok');
  });
});
