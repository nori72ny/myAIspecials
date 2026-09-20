# ORIGIN MCP implementation and document-insertion requirements

Status: MCP client foundation, guarded Node HTTP/SSE transport, durable PostgreSQL stores,
Supabase owner-session verification, server-side PKCE/OAuth token lifecycle, protected
management routes and settings UI are implemented on PR #585. The default production
application remains fail-closed and unconfigured. No MCP migration has been applied to
the live Supabase project, no provider has been enabled, and main remains frozen at
`f0c1bff22d3246d3eac3903b9def5d3aa7c1e498`.

This document describes the current code, not a promise that a third-party service is
available, free, authorized or production-ready.

## Accepted owner requirements and order

1. MCP client: ORIGIN calls approved external MCP servers. Prioritize this.
2. MCP server: expose selected ORIGIN capabilities to other authenticated hosts.
3. Document tools: `insert_into_docx`, `insert_into_pptx`, `insert_into_xlsx`, `insert_into_pdf`.
4. Reuse reviewed self-evolution/approval infrastructure where appropriate; generation,
   mutation and external delivery are separate operations.

MCP supplies protocol interoperability, not universal authentication, billing access,
OAuth scope compatibility, UI parity or permission to execute. Each connector still needs
provider-specific review, zero-cost evidence where required, and live end-to-end testing.

Reviewed connector configuration requires structured zero-cost evidence rather than a
boolean assertion alone: a bounded evidence ID, verification and expiry timestamps,
an HTTPS terms/pricing source, `billingPlan: "free"` and `paidFallback: false`. Evidence
can be valid for at most 31 days. Expired evidence removes the connector from status and
blocks registration, probe, OAuth start and callback before credentials or network calls.
Disconnect remains available so an expired connector can still be revoked and removed.

## Current MCP client boundary

- Official MCP SDK is pinned to 1.30.0 with lockfile.
- Sessions are owner/server scoped; there is no credentialed global singleton.
- Initialization, capability negotiation, paginated `tools/list`, list-change invalidation,
  schema validation and deterministic exact-tool routing are bounded and fail closed.
- Grants pin the reviewed tool definition. A changed catalog invalidates the grant.
- Server-side per-call authorization receives the authenticated owner and parsed arguments.
- A single 15-second dispatch deadline covers authorization and execution. Caller
  cancellation propagates through both boundaries and blocks late approvals.
- No automatic retry of mutations. Unknown remote completion is never reported as success.
- Remote exception text and MCP `isError` content are sanitized before model exposure.
- Request bodies are capped at 64 KiB, responses at 1 MiB and headers at 16 KiB.
  Streaming uses backpressure and destroys the socket on timeout, cancellation,
  truncation or overflow.

## Guarded Node transport

`createNodeMcpTransport` always installs the guarded Node network adapter.

- Endpoint and HTTPS origin must be exact and pre-approved.
- Redirects, IP-literal endpoints, compressed responses and unsafe headers are rejected.
- DNS is checked at socket-connect time; only validated public destinations are passed to
  the socket. A fresh agent prevents stale socket reuse.
- TLS hostname/certificate verification remains enabled. Credential headers are not
  forwarded to another URL.
- The 15-second whole-request deadline includes DNS, headers and streaming body.
- No native-fetch fallback exists.
- The adapter is Node-only. Worker/browser runtimes need a separate reviewed adapter.
- Long-lived SSE currently ends at the bounded deadline and is not automatically resumed.

Controlled actual-TLS tests exercise the production guard with fixture-only DNS/destination
routing and an ephemeral test CA. They prove the local guard behavior, not live-vendor
connectivity.

## Connection persistence and credential authority

The connection store and OAuth grant store have intentionally separate responsibilities.

### `origin_mcp_connections`

The connection table is metadata-only. It contains owner/server/endpoint identity,
version, status and timestamps. It does **not** store an access-token snapshot or OAuth
refresh token.

- Reads always include authenticated owner scope.
- Inserts serialize by owner before enforcing the 20-connection limit and owner/server
  uniqueness.
- Probe updates and deletes use compare-and-swap versions.
- Browser roles are revoked and RLS is enabled with no browser policy.
- The migration is unapplied to production.

`McpConnectionService` resolves a credential from the trusted broker immediately before
registration and immediately before every probe. It never falls back to a token copied
into the connection row. A probe opens a guarded owner-scoped session with no tool grants,
discovers the catalog and closes without invoking a remote tool.

Disconnect invokes the trusted credential broker/revocation hook before deleting metadata.
If broker disconnect fails, metadata is retained rather than falsely reporting a completed
disconnect.

### `origin_mcp_oauth_grants`

OAuth access/refresh tokens and expiry live only in the OAuth grant store, encrypted by
AES-256-GCM under an explicit server-side key ring.

- AAD binds owner, server, provider configuration fingerprint and random grant generation.
- Writes use the active key; explicit re-encryption can rotate existing active grants.
- `exchanging`/`refreshing` is committed before the network call so only one CAS winner
  can use a code/refresh token generation.
