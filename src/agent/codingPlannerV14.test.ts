// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createCodingPlannerV14, parseCodingProposal } from './codingPlannerV14.js';
import type { CodingContext } from './codingSessionV14.js';
import type { OriginProviderExecutionRequest, OriginProviderExecutionResult } from '../legacy/originProviderClient.js';
import { ORIGIN_OPENROUTER_CODING_FREE_MODEL, DEFAULT_ORIGIN_PROVIDER_DATA_POLICY } from '../lib/orchestration/OriginExecutionPolicy.js';

const context: CodingContext = {
  goal: 'Fix addition',
  files: [
    { path: 'math.js', content: 'a - b', sha256: 'snapshot' },
    { path: 'math.test.js', content: 'assert(add(2,3) === 5)', sha256: 'snapshot' },
  ],
  editablePaths: ['math.js'],
  creatablePaths: ['helper.js'],
  attempt: 1,
  failedChecks: ['test'],
  diagnostics: [{ kind: 'test', text: 'Expected 5; received -1' }],
};
const edit = { path: 'math.js', search: 'a - b', replacement: 'a + b' };
const batch = { edits: [edit], creates: [] as { path: string; content: string }[] };
const response = (text = JSON.stringify(batch)): OriginProviderExecutionResult => ({
  text,
  actualCostUsd: 0,
  usage: { costUsd: 0 },
  providerDataPolicy: DEFAULT_ORIGIN_PROVIDER_DATA_POLICY,
  routingEvidence: {
    requestedModel: ORIGIN_OPENROUTER_CODING_FREE_MODEL,
    servedModel: ORIGIN_OPENROUTER_CODING_FREE_MODEL,
    provider: 'OpenRouter',
    strategy: 'adaptive-primary',
    attempt: 1,
    fallbackUsed: false,
  },
});

type ProposalToolProperties = {
  edits: { minItems?: number; maxItems: number; items: { properties: { path: { enum?: string[] } } } };
  creates: { minItems?: number; maxItems: number; items: { properties: { path: { enum?: string[] } } } };
};

function proposalProperties(request: OriginProviderExecutionRequest): ProposalToolProperties {
  return (request.requiredTool?.parameters as { properties: ProposalToolProperties }).properties;
}

