import { Router, type Request } from 'express';
import { CODING_JOB_ID_PATTERN } from './codingJobCryptoV14.js';
import { codingJobAuthorizationModeV14 } from './codingJobOperatorAuthV14.js';
import {
  verifyCodingJobSmokeOidcV14,
  type VerifiedCodingSmokeOidcV14,
} from './codingJobSmokeOidcV14.js';

const OPERATOR_SECRET_ENV = 'ORIGIN_CODING_OPERATOR_SECRET';
const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SAFE_CODE_PATTERN = /^CODING_[A-Z0-9_]{1,72}$/;
const MAX_PROXY_BODY_BYTES = 128 * 1024;
const PRODUCTION_ORIGIN = 'https://origin-personal.vercel.app';
const SMOKE_TTL_MINUTES = 60;
export const CODING_SMOKE_CREATED_PATH_V14 = 'src/agent/__origin_coding_smoke_v14__.ts';
export const CODING_SMOKE_CREATED_CONTENT_V14 = 'export const ORIGIN_CODING_SMOKE_V14 = true;\n';
export const CODING_SMOKE_GOAL_V14 = `Create exactly one new file at ${CODING_SMOKE_CREATED_PATH_V14} with exact content:\n${CODING_SMOKE_CREATED_CONTENT_V14}Do not modify any other file. Run all required verification checks. This is a bounded production smoke probe; do not publish or deploy.`;

type FetchLike = typeof fetch;
type VerifyOidc = (token: string) => Promise<VerifiedCodingSmokeOidcV14 | null>;

type SmokeRouterDeps = {
  verifyOidc?: VerifyOidc;
  internalFetch?: FetchLike;
  productionOrigin?: string;
};

function releaseSha(env: NodeJS.ProcessEnv): string | null {
  const value = env.VERCEL_GIT_COMMIT_SHA;
  return typeof value === 'string' && RELEASE_SHA_PATTERN.test(value) ? value.toLowerCase() : null;
}

function presentedBearer(req: Request): string | null {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  if (!token || Buffer.byteLength(token, 'utf8') > 16 * 1024) return null;
  return token;
}

function safeUpstreamCode(value: unknown): string {
  return typeof value === 'string' && SAFE_CODE_PATTERN.test(value) ? value : 'CODING_SMOKE_UPSTREAM_UNAVAILABLE';
}

async function boundedJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_PROXY_BODY_BYTES) return null;
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function internalOperatorSecret(env: NodeJS.ProcessEnv): string | null {
  if (codingJobAuthorizationModeV14(env) !== 'coding-operator') return null;
  const secret = env[OPERATOR_SECRET_ENV];
  return typeof secret === 'string' ? secret : null;
}

async function authenticateSmoke(
  req: Request,
  expectedReleaseSha: string,
  verifyOidc: VerifyOidc,
): Promise<VerifiedCodingSmokeOidcV14 | null> {
  const token = presentedBearer(req);
  if (!token) return null;
  const verified = await verifyOidc(token).catch(() => null);
  if (!verified || verified.sha !== expectedReleaseSha) return null;
  return verified;
}

function exactStartBody(body: unknown, expectedReleaseSha: string): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const input = body as Record<string, unknown>;
  return Object.keys(input).sort().join('|') === 'confirmSmoke|releaseSha'
    && input.confirmSmoke === true
    && typeof input.releaseSha === 'string'
    && input.releaseSha.toLowerCase() === expectedReleaseSha;
}

