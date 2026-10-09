import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Keep GitHub source acceptance and production publication separate.
 * Vercel CLI/REST manual deployments remain possible with an owner-approved
 * exact SHA; ordinary pushes to main MUST NOT publish automatically.
 */
export function assertManualProductionGitHold(config) {
  const deployments = config?.git?.deploymentEnabled;
  if (deployments === null || typeof deployments !== 'object' || Array.isArray(deployments)) {
    throw new Error('ORIGIN_MANUAL_PRODUCTION_GATE_CONFIG_MISSING');
  }
  if (deployments.main !== false || deployments['**'] !== false) {
    throw new Error('ORIGIN_IMPLICIT_PRODUCTION_GIT_DEPLOYMENT_FORBIDDEN');
  }
  if (deployments['release-*'] !== true) {
    throw new Error('ORIGIN_REVIEWED_RELEASE_PREVIEW_DEPLOYMENT_DISABLED');
  }
  // Release branches generate protected previews, never a second production
  // branch. The project's sole production branch stays main.
  for (const [branch, enabled] of Object.entries(deployments)) {
    if (!['**', 'main', 'release-*'].includes(branch) || typeof enabled !== 'boolean') {
      throw new Error('ORIGIN_UNREVIEWED_GIT_DEPLOYMENT_RULE');
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assertManualProductionGitHold(config);
  process.stdout.write('Manual production Git gate verified: main auto-deploy disabled; release previews retained.\n');
}