describe('coding model protocol', () => {
  it('sends actual code and diagnostics through the zero-cost provider adapter', async () => {
    const execute = vi.fn(async () => response());
    const planner = createCodingPlannerV14({ env: { OPENROUTER_API_KEY: 'test-only' }, execute });
    expect(await planner(context)).toEqual(batch);
    const request = execute.mock.calls[0] as unknown as [{ messages: { content: string }[]; plan: { freeOnly: boolean } }];
    const payload = JSON.parse(request[0].messages[0].content);
    expect(payload.diagnostics[0].text).toContain('Expected 5');
    expect(payload.creatablePaths).toEqual(['helper.js']);
    expect(request[0].plan.freeOnly).toBe(true);
  });

  it('binds required-tool edit and create paths to the trusted authorized scope', async () => {
    const execute = vi.fn(async (_request: OriginProviderExecutionRequest, _env: NodeJS.ProcessEnv) => response());
    const planner = createCodingPlannerV14({ env: { OPENROUTER_API_KEY: 'test-only' }, execute });
    await planner(context);

    const properties = proposalProperties(execute.mock.calls[0][0]);
    expect(properties.edits.minItems).toBeUndefined();
    expect(properties.edits.maxItems).toBe(1);
    expect(properties.edits.items.properties.path.enum).toEqual(['math.js']);
    expect(properties.creates.minItems).toBeUndefined();
    expect(properties.creates.maxItems).toBe(1);
    expect(properties.creates.items.properties.path.enum).toEqual(['helper.js']);
  });

  it('makes a create-only scope unambiguous and nonempty in the required tool schema', async () => {
    const createOnly: CodingContext = {
      goal: 'Create src/agent/probe.ts',
      files: [],
      editablePaths: [],
      creatablePaths: ['src/agent/probe.ts'],
      attempt: 0,
      failedChecks: [],
      diagnostics: [],
    };
    const createBatch = { edits: [], creates: [{ path: 'src/agent/probe.ts', content: 'export const probe = true;\n' }] };
    const execute = vi.fn(async (_request: OriginProviderExecutionRequest, _env: NodeJS.ProcessEnv) => response(JSON.stringify(createBatch)));
    const planner = createCodingPlannerV14({ env: { OPENROUTER_API_KEY: 'test-only' }, execute });

    await expect(planner(createOnly)).resolves.toEqual(createBatch);
    const properties = proposalProperties(execute.mock.calls[0][0]);
    expect(properties.edits.minItems).toBeUndefined();
    expect(properties.edits.maxItems).toBe(0);
    expect(properties.edits.items.properties.path.enum).toBeUndefined();
    expect(properties.creates.minItems).toBe(1);
    expect(properties.creates.maxItems).toBe(1);
    expect(properties.creates.items.properties.path.enum).toEqual(['src/agent/probe.ts']);
  });

  it('makes an edit-only scope unambiguous and nonempty in the required tool schema', async () => {
    const editOnly: CodingContext = {
      ...context,
      creatablePaths: [],
    };
    const execute = vi.fn(async (_request: OriginProviderExecutionRequest, _env: NodeJS.ProcessEnv) => response());
    const planner = createCodingPlannerV14({ env: { OPENROUTER_API_KEY: 'test-only' }, execute });

    await expect(planner(editOnly)).resolves.toEqual(batch);
    const properties = proposalProperties(execute.mock.calls[0][0]);
    expect(properties.edits.minItems).toBe(1);
    expect(properties.edits.maxItems).toBe(1);
    expect(properties.creates.minItems).toBeUndefined();
    expect(properties.creates.maxItems).toBe(0);
  });

  it('performs one bounded proposal schema correction without replaying invalid model response', async () => {
    const replies = [
      response(JSON.stringify({ edits: [], creates: [{ path: 'other.js', content: 'out of scope' }] })),
      response(),
    ];
    const execute = vi.fn(async (_request: OriginProviderExecutionRequest, _env: NodeJS.ProcessEnv) => replies.shift()!);
    const planner = createCodingPlannerV14({ env: { OPENROUTER_API_KEY: 'test-only' }, execute });

    await expect(planner(context)).resolves.toEqual(batch);
    expect(execute).toHaveBeenCalledTimes(2);

    const firstRequest = execute.mock.calls[0][0];
    const correctionRequest = execute.mock.calls[1][0];
    expect(correctionRequest.messages).toEqual(firstRequest.messages);
    expect(correctionRequest.messages).toHaveLength(1);
    expect(correctionRequest.messages[0].content).toBe(firstRequest.messages[0].content);
    expect(correctionRequest.systemInstruction).not.toBe(firstRequest.systemInstruction);
    expect(correctionRequest.systemInstruction).toContain('one bounded schema-correction attempt');
    expect(correctionRequest.systemInstruction).toContain('CODING_MODEL_CREATE_SCOPE_INVALID');
    expect(correctionRequest.systemInstruction).toContain('Use only exact paths listed in creatablePaths');
    expect(correctionRequest.messages[0].content).not.toContain('other.js');
    expect(correctionRequest.plan.freeOnly).toBe(true);
    expect(correctionRequest.requiredTool).toEqual(firstRequest.requiredTool);
  });

  it('makes the bounded mutation-count correction explicit for a create-only scope', async () => {
    const createOnly: CodingContext = {
      goal: 'Create src/agent/probe.ts',
      files: [],
      editablePaths: [],
      creatablePaths: ['src/agent/probe.ts'],
      attempt: 0,
      failedChecks: [],
      diagnostics: [],
    };
    const valid = { edits: [], creates: [{ path: 'src/agent/probe.ts', content: 'export const probe = true;\n' }] };
    const replies = [response(JSON.stringify({ edits: [], creates: [] })), response(JSON.stringify(valid))];
    const execute = vi.fn(async (_request: OriginProviderExecutionRequest, _env: NodeJS.ProcessEnv) => replies.shift()!);
    const planner = createCodingPlannerV14({ env: { OPENROUTER_API_KEY: 'test-only' }, execute });

    await expect(planner(createOnly)).resolves.toEqual(valid);
    expect(execute).toHaveBeenCalledTimes(2);
    const correctionRequest = execute.mock.calls[1][0];
    expect(correctionRequest.systemInstruction).toContain('CODING_MODEL_MUTATION_COUNT_INVALID');
    expect(correctionRequest.systemInstruction).toContain('authorized scope is create-only');
    expect(correctionRequest.systemInstruction).toContain('creates must contain at least one authorized item');
    expect(correctionRequest.requiredTool).toEqual(execute.mock.calls[0][0].requiredTool);
  });

  it('fails closed after exactly one unsuccessful proposal schema correction', async () => {
    const replies = [response('not JSON'), response(JSON.stringify({ edits: [], creates: [] }))];
    const execute = vi.fn(async (_request: OriginProviderExecutionRequest, _env: NodeJS.ProcessEnv) => replies.shift()!);
    const planner = createCodingPlannerV14({ env: { OPENROUTER_API_KEY: 'test-only' }, execute });

    await expect(planner(context)).rejects.toThrow('CODING_MODEL_MUTATION_COUNT_INVALID');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('accepts a bounded authorized new-file proposal', () => {
    expect(parseCodingProposal(JSON.stringify({ edits: [], creates: [{ path: 'helper.js', content: 'export const value = 1;\n' }] }), context))
      .toEqual({ edits: [], creates: [{ path: 'helper.js', content: 'export const value = 1;\n' }] });
  });

  it.each([
    ['not JSON', 'CODING_MODEL_JSON_INVALID'],
    [JSON.stringify({ edits: [{ ...edit, path: 'math.test.js' }], creates: [] }), 'CODING_MODEL_EDIT_SCOPE_INVALID'],
    [JSON.stringify({ edits: [{ ...edit, search: 'invented' }], creates: [] }), 'CODING_MODEL_EDIT_MATCH_INVALID'],
    [JSON.stringify({ edits: [edit, edit], creates: [] }), 'CODING_MODEL_DUPLICATE_PATH'],
    [JSON.stringify({ edits: [edit], creates: [], command: 'disable tests' }), 'CODING_MODEL_SCHEMA_INVALID'],
    [JSON.stringify({ edits: [], creates: [] }), 'CODING_MODEL_MUTATION_COUNT_INVALID'],
    [JSON.stringify({ edits: [], creates: [{ path: 'math.js', content: 'overwrite' }] }), 'CODING_MODEL_CREATE_SCOPE_INVALID'],
    [JSON.stringify({ edits: [], creates: [{ path: 'other.js', content: 'out of scope' }] }), 'CODING_MODEL_CREATE_SCOPE_INVALID'],
    [JSON.stringify({ edits: [edit], creates: [{ path: 'math.js', content: 'duplicate mutation' }] }), 'CODING_MODEL_CREATE_SCOPE_INVALID'],
  ])('rejects invalid or unauthorized model output', (text, code) => {
    expect(() => parseCodingProposal(text, context)).toThrow(code);
  });

  it('rejects paid evidence without accepting or retrying the patch', async () => {
    const paid = response();
    paid.actualCostUsd = 1 as 0;
    const execute = vi.fn(async () => paid);
    const planner = createCodingPlannerV14({ env: { OPENROUTER_API_KEY: 'test-only' }, execute });
    await expect(planner(context)).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('stops before calling a provider when no key is configured', async () => {
    const execute = vi.fn();
    await expect(createCodingPlannerV14({ env: {}, execute })(context)).rejects.toThrow('FREE_PROVIDER_NOT_CONFIGURED');
    expect(execute).not.toHaveBeenCalled();
  });
});
