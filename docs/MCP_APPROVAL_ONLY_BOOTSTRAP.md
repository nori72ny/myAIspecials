# MCP approval-only bootstrap design

Status: M2 design baseline
Updated: 2026-09-21 JST
Depends on: current MCP client foundation port candidate

## Objective

Make ORIGIN's connected-tool activation compatible with the Owner operating model:

- the Owner approves;
- ORIGIN performs setup, validation, secret handling, configuration, testing and rollback preparation;
- no manual credential copying, shell commands, repository edits or debugging by the Owner;
- no permission expansion without a separate Owner approval.

The first provider is GitHub Remote MCP and the first automatic tool remains read-only `get_file_contents`.

## Why GitHub App Manifest

GitHub's App Manifest flow lets ORIGIN predefine a GitHub App configuration, redirect the Owner to GitHub for a review/approval step, then receive a one-time code and exchange it server-side for the app registration. This reduces manual setup while keeping the actual account-level approval on GitHub.

ORIGIN must never render or return the resulting client secret, private key or webhook secret to the browser or model.

## M2 security contract

1. M1 remains frozen. M2 is a separate branch/PR.
2. Manifest initiation is same-origin and CSRF/state protected.
3. The manifest requests only:
   - private app;
   - repository permission `contents: read`;
   - no write permission;
   - no webhook events;
   - webhook disabled;
   - user authorization enabled only where required for the reviewed GitHub Remote MCP OAuth path.
4. The callback URL is exact and same-origin.
5. Manifest state is single-use, short-lived and server-side bound.
6. Conversion of the GitHub one-time code occurs only server-side.
7. The returned app owner must match the configured Owner GitHub account identity before any registration is accepted.
8. Client secret is encrypted immediately and never logged.
9. The returned PEM/private key and webhook secret are not retained because this phase does not use installation-token or webhook execution.
10. Registration persistence is versioned and owner-bound.
11. App installation is restricted to selected repositories; the initial production target is `nori72ny/myAIspecials` only.
12. Runtime MCP OAuth continues to require:
    - canonical reviewed endpoint `https://api.githubcopilot.com/mcp/x/repos/readonly`;
    - `github-file-readonly` transport profile;
    - GitHub App permission model;
    - no OAuth scopes;
    - PKCE S256;
    - exact GitHub issuer/auth/token/revocation endpoints;
    - `X-MCP-Readonly: true`;
    - `X-MCP-Tools: get_file_contents`;
    - current USD 0 evidence;
    - no paid fallback.

## Proposed flow

### Phase A — manifest approval

1. Owner opens ORIGIN settings.
2. ORIGIN displays a single action: **GitHub連携を承認**.
3. ORIGIN creates a short-lived one-time bootstrap state.
4. Browser posts the reviewed manifest to GitHub.
5. GitHub shows the app registration approval page.
6. Owner approves.
7. GitHub redirects to ORIGIN with the temporary manifest code.
8. ORIGIN exchanges the code server-side.
9. ORIGIN verifies app owner identity, reviewed permissions and callbacks.
10. ORIGIN encrypts only the fields needed for the user OAuth path and discards unused secret material.

### Phase B — repository installation approval

1. ORIGIN creates the GitHub App installation URL with anti-replay state.
2. Owner approves installation for `nori72ny/myAIspecials` only.
3. ORIGIN verifies the returned installation/repository scope before enabling connector authorization.
4. A broader repository selection is treated as a permission expansion and is not activated automatically.

### Phase C — user authorization

1. ORIGIN begins its existing reviewed OAuth/PKCE flow.
2. Owner approves GitHub user authorization.
3. ORIGIN exchanges and encrypts the short-lived GitHub App user token.
4. ORIGIN probes the canonical repos-only read-only Remote MCP endpoint.
5. ORIGIN discovers tools.
6. ORIGIN persists an exact grant only for `get_file_contents`.

### Phase D — live verification

ORIGIN must verify, in order:

1. authenticated owner session;
2. manifest registration fingerprint;
3. exact repository installation scope;
4. OAuth discovery;
5. callback replay rejection;
6. token refresh;
7. MCP catalog;
8. exact tool grant;
9. one `get_file_contents` execution;
10. no raw tool result/token leakage;
11. disconnect + remote revoke;
12. replay after revoke fails;
13. USD 0 evidence remains current.

## Persistence model

Add a server-only table for GitHub App registration material. Browser roles receive no table privileges.

Minimum conceptual fields:

- owner_id
- provider
- app_id
- app_slug
- client_id
- encrypted_client_secret
- registration_fingerprint
- version
- status
- created_at
- updated_at

Do not store the PEM/private key or webhook secret for this read-only user-token architecture.

A separate short-lived pending table should hold manifest state/code-exchange claims with expiry and one-time consumption semantics.

## Runtime integration

The current M1 runtime expects the GitHub client secret from a static environment variable. M2 should replace only that GitHub-specific secret resolution path with an owner-bound encrypted registration resolver.

Do not weaken M1's reviewed server configuration. Endpoint, issuer, token endpoint, permission model, callback path, read-only profile and zero-cost evidence remain static reviewed policy. Only the app instance identity/client credential becomes durable encrypted owner configuration.

## Owner approval surface

The Owner should see only four approval classes:

1. **Create GitHub App** — confirms the pre-reviewed read-only app configuration.
2. **Install on repository** — initially `nori72ny/myAIspecials` only.
3. **Authorize GitHub account** — grants the user-to-server token needed by the reviewed Remote MCP flow.
4. **Production release** — separate final release approval after live E2E passes.

All other work remains ORIGIN's responsibility.

## Fail-closed rules

M2 must remain disabled if any of the following occurs:

- owner identity mismatch;
- manifest state expired/replayed;
- callback mismatch;
- requested permissions differ from the reviewed manifest;
- repository scope is broader than approved;
- secret persistence fails;
- OAuth discovery differs from reviewed GitHub endpoints;
- token shape/expiry differs from the GitHub App profile;
- zero-cost evidence is missing/expired;
- MCP exposes a tool outside the exact approved grant;
- any attempt would require a paid plan or paid fallback.

## M2 completion gate

M2 is code-complete only when:

- manifest start/callback routes exist;
- durable encrypted registration storage exists;
- owner identity verification exists;
- repository-scope verification exists;
- browser UI exposes only approval actions;
- no secret is browser-visible;
- unit/API/E2E tests cover replay, mismatch, broadened permissions and failure recovery;
- exact-head CI/security gates pass.

M2 is not production-complete until the real Owner approval flow and live GitHub E2E pass.
