import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const IMAGE_EVALUATION_STATIC_RULES_V16 = Object.freeze([
  {
    id: 'generation-shards',
    file: '.github/workflows/world-class-image-private-shards-v1.yml',
    tests: [
      /workflow_dispatch:/,
      /github\.ref == 'refs\/heads\/main'/,
      /m\.taskCount!==24/,
      /m\.shardCount!==12/,
      /origin-image-ai-free-account-day-/,
      /ORIGIN_IMAGE_PRIVATE_CORPUS_GZIP_B64/,
      /scripts\/preflight-world-class-image-v16\.ts/,
    ],
  },
  {
    id: 'editing-shards',
    file: '.github/workflows/world-class-image-edit-private-shards-v1.yml',
    tests: [
      /workflow_dispatch:/,
      /github\.ref == 'refs\/heads\/main'/,
      /m\.taskCount!==16/,
      /m\.editShardCount!==8/,
      /origin-image-ai-free-account-day-/,
      /ORIGIN_IMAGE_EDIT_PRIVATE_CORPUS_GZIP_B64/,
      /scripts\/preflight-world-class-image-v16\.ts/,
    ],
  },
  {
    id: 'generation-provenance',
    file: '.github/workflows/world-class-image-private-collect-v1.yml',
    tests: [/workflow_dispatch:/, /github\.ref == 'refs\/heads\/main'/, /eval:image-private-shards-verify/, /productionQualified!==false/],
  },
  {
    id: 'editing-provenance',
    file: '.github/workflows/world-class-image-edit-private-collect-v1.yml',
    tests: [/workflow_dispatch:/, /github\.ref == 'refs\/heads\/main'/, /eval:image-edit-private-shards-verify/, /productionQualified!==false/],
  },
  {
    id: 'runtime-release-gate',
    file: 'src/creative/worldClassImageZeroCostRouter.ts',
    tests: [
      /EXACT_WORLD_CLASS_MODEL_V16 = '@cf\/black-forest-labs\/flux-2-klein-9b'/,
      /ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA/,
      /ORIGIN_IMAGE_WORLD_CLASS_ENABLED/,
      /WORLD_CLASS_IMAGE_PRODUCTION_DISABLED/,
      /WORLD_CLASS_IMAGE_SHA_NOT_QUALIFIED/,
      /WORLD_CLASS_FREE_IMAGE_SAFETY_GATE_FAILED/,
      /costUsd !== 0/,
    ],
  },
  {
    id: 'free-shard-accounting',
    file: 'src/release/OriginImageWorkersFreeShardPlanV1.ts',
    tests: [/dailyNeurons: 10_000/, /maxCasesPerShard: 2/, /requiresLiveFreePlanAndQuotaProof: true/, /maxGenerationAttemptsPerCase: 2/],
  },
  {
    id: 'blind-generation-independent-review',
    file: 'src/release/OriginImageBlindBenchmarkV15.ts',
    tests: [
      /REQUIRED_REFERENCES = 3/,
      /REQUIRED_JUDGES = 2/,
      /REQUIRED_CASES = IMAGE_FAMILIES_V15.length \* REQUIRED_CASES_PER_FAMILY/,
      /IMAGE_BENCHMARK_INDEPENDENT_JUDGES_LT_2/,
      /IMAGE_BENCHMARK_REQUIRES_24_CASES/,
    ],
  },
  {
    id: 'blind-editing-independent-review',
    file: 'src/release/OriginImageEditBlindBenchmarkV1.ts',
    tests: [
      /REQUIRED_REFERENCES = 3/,
      /REQUIRED_JUDGES = 2/,
      /REQUIRED_CASES = IMAGE_EDIT_FAMILIES_V1.length \* REQUIRED_CASES_PER_FAMILY/,
      /IMAGE_EDIT_BENCHMARK_INDEPENDENT_JUDGES_LT_2/,
      /IMAGE_EDIT_BENCHMARK_REQUIRES_16_CASES/,
    ],
  },
  {
    id: 'blind-editing-judge-cli',
    file: 'scripts/evaluate-image-edit-blind-quality-v1.ts',
    tests: [
      /evaluateOriginImageEditBlindBenchmarkV1/,
      /if \(!report.passed\) process.exit\(1\)/,
    ],
  },
  {
    id: 'protection-of-production',
    file: '.github/workflows/production-world-class-image-safety.yml',
    tests: [
      /qualified="\$\(jq -r/,
      /enabled="\$\(jq -r/,
      /WORLD_CLASS_IMAGE_PRODUCTION_DISABLED/,
      /WORLD_CLASS_IMAGE_SHA_NOT_QUALIFIED/,
    ],
  },
]);