export function createCodingJobSmokeV14Router(
  env: NodeJS.ProcessEnv = process.env,
  deps: SmokeRouterDeps = {},
) {
  const router = Router();
  const verifyOidc = deps.verifyOidc ?? ((token: string) => verifyCodingJobSmokeOidcV14(token));
  const internalFetch = deps.internalFetch ?? fetch;
  const productionOrigin = deps.productionOrigin ?? PRODUCTION_ORIGIN;

  router.post('/api/coding/v1.4/smoke', async (req, res) => {
    const currentRelease = releaseSha(env);
    if (env.VERCEL_ENV !== 'production' || !currentRelease) {
      return res.status(404).json({ ok: false, code: 'CODING_SMOKE_NOT_AVAILABLE' });
    }
    if (!exactStartBody(req.body, currentRelease)) {
      return res.status(409).json({ ok: false, code: 'CODING_SMOKE_RELEASE_MISMATCH' });
    }
    const verified = await authenticateSmoke(req, currentRelease, verifyOidc);
    if (!verified) {
      return res.status(401).json({ ok: false, code: 'CODING_SMOKE_AUTHENTICATION_REQUIRED' });
    }
    const operatorSecret = internalOperatorSecret(env);
    if (!operatorSecret) {
      return res.status(503).json({ ok: false, code: 'CODING_SMOKE_OPERATOR_NOT_READY' });
    }
    try {
      const upstream = await internalFetch(`${productionOrigin}/api/coding/v1.4/jobs`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${operatorSecret}`,
          'content-type': 'application/json',
          'user-agent': 'origin-coding-smoke-v14',
        },
        body: JSON.stringify({ goal: CODING_SMOKE_GOAL_V14, confirmRun: true, ttlMinutes: SMOKE_TTL_MINUTES }),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await boundedJson(upstream);
      if (upstream.status !== 202 || !payload || payload.ok !== true || payload.freeOnly !== true || payload.costUsd !== 0 || payload.paidFallbackUsed !== false) {
        return res.status(503).json({ ok: false, code: safeUpstreamCode(payload?.code), releaseSha: currentRelease });
      }
      const job = payload.job;
      if (!job || typeof job !== 'object' || Array.isArray(job) || typeof (job as Record<string, unknown>).jobId !== 'string' || !CODING_JOB_ID_PATTERN.test((job as Record<string, unknown>).jobId as string)) {
        return res.status(503).json({ ok: false, code: 'CODING_SMOKE_UPSTREAM_INVALID', releaseSha: currentRelease });
      }
      return res.status(202).json({
        ok: true,
        releaseSha: currentRelease,
        runId: verified.runId,
        job,
        resultDetailsState: payload.resultDetailsState,
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      });
    } catch {
      return res.status(503).json({ ok: false, code: 'CODING_SMOKE_UPSTREAM_UNAVAILABLE', releaseSha: currentRelease });
    }
  });

  router.get('/api/coding/v1.4/smoke/:jobId', async (req, res) => {
    const currentRelease = releaseSha(env);
    if (env.VERCEL_ENV !== 'production' || !currentRelease) {
      return res.status(404).json({ ok: false, code: 'CODING_SMOKE_NOT_AVAILABLE' });
    }
    if (typeof req.query.releaseSha !== 'string' || req.query.releaseSha.toLowerCase() !== currentRelease) {
      return res.status(409).json({ ok: false, code: 'CODING_SMOKE_RELEASE_MISMATCH' });
    }
    const verified = await authenticateSmoke(req, currentRelease, verifyOidc);
    if (!verified) {
      return res.status(401).json({ ok: false, code: 'CODING_SMOKE_AUTHENTICATION_REQUIRED' });
    }
    const jobId = req.params.jobId;
    if (typeof jobId !== 'string' || !CODING_JOB_ID_PATTERN.test(jobId)) {
      return res.status(404).json({ ok: false, code: 'CODING_JOB_NOT_FOUND' });
    }
    const operatorSecret = internalOperatorSecret(env);
    if (!operatorSecret) {
      return res.status(503).json({ ok: false, code: 'CODING_SMOKE_OPERATOR_NOT_READY' });
    }
    try {
      const upstream = await internalFetch(`${productionOrigin}/api/coding/v1.4/jobs/${encodeURIComponent(jobId)}`, {
        method: 'GET',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${operatorSecret}`,
          'user-agent': 'origin-coding-smoke-v14',
        },
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await boundedJson(upstream);
      if (upstream.status !== 200 || !payload || payload.ok !== true || payload.freeOnly !== true || payload.costUsd !== 0 || payload.paidFallbackUsed !== false) {
        return res.status(upstream.status === 404 ? 404 : 503).json({ ok: false, code: safeUpstreamCode(payload?.code), releaseSha: currentRelease });
      }
      const job = payload.job;
      if (!job || typeof job !== 'object' || Array.isArray(job) || (job as Record<string, unknown>).jobId !== jobId) {
        return res.status(503).json({ ok: false, code: 'CODING_SMOKE_UPSTREAM_INVALID', releaseSha: currentRelease });
      }
      return res.status(200).json({
        ok: true,
        releaseSha: currentRelease,
        runId: verified.runId,
        job,
        result: payload.result ?? null,
        resultDetailsState: payload.resultDetailsState,
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      });
    } catch {
      return res.status(503).json({ ok: false, code: 'CODING_SMOKE_UPSTREAM_UNAVAILABLE', releaseSha: currentRelease });
    }
  });

  return router;
}
