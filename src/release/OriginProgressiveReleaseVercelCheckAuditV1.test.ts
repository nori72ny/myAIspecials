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
  source: { integrationConfigurationId: "configured-provider" },
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
      `https://api.vercel.com/v2/projects/${projectId}/checks?teamId=${teamId}&blocks=deployment-alias`,
    );
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.redirect).toBe("error");
    expect(JSON.stringify(result)).not.toContain("fake-test-token-secret");
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
