import type { OriginProviderExecutionRequest, OriginProviderExecutionResult } from '../legacy/originProviderClient.js';

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

function eligibleForOneRetry(code: string | null, request: OriginProviderExecutionRequest): boolean {
  if (!code) return false;
  if (TRANSIENT_RETRY_CODES.has(code)) return true;
  return Boolean(request.requiredTool) && REQUIRED_TOOL_RETRY_CODES.has(code);
}

/**
 * Retry at most one eligible provider failure across an entire Coding session.
 * The retry always reuses the exact trusted request and environment. It never
 * relaxes the required-tool schema, changes provider/model routing, replays
 * partial tool arguments, or enables a paid fallback. Permanent policy,
 * authentication, cost, routing and schema violations fail closed immediately.
 */
export function createBoundedCodingProviderExecuteV14(
  execute: CodingProviderExecuteV14,
  onRetryableFailure?: (request: OriginProviderExecutionRequest, code: string) => void,
): CodingProviderExecuteV14 {
  let retryAvailable = true;

  return async (request, env) => {
    try {
      return await execute(request, env);
    } catch (error) {
      const code = providerCode(error);
      if (!eligibleForOneRetry(code, request)) throw error;
      onRetryableFailure?.(request, code as string);
      if (!retryAvailable) throw error;

      retryAvailable = false;
      try {
        return await execute(request, env);
      } catch (retryError) {
        const retryCode = providerCode(retryError);
        if (eligibleForOneRetry(retryCode, request)) {
          onRetryableFailure?.(request, retryCode as string);
        }
        throw retryError;
      }
    }
  };
}
