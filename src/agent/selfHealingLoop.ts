export type RepairAttempt = { attempt: number; diagnosis: string; repaired: boolean; verificationPassed: boolean };

export type SelfHealingConfig = { maxAttempts?: number };

const MAX_ATTEMPTS = 3;

export async function runBoundedSelfHealing<T>(
  verify: () => Promise<{ ok: boolean; error?: string }>,
  repair: (failure: { attempt: number; error: string }) => Promise<{ changed: boolean; diagnosis: string }>,
  config: SelfHealingConfig = {},
): Promise<{ ok: boolean; attempts: RepairAttempt[]; finalError?: string }> {
  const maxAttempts = Math.max(1, Math.min(MAX_ATTEMPTS, config.maxAttempts ?? MAX_ATTEMPTS));
  const attempts: RepairAttempt[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const verification = await verify();
    if (verification.ok) return { ok: true, attempts };

    const error = verification.error || 'VERIFICATION_FAILED';
    const result = await repair({ attempt, error });
    attempts.push({ attempt, diagnosis: result.diagnosis, repaired: result.changed, verificationPassed: false });

    if (!result.changed) return { ok: false, attempts, finalError: error };
  }

  const finalVerification = await verify();
  if (finalVerification.ok) return { ok: true, attempts };
  return { ok: false, attempts, finalError: finalVerification.error || 'SELF_HEALING_EXHAUSTED' };
}
