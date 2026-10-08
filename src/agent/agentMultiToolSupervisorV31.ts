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
  /** Real backing store must guarantee one-time atomic consumption even across replicas. */
  /** Atomically consume a single-use approval bound to this run and exact operation. */
  consumeExactApproval: (runId: string, operationDigest: string, step: AgentMultiToolStepV31) => Promise<boolean>;
  /** Must block until terminal verified tool evidence; dispatch/running is NOT success. */
  executeAndVerify: (step: AgentMultiToolStepV31, params: unknown, prior: readonly AgentMultiToolVerifiedStepV31[], context: Readonly<{ runId: string; operationDigest: string }>) => Promise<AgentMultiToolStepOutcomeV31>;
  /** A distinct trusted evidence reader must independently confirm the terminal record
   * binds to the same run, exact operation, job/result and $0 status.
   * Never trust only a tool's own claimed 'verified' flag or digest.
   */
  verifyTrustedTerminal: (runId: string, operationDigest: string, step: AgentMultiToolStepV31, outcome: AgentMultiToolStepOutcomeV31) => Promise<boolean>;
  /** Shared store / cancellation service, not merely a browser AbortController. */
  isCancelled: (runId: string) => Promise<boolean>;
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

function snapshotExactParams(params: unknown): unknown {
  // Normalize and copy the approved exact-operation arguments before approval.
  // A planner/provider must not swap a mutable parameter object after approval.
  const serialized = canonicalParams(params);
  const immutable = JSON.parse(serialized) as unknown;
  const freeze = (value: unknown): unknown => {
    if (value !== null && typeof value === 'object') {
      if (Array.isArray(value)) {
        for (const child of value) freeze(child);
      } else {
        for (const child of Object.values(value)) freeze(child);
      }
      Object.freeze(value);
    }
    return value;
  };
  return freeze(immutable);
}

function snapshotExactStep(step: AgentMultiToolStepV31): AgentMultiToolStepV31 {
  // The approved operation includes the tool identity and its dependency boundary.
  // Adapters must not be able to swap a read action for a write after approval.
  return Object.freeze({
    id: step.id,
    toolName: step.toolName,
    reasonCode: step.reasonCode,
    dependsOn: Object.freeze([...step.dependsOn]),
    approvalBoundary: step.approvalBoundary,
  });
}

async function readVerifiedCancellationState(deps: AgentMultiToolSupervisorDepsV31, runId: string): Promise<boolean> {
  const state = await deps.isCancelled(runId);
  // An unavailable/ill-formed shared cancellation receipt is NOT "not cancelled".
  if (state !== true && state !== false) throw new Error('AGENT_MULTI_TOOL_CANCEL_STATE_UNVERIFIED');
  return state;
}

function approvalBinding(runId: string, goalDigest: string, step: AgentMultiToolStepV31, params: unknown, prior: readonly AgentMultiToolVerifiedStepV31[]): string {
  return createHash('sha256')
    .update('origin.multi-tool.exact-operation.v31\0', 'utf8')
    .update(JSON.stringify({
      runId,
      goalDigest,
      stepId: step.id,
      toolName: step.toolName,
      params: canonicalParams(params),
      // Bind the complete verified predecessor operation, not just its output.
      // Different approved inputs can produce identical output digests.
      prior: prior.map(row => ({
        stepId: row.stepId,
        toolName: row.toolName,
        evidenceDigest: row.evidenceDigest,
        operationDigest: row.operationDigest,
      })),
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
  runId: string,
  goal: string,
  deps: AgentMultiToolSupervisorDepsV31,
): Promise<AgentMultiToolSupervisorResultV31> {
  if (typeof runId !== 'string' || !/^run-[A-Za-z0-9_-]{8,80}$/.test(runId))
    return finish('blocked', 'AGENT_MULTI_TOOL_RUN_INVALID', []);
  if (typeof goal !== 'string' || !goal.trim() || goal.length > 4000)
    return finish('blocked', 'AGENT_MULTI_TOOL_GOAL_INVALID', []);
  const normalizedGoal = goal.trim();
  const goalDigest = createHash('sha256').update(normalizedGoal, 'utf8').digest('hex');
  const plan = planAgentToolSequenceV31(normalizedGoal);
  if (!plan.ok || plan.version !== AGENT_MULTI_TOOL_PLAN_VERSION_V31
    || plan.bounded !== true || plan.steps.length < 1 || plan.steps.length > 3)
    return finish('blocked', 'AGENT_MULTI_TOOL_PLAN_UNSUPPORTED', []);

  const completed: AgentMultiToolVerifiedStepV31[] = [];
  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = snapshotExactStep(plan.steps[i]);
    if (step.id !== `step-${i + 1}`
      || step.approvalBoundary !== 'exact-operation'
      || step.dependsOn.length !== (i === 0 ? 0 : 1)
      || (i > 0 && step.dependsOn[0] !== completed[i - 1]?.stepId))
      return finish('blocked', 'AGENT_MULTI_TOOL_DEPENDENCY_INVALID', completed);
    try {
      if (await readVerifiedCancellationState(deps, runId)) return finish('cancelled', 'AGENT_MULTI_TOOL_CANCELLED', completed);
      const prior = Object.freeze(completed.map(row => Object.freeze({ ...row })));
      const params = snapshotExactParams(await deps.prepareParams(step, prior));
      const operationDigest = approvalBinding(runId, goalDigest, step, params, prior);
      if (await readVerifiedCancellationState(deps, runId)) return finish('cancelled', 'AGENT_MULTI_TOOL_CANCELLED', completed);
      if (await deps.consumeExactApproval(runId, operationDigest, step) !== true)
        return finish('blocked', 'AGENT_MULTI_TOOL_APPROVAL_REQUIRED', completed);
      if (await readVerifiedCancellationState(deps, runId)) return finish('cancelled', 'AGENT_MULTI_TOOL_CANCELLED', completed);
      const outcome = Object.freeze({ ...(await deps.executeAndVerify(step, params, prior, Object.freeze({ runId, operationDigest }))) });
      if (await readVerifiedCancellationState(deps, runId)) return finish('cancelled', 'AGENT_MULTI_TOOL_CANCELLED', completed);
      if (outcome?.terminal !== 'verified' || outcome.toolExecuted !== true || outcome.verified !== true
        || !SHA256.test(outcome.evidenceDigest ?? '') || /^0{64}$/.test(outcome.evidenceDigest)
        || outcome.freeOnly !== true || outcome.costUsd !== 0 || outcome.paidFallbackUsed !== false)
        return finish('blocked', 'AGENT_MULTI_TOOL_TERMINAL_NOT_VERIFIED', completed);
      if (await deps.verifyTrustedTerminal(runId, operationDigest, step, outcome) !== true)
        return finish('blocked', 'AGENT_MULTI_TOOL_TRUSTED_TERMINAL_MISSING', completed);
      if (await readVerifiedCancellationState(deps, runId)) return finish('cancelled', 'AGENT_MULTI_TOOL_CANCELLED', completed);
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
