// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow=readFileSync(resolve(process.cwd(),'.github/workflows/image-private-heldout-v1.yml'),'utf8');
const runner=readFileSync(resolve(process.cwd(),'scripts/run-image-private-heldout-v1.ts'),'utf8');
const inspector=readFileSync(resolve(process.cwd(),'scripts/inspect-image-private-corpus-v1.ts'),'utf8');

describe('Image private held-out runner V1',()=>{
  it('requires live free qualification before consuming the one-shot corpus',()=>{
    const qualification=workflow.indexOf('Prove live Cloudflare Free raster readiness');
    const marker=workflow.indexOf('Preserve one-shot marker before private candidate execution');
    expect(qualification).toBeGreaterThan(0);
    expect(marker).toBeGreaterThan(qualification);
    expect(workflow).toContain("ORIGIN_RASTER_LIVE_QUALIFICATION: 'true'");
    expect(workflow).toContain('npm run qualify:raster-live');
  });

  it('is manual-only/main-only and accepts secrets only through GitHub secret fields',()=>{
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('\n  push:');
    expect(workflow).not.toContain('\n  pull_request:');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('secrets.CLOUDFLARE_ACCOUNT_ID');
    expect(workflow).toContain('secrets.CLOUDFLARE_API_TOKEN');
    expect(workflow).toContain('secrets.ORIGIN_IMAGE_PRIVATE_CORPUS_GZIP_B64');
    expect(workflow).not.toContain('prompt:');
  });

  it('runs the real raster router and validates bytes with structural and pixel critics',()=>{
    expect(runner).toContain('createRasterImageV15Router');
    expect(runner).toContain('/api/creative/v1.5/raster/generate');
    expect(runner).toContain('critiqueRasterStructureV15');
    expect(runner).toContain('scoreRasterPixelsV15');
    expect(runner).toContain('chromium.launch');
    expect(runner).toContain("response.headers.get('x-origin-visual-sha256')===actualSha");
  });

  it('retains quota/provider/technical failures instead of retrying favorable samples',()=>{
    expect(runner).toContain("'quota-limited'");
    expect(runner).toContain("'IMAGE_PRIVATE_TECHNICAL_VALIDATION_FAILED'");
    expect(runner).toContain('failures:cases.filter');
    expect(workflow.match(/npm run eval:image-private/g)).toHaveLength(1);
    expect(workflow).not.toContain('matrix:');
    expect(workflow).not.toContain('continue-on-error: true');
  });

  it('keeps private prompts out of public evidence metadata',()=>{
    const outputSection=runner.slice(runner.indexOf("await fs.writeFile(path.join(outputRoot,'public-tasks.json')"));
    expect(outputSection).not.toContain('prompt:task.prompt');
    expect(outputSection).not.toContain('negativePrompt:task.negativePrompt');
    expect(outputSection).toContain('promptSha256:task.promptSha256');
    expect(outputSection).toContain('taskDigest:task.taskDigest');
    expect(inspector).not.toContain('tasks:corpus.tasks');
    expect(inspector).not.toContain('prompt');
  });
});
