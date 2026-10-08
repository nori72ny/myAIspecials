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
    expect(actions.isCancelled).toHaveBeenCalledWith('run-supervisor-1');
    expect(actions.executeAndVerify).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ id: 'step-1', toolName: 'web_search_grounding' }),
      expect.anything(),
      [],
      { runId: 'run-supervisor-1', operationDigest: result.completedSteps[0]?.operationDigest },
    );
    expect(actions.prepareParams).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ id: 'step-2' }),
      [expect.objectContaining({ stepId: 'step-1', evidenceDigest: digest('step-1') })]);
  });

  it('binds each cancellation check and verified execution attempt to its exact run', async () => {
    const actions = deps();
    const approvals = new Set<string>();
    actions.isCancelled = vi.fn(async run => {
      expect(run).toBe('run-supervisor-1');
      return false;
    });
    actions.consumeExactApproval = vi.fn(async (run, operation) => {
      expect(run).toBe('run-supervisor-1');
      approvals.add(operation);
      return true;
    });
    actions.executeAndVerify = vi.fn(async (step, _params, _prior, context) => {
      expect(Object.isFrozen(context)).toBe(true);
      expect(context.runId).toBe('run-supervisor-1');
      expect(approvals.has(context.operationDigest)).toBe(true);
      return {
        terminal: 'verified' as const, toolExecuted: true, verified: true,
        evidenceDigest: digest(step.id), freeOnly: true, costUsd: 0, paidFallbackUsed: false,
      };
    });
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result.status).toBe('completed');
    expect(actions.executeAndVerify).toHaveBeenCalledTimes(2);
    expect(actions.isCancelled).toHaveBeenCalled();
  });

  it('binds every exact approval to one run and goal so a token cannot be replayed for a different request', async () => {
    const first = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, deps());
    const second = await executeAgentMultiToolSequenceV31('run-supervisor-2', researchToDocument, deps());
    expect(first.status).toBe('completed');
    expect(second.status).toBe('completed');
    expect(first.completedSteps[0]?.operationDigest).not.toBe(second.completedSteps[0]?.operationDigest);
    expect(first.completedSteps[0]?.evidenceDigest).toBe(second.completedSteps[0]?.evidenceDigest);
  });

  it('prevents a downstream approval replay when earlier inputs change but evidence bytes match', async () => {
    const executeVariant = async (firstInput: string) => {
      const actions = deps();
      actions.prepareParams = vi.fn(async (step, prior) => ({
        action: step.toolName,
        // Same goal/run and same prior evidence; only the first approved input differs.
        input: step.id === 'step-1' ? firstInput : 'unchanged-downstream-input',
        upstreamEvidence: prior.map(row => row.evidenceDigest),
      }));
      return executeAgentMultiToolSequenceV31('run-supervisor-replay', researchToDocument, actions);
    };
    const original = await executeVariant('public-market-brief-v1');
    const changed = await executeVariant('public-market-brief-v2');
    expect(original.status).toBe('completed');
    expect(changed.status).toBe('completed');
    expect(original.completedSteps).toHaveLength(2);
    expect(changed.completedSteps).toHaveLength(2);
    expect(original.completedSteps[0]?.evidenceDigest).toBe(changed.completedSteps[0]?.evidenceDigest);
    expect(original.completedSteps[0]?.operationDigest).not.toBe(changed.completedSteps[0]?.operationDigest);
    // Approval of step 2 must not be valid for a different step 1 approval.
    expect(original.completedSteps[1]?.operationDigest).not.toBe(changed.completedSteps[1]?.operationDigest);
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
    expect(result).toMatchObject({ status: 'blocked', verified: false, code: 'AGENT_MULTI_TOOL_EXECUTION_RECONCILIATION_REQUIRED' });
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
    expect(result.status).toBe('blocked');
    expect(result.code).toBe('AGENT_MULTI_TOOL_CANCEL_DISPATCH_RECONCILIATION_REQUIRED');
    expect(result.verified).toBe(false);
    expect(result.completedSteps).toHaveLength(0);
    expect(actions.executeAndVerify).toHaveBeenCalledTimes(1);
  });

  it('allows acknowledged pre-dispatch cancellation without executing a tool', async () => {
    const actions = deps();
    actions.isCancelled = vi.fn(async () => true);
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result).toMatchObject({ status: 'cancelled', verified: false, code: 'AGENT_MULTI_TOOL_CANCELLED' });
    expect(actions.consumeExactApproval).not.toHaveBeenCalled();
    expect(actions.executeAndVerify).not.toHaveBeenCalled();
  });

  it('does not misreport cancellation after trusted terminal verification as confirmed cancellation', async () => {
    const actions = deps();
    let verifiedTerminal = false;
    actions.isCancelled = vi.fn(async () => verifiedTerminal);
    actions.verifyTrustedTerminal = vi.fn(async () => { verifiedTerminal = true; return true; });
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result).toMatchObject({
      status: 'blocked',
      code: 'AGENT_MULTI_TOOL_CANCEL_DISPATCH_RECONCILIATION_REQUIRED',
      verified: false,
    });
    expect(result.completedSteps).toHaveLength(0);
    expect(actions.executeAndVerify).toHaveBeenCalledTimes(1);
  });

  it('rejects an accessor-backed tool receipt without running its getter after dispatch', async () => {
    const actions = deps();
    const getter = vi.fn(() => { throw new Error('unsafe receipt getter'); });
    actions.executeAndVerify = vi.fn(async step => {
      const receipt = {
        terminal: 'verified' as const, toolExecuted: true, verified: true,
        evidenceDigest: digest(step.id), freeOnly: true, costUsd: 0, paidFallbackUsed: false,
      };
      Object.defineProperty(receipt, 'evidenceDigest', { enumerable: true, get: getter });
      return receipt;
    });
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result).toMatchObject({
      status: 'blocked', verified: false,
      code: 'AGENT_MULTI_TOOL_EXECUTION_RECONCILIATION_REQUIRED',
    });
    expect(getter).not.toHaveBeenCalled();
    expect(actions.verifyTrustedTerminal).not.toHaveBeenCalled();
  });

  it('rejects Proxy tool receipts without running enumeration traps', async () => {
    const actions = deps();
    const trap = vi.fn(() => { throw new Error('unsafe receipt enumeration'); });
    actions.executeAndVerify = vi.fn(async step => new Proxy({
      terminal: 'verified' as const, toolExecuted: true, verified: true,
      evidenceDigest: digest(step.id), freeOnly: true, costUsd: 0, paidFallbackUsed: false,
    }, { ownKeys: trap }));
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result).toMatchObject({
      status: 'blocked', verified: false,
      code: 'AGENT_MULTI_TOOL_EXECUTION_RECONCILIATION_REQUIRED',
    });
    expect(trap).not.toHaveBeenCalled();
    expect(actions.verifyTrustedTerminal).not.toHaveBeenCalled();
  });

  it('does not accept an unexpected tool result property as a trusted terminal receipt', async () => {
    const actions = deps();
    actions.executeAndVerify = vi.fn(async step => ({
      terminal: 'verified' as const, toolExecuted: true, verified: true,
      evidenceDigest: digest(step.id), freeOnly: true, costUsd: 0, paidFallbackUsed: false,
      unsolicited: 'provider-supplied-extra',
    }));
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result).toMatchObject({
      status: 'blocked', verified: false,
      code: 'AGENT_MULTI_TOOL_EXECUTION_RECONCILIATION_REQUIRED',
    });
    expect(actions.verifyTrustedTerminal).not.toHaveBeenCalled();
  });

  it('requires reconciliation when dispatch returns no trustworthy receipt', async () => {
    const actions = deps();
    actions.executeAndVerify = vi.fn(async () => undefined as unknown as Awaited<ReturnType<AgentMultiToolSupervisorDepsV31['executeAndVerify']>>);
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result).toMatchObject({
      status: 'blocked',
      code: 'AGENT_MULTI_TOOL_EXECUTION_RECONCILIATION_REQUIRED',
      verified: false,
    });
    expect(result.completedSteps).toHaveLength(0);
    expect(actions.verifyTrustedTerminal).not.toHaveBeenCalled();
    expect(actions.executeAndVerify).toHaveBeenCalledTimes(1);
  });

  it('rejects a proxy before invoking property enumeration traps prior to approval', async () => {
    const actions = deps();
    const ownKeysTrap = vi.fn(() => ['action']);
    actions.prepareParams = vi.fn(async () => new Proxy({ action: 'research' }, {
      ownKeys: ownKeysTrap,
    }));
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result).toMatchObject({ status: 'blocked', code: 'AGENT_MULTI_TOOL_STEP_FAILED' });
    expect(ownKeysTrap).not.toHaveBeenCalled();
    expect(actions.consumeExactApproval).not.toHaveBeenCalled();
    expect(actions.executeAndVerify).not.toHaveBeenCalled();
  });

  it('rejects accessor-backed parameters without evaluating a getter before approval', async () => {
    const actions = deps();
    const readGetter = vi.fn(() => { throw new Error('unapproved getter execution'); });
    actions.prepareParams = vi.fn(async () => {
      const params = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(params, 'action', { enumerable: true, get: readGetter });
      return params;
    });
    const result = await executeAgentMultiToolSequenceV31('run-supervisor-1', researchToDocument, actions);
    expect(result).toMatchObject({ status: 'blocked', code: 'AGENT_MULTI_TOOL_STEP_FAILED' });
    expect(readGetter).not.toHaveBeenCalled();
    expect(actions.consumeExactApproval).not.toHaveBeenCalled();
    expect(actions.executeAndVerify).not.toHaveBeenCalled();
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
    expect(result.code).toBe('AGENT_MULTI_TOOL_EXECUTION_RECONCILIATION_REQUIRED');
    expect(result.completedSteps).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain('secret provider token');

    const ambiguous = await executeAgentMultiToolSequenceV31('run-supervisor-1', 'いい感じに進めて', actions);
    expect(ambiguous).toMatchObject({ status: 'blocked', verified: false, code: 'AGENT_MULTI_TOOL_PLAN_UNSUPPORTED' });
  });
});
