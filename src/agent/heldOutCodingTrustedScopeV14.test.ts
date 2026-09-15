import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveHeldOutTrustedScopeV14 } from './heldOutCodingTrustedScopeV14.js';

const roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-heldout-scope-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('resolveHeldOutTrustedScopeV14', () => {
  it('splits required contract paths into existing edits and missing creates', async () => {
    const root = await tempRoot();
    await fs.mkdir(path.join(root, 'src', 'agent'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'agent', 'existing.ts'), 'export const existing = true;\n');

    await expect(resolveHeldOutTrustedScopeV14(root, [
      'src/agent/existing.ts',
      'src/agent/new-file.ts',
    ])).resolves.toEqual({
      allowedPaths: ['src/agent/existing.ts'],
      creatablePaths: ['src/agent/new-file.ts'],
    });
  });

  it.each([
    ['../escape.ts', 'src/agent/other.ts'],
    ['/absolute.ts', 'src/agent/other.ts'],
    ['src/agent/dup.ts', 'src/agent/dup.ts'],
  ])('rejects unsafe or duplicate required paths', async (first, second) => {
    const root = await tempRoot();
    await expect(resolveHeldOutTrustedScopeV14(root, [first, second]))
      .rejects.toThrow('HELD_OUT_REQUIRED_SCOPE_INVALID');
  });

  it('rejects directories and symlink required paths', async () => {
    const root = await tempRoot();
    await fs.mkdir(path.join(root, 'src', 'agent', 'directory.ts'), { recursive: true });
    await fs.writeFile(path.join(root, 'target.ts'), 'export {};\n');
    await fs.symlink(path.join(root, 'target.ts'), path.join(root, 'linked.ts'));

    await expect(resolveHeldOutTrustedScopeV14(root, ['src/agent/directory.ts', 'src/agent/new.ts']))
      .rejects.toThrow('HELD_OUT_REQUIRED_SCOPE_INVALID');
    await expect(resolveHeldOutTrustedScopeV14(root, ['linked.ts', 'src/agent/new.ts']))
      .rejects.toThrow('HELD_OUT_REQUIRED_SCOPE_INVALID');
  });
});
