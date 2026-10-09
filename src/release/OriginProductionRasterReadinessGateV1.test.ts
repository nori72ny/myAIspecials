// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/production-raster-readiness.yml'),
  'utf8',
);

describe('Production raster readiness gate V1', () => {
  it('only runs after an explicit, exact-SHA postpublication dispatch on main', () => {
    expect(workflow).not.toContain('workflow_run:');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('promoted_sha:');
    expect(workflow).toContain('required: true');
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('[ "$PROMOTED_SHA" = "$GITHUB_SHA" ]');
  });

  it('binds evidence to the exact manually promoted main SHA and rejects production drift', () => {
    expect(workflow).toContain('CANDIDATE_SHA: ${{ github.sha }}');
    expect(workflow).toContain('candidate_sha=$CANDIDATE_SHA');
    expect(workflow).toContain('/api/health');
    expect(workflow).toContain("deployed_sha=\"$(jq -r '.releaseSha // empty' \"$health_file\")\"");
    expect(workflow).toContain('if [ "$deployed_sha" != "$CANDIDATE_SHA" ]');
    expect(workflow).toContain('exit 20');
    expect(workflow).toContain('exit 23');
  });

  it('fails closed unless production image editing is actually ready and zero-cost', () => {
    expect(workflow).toContain('/api/creative/v1.5/raster/status');
    expect(workflow).toContain("if [ \"$http_status\" != '200' ]");
    expect(workflow).toContain('.configured == true');
    expect(workflow).toContain('.ready == true');
    expect(workflow).toContain('.zeroCostVerified == true');
    expect(workflow).toContain('.paymentMethodRequired == false');
    expect(workflow).toContain('.paidFallbackEnabled == false');
    expect(workflow).toContain('.freeOnly == true');
    expect(workflow).toContain('.costUsd == 0');
    expect(workflow).toContain('.modelBasedImageEditing == true');
    expect(workflow).toContain('.secretDelivery == "server-only"');
    expect(workflow).toContain('index("edit") != null');
    expect(workflow).toContain('exit 21');
    expect(workflow).toContain('exit 22');
  });

  it('never requires or prints Cloudflare credential values', () => {
    expect(workflow).not.toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(workflow).not.toContain('CLOUDFLARE_API_TOKEN');
    expect(workflow).not.toContain('continue-on-error: true');
  });
});
