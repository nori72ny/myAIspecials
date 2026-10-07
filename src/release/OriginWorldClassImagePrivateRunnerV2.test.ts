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
const preflight = readFileSync(
  resolve(process.cwd(), 'scripts/preflight-world-class-image-v16.ts'),
  'utf8',
);
const packageJson = readFileSync(resolve(process.cwd(), 'package.json'), 'utf8');

describe('World-class image private held-out runner V2', () => {
  it('is manual-only, main-only and requires explicit paid evaluation approval', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('\n  push:');
    expect(workflow).not.toContain('\n  pull_request:');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('inputs.confirm_paid_evaluation == true');
    expect(workflow).toContain("default: false");
  });

  it('proves the real OpenRouter model before the sealed corpus is inspected', () => {
    const provider = workflow.indexOf('Prove OpenRouter image model readiness before sealed corpus access');
    const corpus = workflow.indexOf('Verify sealed corpus metadata only after provider preflight');
    expect(provider).toBeGreaterThan(0);
    expect(corpus).toBeGreaterThan(provider);
    expect(preflight).toContain('createWorldClassImageV16Router');
    expect(preflight).toContain('evaluationReady !== true');
    expect(preflight).toContain("provider !== 'openrouter-image-api'");
  });

  it('binds exact candidate SHA and enforces per-image and total spend caps', () => {
    expect(workflow).toContain('test "$CANDIDATE_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('max_image_cost_usd');
    expect(workflow).toContain('max_total_cost_usd');
    expect(runner).toContain('WORLD_CLASS_IMAGE_PRIVATE_COST_CAP_INVALID');
    expect(runner).toContain('WORLD_CLASS_IMAGE_PRIVATE_TOTAL_COST_CAP_REACHED');
    expect(runner).toContain('WORLD_CLASS_IMAGE_PRIVATE_TOTAL_COST_CAP_EXCEEDED');
  });

  it('executes the same V1.6 world-class route that can later be published', () => {
    expect(runner).toContain('createWorldClassImageV16Router');
    expect(runner).toContain('/api/creative/v1.6/world-class/generate');
    expect(runner).toContain("systemId: 'origin-world-class-v16'");
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

  it('runs each candidate case once and does not add favorable retry fan-out', () => {
    expect(workflow.match(/npm run eval:image-private-world-class/g)).toHaveLength(1);
    expect(workflow).not.toContain('matrix:');
    expect(workflow).not.toContain('continue-on-error: true');
    expect(runner).not.toContain('Promise.all(corpus.tasks');
  });

  it('keeps sealed prompt text out of public task metadata', () => {
    const publicSection = runner.slice(runner.indexOf("'public-tasks.json'"));
    expect(publicSection).not.toContain('prompt: task.prompt');
    expect(publicSection).not.toContain('negativePrompt: task.negativePrompt');
    expect(publicSection).toContain('promptSha256: task.promptSha256');
    expect(publicSection).toContain('taskDigest: task.taskDigest');
  });

  it('registers the dedicated world-class runner command', () => {
    expect(packageJson).toContain(
      '"eval:image-private-world-class": "tsx scripts/run-world-class-image-private-heldout-v2.ts"',
    );
  });
});
