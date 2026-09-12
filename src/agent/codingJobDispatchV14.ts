import { CODING_JOB_ID_PATTERN } from './codingJobCryptoV14.js';

const DISPATCH_URL = 'https://api.github.com/repos/nori72ny/myAIspecials/actions/workflows/coding-job-worker-v14.yml/dispatches';
const DISPATCH_REF = 'main';
const API_VERSION = '2022-11-28';
const TIMEOUT_MS = 6_000;
const TOKEN_ENV = 'ORIGIN_CODING_GITHUB_DISPATCH_TOKEN';

const DISPATCH_FAILURE_BY_STATUS: Readonly<Record<number, string>> = {
  401: 'CODING_DISPATCH_TOKEN_INVALID',
  403: 'CODING_DISPATCH_PERMISSION_DENIED',
  404: 'CODING_DISPATCH_WORKFLOW_INACCESSIBLE',
  422: 'CODING_DISPATCH_REF_INVALID',
  429: 'CODING_DISPATCH_RATE_LIMITED',
};

export type CodingJobDispatchReceiptV14 = {
  accepted: true;
  jobId: string;
  repository: 'nori72ny/myAIspecials';
  workflow: 'coding-job-worker-v14.yml';
  ref: 'main';
};

export function buildCodingJobDispatchBodyV14(jobId: string): string {
  if (!CODING_JOB_ID_PATTERN.test(jobId)) throw new Error('CODING_DISPATCH_JOB_ID_INVALID');
  return JSON.stringify({ ref: DISPATCH_REF, inputs: { job_id: jobId } });
}

function dispatchToken(env: NodeJS.ProcessEnv): string {
  const token = env[TOKEN_ENV];
  if (!token || token.length < 20 || token.length > 512 || /[\s\u0000-\u001f\u007f]/.test(token)) {
    throw new Error('CODING_DISPATCH_NOT_CONFIGURED');
  }
  return token;
}

export function codingJobDispatchConfiguredV14(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    dispatchToken(env);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fixed-target server-side dispatch boundary. The workflow request can carry only
 * the opaque durable job id. Prompt/source/target/repository/ref are deliberately
 * absent from caller-controlled parameters and from GitHub Actions inputs.
 */
export async function dispatchCodingJobV14(
  jobId: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<CodingJobDispatchReceiptV14> {
  const body = buildCodingJobDispatchBodyV14(jobId);
  const token = dispatchToken(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(DISPATCH_URL, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': API_VERSION,
          'Content-Type': 'application/json',
          'User-Agent': 'origin-coding-v14-dispatch',
        },
        body,
      });
    } catch {
      throw new Error('CODING_DISPATCH_UNAVAILABLE');
    }
    if (response.status !== 204) {
      throw new Error(DISPATCH_FAILURE_BY_STATUS[response.status] ?? 'CODING_DISPATCH_REJECTED');
    }
    return { accepted: true, jobId, repository: 'nori72ny/myAIspecials', workflow: 'coding-job-worker-v14.yml', ref: 'main' };
  } finally {
    clearTimeout(timer);
  }
}
