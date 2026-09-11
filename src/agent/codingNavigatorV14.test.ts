// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCodingNavigatorV14, parseCodingSearchPlanV14 } from './codingNavigatorV14.js';
import type { CodingDiscoveryContext } from './codingSessionV14.js';
import type { OriginProviderExecutionRequest, OriginProviderExecutionResult } from '../legacy/originProviderClient.js';
import { ORIGIN_OPENROUTER_FREE_MODEL, DEFAULT_ORIGIN_PROVIDER_DATA_POLICY } from '../lib/orchestration/OriginExecutionPolicy.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

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

async function fixture(): Promise<{ root: string; context: CodingDiscoveryContext }> {
  const root = await mkdtemp(path.join(tmpdir(), 'origin-navigator-v14-'));
  roots.push(root);
  await mkdir(path.join(root, 'src/components'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');
  await writeFile(path.join(root, 'src/status.ts'), 'export const renderStatus = (value: string) => `status:${value}`;\n');
  await writeFile(path.join(root, 'src/App.tsx'), "import { renderStatus } from './status.js';\nexport const App = () => renderStatus('ready');\n");
  await writeFile(path.join(root, 'src/App.test.tsx'), "import { App } from './App.js';\n// renderStatus should remain visible through App\nvoid App;\n");
  return {
    root,
    context: {
      goal: 'Extract a reusable status badge and wire it into App',
      files: ['package.json', 'src/status.ts', 'src/App.tsx', 'src/App.test.tsx'],
    },
  };
}

describe('V1.4 multi-stage coding navigator', () => {
  it('searches locally between two zero-cost model stages and scopes from evidence', async () => {
    const { root, context } = await fixture();
    const scope = { editablePaths: ['src/App.tsx'], contextPaths: ['src/status.ts', 'src/App.test.tsx'], creatablePaths: ['src/components/StatusBadge.tsx'] };
    let call = 0;
    const execute = vi.fn(async (_request: OriginProviderExecutionRequest, _env: NodeJS.ProcessEnv) => {
      call += 1;
      return call === 1 ? result(JSON.stringify({ queries: ['renderStatus'] })) : result(JSON.stringify(scope));
    });
    const navigator = createCodingNavigatorV14(root, { env: { OPENROUTER_API_KEY: 'test-only' }, execute });
    await expect(navigator(context)).resolves.toEqual(scope);
    expect(execute).toHaveBeenCalledTimes(2);

    const firstRequest = execute.mock.calls[0][0];
    const firstPayload = JSON.parse(firstRequest.messages[0].content);
    expect(firstPayload.files).toEqual(context.files);
    expect(JSON.stringify(firstPayload)).not.toContain('export const renderStatus');
    expect(firstRequest.plan.freeOnly).toBe(true);

    const secondRequest = execute.mock.calls[1][0];
    const secondPayload = JSON.parse(secondRequest.messages[0].content);
    expect(secondPayload.searchHits.some((hit: { path: string }) => hit.path === 'src/status.ts')).toBe(true);
    expect(JSON.stringify(secondPayload.searchHits)).toContain('renderStatus');
    expect(secondRequest.plan.freeOnly).toBe(true);
  });

  it.each([
    'not JSON',
    JSON.stringify({ queries: [] }),
    JSON.stringify({ queries: ['renderStatus', 'RENDERSTATUS'] }),
    JSON.stringify({ queries: ['password'] }),
    JSON.stringify({ queries: ['renderStatus'], extra: true }),
  ])('rejects malformed or unsafe query planning output', text => {
    expect(() => parseCodingSearchPlanV14(text)).toThrow('CODING_NAVIGATION_QUERY_RESPONSE_INVALID');
  });

  it('rejects paid first-stage evidence before repository search or a second provider call', async () => {
    const { root, context } = await fixture();
    const paid = result(JSON.stringify({ queries: ['renderStatus'] }));
    paid.actualCostUsd = 1 as 0;
    const execute = vi.fn(async () => paid);
    await expect(createCodingNavigatorV14(root, { env: { OPENROUTER_API_KEY: 'test-only' }, execute })(context)).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('stops before provider access when no free provider key is configured', async () => {
    const { root, context } = await fixture();
    const execute = vi.fn();
    await expect(createCodingNavigatorV14(root, { env: {}, execute })(context)).rejects.toThrow('FREE_PROVIDER_NOT_CONFIGURED');
    expect(execute).not.toHaveBeenCalled();
  });

  it('refines an empty search and selects scope only after finding real code', async () => {
    const { root, context } = await fixture();
    const scope = { editablePaths: ['src/status.ts'], contextPaths: ['src/App.tsx'], creatablePaths: [] };
    const replies = [{ queries: ['missingWidget'] }, { queries: ['renderStatus'] }, scope];
    const execute = vi.fn(async () => result(JSON.stringify(replies.shift())));
    await expect(createCodingNavigatorV14(root, { env: { OPENROUTER_API_KEY: 'test-only' }, execute })(context)).resolves.toEqual(scope);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['missingWidget', 'MISSINGWIDGET', 'CODING_NAVIGATION_REPEATED_QUERY'],
    ['missingWidget', 'anotherMissingSymbol', 'CODING_NAVIGATION_NO_EVIDENCE'],
  ])('bounds unsuccessful navigation without a speculative scope call', async (first, second, code) => {
    const { root, context } = await fixture();
    const replies = [{ queries: [first] }, { queries: [second] }];
    const execute = vi.fn(async () => result(JSON.stringify(replies.shift())));
    await expect(createCodingNavigatorV14(root, { env: { OPENROUTER_API_KEY: 'test-only' }, execute })(context)).rejects.toThrow(code);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
