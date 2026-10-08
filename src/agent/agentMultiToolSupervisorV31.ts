import { createHash } from 'node:crypto';

import {
  AGENT_MULTI_TOOL_PLAN_VERSION_V31,
  planAgentToolSequenceV31,
  type AgentMultiToolStepV31,
} from './agentMultiToolPlannerV31.js';

export type AgentMultiToolVerifiedStepV31 = {
  stepId: string;
  toolName: AgentMultiToolStepV31['toolName'];
  evidenceDigest: string;
  operationDigest: string;
};

export type AgentMultiToolStepOutcomeV31 = {
  terminal: 'verified' | 'running' | 'failed' | 'cancelled';
  toolExecuted: boolean;
  verified: boolean;
  evidenceDigest: string;
  freeOnly: boolean;
  costUsd: number;
  paidFallbackUsed: boolean;
};

export type AgentMultiToolSupervisorDepsV31 = {
  /** A trusted resolver supplies actual operation arguments, not the model's claims. */
  prepareParams: (step: AgentMultiToolStepV31, prior: readonly AgentMultiToolVerifiedStepV31[]) => Promise<unknown>;
  /** Verify a real exact-operation authorization for the computed digest, per step. */
  verifyExactApproval: (operationDigest: string, step: AgentMultiToolStepV31) => Promise<boolean>;
  /** Must block until terminal verified tool evidence; dispatch/running is NOT success. */
  executeAndVerify: (step: AgentMultiToolStepV31, params: unknown, prior: readonly AgentMultiToolVerifiedStepV31[]) => Promise<AgentMultiToolStepOutcomeV31>;
  /** Shared store / cancellation service, not merely a browser AbortController. */
  isCancelled: () => Promise<boolean>;
};

export type AgentMultiToolSupervisorResultV31 = {
  status: 'completed' | 'blocked' | 'cancelled';
  verified: boolean;
  code: string;
  completedSteps: readonly AgentMultiToolVerifiedStepV31[];
  freeOnly: true;
  costUsd: 0;
  paidFallbackUsed: false;
};

const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_PARAM_BYTES = 16 * 1024;

function canonicalParams(value: unknown): string {
  const visited = new Set<object>();
  const walk = (candidate: unknown): unknown => {
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') return candidate;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    if (!candidate || typeof candidate !== 'object') throw new Error('AGENT_MULTI_TOOL_PARAMS_INVALID');
    if (visited.has(candidate)) throw new Error('AGENT_MULTI_TOOL_PARAMS_INVALID');
    visited.add(candidate);
    if (Array.isArray(candidate)) return candidate.map(item => walk(item));
    if (Object.getPrototypeOf(candidate) !== Object.prototype && Object.getPrototypeOf(candidate) !== null)
      throw new Error('AGENT_MULTI_TOOL_PARAMS_INVALID');
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(candidate).sort()) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor')
        throw new Error('AGENT_MULTI_TOOL_PARAMS_INVALID');
      result[key] = walk((candidate as Record<string, unknown>)[key]);
    }
    return result;
  };
  const encoded = JSON.stringify(walk(value));
  if (!encoded || Buffer.byteLength(encoded, 'utf8') > MAX_PARAM_BYTES) throw new Error('AGENT_MULTI_TOOL_PARAMS_INVALID');
  return encoded;
}

function approvalBinding(step: AgentMultiToolStepV31, params: unknown, prior: readonly AgentMultiToolVerifiedStepV31[]): string {
  return createHash('sha256')
    .update('origin.multi-tool.exact-operation.v31\0', 'utf8')
    .update(JSON.stringify({
      stepId: step.id,
      toolName: step.toolName,
      params: canonicalParams(params),
      prior: prior.map(row => ({ stepId: row.stepId, evidenceDigest: row.evidenceDigest })),
    }), 'utf8')
    .digest('hex');
}

function finish(status: AgentMultiToolSupervisorResultV31['status'], code: string, completedSteps: AgentMultiToolVerifiedStepV31[]): AgentMultiToolSupervisorResultV31 {
  return { status, verified: status === 'completed', code, completedSteps, freeOnly: true, costUsd: 0, paidFallbackUsed: false };
}

/**
 * Internal-only bounded supervisor. It grants no approval, registers no HTTP
 * route, and does not have provider or filesystem authority of its own.
 * Each step is authorized and verified independently. Never call this with
 * permissive test adapters for production.
 */
export async function executeAgentMultiToolSequenceV31(
  goal: string,
  deps: AgentMultiToolSupervisorDepsV31,
): Promise<AgentMultiToolSupervisorResultV31> {
  if (typeof goal !== 'string' || !goal.trim() || goal.length > 4000)
    return finish('blocked', 'AGENT_MULTI_TOOL_GOAL_INVALID', []);
  const plan = planAgentToolSequenceV31(goal.trim());
  if (!plan.ok || plan.version !== AGENT_MULTI_TOOL_PLAN_VERSION_V31
    || plan.bounded !== true || plan.steps.length < 1 || plan.steps.length > 3)
    return finish('blocked', 'AGENT_MULTI_TOOL_PLAN_UNSUPPORTED', []);

  const completed: AgentMultiToolVerifiedStepV31[] = [];
  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i];
    if (step.id !== `step-${i + 1}`
      || step.approvalBoundary !== 'exact-operation'
      || step.dependsOn.length !== (i === 0 ? 0 : 1)
      || (i > 0 && step.dependsOn[0] !== completed[i - 1]?.stepId))
      return finish('blocked', 'AGENT_MULTI_TOOL_DEPENDENCY_INVALID', completed);
    try {
      if (await deps.isCancelled()) return finish('cancelled', 'AGENT_MULTI_TOOL_CANCELLED', completed);
      const prior = Object.freeze(completed.map(row => Object.freeze({ ...row })));
      const params = await deps.prepareParams(step, prior);
      const operationDigest = approvalBinding(step, params, prior);
      if (await deps.isCancelled()) return finish('cancelled', 'AGENT_MULTI_TOOL_CANCELLED', completed);
      if (await deps.verifyExactApproval(operationDigest, step) !== true)
        return finish('blocked', 'AGENT_MULTI_TOOL_APPROVAL_REQUIRED', completed);
      if (await deps.isCancelled()) return finish('cancelled', 'AGENT_MULTI_TOOL_CANCELLED', completed);
      const outcome = await deps.executeAndVerify(step, params, prior);
      if (await deps.isCancelled()) return finish('cancelled', 'AGENT_MULTI_TOOL_CANCELLED', completed);
      if (outcome?.terminal !== 'verified' || outcome.toolExecuted !== true || outcome.verified !== true
        || !SHA256.test(outcome.evidenceDigest ?? '') || /^0{64}$/.test(outcome.evidenceDigest)
        || outcome.freeOnly !== true || outcome.costUsd !== 0 || outcome.paidFallbackUsed !== false)
        return finish('blocked', 'AGENT_MULTI_TOOL_TERMINAL_NOT_VERIFIED', completed);
      completed.push({
        stepId: step.id,
        toolName: step.toolName,
        evidenceDigest: outcome.evidenceDigest.toLowerCase(),
        operationDigest,
      });
    } catch {
      // No provider payload, path, secret, or exception detail may leak in a result.
      return finish('blocked', 'AGENT_MULTI_TOOL_STEP_FAILED', completed);
    }
  }
  return finish('completed', 'AGENT_MULTI_TOOL_ALL_STEPS_VERIFIED', completed);
}
