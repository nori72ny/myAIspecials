// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createCodingNavigatorV14 } from './codingNavigatorV14.js';
import type { CodingDiscoveryContext } from './codingSessionV14.js';
import type { OriginProviderExecutionRequest, OriginProviderExecutionResult } from '../legacy/originProviderClient.js';
import { ORIGIN_OPENROUTER_FREE_MODEL, DEFAULT_ORIGIN_PROVIDER_DATA_POLICY } from '../lib/orchestration/OriginExecutionPolicy.js';

const result = (text: string): OriginProviderExecutionResult => ({
  text,
  actualCostUsd: 0,
  usage: { costUsd: 0 },
  providerDataPolicy: DEFAULT_ORIGIN_PROVIDER_DATA_POLICY,
  routingEvidence: {
    requestedModel: ORIGIN_OPENROUTER_FREE_MODEL,
    servedModel: ORIGIN_OPENROUTER_FREE_MODEL,
    provider: 'OpenRouter',
    strategy: 'adaptive-primary',
    attempt: 1,
    fallbackUsed: false,
  },
});

const files = ['package.json', 'src/App.tsx', 'src/status.ts'];
const env = { OPENROUTER_API_KEY: 'test-only' };

async function withRepository<T>(extraFiles: Record<string, string>, run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'origin-coding-nav-v14-'));
  const contents: Record<string, string> = {
    'package.json': '{"private":true}\n',
    'src/App.tsx': 'export function App() { return null; }\n',
    'src/status.ts': 'export const status = "ready";\n',
    ...extraFiles,
  };
  try {
    for (const [path, content] of Object.entries(contents)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content, 'utf8');
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('V1.4 explicit exact create-only navigation', () => {
  it('derives the single absent create path without spending a provider call', async () => {
    const context: CodingDiscoveryContext = {
      goal: 'Create exactly one new file at src/agent/__origin_coding_smoke_v14__.ts with exact content:\nexport const ORIGIN_CODING_SMOKE_V14 = true;\nDo not modify any other file. Run all required verification checks.',
      files,
    };
    const execute = vi.fn();

    await expect(createCodingNavigatorV14('/repo', { env, execute })(context)).resolves.toEqual({
      editablePaths: [],
      contextPaths: [],
      creatablePaths: ['src/agent/__origin_coding_smoke_v14__.ts'],
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not bypass model-assisted navigation for mixed edit/create work', async () => {
    const context: CodingDiscoveryContext = {
      goal: 'Create src/components/StatusBadge.tsx and wire it into src/App.tsx.',
      files,
    };
    const scope = {
      editablePaths: ['src/App.tsx'],
      contextPaths: ['src/status.ts'],
      creatablePaths: ['src/components/StatusBadge.tsx'],
    };
    const replies = [
      { queries: ['App'] },
      scope,
    ];
    const execute = vi.fn(async (_request: OriginProviderExecutionRequest, _env: NodeJS.ProcessEnv) => result(JSON.stringify(replies.shift())));

    await withRepository({}, async root => {
      await expect(createCodingNavigatorV14(root, { env, execute })(context)).resolves.toEqual(scope);
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0].requiredTool?.name).toBe('submit_coding_search_plan_v14');
  });

  it('refuses the deterministic path when the named path already exists', async () => {
    const existingPath = 'src/agent/__origin_coding_smoke_v14__.ts';
    const context: CodingDiscoveryContext = {
      goal: `Create exactly one new file at ${existingPath} with exact content:\nexport const ORIGIN_CODING_SMOKE_V14 = true;\nDo not modify any other file.`,
      files: [...files, existingPath],
    };
    const scope = { editablePaths: [existingPath], contextPaths: [], creatablePaths: [] };
    const replies = [{ queries: ['ORIGIN_CODING_SMOKE_V14'] }, scope];
    const execute = vi.fn(async (_request: OriginProviderExecutionRequest, _env: NodeJS.ProcessEnv) => result(JSON.stringify(replies.shift())));

    await withRepository({ [existingPath]: 'export const ORIGIN_CODING_SMOKE_V14 = true;\n' }, async root => {
      await expect(createCodingNavigatorV14(root, { env, execute })(context)).resolves.toEqual(scope);
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
