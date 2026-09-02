export type VerificationResult = { ok: boolean; command: string; exitCode: number | null; stderr: string };

export function assertVerificationSuccess(result: VerificationResult): void {
  if (!result.ok || result.exitCode !== 0) throw new Error(`VERIFICATION_FAILED:${result.command}`);
}

export function shouldAttemptRepair(result: VerificationResult, attempt: number, maxAttempts = 3): boolean {
  return !result.ok && result.exitCode !== 0 && attempt < Math.min(maxAttempts, 3);
}
