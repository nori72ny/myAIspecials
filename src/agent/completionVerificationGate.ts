import { runVerification, type VerificationKind, type VerificationResult } from './verificationRunner.js';

export type CompletionVerificationResult = {
  ok: boolean;
  checks: VerificationResult[];
  failedKind?: VerificationKind;
  diagnosis: string;
};

/**
 * Final engineering gate: a coding operation cannot be reported complete until
 * the repository passes deterministic typecheck, lint, tests, and build in
 * that order. Any failure fails closed and prevents a success claim.
 */
export async function verifyBeforeReportingCompletion(root: string): Promise<CompletionVerificationResult> {
  const checks: VerificationResult[] = [];
  const required: VerificationKind[] = ['typecheck', 'lint', 'test', 'build'];

  for (const kind of required) {
    try {
      const result = await runVerification(root, kind);
      checks.push(result);
      if (!result.ok) {
        return { ok: false, checks, failedKind: kind, diagnosis: `Completion blocked: ${kind} verification failed (exit=${result.exitCode}, timeout=${result.timedOut}).` };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_VERIFICATION_ERROR';
      return { ok: false, checks, failedKind: kind, diagnosis: `Completion blocked: ${kind} verification could not be established (${message}).` };
    }
  }

  return { ok: true, checks, diagnosis: 'Typecheck, lint, tests, and build all passed; completion may be reported.' };
}
