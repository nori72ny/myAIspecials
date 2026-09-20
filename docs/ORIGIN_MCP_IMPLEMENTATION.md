# ORIGIN MCP implementation and document-insertion requirements

Status: client foundation, guarded Node HTTP/SSE adapter, disabled-by-default connection management/settings and a durable PostgreSQL store adapter implemented. No migration has been applied, live connector enabled or production deployment performed.
Baseline: main f0c1bff22d3246d3eac3903b9def5d3aa7c1e498, 2026-09-20.
Keep main frozen while the existing V1.4 final qualification remains pending.

## Accepted owner requirements and order

1. MCP client: ORIGIN calls external MCP servers. Prioritize this.
2. MCP server: expose selected ORIGIN capabilities to other authenticated hosts.
3. Document tools: insert_into_docx, insert_into_pptx, insert_into_xlsx, insert_into_pdf.
4. Reuse the reviewed self-evolution trigger/proposal infrastructure where appropriate;
   generating a document and sending it to a customer are separate operations.

MCP provides common protocol primitives, not universal authentication, UI, paid-plan
access or feature parity. An MCP server is a tool endpoint, not automatically a way
of invoking another vendor's general-purpose chat model. Host-specific UI adapters,
OAuth/scopes and provider-specific capabilities still require integration testing.
Do not describe Apps SDK as a universally compatible superset or claim every provider
has replaced its existing APIs. Standard support alone is not permission to execute.

## This implementation

- Official SDK pinned to 1.30.0 with lockfile.
- One user/server session per instance; no credentialed global singleton.
- SDK initialize, capability negotiation and paginated tools/list.
- Concurrent initialization coalesced; bounded pages/tools/request timeouts.
- Deterministic legal function aliases, preserving exact original tool names.
- Tool grants pin the complete reviewed definition, including description/schema.
- list-changed notification invalidates grants exposed by that session until reviewed
  and a fresh session is created. Catalog changes during authorization block execution.
- Local JSON Schema validation before calling a tool.
- Server-side per-call authorization receives authenticated owner and parsed arguments.
- A single 15-second dispatch deadline covers authorization and execution. Caller
  cancellation reaches both authorization and the SDK. Late approvals cannot start
  a cancelled operation; remote cancellation never proves rollback or permits replay.
  Caller-provided cancellation reasons are replaced with stable codes before the SDK
  can transmit a cancellation notification; document text/credentials in those reasons
  are not forwarded.
- No automatic retry of mutations. Unknown remote completion must not be called success.
- Remote exception messages and isError content are not returned to the model.
- Configuration uses named server-side environment references, not raw string replacement.
- HTTP transport requires an explicitly supplied guarded network adapter, checks an
  exact endpoint and allowlisted HTTPS origin, and rejects redirect following.
- Node adapter checks DNS at socket connection time and passes only the checked
  public addresses to the socket. A fresh agent per request prevents stale-socket reuse.
- Rejects redirects, IP-literal endpoints, compressed responses and unsafe headers.
  TLS certificate verification stays enabled; credential headers are never forwarded
  to another URL. Caller cancellation and a total 15-second per-request deadline
  cover DNS lookup, response headers and streaming bodies.
- Limits request bodies to 64 KiB, response bodies to 1 MiB, and headers to 16 KiB.
  Limits can only be reduced. Streaming has backpressure and destroys sockets on
  cancellation, truncation, timeout or overflow. Errors expose stable codes only.
- Authenticated management routes and a Japanese/English settings section are implemented.
  Default application construction injects no authentication/storage/credential broker;
  status explicitly reports configured=false and all management writes fail closed.
- Credential ciphertext uses AES-256-GCM with owner/connection/server/endpoint binding;
  list and mutation responses return only allowlisted connection metadata.
- The PostgreSQL connection store keeps only the encrypted envelope and allowlisted
  metadata. Reads always include the authenticated owner. Inserts serialize by owner
  before enforcing the 20-connection limit and owner/server uniqueness; checks and
  deletes use compare-and-swap versions. Its Supabase migration revokes browser roles
  and enables RLS without adding a browser policy. The adapter is not automatically
  constructed or mounted by the default application.
