/**
 * Read-only Vercel Deployment Checks configuration audit.
 *
 * A configured deployment-alias check is NECESSARY but not SUFFICIENT:
 * a release is never authorized without proving it actually holds the live
 * production domain during an intentional negative-path test.
 *
 * Vercel documented API: GET /v2/projects/{projectIdOrName}/checks
 * with teamId and blocks=deployment-alias.
 */
export const ORIGIN_VERCEL_RELEASE_CHECK_NAME = "ORIGIN Exact-SHA Release Gate" as const;

export type OriginVercelCheckAuditV1 = Readonly<{
  schemaVersion: "origin.vercel-checks-audit.v1";
  projectId: string;
  configuredBlockingCheckFound: boolean;
  releaseAuthorized: false;
  blockers: readonly (
    | "VERCEL_CHECK_API_EVIDENCE_MISSING"
    | "REQUIRED_DEPLOYMENT_ALIAS_CHECK_MISSING"
  )[];
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function auditOriginVercelChecksV1(
  payload: unknown,
  projectId: string,
): OriginVercelCheckAuditV1 {
  const response = record(payload);
  const rows = Array.isArray(response?.checks) ? response.checks : null;
  const blockers: Array<OriginVercelCheckAuditV1["blockers"][number]> = [];
  const validProject = /^prj_[A-Za-z0-9]+$/.test(projectId);
  // An incomplete page, missing source identity or inconsistent project ID
  // is not evidence of an actual enforced check.
  const complete = validProject && rows !== null
    && rows.length <= 100
    && rows.every(item => {
      const check = record(item);
      return check && typeof check.id === "string"
        && typeof check.name === "string"
        && typeof check.projectId === "string"
        && check.projectId === projectId
        && typeof check.blocks === "string";
    });
  if (!complete) blockers.push("VERCEL_CHECK_API_EVIDENCE_MISSING");

  const named = complete && rows !== null
    ? rows.filter(item => record(item)!.name === ORIGIN_VERCEL_RELEASE_CHECK_NAME)
    : null;
  // Count all same-name checks BEFORE validating their configuration. Otherwise
  // a malformed/nonblocking duplicate disappears and an ambiguous gate passes.
  const matched = named?.length === 1 ? named.filter(item => {
    const c = record(item)!;
    return c.name === ORIGIN_VERCEL_RELEASE_CHECK_NAME
      && c.blocks === "deployment-alias"
      && typeof c.id === "string" && c.id.length > 0
      && typeof c.sourceKind === "string" && c.sourceKind.length > 0
      && record(c.source) !== null;
  }) : null;
  if (!matched || matched.length !== 1) {
    blockers.push("REQUIRED_DEPLOYMENT_ALIAS_CHECK_MISSING");
  }

  return Object.freeze({
    schemaVersion: "origin.vercel-checks-audit.v1",
    projectId,
    configuredBlockingCheckFound: Array.isArray(matched) && matched.length === 1,
    releaseAuthorized: false,
    blockers: Object.freeze(blockers),
  });
}

export type OriginVercelCheckReadbackV1 =
  | { ok: true; audit: OriginVercelCheckAuditV1 }
  | { ok: false; code: "VERCEL_CHECK_READBACK_UNAVAILABLE" };

export async function fetchAndAuditOriginVercelChecksV1(input: {
  projectId: string;
  teamId: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<OriginVercelCheckReadbackV1> {
  if (!/^prj_[A-Za-z0-9]+$/.test(input.projectId)
    || !/^team_[A-Za-z0-9]+$/.test(input.teamId)
    || !input.token || input.token.length < 12) {
    return { ok: false, code: "VERCEL_CHECK_READBACK_UNAVAILABLE" };
  }
  // Fixed authority and path prevent caller-controlled SSRF or redirection.
  const url = new URL(
    `https://api.vercel.com/v2/projects/${input.projectId}/checks`,
  );
  url.searchParams.set("teamId", input.teamId);
  url.searchParams.set("blocks", "deployment-alias");
  try {
    const response = await (input.fetchImpl ?? fetch)(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return { ok: false, code: "VERCEL_CHECK_READBACK_UNAVAILABLE" };
    // Never return the raw response, request token, or arbitrary error text.
    const payload = await response.json() as unknown;
    return { ok: true, audit: auditOriginVercelChecksV1(payload, input.projectId) };
  } catch {
    return { ok: false, code: "VERCEL_CHECK_READBACK_UNAVAILABLE" };
  }
}
