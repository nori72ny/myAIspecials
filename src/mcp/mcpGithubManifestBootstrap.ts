const GITHUB_MANIFEST_ACTION = "https://github.com/settings/apps/new";
const GITHUB_MANIFEST_CONVERSION_ORIGIN = "https://api.github.com";

const APP_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{2,63}$/;
const STATE = /^[A-Za-z0-9_-]{32,128}$/;
const CLIENT_ID = /^[A-Za-z0-9_-]{8,128}$/;
const CLIENT_SECRET = /^[A-Za-z0-9_-]{20,256}$/;
const APP_SLUG = /^[a-z0-9-]{1,100}$/;
const OWNER_LOGIN = /^[A-Za-z0-9-]{1,39}$/;

export class McpGithubManifestError extends Error {
  constructor(readonly code: string) { super(code); }
}

function fail(code: string): never { throw new McpGithubManifestError(code); }

function exactHttps(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return fail("MCP_GITHUB_MANIFEST_URL_INVALID");
  let url: URL;
  try { url = new URL(value); } catch { return fail("MCP_GITHUB_MANIFEST_URL_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    return fail("MCP_GITHUB_MANIFEST_URL_INVALID");
  }
  return url.href;
}

function sameOriginUrl(origin: string, pathname: string): string {
  const base = new URL(exactHttps(origin));
  const canonicalOrigin = base.origin;
  if (origin.replace(/\/$/, "") !== canonicalOrigin) return fail("MCP_GITHUB_MANIFEST_ORIGIN_INVALID");
  return new URL(pathname, canonicalOrigin).href;
}

export interface McpGithubManifestInput {
  appOrigin: string;
  appName: string;
  state: string;
}

export interface McpGithubManifestBootstrap {
  action: string;
  state: string;
  manifest: string;
}

export function createMcpGithubAppManifestBootstrap(
  input: McpGithubManifestInput,
): McpGithubManifestBootstrap {
  const appOrigin = exactHttps(input.appOrigin).replace(/\/$/, "");
  if (!APP_NAME.test(input.appName) || !STATE.test(input.state)) {
    return fail("MCP_GITHUB_MANIFEST_INPUT_INVALID");
  }

  const redirectUrl = sameOriginUrl(appOrigin, "/api/mcp/github/manifest/callback");
  const oauthCallback = sameOriginUrl(appOrigin, "/api/mcp/oauth/github/callback");
  const setupUrl = sameOriginUrl(appOrigin, "/api/mcp/github/install/callback");

  const manifest = {
    name: input.appName,
    url: appOrigin + "/",
    redirect_url: redirectUrl,
    callback_urls: [oauthCallback],
    setup_url: setupUrl,
    setup_on_update: true,
    public: false,
    request_oauth_on_install: false,
    default_permissions: {
      contents: "read",
    },
    default_events: [],
  };

  const action = new URL(GITHUB_MANIFEST_ACTION);
  action.searchParams.set("state", input.state);

  return Object.freeze({
    action: action.href,
    state: input.state,
    manifest: JSON.stringify(manifest),
  });
}

export interface GithubManifestConversionPayload {
  id?: unknown;
  slug?: unknown;
  client_id?: unknown;
  client_secret?: unknown;
  pem?: unknown;
  webhook_secret?: unknown;
  owner?: unknown;
  permissions?: unknown;
  events?: unknown;
}

export interface VerifiedGithubManifestRegistration {
  appId: number;
  appSlug: string;
  ownerLogin: string;
  clientId: string;
  clientSecret: string;
}

function verifiedPermissions(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const permissions = value as Record<string, unknown>;
  const keys = Object.keys(permissions);
  if (!keys.includes("contents")) return false;
  for (const key of keys) {
    if (key === "contents" && permissions[key] === "read") continue;
    if (key === "metadata" && permissions[key] === "read") continue;
    return false;
  }
  return true;
}

export function verifyGithubManifestConversion(
  payload: GithubManifestConversionPayload,
  expectedOwnerLogin: string,
): VerifiedGithubManifestRegistration {
  if (!OWNER_LOGIN.test(expectedOwnerLogin)) return fail("MCP_GITHUB_OWNER_INVALID");
  if (!Number.isSafeInteger(payload.id) || Number(payload.id) <= 0) return fail("MCP_GITHUB_MANIFEST_RESPONSE_INVALID");
  if (typeof payload.slug !== "string" || !APP_SLUG.test(payload.slug)) return fail("MCP_GITHUB_MANIFEST_RESPONSE_INVALID");
  if (typeof payload.client_id !== "string" || !CLIENT_ID.test(payload.client_id)) return fail("MCP_GITHUB_MANIFEST_RESPONSE_INVALID");
  if (typeof payload.client_secret !== "string" || !CLIENT_SECRET.test(payload.client_secret)) return fail("MCP_GITHUB_MANIFEST_RESPONSE_INVALID");
  if (!verifiedPermissions(payload.permissions)) return fail("MCP_GITHUB_PERMISSION_EXPANSION");
  if (!Array.isArray(payload.events) || payload.events.length !== 0) return fail("MCP_GITHUB_EVENT_EXPANSION");

  const owner = payload.owner;
  if (!owner || typeof owner !== "object" || Array.isArray(owner)) return fail("MCP_GITHUB_OWNER_MISMATCH");
  const login = (owner as Record<string, unknown>).login;
  if (typeof login !== "string" || login.toLowerCase() !== expectedOwnerLogin.toLowerCase()) {
    return fail("MCP_GITHUB_OWNER_MISMATCH");
  }

  return Object.freeze({
    appId: Number(payload.id),
    appSlug: payload.slug,
    ownerLogin: login,
    clientId: payload.client_id,
    clientSecret: payload.client_secret,
  });
}

export function githubManifestConversionUrl(code: string): string {
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(code)) return fail("MCP_GITHUB_MANIFEST_CODE_INVALID");
  return new URL("/app-manifests/" + encodeURIComponent(code) + "/conversions", GITHUB_MANIFEST_CONVERSION_ORIGIN).href;
}
