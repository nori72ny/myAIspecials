/**
 * Read-only Vercel Deployment Checks configuration audit.
 *
 * A configured deployment-alias check is NECESSARY but not SUFFICIENT:
 * a release is never authorized without proving it actually holds the live
 * production domain during an intentional negative-path test.
 *
 * Vercel documented API: GET /v2/projects/{projectIdOrName}/checks
 * with teamId and NO blocks filter. The audit must inspect all check
 * stages or a nonblocking same-name duplicate could disappear server-side.
 */
export const ORIGIN_VERCEL_RELEASE_CHECK_NAME = "ORIGIN Exact-SHA Release Gate" as const;
/** Upper bound on *raw bytes* parsed from an authenticated upstream response.
 * Keep independent of the maximum check-row count: a single malicious/invalid
 * nested entry could otherwise exhaust memory before post-parse validation.
 */
const MAX_VERCEL_CHECK_RESPONSE_BYTES = 256 * 1024;

async function readBoundedVercelCheckPayload(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null
    && (!/^(?:0|[1-9][0-9]{0,6})$/.test(declaredLength)
      || Number(declaredLength) > MAX_VERCEL_CHECK_RESPONSE_BYTES)) {
    throw new Error("VERCEL_CHECK_RESPONSE_TOO_LARGE");
  }
  const body = response.body;
  if (!body) throw new Error("VERCEL_CHECK_RESPONSE_MISSING");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_VERCEL_CHECK_RESPONSE_BYTES) {
        throw new Error("VERCEL_CHECK_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}


/**
 * Inject ONLY from protected and independently approved server-side config.
 * An arbitrary provider check with the same name must not be able to
 * impersonate this production release gate.
 */
export type OriginVercelTrustedCheckSourceV1 = Readonly<{
  kind: "webhook" | "integration" | "git-provider";
  identity: string;
}>;

export type OriginVercelCheckAuditV1 = Readonly<{
  schemaVersion: "origin.vercel-checks-audit.v1";
  projectId: string;
  configuredBlockingCheckFound: boolean;
  releaseAuthorized: false;
  blockers: readonly (
    | "VERCEL_CHECK_API_EVIDENCE_MISSING"
    | "REQUIRED_DEPLOYMENT_ALIAS_CHECK_MISSING"
    | "TRUSTED_CHECK_SOURCE_NOT_CONFIGURED"
  )[];
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/**
 * A name alone is not an authenticated release signal. Vercel's Checks V2
 * source union requires a concrete integration/webhook/external GitHub check
 * identity. An empty object or arbitrary sourceKind is NOT sufficient.
 */
function isValidTrustedVercelSource(
  value: OriginVercelTrustedCheckSourceV1 | undefined,
): value is OriginVercelTrustedCheckSourceV1 {
  if (!value || typeof value.identity !== "string") return false;
  // GitHub check display names legitimately contain spaces and ampersands.
  // Opaque webhook/integration identifiers remain restricted to safe ID chars.
  return value.kind === "git-provider"
    ? /^[A-Za-z0-9][A-Za-z0-9 _./:&()+-]{3,159}$/.test(value.identity)
      && value.identity.trim() === value.identity
    : (value.kind === "webhook" || value.kind === "integration")
      && /^[A-Za-z0-9_.:-]{4,160}$/.test(value.identity);
}

function hasIdentifiableVercelCheckSource(
  item: Record<string, unknown>,
  expected: OriginVercelTrustedCheckSourceV1 | undefined,
): boolean {
  const source = record(item.source);
  if (!source || !isValidTrustedVercelSource(expected)
    || typeof item.sourceKind !== "string") return false;
  if (source.kind === "webhook") {
    return expected.kind === "webhook" && item.sourceKind === "webhook"
      && source.webhookId === expected.identity;
  }
  if (source.kind === "integration") {
    return expected.kind === "integration" && item.sourceKind === "integration"
      && source.externalResourceId === expected.identity;
  }
  if (source.kind === "git-provider") {
    return expected.kind === "git-provider" && item.sourceKind === "git-provider"
      && source.provider === "github" && source.externalCheckName === expected.identity;
  }
  return false;
}

function explicitlyTargetsProduction(item: Record<string, unknown>): boolean {
  // Do not infer Production coverage from a missing/empty target list.
  // Reconcile any provider-wide defaults only after authoritative readback.
  return Array.isArray(item.targets)
    && item.targets.every(value => typeof value === "string")
    && item.targets.includes("production");
}

export function auditOriginVercelChecksV1(
  payload: unknown,
  projectId: string,
  trustedSource?: OriginVercelTrustedCheckSourceV1,
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
  if (!isValidTrustedVercelSource(trustedSource)) {
    blockers.push("TRUSTED_CHECK_SOURCE_NOT_CONFIGURED");
  }

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
      && hasIdentifiableVercelCheckSource(c, trustedSource)
      && explicitlyTargetsProduction(c)
      // A removed check may still appear in a stale/full API response.
      && (c.deletedAt === undefined || c.deletedAt === null);
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
  trustedSource?: OriginVercelTrustedCheckSourceV1;
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
  // Never prefilter by blocking stage: a same-name but nonblocking duplicate
  // must be visible so the release gate can reject ambiguous configuration.
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
    const payload = await readBoundedVercelCheckPayload(response);
    return { ok: true, audit: auditOriginVercelChecksV1(payload, input.projectId, input.trustedSource) };
  } catch {
    return { ok: false, code: "VERCEL_CHECK_READBACK_UNAVAILABLE" };
  }
}
