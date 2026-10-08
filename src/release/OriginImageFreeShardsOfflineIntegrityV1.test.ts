// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = readFileSync(resolve(process.cwd(), 'scripts/verify-world-class-image-private-shards-v1.ts'), 'utf8');
const packageText = readFileSync(resolve(process.cwd(), 'package.json'), 'utf8');

describe('sealed Free image shard offline integrity verifier', () => {
  it('operates only on bounded, sealed on-disk evidence and not live model calls', () => {
    expect(script).toContain("process.env.ORIGIN_IMAGE_SHARD_BUNDLE_ROOT");
    expect(script).toContain("process.env.ORIGIN_IMAGE_CANDIDATE_SHA");
    expect(script).toContain("process.env.ORIGIN_IMAGE_SHARD_PLAN_DIGEST");
    expect(script).toContain('planImageWorkersFreeShardsV1');
    expect(script).toContain('const plan = planImageWorkersFreeShardsV1');
    expect(script).not.toContain('OPENROUTER_API_KEY');
    expect(script).not.toContain('CLOUDFLARE_API_TOKEN');
    expect(script).not.toContain('fetch(');
  });

  it('checks all 24 actual bytes rather than accepting hand-edited summaries', () => {
    expect(script).toContain('await fs.readFile(imgPath)');
    expect(script).toContain("digest(bytes) === outputHash");
    expect(script).toContain('readRasterDimensionsV15(bytes, mime)');
    expect(script).toContain("const browser = await chromium.launch({ headless: true })");
    expect(script).toContain('await img.decode()');
    expect(script).toContain('BROWSER_DECODE_DIMENSIONS_MISMATCH');
    expect(script).toContain('await browser.close()');
    expect(script).toContain('seenImageHashes.size === 24');
    expect(script).toContain('EXACT_9B_MODEL_REQUIRED');
    expect(script).toContain('total === 24');
    expect(script).toContain('Object.values(t).every(v => v === true)');
    expect(script).toContain('s?.passed === true && s.safetyPassed === true');
    expect(script).toContain('summary.technicallyPassed === shard.caseIds.length');
  });

  it('rejects counterfeit free-cost headers, reused days and changed models', () => {
    expect(script).toContain('ev.totalCostUsd === 0 && ev.maxImageCostUsd === 0');
    expect(script).toContain("item.providerId === 'cloudflare-workers-ai-free'");
    expect(script).toContain('item.costUsd === 0');
    expect(script).toContain('!seenDays.has(day)');
    expect(script).toContain('!seenRunIds.has(run)');
    expect(script).toContain("readJson(path.join(root, 'github-provenance.json'))");
    expect(script).toContain("provenance.trustedGithubRunAndArtifactMetadata === true");
    expect(script).toContain("receipt.githubRunId === Number(run)");
    expect(script).toContain("TRUSTED_GITHUB_RUN_RECEIPT_MISMATCH");
    expect(script).toContain('modelIds.size === 1');
  });

  it('never claims verified GitHub provenance, a blind benchmark win or release approval', () => {
    expect(script).toContain('authenticatedGitHubArtifactProvenance: false');
    expect(script).toContain('liveFreeQuotaUsageVerified: false');
    expect(script).toContain('independentBlindQualityPassed: false');
    expect(script).toContain('ownerVisualApproval: false');
    expect(script).toContain('productionQualified: false');
    expect(packageText).toContain(
      '"eval:image-private-shards-verify": "tsx scripts/verify-world-class-image-private-shards-v1.ts"',
    );
  });
});
