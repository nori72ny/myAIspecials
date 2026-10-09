import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyStaticGitConfig, verifyVercelReleaseHold } from "../../scripts/verify-vercel-release-hold.mjs";

const fixtureEnv = {
  VERCEL_TOKEN: "a-read-only-test-token",
  ORIGIN_VERCEL_PROJECT_ID: "prj_TEST1234",
  ORIGIN_VERCEL_TEAM_ID: "team_TEST1234",
  ORIGIN_PRODUCTION_ALIAS: "origin-personal.vercel.app",
  ORIGIN_EXPECTED_PRODUCTION_DEPLOYMENT_ID: "dpl_TEST1234",
  ORIGIN_EXPECTED_PRODUCTION_SHA: "a".repeat(40),
};

const okay = () => ({
  project: { id: fixtureEnv.ORIGIN_VERCEL_PROJECT_ID, autoAssignCustomDomains: false },
  alias: { alias: fixtureEnv.ORIGIN_PRODUCTION_ALIAS, projectId: fixtureEnv.ORIGIN_VERCEL_PROJECT_ID, deploymentId: fixtureEnv.ORIGIN_EXPECTED_PRODUCTION_DEPLOYMENT_ID },
  deployment: { id: fixtureEnv.ORIGIN_EXPECTED_PRODUCTION_DEPLOYMENT_ID, projectId: fixtureEnv.ORIGIN_VERCEL_PROJECT_ID, readyState: "READY", meta: { githubCommitSha: fixtureEnv.ORIGIN_EXPECTED_PRODUCTION_SHA } },
});
function fakeApi(x = okay()) {
  return vi.fn(async (input, options) => {
    expect(options.method).toBe("GET");
    expect(options.redirect).toBe("error");
    expect(options.headers.authorization).toBe("Bearer " + fixtureEnv.VERCEL_TOKEN);
    const url = new URL(input);
    expect(url.origin).toBe("https://api.vercel.com");
    expect(url.searchParams.get("teamId")).toBe(fixtureEnv.ORIGIN_VERCEL_TEAM_ID);
    const val = url.pathname.includes("/projects/") ? x.project : url.pathname.includes("/aliases/") ? x.alias : x.deployment;
    return new Response(JSON.stringify(val), { status: 200, headers: { "content-type": "application/json" } });
  });
}
afterEach(() => vi.restoreAllMocks());

describe("exact-SHA Vercel release hold proof, read-only and fail closed", () => {
  it("verifies current native flag, alias and deployment SHA but never claims first-merge proof", async () => {
    const mock = fakeApi();
    const result = await verifyVercelReleaseHold(fixtureEnv, mock);
    expect(mock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      status: "native-custom-domain-and-current-alias-verified",
      autoAssignCustomDomains: false,
      firstMainPushNegativePathVerified: false,
      independentReviewerApproved: false,
      productionPromotionAuthorized: false,
    });
  });
  it.each([
    ["missing-native-flag", (x) => { delete x.project.autoAssignCustomDomains; }],
    ["true-native-flag", (x) => { x.project.autoAssignCustomDomains = true; }],
    ["wrong-project", (x) => { x.project.id = "prj_OTHER123"; }],
    ["alias-moved", (x) => { x.alias.deploymentId = "dpl_OTHER123"; }],
    ["alias-project-mismatch", (x) => { x.alias.projectId = "prj_OTHER123"; }],
    ["deployment-project-mismatch", (x) => { x.deployment.projectId = "prj_OTHER123"; }],
    ["commit-mismatch", (x) => { x.deployment.meta.githubCommitSha = "b".repeat(40); }],
    ["nonready", (x) => { x.deployment.readyState = "ERROR"; }],
  ])("rejects %s", async (_name, mutate) => {
    const x = okay();
    mutate(x);
    await expect(verifyVercelReleaseHold(fixtureEnv, fakeApi(x))).rejects.toThrow();
  });
  it("denies absent authentication before sending any HTTP request", async () => {
    const f = vi.fn();
    await expect(verifyVercelReleaseHold({ ...fixtureEnv, VERCEL_TOKEN: undefined }, f)).rejects.toThrow("VERCEL_TOKEN_MISSING");
    expect(f).not.toHaveBeenCalled();
  });
  it("denies unapproved main deployments even if alias controls appear correct", () => {
    expect(() => verifyStaticGitConfig({ git: { deploymentEnabled: { "**": false, main: true, "release-*": true } }, github: { autoAlias: false } })).toThrow("MAIN_GIT_AUTO_DEPLOY_NOT_HELD");
  });
  it("does not echo sensitive provider response bodies on non-200 HTTP", async () => {
    const secret = "token-should-never-appear-in-errors";
    const f = vi.fn(async () => new Response(JSON.stringify({ token: secret }), { status: 503 }));
    await expect(verifyVercelReleaseHold(fixtureEnv, f)).rejects.toThrow("VERCEL_HOLD_API_HTTP_503");
  });
  it("rejects nonobject JSON and overlarge responses", async () => {
    const f = vi.fn(async () => new Response("[]", { status: 200 }));
    await expect(verifyVercelReleaseHold(fixtureEnv, f)).rejects.toThrow("VERCEL_HOLD_INVALID_JSON");
    const huge = vi.fn(async () => new Response(JSON.stringify({ huge: "x".repeat(310_000) }), { status: 200 }));
    await expect(verifyVercelReleaseHold(fixtureEnv, huge)).rejects.toThrow("VERCEL_HOLD_RESPONSE_OVERSIZED");
  });
});
