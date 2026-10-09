import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HOST = "https://api.vercel.com";
const FULL_SHA = /^[0-9a-f]{40}$/;
const VERCEL_PROJECT = /^prj_[a-zA-Z0-9]+$/;
const VERCEL_TEAM = /^team_[a-zA-Z0-9]+$/;
const VERCEL_DEPLOYMENT = /^dpl_[a-zA-Z0-9]+$/;
const ALIAS_CHARS = /^[a-z0-9.-]+$/;
const MAX_RESPONSE_BYTES = 300_000;
// These three domains are advertised by the ORIGIN Vercel project. The
// Project Domains API returns only the primary one; inspecting it alone
// would miss movement of the two default Vercel production aliases.
export const PROTECTED_ORIGIN_ALIASES = Object.freeze([
  "origin-personal.vercel.app",
  "origin-personal-nori72nyprivate-6923s-projects.vercel.app",
  "origin-personal-git-main-nori72nyprivate-6923s-projects.vercel.app"
]);

function required(env, name, pattern) {
  const value = env[name];
  assert.equal(typeof value, "string", name + "_MISSING");
  assert.match(value, pattern, name + "_INVALID");
  return value;
}

export function verifyStaticGitConfig(vercelConfig) {
  assert.ok(vercelConfig && typeof vercelConfig === "object", "INVALID_VERCEL_CONFIG");
  const rules = vercelConfig.git?.deploymentEnabled;
  assert.deepEqual(rules, { "**": false, main: false, "release-*": true }, "MAIN_GIT_AUTO_DEPLOY_NOT_HELD");
  assert.equal(vercelConfig.github?.autoAlias, false, "GITHUB_AUTO_ALIAS_NOT_HELD");
}

