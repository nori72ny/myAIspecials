export const AGENT_SECURITY_POLICY = Object.freeze({
  maxRepairAttempts: 3,
  maxCheckpointCount: 20,
  maxCheckpointSummaryChars: 4000,
  maxToolOutputBytes: 64 * 1024,
  allowArbitraryShell: false,
  allowNetworkFromSandbox: false,
  allowProtectedPathWrites: false,
  requireVerificationBeforeCompletion: true,
});

export function assertSafeAgentPolicy(): void {
  if (AGENT_SECURITY_POLICY.allowArbitraryShell) throw new Error('UNSAFE_POLICY_ARBITRARY_SHELL');
  if (AGENT_SECURITY_POLICY.allowNetworkFromSandbox) throw new Error('UNSAFE_POLICY_NETWORK');
  if (AGENT_SECURITY_POLICY.allowProtectedPathWrites) throw new Error('UNSAFE_POLICY_PROTECTED_WRITE');
  if (!AGENT_SECURITY_POLICY.requireVerificationBeforeCompletion) throw new Error('UNSAFE_POLICY_NO_VERIFICATION');
}
