// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createCodingPlannerV14, parseCodingProposal } from './codingPlannerV14.js';
import type { CodingContext } from './codingSessionV14.js';
import type { OriginProviderExecutionResult } from '../legacy/originProviderClient.js';
import { ORIGIN_OPENROUTER_FREE_MODEL, DEFAULT_ORIGIN_PROVIDER_DATA_POLICY } from '../lib/orchestration/OriginExecutionPolicy.js';

const context: CodingContext = { goal: 'Fix addition', files: [{ path: 'math.js', content: 'a - b', sha256: 'snapshot' }, { path: 'math.test.js', content: 'assert(add(2,3) === 5)', sha256: 'snapshot' }], editablePaths: ['math.js'], attempt: 1, failedChecks: ['test'], diagnostics: [{ kind: 'test', text: 'Expected 5; received -1' }] };
const edit = { path: 'math.js', search: 'a - b', replacement: 'a + b' };
const response = (): OriginProviderExecutionResult => ({ text: JSON.stringify({ edits: [edit] }), actualCostUsd: 0, usage: { costUsd: 0 }, providerDataPolicy: DEFAULT_ORIGIN_PROVIDER_DATA_POLICY, routingEvidence: { requestedModel: ORIGIN_OPENROUTER_FREE_MODEL, servedModel: ORIGIN_OPENROUTER_FREE_MODEL, provider: 'OpenRouter', strategy: 'adaptive-primary', attempt: 1, fallbackUsed: false } });

describe('coding model protocol', () => {
  it('sends actual code and diagnostics through the zero-cost provider adapter', async () => {
    const execute = vi.fn(async () => response());
    const planner = createCodingPlannerV14({ env: { OPENROUTER_API_KEY: 'test-only' }, execute });
    expect(await planner(context)).toEqual([edit]);
    const request = execute.mock.calls[0] as unknown as [{ messages: { content: string }[]; plan: { freeOnly: boolean } }];
    expect(JSON.parse(request[0].messages[0].content).diagnostics[0].text).toContain('Expected 5');
    expect(request[0].plan.freeOnly).toBe(true);
  });
  it.each([
    'not JSON',
    JSON.stringify({ edits: [{ ...edit, path: 'math.test.js' }] }),
    JSON.stringify({ edits: [{ ...edit, search: 'invented' }] }),
    JSON.stringify({ edits: [edit, edit] }),
    JSON.stringify({ edits: [edit], command: 'disable tests' }),
    JSON.stringify({ edits: [] }),
  ])('rejects invalid or unauthorized model output', text => {
    expect(() => parseCodingProposal(text, context)).toThrow('CODING_MODEL_RESPONSE_INVALID');
  });
  it('rejects paid evidence without accepting the patch', async () => {
    const paid = response();
    paid.actualCostUsd = 1 as 0;
    const planner = createCodingPlannerV14({ env: { OPENROUTER_API_KEY: 'test-only' }, execute: async () => paid });
    await expect(planner(context)).rejects.toThrow();
  });
  it('stops before calling a provider when no key is configured', async () => {
    const execute = vi.fn();
    await expect(createCodingPlannerV14({ env: {}, execute })(context)).rejects.toThrow('FREE_PROVIDER_NOT_CONFIGURED');
    expect(execute).not.toHaveBeenCalled();
  });
});
