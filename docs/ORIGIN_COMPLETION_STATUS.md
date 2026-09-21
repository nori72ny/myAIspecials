# ORIGIN completion status

Last updated: 2026-09-21 10:22 JST

This file is the canonical progress ledger for ORIGIN. It deliberately separates **implemented**, **production-verified**, and **not yet activated** so that code presence is never mistaken for a completed capability.

## Status rules

- **PRODUCTION VERIFIED** — the capability is on production and a live status/E2E check has current evidence.
- **IMPLEMENTED / VERIFIED OFF PRODUCTION** — code plus exact-head CI/preview evidence exists, but production activation or live external E2E is still missing.
- **PARTIAL** — meaningful implementation exists, but an essential execution path or release gate remains.
- **SPEC / PLANNED** — design exists, but no usable runtime implementation is claimed.
- A capability must not be marked complete merely because a route, test, PR, or specification exists.
- ORIGIN's permanent release constraints remain: USD 0, no paid fallback, fail closed, no secret exposure, exact release evidence before claiming completion.

## Current production baseline

- Canonical repository: `nori72ny/myAIspecials`
- Production branch: `main`
- Production release SHA: `f0c1bff22d3246d3eac3903b9def5d3aa7c1e498`
- Production URL: `https://origin-personal.vercel.app/`
- `/api/health`: HTTP 200, `costUsd=0`, `freeOnly=true`, `paidFallbackEnabled=false`, server-only secret delivery.

## Capability matrix

| Capability | State | Current evidence | What is still missing |
| --- | --- | --- | --- |
| V1.1 Grounded Research | PRODUCTION VERIFIED (service ready) | Production `/api/research/v1.1/status` returned 200 on 2026-09-21; free public web retrieval, max 8 sources, USD 0, no paid fallback. | Re-run a fresh successful live research query when qualifying a future release; status readiness alone is not evidence that every public source is available. |
| V1.2 Real File Artifacts | PRODUCTION VERIFIED (generator ready) | Production `/api/artifacts/v1.2/status` returned 200 and all self-tests were true for Markdown/CSV/PDF/DOCX/XLSX/PPTX on 2026-09-21. | Persistence remains client-save-only. Existing-file insertion/editing is a separate MCP/document-tool track and is not complete. |
| V1.3 Web / Application Builder | PRODUCTION VERIFIED (builder ready) | Production `/api/builder/v1.3/status` returned 200; landing/dashboard/webapp self-tests all true; verified static bundle handoff; USD 0. | Automatic external publishing remains disabled by design. Future publishing must remain approval-bound. |
| V1.4 Agentic Coding OS | PRODUCTION VERIFIED | Production `/api/coding/v1.4/status` returned `ready=true` with DB, durable stores, authorization, owner binding, crypto, dispatch, result store and worker all ready. Live DB shows repeated production smoke jobs ending `verified / CODING_CHECKS_PASSED`; latest verified job was created 2026-09-20 and changed only `src/agent/__origin_coding_smoke_v14__.ts`. | Continue regression monitoring. Provider rate-limit/unavailable cases remain expected fail-closed outcomes rather than paid fallback. |
| V1.5 Creative / Visual Generation | SPEC / PLANNED | PR #584 contains the free-only implementation specification. Production `/api/generate-image` remains explicitly disabled. | Actual $0 image generation runtime, provider qualification, generation/critic/repair flow, UI and live E2E. |
| MCP client / connected tools | IMPLEMENTED OFF PRODUCTION / REQUALIFICATION IN PROGRESS | PR #585 now includes client isolation, guarded transport, management UI/API, Supabase owner auth adapter, PKCE/OAuth lifecycle, encrypted stores, durable exact-tool grants, an owner-bound session factory and a separate owner-authenticated `/api/mcp/chat` single-tool execution boundary. Automatic agent execution is limited to explicitly reviewed read-only connectors; the first implemented provider guard accepts only GitHub Remote MCP readonly URL shapes. The live MCP DB migrations remain applied with RLS/server-only privileges. Current exact-head CI requalification is running; Quality, Worker, Scorecard, Dependency Review, JavaScript/TypeScript CodeQL analysis, PostgreSQL 18 and browser isolation checks observed so far are successful. | Production still runs main without #585. Supabase Auth still requires the intended owner account/session. GitHub App/OAuth App registration and server-side production configuration are required before live OAuth. A real owner login + authorization + refresh + probe + tool discovery + approved-tool execution + disconnect/replay E2E must pass on one exact release candidate. The current exact head must finish Node 22/24 and remaining gates before this row can return to VERIFIED OFF PRODUCTION. |
| ORIGIN MCP server (ORIGIN exposed outward) | SPEC / PLANNED | Ordering and security contract documented in #585. | Server implementation, auth/capability grants, tests and live host interoperability. |
| Deterministic document insertion | SPEC / PARTIAL FOUNDATION | #585 defines contracts for `insert_into_docx`, `insert_into_pptx`, `insert_into_xlsx`, `insert_into_pdf`. V1.2 can create files. | Existing-file owner-scoped storage/versioning, deterministic anchors, actual mutation engines, reopen/render verification and approval-bound external delivery. |
| Self-Evolution / autonomous update scout | IMPLEMENTED OFF MAIN | PR #580 is open Draft. | Review, exact-head release qualification, merge/production decision and bounded owner approval workflow. |
| Owner Improvement Inbox | IMPLEMENTED OFF MAIN | PR #582 and #583 are open Drafts. | Review, integration qualification, merge/production decision. |
| Final outbound-network hardening | OPEN RELEASE CANDIDATE | PR #579 is open. | Reconcile with current main/#585, exact-head release gate, merge decision. |
| Answer-quality scorer provenance | OPEN RELEASE CANDIDATE | PR #578 is open. | Reconcile with current main, exact-head release gate, merge decision. |
| V2 Unified Production OS | PARTIAL / ROADMAP | Supervisor/approval/replay-safe foundations exist across current ORIGIN work; roadmap is documented. | Unified tool planner/executor, connected-app runtime, MCP integration, persistent task supervision, complete capability routing, and production E2E as one system. |

