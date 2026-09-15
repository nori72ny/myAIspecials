import type { OriginProviderExecutionRequest, OriginProviderExecutionResult } from '../legacy/originProviderClient.js';
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

/**
 * Retry only explicitly classified provider failures using a small per-request
 * budget plus a hard session-wide cap. The exact trusted request/environment is
 * reused on every retry. Required-tool schema, provider/model routing, zero-cost
 * policy and paid-fallback prohibition are never relaxed.
 */
export function createBoundedCodingProviderExecuteV14(
  execute: CodingProviderExecuteV14,
  onRetryableFailure?: (request: OriginProviderExecutionRequest, code: string) => void,
): CodingProviderExecuteV14 {
  const budget = createCodingProviderRetryBudgetV14();

  return async (request, env) => {
    while (true) {
      try {
        return await execute(request, env);
      } catch (error) {
        const code = providerCode(error);
        const family = retryFamily(code, request);
        if (!family) throw error;
        onRetryableFailure?.(request, code as string);
        if (!budget.tryConsume(request as object, family)) throw error;
      }
    }
  };
}
