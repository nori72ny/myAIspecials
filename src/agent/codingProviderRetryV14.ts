import {
  executeOriginProvider,
  type OriginProviderExecutionRequest,
  type OriginProviderExecutionResult,
} from '../legacy/originProviderClient.js';
import { executeOriginCodingFreeFailoverV14 } from './codingFreeModelFailoverV14.js';
import { createCodingProviderRetryBudgetV14, type CodingProviderRetryFamilyV14 } from './codingProviderRetryBudgetV14.js';

export type CodingProviderExecuteV14 = (
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv,
) => Promise<OriginProviderExecutionResult>;

const REQUIRED_TOOL_RETRY_CODES = new Set([
  'PROVIDER_REQUIRED_TOOL_TRUNCATED',
  'PROVIDER_REQUIRED_TOOL_AMBIGUOUS',
]);
const TRANSIENT_RETRY_CODES = new Set([
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_INVALID_RESPONSE',
]);
// A 429 can represent OpenRouter's account-wide free-model daily ceiling. A
// second model on the same account cannot bypass that ceiling, so model
// failover is reserved for route/model availability failures only.
const FREE_MODEL_FAILOVER_CODES = new Set([
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
]);

function providerCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function retryFamily(code: string | null, request: OriginProviderExecutionRequest): CodingProviderRetryFamilyV14 | null {
  if (!code) return null;
  if (TRANSIENT_RETRY_CODES.has(code)) return 'transient';
  if (request.requiredTool && REQUIRED_TOOL_RETRY_CODES.has(code)) return 'required-tool';
  return null;
}

function canUseFreeModelFailover(code: string | null, request: OriginProviderExecutionRequest): boolean {
  return Boolean(
    code &&
    FREE_MODEL_FAILOVER_CODES.has(code) &&
    request.requiredTool &&
    request.plan.taskType === 'implementation' &&
    request.plan.providerId === 'openrouter-free' &&
    request.plan.freeOnly === true &&
    request.plan.estimatedCostUsd === 0,
  );
}

/**
 * Retry only explicitly classified provider failures using a small per-request
 * budget plus a hard session-wide cap. After those retries are exhausted, the
 * production Coding executor may make one explicit attempt against a separately
 * evidence-backed zero-cost/ZDR coding model for timeout or availability
 * failures. Rate limits never switch models because OpenRouter free-model daily
 * quotas are account-wide. The alternate attempt keeps the same trusted
 * prompt/tool contract and independently re-enforces ZDR, data-collection deny,
 * max-price zero, exact model identity and zero reported cost. OpenRouter's own
 * provider fallback remains disabled and paid fallback is never enabled.
 */
export function createBoundedCodingProviderExecuteV14(
  execute: CodingProviderExecuteV14,
  onRetryableFailure?: (request: OriginProviderExecutionRequest, code: string) => void,
  freeModelFailoverExecute: CodingProviderExecuteV14 | undefined = execute === executeOriginProvider
    ? executeOriginCodingFreeFailoverV14
    : undefined,
): CodingProviderExecuteV14 {
  const budget = createCodingProviderRetryBudgetV14();
  const failoverUsed = new WeakSet<object>();

  return async (request, env) => {
    while (true) {
      try {
        return await execute(request, env);
      } catch (error) {
        const code = providerCode(error);
        const family = retryFamily(code, request);
        if (!family) throw error;
        onRetryableFailure?.(request, code as string);
        if (budget.tryConsume(request as object, family)) continue;

        if (
          freeModelFailoverExecute &&
          canUseFreeModelFailover(code, request) &&
          !failoverUsed.has(request as object)
        ) {
          failoverUsed.add(request as object);
          return freeModelFailoverExecute(request, env);
        }
        throw error;
      }
    }
  };
}