## MCP activation gate

The MCP database foundation is now live, but MCP is **not** a production-complete feature yet. Completion requires all of the following on one exact release candidate:

1. Intended owner account exists in Supabase Auth and real login/refresh/logout is verified.
2. Server-only owner UUID allowlist and MCP encryption/database settings are configured without exposing secrets.
3. At least one real connector has current, dated zero-cost evidence and a verified MCP/OAuth profile.
4. Live authorization, callback, token refresh, probe, tool discovery, disconnect/revocation and replay-failure E2E pass.
5. ORIGIN's agent/provider boundary can execute bounded MCP tool rounds with server-side authorization and no destructive-call retry. The code path is now implemented; a live connector E2E is still required.
6. Exact-head CI/security/E2E gates pass, then the reviewed candidate may be merged and production-deployed.
7. Production health, release SHA, zero-cost contract and connector E2E are rechecked after deployment.

## Next execution order

1. Keep #585 as the active MCP integration track and do not merge until the activation gate above is satisfied.
2. Finish exact-head CI + Preview qualification for the new authenticated single-tool execution boundary; keep public `/api/chat` unchanged.
3. Bootstrap the intended owner Auth account through an approved user action; never invent or store a user password in repository code or chat.
4. Complete GitHub OAuth App/GitHub App registration and production server-only configuration for the reviewed GitHub Remote MCP readonly endpoint.
5. Run live owner login + OAuth + refresh + probe + grant + `/api/mcp/chat` + disconnect/replay E2E; only then decide main merge/production activation.
6. After MCP client activation, implement ORIGIN MCP server and document insertion tools, then proceed to V1.5 runtime and V2 unification.

## Evidence note

This ledger records observed state, not aspirational marketing claims. Update it whenever a production SHA, release gate, database state, connector eligibility, or roadmap capability materially changes.
