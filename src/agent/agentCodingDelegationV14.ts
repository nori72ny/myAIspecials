import { createCodingJobEnvelopeV14, type CodingJobEnvelopeV14 } from './codingJobCryptoV14.js';
import { CODING_JOB_OPERATOR_OWNER_BINDING_V14 } from './codingJobOperatorAuthV14.js';
import { codingJobDispatchConfiguredV14, dispatchCodingJobV14, type CodingJobDispatchReceiptV14 } from './codingJobDispatchV14.js';

/**
 * Delegation port from Agent V3's `code_interpreter` tool to the V14 durable
 * coding-job pipeline.
 *
 * Why a job, not a direct session call: `runCodingSessionV14` deliberately
 * refuses the application server's own working directory
 * (CODING_DEDICATED_WORKSPACE_REQUIRED) and must never be mounted on the
 * production app's writable routes. The supported connection path is the
 * same one the V14 HTTP router uses: create an encrypted job envelope in the
 * shared job store, then dispatch the opaque job id to the dedicated worker
 * workflow. Jobs created here carry the operator owner binding so they stay
 * visible through the existing operator job inspection/result endpoints.
 *
 * Dispatching a job is the completion of this step, not of the coding work
 * itself: the returned artifact states `completionCertified: false` and the
 * code result is verified inside the V14 pipeline, never by this adapter.
 */
export type AgentCodeDelegationRequest = {
  mode: 'generate' | 'provided-code';
  instruction: string;
  code?: string;
  language?: string;
  targetPath?: string;
};

export type AgentCodeDelegationResult =
  | { state: 'dispatched'; jobId: string; targetKey: string }
  | { state: 'unavailable'; code: string };

export interface AgentCodeDelegationPort {
  dispatch(request: AgentCodeDelegationRequest): Promise<AgentCodeDelegationResult>;
}

export interface AgentCodingJobStore {
  create(envelope: CodingJobEnvelopeV14): Promise<{ jobId: string } | null>;
  requestCancel(jobId: string, ownerHash: string): Promise<unknown>;
}

const FIXED_TARGET_KEY = 'origin:self';
const MAX_JOB_GOAL_CHARS = 3_600;

export function composeCodingJobGoal(request: AgentCodeDelegationRequest): string {
  const parts = [request.instruction.trim()];
  if (request.targetPath) parts.push(`対象ファイル: ${request.targetPath}`);
  if (request.language) parts.push(`言語: ${request.language}`);
  if (request.mode === 'provided-code' && request.code) {
    parts.push('次のコードを対象として、検証と必要な修正を行ってください。');
    parts.push('```' + (request.language ?? '') + '\n' + request.code.trim() + '\n```');
  }
  return parts.join('\n').slice(0, MAX_JOB_GOAL_CHARS);
}

export function createAgentCodingDelegationV14(deps: {
  env?: NodeJS.ProcessEnv;
  jobStore?: AgentCodingJobStore;
  dispatch?: (jobId: string, env: NodeJS.ProcessEnv) => Promise<CodingJobDispatchReceiptV14>;
}): AgentCodeDelegationPort | undefined {
  const env = deps.env ?? process.env;
  const jobStore = deps.jobStore;
  if (!jobStore) return undefined;
  const dispatch = deps.dispatch ?? dispatchCodingJobV14;

  return {
    async dispatch(request: AgentCodeDelegationRequest): Promise<AgentCodeDelegationResult> {
      if (!codingJobDispatchConfiguredV14(env)) {
        return { state: 'unavailable', code: 'AGENT_CODE_DISPATCH_NOT_CONFIGURED' };
      }
      let envelope: CodingJobEnvelopeV14;
      try {
        envelope = createCodingJobEnvelopeV14({
          ownerBinding: CODING_JOB_OPERATOR_OWNER_BINDING_V14,
          targetKey: FIXED_TARGET_KEY,
          goal: composeCodingJobGoal(request),
        }, env);
      } catch {
        // Envelope creation validates the goal and the data key; any failure
        // means the coding backend is not safely configured. Fail closed
        // without leaking configuration details.
        return { state: 'unavailable', code: 'AGENT_CODE_BACKEND_NOT_CONFIGURED' };
      }
      let created: { jobId: string } | null;
      try {
        created = await jobStore.create(envelope);
      } catch {
        return { state: 'unavailable', code: 'AGENT_CODE_JOB_STORE_UNAVAILABLE' };
      }
      if (!created) return { state: 'unavailable', code: 'AGENT_CODE_JOB_CREATE_CONFLICT' };
      try {
        await dispatch(created.jobId, env);
      } catch {
        // Mirror the V14 router: a job that cannot be dispatched is cancelled
        // best-effort so it cannot be picked up later out of context.
        await jobStore.requestCancel(created.jobId, envelope.ownerHash).catch(() => undefined);
        return { state: 'unavailable', code: 'AGENT_CODE_DISPATCH_FAILED' };
      }
      return { state: 'dispatched', jobId: created.jobId, targetKey: FIXED_TARGET_KEY };
    },
  };
}
