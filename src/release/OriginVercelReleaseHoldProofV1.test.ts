import { afterEach, describe, expect, it, vi } from "vitest";
import { PROTECTED_ORIGIN_ALIASES, verifyStaticGitConfig, verifyVercelReleaseHold } from "../../scripts/verify-vercel-release-hold.mjs";

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
type ProbeFixture = {
  id: string;
  projectId: string;
  readyState: string;
  target: string | null;
  meta: { githubCommitSha: string };
};

const withProbe = (): ReturnType<typeof okay> & { probe: ProbeFixture } => ({
  ...okay(),
  probe: {
    id: "dpl_PROBE123", projectId: fixtureEnv.ORIGIN_VERCEL_PROJECT_ID,
    readyState: "READY", target: "production",
    meta: { githubCommitSha: fixtureEnv.ORIGIN_EXPECTED_PRODUCTION_SHA },
  },
});

function fakeApi(x: ReturnType<typeof okay> & { probe?: ProbeFixture } = okay(), aliasOverrides: Record<string, { deploymentId?: string; projectId?: string }> = {}) {
  return vi.fn(async (input, options) => {
    expect(options.method).toBe("GET");
    expect(options.redirect).toBe("error");
    expect(options.headers.authorization).toBe("Bearer " + fixtureEnv.VERCEL_TOKEN);
    const url = new URL(input);
    expect(url.origin).toBe("https://api.vercel.com");
    expect(url.searchParams.get("teamId")).toBe(fixtureEnv.ORIGIN_VERCEL_TEAM_ID);
    const val = url.pathname.includes("/projects/") ? x.project
      : url.pathname.includes("/aliases/") ? {
        ...x.alias,
        alias: decodeURIComponent(url.pathname.slice("/v4/aliases/".length)),
        ...(aliasOverrides[decodeURIComponent(url.pathname.slice("/v4/aliases/".length))] ?? {}),
      }
      : url.pathname.endsWith("/dpl_PROBE123") ? x.probe : x.deployment;
    return new Response(JSON.stringify(val), { status: 200, headers: { "content-type": "application/json" } });
  });
}
afterEach(() => vi.restoreAllMocks());

describe("exact-SHA Vercel release hold proof, read-only and fail closed", () => {
  it("verifies current native flag, alias and deployment SHA but never claims first-merge proof", async () => {
    const mock = fakeApi();
    const result = await verifyVercelReleaseHold(fixtureEnv, mock);
    expect(mock).toHaveBeenCalledTimes(5);
    expect(result).toMatchObject({
      status: "native-custom-domain-and-current-alias-verified",
      verifiedProductionAliases: PROTECTED_ORIGIN_ALIASES,
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
  it.each([
    ["nested repeated labels", "0." + "00.".repeat(30_000)],
    ["single label", "localhost"],
    ["empty label", "origin..vercel.app"],
    ["hyphen-prefixed label", "-origin.vercel.app"],
    ["trailing hyphen label", "origin-.vercel.app"],
    ["invalid path", "origin.vercel.app/health"],
    ["oversized label", "a".repeat(64) + ".vercel.app"],
    ["mixed uppercase hostname", "ORIGIN.vercel.app"],
  ])("rejects adversarial hostname: %s without making HTTP calls", async (_case, alias) => {
    const f = vi.fn();
    await expect(verifyVercelReleaseHold({ ...fixtureEnv, ORIGIN_PRODUCTION_ALIAS: alias }, f)).rejects.toThrow("ORIGIN_PRODUCTION_ALIAS_INVALID");
    expect(f).not.toHaveBeenCalled();
  });

  it("proves a READY same-SHA production-target probe did not replace the live alias, but never approves first main push", async () => {
    const x = withProbe();
    const fake = fakeApi(x);
    const output = await verifyVercelReleaseHold({
      ...fixtureEnv, ORIGIN_STAGED_PROBE_DEPLOYMENT_ID: "dpl_PROBE123",
    }, fake);
    expect(fake).toHaveBeenCalledTimes(6);
    expect(output).toMatchObject({
      sameShaProductionProbeVerified: true,
      firstMainPushNegativePathVerified: false,
      independentReviewerApproved: false,
      productionPromotionAuthorized: false,
    });
  });

  it.each([
    ["non-ready", (x) => { x.probe.readyState = "BUILDING"; }],
    ["preview-target", (x) => { x.probe.target = null; }],
    ["wrong-sha", (x) => { x.probe.meta.githubCommitSha = "b".repeat(40); }],
    ["wrong-project", (x) => { x.probe.projectId = "prj_OTHER123"; }],
    ["wrong-id", (x) => { x.probe.id = "dpl_OTHER123"; }],
    ["alias-was-moved", (x) => { x.alias.deploymentId = "dpl_PROBE123"; }],
  ])("fails closed on staged production probe %s", async (_name, mutate) => {
    const x = withProbe();
    mutate(x);
    await expect(verifyVercelReleaseHold({
      ...fixtureEnv, ORIGIN_STAGED_PROBE_DEPLOYMENT_ID: "dpl_PROBE123",
    }, fakeApi(x))).rejects.toThrow();
  });

  it("rejects malformed or identical staging probe identifiers before any network request", async () => {
    for (const probeId of ["../bad", "dpl_OTHER?", fixtureEnv.ORIGIN_EXPECTED_PRODUCTION_DEPLOYMENT_ID]) {
      const client = vi.fn();
      await expect(verifyVercelReleaseHold({
        ...fixtureEnv, ORIGIN_STAGED_PROBE_DEPLOYMENT_ID: probeId,
      }, client)).rejects.toThrow();
      expect(client).not.toHaveBeenCalled();
    }
  });

  it.each(PROTECTED_ORIGIN_ALIASES.slice(1))("fails closed if secondary protected alias %s moved during production staging", async (name) => {
    const mock = fakeApi(okay(), { [name]: { deploymentId: "dpl_UNEXPECTED123" } });
    await expect(verifyVercelReleaseHold(fixtureEnv, mock)).rejects.toThrow("PRODUCTION_ALIAS_MOVED");
  });

  it("checks every protected alias; the project-domains API alone is insufficient", async () => {
    const mock = fakeApi();
    const result = await verifyVercelReleaseHold(fixtureEnv, mock);
    expect(result.verifiedProductionAliases).toEqual(PROTECTED_ORIGIN_ALIASES);
    const requests = mock.mock.calls.map((call) => String(call[0]));
    for (const hostname of PROTECTED_ORIGIN_ALIASES) {
      expect(requests).toContain("https://api.vercel.com/v4/aliases/" + hostname + "?teamId=team_TEST1234");
    }
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
