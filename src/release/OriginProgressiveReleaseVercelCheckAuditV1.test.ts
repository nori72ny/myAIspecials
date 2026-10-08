import { describe, expect, it } from "vitest";

import {
  ORIGIN_VERCEL_RELEASE_CHECK_NAME,
  auditOriginVercelChecksV1,
  fetchAndAuditOriginVercelChecksV1,
} from "./OriginProgressiveReleaseVercelCheckAuditV1.js";

const projectId = "prj_WecnnicbGAamToppgV97rHgd8QSB";
const teamId = "team_2oPfSS7sHa4Db1asn4C0IJkq";
const check = {
  id: "chk_valid123",
  projectId,
  name: ORIGIN_VERCEL_RELEASE_CHECK_NAME,
  blocks: "deployment-alias",
  sourceKind: "webhook",
  source: { kind: "webhook", webhookId: "hook_fixture_verified" },
  targets: ["production"],
};

describe("Vercel deployment-alias release check configuration audit", () => {
  it("accepts a configured named blocking check but NEVER authorizes production", () => {
    expect(auditOriginVercelChecksV1({ checks: [check] }, projectId)).toEqual({
      schemaVersion: "origin.vercel-checks-audit.v1",
      projectId,
      configuredBlockingCheckFound: true,
      releaseAuthorized: false,
      blockers: [],
    });
  });

  it.each([
    ["no checks", { checks: [] }],
    ["wrong check name", { checks: [{ ...check, name: "Lighthouse" }] }],
    ["nonblocking check", { checks: [{ ...check, blocks: "none" }] }],
    ["wrong block stage", { checks: [{ ...check, blocks: "deployment-start" }] }],
    ["missing trusted source", { checks: [{ ...check, source: undefined }] }],
    ["missing source kind", { checks: [{ ...check, sourceKind: undefined }] }],
    ["empty unbound webhook identity", { checks: [{ ...check, source: { kind: "webhook" } }] }],
    ["unsupported check source", { checks: [{ ...check, sourceKind: "custom", source: { kind: "custom", webhookId: "x" } }] }],
    ["mismatched source kind", { checks: [{ ...check, sourceKind: "integration" }] }],
    ["empty production targets", { checks: [{ ...check, targets: [] }] }],
    ["preview-only check", { checks: [{ ...check, targets: ["preview"] }] }],
    ["unspecified target list", { checks: [{ ...check, targets: undefined }] }],

    ["duplicate with nonblocking configuration", { checks: [check, { ...check, id: "chk_other", blocks: "none" }] }],
    ["duplicate with missing source", { checks: [check, { ...check, id: "chk_other", source: undefined }] }],
    ["duplicate with missing source kind", { checks: [check, { ...check, id: "chk_other", sourceKind: undefined }] }],
    ["duplicate exact gate", { checks: [check, { ...check, id: "chk_duplicate" }] }],
  ])("blocks missing or ambiguous production check: %s", (_label, payload) => {
    const audit = auditOriginVercelChecksV1(payload, projectId);
    expect(audit.configuredBlockingCheckFound).toBe(false);
    expect(audit.releaseAuthorized).toBe(false);
    expect(audit.blockers).toContain("REQUIRED_DEPLOYMENT_ALIAS_CHECK_MISSING");
  });

  it.each([undefined, null, {}, { checks: "not-an-array" },
    { checks: [{ ...check, projectId: "prj_other" }] }])(
    "fails closed on missing or inconsistent Vercel evidence", payload => {
      const audit = auditOriginVercelChecksV1(payload, projectId);
      expect(audit.releaseAuthorized).toBe(false);
      expect(audit.configuredBlockingCheckFound).toBe(false);
      expect(audit.blockers).toContain("VERCEL_CHECK_API_EVIDENCE_MISSING");
    },
  );

  it("accepts correctly bound production-source alternatives without authorizing release", () => {
    const integration = auditOriginVercelChecksV1({
      checks: [{ ...check, sourceKind: "integration",
        source: { kind: "integration", externalResourceId: "integration_fixture" } }],
    }, projectId);
    expect(integration.configuredBlockingCheckFound).toBe(true);
    expect(integration.releaseAuthorized).toBe(false);

    const githubExternal = auditOriginVercelChecksV1({
      checks: [{ ...check, sourceKind: "git-provider",
        source: { kind: "git-provider", provider: "github", externalCheckName: "ORIGIN gate" } }],
    }, projectId);
    expect(githubExternal.configuredBlockingCheckFound).toBe(true);
    expect(githubExternal.releaseAuthorized).toBe(false);

    const unrelatedExternal = auditOriginVercelChecksV1({
      checks: [{ ...check, sourceKind: "git-provider",
        source: { kind: "git-provider", provider: "other", externalCheckName: "ORIGIN gate" } }],
    }, projectId);
    expect(unrelatedExternal.configuredBlockingCheckFound).toBe(false);
  });

  it("queries official Vercel fixed-host read-only endpoint without leaking secrets", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(url), init: init! });
      return new Response(JSON.stringify({ checks: [check] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await fetchAndAuditOriginVercelChecksV1({
      projectId, teamId, token: "fake-test-token-secret", fetchImpl: fakeFetch,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.audit.configuredBlockingCheckFound).toBe(true);
      expect(result.audit.releaseAuthorized).toBe(false);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `https://api.vercel.com/v2/projects/${projectId}/checks?teamId=${teamId}`,
    );
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.redirect).toBe("error");
    expect(JSON.stringify(result)).not.toContain("fake-test-token-secret");
  });

  it("rejects duplicate named checks across DIFFERENT block stages from unfiltered API", async () => {
    const fakeFetch = (async (url: URL | RequestInfo): Promise<Response> => {
      // The Vercel blocks filter would hide this wrong-stage duplicate.
      expect(String(url)).not.toContain("blocks=");
      return new Response(JSON.stringify({
        checks: [check, { ...check, id: "chk_nonblocking", blocks: "none" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const result = await fetchAndAuditOriginVercelChecksV1({
      projectId, teamId, token: "fixture-token-should-never-be-logged", fetchImpl: fakeFetch,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.audit).toMatchObject({
        configuredBlockingCheckFound: false, releaseAuthorized: false,
      });
      expect(result.audit.blockers).toContain("REQUIRED_DEPLOYMENT_ALIAS_CHECK_MISSING");
    }
  });

  it("redacts missing token, HTTP errors, network errors, and malformed responses", async () => {
    expect(await fetchAndAuditOriginVercelChecksV1({
      projectId, teamId, token: "",
    })).toEqual({ ok: false, code: "VERCEL_CHECK_READBACK_UNAVAILABLE" });
    expect(await fetchAndAuditOriginVercelChecksV1({
      projectId, teamId, token: "fake-test-token-secret",
      fetchImpl: (async () => new Response("request rejected", { status: 403 })) as typeof fetch,
    })).toEqual({ ok: false, code: "VERCEL_CHECK_READBACK_UNAVAILABLE" });
    expect(await fetchAndAuditOriginVercelChecksV1({
      projectId, teamId, token: "fake-test-token-secret",
      fetchImpl: (async () => { throw new Error("sensitive upstream failure"); }) as typeof fetch,
    })).toEqual({ ok: false, code: "VERCEL_CHECK_READBACK_UNAVAILABLE" });
    expect(await fetchAndAuditOriginVercelChecksV1({
      projectId, teamId, token: "fake-test-token-secret",
      fetchImpl: (async () => new Response("not JSON", { status: 200 })) as typeof fetch,
    })).toEqual({ ok: false, code: "VERCEL_CHECK_READBACK_UNAVAILABLE" });
  });
});
