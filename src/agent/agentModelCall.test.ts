// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { agentAnalyzerCapacityAllocation, createAgentModelExecutor } from './agentModelCall.js';

describe('agentModelCall (failover-backed model executor)', () => {
  it('fails closed with the plan code when no free provider is configured', async () => {
    // No network is touched: with no provider keys at all, the shared
    // execution plan itself refuses before any provider call.
    const execute = createAgentModelExecutor({});
    await expect(execute({ instruction: 'classify', userText: 'a,b\n1,2', goal: '分類して' }))
      .resolves.toEqual({ ok: false, code: 'FREE_PROVIDER_NOT_CONFIGURED' });
  });

  it('treats an empty provider key as unconfigured', async () => {
    const execute = createAgentModelExecutor({ OPENROUTER_API_KEY: '' });
    await expect(execute({ instruction: 'x', userText: 'y', goal: 'z' }))
      .resolves.toEqual({ ok: false, code: 'FREE_PROVIDER_NOT_CONFIGURED' });
  });
});

describe('agentAnalyzerCapacityAllocation (design §2-C)', () => {
  const on = { ORIGIN_AGENT_ANALYZER_ALTERNATING_ALLOCATION_ENABLED: 'true' } as NodeJS.ProcessEnv;

  it('keeps the original D-1 hint for every call while the switch is off', () => {
    expect(agentAnalyzerCapacityAllocation(0, {})).toBe('agent-analyzer-chunk');
    expect(agentAnalyzerCapacityAllocation(1, {})).toBe('agent-analyzer-chunk');
    expect(agentAnalyzerCapacityAllocation(7, {})).toBe('agent-analyzer-chunk');
    expect(agentAnalyzerCapacityAllocation(1, { ORIGIN_AGENT_ANALYZER_ALTERNATING_ALLOCATION_ENABLED: 'TRUE' })).toBe('agent-analyzer-chunk');
  });

  it('alternates deterministically by the chunk global index while the switch is on', () => {
    expect(agentAnalyzerCapacityAllocation(0, on)).toBe('agent-analyzer-chunk');
    expect(agentAnalyzerCapacityAllocation(1, on)).toBe('agent-analyzer-chunk-primary');
    expect(agentAnalyzerCapacityAllocation(2, on)).toBe('agent-analyzer-chunk');
    expect(agentAnalyzerCapacityAllocation(3, on)).toBe('agent-analyzer-chunk-primary');
    expect(agentAnalyzerCapacityAllocation(36, on)).toBe('agent-analyzer-chunk');
    expect(agentAnalyzerCapacityAllocation(37, on)).toBe('agent-analyzer-chunk-primary');
  });

  it('falls back to the D-1 hint when the index is absent or unusable', () => {
    expect(agentAnalyzerCapacityAllocation(undefined, on)).toBe('agent-analyzer-chunk');
    expect(agentAnalyzerCapacityAllocation(-1, on)).toBe('agent-analyzer-chunk');
    expect(agentAnalyzerCapacityAllocation(1.5, on)).toBe('agent-analyzer-chunk');
    expect(agentAnalyzerCapacityAllocation(Number.NaN, on)).toBe('agent-analyzer-chunk');
  });
});
