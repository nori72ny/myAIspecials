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
    consumeExactApproval: vi.fn(async () => true),
    verifyTrustedTerminal: vi.fn(async () => true),
    executeAndVerify: vi.fn(async step => ({
      terminal: 'verified' as const, toolExecuted: true, verified: true,
      evidenceDigest: digest(step.id), freeOnly: true, costUsd: 0, paidFallbackUsed: false,
    })),
  };
}

describe('Agent V3.1 bounded multi-tool supervisor', () => {
  it('runs a supported two-step plan only with approval and verified terminal evidence for each operation', async () => {
    const actions = deps();
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result).toMatchObject({
      status: 'completed', verified: true, code: 'AGENT_MULTI_TOOL_ALL_STEPS_VERIFIED',
      freeOnly: true, costUsd: 0, paidFallbackUsed: false,
    });
    expect(result.completedSteps.map(row => row.toolName)).toEqual(['web_search_grounding', 'document_generator']);
    expect(result.completedSteps[0]?.evidenceDigest).toBe(digest('step-1'));
    expect(result.completedSteps[0]?.operationDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.completedSteps[0]?.operationDigest).not.toBe(result.completedSteps[1]?.operationDigest);
    expect(actions.consumeExactApproval).toHaveBeenCalledTimes(2);
    expect(actions.executeAndVerify).toHaveBeenCalledTimes(2);
    expect(actions.prepareParams).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ id: 'step-2' }),
      [expect.objectContaining({ stepId: 'step-1', evidenceDigest: digest('step-1') })]);
  });

  it('binds every exact approval to one run and goal so a token cannot be replayed for a different request', async () => {
    const first = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, deps());
    const second = await executeAgentMultiToolSequenceV31('run-supervisor-2', researchToDocument, deps());
    expect(first.status).toBe('completed');
    expect(second.status).toBe('completed');
    expect(first.completedSteps[0]?.operationDigest).not.toBe(second.completedSteps[0]?.operationDigest);
    expect(first.completedSteps[0]?.evidenceDigest).toBe(second.completedSteps[0]?.evidenceDigest);
  });

  it('rejects a run without an independently scoped run identifier before any operation', async () => {
    const actions = deps();
    const result = await executeAgentMultiToolSequenceV31('', researchToDocument, actions);
    expect(result).toMatchObject({ status: 'blocked', code: 'AGENT_MULTI_TOOL_RUN_INVALID' });
    expect(actions.prepareParams).not.toHaveBeenCalled();
    expect(actions.executeAndVerify).not.toHaveBeenCalled();
  });

  it('never proceeds to a side-effecting second step without separate exact-operation approval', async () => {
    const actions = deps();
    let called = 0;
    actions.consumeExactApproval = vi.fn(async () => ++called === 1);
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result).toMatchObject({ status: 'blocked', verified: false, code: 'AGENT_MULTI_TOOL_APPROVAL_REQUIRED' });
    expect(result.completedSteps).toHaveLength(1);
    expect(actions.executeAndVerify).toHaveBeenCalledTimes(1);
  });

  it('does not call dispatch/running an achieved outcome or start a dependent step', async () => {
    const actions = deps();
    actions.executeAndVerify = vi.fn(async () => ({
      terminal: 'running' as const, toolExecuted: true, verified: false,
      evidenceDigest: digest('not-terminal'), freeOnly: true, costUsd: 0, paidFallbackUsed: false,
    }));
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result).toMatchObject({ status: 'blocked', verified: false, code: 'AGENT_MULTI_TOOL_TERMINAL_NOT_VERIFIED' });
    expect(result.completedSteps).toHaveLength(0);
    expect(actions.consumeExactApproval).toHaveBeenCalledTimes(1);
    expect(actions.executeAndVerify).toHaveBeenCalledTimes(1);
  });

  it('requires one-time use of each exact operation approval', async () => {
    const actions = deps();
    const seen = new Set<string>();
    actions.consumeExactApproval = vi.fn(async (_runId, operation) => {
      if (seen.has(operation)) return false;
      seen.add(operation);
      return true;
    });
    const first = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    const second = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(first.status).toBe('completed');
    expect(second.code).toBe('AGENT_MULTI_TOOL_APPROVAL_REQUIRED');
    expect(second.completedSteps).toHaveLength(0);
    expect(actions.executeAndVerify).toHaveBeenCalledTimes(2);
  });

  it('passes only immutable cloned parameters to a tool after their approval is consumed', async () => {
    const actions = deps();
    let shared = { action: 'original', details: { content: 'approved' } };
    actions.prepareParams = vi.fn(async () => {
      shared = { action: 'original', details: { content: 'approved' } };
      return shared;
    });
    actions.consumeExactApproval = vi.fn(async () => {
      shared.action = 'changed-after-approval';
      shared.details.content = 'not-approved';
      return true;
    });
    actions.executeAndVerify = vi.fn(async (step, params) => {
      expect(params).toMatchObject({ action: 'original', details: { content: 'approved' } });
      expect(Object.isFrozen(params)).toBe(true);
      expect(Object.isFrozen((params as { details: object }).details)).toBe(true);
      return {
        terminal: 'verified' as const, toolExecuted: true, verified: true,
        evidenceDigest: digest(step.id), freeOnly: true, costUsd: 0, paidFallbackUsed: false,
      };
    });
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result.status).toBe('completed');
    expect(actions.executeAndVerify).toHaveBeenCalledTimes(2);
  });

  it('prevents an approval adapter from mutating the approved tool or its dependencies', async () => {
    const actions = deps();
    actions.consumeExactApproval = vi.fn(async (_runId, _operationDigest, step) => {
      expect(Object.isFrozen(step)).toBe(true);
      expect(Object.isFrozen(step.dependsOn)).toBe(true);
      if (step.id === 'step-1') {
        expect(Reflect.set(step, 'toolName', 'file_writer')).toBe(false);
        expect(Reflect.set(step.dependsOn, '0', 'forged-step')).toBe(false);
        expect(step.toolName).toBe('web_search_grounding');
      }
      return true;
    });
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result.status).toBe('completed');
    expect(result.completedSteps.map(row => row.toolName)).toEqual(['web_search_grounding', 'document_generator']);
  });

  it('fails closed when the shared cancellation service returns an unknown state', async () => {
    const actions = deps();
    actions.isCancelled = vi.fn(async () => undefined as unknown as boolean);
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result).toMatchObject({ status: 'blocked', verified: false, code: 'AGENT_MULTI_TOOL_STEP_FAILED' });
    expect(actions.consumeExactApproval).not.toHaveBeenCalled();
    expect(actions.executeAndVerify).not.toHaveBeenCalled();
  });

  it('does not allow a terminal verifier to rewrite the already checked evidence digest', async () => {
    const actions = deps();
    actions.verifyTrustedTerminal = vi.fn(async (_runId, _operationDigest, _step, outcome) => {
      expect(Object.isFrozen(outcome)).toBe(true);
      expect(Reflect.set(outcome, 'evidenceDigest', 'f'.repeat(64))).toBe(false);
      return true;
    });
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result.status).toBe('completed');
    expect(result.completedSteps[0]?.evidenceDigest).toBe(digest('step-1'));
    expect(actions.verifyTrustedTerminal).toHaveBeenCalledTimes(2);
  });

  it('requires independent confirmation of a tool terminal receipt', async () => {
    const actions = deps();
    actions.verifyTrustedTerminal = vi.fn(async () => false);
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result.status).toBe('blocked');
    expect(result.code).toBe('AGENT_MULTI_TOOL_TRUSTED_TERMINAL_MISSING');
    expect(result.completedSteps).toHaveLength(0);
    expect(actions.executeAndVerify).toHaveBeenCalledTimes(1);
    expect(actions.verifyTrustedTerminal).toHaveBeenCalledTimes(1);
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
      const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
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
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result.status).toBe('cancelled');
    expect(result.verified).toBe(false);
    expect(result.completedSteps).toHaveLength(0);
    expect(actions.executeAndVerify).toHaveBeenCalledTimes(1);
  });

  it('fails closed for dangerous operation parameters without invoking the tool', async () => {
    const actions = deps();
    actions.prepareParams = vi.fn(async () => JSON.parse('{"__proto__":{"admin":true}}'));
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result).toMatchObject({ status: 'blocked', code: 'AGENT_MULTI_TOOL_STEP_FAILED' });
    expect(actions.consumeExactApproval).not.toHaveBeenCalled();
    expect(actions.executeAndVerify).not.toHaveBeenCalled();
  });

  it('never leaks an adapter exception or invents a tool plan for unsupported requests', async () => {
    const actions = deps();
    actions.executeAndVerify = vi.fn(async () => { throw new Error('secret provider token 123'); });
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result.status).toBe('blocked');
    expect(result.code).toBe('AGENT_MULTI_TOOL_STEP_FAILED');
    expect(JSON.stringify(result)).not.toContain('secret provider token');

    const ambiguous = await executeAgentMultiToolSequenceV31('run-supervisor-1', 'いい感じに進めて', actions);
    expect(ambiguous).toMatchObject({ status: 'blocked', verified: false, code: 'AGENT_MULTI_TOOL_PLAN_UNSUPPORTED' });
  });
});
