export type CodingProviderRetryFamilyV14 = 'required-tool' | 'transient';

const MAX_TOTAL_RETRIES = 6;
const PER_REQUEST_LIMIT: Record<CodingProviderRetryFamilyV14, number> = {
  'required-tool': 2,
  transient: 1,
};

/**
 * Small fail-closed retry budget for one Coding session. Retries are tracked
 * per trusted request object so later repair rounds do not lose resilience
 * because an earlier provider call consumed the only session-wide retry.
 * A hard session cap prevents retry amplification.
 */
export function createCodingProviderRetryBudgetV14() {
  let totalRetries = 0;
  const perRequest = new WeakMap<object, Record<CodingProviderRetryFamilyV14, number>>();

  return {
    tryConsume(request: object, family: CodingProviderRetryFamilyV14): boolean {
      if (totalRetries >= MAX_TOTAL_RETRIES) return false;
      const used = perRequest.get(request) ?? { 'required-tool': 0, transient: 0 };
      if (used[family] >= PER_REQUEST_LIMIT[family]) return false;
      used[family] += 1;
      totalRetries += 1;
      perRequest.set(request, used);
      return true;
    },
  };
}
