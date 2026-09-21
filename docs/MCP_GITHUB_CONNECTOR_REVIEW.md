# GitHub MCP connector review

Verified: 2026-09-21 JST  
Activation state: **candidate only — not production enabled**

## Reviewed first-use profile

ORIGIN's first live MCP qualification target is intentionally narrow:

- Provider: GitHub Remote MCP Server
- Endpoint: `https://api.githubcopilot.com/mcp/x/repos/readonly`
- Toolset: `repos` only
- Server-side mode: read-only URL
- Paid fallback: prohibited
- Insiders/experimental mode: prohibited
- Tool execution: no tool is usable merely because it appears in the remote catalog; ORIGIN requires an owner-scoped exact tool-name + SHA-256 fingerprint grant.

GitHub documents the hosted Remote MCP endpoint and the `/x/{toolset}/readonly` form. It also documents that the MCP server is available to all GitHub users regardless of plan type, while individual tools inherit any paid requirement of the underlying GitHub feature. For that reason ORIGIN starts with the ordinary repository toolset in server-enforced read-only mode and does not enable Copilot, code-security, secret-protection, insiders, or all-toolsets profiles as part of this qualification.

## Authentication profile

GitHub's Remote MCP server requires an Authorization access token; the client is responsible for obtaining it. GitHub publishes OAuth authorization-server metadata specifically for MCP discovery:

- Issuer: `https://github.com/login/oauth`
- Authorization endpoint: `https://github.com/login/oauth/authorize`
- Token endpoint: `https://github.com/login/oauth/access_token`
- Authorization code and refresh-token grants
- PKCE: S256

ORIGIN keeps its existing server-side state hash, login-session binding, single-use callback consumption, PKCE verifier encryption, encrypted token store, refresh rotation fencing and no automatic network retry.

The reviewed GitHub profile additionally supports:

- no OAuth `resource` parameter when the provider does not require one;
- callback issuer response not required, while any issuer that is present must still match exactly;
- `client_secret_post` at GitHub's token endpoint;
- `offline_access` as an authorization-only scope that is not expected in the returned token scope set;
- omission of `scope` during refresh.

These are opt-in reviewed provider capabilities; they do not weaken other configured providers.

## Zero-cost evidence

Evidence sources reviewed on 2026-09-21:

1. GitHub Docs: GitHub MCP Server is available to all GitHub users regardless of plan type; tools backed by paid GitHub features retain those requirements.
   - https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/use-the-github-mcp-server
2. GitHub Remote MCP server documentation: hosted endpoint, explicit toolset URLs and `/readonly` URL modes.
   - https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md
3. GitHub OAuth discovery documentation and metadata:
   - https://docs.github.com/en/apps/github-authentication-discovery-endpoints
   - https://github.com/.well-known/oauth-authorization-server/login/oauth
4. GitHub host-integration guidance: Remote MCP requires a valid access token and recommends OAuth 2.1.
   - https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md

Runtime zero-cost evidence still expires under ORIGIN's existing maximum 31-day review window. The provider must be re-reviewed before renewal.

## Required gates before activation

This connector remains disabled until every item passes on one exact release candidate:

1. Latest PR head passes all CI/security workflows.
2. The tool-grant schema and store pass tests and security review.
3. The intended owner account exists in Supabase Auth and login/refresh/logout is verified.
4. A dedicated GitHub OAuth App or GitHub App is registered for ORIGIN with the exact production callback URI; client credentials remain server-only.
5. The runtime connector configuration uses only the reviewed `repos/readonly` endpoint and current zero-cost evidence.
6. Live OAuth callback, token refresh, MCP initialization, tool discovery, exact-fingerprint owner grant, read-only tool call, disconnect and replay rejection all pass.
7. No tool outside the approved exact fingerprint set is executable.
8. Main merge and production deployment happen only after exact-head release verification.

## Deliberate non-goals for first activation

- no repository writes;
- no issue or pull-request writes;
- no Copilot agent tools;
- no all-toolsets mode;
- no paid-feature fallback;
- no automatic grant of newly discovered tools;
- no reuse of a changed tool fingerprint;
- no production-complete claim before live E2E.
