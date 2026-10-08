// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const p = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const collector = p('scripts/collect-world-class-image-edit-free-shards-v1.ts');
const audit = p('scripts/verify-world-class-image-edit-private-shards-v1.ts');
const workflow = p('.github/workflows/world-class-image-edit-private-collect-v1.yml');
const packageFile = p('package.json');

describe('V1.6 private editing trusted eight-shard receipt integrity', () => {
  it('accepts only immutable main SHA and real GitHub successful original edit runs', () => {
    expect(collector).toContain("const NUM_SHARDS = 8");
    expect(collector).toContain("ORIGIN_IMAGE_EDIT_CANDIDATE_SHA");
    expect(collector).toContain("ORIGIN_IMAGE_EDIT_SHARD_PLAN_DIGEST");
    expect(collector).toContain("run.conclusion === 'success'");
    expect(collector).toContain("run.run_attempt === 1");
    expect(collector).toContain("run.path.split('@')[0] === WORKFLOW_PATH");
    expect(collector).toContain("origin-image-free-edit-shard-started-");
    expect(collector).toContain("origin-image-free-edit-shard-output-");
    expect(collector).toContain("matches.total_count === 1");
    expect(collector).toContain("!seenDays.has(day)");
    expect(collector).toContain("!seenRuns.has(runId!)");
  });
  it('rebuilds the 16-edit case frozen plan and validates final file bytes, not synthetic assertions', () => {
    expect(audit).toContain('planImageEditFreeShardsV1');
    expect(audit).toContain('plan.shards.length === 8');
    expect(audit).toContain('publicCases.length === 16');
    expect(audit).toContain('item.sourceImageSha256 === shard.sourceImageSha256s[index]');
    expect(audit).toContain('item.instructionSha256 === shard.instructionSha256s[index]');
    expect(audit).toContain('sha256(image) === imageSha');
    expect(audit).toContain('item.identicalToSource === false');
    expect(audit).toContain('!seenImages.has(imageSha)');
    expect(audit).toContain('await img.decode()');
    expect(audit).toContain('total === 16');
    expect(audit).toContain('EDIT_EXACT_9B_MODEL_REQUIRED');
  });
  it('keeps actual editing locality and visual quality unqualified until blinded comparison', () => {
    expect(audit).toContain('sourcePreservationBlindlyEvaluated: false');
    expect(audit).toContain('independentBlindEditQualityPassed: false');
    expect(audit).toContain('liveCloudflareQuotaUsageVerified: false');
    expect(audit).toContain('ownerVisualApproval: false');
    expect(audit).toContain('productionQualified: false');
    expect(workflow).toContain('npm run eval:image-edit-private-shards-verify');
    expect(workflow).toContain('editCaseCount!==16');
    expect(workflow).not.toContain('OPENROUTER_API_KEY');
    expect(packageFile).toContain(
      '"eval:image-edit-private-shards-verify": "tsx scripts/verify-world-class-image-edit-private-shards-v1.ts"',
    );
  });
});