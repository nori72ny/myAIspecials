import type { ToolName, ToolParams, ToolResult } from './toolRegistry.js';
import { coordinateRepositoryRepair, type RepairCoordinatorState } from './repositoryRepairCoordinator.js';
import type { RepairFailure } from './repositoryRepairPolicy.js';

export type RepairProposal = { path: string; content: string };
export type VerifiedRepositoryRepairResult = {
  ok: boolean;
  attempts: number;
  repaired: boolean;
  stopReason?: string;
  verification?: ToolResult;
  lastWrite?: ToolResult;
};

const isVerificationFailure = (result: ToolResult, kind: 'test' | 'typecheck' | 'build'): RepairFailure => {
  const artifact = result.artifact ?? '';
  const timedOut = /timed.?out|timeout/i.test(artifact) || /timed.?out|timeout/i.test(result.message);
  return {
    kind,
    exitCode: timedOut ? null : 1,
    timedOut,
    stdout: artifact.slice(0, 6000),
    stderr: result.message.slice(0, 6000),
  };
};

const isSuccessfulWrite = (result: ToolResult): boolean => result.ok === true;

/** Bounded repository write -> verification -> repair loop. */
export async function runVerifiedRepositoryRepairLoop(
  initialWrite: RepairProposal,
  verificationKind: 'test' | 'typecheck' | 'build',
  repairProposals: readonly RepairProposal[],
  runTool: (name: ToolName, params: ToolParams) => Promise<ToolResult>,
): Promise<VerifiedRepositoryRepairResult> {
  let state: RepairCoordinatorState = { attempt: 0, fingerprints: [] };
  let lastWrite = await runTool('file_writer', { path: initialWrite.path, content: initialWrite.content, verificationKind });

  // Never allow a pre-existing green repository to mask a failed write.
  if (!isSuccessfulWrite(lastWrite)) {
    return {
      ok: false,
      attempts: 0,
      repaired: false,
      stopReason: 'INITIAL_WRITE_FAILED',
      lastWrite,
    };
  }

  let verification = await runTool('verification_runner', { kind: verificationKind });
  if (verification.ok) return { ok: true, attempts: 1, repaired: false, verification, lastWrite };

  for (const proposal of repairProposals) {
    const decision = coordinateRepositoryRepair(isVerificationFailure(verification, verificationKind), state);
    state = decision.state;
    if (decision.action === 'stop') {
      return { ok: false, attempts: state.attempt, repaired: state.attempt > 1, stopReason: decision.plan.decision.reason, verification, lastWrite };
    }

    lastWrite = await runTool('file_writer', { path: proposal.path, content: proposal.content, verificationKind });
    if (!isSuccessfulWrite(lastWrite)) {
      return {
        ok: false,
        attempts: state.attempt,
        repaired: state.attempt > 1,
        stopReason: 'REPAIR_WRITE_FAILED',
        verification,
        lastWrite,
      };
    }

    verification = await runTool('verification_runner', { kind: verificationKind });
    if (verification.ok) return { ok: true, attempts: state.attempt + 1, repaired: true, verification, lastWrite };
  }

  return { ok: false, attempts: state.attempt, repaired: state.attempt > 0, stopReason: 'REPAIR_PROPOSALS_EXHAUSTED', verification, lastWrite };
}
