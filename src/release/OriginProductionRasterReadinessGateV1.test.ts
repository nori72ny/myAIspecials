// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/production-raster-readiness.yml'),
  'utf8',
);

describe('Production raster readiness gate V1', () => {
  it('runs only after a successful main Production Release or an explicit main dispatch', () => {
    expect(workflow).toContain('workflow_run:');
    expect(workflow).toContain('- Production Release CI/CD');
    expect(workflow).toContain('- main');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
  });

  it('binds evidence to the exact successful main SHA and rejects production drift', () => {
    expect(workflow).toContain('github.event.workflow_run.head_sha || github.sha');
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
