import {
  executeOriginProvider,
  type OriginProviderExecutionRequest,
  type OriginProviderExecutionResult,
} from '../legacy/originProviderClient.js';
import { executeOriginCodingFreeFailoverV14 } from './codingFreeModelFailoverV14.js';

export type CodingProviderExecuteV14 = (
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv,
) => Promise<OriginProviderExecutionResult>;

const OBSERVABLE_FAIL_CLOSED_CODES = new Set([
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_INVALID_RESPONSE',
  'PROVIDER_REQUIRED_TOOL_TRUNCATED',
  'PROVIDER_REQUIRED_TOOL_AMBIGUOUS',
]);

const FREE_MODEL_FAILOVER_CODES = new Set([
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
]);

function providerCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
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
 * Fail closed after the first provider request. The same provider/model request
 * is never repeated for 429, timeout, 5xx/unavailable, malformed output, or a
 * required-tool contract failure. For timeout/unavailable only, Coding may make
 * one explicit request to a separately evidence-backed free/ZDR model. That
 * alternate request independently enforces data-collection deny, ZDR,
 * max-price zero, exact served-model identity, and zero reported cost.
 *
 * This is provider failover, not Coding self-repair. Self-repair remains a
 * separate verification-driven phase after a concrete code change exists.
 */
export function createBoundedCodingProviderExecuteV14(
  execute: CodingProviderExecuteV14,
  onRetryableFailure?: (request: OriginProviderExecutionRequest, code: string) => void,
  freeModelFailoverExecute: CodingProviderExecuteV14 | undefined = execute === executeOriginProvider
    ? executeOriginCodingFreeFailoverV14
    : undefined,
): CodingProviderExecuteV14 {
  const failoverUsed = new WeakSet<object>();

  return async (request, env) => {
    try {
      return await execute(request, env);
    } catch (error) {
      const code = providerCode(error);
      if (code && OBSERVABLE_FAIL_CLOSED_CODES.has(code)) onRetryableFailure?.(request, code);

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
  };
}
