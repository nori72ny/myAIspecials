// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createCodingPlannerV14, parseCodingProposal } from './codingPlannerV14.js';
import type { CodingContext } from './codingSessionV14.js';
import type { OriginProviderExecutionRequest, OriginProviderExecutionResult } from '../legacy/originProviderClient.js';
import { DEFAULT_ORIGIN_PROVIDER_DATA_POLICY, ORIGIN_OPENROUTER_FREE_MODEL } from '../lib/orchestration/OriginExecutionPolicy.js';

function response(text: string): OriginProviderExecutionResult {
  return {
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
  };
}

const editOnly: CodingContext = {
  goal: 'Repair generated probe',
  files: [{ path: 'src/agent/probe.ts', content: 'export const probe = false;\n', sha256: 'snapshot' }],
  editablePaths: ['src/agent/probe.ts'],
  creatablePaths: [],
  attempt: 1,
  failedChecks: ['test'],
  diagnostics: [{ kind: 'test', text: 'probe must be true' }],
};

const createOnly: CodingContext = {
  goal: 'Create generated probe',
  files: [],
  editablePaths: [],
  creatablePaths: ['src/agent/probe.ts'],
  attempt: 0,
  failedChecks: [],
  diagnostics: [],
};

describe('single-scope coding proposal protocol', () => {
  it('accepts omitted impossible creates array in an edit-only repair without widening scope', () => {
    expect(parseCodingProposal(JSON.stringify({
      edits: [{ path: 'src/agent/probe.ts', search: 'false', replacement: 'true' }],
    }), editOnly)).toEqual({
      edits: [{ path: 'src/agent/probe.ts', search: 'false', replacement: 'true' }],
      creates: [],
    });
  });

  it('accepts omitted impossible edits array in a create-only proposal without widening scope', () => {
    expect(parseCodingProposal(JSON.stringify({
      creates: [{ path: 'src/agent/probe.ts', content: 'export const probe = true;\n' }],
    }), createOnly)).toEqual({
      edits: [],
      creates: [{ path: 'src/agent/probe.ts', content: 'export const probe = true;\n' }],
    });
  });

  it('still rejects omitted arrays in a mixed scope and rejects every extra top-level key', () => {
    const mixed: CodingContext = { ...editOnly, creatablePaths: ['src/agent/helper.ts'] };
    expect(() => parseCodingProposal(JSON.stringify({ edits: [] }), mixed)).toThrow('CODING_MODEL_SCHEMA_INVALID');
    expect(() => parseCodingProposal(JSON.stringify({
      edits: [{ path: 'src/agent/probe.ts', search: 'false', replacement: 'true' }],
      command: 'skip tests',
    }), editOnly)).toThrow('CODING_MODEL_SCHEMA_INVALID');
  });

  it('makes the impossible array optional in the required tool contract for edit-only repairs', async () => {
    const execute = vi.fn(async (_request: OriginProviderExecutionRequest) => response(JSON.stringify({
      edits: [{ path: 'src/agent/probe.ts', search: 'false', replacement: 'true' }],
    })));
    const planner = createCodingPlannerV14({ env: { OPENROUTER_API_KEY: 'test-only' }, execute });

    await expect(planner(editOnly)).resolves.toEqual({
      edits: [{ path: 'src/agent/probe.ts', search: 'false', replacement: 'true' }],
      creates: [],
    });
    expect((execute.mock.calls[0][0].requiredTool?.parameters as { required: string[] }).required).toEqual(['edits']);
  });

  it('makes the impossible array optional in the required tool contract for create-only proposals', async () => {
    const execute = vi.fn(async (_request: OriginProviderExecutionRequest) => response(JSON.stringify({
      creates: [{ path: 'src/agent/probe.ts', content: 'export const probe = true;\n' }],
    })));
    const planner = createCodingPlannerV14({ env: { OPENROUTER_API_KEY: 'test-only' }, execute });

    await expect(planner(createOnly)).resolves.toEqual({
      edits: [],
      creates: [{ path: 'src/agent/probe.ts', content: 'export const probe = true;\n' }],
    });
    expect((execute.mock.calls[0][0].requiredTool?.parameters as { required: string[] }).required).toEqual(['creates']);
  });
});
