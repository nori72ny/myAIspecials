// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/world-class-image-private-heldout-v2.yml'),
  'utf8',
);
const runner = readFileSync(
  resolve(process.cwd(), 'scripts/run-world-class-image-private-heldout-v2.ts'),
  'utf8',
);
const packageJson = readFileSync(resolve(process.cwd(), 'package.json'), 'utf8');

describe('World-class image private held-out runner V2', () => {
  it('is manual-only, main-only and permanently zero-cost', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('\n  push:');
    expect(workflow).not.toContain('\n  pull_request:');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).not.toContain('confirm_paid_evaluation');
    expect(workflow).not.toContain('max_image_cost_usd');
    expect(workflow).not.toContain('max_total_cost_usd');
    expect(workflow).not.toContain('OPENROUTER_API_KEY');
  });

  it('fails before Cloudflare inference when 24-case Free quota cannot fit into one day', () => {
    const budgetGuard = workflow.indexOf('Block unsafe one-day 24-case FLUX 9B Free benchmark');
    const providerProbe = workflow.indexOf('Prove Cloudflare Free image readiness before sealed corpus access');
    expect(budgetGuard).toBeGreaterThan(0);
    expect(providerProbe).toBeGreaterThan(budgetGuard);
    expect(workflow).toContain('monolithicImageFreePlanIsSafeV1(24)');
    expect(workflow).toContain('WORLD_CLASS_IMAGE_PRIVATE_MULTI_DAY_SHARDING_REQUIRED');
  });

  it('proves Cloudflare Free readiness before the sealed corpus is inspected', () => {
    const provider = workflow.indexOf('Prove Cloudflare Free image readiness before sealed corpus access');
    const corpus = workflow.indexOf('Verify sealed corpus metadata only after provider preflight');
    expect(provider).toBeGreaterThan(0);
    expect(corpus).toBeGreaterThan(provider);
    expect(workflow).toContain("ORIGIN_CLOUDFLARE_IMAGE_MODEL: '@cf/black-forest-labs/flux-2-klein-9b'");
    expect(workflow).toContain("ORIGIN_RASTER_LIVE_QUALIFICATION='true' npm run qualify:raster-live");
  });

  it('binds exact candidate SHA and requires exact zero-cost evidence', () => {
    expect(workflow).toContain('test "$CANDIDATE_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('if(evidence.totalCostUsd!==0 || summary.totalCostUsd!==0) process.exit(31)');
    expect(workflow).toContain('evidence.cases.some((c)=>c.costUsd!==0)');
    expect(workflow).toContain("startsWith('cloudflare-workers-ai-free::')");
    expect(runner).toContain('maxImageCostUsd: 0');
    expect(runner).toContain('maxTotalCostUsd: 0');
    expect(runner).toContain('WORLD_CLASS_IMAGE_PRIVATE_NONZERO_COST');
    expect(runner).not.toContain('OPENROUTER_API_KEY');
  });

  it('executes the same zero-cost V1.6 compatibility route that can later be published', () => {
    expect(runner).toContain('createWorldClassImageV16Router');
    expect(runner).toContain('/api/creative/v1.6/world-class/generate');
    expect(runner).toContain("systemId: 'origin-world-class-zero-cost'");
    expect(runner).toContain("response.headers.get('x-origin-free-only') === 'true'");
    expect(runner).toContain("providerId === 'cloudflare-workers-ai-free'");
    expect(runner).toContain("costUsd === 0");
    expect(runner).toContain("response.headers.get('x-origin-release-sha') === candidateSha");
    expect(runner).toContain("response.headers.get('x-origin-world-class-evaluation') === 'true'");
    expect(runner).toContain("!response.headers.get('x-origin-world-class-qualified-sha')");
  });

  it('keeps independent technical, pixel and safety evidence before persisting bytes', () => {
    expect(runner).toContain('readRasterDimensionsV15');
    expect(runner).toContain('scoreRasterPixelsV15');
    expect(runner).toContain('critiqueCloudflareRasterSemanticV15');
    expect(runner).toContain('semantic?.safetyPassed === true');
    expect(runner).toContain('const networkWriteSafe = passed');
    expect(runner).toContain('// codeql[js/http-to-file-access]');
    expect(runner.indexOf('if (networkWriteSafe) {')).toBeLessThan(
      runner.indexOf('await fs.writeFile(path.join(outputDir, artifactFile), bytes'),
    );
  });

  it('runs each candidate case once and does not add paid-provider fan-out', () => {
    expect(workflow.match(/npm run eval:image-private-world-class/g)).toHaveLength(1);
    expect(workflow).not.toContain('matrix:');
    expect(workflow).not.toContain('continue-on-error: true');
    expect(runner).not.toContain('Promise.all(corpus.tasks');
    expect(runner).not.toContain('openrouter-image-api');
  });

  it('keeps sealed prompt text out of public task metadata', () => {
    const publicSection = runner.slice(runner.indexOf("'public-tasks.json'"));
    expect(publicSection).not.toContain('prompt: task.prompt');
    expect(publicSection).not.toContain('negativePrompt: task.negativePrompt');
    expect(publicSection).toContain('promptSha256: task.promptSha256');
    expect(publicSection).toContain('taskDigest: task.taskDigest');
  });

  it('registers the dedicated zero-cost world-class runner command', () => {
    expect(packageJson).toContain(
      '"eval:image-private-world-class": "tsx scripts/run-world-class-image-private-heldout-v2.ts"',
    );
  });
});
