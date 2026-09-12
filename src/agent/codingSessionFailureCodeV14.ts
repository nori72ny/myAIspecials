const DIRECT_CODING_FAILURE_CODES = new Set([
  'CODING_MODEL_RESPONSE_INVALID',
  'CODING_MODEL_CONTEXT_BLOCKED',
  'CODING_NAVIGATION_QUERY_RESPONSE_INVALID',
  'CODING_NAVIGATION_CONTEXT_BLOCKED',
  'CODING_NAVIGATION_REPEATED_QUERY',
  'CODING_NAVIGATION_NO_EVIDENCE',
  'CODING_DISCOVERY_INVENTORY_BLOCKED',
  'CODING_DISCOVERY_RESPONSE_INVALID',
  'CODING_DISCOVERY_CONTEXT_BLOCKED',
  'CODING_SEARCH_QUERY_BLOCKED',
  'CODING_SEARCH_INVENTORY_BLOCKED',
]);

const TRANSLATED_FAILURE_CODES = new Map<string, string>([
  ['FREE_PROVIDER_NOT_CONFIGURED', 'CODING_FREE_PROVIDER_NOT_CONFIGURED'],
  ['FREE_MODEL_CATALOG_INVALID', 'CODING_FREE_MODEL_CATALOG_INVALID'],
  ['FREE_MODEL_EVIDENCE_STALE', 'CODING_FREE_MODEL_EVIDENCE_STALE'],
  ['INVALID_EXECUTION_POLICY', 'CODING_EXECUTION_POLICY_INVALID'],
  ['PROVIDER_NOT_CONFIGURED', 'CODING_PROVIDER_NOT_CONFIGURED'],
  ['PROVIDER_POLICY_VIOLATION', 'CODING_PROVIDER_POLICY_VIOLATION'],
  ['PROVIDER_COST_UNVERIFIED', 'CODING_PROVIDER_COST_UNVERIFIED'],
  ['PROVIDER_ROUTING_UNVERIFIED', 'CODING_PROVIDER_ROUTING_UNVERIFIED'],
  ['PROVIDER_RATE_LIMITED', 'CODING_PROVIDER_RATE_LIMITED'],
  ['PROVIDER_UNAVAILABLE', 'CODING_PROVIDER_UNAVAILABLE'],
  ['PROVIDER_TIMEOUT', 'CODING_PROVIDER_TIMEOUT'],
  ['PROVIDER_INVALID_RESPONSE', 'CODING_PROVIDER_INVALID_RESPONSE'],
  ['PROVIDER_INTERNAL_ERROR', 'CODING_PROVIDER_INTERNAL_ERROR'],
]);

/**
 * Preserve only explicitly reviewed operational failure classes. Never surface
 * arbitrary thrown messages or provider diagnostics through the durable public
 * job record: unknown failures remain the generic fail-closed code.
 */
export function classifyCodingSessionFailureV14(error: unknown): string {
  const candidates: unknown[] = [];
  if (error && typeof error === 'object' && 'code' in error) {
    candidates.push((error as { code?: unknown }).code);
  }
  if (error instanceof Error) candidates.push(error.message);

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    if (DIRECT_CODING_FAILURE_CODES.has(candidate)) return candidate;
    const translated = TRANSLATED_FAILURE_CODES.get(candidate);
    if (translated) return translated;
  }
  return 'CODING_OPERATION_BLOCKED';
}
