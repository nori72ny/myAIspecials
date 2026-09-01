import { describe, expect, it } from 'vitest';
import { validateFileEdit } from './safeFileEditor';
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

  it('blocks traversal and protected paths', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-editor-'));
    await fs.writeFile(path.join(root, 'a.ts'), 'x');
    await expect(validateFileEdit(root, { path: '../a.ts', content: 'x' })).rejects.toThrow('PATH_TRAVERSAL_BLOCKED');
    await expect(validateFileEdit(root, { path: '.env', content: 'x' })).rejects.toThrow('PROTECTED_PATH');
  });

  it('blocks secret-like content and oversized changes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-editor-'));
    await fs.writeFile(path.join(root, 'a.ts'), 'x');
    await expect(validateFileEdit(root, { path: 'a.ts', content: 'password=secret' })).rejects.toThrow('SECRET_CONTENT_BLOCKED');
    await expect(validateFileEdit(root, { path: 'a.ts', content: 'x'.repeat(256 * 1024 + 1) })).rejects.toThrow('CHANGE_BUDGET_EXCEEDED');
  });
});
