// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/production-raster-e2e-v15.yml'), 'utf8');
const script = readFileSync(resolve(process.cwd(), 'scripts/verify-production-raster-e2e-v15.mjs'), 'utf8');

describe('V1.5 Production raster qualification workflow', () => {
  it('is explicit one-shot main-only work rather than an automatic quota consumer', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).not.toContain('\n  push:');
    expect(workflow).not.toContain('\n  pull_request:');
    expect(workflow).not.toContain('\n  schedule:');
    expect(workflow).toContain('cancel-in-progress: false');
  });

  it('binds the live check to an exact main SHA and canonical Production URL', () => {
    expect(workflow).toContain('expected_sha:');
    expect(workflow).toContain('required: true');
    expect(workflow).toContain('https://origin-personal.vercel.app');
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"');
    expect(script).toContain("health.releaseSha === expectedSha");
  });

  it('does not duplicate Cloudflare or other provider secrets into GitHub Actions', () => {
    expect(workflow).not.toContain('secrets.');
    expect(workflow).not.toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(workflow).not.toContain('CLOUDFLARE_API_TOKEN');
    expect(script).not.toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(script).not.toContain('CLOUDFLARE_API_TOKEN');
  });

  it('fails closed unless canonical Production proves exact zero-cost raster readiness', () => {
    expect(script).toContain("health.freeOnly === true");
    expect(script).toContain("Number(health.costUsd) === 0");
    expect(script).toContain("health.paidFallbackEnabled === false");
    expect(script).toContain("health.secretDelivery === 'server-only'");
    expect(script).toContain("status.zeroCostVerified === true");
    expect(script).toContain("status.paymentMethodRequired === false");
    expect(script).toContain("status.providerId === EXPECTED_PROVIDER");
    expect(script).toContain("status.model === EXPECTED_MODEL");
  });

  it('executes exactly one real image request and verifies bytes plus provenance', () => {
    expect(script.match(/\/api\/generate-image/g)?.length).toBe(1);
    expect(script).toContain("headers.get('x-origin-visual-verified') === 'true'");
    expect(script).toContain("headers.get('x-origin-cost-usd') === '0'");
    expect(script).toContain("headers.get('x-origin-paid-fallback') === 'false'");
    expect(script).toContain("networkRequests === 4");
    expect(script).toContain("RASTER_E2E_IMAGE_SIGNATURE_INVALID");
    expect(script).toContain("RASTER_E2E_IMAGE_DIMENSION_MISMATCH");
    expect(script).toContain("RASTER_E2E_SHA256_MISMATCH");
  });

  it('keeps semantic delivery disabled until separate effectiveness and quota evidence exists', () => {
    expect(script).toContain("status.semanticVisionCritic?.enabled === false");
    expect(script).toContain("headers.get('x-origin-visual-semantic-gate') === 'disabled'");
    expect(workflow).not.toContain('ORIGIN_RASTER_SEMANTIC_DELIVERY_GATE');
  });

  it('persists only compact public evidence, not generated image bytes', () => {
    expect(workflow).toContain('test-results/origin-production-raster-e2e.json');
    expect(workflow).not.toMatch(/\.(png|jpe?g|webp)/i);
    expect(script).toContain("schemaVersion: 'origin.production-raster-e2e.v1'");
  });
});
