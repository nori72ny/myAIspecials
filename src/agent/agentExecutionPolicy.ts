export type AgentCapability = 'read_repository' | 'write_repository' | 'run_tests' | 'grounded_research' | 'network' | 'shell' | 'read_input_data';

export type ExecutionRequest = { capability: AgentCapability; explicitIntent: boolean; securityPolicyPassed: boolean };

/**
 * `read_input_data` (file-input foundation F2, design J4) is the data
 * tools' own capability, deliberately separate from `read_repository`:
 * reading files the user handed to the agent is a different act from
 * reading the repository, and the separation keeps a future policy
 * able to stop data processing without touching repository reads.
 */
const DEFAULT_ALLOWED: readonly AgentCapability[] = ['read_repository', 'write_repository', 'run_tests', 'grounded_research', 'read_input_data'];

export function isCapabilityAllowed(request: ExecutionRequest): boolean {
  if (!request.securityPolicyPassed) return false;
  if (!request.explicitIntent && (request.capability === 'write_repository' || request.capability === 'run_tests' || request.capability === 'grounded_research')) return false;
  return DEFAULT_ALLOWED.includes(request.capability);
}

export function assertCapabilityAllowed(request: ExecutionRequest): void {
  if (!isCapabilityAllowed(request)) throw new Error('AGENT_CAPABILITY_DENIED');
}
