// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'scripts/collect-world-class-image-free-shards-v1.ts'), 'utf8');
const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/world-class-image-private-collect-v1.yml'), 'utf8');

describe('authenticated GitHub provenance of private Free image shards', () => {
  it('is exact-main manual-only and has no secret corpus or Cloudflare access', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).not.toContain('\n  push:');
    expect(workflow).not.toContain('\n  pull_request:');
    expect(workflow).not.toContain('CLOUDFLARE_API_TOKEN');
    expect(workflow).not.toContain('ORIGIN_IMAGE_PRIVATE_CORPUS_GZIP_B64');
    expect(workflow).toContain('test "$CANDIDATE_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('actions: read');
    expect(workflow).not.toContain('contents: write');
  });

  it('rejects counterfeit or partial GitHub runs before downloading any files', () => {
    expect(source).toContain("run.conclusion === 'success'");
    expect(source).toContain("run.event === 'workflow_dispatch'");
    expect(source).toContain("run.head_sha === sha && run.head_branch === 'main'");
    expect(source).toContain("run.run_attempt === 1");
    expect(source).toContain("run.path.split('@')[0] === WORKFLOW_PATH");
    expect(source).toContain('matches.total_count === 1');
    expect(source).toContain('result.total_count <= 100');
    expect(source).toContain("marker.expired === false");
    expect(source).toContain('!seenRuns.has(runId!)');
    expect(source).toContain('!seenDays.has(day)');
    expect(source).toContain('matchesOutput.length === 1');
    expect(source).toContain('/^sha256:[a-f0-9]{64}$/.test(archiveDigest)');
  });

  it('downloads only the exact allowed artifact from the verified GitHub run', () => {
    expect(source).toContain("execFileSync('gh', ['run', 'download', String(runId)");
    expect(source).toContain("'--name', outputName, '--dir', destination");
    expect(source).toContain("const REPO = 'nori72ny/myAIspecials'");
    expect(source).not.toContain('execSync(');
    expect(source).not.toContain('shell: true');
    expect(source).toContain('downloaded.length === NUM_SHARDS');
    expect(workflow).toContain('npm run eval:image-private-shards-verify');
  });

  it('does not confuse provenance and SHA integrity with blind quality qualification', () => {
    expect(source).toContain('imageBytesLocallyVerified: false');
    expect(source).toContain('cloudflareFreeQuotaIndependentlyVerified: false');
    expect(source).toContain('independentBlindQualityPassed: false');
    expect(source).toContain('ownerVisualApproved: false');
    expect(source).toContain('productionQualified: false');
    expect(workflow).toContain('imageCaseCount!==24');
  });
});
