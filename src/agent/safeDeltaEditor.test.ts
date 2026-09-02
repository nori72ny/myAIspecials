import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyDeltaEdit, validateDeltaEdit } from './safeDeltaEditor.js';

describe('safeDeltaEditor', () => {
  async function fixture(content = 'const value = 1;\n') {
    const root = await mkdtemp(path.join(os.tmpdir(), 'origin-delta-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'sample.ts'), content, 'utf8');
    return root;
  }

  it('requires exactly one exact match and applies atomically through the safe writer', async () => {
    const root = await fixture();
    try {
      const edit = await validateDeltaEdit(root, { path: 'src/sample.ts', search: 'const value = 1;', replacement: 'const value = 2;' });
      expect(edit.matchedOccurrences).toBe(1);
      await applyDeltaEdit(root, edit);
      await expect(readFile(path.join(root, 'src', 'sample.ts'), 'utf8')).resolves.toBe('const value = 2;\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when the search text is missing or ambiguous', async () => {
    const root = await fixture('x\nx\n');
    try {
      await expect(validateDeltaEdit(root, { path: 'src/sample.ts', search: 'missing', replacement: 'y' })).rejects.toThrow('EDIT_TARGET_NOT_FOUND');
      await expect(validateDeltaEdit(root, { path: 'src/sample.ts', search: 'x', replacement: 'y' })).rejects.toThrow('EDIT_MATCH_NOT_UNIQUE');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects traversal and secret-like replacements before mutation', async () => {
    const root = await fixture();
    try {
      await expect(validateDeltaEdit(root, { path: '../outside.ts', search: '1', replacement: '2' })).rejects.toThrow('PATH_TRAVERSAL_BLOCKED');
      await expect(validateDeltaEdit(root, { path: 'src/sample.ts', search: '1', replacement: 'api_key="blocked-secret"' })).rejects.toThrow('SECRET_CONTENT_BLOCKED');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
