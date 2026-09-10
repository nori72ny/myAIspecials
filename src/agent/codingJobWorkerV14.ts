import { decryptCodingJobPayloadV14 } from './codingJobCryptoV14.js';
import { createCodingNavigatorV14 } from './codingNavigatorV14.js';
import { createCodingPlannerV14 } from './codingPlannerV14.js';
import { runCodingSessionV14, type CodingCheck, type CodingSessionRequest, type CodingSessionResult } from './codingSessionV14.js';
import { encryptCodingJobResultV14, type CodingJobResultV14 } from './codingJobResultV14.js';
import type { PostgresCodingJobResultStoreV14 } from './codingJobResultStoreV14.js';
import type { OriginProviderExecutionRequest, OriginProviderExecutionResult } from '../legacy/originProviderClient.js';
import type { CodingJobCompletionStatusV14, CodingJobLeaseV14, CodingJobPublicRecordV14, PostgresCodingJobStoreV14 } from './supabaseCodingJobStoreV14.js';

const DEFAULT_WORKER_LEASE_SECONDS = 120;

type WorkerStoreV14 = Pick<PostgresCodingJobStoreV14,
  'recoverStaleJob' | 'claimJob' | 'startJob' | 'markRepairing' | 'renewLease' |
  'cancellationRequested' | 'acknowledgeCancel' | 'completeJob'>;
type WorkerResultStoreV14 = Pick<PostgresCodingJobResultStoreV14, 'put' | 'delete'>;

export type CodingJobResolvedTargetV14 = {
  root: string;
  allowedPaths?: string[];
  contextPaths?: string[];
  creatablePaths?: string[];
  maxRepairs?: number;
  trustedWorkspaceApproved: true;
};

export type CodingJobWorkerCheckpointV14 = () => Promise<void>;
export type CodingJobWorkerDependenciesV14 = {
  store: WorkerStoreV14;
  /** Server-owned allowlist resolver. Never interpret targetKey as a filesystem path. */
  resolveTarget: (targetKey: string) => Promise<CodingJobResolvedTargetV14>;
  /** Executes repository code only inside the dedicated isolated verification sandbox. Call checkpoint between long-running checks. */
  verify: (root: string, checkpoint?: CodingJobWorkerCheckpointV14) => Promise<CodingCheck[]>;
  /** Optional in unit-level integrations. Production workers provide both resultStore and captureResult. */
  resultStore?: WorkerResultStoreV14;
  /** Trusted host-side projection. It may read the workspace but must never execute repository code. */
  captureResult?: (session: CodingSessionResult, workspaceRoot: string) => Promise<CodingJobResultV14>;
  env?: NodeJS.ProcessEnv;
  execute?: (request: OriginProviderExecutionRequest, env: NodeJS.ProcessEnv) => Promise<OriginProviderExecutionResult>;
  leaseSeconds?: number;
};

export type CodingJobWorkerOutcomeV14 = {
  jobId: string;
  state: 'not_claimed' | 'verified' | 'blocked' | 'failed' | 'cancelled' | 'lease_lost' | 'retryable';
  code: string;
};

type AbortKind = 'cancelled' | 'lease_lost';
class WorkerAbort extends Error {}

function terminalOutcome(jobId: string, record: CodingJobPublicRecordV14): CodingJobWorkerOutcomeV14 | null {
  if (record.status === 'cancelled') return { jobId, state: 'cancelled', code: record.resultCode ?? 'CODING_CANCELLED_BY_USER' };
  if (record.status === 'failed') return { jobId, state: 'failed', code: record.resultCode ?? 'CODING_WORKER_RETRY_EXHAUSTED' };
  if (record.status === 'blocked') return { jobId, state: 'blocked', code: record.resultCode ?? 'CODING_OPERATION_BLOCKED' };
  if (record.status === 'verified') return { jobId, state: 'verified', code: record.resultCode ?? 'CODING_CHECKS_PASSED' };
  return null;
}

function completionStatus(status: Awaited<ReturnType<typeof runCodingSessionV14>>['status']): CodingJobCompletionStatusV14 {
  if (status === 'verified') return 'verified';
  if (status === 'repair_limit') return 'failed';
  return 'blocked';
}

