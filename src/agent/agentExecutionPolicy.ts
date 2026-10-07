export type AgentCapability = 'read_repository' | 'write_repository' | 'run_tests' | 'grounded_research' | 'network' | 'shell';

export type ExecutionRequest = { capability: AgentCapability; explicitIntent: boolean; securityPolicyPassed: boolean };

const DEFAULT_ALLOWED: readonly AgentCapability[] = ['read_repository', 'write_repository', 'run_tests', 'grounded_research'];

export function isCapabilityAllowed(request: ExecutionRequest): boolean {
  if (!request.securityPolicyPassed) return false;
  if (!request.explicitIntent && (request.capability === 'write_repository' || request.capability === 'run_tests' || request.capability === 'grounded_research')) return false;
  return DEFAULT_ALLOWED.includes(request.capability);
}

export function assertCapabilityAllowed(request: ExecutionRequest): void {
  if (!isCapabilityAllowed(request)) throw new Error('AGENT_CAPABILITY_DENIED');
}
