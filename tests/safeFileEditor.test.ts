import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyValidatedFileEdit, validateFileEdit } from '../src/agent/safeFileEditor.js';

describe('safe file editor', () => {
  it('validates and applies a bounded edit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'origin-edit-'));
    try {
      await writeFile(path.join(root, 'sample.ts'), 'const value = 1;\n', 'utf8');
      const edit = await validateFileEdit(root, { path: 'sample.ts', content: 'const value = 2;\n' });
      await applyValidatedFileEdit(root, edit);
      await expect(readFile(path.join(root, 'sample.ts'), 'utf8')).resolves.toBe('const value = 2;\n');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('blocks traversal and protected paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'origin-edit-'));
    try {
      await writeFile(path.join(root, 'sample.ts'), 'x', 'utf8');
      await expect(validateFileEdit(root, { path: '../outside.ts', content: 'x' })).rejects.toThrow('PATH_TRAVERSAL_BLOCKED');
      await mkdir(path.join(root, '.git'));
      await writeFile(path.join(root, '.git', 'config'), 'x', 'utf8');
      await expect(validateFileEdit(root, { path: '.git/config', content: 'x' })).rejects.toThrow('PROTECTED_PATH');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('blocks secret-like content and stale writes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'origin-edit-'));
    try {
      await writeFile(path.join(root, 'sample.ts'), 'const value = 1;\n', 'utf8');
      await expect(validateFileEdit(root, { path: 'sample.ts', content: 'const api_key = "secret";\n' })).rejects.toThrow('SECRET_CONTENT_BLOCKED');
      const edit = await validateFileEdit(root, { path: 'sample.ts', content: 'const value = 2;\n' });
      await writeFile(path.join(root, 'sample.ts'), 'const value = 99;\n', 'utf8');
      await expect(applyValidatedFileEdit(root, edit)).rejects.toThrow('FILE_CHANGED_SINCE_VALIDATION');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
