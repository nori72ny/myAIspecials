import { Router, type Request, type Response } from 'express';
import {
  CODING_JOB_ID_PATTERN,
  codingJobCryptoConfiguredV14,
  codingJobDataKeyConfiguredV14,
  codingJobOwnerHashConfiguredV14,
  createCodingJobEnvelopeV14,
  hashCodingJobOwnerV14,
} from './codingJobCryptoV14.js';
import {
  codingJobDispatchConfiguredV14,
  dispatchCodingJobV14,
  type CodingJobDispatchReceiptV14,
} from './codingJobDispatchV14.js';
import {
  authenticateCodingJobOperatorV14,
  CODING_JOB_OPERATOR_OWNER_BINDING_V14,
  codingJobAuthorizationModeV14,
  codingJobOperatorConfiguredV14,
} from './codingJobOperatorAuthV14.js';
import { decryptCodingJobResultV14, type CodingJobResultV14 } from './codingJobResultV14.js';
import type { PostgresCodingJobResultStoreV14 } from './codingJobResultStoreV14.js';
import type { CodingJobPublicRecordV14, PostgresCodingJobStoreV14 } from './supabaseCodingJobStoreV14.js';

const FIXED_TARGET_KEY = 'origin:self';
const DEFAULT_TTL_MINUTES = 24 * 60;
const MAX_TTL_MINUTES = 7 * 24 * 60;
const WORKER_ENABLED_ENV = 'ORIGIN_CODING_WORKER_ENABLED';

type CodingJobApiStoreV14 = Pick<PostgresCodingJobStoreV14, 'create' | 'getJob' | 'requestCancel'>;
type CodingJobApiResultStoreV14 = Pick<PostgresCodingJobResultStoreV14, 'get' | 'delete'>;
type DispatchFn = (jobId: string, env: NodeJS.ProcessEnv) => Promise<CodingJobDispatchReceiptV14>;
type ResultDetailsState = 'pending' | 'available' | 'unavailable' | 'not_applicable';

type CodingJobReadinessV14 = {
  ready: boolean;
  controlPlaneReady: boolean;
  storeReady: boolean;
  resultStoreReady: boolean;
  authorizationReady: boolean;
  ownerBindingReady: boolean;
  dataKeyReady: boolean;
  cryptoReady: boolean;
  dispatchReady: boolean;
  workerEnabled: boolean;
};

function readiness(
  env: NodeJS.ProcessEnv,
  store: CodingJobApiStoreV14 | undefined,
  resultStore: CodingJobApiResultStoreV14 | undefined,
): CodingJobReadinessV14 {
  const storeReady = Boolean(store);
  const resultStoreReady = Boolean(resultStore);
  const authorizationReady = codingJobOperatorConfiguredV14(env);
  const ownerBindingReady = codingJobOwnerHashConfiguredV14(env);
  const dataKeyReady = codingJobDataKeyConfiguredV14(env);
  const cryptoReady = codingJobCryptoConfiguredV14(env);
  const dispatchReady = codingJobDispatchConfiguredV14(env);
  const workerEnabled = env[WORKER_ENABLED_ENV] === 'true';
  const controlPlaneReady = storeReady && authorizationReady && ownerBindingReady;
  return {
    ready: controlPlaneReady && resultStoreReady && dataKeyReady && dispatchReady && workerEnabled,
    controlPlaneReady,
    storeReady,
    resultStoreReady,
    authorizationReady,
    ownerBindingReady,
    dataKeyReady,
    cryptoReady,
    dispatchReady,
    workerEnabled,
  };
}

