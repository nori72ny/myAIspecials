import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  createCodingJobEnvelopeV14,
  hashCodingJobOwnerV14,
} from './codingJobCryptoV14.js';
import {
  dispatchCodingJobV14,
  type CodingJobDispatchReceiptV14,
} from './codingJobDispatchV14.js';
import {
  CODING_JOB_OPERATOR_OWNER_BINDING_V14,
} from './codingJobOperatorAuthV14.js';
import {
  decryptCodingJobResultV14,
  type CodingJobResultV14,
} from './codingJobResultV14.js';
import { validCodingJobExecutionEvidenceV14 } from './codingJobExecutionEvidenceV14.js';
import { codingAgentTargetKeyForRunV14, codingAgentTargetKeyMatchesRunV14, codingAgentPinnedRevisionV14 } from './codingAgentTargetKeyV14.js';
import type { PostgresCodingJobResultStoreV14 } from './codingJobResultStoreV14.js';
import type {
  CodingJobPublicRecordV14,
  PostgresCodingJobStoreV14,
} from './supabaseCodingJobStoreV14.js';

const BRIDGE_TOKEN_TTL_MS = 30 * 60 * 1000;
const MAX_TOKEN_BYTES = 2048;

type JobStore = Pick<PostgresCodingJobStoreV14, 'create' | 'getJob' | 'requestCancel'>;
type ResultStore = Pick<PostgresCodingJobResultStoreV14, 'get'>;
type Dispatch = (
  jobId: string,
  env: NodeJS.ProcessEnv,
) => Promise<CodingJobDispatchReceiptV14>;
type DecodeResult = (
  jobId: string,
  encoded: string,
  env: NodeJS.ProcessEnv,
) => CodingJobResultV14;

export type AgentCodingBridgeStartV3 = {
  ok: true;
  runId: string;
  jobId: string;
  status: 'running';
  bridgeToken: string;
  expiresAt: string;
  freeOnly: true;
  costUsd: 0;
  paidFallbackUsed: false;
};

export type AgentCodingBridgePollV3 =
  | {
      ok: true;
      runId: string;
      jobId: string;
      status: 'running';
      codingStatus: CodingJobPublicRecordV14['status'];
      verified: false;
      bridgeToken: string;
      expiresAt: string;
      resultCode: string | null;
      freeOnly: true;
      costUsd: 0;
      paidFallbackUsed: false;
    }
  | {
      ok: true;
      runId: string;
      jobId: string;
      status: 'completed';
      codingStatus: 'verified';
      verified: true;
      resultCode: string | null;
      result: CodingJobResultV14;
      freeOnly: true;
      costUsd: 0;
      paidFallbackUsed: false;
    }
  | {
      ok: false;
      runId: string;
      jobId: string;
      status: 'blocked';
      codingStatus: CodingJobPublicRecordV14['status'] | 'unavailable';
      verified: false;
      code: string;
      freeOnly: true;
      costUsd: 0;
      paidFallbackUsed: false;
    };

export type AgentCodingBridgeCancelV3 =
  | {
      ok: true;
      runId: string;
      jobId: string;
      status: 'cancelling' | 'cancelled';
      codingStatus: CodingJobPublicRecordV14['status'];
      cancelRequested: true;
      freeOnly: true;
      costUsd: 0;
      paidFallbackUsed: false;
    }
  | {
      ok: false;
      runId: string;
      jobId: string;
      status: 'blocked';
      codingStatus: CodingJobPublicRecordV14['status'] | 'unavailable';
      cancelRequested: false;
      code: string;
      freeOnly: true;
      costUsd: 0;
      paidFallbackUsed: false;
    };

type BridgePayload = {
  v: 1;
  runId: string;
  jobId: string;
  exp: number;
  /** Absolute job lifetime; rolling 30-minute polling must never extend this cap. */
  maxExp: number;
};

function approvalSecret(env: NodeJS.ProcessEnv): Buffer {
  const value = env.ORIGIN_AGENT_APPROVAL_SECRET;
  if (!value || Buffer.byteLength(value, 'utf8') < 32 || Buffer.byteLength(value, 'utf8') > 512) {
    throw new Error('AGENT_CODING_BRIDGE_NOT_CONFIGURED');
  }
  return Buffer.from(value, 'utf8');
}

function signPayload(encoded: string, env: NodeJS.ProcessEnv): string {
  return createHmac('sha256', approvalSecret(env))
    .update('origin-agent-coding-bridge-v1\0', 'utf8')
    .update(encoded, 'utf8')
    .digest('base64url');
}

