// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const workflow = read('.github/workflows/world-class-image-private-shards-v1.yml');
const runner = read('scripts/run-world-class-image-private-heldout-v2.ts');
const corpusInspector = read('scripts/inspect-image-private-corpus-v1.ts');
const freeProviderPreflight = read('scripts/preflight-world-class-image-v16.ts');
const legacyWorkflow = read('.github/workflows/world-class-image-private-heldout-v2.yml');

describe('World-class image Workers Free sharded execution safety', () => {
  it('is manual main-only, serialized per free account and strictly zero-cost', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).not.toContain('\n  push:');
    expect(workflow).not.toContain('\n  pull_request:');
    expect(workflow).not.toContain('continue-on-error: true');
    expect(workflow).not.toContain('matrix:');
    expect(workflow).toContain('origin-private-image-free-account-shards');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('ORIGIN_CLOUDFLARE_IMAGE_MODEL:');
    expect(workflow).not.toContain('OPENROUTER_API_KEY');
    expect(workflow).not.toContain('GOOGLE_API_KEY');
  });

  it('binds immutable SHA, sealed corpus and plan before image inference', () => {
    const free = workflow.indexOf('Verify Free plan and model readiness without consuming image quota');
    const metadata = workflow.indexOf('Verify 24-case private corpus and immutable shard plan');
    const replayGuard = workflow.indexOf('Refuse duplicate shard or second shard on the same UTC day');
    const marker = workflow.indexOf('Persist one-shot marker before image inference');
    const inference = workflow.indexOf('Execute only the sealed two-case shard via release route');
    expect(free).toBeGreaterThan(0);
    expect(metadata).toBeGreaterThan(free);
    expect(replayGuard).toBeGreaterThan(metadata);
    expect(marker).toBeGreaterThan(replayGuard);
    expect(inference).toBeGreaterThan(marker);
    expect(workflow).toContain('test "$GITHUB_SHA" = "$CANDIDATE_SHA"');
    expect(workflow).toContain('m.shardPlanDigest!==process.env.PLAN_DIGEST');
    expect(workflow).toContain('m.taskCount!==24 || m.shardCount!==12');
    expect(workflow).toContain('ORIGIN_IMAGE_SHARD_PLAN_DIGEST:');
    expect(workflow).toContain('ORIGIN_IMAGE_SHARD_INDEX:');
    expect(workflow).toContain('origin-image-free-shard-started-');
    expect(workflow).toContain('markers.some(a=>a.name.endsWith');
  });

  it('does not allow old 24-case workflow to accidentally run', () => {
    expect(legacyWorkflow).toContain('WORLD_CLASS_IMAGE_PRIVATE_MULTI_DAY_SHARDING_REQUIRED');
    expect(legacyWorkflow).toContain('monolithicImageFreePlanIsSafeV1(24)');
    expect(runner).toContain("requiredEnv('ORIGIN_IMAGE_SHARD_INDEX')");
    expect(runner).toContain("requiredEnv('ORIGIN_IMAGE_SHARD_PLAN_DIGEST')");
    expect(runner).toContain("throw new Error('WORLD_CLASS_IMAGE_PRIVATE_SHARD_PLAN_MISMATCH')");
    expect(runner).toContain('if (!chosenCaseIds.has(task.caseId)) continue');
    expect(runner).toContain('cases.length !== shard.caseIds.length');
    expect(runner).not.toContain('Promise.all(corpus.tasks');
    expect(runner).toContain("filename: 'unreachable'".replace("filename: 'unreachable'", "shard-manifest.json"));
  });

  it('publishes metadata only and never asserts blind superiority or quota telemetry', () => {
    expect(runner).toContain('trustedQuotaUsageVerified: false');
    expect(runner).toContain('trustedProvenanceVerified: false');
    expect(runner).toContain('blindBenchmarkPassed: false');
    expect(runner).toContain('productionQualified: false');
    expect(runner).toContain("const networkWriteSafe = passed");
    expect(runner).toContain('const chosenCaseIds = new Set(shard.caseIds)');
    expect(corpusInspector).toContain('planImageWorkersFreeShardsV1');
    expect(corpusInspector).toContain('shardPlanDigest: shardPlan.planDigest');
    expect(freeProviderPreflight).toContain("requiredEnv('CLOUDFLARE_API_TOKEN')");
    expect(freeProviderPreflight).toContain("body.provider !== 'cloudflare-workers-ai-free'");
    expect(freeProviderPreflight).toContain('body.costUsd !== 0');
    expect(freeProviderPreflight).not.toContain('OPENROUTER_API_KEY');
  });
});
