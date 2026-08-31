export type AgentOperation = 'read' | 'write' | 'execute' | 'delete' | 'production';

export type AgentRisk = 'low' | 'medium' | 'high' | 'critical';

export type AgentDecision =
  | { allowed: true; requiresApproval: boolean; risk: AgentRisk; reason: string }
  | { allowed: false; requiresApproval: true; risk: AgentRisk; reason: string };

/**
 * Central policy contract for Agentic Coding OS.
 * Read operations are autonomous; destructive and production operations are
 * never silently authorized by the agent.
 */
export function evaluateAgentOperation(operation: AgentOperation, intentExplicit: boolean): AgentDecision {
  switch (operation) {
    case 'read':
      return { allowed: true, requiresApproval: false, risk: 'low', reason: 'Read-only exploration is safe to perform autonomously.' };
    case 'write':
      return intentExplicit
        ? { allowed: true, requiresApproval: false, risk: 'medium', reason: 'User intent explicitly authorizes a non-destructive change.' }
        : { allowed: false, requiresApproval: true, risk: 'medium', reason: 'Write requires explicit user intent.' };
    case 'execute':
      return intentExplicit
        ? { allowed: true, requiresApproval: false, risk: 'medium', reason: 'Execution is allowed only after explicit intent and command safety checks.' }
        : { allowed: false, requiresApproval: true, risk: 'high', reason: 'Execution requires explicit user intent.' };
    case 'delete':
      return { allowed: false, requiresApproval: true, risk: 'high', reason: 'Destructive deletion always requires explicit confirmation.' };
    case 'production':
      return { allowed: false, requiresApproval: true, risk: 'critical', reason: 'Production changes always require explicit confirmation.' };
  }
}

export const MAX_AGENT_TASK_STEPS = 20;
export const MAX_REPAIR_ATTEMPTS = 3;
export const MAX_IDENTICAL_FAILURES = 3;

export function isRepeatedFailure(failures: readonly string[], candidate: string): boolean {
  if (!candidate) return false;
  const normalized = candidate.trim();
  return failures.slice(-MAX_IDENTICAL_FAILURES).filter((failure) => failure.trim() === normalized).length >= MAX_IDENTICAL_FAILURES - 1;
}