- A disabled-by-default Supabase Auth adapter validates the HttpOnly
  `__Host-origin-session` cookie through the project's fixed `/auth/v1/user` endpoint.
  It accepts only the server-configured Supabase user UUIDs, ignores editable user
  metadata, bounds the response and deadline, refuses redirects and returns no token
  or upstream error. The adapter is not yet a sign-in/session issuance flow.
- Registration uses a server-side per-owner credential broker, never browser-supplied
  service tokens or arbitrary URLs. Exact Origin plus a custom mutation header guards
  POST and DELETE. Shared-store owner scoping and atomic version checks are required.
- Check operations instantiate a guarded, owner-scoped session with no tool grants,
  discover the catalog, then close it. They do not invoke remote tools. An unfinished
  initialization can now be closed promptly. Failed checks are never shown as verified.
- No model switch, scanner, provider activation or production environment change.

## Gates before end-user enablement

Use createNodeMcpTransport for Node integrations; it always installs createNodeMcpFetch.
The guarded adapter is covered by deterministic DNS/socket/stream tests, real-SDK
JSON/SSE tests, and actual TLS sockets against a controlled local HTTPS peer. The TLS
fixture substitutes DNS and destination routing after the production DNS guard, and
trusts an ephemeral test CA only inside the fixture. It verifies certificate/hostname
rejection before credential transmission, JSON/SSE tool dispatch, DNS rebinding,
redirect refusal, response limits, deadlines and cancellation. Public DNS routing,
OAuth and live vendor behavior remain unverified. No native-fetch fallback
is allowed. Long-lived SSE connections currently stop after 15 seconds and are not
automatically reconnected; long-running remote jobs require a separately bounded design.
The adapter is Node-only. Do not import it into browser or Worker bundles or assume
Node CI certifies an edge runtime; add a separate reviewed runtime adapter if needed.

The current Express createOriginApp accepts optional MCP dependencies and mounts the
management router; api/index uses its unconfigured default. createNodeMcpManagement
composes guarded discovery-only sessions with explicit verified-session, credential
broker and shared-store adapters. There is no unsigned header identity adapter in
production. Keep credential handling server-side and do not import the Node transport
factory into the Worker or browser bundle.

Before activation, connect a real verified-user session provider, review and apply the
durable shared McpConnectionStore migration, and implement a per-owner credential broker.
The in-memory store remains a test fixture. Existing ORIGIN operator
secrets are not repurposed as browser login credentials. Add encryption-key rotation
and expiry/revocation handling with the durable credential integration. Start with
reviewed, explicitly zero-cost-approved endpoints; a configuration flag is not evidence
of a vendor billing plan or consent to run tools.
OAuth for services such as Canva needs a real authorization flow, token audience,
scopes, refresh/revocation and protected redirect handling. Do not request pasted
production secrets in chat or claim static bearer tokens work for all providers.

Integrate bounded chat tool rounds through the existing free-only provider boundary.
Preserve assistant tool_calls and corresponding tool messages, stop on cancellation,
cap total calls/bytes/time and prevent parallel mutations to the same artifact.
Do not use remote annotations as the sole authority for whether an operation writes.
Authorize owner-approved existing-file edits under a scoped policy. Customer send,
external publish and privileged operations require an operation-bound approval.
OAuth grant consent is distinct from approval of a destructive tool operation.
External service billing must satisfy the existing zero-cost policy before execution.

Production release requires current exact-head CI and real authenticated end-to-end
connector tests, then existing main-release gates. In-memory tests are not evidence of
live Canva/GitHub connectivity or OAuth readiness.

## Deterministic document insertion contract

Natural language selects an anchor; deterministic code resolves the anchor and changes
the artifact. Never let generated coordinates alone authorize a write.

Priority: explicit position > existing template/page geometry > format defaults for
new documents. Preserve existing page/slide sizes, margins, fonts and branding. A4 with
2.54 cm margins and 16:9 slides are defaults for new files, not conversions of originals.

Common input: artifactId, expectedVersion, operationId, anchor, content and layoutPolicy.
Resolve artifactId through owner-scoped storage; never accept arbitrary filesystem paths.
Ambiguous/missing anchors must return a resolvable error instead of inserting elsewhere.
Validate the expected version atomically; produce a recoverable new version and preview.
Deduplicate operationId so retries cannot insert the same content twice. Audit metadata
must avoid raw document contents/secrets. A successful API response alone is not success:
reopen the file, render/check geometry and report any overflow or unsupported structure.