export async function verifyVercelReleaseHold(env = process.env, client = fetch) {
  const token = required(env, "VERCEL_TOKEN", /^\S{10,}$/);
  const project = required(env, "ORIGIN_VERCEL_PROJECT_ID", VERCEL_PROJECT);
  const team = required(env, "ORIGIN_VERCEL_TEAM_ID", VERCEL_TEAM);
  const alias = env.ORIGIN_PRODUCTION_ALIAS;
  assert.equal(typeof alias, "string", "ORIGIN_PRODUCTION_ALIAS_MISSING");
  assert.ok(alias.length >= 4 && alias.length <= 253 && ALIAS_CHARS.test(alias), "ORIGIN_PRODUCTION_ALIAS_INVALID");
  const labels = alias.split(".");
  assert.ok(labels.length >= 2 && labels.every((label) =>
    label.length >= 1 && label.length <= 63 && !label.startsWith("-") && !label.endsWith("-")
  ), "ORIGIN_PRODUCTION_ALIAS_INVALID");
  assert.equal(alias, PROTECTED_ORIGIN_ALIASES[0], "ORIGIN_PRIMARY_ALIAS_MISMATCH");
  const deploymentId = required(env, "ORIGIN_EXPECTED_PRODUCTION_DEPLOYMENT_ID", VERCEL_DEPLOYMENT);
  const sha = required(env, "ORIGIN_EXPECTED_PRODUCTION_SHA", FULL_SHA);
  // This owner-reviewed snapshot must be captured BEFORE the operation,
  // not inferred from a potentially already-moved live alias.
  const snapshotJson = env.ORIGIN_EXPECTED_PRODUCTION_ALIAS_TARGETS_JSON;
  assert.equal(typeof snapshotJson, "string", "PRODUCTION_ALIAS_SNAPSHOT_MISSING");
  assert.ok(snapshotJson.length <= 2000, "PRODUCTION_ALIAS_SNAPSHOT_OVERSIZED");
  let expectedAliasTargets;
  try { expectedAliasTargets = JSON.parse(snapshotJson); }
  catch { throw Error("PRODUCTION_ALIAS_SNAPSHOT_INVALID_JSON"); }
  assert.ok(expectedAliasTargets && typeof expectedAliasTargets === "object" &&
    !Array.isArray(expectedAliasTargets), "PRODUCTION_ALIAS_SNAPSHOT_INVALID");
  assert.deepEqual(Object.keys(expectedAliasTargets).sort(),
    [...PROTECTED_ORIGIN_ALIASES].sort(), "PRODUCTION_ALIAS_SNAPSHOT_INCOMPLETE");
  for (const name of PROTECTED_ORIGIN_ALIASES) {
    assert.equal(typeof expectedAliasTargets[name], "string", "PRODUCTION_ALIAS_SNAPSHOT_TARGET_INVALID");
    assert.match(expectedAliasTargets[name], VERCEL_DEPLOYMENT, "PRODUCTION_ALIAS_SNAPSHOT_TARGET_INVALID");
  }
  assert.equal(expectedAliasTargets[alias], deploymentId, "PRODUCTION_PRIMARY_SNAPSHOT_MISMATCH");
  const expectedDeploymentIds = [...new Set(PROTECTED_ORIGIN_ALIASES.map((name) => expectedAliasTargets[name]))];
  const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"));
  verifyStaticGitConfig(config);

  async function readVercelJson(path) {
    const url = new URL(path, HOST);
    assert.equal(url.origin, HOST, "VERCEL_API_ORIGIN_MISMATCH");
    url.searchParams.set("teamId", team);
    const response = await client(url.toString(), {
      method: "GET",
      redirect: "error",
      headers: { authorization: "Bearer " + token, accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.ok, true, "VERCEL_HOLD_API_HTTP_" + response.status);
    const raw = await response.text();
    assert.ok(raw.length > 0 && Buffer.byteLength(raw, "utf8") <= MAX_RESPONSE_BYTES, "VERCEL_HOLD_RESPONSE_OVERSIZED");
    try {
      const obj = JSON.parse(raw);
      assert.ok(obj && typeof obj === "object" && !Array.isArray(obj), "VERCEL_HOLD_INVALID_JSON");
      return obj;
    } catch {
      throw Error("VERCEL_HOLD_INVALID_JSON");
    }
  }

  // A staging probe is optional and must be the same already-trusted SHA.
  // Its purpose is only to prove the alias did not switch on this one
  // Production-target build. It never attests that a NEW main push is safe.
  const probeId = env.ORIGIN_STAGED_PROBE_DEPLOYMENT_ID?.trim();
  if (probeId !== undefined) {
    assert.match(probeId, VERCEL_DEPLOYMENT, "ORIGIN_STAGED_PROBE_DEPLOYMENT_ID_INVALID");
    assert.notEqual(probeId, deploymentId, "ORIGIN_STAGED_PROBE_NOT_DISTINCT");
  }
  const [projectInfo, aliasInfos, deploymentInfos, probe] = await Promise.all([
    readVercelJson("/v9/projects/" + project),
    Promise.all(PROTECTED_ORIGIN_ALIASES.map((name) =>
      readVercelJson("/v4/aliases/" + name))),
    Promise.all(expectedDeploymentIds.map((id) =>
      readVercelJson("/v13/deployments/" + id))),
    probeId ? readVercelJson("/v13/deployments/" + probeId) : Promise.resolve(null),
  ]);

  // This must be the raw project API response, not a connector summary
  // that omits unlisted fields or normalizes missing values to false.
  assert.equal(projectInfo.id, project, "VERCEL_PROJECT_MISMATCH");
  assert.equal(projectInfo.autoAssignCustomDomains, false, "VERCEL_NATIVE_AUTO_ASSIGN_NOT_VERIFIED");
  for (let index = 0; index < PROTECTED_ORIGIN_ALIASES.length; index += 1) {
    const observed = aliasInfos[index];
    assert.equal(observed.projectId, project, "PRODUCTION_ALIAS_PROJECT_MISMATCH");
    assert.equal(observed.alias, PROTECTED_ORIGIN_ALIASES[index], "PRODUCTION_ALIAS_NAME_MISMATCH");
    assert.equal(observed.deploymentId, expectedAliasTargets[observed.alias], "PRODUCTION_ALIAS_MOVED");
  }
  for (let index = 0; index < expectedDeploymentIds.length; index += 1) {
    const deployment = deploymentInfos[index];
    assert.equal(deployment.id, expectedDeploymentIds[index], "PRODUCTION_DEPLOYMENT_ID_MISMATCH");
    assert.equal(deployment.projectId ?? deployment.project?.id, project, "PRODUCTION_DEPLOYMENT_PROJECT_MISMATCH");
    assert.equal(deployment.meta?.githubCommitSha?.toLowerCase(), sha, "PRODUCTION_DEPLOYMENT_SHA_MISMATCH");
    assert.equal(deployment.readyState, "READY", "PRODUCTION_DEPLOYMENT_NOT_READY");
  }

  if (probe) {
    assert.equal(probe.id, probeId, "STAGED_PROBE_ID_MISMATCH");
    assert.equal(probe.projectId ?? probe.project?.id, project, "STAGED_PROBE_PROJECT_MISMATCH");
    assert.equal(probe.readyState, "READY", "STAGED_PROBE_NOT_READY");
    assert.equal(probe.target, "production", "STAGED_PROBE_NOT_PRODUCTION_TARGET");
    assert.equal(probe.meta?.githubCommitSha?.toLowerCase(), sha, "STAGED_PROBE_UNTRUSTED_SHA");
    assert.ok(aliasInfos.every((observed) => observed.deploymentId !== probeId), "STAGED_PROBE_AUTO_PROMOTED");
  }

  // Same-SHA staging cannot prove what happens on the FIRST new main push.
  return {
    status: "native-custom-domain-and-current-alias-verified",
    productionAlias: alias,
    deploymentId,
    verifiedProductionAliases: PROTECTED_ORIGIN_ALIASES,
    verifiedAliasDeploymentIds: expectedAliasTargets,
    observedSha: sha,
    autoAssignCustomDomains: false,
    sameShaProductionProbeVerified: Boolean(probe),
    firstMainPushNegativePathVerified: false,
    independentReviewerApproved: false,
    productionPromotionAuthorized: false,
  };
}

if (process.argv[1]?.endsWith("verify-vercel-release-hold.mjs")) {
  verifyVercelReleaseHold().then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      // Never expose raw HTTP response bodies, tokens, metadata, or headers.
      const code = error instanceof Error && /^[A-Z0-9_:-]{4,80}$/.test(error.message)
        ? error.message : "VERCEL_RELEASE_HOLD_CHECK_FAILED";
      console.error(code);
      process.exitCode = 1;
    },
  );
}