function requireApiAuth(req: Request, res: Response, env: NodeJS.ProcessEnv, store: CodingJobApiStoreV14 | undefined): { store: CodingJobApiStoreV14; ownerHash: string } | null {
  const controlReady = Boolean(store) && codingJobOperatorConfiguredV14(env) && codingJobOwnerHashConfiguredV14(env);
  if (!controlReady) {
    res.status(503).json({ ok: false, code: 'CODING_JOB_API_NOT_READY', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    return null;
  }
  if (!authenticateCodingJobOperatorV14(req, env)) {
    res.status(401).json({ ok: false, code: 'CODING_JOB_AUTHENTICATION_REQUIRED', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    return null;
  }
  try {
    return {
      store: store as CodingJobApiStoreV14,
      // Keep ownership stable across operator credential rotation. Future multi-user
      // auth replaces this constant with the authenticated ORIGIN user/session id.
      ownerHash: hashCodingJobOwnerV14(CODING_JOB_OPERATOR_OWNER_BINDING_V14, env),
    };
  } catch {
    res.status(503).json({ ok: false, code: 'CODING_JOB_API_NOT_READY', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    return null;
  }
}

function publicJson(record: CodingJobPublicRecordV14) {
  return {
    jobId: record.jobId,
    targetKey: record.targetKey,
    status: record.status,
    attempt: record.attempt,
    version: record.version,
    cancelRequested: record.cancelRequested,
    resultCode: record.resultCode,
    changedPaths: record.changedPaths,
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
    expiresAt: new Date(record.expiresAt).toISOString(),
  };
}

async function eraseCancelledResult(
  record: CodingJobPublicRecordV14,
  resultStore: CodingJobApiResultStoreV14 | undefined,
): Promise<void> {
  if (record.status !== 'cancelled' || !resultStore) return;
  // Cancellation has already won in the durable job row. Result evidence is
  // encrypted and inaccessible through the API, but remove it immediately when
  // the result store is healthy instead of waiting for TTL/FK cleanup.
  await resultStore.delete(record.jobId).catch(() => undefined);
}

async function resultDetails(
  record: CodingJobPublicRecordV14,
  resultStore: CodingJobApiResultStoreV14 | undefined,
  env: NodeJS.ProcessEnv,
): Promise<{ result: CodingJobResultV14 | null; resultDetailsState: ResultDetailsState }> {
  if (record.status === 'cancelled') return { result: null, resultDetailsState: 'not_applicable' };
  if (!['verified', 'blocked', 'failed'].includes(record.status)) return { result: null, resultDetailsState: 'pending' };
  if (!resultStore) return { result: null, resultDetailsState: 'unavailable' };
  try {
    const encoded = await resultStore.get(record.jobId);
    if (!encoded) return { result: null, resultDetailsState: 'unavailable' };
    return { result: decryptCodingJobResultV14(record.jobId, encoded, env), resultDetailsState: 'available' };
  } catch {
    return { result: null, resultDetailsState: 'unavailable' };
  }
}

export function createCodingJobV14Router(
  env: NodeJS.ProcessEnv = process.env,
  store?: CodingJobApiStoreV14,
  dispatch: DispatchFn = dispatchCodingJobV14,
  resultStore?: CodingJobApiResultStoreV14,
) {
  const router = Router();

  router.get('/api/coding/v1.4/status', (_req, res) => {
    const state = readiness(env, store, resultStore);
    return res.status(200).json({
      ok: true,
      version: '1.4',
      capability: 'durable-agentic-coding-jobs',
      ...state,
      resultDetailsReady: state.resultStoreReady,
      targetMode: 'server-owned-fixed-alias',
      targetKey: FIXED_TARGET_KEY,
      publicDispatchPayload: 'opaque-job-id-only',
      persistence: 'encrypted-bounded-postgres',
      resultPersistence: 'encrypted-bounded-postgres',
      authorizationMode: codingJobAuthorizationModeV14(env),
      authorizationScope: 'coding-v1.4-only-when-dedicated',
      workerOptInRequired: true,
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      gitPublished: false,
      deployed: false,
    });
  });

  router.post('/api/coding/v1.4/jobs', async (req, res) => {
    const state = readiness(env, store, resultStore);
    if (!state.ready) {
      return res.status(503).json({ ok: false, code: 'CODING_JOB_API_NOT_READY', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    }
    const auth = requireApiAuth(req, res, env, store);
    if (!auth) return;
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ ok: false, code: 'CODING_JOB_REQUEST_INVALID', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    }
    const input = body as Record<string, unknown>;
    if (!Object.keys(input).every(key => ['goal', 'confirmRun', 'ttlMinutes'].includes(key)) || input.confirmRun !== true || typeof input.goal !== 'string') {
      return res.status(400).json({ ok: false, code: 'CODING_JOB_CONFIRMATION_REQUIRED', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    }
    const ttlMinutes = input.ttlMinutes === undefined ? DEFAULT_TTL_MINUTES : input.ttlMinutes;
    if (!Number.isInteger(ttlMinutes) || Number(ttlMinutes) < 1 || Number(ttlMinutes) > MAX_TTL_MINUTES) {
      return res.status(400).json({ ok: false, code: 'CODING_JOB_TTL_INVALID', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    }

    try {
      const envelope = createCodingJobEnvelopeV14({
        ownerBinding: CODING_JOB_OPERATOR_OWNER_BINDING_V14,
        targetKey: FIXED_TARGET_KEY,
        goal: input.goal,
        ttlMs: Number(ttlMinutes) * 60_000,
      }, env);
      const created = await auth.store.create(envelope);
      if (!created) return res.status(409).json({ ok: false, code: 'CODING_JOB_CREATE_CONFLICT', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
      try {
        await dispatch(created.jobId, env);
      } catch {
        // Fail closed and erase the private payload when dispatch cannot be accepted.
        const cancelled = await auth.store.requestCancel(created.jobId, auth.ownerHash).catch(() => null);
        if (cancelled) await eraseCancelledResult(cancelled, resultStore);
        return res.status(503).json({ ok: false, code: 'CODING_JOB_DISPATCH_UNAVAILABLE', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
      }
      return res.status(202).json({
        ok: true,
        job: publicJson(created),
        result: null,
        resultDetailsState: 'pending' satisfies ResultDetailsState,
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      });
    } catch {
      return res.status(422).json({ ok: false, code: 'CODING_JOB_REQUEST_BLOCKED', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    }
  });

  router.get('/api/coding/v1.4/jobs/:jobId', async (req, res) => {
    const auth = requireApiAuth(req, res, env, store);
    if (!auth) return;
    const jobId = req.params.jobId;
    if (typeof jobId !== 'string' || !CODING_JOB_ID_PATTERN.test(jobId)) return res.status(404).json({ ok: false, code: 'CODING_JOB_NOT_FOUND' });
    try {
      const record = await auth.store.getJob(jobId, auth.ownerHash);
      if (!record) return res.status(404).json({ ok: false, code: 'CODING_JOB_NOT_FOUND' });
      const details = await resultDetails(record, resultStore, env);
      return res.status(200).json({ ok: true, job: publicJson(record), ...details, freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    } catch {
      return res.status(503).json({ ok: false, code: 'CODING_JOB_STORE_UNAVAILABLE', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    }
  });

  router.delete('/api/coding/v1.4/jobs/:jobId', async (req, res) => {
    const auth = requireApiAuth(req, res, env, store);
    if (!auth) return;
    const jobId = req.params.jobId;
    if (typeof jobId !== 'string' || !CODING_JOB_ID_PATTERN.test(jobId)) return res.status(404).json({ ok: false, code: 'CODING_JOB_NOT_FOUND' });
    try {
      const record = await auth.store.requestCancel(jobId, auth.ownerHash);
      if (!record) return res.status(404).json({ ok: false, code: 'CODING_JOB_NOT_FOUND' });
      await eraseCancelledResult(record, resultStore);
      const details = await resultDetails(record, resultStore, env);
      return res.status(200).json({ ok: true, job: publicJson(record), ...details, freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    } catch {
      return res.status(503).json({ ok: false, code: 'CODING_JOB_STORE_UNAVAILABLE', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    }
  });

  return router;
}
