import { runBoundedSelfHealing } from './selfHealingLoop.js';
import { assertVerificationSuccess } from './verificationPolicy.js';

export type AgentLoopDeps = {
  apply: () => Promise<void>;
  verify: () => Promise<{ ok: boolean; command: string; exitCode: number | null; stderr: string }>;
  repair: (failure: { attempt: number; error: string }) => Promise<{ changed: boolean; diagnosis: string }>;
};

export async function runAgentEditVerifyLoop(deps: AgentLoopDeps) {
  await deps.apply();
  return runBoundedSelfHealing(
    async () => {
      const result = await deps.verify();
      return result.ok && result.exitCode === 0 ? { ok: true } : { ok: false, error: result.stderr || `exit:${result.exitCode}` };
    },
    deps.repair,
    { maxAttempts: 3 },
  );
}

export function assertAgentCompletion(result: { ok: boolean }): void {
  if (!result.ok) throw new Error('AGENT_TASK_INCOMPLETE');
}
