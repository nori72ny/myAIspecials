import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const SHA = /^[0-9a-f]{40}$/;
const RUN_ID = /^[1-9][0-9]{0,19}$/;
const WORKFLOW = 'nori72ny/myAIspecials/.github/workflows/coding-job-worker-v14.yml@refs/heads/main';

export type CodingJobExecutionEvidenceV14 = {
  sourceRevision: string;
  workerRunId: string;
  workerRunAttempt: number;
};

export function validCodingJobExecutionEvidenceV14(value: unknown): value is CodingJobExecutionEvidenceV14 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).sort().join('|') === 'sourceRevision|workerRunAttempt|workerRunId'
    && typeof item.sourceRevision === 'string' && SHA.test(item.sourceRevision)
    && typeof item.workerRunId === 'string' && RUN_ID.test(item.workerRunId)
    && Number.isSafeInteger(item.workerRunAttempt) && Number(item.workerRunAttempt) > 0;
}

/** Read the trusted checkout before copying it or calling the provider.
 * Repository text and model output never supply execution provenance.
 * The Git child receives no credentials or inherited Git configuration.
 */
export async function captureCodingJobExecutionEvidenceV14(
  checkout: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CodingJobExecutionEvidenceV14> {
  if (env.GITHUB_ACTIONS !== 'true'
    || env.GITHUB_REPOSITORY !== 'nori72ny/myAIspecials'
    || env.GITHUB_REF !== 'refs/heads/main'
    || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.GITHUB_WORKFLOW_REF !== WORKFLOW
    || !SHA.test(env.GITHUB_SHA ?? '')
    || !RUN_ID.test(env.GITHUB_RUN_ID ?? '')
    || !/^[1-9][0-9]{0,9}$/.test(env.GITHUB_RUN_ATTEMPT ?? '')) {
    throw new Error('CODING_WORKER_EXECUTION_EVIDENCE_INVALID');
  }
  let revision: string;
  try {
    const { stdout } = await executeFile('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: checkout,
      env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
      timeout: 5_000,
      maxBuffer: 1024,
      encoding: 'utf8',
    });
    revision = stdout.trim();
  } catch {
    throw new Error('CODING_WORKER_SOURCE_REVISION_UNAVAILABLE');
  }
  if (revision !== env.GITHUB_SHA) throw new Error('CODING_WORKER_SOURCE_REVISION_MISMATCH');
  return Object.freeze({
    sourceRevision: revision,
    workerRunId: env.GITHUB_RUN_ID as string,
    workerRunAttempt: Number(env.GITHUB_RUN_ATTEMPT),
  });
}