- No database transaction spans a remote request.
- This initial profile requires Bearer tokens, expiry between 1 and 86400 seconds and a
  rotated refresh token on refresh. Providers with different semantics require a reviewed
  adapter, not a permissive fallback.
- Failed or uncertain exchanges/refreshes require reauthorization rather than replay.
- Disconnect clears locally usable credentials first, then attempts standards-based
  revocation. Remote revocation confirmation is reported separately from local disconnect.

### `origin_mcp_oauth_pending`

PKCE pending state is server-only and five-minute bounded.

- Random 256-bit state and verifier, S256 challenge.
- State/session/configuration are hashed; the verifier is encrypted.
- The pending attempt binds owner, verified login session, server, grant generation and
  complete provider configuration fingerprint.
- Consume is atomic delete-and-return, preventing callback replay.
- Issuer mismatch, duplicate callback parameters, wrong session/owner, changed config,
  expiry and ciphertext tampering fail closed.

## Supabase owner authentication boundary

`createSupabaseMcpAuthenticator` is disabled unless explicitly composed.

- Reads only the HttpOnly `__Host-origin-session` cookie.
- Sends that exact bearer token to the fixed project `/auth/v1/user` endpoint on every
  management request, with redirect refusal, response-size bound and deadline.
- Only after Supabase accepts the bearer token does the adapter parse the same JWT and
  require valid `sub` plus `session_id` UUID claims.
- JWT `sub` must equal `/auth/v1/user.id`.
- Owner authorization comes from the server-side UUID allowlist, never `user_metadata`.
- The verified Supabase `session_id` becomes the OAuth state/session binding.
- Missing, duplicate, malformed or oversized cookies, non-owner users, invalid content,
  redirects, timeouts and upstream errors all fail closed.

This adapter does **not** issue the browser login session. The actual owner sign-in/session
issuance flow remains an activation prerequisite.

Live read-only observation on 2026-09-20: the connected ORIGIN Supabase project is healthy,
but currently has zero Auth users and zero active sessions, and the three MCP tables are
absent. No live migration or user creation was performed during this PR work.

## Protected OAuth management flow

The OAuth broker is not mounted unless explicitly provided by server composition.

1. `GET /api/mcp/status` authenticates the owner and returns only allowlisted server and
   connection metadata. Each server exposes `authMode: "oauth" | "broker"`; no OAuth
   endpoint, client secret or token is exposed.
2. For a reviewed OAuth server, `POST /api/mcp/oauth/:serverId/start` requires the verified
   login session, exact application Origin, `X-Origin-MCP-Intent: manage`, JSON `{}` and
   broker support for that server. It returns only a validated HTTPS authorization URL.
3. The settings UI shows **Start authorization** for OAuth servers and **Register** for
   non-OAuth brokered servers. It never renders a service password/token input.
4. The UI accepts only HTTPS authorization URLs and exposes a normal link to the official
   authorization page. Access tokens, refresh tokens, verifier and client secrets never
   enter the browser DOM or model context.
5. `GET /api/mcp/oauth/:serverId/callback` re-authenticates the owner/session, consumes the
   one-time PKCE callback, performs guarded server-side code exchange and persists the
   encrypted grant.
6. After durable OAuth completion, the callback creates the metadata-only connection row
   if one does not already exist. Reauthorization of an existing connection does not
   duplicate metadata.
7. Success redirects only to the fixed application origin with `?mcp=linked`.

The callback is a GET because it is an OAuth redirect; state/session/issuer validation is
the anti-CSRF/replay boundary. No browser-provided owner ID is accepted.

## Node composition and current production state

`createOriginApp` mounts the management router but its default integration object contains
no MCP authentication, store or credential broker, so production currently reports
`configured=false` and writes fail closed.

`createNodeMcpManagement` composes the guarded probe session from explicit dependencies:
verified authentication, durable store, reviewed servers, current credential resolver,
disconnect/revocation hook and optional OAuth management broker. There is no production
unsigned-header identity adapter.

Still required before activation:

- create the intended owner Auth user and implement/verify the browser session issuance
  flow that sets `__Host-origin-session`;
- configure the server-side owner UUID allowlist without exposing it to the browser;
- review and apply the three MCP migrations to the intended database only after exact-head
  review and security advisor checks;
- compose the OAuth broker and stores in the production server runtime with bounded DB
  pools and server-only encryption keys;
- select a first connector only after its provider metadata, scopes, client registration,
  billing/zero-cost eligibility and actual MCP endpoint are verified;
- run live authenticated authorization, refresh, probe, disconnect/revocation and replay
  failure E2E for that connector;
- integrate bounded MCP tool rounds through ORIGIN's existing provider/authorization
  boundary without parallel destructive mutations;
- pass exact-head release gates before any main merge or production enablement.

Do not repurpose ORIGIN operator secrets as browser login credentials, request production
secrets in chat, or infer that a connector is free merely because configuration says so.

## Deterministic document insertion contract

Natural language selects an anchor; deterministic code resolves the anchor and changes
the artifact. Generated coordinates alone never authorize a write.