/** Static only: no Cloudflare requests, no secrets, no private corpus reads. */
export function inspectImageEvaluationReadinessV16(candidateSha, readText) {
  if (!/^[a-f0-9]{40}$/.test(candidateSha)) {
    throw new Error('IMAGE_EVAL_READINESS_EXACT_SHA_REQUIRED');
  }
  const checks = IMAGE_EVALUATION_STATIC_RULES_V16.map(rule => {
    let source = '';
    try {
      source = readText(rule.file);
    } catch {
      return { id: rule.id, passed: false, failure: 'REQUIRED_FILE_MISSING' };
    }
    const passed = rule.tests.every(pattern => pattern.test(source));
    return {
      id: rule.id,
      passed,
      ...(passed ? {} : { failure: 'STATIC_POLICY_ASSERTION_FAILED' }),
    };
  });
  const staticGatePassed = checks.every(c => c.passed);
  return {
    schemaVersion: 'origin.image-v16-evaluation-readiness.v1',
    candidateSha,
    checks,
    staticGatePassed,
    genuineQualityEvaluationExecuted: false,
    liveCloudflareFreeQuotaVerified: false,
    independentBlindComparisonPassed: false,
    productionQualified: false,
    productionReleaseAuthorized: false,
    requiredGenerationCases: 24,
    requiredEditingCases: 16,
    generationShardCount: 12,
    editingShardCount: 8,
    minimumDistinctUtcAccountDays: 20,
    realInferenceWorkflowScope: 'manual-main-only',
    manualOwnerReleaseGate: true,
    blockers: [
      ...checks.filter(c => !c.passed).map(c => 'STATIC_CHECK_FAILED:' + c.id),
      'PROTECTED_MAIN_ONLY_LIVE_EVALUATION_NOT_AUTHORIZED',
      'SEALED_GENERATION_AND_EDIT_CORPUS_PROVENANCE_NOT_ATTESTED',
      'CLOUDFLARE_FREE_PLAN_AND_DAILY_QUOTA_NOT_LIVE_VERIFIED',
      'TWENTY_DISTINCT_UTC_ACCOUNT_DAYS_AND_FORTY_REAL_OUTPUTS_NOT_ATTESTED',
      'INDEPENDENT_SOURCE_BLIND_VISUAL_RATINGS_NOT_ATTESTED',
      'OWNER_VISUAL_APPROVAL_AND_EXACT_HEAD_RELEASE_NOT_ATTESTED',
    ],
  };
}

function main() {
  const sha = process.env.ORIGIN_EVAL_CANDIDATE_SHA?.trim().toLowerCase() ?? '';
  const actual = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
  if (sha !== actual) throw new Error('IMAGE_EVAL_READINESS_HEAD_MISMATCH');
  const report = inspectImageEvaluationReadinessV16(sha, file =>
    readFileSync(resolve(process.cwd(), file), 'utf8'));
  const output = process.env.ORIGIN_EVAL_READINESS_REPORT || 'test-results/image-v16-evaluation-readiness.json';
  mkdirSync(resolve(output, '..'), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({
    candidateSha: sha,
    staticGatePassed: report.staticGatePassed,
    liveEvaluationExecuted: false,
    productionQualified: false,
    blockedRequirements: report.blockers,
  }) + '\n');
  if (!report.staticGatePassed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) {
    process.stderr.write((error instanceof Error ? error.message : 'IMAGE_EVAL_READINESS_UNKNOWN_ERROR') + '\n');
    process.exitCode = 1;
  }
}