function issueBridgeToken(
  runId: string,
  jobId: string,
  env: NodeJS.ProcessEnv,
  now: number,
  maxExp: number,
): { token: string; expiresAt: number } {
  if (!Number.isSafeInteger(maxExp) || maxExp <= now) throw new Error('AGENT_CODING_BRIDGE_LIFETIME_INVALID');
  const payload: BridgePayload = {
    v: 1,
    runId,
    jobId,
    exp: Math.min(now + BRIDGE_TOKEN_TTL_MS, maxExp),
    maxExp,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return {
    token: `${encoded}.${signPayload(encoded, env)}`,
    expiresAt: payload.exp,
  };
}

function verifyBridgeToken(
  token: string,
  runId: string,
  jobId: string,
  env: NodeJS.ProcessEnv,
  now: number,
): BridgePayload | null {
  if (!token || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  const expected = Buffer.from(signPayload(encoded, env), 'utf8');
  const presented = Buffer.from(signature, 'utf8');
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<BridgePayload>;
    return payload.v === 1
      && payload.runId === runId
      && payload.jobId === jobId
      && typeof payload.exp === 'number'
      && Number.isSafeInteger(payload.exp)
      && payload.exp > now
      && typeof payload.maxExp === 'number'
      && Number.isSafeInteger(payload.maxExp)
      && payload.maxExp >= payload.exp
      ? payload as BridgePayload : null;
  } catch {
    return null;
  }
}

function terminalFailureCode(record: CodingJobPublicRecordV14): string {
  if (record.status === 'cancelled') return 'AGENT_CODING_CANCELLED';
  if (record.status === 'blocked') return record.resultCode ?? 'AGENT_CODING_BLOCKED';
  if (record.status === 'failed') return record.resultCode ?? 'AGENT_CODING_FAILED';
  return 'AGENT_CODING_NOT_VERIFIED';
}

function resultIsVerified(
  result: CodingJobResultV14,
  record: CodingJobPublicRecordV14,
  env: NodeJS.ProcessEnv,
  runId: string,
): boolean {
  const checks = result?.verificationChecks;
  const requiredKinds = ['typecheck', 'lint', 'test', 'build'] as const;
  // New jobs pin the originating release revision in their immutable DB row.
  // A later deployment must not invalidate a previously verified result.
  const pinnedSha = codingAgentPinnedRevisionV14(record?.targetKey);
  const releaseSha = pinnedSha ?? (env.VERCEL_GIT_COMMIT_SHA ?? env.ORIGIN_RELEASE_SHA);
  const actualPaths = record?.changedPaths;
  const diffs = result?.diffs;
  // A Coding job does not prove a code change merely by passing checks.
  // The final encrypted result must identify the same changed paths as the
  // durable job record and must be produced by the exact released checkout.
  return result?.sessionStatus === 'verified'
    && result.freeOnly === true
    && result.costUsd === 0
    && result.gitPublished === false
    && result.deployed === false
    && (record.targetKey === 'origin:self' || codingAgentTargetKeyMatchesRunV14(runId, record.targetKey))
    && typeof releaseSha === 'string'
    && /^[0-9a-f]{40}$/i.test(releaseSha)
    && validCodingJobExecutionEvidenceV14(result.executionEvidence)
    && result.executionEvidence.sourceRevision === releaseSha.toLowerCase()
    && Number.isInteger(result.repairRounds)
    && result.repairRounds >= 0
    && Array.isArray(actualPaths)
    && actualPaths.length > 0
    && Array.isArray(diffs)
    && diffs.length === actualPaths.length
    && new Set(actualPaths).size === actualPaths.length
    && new Set(diffs.map(diff => diff?.path)).size === diffs.length
    && diffs.every(diff => actualPaths.includes(diff.path))
    && Array.isArray(checks)
    && checks.length === requiredKinds.length
    && requiredKinds.every(kind => checks.some(check =>
      check?.kind === kind
      && check.ok === true
      && check.exitCode === 0
      && check.timedOut === false
      && check.attempt === result.repairRounds));
}

/**
 * Server-internal bridge from Agent V3 to the existing durable Coding V1.4
 * execution plane.
 *
 * Dispatch is never reported as completion. Agent completion is allowed only
 * after the Coding job itself reaches verified and the encrypted result proves
 * all four checks passed on the final repair round.
 */
export class AgentCodingBridgeV3 {
  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly jobStore: JobStore,
    private readonly resultStore: ResultStore,
    private readonly dispatch: Dispatch = dispatchCodingJobV14,
    private readonly decodeResult: DecodeResult = decryptCodingJobResultV14,
  ) {}

  async start(runId: string, goal: string, now = Date.now()): Promise<AgentCodingBridgeStartV3> {
    if (typeof runId !== 'string' || !runId.startsWith('run-')) throw new Error('AGENT_CODING_RUN_ID_INVALID');
    const envelope = createCodingJobEnvelopeV14({
      ownerBinding: CODING_JOB_OPERATOR_OWNER_BINDING_V14,
      targetKey: codingAgentTargetKeyForRunV14(runId, this.env.VERCEL_GIT_COMMIT_SHA ?? this.env.ORIGIN_RELEASE_SHA),
      goal,
    }, this.env, now);
    const created = await this.jobStore.create(envelope, now);
    if (!created) throw new Error('AGENT_CODING_CREATE_CONFLICT');

    try {
      await this.dispatch(created.jobId, this.env);
    } catch (error) {
      const ownerHash = hashCodingJobOwnerV14(CODING_JOB_OPERATOR_OWNER_BINDING_V14, this.env);
      await this.jobStore.requestCancel(created.jobId, ownerHash).catch(() => undefined);
      throw error;
    }

    // The Coding envelope lives for up to 24 hours. Keep bearer capabilities
    // short-lived and renewable only while a valid run-bound token is presented.
    const capability = issueBridgeToken(runId, created.jobId, this.env, now, envelope.expiresAt);
    return {
      ok: true,
      runId,
      jobId: created.jobId,
      status: 'running',
      bridgeToken: capability.token,
      expiresAt: new Date(capability.expiresAt).toISOString(),
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
    };
  }

  /**
   * Operator-authenticated read-only recovery after browser restart or bearer
   * expiration. The immutable target_key proves the original run/job binding;
   * mere knowledge of a random job ID is never sufficient authorization.
   *
   * Never dispatches, creates, cancels, or resets the durable job.
   */
  async recover(runId: string, jobId: string, now = Date.now()): Promise<AgentCodingBridgeStartV3 | {
    ok: false;
    runId: string;
    jobId: string;
    status: 'blocked';
    code: string;
    freeOnly: true;
    costUsd: 0;
    paidFallbackUsed: false;
  }> {
    try {
      codingAgentTargetKeyForRunV14(runId);
    } catch {
      return { ok: false, runId, jobId, status: 'blocked', code: 'AGENT_CODING_RECOVERY_INVALID',
        freeOnly: true, costUsd: 0, paidFallbackUsed: false };
    }
    const ownerHash = hashCodingJobOwnerV14(CODING_JOB_OPERATOR_OWNER_BINDING_V14, this.env);
    const record = await this.jobStore.getJob(jobId, ownerHash);
    if (!record || record.jobId !== jobId || !codingAgentTargetKeyMatchesRunV14(runId, record.targetKey) || !Number.isSafeInteger(record.expiresAt)
      || record.expiresAt <= now || record.expiresAt > now + 7 * 24 * 60 * 60_000) {
      return { ok: false, runId, jobId, status: 'blocked', code: 'AGENT_CODING_RECOVERY_UNAVAILABLE',
        freeOnly: true, costUsd: 0, paidFallbackUsed: false };
    }
    const token = issueBridgeToken(runId, jobId, this.env, now, record.expiresAt);
    return { ok: true, runId, jobId, status: 'running', bridgeToken: token.token,
      expiresAt: new Date(token.expiresAt).toISOString(),
      freeOnly: true, costUsd: 0, paidFallbackUsed: false };
  }

  async cancel(
    runId: string,
    jobId: string,
    bridgeToken: string,
    now = Date.now(),
  ): Promise<AgentCodingBridgeCancelV3> {
    if (!verifyBridgeToken(bridgeToken, runId, jobId, this.env, now)) {
      return {
        ok: false,
        runId,
        jobId,
        status: 'blocked',
        codingStatus: 'unavailable',
        cancelRequested: false,
        code: 'AGENT_CODING_BRIDGE_TOKEN_INVALID',
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      };
    }

    const ownerHash = hashCodingJobOwnerV14(CODING_JOB_OPERATOR_OWNER_BINDING_V14, this.env);
    const current = await this.jobStore.getJob(jobId, ownerHash);
    if (!current) {
      return {
        ok: false,
        runId,
        jobId,
        status: 'blocked',
        codingStatus: 'unavailable',
        cancelRequested: false,
        code: 'AGENT_CODING_JOB_NOT_FOUND',
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      };
    }
    if (current.status === 'cancelled') {
      return {
        ok: true,
        runId,
        jobId,
        status: 'cancelled',
        codingStatus: 'cancelled',
        cancelRequested: true,
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      };
    }
    if (current.status === 'verified' || current.status === 'blocked' || current.status === 'failed') {
      return {
        ok: false,
        runId,
        jobId,
        status: 'blocked',
        codingStatus: current.status,
        cancelRequested: false,
        code: 'AGENT_CODING_ALREADY_TERMINAL',
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      };
    }

    const cancelled = await this.jobStore.requestCancel(jobId, ownerHash);
    if (!cancelled || cancelled.cancelRequested !== true) {
      return {
        ok: false,
        runId,
        jobId,
        status: 'blocked',
        codingStatus: cancelled?.status ?? 'unavailable',
        cancelRequested: false,
        code: 'AGENT_CODING_CANCEL_FAILED',
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      };
    }
    return {
      ok: true,
      runId,
      jobId,
      status: cancelled.status === 'cancelled' ? 'cancelled' : 'cancelling',
      codingStatus: cancelled.status,
      cancelRequested: true,
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
    };
  }

  async poll(
    runId: string,
    jobId: string,
    bridgeToken: string,
    now = Date.now(),
  ): Promise<AgentCodingBridgePollV3> {
    const bridgeAuth = verifyBridgeToken(bridgeToken, runId, jobId, this.env, now);
    if (!bridgeAuth) {
      return {
        ok: false,
        runId,
        jobId,
        status: 'blocked',
        codingStatus: 'unavailable',
        verified: false,
        code: 'AGENT_CODING_BRIDGE_TOKEN_INVALID',
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      };
    }

    const ownerHash = hashCodingJobOwnerV14(CODING_JOB_OPERATOR_OWNER_BINDING_V14, this.env);
    const record = await this.jobStore.getJob(jobId, ownerHash);
    if (!record) {
      return {
        ok: false,
        runId,
        jobId,
        status: 'blocked',
        codingStatus: 'unavailable',
        verified: false,
        code: 'AGENT_CODING_JOB_NOT_FOUND',
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      };
    }

    if (record.status === 'verified') {
      const encoded = await this.resultStore.get(jobId);
      if (!encoded) {
        return {
          ok: false,
          runId,
          jobId,
          status: 'blocked',
          codingStatus: 'verified',
          verified: false,
          code: 'AGENT_CODING_RESULT_UNAVAILABLE',
          freeOnly: true,
          costUsd: 0,
          paidFallbackUsed: false,
        };
      }
      let result: CodingJobResultV14;
      try {
        result = this.decodeResult(jobId, encoded, this.env);
      } catch {
        return {
          ok: false,
          runId,
          jobId,
          status: 'blocked',
          codingStatus: 'verified',
          verified: false,
          code: 'AGENT_CODING_RESULT_INVALID',
          freeOnly: true,
          costUsd: 0,
          paidFallbackUsed: false,
        };
      }
      if (!resultIsVerified(result, record, this.env, runId)) {
        return {
          ok: false,
          runId,
          jobId,
          status: 'blocked',
          codingStatus: 'verified',
          verified: false,
          code: 'AGENT_CODING_VERIFICATION_INCOMPLETE',
          freeOnly: true,
          costUsd: 0,
          paidFallbackUsed: false,
        };
      }
      return {
        ok: true,
        runId,
        jobId,
        status: 'completed',
        codingStatus: 'verified',
        verified: true,
        resultCode: record.resultCode,
        result,
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      };
    }

    if (record.status === 'blocked' || record.status === 'failed' || record.status === 'cancelled') {
      return {
        ok: false,
        runId,
        jobId,
        status: 'blocked',
        codingStatus: record.status,
        verified: false,
        code: terminalFailureCode(record),
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      };
    }

    // Rotate the capability on an authenticated nonterminal read only. Bound
    // its absolute lifetime to the original encrypted Coding job envelope.
    const renewed = issueBridgeToken(runId, jobId, this.env, now, bridgeAuth.maxExp);
    return {
      ok: true,
      runId,
      jobId,
      status: 'running',
      codingStatus: record.status,
      verified: false,
      bridgeToken: renewed.token,
      expiresAt: new Date(renewed.expiresAt).toISOString(),
      resultCode: record.resultCode,
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
    };
  }
}
