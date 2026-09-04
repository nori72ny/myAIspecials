import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, promises: { ...actual.promises, readdir: vi.fn(actual.promises.readdir) } };
});
import * as fs from 'node:fs';
import { listRepository, readRepositoryFile } from './safeRepositoryReader';

describe('safeRepositoryReader', () => {
  it('lists bounded repository contents and excludes protected paths', async () => { const root = await mkdtemp(path.join(tmpdir(), 'origin-agent-')); await mkdir(path.join(root, 'src'), { recursive: true }); await mkdir(path.join(root, 'node_modules'), { recursive: true }); await writeFile(path.join(root, 'src', 'app.ts'), 'export const ok = true;'); await writeFile(path.join(root, '.env'), 'SECRET=value'); const entries = await listRepository(root); expect(entries.some((entry) => entry.path === 'src/app.ts')).toBe(true); expect(entries.some((entry) => entry.path === '.env')).toBe(false); expect(entries.some((entry) => entry.path.startsWith('node_modules'))).toBe(false); });
  it('rejects traversal, absolute paths, and protected files', async () => { const root = await mkdtemp(path.join(tmpdir(), 'origin-agent-')); await writeFile(path.join(root, 'app.ts'), 'ok'); await expect(readRepositoryFile(root, '../outside.txt')).rejects.toThrow('PATH_OUTSIDE_REPOSITORY'); await expect(readRepositoryFile(root, path.join(root, 'app.ts'))).rejects.toThrow('PATH_OUTSIDE_REPOSITORY'); await writeFile(path.join(root, '.env.local'), 'SECRET=value'); await expect(readRepositoryFile(root, '.env.local')).rejects.toThrow('PROTECTED_PATH'); await expect(readRepositoryFile(root, 'app.ts')).resolves.toBe('ok'); });
  it('rejects intermediate directory symlink escapes', async () => { const root = await mkdtemp(path.join(tmpdir(), 'origin-agent-')); const outside = await mkdtemp(path.join(tmpdir(), 'origin-agent-outside-')); await writeFile(path.join(outside, 'secret.txt'), 'outside'); await symlink(outside, path.join(root, 'link'), 'dir'); await expect(readRepositoryFile(root, 'link/secret.txt')).rejects.toThrow('SYMLINK_PATH_BLOCKED'); const entries = await listRepository(root); expect(entries.some((entry) => entry.path.startsWith('link'))).toBe(false); });
  it('keeps repository listing inside the originally opened directory when a child is replaced by a symlink', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'origin-agent-')); const outside = await mkdtemp(path.join(tmpdir(), 'origin-agent-outside-')); const source = path.join(root, 'src'); const movedSource = path.join(root, 'src-original');
    await mkdir(source, { recursive: true }); await writeFile(path.join(source, 'app.ts'), 'inside'); await writeFile(path.join(outside, 'app.ts'), 'outside');
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs'); const readdirSpy = vi.mocked(fs.promises.readdir); const originalReaddir = actualFs.promises.readdir; let replaced = false;
    readdirSpy.mockImplementation(async (directory, options) => {
      const result = await originalReaddir(directory as string, options as never);
      if (!replaced) {
        replaced = true;
        await actualFs.promises.rename(source, movedSource);
        await actualFs.promises.symlink(outside, source, 'dir');
      }
      return result as never;
    });
    try {
      const entries = await listRepository(root).catch(() => []);
      expect(entries.some((entry) => entry.path === 'src/app.ts')).toBe(false);
      expect(entries.some((entry) => entry.path === 'src-original/app.ts')).toBe(false);
      expect(await readFile(path.join(movedSource, 'app.ts'), 'utf8')).toBe('inside');
      expect(await readFile(path.join(source, 'app.ts'), 'utf8')).catch;
    } finally { readdirSpy.mockReset(); readdirSpy.mockImplementation(originalReaddir); }
  });
});