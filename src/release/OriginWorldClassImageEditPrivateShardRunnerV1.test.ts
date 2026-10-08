// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'scripts/run-world-class-image-edit-private-shard-v1.ts'), 'utf8');
const inspect = readFileSync(resolve(process.cwd(), 'scripts/inspect-image-edit-private-corpus-v1.ts'), 'utf8');
const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/world-class-image-edit-private-shards-v1.yml'), 'utf8');
const packageFile = readFileSync(resolve(process.cwd(), 'package.json'), 'utf8');

describe('V1.6 world-class image edit Free-only private shard runner', () => {
  it('cannot evaluate V1.6 edits using the unrelated V1.5 release path', () => {
    expect(source).toContain('createWorldClassImageV16Router');
    expect(source).toContain('/api/creative/v1.6/world-class/edit');
    expect(source).not.toContain('createRasterImageV15Router');
    expect(source).not.toContain('/api/creative/v1.5/raster/edit');
    expect(source).toContain('referenceImages: [task.sourceImageDataUrl]');
    expect(source).toContain('IMAGE_EDIT_PRIVATE_IDENTICAL_FALSE_EDIT');
    expect(source).toContain("response.headers.get('x-origin-visual-task') === 'edit'");
    expect(source).toContain("response.headers.get('x-origin-world-class-evaluation') === 'true'");
    expect(source).toContain("response.headers.get('x-origin-release-sha') === candidateSha");
    expect(source).toContain("response.headers.get('x-origin-visual-quality-tier') === 'world-class-free'");
  });

  it('fails before sealed corpus inspection when real Cloudflare Free status is unproved', () => {
    expect(source).toContain('getCloudflareRasterStatusV15(process.env)');
    expect(source).toContain('!provider.zeroCostVerified || provider.paidFallbackEnabled');
    expect(source.indexOf('getCloudflareRasterStatusV15(process.env)'))
      .toBeLessThan(source.indexOf("requiredEnv('ORIGIN_IMAGE_EDIT_PRIVATE_CORPUS_GZIP_B64')"));
    expect(source).not.toContain('OPENROUTER_API_KEY');
  });

  it('requires exact frozen 16-case shard identity, original image and edit digest', () => {
    expect(source).toContain("requiredEnv('ORIGIN_IMAGE_EDIT_SHARD_INDEX')");
    expect(source).toContain("requiredEnv('ORIGIN_IMAGE_EDIT_SHARD_PLAN_DIGEST')");
    expect(source).toContain("requiredEnv('ORIGIN_IMAGE_EDIT_SHARD_UTC_DAY')");
    expect(source).toContain('planImageEditFreeShardsV1');
    expect(source).toContain("if (!selectedIds.has(task.caseId)) continue");
    expect(source).toContain('item.instructionSha256 !== shard.instructionSha256s[index]');
    expect(source).toContain('item.sourceImageSha256 !== shard.sourceImageSha256s[index]');
    expect(source).toContain('IMAGE_EDIT_FREE_SHARD_UTC_DAY_ROLLOVER');
    expect(source).toContain('cases.length !== shard.caseIds.length');
    expect(inspect).toContain('editShardCount: plan.shards.length');
    expect(inspect).not.toContain('sourceImageDataUrl');
  });

  it('limits account-wide daily quota shared with image generation, preserving real release gates', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).not.toContain('\n  push:');
    expect(workflow).not.toContain('\n  pull_request:');
    expect(workflow).toContain('origin-private-image-free-account-shards');
    expect(workflow).toContain("origin-image-ai-free-account-day-");
    expect(workflow).toContain('IMAGE_SHARD_ACCOUNT_DAY_ALREADY_CONSUMED');
    expect(workflow).toContain('m.editShardCount!==8');
    expect(workflow).toContain('for(let i=0;i<8;i++)');
    expect(workflow).toContain('ORIGIN_IMAGE_EDIT_SHARD_UTC_DAY:');
    expect(workflow).toContain('npm run eval:image-edit-private-world-class-shard');
    expect(workflow).not.toContain('OPENROUTER_API_KEY');
    expect(packageFile).toContain(
      '"eval:image-edit-private-world-class-shard": "tsx scripts/run-world-class-image-edit-private-shard-v1.ts"',
    );
    expect(source).toContain('independentBlindEditQualityPassed: false');
    expect(source).toContain('productionQualified: false');
    expect(workflow).not.toContain('continue-on-error: true');
  });
});
