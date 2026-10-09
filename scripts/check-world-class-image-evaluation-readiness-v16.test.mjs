import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectImageEvaluationReadinessV16,
  IMAGE_EVALUATION_STATIC_RULES_V16,
} from './check-world-class-image-evaluation-readiness-v16.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sha = 'a'.repeat(40);
const read = filename => readFileSync(resolve(process.cwd(), filename), 'utf8');

test('existing generation/edit shards and production kill switch pass static readiness without quota', () => {
  const report = inspectImageEvaluationReadinessV16(sha, read);
  assert.equal(report.staticGatePassed, true);
  assert.equal(report.genuineQualityEvaluationExecuted, false);
  assert.equal(report.productionQualified, false);
  assert.equal(report.liveCloudflareFreeQuotaVerified, false);
  assert.equal(report.requiredGenerationCases, 24);
  assert.equal(report.requiredEditingCases, 16);
  assert.equal(report.minimumDistinctUtcAccountDays, 20);
  assert.ok(report.blockers.includes('PROTECTED_MAIN_ONLY_LIVE_EVALUATION_NOT_AUTHORIZED'));
  assert.ok(report.checks.every(c => c.passed));
});

test('rejects absent or untrusted exact SHA before assembling a report', () => {
  assert.throws(() => inspectImageEvaluationReadinessV16('missing', read), /EXACT_SHA_REQUIRED/);
});

test('missing real inference workflow fails closed but does not invent quality outcomes', () => {
  const report = inspectImageEvaluationReadinessV16(sha, filename =>
    filename.includes('image-edit-private-shards-v1') ? '' : read(filename));
  assert.equal(report.staticGatePassed, false);
  assert.ok(report.blockers.includes('STATIC_CHECK_FAILED:editing-shards'));
  assert.equal(report.independentBlindComparisonPassed, false);
});

test('removing the Owner Production activation check blocks static readiness', () => {
  const report = inspectImageEvaluationReadinessV16(sha, filename =>
    filename.endsWith('worldClassImageZeroCostRouter.ts')
      ? read(filename).replaceAll('ORIGIN_IMAGE_WORLD_CLASS_ENABLED', 'DISABLED_GATE')
      : read(filename));
  assert.equal(report.staticGatePassed, false);
  assert.ok(report.blockers.includes('STATIC_CHECK_FAILED:runtime-release-gate'));
});

test('a missing required file fails closed, never claims real images were evaluated', () => {
  const report = inspectImageEvaluationReadinessV16(sha, filename => {
    if (filename.endsWith('production-world-class-image-safety.yml')) throw new Error('Not found');
    return read(filename);
  });
  assert.equal(report.staticGatePassed, false);
  assert.ok(report.blockers.includes('STATIC_CHECK_FAILED:protection-of-production'));
  assert.equal(report.genuineQualityEvaluationExecuted, false);
});

test('readiness gate remains static: no secret or inference dependency in script', () => {
  const source = read('scripts/check-world-class-image-evaluation-readiness-v16.mjs');
  assert.equal(/\bfetch\s*\(/.test(source), false);
  assert.equal(/\bCLOUDFLARE_API_TOKEN\b/.test(source), false);
  assert.equal(IMAGE_EVALUATION_STATIC_RULES_V16.length, 7);
});
