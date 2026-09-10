// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createCodingScoutV14, parseCodingScopeProposal } from './codingScoutV14.js';
import type { CodingDiscoveryContext } from './codingSessionV14.js';
import type { OriginProviderExecutionResult } from '../legacy/originProviderClient.js';
import { ORIGIN_OPENROUTER_FREE_MODEL, DEFAULT_ORIGIN_PROVIDER_DATA_POLICY } from '../lib/orchestration/OriginExecutionPolicy.js';

const context: CodingDiscoveryContext = {
  goal: 'Add a reusable status badge and wire it into the app',
  files: ['package.json', 'src/App.tsx', 'src/App.test.tsx', 'src/components/Panel.tsx'],
};
const scope = {
  editablePaths: ['src/App.tsx'],
  contextPaths: ['package.json', 'src/App.test.tsx'],
  creatablePaths: ['src/components/StatusBadge.tsx'],
};
const response = (): OriginProviderExecutionResult => ({
  text: JSON.stringify(scope),
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

describe('V1.4 repository scope scout', () => {
  it('sends only bounded path inventory through the zero-cost provider adapter', async () => {
    const execute = vi.fn(async () => response());
    const scout = createCodingScoutV14({ env: { OPENROUTER_API_KEY: 'test-only' }, execute });
    await expect(scout(context)).resolves.toEqual(scope);
    const request = execute.mock.calls[0] as unknown as [{ messages: { content: string }[]; plan: { freeOnly: boolean } }];
    const payload = JSON.parse(request[0].messages[0].content);
    expect(payload.files).toEqual(context.files);
    expect(JSON.stringify(payload)).not.toContain('export const');
    expect(request[0].plan.freeOnly).toBe(true);
  });

  it.each([
    JSON.stringify({ ...scope, editablePaths: ['package.json'] }),
    JSON.stringify({ ...scope, contextPaths: ['missing.ts'] }),
    JSON.stringify({ ...scope, creatablePaths: ['src/App.tsx'] }),
    JSON.stringify({ ...scope, editablePaths: ['src/App.tsx'], contextPaths: ['src/App.tsx'] }),
    JSON.stringify({ ...scope, creatablePaths: ['.github/workflows/pwn.yml'] }),
    JSON.stringify({ ...scope, extra: true }),
    JSON.stringify({ editablePaths: [], contextPaths: ['package.json'], creatablePaths: [] }),
    'not JSON',
  ])('rejects unsafe or malformed discovery output', text => {
    expect(() => parseCodingScopeProposal(text, context)).toThrow('CODING_DISCOVERY_RESPONSE_INVALID');
  });

  it('rejects paid evidence', async () => {
    const paid = response();
    paid.actualCostUsd = 1 as 0;
    const scout = createCodingScoutV14({ env: { OPENROUTER_API_KEY: 'test-only' }, execute: async () => paid });
    await expect(scout(context)).rejects.toThrow();
  });

  it('stops before provider access when no free provider key is configured', async () => {
    const execute = vi.fn();
    await expect(createCodingScoutV14({ env: {}, execute })(context)).rejects.toThrow('FREE_PROVIDER_NOT_CONFIGURED');
    expect(execute).not.toHaveBeenCalled();
  });
});
