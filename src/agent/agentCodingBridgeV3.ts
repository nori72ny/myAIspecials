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
import type { PostgresCodingJobResultStoreV14 } from './codingJobResultStoreV14.js';
import type {
  CodingJobPublicRecordV14,
  PostgresCodingJobStoreV14,
} from './supabaseCodingJobStoreV14.js';

const FIXED_TARGET_KEY = 'origin:self';
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

type BridgePayload = {
  v: 1;
  runId: string;
  jobId: string;
  exp: number;
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
): { token: string; expiresAt: number } {
  const payload: BridgePayload = {
    v: 1,
    runId,
    jobId,
    exp: now + BRIDGE_TOKEN_TTL_MS,
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
): boolean {
  if (!token || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [encoded, signature] = parts;
  const expected = Buffer.from(signPayload(encoded, env), 'utf8');
  const presented = Buffer.from(signature, 'utf8');
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<BridgePayload>;
    return payload.v === 1
      && payload.runId === runId
      && payload.jobId === jobId
      && typeof payload.exp === 'number'
      && Number.isFinite(payload.exp)
      && payload.exp > now;
  } catch {
    return false;
  }
}

function terminalFailureCode(record: CodingJobPublicRecordV14): string {
  if (record.status === 'cancelled') return 'AGENT_CODING_CANCELLED';
  if (record.status === 'blocked') return record.resultCode ?? 'AGENT_CODING_BLOCKED';
  if (record.status === 'failed') return record.resultCode ?? 'AGENT_CODING_FAILED';
  return 'AGENT_CODING_NOT_VERIFIED';
}

function resultIsVerified(result: CodingJobResultV14): boolean {
  return result.sessionStatus === 'verified'
    && result.freeOnly === true
    && result.costUsd === 0
    && result.gitPublished === false
    && result.deployed === false
    && result.verificationChecks.length === 4
    && result.verificationChecks.every(check =>
      check.ok === true
      && check.exitCode === 0
      && check.timedOut === false
      && check.attempt === result.repairRounds);
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
      targetKey: FIXED_TARGET_KEY,
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

    const capability = issueBridgeToken(runId, created.jobId, this.env, now);
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

  async poll(
    runId: string,
    jobId: string,
    bridgeToken: string,
    now = Date.now(),
  ): Promise<AgentCodingBridgePollV3> {
    if (!verifyBridgeToken(bridgeToken, runId, jobId, this.env, now)) {
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
      if (!resultIsVerified(result)) {
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

    return {
      ok: true,
      runId,
      jobId,
      status: 'running',
      codingStatus: record.status,
      verified: false,
      resultCode: record.resultCode,
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
    };
  }
}
