import { describe, expect, it } from 'vitest';
import { validateFileEdit, applyValidatedFileEdit } from './safeFileEditor';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('safeFileEditor', () => {
  it('allows bounded edits to ordinary files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-editor-'));
    await fs.writeFile(path.join(root, 'a.ts'), 'export const a = 1;');
    const result = await validateFileEdit(root, { path: 'a.ts', content: 'export const a = 2;' });
    expect(result.ok).toBe(true);
    expect(result.previous).toContain('a = 1');
  });

  it('applies a validated edit through the hardened repository writer', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-editor-'));
    await fs.writeFile(path.join(root, 'a.ts'), 'export const a = 1;');
    const edit = await validateFileEdit(root, { path: 'a.ts', content: 'export const a = 2;' });
    await applyValidatedFileEdit(root, edit);
    expect(await fs.readFile(path.join(root, 'a.ts'), 'utf8')).toBe('export const a = 2;');
  });

  it('rejects stale validated edits before writing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-editor-'));
    await fs.writeFile(path.join(root, 'a.ts'), 'export const a = 1;');
    const edit = await validateFileEdit(root, { path: 'a.ts', content: 'export const a = 2;' });
    await fs.writeFile(path.join(root, 'a.ts'), 'changed by another process');
    await expect(applyValidatedFileEdit(root, edit)).rejects.toThrow('FILE_CHANGED_SINCE_VALIDATION');
    expect(await fs.readFile(path.join(root, 'a.ts'), 'utf8')).toBe('changed by another process');
  });

  it('blocks traversal and protected paths', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-editor-'));
    await fs.writeFile(path.join(root, 'a.ts'), 'x');
    await expect(validateFileEdit(root, { path: '../a.ts', content: 'x' })).rejects.toThrow('PATH_TRAVERSAL_BLOCKED');
    await expect(validateFileEdit(root, { path: '.env', content: 'x' })).rejects.toThrow('PROTECTED_PATH');
  });

  it('uses the centralized secret policy for credentials and private keys', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-editor-'));
    await fs.writeFile(path.join(root, 'a.ts'), 'x');
    await expect(validateFileEdit(root, { path: 'a.ts', content: 'token = "secret-value"' })).rejects.toThrow('SECRET_CONTENT_BLOCKED');
    await expect(validateFileEdit(root, { path: 'a.ts', content: '-----BEGIN PRIVATE KEY-----' })).rejects.toThrow('SECRET_CONTENT_BLOCKED');
  });

  it('blocks oversized changes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-editor-'));
    await fs.writeFile(path.join(root, 'a.ts'), 'x');
    await expect(validateFileEdit(root, { path: 'a.ts', content: 'x'.repeat(256 * 1024 + 1) })).rejects.toThrow('CHANGE_BUDGET_EXCEEDED');
  });

  it('blocks intermediate symlink escapes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-editor-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-editor-outside-'));
    await fs.writeFile(path.join(outside, 'secret.ts'), 'outside-secret');
    await fs.symlink(outside, path.join(root, 'link'), 'dir');
    await expect(validateFileEdit(root, { path: 'link/secret.ts', content: 'blocked' })).rejects.toThrow('SYMLINK_PATH_BLOCKED');
    expect(await fs.readFile(path.join(outside, 'secret.ts'), 'utf8')).toBe('outside-secret');
  });
});
