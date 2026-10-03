// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/image-edit-private-heldout-v1.yml'), 'utf8');
const runner = readFileSync(resolve(process.cwd(), 'scripts/run-image-edit-private-heldout-v1.ts'), 'utf8');
const inspector = readFileSync(resolve(process.cwd(), 'scripts/inspect-image-edit-private-corpus-v1.ts'), 'utf8');

describe('Image edit private held-out runner V1', () => {
  it('is manual-only, main-only and exact-SHA bound', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('\n  push:');
    expect(workflow).not.toContain('\n  pull_request:');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('test "$CANDIDATE_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"');
  });

  it('verifies the sealed corpus before creating its one-shot marker', () => {
    const metadata = workflow.indexOf('Verify exact candidate and sealed edit corpus metadata');
    const readiness = workflow.indexOf('Prove live Cloudflare Free raster readiness');
    const marker = workflow.indexOf('Preserve one-shot marker before private candidate execution');
    expect(metadata).toBeGreaterThan(0);
    expect(readiness).toBeGreaterThan(metadata);
    expect(marker).toBeGreaterThan(readiness);
    expect(workflow).toContain('secrets.ORIGIN_IMAGE_EDIT_PRIVATE_CORPUS_GZIP_B64');
    expect(workflow).toContain('if(value.taskCount!==16) process.exit(4);');
    expect(inspector).not.toContain('tasks: corpus.tasks');
    expect(inspector).not.toContain('instruction:');
    expect(inspector).not.toContain('sourceImageDataUrl');
  });

  it('requires live zero-cost raster readiness before consuming the corpus', () => {
    expect(workflow).toContain("ORIGIN_RASTER_LIVE_QUALIFICATION: 'true'");
    expect(workflow).toContain('npm run qualify:raster-live');
    expect(workflow).toContain('secrets.CLOUDFLARE_ACCOUNT_ID');
    expect(workflow).toContain('secrets.CLOUDFLARE_API_TOKEN');
    expect(workflow).not.toContain('continue-on-error: true');
  });

  it('executes the real edit route exactly once per private run without favorable retries', () => {
    expect(runner).toContain('createRasterImageV15Router');
    expect(runner).toContain('/api/creative/v1.5/raster/edit');
    expect(runner).toContain('referenceImages: [task.sourceImageDataUrl]');
    expect(runner).toContain('IMAGE_EDIT_PRIVATE_IDENTICAL_FALSE_EDIT');
    expect(runner).toContain("'quota-limited'");
    expect(workflow.match(/npm run eval:image-edit-private/g)).toHaveLength(1);
    expect(workflow).not.toContain('matrix:');
  });

  it('fails technical qualification unless zero-cost delivery integrity and changed bytes are proven', () => {
    expect(runner).toContain("response.headers.get('x-origin-visual-task') === 'edit'");
    expect(runner).toContain("response.headers.get('x-origin-visual-reference-count') === '1'");
    expect(runner).toContain("response.headers.get('x-origin-free-only') === 'true'");
    expect(runner).toContain("response.headers.get('x-origin-cost-usd') === '0'");
    expect(runner).toContain("response.headers.get('x-origin-paid-fallback') === 'false'");
    expect(runner).toContain('&& !identicalToSource');
    expect(runner).toContain("qualificationStatus: 'NOT_MEASURED'");
  });

  it('keeps private source bytes and instructions out of the sanitized evidence surface', () => {
    const outputSection = runner.slice(runner.indexOf("await fs.writeFile(path.join(outputRoot, 'public-tasks.json')"));
    expect(outputSection).not.toContain('instruction: task.instruction');
    expect(outputSection).not.toContain('sourceImageDataUrl: task.sourceImageDataUrl');
    expect(outputSection).toContain('instructionSha256: task.instructionSha256');
    expect(outputSection).toContain('sourceImageSha256: task.sourceImageSha256');
    expect(workflow).toContain("-name '*source*'");
    expect(workflow).toContain("-name '*instruction*'");
  });
});
