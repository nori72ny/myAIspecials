import { describe, expect, it, vi } from 'vitest';
import { runVerification } from './verificationRunner.js';
import { verifyBeforeReportingCompletion } from './completionVerificationGate.js';

vi.mock('./verificationRunner.js', () => ({
  runVerification: vi.fn(),
}));

describe('completionVerificationGate', () => {
  it('requires typecheck, test, and build before success', async () => {
    vi.mocked(runVerification).mockResolvedValue({ ok: true, kind: 'typecheck', exitCode: 0, timedOut: false, stdout: '', stderr: '', durationMs: 1 });
    vi.mocked(runVerification)
      .mockResolvedValueOnce({ ok: true, kind: 'typecheck', exitCode: 0, timedOut: false, stdout: '', stderr: '', durationMs: 1 })
      .mockResolvedValueOnce({ ok: true, kind: 'test', exitCode: 0, timedOut: false, stdout: '', stderr: '', durationMs: 1 })
      .mockResolvedValueOnce({ ok: true, kind: 'build', exitCode: 0, timedOut: false, stdout: '', stderr: '', durationMs: 1 });

    const result = await verifyBeforeReportingCompletion('/repo');
    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.kind)).toEqual(['typecheck', 'test', 'build']);
    expect(runVerification).toHaveBeenCalledTimes(3);
  });

  it('fails closed at the first failed verification', async () => {
    vi.mocked(runVerification)
      .mockResolvedValueOnce({ ok: true, kind: 'typecheck', exitCode: 0, timedOut: false, stdout: '', stderr: '', durationMs: 1 })
      .mockResolvedValueOnce({ ok: false, kind: 'test', exitCode: 1, timedOut: false, stdout: '', stderr: 'failed', durationMs: 2 });

    const result = await verifyBeforeReportingCompletion('/repo');
    expect(result.ok).toBe(false);
    expect(result.failedKind).toBe('test');
    expect(result.checks).toHaveLength(2);
    expect(runVerification).toHaveBeenCalledTimes(2);
  });

  it('does not claim completion when verification throws', async () => {
    vi.mocked(runVerification).mockRejectedValueOnce(new Error('VERIFICATION_COMMAND_NOT_APPROVED'));

    const result = await verifyBeforeReportingCompletion('/repo');
    expect(result.ok).toBe(false);
    expect(result.failedKind).toBe('typecheck');
    expect(result.diagnosis).toContain('could not be established');
  });
});
