import { CODING_WORKER_LEASE_SECONDS as WORKER_LEASE_SECONDS } from '../src/agent/codingWorkerTimingV14.js';
import { copyTrustedCodingCheckoutV14 as copyTrustedCheckout } from '../src/agent/codingWorkerCheckoutV14.js';
import { createBoundedCodingProviderExecuteV14 } from '../src/agent/codingProviderRetryV14.js';
import { runIsolatedCodingVerificationV14 } from '../src/agent/codingIsolatedVerificationV14.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CODING_JOB_ID_PATTERN } from '../src/agent/codingJobCryptoV14.js';
import { buildCodingJobResultV14 } from '../src/agent/codingJobResultV14.js';
import { captureCodingJobExecutionEvidenceV14 } from '../src/agent/codingJobExecutionEvidenceV14.js';
import { createCodingJobResultStoreFromEnvV14 } from '../src/agent/codingJobResultStoreV14.js';
import { runCodingJobWorkerV14, type CodingJobResolvedTargetV14, type CodingJobWorkerCheckpointV14 } from '../src/agent/codingJobWorkerV14.js';
import { createCodingJobStoreFromEnvV14 } from '../src/agent/supabaseCodingJobStoreV14.js';
import { executeOriginProvider, type OriginProviderExecutionRequest } from '../src/legacy/originProviderClient.js';

const TARGET_KEY = 'origin:self';

function logTruncatedRequiredTool(request: OriginProviderExecutionRequest, code: string): void {
  const candidate = request.requiredTool?.name;
  const requiredTool = typeof candidate === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(candidate) ? candidate : 'unknown';
  // This event deliberately excludes prompts, repository content, tool arguments,
  // credentials, and provider response bodies. Tool names are static code-owned IDs.
  console.warn(JSON.stringify({ event: 'coding-provider-required-tool-truncated', requiredTool, code }));
}

async function main(): Promise<void> {
  const jobId = process.env.ORIGIN_CODING_JOB_ID ?? '';
  if (!CODING_JOB_ID_PATTERN.test(jobId)) throw new Error('CODING_WORKER_JOB_ID_INVALID');
  const checkout = await fs.realpath(process.cwd());
  const executionEvidence = await captureCodingJobExecutionEvidenceV14(checkout, process.env);
  const store = createCodingJobStoreFromEnvV14(process.env);
  if (!store) throw new Error('CODING_WORKER_STORE_NOT_CONFIGURED');
  const resultStore = createCodingJobResultStoreFromEnvV14(process.env);
  if (!resultStore) throw new Error('CODING_WORKER_RESULT_STORE_NOT_CONFIGURED');
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), `origin-v14-${jobId}-`));
  const workerId = `gha-${process.env.GITHUB_RUN_ID ?? 'local'}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`;
  try {
    await copyTrustedCheckout(checkout, workspace);
    const resolveTarget = async (targetKey: string): Promise<CodingJobResolvedTargetV14> => {
      if (targetKey !== TARGET_KEY) throw new Error('CODING_WORKER_TARGET_BLOCKED');
      return { root: workspace, trustedWorkspaceApproved: true };
    };
    const verify = async (root: string, checkpoint?: CodingJobWorkerCheckpointV14) => {
      const realRoot = await fs.realpath(root);
      if (realRoot !== await fs.realpath(workspace)) throw new Error('CODING_WORKER_ROOT_BLOCKED');
      const checks = await runIsolatedCodingVerificationV14(realRoot, checkout, checkpoint);
      for (const check of checks) {
        if (!check.ok || check.exitCode !== 0 || check.timedOut) {
          // Only code-owned check metadata is emitted. Repository output and
          // diagnostics can contain private source or secrets and stay inside
          // the encrypted result/repair path.
          console.warn(JSON.stringify({
            event: 'coding-verification-check-failed',
            kind: check.kind,
            exitCode: check.exitCode,
            timedOut: check.timedOut,
          }));
        }
      }
      return checks;
    };
    const execute = createBoundedCodingProviderExecuteV14(executeOriginProvider, logTruncatedRequiredTool);
    const outcome = await runCodingJobWorkerV14(jobId, workerId, {
      store,
      resultStore,
      resolveTarget,
      verify,
      captureResult: (session, root) => buildCodingJobResultV14(session, checkout, root, executionEvidence),
      env: process.env,
      execute,
      leaseSeconds: WORKER_LEASE_SECONDS,
    });
    console.log(JSON.stringify({ jobId: outcome.jobId, state: outcome.state, code: outcome.code }));
    if (outcome.state === 'retryable' || outcome.state === 'lease_lost') process.exitCode = 2;
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const code = error instanceof Error && /^CODING_[A-Z0-9_]+$/.test(error.message) ? error.message : 'CODING_WORKER_FATAL';
  console.error(JSON.stringify({ code }));
  process.exitCode = 1;
});