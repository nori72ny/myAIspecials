import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
});
