import type { OriginProviderExecutionRequest, OriginProviderExecutionResult } from '../legacy/originProviderClient.js';

export type CodingProviderExecuteV14 = (
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv,
) => Promise<OriginProviderExecutionResult>;

const TRUNCATED_REQUIRED_TOOL_CODE = 'PROVIDER_REQUIRED_TOOL_TRUNCATED';

function providerCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * Retry exactly once when a free provider ends a required-tool response before
 * its function arguments are complete. The retry reuses the exact trusted
 * request and environment; it never relaxes the tool schema, replays partial
 * arguments, changes provider/model routing, or enables a paid fallback.
 */
export function createBoundedCodingProviderExecuteV14(
  execute: CodingProviderExecuteV14,
  onTruncated?: (request: OriginProviderExecutionRequest, code: string) => void,
): CodingProviderExecuteV14 {
  let retryAvailable = true;

  return async (request, env) => {
    try {
      return await execute(request, env);
    } catch (error) {
      const code = providerCode(error);
      if (code !== TRUNCATED_REQUIRED_TOOL_CODE) throw error;
      onTruncated?.(request, code);
      if (!retryAvailable || !request.requiredTool) throw error;

      retryAvailable = false;
      try {
        return await execute(request, env);
      } catch (retryError) {
        if (providerCode(retryError) === TRUNCATED_REQUIRED_TOOL_CODE) {
          onTruncated?.(request, TRUNCATED_REQUIRED_TOOL_CODE);
        }
        throw retryError;
      }
    }
  };
}
