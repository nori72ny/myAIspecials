import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { writeRepositoryFile } from './safeRepositoryWriter';

describe('safeRepositoryWriter', () => {
  it('writes bounded content inside the repository', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'origin-agent-writer-'));
    const result = await writeRepositoryFile(root, 'src/app.ts', 'export const ok = true;');
    expect(result.path).toBe('src/app.ts');
    expect(await readFile(path.join(root, 'src/app.ts'), 'utf8')).toBe('export const ok = true;');
  });

  it('rejects protected paths and oversized writes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'origin-agent-writer-'));
    await expect(writeRepositoryFile(root, '.env', 'SECRET=value')).rejects.toThrow('SECRET_PATH_BLOCKED');
    await expect(writeRepositoryFile(root, 'node_modules/x.ts', 'blocked')).rejects.toThrow('PROTECTED_PATH_BLOCKED');
    await expect(writeRepositoryFile(root, 'large.txt', 'x'.repeat(128 * 1024 + 1))).rejects.toThrow('WRITE_SIZE_LIMIT_EXCEEDED');
  });

  it('rejects intermediate directory symlink escapes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'origin-agent-writer-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'origin-agent-writer-outside-'));
    await symlink(outside, path.join(root, 'link'), 'dir');

    await expect(writeRepositoryFile(root, 'link/pwned.txt', 'outside')).rejects.toThrow('SYMLINK_PATH_BLOCKED');
    await expect(readFile(path.join(outside, 'pwned.txt'), 'utf8')).rejects.toThrow();
  });

  it('keeps writing inside the originally opened parent when its path is replaced before rename', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'origin-agent-writer-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'origin-agent-writer-outside-'));
    const parent = path.join(root, 'src');
    const movedParent = path.join(root, 'src-original');
    await fs.mkdir(parent, { recursive: true });
    await fs.mkdir(outside, { recursive: true });

    const originalRename = fs.rename;
    const renameSpy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from).includes('.origin-tmp-')) {
        await originalRename(parent, movedParent);
        await symlink(outside, parent, 'dir');
      }
      return originalRename(from, to);
    });

    try {
      await writeRepositoryFile(root, 'src/app.ts', 'safe');
      expect(await readFile(path.join(movedParent, 'app.ts'), 'utf8')).toBe('safe');
      await expect(readFile(path.join(outside, 'app.ts'), 'utf8')).rejects.toThrow();
      expect(renameSpy).toHaveBeenCalled();
    } finally {
      renameSpy.mockRestore();
    }
  });
});
