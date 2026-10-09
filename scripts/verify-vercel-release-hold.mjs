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
  const deploymentId = required(env, "ORIGIN_EXPECTED_PRODUCTION_DEPLOYMENT_ID", VERCEL_DEPLOYMENT);
  const sha = required(env, "ORIGIN_EXPECTED_PRODUCTION_SHA", FULL_SHA);
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

  const [projectInfo, aliasInfo, deployment] = await Promise.all([
    readVercelJson("/v9/projects/" + project),
    readVercelJson("/v4/aliases/" + alias),
    readVercelJson("/v13/deployments/" + deploymentId),
  ]);

  // This must be the raw project API response, not a connector summary
  // that omits unlisted fields or normalizes missing values to false.
  assert.equal(projectInfo.id, project, "VERCEL_PROJECT_MISMATCH");
  assert.equal(projectInfo.autoAssignCustomDomains, false, "VERCEL_NATIVE_AUTO_ASSIGN_NOT_VERIFIED");
  assert.equal(aliasInfo.projectId, project, "PRODUCTION_ALIAS_PROJECT_MISMATCH");
  assert.equal(aliasInfo.alias, alias, "PRODUCTION_ALIAS_NAME_MISMATCH");
  assert.equal(aliasInfo.deploymentId, deploymentId, "PRODUCTION_ALIAS_MOVED");
  assert.equal(deployment.projectId ?? deployment.project?.id, project, "PRODUCTION_DEPLOYMENT_PROJECT_MISMATCH");
  assert.equal(deployment.meta?.githubCommitSha?.toLowerCase(), sha, "PRODUCTION_DEPLOYMENT_SHA_MISMATCH");
  assert.equal(deployment.readyState, "READY", "PRODUCTION_DEPLOYMENT_NOT_READY");

  // Crucial limitation: native custom-domain hold is NOT proof that
  // an untested first merge cannot create a default *.vercel.app alias.
  return {
    status: "native-custom-domain-and-current-alias-verified",
    productionAlias: alias,
    deploymentId,
    observedSha: sha,
    autoAssignCustomDomains: false,
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