Priority: explicit position > existing template/page geometry > defaults for new files.
Preserve existing page/slide sizes, margins, fonts and branding. A4 with 2.54 cm margins
and 16:9 slides are defaults for new artifacts, not conversions of existing files.

Common input: `artifactId`, `expectedVersion`, `operationId`, `anchor`, `content` and
`layoutPolicy`.

- Resolve `artifactId` through owner-scoped storage; reject arbitrary filesystem paths.
- Ambiguous/missing anchors return a resolvable error rather than inserting elsewhere.
- Validate expected version atomically and produce a recoverable new version plus preview.
- Deduplicate `operationId` so a retry cannot insert content twice.
- Audit metadata must omit raw document content and secrets.
- A successful write response is not sufficient: reopen/render/check the artifact and
  report overflow or unsupported structure.

| Tool | Deterministic anchor / checks |
| --- | --- |
| `insert_into_docx` | Heading/bookmark/table-cell anchor; preserve sections, styles, merged cells, headers/footers. Check floating shapes and unsupported tracked changes before mutation. |
| `insert_into_pptx` | Slide ID and placeholder ID preferred; otherwise constrained rectangle within original dimensions. Measure text, preserve slide master, reject overlaps/overflow. |
| `insert_into_xlsx` | Sheet and cell/named range; find the real table bottom before append. Preserve formulas, merged cells, validations and chart ranges. Prevent unintended formula injection from plain text. |
| `insert_into_pdf` | Page, crop/media box and rotation-aware rectangle. Overlay only in confirmed whitespace or add a page. Overlay does not reflow existing text; preserve the original, handle scans separately, and reject signed/encrypted mutation unless explicitly supported. |

Existing-file edits may run automatically only inside owner-granted scope and version
checks. Generating a customer deliverable is separate from sending/publishing it. External
delivery and privileged operations require approval bound to the exact artifact version,
operation and recipients.

## Relationship to other ORIGIN work

The originally uploaded MCP bundle is a proposal, not the current application. Its global
singleton, unprotected sample route, separator-based tool routing, raw environment
substitution and self-update script must not replace current ORIGIN architecture.

Self-evolution PR #580 and Owner Inbox PR #582/#583 remain separate tracks. V1.5 design
PR #584 is also separate. PR #585 must not overwrite or claim to certify those changes.

## Validation chronology

Historical checkpoints are useful only as evidence for the exact SHA tested; later commits
must be requalified.

- Base `d2afecc333781879dfd6ab1e10ae631d8a4b20eb`: all six PR workflows succeeded.
- Connection-management checkpoint `e3cc346`: authenticated register/check/disconnect UI
  and guarded owner-scoped probe passed the six workflows.
- Durable-store checkpoint `3e020eb`: PostgreSQL connection-store migration and store
  tests passed; production migration remained unapplied.
- Concurrency correction `be7f892`: PostgreSQL 16/18 observed real advisory-lock blocking
  and correct post-lock capacity behavior.
- Supabase owner-auth checkpoint `d2b70bb3a30ddff341d9c793f5f3ff92bbd614ed`:
  all six workflows succeeded; Node 22/24 ran the full test/E2E/Lighthouse gates.
- PKCE checkpoint `636007d571dbae04a50d1f39ca383af713538a76`: all six workflows
  succeeded; PostgreSQL 16/18 included the durable OAuth pending-state scenarios.
- OAuth lifecycle checkpoint `9d19e87ebdb562a0beb19e93f65d0844718f852e`:
  guarded code exchange, refresh rotation, encrypted grant persistence and revocation were
  added; controlled TLS and real PostgreSQL scenarios passed.
- Broker-resolution checkpoint `2509c30c76a70cdfcc251aca5dc5d3d6f3f4622b`:
  the connection token snapshot was removed, fresh broker resolution/revocation was wired,
  Supabase `sub`/`session_id` binding and protected OAuth routes were added. ACOS lint,
  explicit typecheck, unit/API/build/runtime gates passed; PostgreSQL 16/18 passed.
- Zero-cost evidence checkpoint `13b8c16a4873b701792f3d4880d9d9fe692652a8`: connector review
  evidence became structured and expiring, with operation-time fail-closed checks before
  credential or network use. Local validation passed 1,878 tests, lint, typecheck,
  production build and the Node ESM API runtime; exact-head CI remains required.
- Current OAuth UI/callback-registration head must pass its own six exact-head workflows
  before it can be called release-verified. CI fixture success is still not live-vendor
  evidence.

No live third-party tool execution, customer send, main merge or production MCP deployment
has been performed.

## References

- MCP security best practices: https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices
- MCP authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- PKCE: https://www.rfc-editor.org/rfc/rfc7636
- Authorization response issuer: https://www.rfc-editor.org/rfc/rfc9207
- OAuth 2.0: https://www.rfc-editor.org/rfc/rfc6749
- OAuth 2.0 security BCP: https://www.rfc-editor.org/rfc/rfc9700
- Token revocation: https://www.rfc-editor.org/rfc/rfc7009
