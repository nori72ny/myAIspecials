// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { augmentCodingDiscoveryContextV14 } from './explicitCodingPathHintsV14.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'origin-explicit-paths-v14-'));
  roots.push(root);
  await mkdir(path.join(root, 'src', 'agent'), { recursive: true });
  await writeFile(path.join(root, 'src', 'agent', 'target.ts'), 'export const target = true;\n');
  await writeFile(path.join(root, '.env.local'), 'SECRET=test-only\n');
  return root;
}

describe('explicit coding path hints', () => {
  it('reserves bounded inventory space for an explicitly named existing path', async () => {
    const root = await workspace();
    const files = Array.from({ length: 200 }, (_, index) => `src/noise-${String(index).padStart(3, '0')}.ts`);
    const result = await augmentCodingDiscoveryContextV14(root, {
      goal: 'Update src/agent/target.ts and create src/agent/new-helper.ts.',
      files,
    });

    expect(result.files).toHaveLength(200);
    expect(result.files[0]).toBe('src/agent/target.ts');
    expect(result.files).toContain('src/agent/target.ts');
    expect(result.files).not.toContain('src/agent/new-helper.ts');
    expect(new Set(result.files).size).toBe(result.files.length);
  });

  it('never adds protected or traversal-looking goal text to discovery', async () => {
    const root = await workspace();
    const result = await augmentCodingDiscoveryContextV14(root, {
      goal: 'Inspect .env.local, ../outside.ts, and src/agent/missing.ts.',
      files: ['src/agent/visible.ts'],
    });

    expect(result.files).toEqual(['src/agent/visible.ts']);
  });

  it('does not duplicate an explicit path already present in inventory', async () => {
    const root = await workspace();
    const result = await augmentCodingDiscoveryContextV14(root, {
      goal: 'Update src/agent/target.ts.',
      files: ['src/agent/target.ts', 'src/other.ts'],
    });

    expect(result.files).toEqual(['src/agent/target.ts', 'src/other.ts']);
  });
});
