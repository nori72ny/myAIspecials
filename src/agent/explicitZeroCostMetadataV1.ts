/**
 * A response is eligible for the local zero-cost policy check only when it
 * explicitly reports numeric zero. Missing, null, string, negative, NaN, and
 * non-zero values are unverified/unsafe and must fail closed.
 *
 * This is response metadata validation, NOT independent provider billing proof.
 */
export function hasExplicitZeroCostMetadata(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const costUsd = (body as { costUsd?: unknown }).costUsd;
  return typeof costUsd === 'number' && Number.isFinite(costUsd) && costUsd === 0;
}