/** Trusted hosted-worker controller. Provider/database/key material remains outside the verification sandbox. */
export async function runCodingJobWorkerV14(jobId: string, workerId: string, deps: CodingJobWorkerDependenciesV14): Promise<CodingJobWorkerOutcomeV14> {
  const leaseSeconds = deps.leaseSeconds ?? DEFAULT_WORKER_LEASE_SECONDS;
  const recovered = await deps.store.recoverStaleJob(jobId);
  if (recovered) {
    const terminal = terminalOutcome(jobId, recovered);
    if (terminal) return terminal;
  }

  const lease = await deps.store.claimJob(jobId, workerId, leaseSeconds);
  if (!lease) return { jobId, state: 'not_claimed', code: 'CODING_JOB_NOT_CLAIMED' };

  let abortKind: AbortKind | null = null;
  const eraseResultAfterCancellation = async (): Promise<void> => {
    if (!deps.resultStore) return;
    // The result is already AES-GCM encrypted and owner-gated. Cancellation erasure
    // is still attempted immediately; DB expiry/FK cleanup remains the fallback if
    // the result store is temporarily unavailable during this terminal transition.
    await deps.resultStore.delete(jobId).catch(() => undefined);
  };
  const cancelledOrLost = async (): Promise<CodingJobWorkerOutcomeV14> => {
    const acknowledged = await deps.store.acknowledgeCancel(jobId, workerId);
    if (acknowledged) {
      await eraseResultAfterCancellation();
      return { jobId, state: 'cancelled', code: 'CODING_CANCELLED_BY_USER' };
    }
    return { jobId, state: 'lease_lost', code: 'CODING_JOB_LEASE_LOST' };
  };
  const heartbeat = async (): Promise<void> => {
    if (await deps.store.cancellationRequested(jobId, workerId)) {
      abortKind = 'cancelled';
      throw new WorkerAbort('cancelled');
    }
    const renewed = await deps.store.renewLease(jobId, workerId, leaseSeconds);
    if (!renewed) {
      abortKind = await deps.store.cancellationRequested(jobId, workerId) ? 'cancelled' : 'lease_lost';
      throw new WorkerAbort(abortKind === 'cancelled' ? 'cancelled' : 'lease lost');
    }
  };

  try {
    if (await deps.store.cancellationRequested(jobId, workerId)) return cancelledOrLost();
    const started = await deps.store.startJob(jobId, workerId);
    if (!started) {
      if (await deps.store.cancellationRequested(jobId, workerId)) return cancelledOrLost();
      return { jobId, state: 'lease_lost', code: 'CODING_JOB_LEASE_LOST' };
    }

    let payload: ReturnType<typeof decryptCodingJobPayloadV14>;
    let target: CodingJobResolvedTargetV14;
    try {
      target = await deps.resolveTarget(lease.targetKey);
      payload = decryptCodingJobPayloadV14(lease.jobId, lease.payloadCiphertext, deps.env);
    } catch {
      return { jobId, state: 'retryable', code: 'CODING_WORKER_PRIVATE_STAGE_BLOCKED' };
    }

    const modelOptions = { env: deps.env, execute: deps.execute };
    const navigator = createCodingNavigatorV14(target.root, modelOptions);
    const planner = createCodingPlannerV14(modelOptions);
    const request: CodingSessionRequest = {
      root: target.root,
      goal: payload.goal,
      allowedPaths: target.allowedPaths,
      contextPaths: target.contextPaths,
      creatablePaths: target.creatablePaths,
      maxRepairs: target.maxRepairs,
      trustedWorkspaceApproved: target.trustedWorkspaceApproved,
    };

    const session = await runCodingSessionV14(request, {
      discover: async context => {
        await heartbeat();
        return navigator(context);
      },
      propose: async context => {
        await heartbeat();
        if (context.attempt > 0) {
          const moved = await deps.store.markRepairing(jobId, workerId);
          if (!moved) {
            abortKind = await deps.store.cancellationRequested(jobId, workerId) ? 'cancelled' : 'lease_lost';
            throw new WorkerAbort('worker state changed');
          }
        }
        return planner(context);
      },
      verify: async root => {
        await heartbeat();
        const checks = await deps.verify(root, heartbeat);
        await heartbeat();
        return checks;
      },
    });

    if (abortKind === 'cancelled') return cancelledOrLost();
    if (abortKind === 'lease_lost') return { jobId, state: 'lease_lost', code: 'CODING_JOB_LEASE_LOST' };
    try { await heartbeat(); }
    catch (error) { if (!(error instanceof WorkerAbort)) throw error; }
    if (abortKind === 'cancelled') return cancelledOrLost();
    if (abortKind === 'lease_lost') return { jobId, state: 'lease_lost', code: 'CODING_JOB_LEASE_LOST' };

    if (Boolean(deps.resultStore) !== Boolean(deps.captureResult)) {
      return { jobId, state: 'retryable', code: 'CODING_RESULT_PIPELINE_NOT_CONFIGURED' };
    }
    if (deps.resultStore && deps.captureResult) {
      try {
        const resultPayload = await deps.captureResult(session, target.root);
        await heartbeat();
        const resultCiphertext = encryptCodingJobResultV14(jobId, resultPayload, deps.env);
        if (!await deps.resultStore.put(jobId, resultCiphertext)) throw new Error('CODING_RESULT_PERSISTENCE_FAILED');
        await heartbeat();
      } catch (error) {
        if (error instanceof WorkerAbort) throw error;
        return { jobId, state: 'retryable', code: 'CODING_RESULT_PERSISTENCE_FAILED' };
      }
    }

    const finalStatus = completionStatus(session.status);
    const completed = await deps.store.completeJob(jobId, workerId, finalStatus, session.code, session.changedPaths);
    if (!completed) {
      if (await deps.store.cancellationRequested(jobId, workerId)) return cancelledOrLost();
      return { jobId, state: 'lease_lost', code: 'CODING_JOB_LEASE_LOST' };
    }
    return { jobId, state: finalStatus, code: session.code };
  } catch (error) {
    if (error instanceof WorkerAbort) {
      if (abortKind === 'cancelled') return cancelledOrLost();
      return { jobId, state: 'lease_lost', code: 'CODING_JOB_LEASE_LOST' };
    }
    return { jobId, state: 'retryable', code: 'CODING_WORKER_STAGE_FAILED' };
  }
}

export type { CodingJobLeaseV14 };
