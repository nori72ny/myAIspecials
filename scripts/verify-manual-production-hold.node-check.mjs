import assert from 'node:assert/strict';
import test from 'node:test';
import { assertManualProductionGitHold } from './verify-manual-production-hold.mjs';

const safe = () => ({
  git: { deploymentEnabled: { '**': false, main: false, 'release-*': true } },
});

test('permits protected release previews while disabling implicit main publishing', () => {
  assert.doesNotThrow(() => assertManualProductionGitHold(safe()));
});

test('rejects automatic main Git deploy before any promotion', () => {
  const unsafe = safe();
  unsafe.git.deploymentEnabled.main = true;
  assert.throws(
    () => assertManualProductionGitHold(unsafe),
    /ORIGIN_IMPLICIT_PRODUCTION_GIT_DEPLOYMENT_FORBIDDEN/,
  );
});

test('rejects unexpected wildcard defaults that enable unknown Git branches', () => {
  const unsafe = safe();
  unsafe.git.deploymentEnabled['**'] = true;
  assert.throws(
    () => assertManualProductionGitHold(unsafe),
    /ORIGIN_IMPLICIT_PRODUCTION_GIT_DEPLOYMENT_FORBIDDEN/,
  );
});

test('rejects absent and disabled release preview mapping', () => {
  assert.throws(() => assertManualProductionGitHold({}), /CONFIG_MISSING/);
  const unsafe = safe();
  unsafe.git.deploymentEnabled['release-*'] = false;
  assert.throws(
    () => assertManualProductionGitHold(unsafe),
    /ORIGIN_REVIEWED_RELEASE_PREVIEW_DEPLOYMENT_DISABLED/,
  );
});

test('rejects silently added privileged or invalid branch rules', () => {
  const unsafe = safe();
  unsafe.git.deploymentEnabled.production = true;
  assert.throws(() => assertManualProductionGitHold(unsafe), /ORIGIN_UNREVIEWED_GIT_DEPLOYMENT_RULE/);
  unsafe.git.deploymentEnabled.production = null;
  assert.throws(() => assertManualProductionGitHold(unsafe), /ORIGIN_UNREVIEWED_GIT_DEPLOYMENT_RULE/);
});
