import { describe, expect, it } from 'vitest';
import { DEFAULT_ORIGIN_SEARCH_PROVIDER_CATALOG } from './originSearchProviderCatalog';

/**
 * Regression guard for the 2026-11-28 Frankfurter incident: the
 * entry's verifiedAt was written as the verification DATE at
 * 00:00Z, which was still in the future when the release went out
 * (08:47 JST = 23:47Z the day before), so the route's evidence
 * window had not opened and the provider was silently disabled
 * until 09:00 JST. A route is current only while
 * verifiedAt <= now <= reviewAfter, so a future verifiedAt is a
 * route that ships dead. Every catalog entry must therefore
 * carry a verifiedAt that is not in the future at test time —
 * verifiedAt is the moment the check actually happened, never a
 * rounded date.
 */
describe('search provider evidence freshness', () => {
  it('no catalog entry carries a verifiedAt in the future', () => {
    const now = Date.now();
    for (const entry of DEFAULT_ORIGIN_SEARCH_PROVIDER_CATALOG) {
      const verifiedAt = Date.parse(entry.verifiedAt);
      expect(Number.isFinite(verifiedAt), `${entry.providerId}: verifiedAt must parse`).toBe(true);
      expect(
        verifiedAt,
        `${entry.providerId}: verifiedAt (${entry.verifiedAt}) must not be in the future`,
      ).toBeLessThanOrEqual(now);
    }
  });
});
