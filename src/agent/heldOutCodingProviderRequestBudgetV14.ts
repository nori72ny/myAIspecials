import type {
  OriginProviderExecutionRequest,
  OriginProviderExecutionResult,
} from '../legacy/originProviderClient.js';
import type { CodingProviderExecuteV14 } from './codingProviderRetryV14.js';

export const HELD_OUT_CODING_PROVIDER_REQUEST_LIMIT_V14 = 7 as const;

export class HeldOutCodingProviderBudgetExhaustedV14 extends Error {
  readonly code = 'PROVIDER_BUDGET_EXHAUSTED' as const;

  constructor() {
    super('PROVIDER_BUDGET_EXHAUSTED');
    this.name = 'HeldOutCodingProviderBudgetExhaustedV14';
  }
}

/**
 * Final held-out runs share one counter across primary retries and explicit
 * zero-cost failover calls. The wrapper counts actual provider executions, not
 * planner rounds, so a task cannot silently amplify OpenRouter requests through
 * retries. This budget is evaluator-only and does not change Production Coding.
 */
export function createHeldOutCodingProviderRequestBudgetV14(
  limit: number = HELD_OUT_CODING_PROVIDER_REQUEST_LIMIT_V14,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > HELD_OUT_CODING_PROVIDER_REQUEST_LIMIT_V14) {
    throw new Error('HELD_OUT_PROVIDER_REQUEST_BUDGET_INVALID');
  }

  let used = 0;

  return {
    used: () => used,
    remaining: () => limit - used,
    wrap(execute: CodingProviderExecuteV14): CodingProviderExecuteV14 {
      return async (
        request: OriginProviderExecutionRequest,
        env: NodeJS.ProcessEnv,
      ): Promise<OriginProviderExecutionResult> => {
        if (used >= limit) throw new HeldOutCodingProviderBudgetExhaustedV14();
        used += 1;
        return execute(request, env);
      };
    },
  };
}
