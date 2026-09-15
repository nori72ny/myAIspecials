// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCodingNavigatorV14 } from './codingNavigatorV14.js';
import type { CodingDiscoveryContext } from './codingSessionV14.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture(): Promise<{ root: string; context: CodingDiscoveryContext }> {
  const root = await mkdtemp(path.join(tmpdir(), 'origin-explicit-scope-v14-'));
  roots.push(root);
  await mkdir(path.join(root, 'src/components'), { recursive: true });
  await writeFile(path.join(root, 'src/status.ts'), 'export const status = true;\n');
  await writeFile(path.join(root, 'src/App.tsx'), 'export const App = () => null;\n');
  return {
    root,
    context: {
      goal: 'Update src/status.ts and src/App.tsx to share the same status contract.',
      files: ['src/status.ts', 'src/App.tsx'],
    },
  };
}

describe('V1.4 deterministic owner-named scope', () => {
  it('uses two explicitly named existing mutation paths without provider discovery', async () => {
    const { root, context } = await fixture();
    const execute = vi.fn();

    await expect(createCodingNavigatorV14(root, {
      env: { OPENROUTER_API_KEY: 'test-only' },
      execute,
    })(context)).resolves.toEqual({
      editablePaths: ['src/status.ts', 'src/App.tsx'],
      contextPaths: [],
      creatablePaths: [],
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('classifies an explicitly named absent path as creatable only with create intent', async () => {
    const { root, context } = await fixture();
    context.goal = 'Update src/App.tsx and create src/components/StatusBadge.tsx for the extracted badge.';
    const execute = vi.fn();

    await expect(createCodingNavigatorV14(root, {
      env: { OPENROUTER_API_KEY: 'test-only' },
      execute,
    })(context)).resolves.toEqual({
      editablePaths: ['src/App.tsx'],
      contextPaths: [],
      creatablePaths: ['src/components/StatusBadge.tsx'],
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not convert an absent path mention into create authority without create intent', async () => {
    const { root, context } = await fixture();
    context.goal = 'Update src/App.tsx while considering src/components/StatusBadge.tsx as a possible future location.';
    const execute = vi.fn().mockRejectedValue(new Error('DISCOVERY_USED'));

    await expect(createCodingNavigatorV14(root, {
      env: { OPENROUTER_API_KEY: 'test-only' },
      execute,
    })(context)).rejects.toThrow('DISCOVERY_USED');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not authorize protected root authority files through explicit path text', async () => {
    const { root, context } = await fixture();
    context.goal = 'Update package.json and src/App.tsx for this change.';
    const execute = vi.fn().mockRejectedValue(new Error('DISCOVERY_USED'));

    await expect(createCodingNavigatorV14(root, {
      env: { OPENROUTER_API_KEY: 'test-only' },
      execute,
    })(context)).rejects.toThrow('DISCOVERY_USED');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
