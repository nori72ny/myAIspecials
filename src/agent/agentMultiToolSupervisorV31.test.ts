import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  executeAgentMultiToolSequenceV31,
  type AgentMultiToolSupervisorDepsV31,
} from './agentMultiToolSupervisorV31.js';

const researchToDocument = '最新市場を調べて、その結果から提案書を作って';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function deps(): AgentMultiToolSupervisorDepsV31 {
  return {
    isCancelled: vi.fn(async () => false),
    prepareParams: vi.fn(async (step, prior) => ({ action: step.toolName, evidence: prior.map(row => row.evidenceDigest) })),
    verifyExactApproval: vi.fn(async () => true),
    executeAndVerify: vi.fn(async step => ({
      terminal: 'verified' as const, toolExecuted: true, verified: true,
      evidenceDigest: digest(step.id), freeOnly: true, costUsd: 0, paidFallbackUsed: false,
    })),
  };
}

describe('Agent V3.1 bounded multi-tool supervisor', () => {
  it('runs a supported two-step plan only with approval and verified terminal evidence for each operation', async () => {
    const actions = deps();
    const result = await executeAgentMultiToolSequenceV31(researchToDocument, actions);
    expect(result).toMatchObject({
      status: 'completed', verified: true, code: 'AGENT_MULTI_TOOL_ALL_STEPS_VERIFIED',
      freeOnly: true, costUsd: 0, paidFallbackUsed: false,
    });
    expect(result.completedSteps.map(row => row.toolName)).toEqual(['web_search_grounding', 'document_generator']);
    expect(result.completedSteps[0]?.evidenceDigest).toBe(digest('step-1'));
    expect(result.completedSteps[0]?.operationDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.completedSteps[0]?.operationDigest).not.toBe(result.completedSteps[1]?.operationDigest);
    expect(actions.verifyExactApproval).toHaveBeenCalledTimes(2);
    expect(actions.executeAndVerify).toHaveBeenCalledTimes(2);
    expect(actions.prepareParams).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ id: 'step-2' }),
      [expect.objectContaining({ stepId: 'step-1', evidenceDigest: digest('step-1') })]);
  });

  it('never proceeds to a side-effecting second step without separate exact-operation approval', async () => {
    const actions = deps();
    let called = 0;
    actions.verifyExactApproval = vi.fn(async () => ++called === 1);
    const result = await executeAgentMultiToolSequenceV31(researchToDocument, actions);
    expect(result).toMatchObject({ status: 'blocked', verified: false, code: 'AGENT_MULTI_TOOL_APPROVAL_REQUIRED' });
    expect(result.completedSteps).toHaveLength(1);
    expect(actions.executeAndVerify).toHaveBeenCalledTimes(1);
  });

  it('does not call dispatch/running an achieved outcome or start a dependent step', async () => {
    const actions = deps();
    actions.executeAndVerify = vi.fn(async () => ({
      terminal: 'running', toolExecuted: true, verified: false,
      evidenceDigest: digest('not-terminal'), freeOnly: true, costUsd: 0, paidFallbackUsed: false,
    }));
    const result = await executeAgentMultiToolSequenceV31(researchToDocument, actions);
    expect(result).toMatchObject({ status: 'blocked', verified: false, code: 'AGENT_MULTI_TOOL_TERMINAL_NOT_VERIFIED' });
    expect(result.completedSteps).toHaveLength(0);
    expect(actions.verifyExactApproval).toHaveBeenCalledTimes(1);
    expect(actions.executeAndVerify).toHaveBeenCalledTimes(1);
  });

  it('rejects nonzero spend, paid fallback, and empty evidence even when a tool claims success', async () => {
    for (const mutation of [
      { costUsd: 0.01 },
      { paidFallbackUsed: true },
      { evidenceDigest: '0'.repeat(64) },
      { verified: false },
    ]) {
      const actions = deps();
      actions.executeAndVerify = vi.fn(async step => ({
        terminal: 'verified' as const, toolExecuted: true, verified: true,
        evidenceDigest: digest(step.id), freeOnly: true, costUsd: 0, paidFallbackUsed: false,
        ...mutation,
      }));
      const result = await executeAgentMultiToolSequenceV31(researchToDocument, actions);
      expect(result).toMatchObject({ status: 'blocked', code: 'AGENT_MULTI_TOOL_TERMINAL_NOT_VERIFIED' });
      expect(result.completedSteps).toHaveLength(0);
    }
  });

  it('keeps checked cancellation distinct from browser abort and halts before the next tool', async () => {
    const actions = deps();
    let executed = 0;
    actions.executeAndVerify = vi.fn(async step => {
      executed += 1;
      return {
        terminal: 'verified' as const, toolExecuted: true, verified: true,
        evidenceDigest: digest(step.id), freeOnly: true, costUsd: 0, paidFallbackUsed: false,
      };
    });
    actions.isCancelled = vi.fn(async () => executed > 0);
    const result = await executeAgentMultiToolSequenceV31(researchToDocument, actions);
    expect(result.status).toBe('cancelled');
    expect(result.verified).toBe(false);
    expect(result.completedSteps).toHaveLength(0);
    expect(actions.executeAndVerify).toHaveBeenCalledTimes(1);
  });

  it('fails closed for dangerous operation parameters without invoking the tool', async () => {
    const actions = deps();
    actions.prepareParams = vi.fn(async () => JSON.parse('{"__proto__":{"admin":true}}'));
    const result = await executeAgentMultiToolSequenceV31(researchToDocument, actions);
    expect(result).toMatchObject({ status: 'blocked', code: 'AGENT_MULTI_TOOL_STEP_FAILED' });
    expect(actions.verifyExactApproval).not.toHaveBeenCalled();
    expect(actions.executeAndVerify).not.toHaveBeenCalled();
  });

  it('never leaks an adapter exception or invents a tool plan for unsupported requests', async () => {
    const actions = deps();
    actions.executeAndVerify = vi.fn(async () => { throw new Error('secret provider token 123'); });
    const result = await executeAgentMultiToolSequenceV31(researchToDocument, actions);
    expect(result.status).toBe('blocked');
    expect(result.code).toBe('AGENT_MULTI_TOOL_STEP_FAILED');
    expect(JSON.stringify(result)).not.toContain('secret provider token');

    const ambiguous = await executeAgentMultiToolSequenceV31('いい感じに進めて', actions);
    expect(ambiguous).toMatchObject({ status: 'blocked', verified: false, code: 'AGENT_MULTI_TOOL_PLAN_UNSUPPORTED' });
  });
});
