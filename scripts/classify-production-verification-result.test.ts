// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { classifyProductionVerificationResult } from './classify-production-verification-result.mjs';

describe('production verification result classification', () => {
  it('marks a successful production verification as available and non-blocking', () => {
    expect(classifyProductionVerificationResult(0, '')).toEqual({
      releaseVerified: true,
      upstreamAvailability: 'available',
      providerCode: null,
      releaseBlocking: false,
    });
  });

  it('classifies the explicit free-provider daily quota failure as degraded without hiding it', () => {
    const stderr = 'Production /api/chat must return HTTP 200; received 429; code=PROVIDER_RATE_LIMITED; x-vercel-id=synthetic; body=[response body withheld]';
    expect(classifyProductionVerificationResult(1, stderr)).toEqual({
      releaseVerified: true,
      upstreamAvailability: 'degraded',
      providerCode: 'PROVIDER_RATE_LIMITED',
      releaseBlocking: false,
    });
  });

  it.each([
    'Production /api/chat must return HTTP 200; received 503; code=PROVIDER_UNAVAILABLE; body=[response body withheld]',
    'Production did not expose expected main SHA within the bounded window.',
    'Production /api/chat must return HTTP 200; received 429; code=UNKNOWN; body=[response body withheld]',
    '',
  ])('keeps every other verification failure release-blocking: %s', (stderr) => {
    expect(classifyProductionVerificationResult(1, stderr)).toMatchObject({
      releaseVerified: false,
      upstreamAvailability: 'unknown',
      releaseBlocking: true,
    });
  });

  it('fails closed for malformed exit codes even when the text contains a quota marker', () => {
    const stderr = 'Production /api/chat must return HTTP 200; received 429; code=PROVIDER_RATE_LIMITED;';
    expect(classifyProductionVerificationResult('not-an-exit-code', stderr)).toMatchObject({
      releaseVerified: false,
      releaseBlocking: true,
    });
  });
});
