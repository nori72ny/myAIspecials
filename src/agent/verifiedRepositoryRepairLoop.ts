import type { ToolName, ToolParams, ToolResult } from './toolRegistry.js';
import { coordinateRepositoryRepair, type RepairCoordinatorState } from './repositoryRepairCoordinator.js';
import type { RepairFailure } from './repositoryRepairPolicy.js';

export type RepairProposal = {
  path: string;
  content: string;
};

export type VerifiedRepositoryRepairResult = {
  ok: boolean;
  attempts: number;
  repaired: boolean;
  stopReason?: string;
  verification?: ToolResult;
  lastWrite?: ToolResult;
};

const isVerificationFailure = (result: ToolResult, kind: 'test' | 'typecheck' | 'build'): RepairFailure => ({
  kind,
  exitCode: 1,
  stdout: result.artifact?.slice(0, 6000) ?? '',
  stderr: result.message.slice(0, 6000),
});

/**
 * Bounded repository write -> verification -> repair loop.
 * The caller supplies repair proposals; this module only enforces policy and
 * re-verifies every write. It never invents patches or executes arbitrary commands.
 */
export async function runVerifiedRepositoryRepairLoop(
  initialWrite: RepairProposal,
  verificationKind: 'test' | 'typecheck' | 'build',
  repairProposals: readonly RepairProposal[],
  runTool: (name: ToolName, params: ToolParams) => Promise<ToolResult>,
): Promise<VerifiedRepositoryRepairResult> {
  let state: RepairCoordinatorState = { attempt: 0, fingerprints: [] };
  let lastWrite = await runTool('file_writer', {
    path: initialWrite.path,
    content: initialWrite.content,
    verificationKind,
  });
  let verification = await runTool('verification_runner', { kind: verificationKind });

  if (verification.ok) {
    return { ok: true, attempts: 1, repaired: false, verification, lastWrite };
  }

  for (const proposal of repairProposals) {
    const failure = isVerificationFailure(verification, verificationKind);
    const decision = coordinateRepositoryRepair(failure, state);
    state = decision.state;

    if (decision.action === 'stop') {
      return {
        ok: false,
        attempts: state.attempt,
        repaired: state.attempt > 1,
        stopReason: decision.plan.decision.reason,
        verification,
        lastWrite,
      };
    }

    lastWrite = await runTool('file_writer', {
      path: proposal.path,
      content: proposal.content,
      verificationKind,
    });
    verification = await runTool('verification_runner', { kind: verificationKind });

    if (verification.ok) {
      return { ok: true, attempts: state.attempt + 1, repaired: true, verification, lastWrite };
    }
  }

  return {
    ok: false,
    attempts: state.attempt,
    repaired: state.attempt > 0,
    stopReason: 'REPAIR_PROPOSALS_EXHAUSTED',
    verification,
    lastWrite,
  };
}
