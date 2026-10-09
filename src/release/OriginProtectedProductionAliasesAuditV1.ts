/**
 * ORIGIN protected-domain hold audit. PURE / read-only / fail closed.
 * Validates a snapshot held by a trusted independent release controller,
 * never an arbitrary PR/body/browser claim.
 *
 * Passing means only that three protected hostnames STILL match a pre-existing
 * approved deployment snapshot at one instant. It NEVER proves that the next
 * Git/main push will not automatically reassign Vercel default aliases.
 */
export const ORIGIN_PROTECTED_PRODUCTION_HOSTS = Object.freeze([
  'origin-personal.vercel.app',
  'origin-personal-nori72nyprivate-6923s-projects.vercel.app',
  'origin-personal-git-main-nori72nyprivate-6923s-projects.vercel.app',
] as const);

export type OriginProtectedProductionHost =
  typeof ORIGIN_PROTECTED_PRODUCTION_HOSTS[number];

export interface OriginTrustedProductionAliasSnapshotV1 {
  readonly projectId: string;
  readonly approvedSha: string;
  readonly deploymentsByHostname: Readonly<Record<OriginProtectedProductionHost, string>>;
}

export interface OriginProductionAliasHoldVerdictV1 {
  readonly schemaVersion: 'origin.protected-production-aliases.v1';
  readonly allProtectedProductionAliasesHeld: boolean;
  readonly firstNewMainPushNegativePathVerified: false;
  readonly productionPromotionAuthorized: false;
  readonly blockers: readonly string[];
}

const validSha = (x: unknown): x is string =>
  typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);
const validProject = (x: unknown): x is string =>
  typeof x === 'string' && /^prj_[A-Za-z0-9]{12,}$/.test(x);
const validDeployment = (x: unknown): x is string =>
  typeof x === 'string' && /^dpl_[A-Za-z0-9]{8,}$/.test(x);
const record = (x: unknown): x is Record<string, unknown> =>
  Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const value = (obj: unknown, field: string): unknown =>
  record(obj) ? obj[field] : undefined;
const deploymentProject = (obj: unknown): unknown =>
  value(obj, 'projectId') ?? value(value(obj, 'project'), 'id');

export function auditOriginProtectedProductionAliasesV1(
  snapshot: unknown,
  aliases: readonly unknown[],
  deployments: readonly unknown[],
): OriginProductionAliasHoldVerdictV1 {
  const blockers = new Set<string>();
  const snap = record(snapshot) ? snapshot : {};
  const projectId = snap.projectId;
  const approvedSha = snap.approvedSha;
  const mapping = snap.deploymentsByHostname;
  if (!validProject(projectId) || !validSha(approvedSha) || !record(mapping)
    || Object.keys(mapping).length !== ORIGIN_PROTECTED_PRODUCTION_HOSTS.length
    || ORIGIN_PROTECTED_PRODUCTION_HOSTS.some(host => !validDeployment(mapping[host]))) {
    blockers.add('TRUSTED_PRODUCTION_SNAPSHOT_INVALID');
  }
  if (!Array.isArray(aliases) || aliases.length !== ORIGIN_PROTECTED_PRODUCTION_HOSTS.length) {
    blockers.add('PROTECTED_ALIAS_INVENTORY_INCOMPLETE');
  }
  if (!Array.isArray(deployments) || !deployments.length || deployments.length > 3) {
    blockers.add('PRODUCTION_DEPLOYMENT_INVENTORY_INVALID');
  }

  const aliasByName = new Map<string, unknown>();
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    const host = value(alias, 'alias');
    if (typeof host !== 'string' || aliasByName.has(host)
      || !ORIGIN_PROTECTED_PRODUCTION_HOSTS.includes(host as OriginProtectedProductionHost)) {
      blockers.add('PROTECTED_ALIAS_INVENTORY_INVALID');
      continue;
    }
    aliasByName.set(host, alias);
  }
  const deployById = new Map<string, unknown>();
  for (const dep of Array.isArray(deployments) ? deployments : []) {
    const id = value(dep, 'id');
    if (!validDeployment(id) || deployById.has(id)) {
      blockers.add('PRODUCTION_DEPLOYMENT_INVENTORY_INVALID');
      continue;
    }
    deployById.set(id, dep);
  }

  const expectedIds = new Set<string>();
  for (const host of ORIGIN_PROTECTED_PRODUCTION_HOSTS) {
    const expected = record(mapping) ? mapping[host] : undefined;
    const a = aliasByName.get(host);
    if (!validDeployment(expected) || !a) {
      blockers.add('PROTECTED_ALIAS_INVENTORY_INCOMPLETE');
      continue;
    }
    expectedIds.add(expected);
    if (value(a, 'deploymentId') !== expected) {
      blockers.add('PROTECTED_ALIAS_MOVED');
    }
    // Alias API may omit projectId. If present, it must match.
    const aliasProjectId = value(a, 'projectId');
    if (aliasProjectId !== undefined && aliasProjectId !== projectId) {
      blockers.add('PROTECTED_ALIAS_PROJECT_MISMATCH');
    }
  }
  if (expectedIds.size !== deployById.size
    || [...deployById.keys()].some(id => !expectedIds.has(id))) {
    blockers.add('PRODUCTION_DEPLOYMENT_INVENTORY_INVALID');
  }
  for (const id of expectedIds) {
    const deployment = deployById.get(id);
    if (!deployment) {
      blockers.add('PRODUCTION_DEPLOYMENT_INVENTORY_INVALID');
      continue;
    }
    if (deploymentProject(deployment) !== projectId) {
      blockers.add('PRODUCTION_DEPLOYMENT_PROJECT_MISMATCH');
    }
    if (value(deployment, 'readyState') !== 'READY'
      || value(deployment, 'target') !== 'production') {
      blockers.add('PRODUCTION_DEPLOYMENT_NOT_READY_OR_WRONG_TARGET');
    }
    if (value(value(deployment, 'meta'), 'githubCommitSha') !== approvedSha) {
      blockers.add('PRODUCTION_DEPLOYMENT_SHA_MISMATCH');
    }
  }

  return Object.freeze({
    schemaVersion: 'origin.protected-production-aliases.v1' as const,
    allProtectedProductionAliasesHeld: blockers.size === 0,
    firstNewMainPushNegativePathVerified: false as const,
    productionPromotionAuthorized: false as const,
    blockers: Object.freeze([...blockers]),
  });
}
