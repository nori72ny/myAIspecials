import type {
  OriginProviderExecutionRequest,
  OriginProviderExecutionResult,
} from '../legacy/originProviderClient.js';

export type CodingProviderExecuteV14 = (
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv,
) => Promise<OriginProviderExecutionResult>;

/**
 * Production provider execution is deliberately single-attempt.
 *
 * Provider/network failures (including 429, timeout, 5xx/unavailable and
 * invalid responses) must fail closed. ORIGIN may start a later, explicit
 * repair round after verification feedback, but it must not hide provider
 * failure behind an automatic retry or model/provider failover.
 */
export function createBoundedCodingProviderExecuteV14(
  execute: CodingProviderExecuteV14,
  onRetryableFailure?: (request: OriginProviderExecutionRequest, code: string) => void,
): CodingProviderExecuteV14 {
  return async (request, env) => {
    try {
      return await execute(request, env);
    } catch (error) {
      const code = error && typeof error === 'object'
        ? (error as { code?: unknown }).code
        : undefined;
      if (typeof code === 'string') onRetryableFailure?.(request, code);
      throw error;
    }
  };
}
