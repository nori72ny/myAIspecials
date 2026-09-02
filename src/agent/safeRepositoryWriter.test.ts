import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { writeRepositoryFile, writeRepositoryFileIfUnchanged } from './safeRepositoryWriter';

describe('safeRepositoryWriter', () => {
  it('writes bounded content inside the repository', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'origin-agent-writer-'));
    const result = await writeRepositoryFile(root, 'src/app.ts', 'export const ok = true;');
    expect(result.path).toBe('src/app.ts');
    expect(await readFile(path.join(root, 'src/app.ts'), 'utf8')).toBe('export const ok = true;');
  });

  it('rejects protected paths, secret-like content, and oversized writes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'origin-agent-writer-'));
    await expect(writeRepositoryFile(root, '.env', 'SECRET=value')).rejects.toThrow('SECRET_PATH_BLOCKED');
    await expect(writeRepositoryFile(root, 'node_modules/x.ts', 'blocked')).rejects.toThrow('PROTECTED_PATH_BLOCKED');
    await expect(writeRepositoryFile(root, 'config.ts', 'const apiKey = "real-secret-value";')).rejects.toThrow('SECRET_CONTENT_BLOCKED');
    await expect(readFile(path.join(root, 'config.ts'), 'utf8')).rejects.toThrow();
    await expect(writeRepositoryFile(root, 'large.txt', 'x'.repeat(256 * 1024 + 1))).rejects.toThrow('WRITE_SIZE_LIMIT_EXCEEDED');
  });

  it('allows a 256 KiB boundary write and rejects the first byte above it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'origin-agent-writer-'));
    const content = 'x'.repeat(256 * 1024);
    await expect(writeRepositoryFile(root, 'boundary.txt', content)).resolves.toMatchObject({ bytes: 256 * 1024 });
    await expect(writeRepositoryFile(root, 'over.txt', `${content}x`)).rejects.toThrow('WRITE_SIZE_LIMIT_EXCEEDED');
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

  it('rejects a target that changed after validation', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'origin-agent-writer-'));
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'src/app.ts'), 'before');
    await expect(writeRepositoryFileIfUnchanged(root, 'src/app.ts', 'after-validation', 'new-content'))
      .rejects.toThrow('FILE_CHANGED_SINCE_VALIDATION');
    expect(await readFile(path.join(root, 'src/app.ts'), 'utf8')).toBe('before');
  });

  it('rejects a final target symlink during the stable compare step', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'origin-agent-writer-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'origin-agent-writer-outside-'));
    await fs.writeFile(path.join(outside, 'target.ts'), 'outside');
    await symlink(path.join(outside, 'target.ts'), path.join(root, 'target.ts'));
    await expect(writeRepositoryFileIfUnchanged(root, 'target.ts', '', 'safe')).rejects.toThrow('SYMLINK_PATH_BLOCKED');
    expect(await readFile(path.join(outside, 'target.ts'), 'utf8')).toBe('outside');
  });
});