| Tool | Deterministic anchor / checks |
| --- | --- |
| insert_into_docx | Heading/bookmark/table-cell anchor; preserve sections, styles, merged cells, headers/footers. Check floating shapes and unsupported tracked changes before mutation. |
| insert_into_pptx | Slide ID and placeholder ID preferred; otherwise constrained rectangle within original slide dimensions. Measure text, preserve slide master, reject overlaps/overflow. |
| insert_into_xlsx | Sheet and cell/named range; find the actual table bottom before append. Preserve formulas, merged cells, validations and chart ranges. Prevent unintended formula injection from plain text. |
| insert_into_pdf | Page, crop/media box and rotation-aware rectangle. Overlay only in confirmed whitespace or add a page. Overlay does not reflow existing text; preserve the original, handle scans/OCR separately, and reject signed/encrypted mutations unless explicitly supported. |

Existing-file edits may run automatically within owner-granted scope and version checks.
New customer deliverables/final files may be generated automatically; sending externally
requires human approval tied to the exact artifact version and recipients. Generation
must not implicitly send, publish or weaken existing repository deployment controls.

## Relationship to current work

The uploaded bundle is a proposal, not the current application. It has a missing
.github workflow, a global MCP singleton, an unprotected sample route, ambiguous
separator-based routing, raw environment substitution, and a self-update script using
a chat-response contract that does not match current ORIGIN.

Self-evolution PR #580 and Owner Inbox PR #582/#583 already supersede parts of the bundle.
Do not overwrite them with the uploaded scripts. V1.5 design PR #584 is a separate track.
This client foundation does not certify those PRs, change main or claim their CI passes.

Reference: https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices

## Validation and continuation

- Base head d2afecc333781879dfd6ab1e10ae631d8a4b20eb: all six GitHub PR workflows
  completed successfully (verified 2026-09-20). This does not certify subsequent heads.
- Incoming owner head 3921658: all six GitHub PR workflows passed; its TLS/cancellation
  changes were retained when merging the connection-management increment.
- Integrated increment: 130 tests passed (MCP, API, component and existing settings),
  including the nine actual-TLS tests. Typecheck, design-token lint and production
  build passed. Existing SettingsModal tests emit React act warnings but pass.
- Durable-store increment: 113 focused MCP tests and 1,791 full non-browser tests
  passed locally. Typecheck, design-token lint, production build and the Node ESM
  serverless runtime check passed. The migration was created with Supabase CLI 2.117.0
  but was not applied; live PostgreSQL behavior and exact-head CI remain unverified.
- Concurrency correction `be7f892`: all six workflows passed. PostgreSQL 16 and 18
  observed a real advisory-lock wait, then rejected the contender after counting the
  preceding committed row. Owner-scoped reads/deletes and stale-version rejection also
  passed against the disposable databases. This verifies the store implementation and
  migration contract; it does not mean the production migration has been applied.
- Supabase owner-auth increment: 1,800 full non-browser tests passed locally, including
  malformed/duplicate cookie rejection, server-side owner allowlisting, response-size
  and deadline bounds, and denial of a valid non-owner user even when editable metadata
  claims owner status. Typecheck, design-token lint, production build and the Node ESM
  serverless runtime check passed. Exact-head CI remains required.
- Two mobile browser tests were added: actual disabled-backend status and a simulated
  authenticated registration/check/disconnect UI. Local browser execution is blocked
  by unavailable browser binaries/download; agent-browser daemon also fails to start.
  These tests must pass on exact-head CI; they are not live OAuth/vendor evidence.
- Run current-head CI before treating the increment as release-verified.
- No live third-party request, customer send, merge or deployment was performed.

Next: connect the verified-user authentication and shared persistence adapters,
review zero-cost connector eligibility and operation-scoped authorization before
activating management or adding a chat route. Complete OAuth lifecycle and real vendor
E2E for each explicitly enabled connector.
An injected `authorize` callback remains a trusted integration boundary, not proof
that a connector is free or that a customer send is approved. Enabling a connector,
changing environment/permissions and publishing ORIGIN's MCP server still require
Owner approval. Keep Self-Evolution's outstanding source-to-sink findings tracked
separately; this MCP verification does not close them.
