# ORIGIN MCP implementation and document-insertion requirements

Status: client foundation implemented, not connected to application routes or deployed.
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
- No automatic retry of mutations. Unknown remote completion must not be called success.
- Remote exception messages and isError content are not returned to the model.
- Configuration uses named server-side environment references, not raw string replacement.
- HTTP transport requires an explicitly supplied guarded network adapter, checks an
  exact endpoint and allowlisted HTTPS origin, and rejects redirect following.
- No route, settings UI, model switch, scheduled scanner, provider activation or production
  environment change is included in this foundation.

## Gates before end-user enablement

Implement and test a reviewed network adapter with connect-time DNS/public-IP checks,
redirect rejection, bounded JSON/SSE response streaming, request cancellation and a
15-second execution budget. Native fetch is not an acceptable production adapter.
URL allowlisting alone does not prevent DNS rebinding. The existing legacy secureFetch
returns GET text, so it cannot simply be passed as the SDK fetch implementation.

Wire the current Express createOriginApp and provider boundary rather than adding the
uploaded unprotected api/mcp/tools.ts sample. Confirm both Node and serverless/worker
support before enabling a runtime. Keep credentials and MCP management server-side.

Add authenticated connection storage, encrypted credentials, explicit ownership,
CSRF protection for settings mutations, revocation/disconnect and status views. Start
with approved endpoints; do not accept arbitrary URLs from model tool arguments.
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
