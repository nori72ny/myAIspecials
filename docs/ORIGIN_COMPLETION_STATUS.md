# ORIGIN completion status

Last updated: 2026-09-23 JST

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
- Production release SHA: `2f1d7069006c21050611e9703fb6506697b1bac1`
- Production URL: `https://origin-personal.vercel.app/`
- `/api/health`: HTTP 200 on 2026-09-23, `releaseSha=2f1d7069006c21050611e9703fb6506697b1bac1`, `costUsd=0`, `freeOnly=true`, `paidFallbackEnabled=false`, server-only secret delivery.

## Active release candidate (not Production)

- Active release track: PR #608, branch `feat/ui-shell-redesign-audit-20260922`.
- PR #608 remains Draft / DO NOT MERGE until the release gates below are satisfied and the Owner explicitly approves release.
- The exact candidate SHA is intentionally **not frozen in this ledger**: editing this ledger changes the candidate SHA. Read PR #608 live metadata and bind every CI, Preview, screenshot and benchmark artifact to that live head.
- The candidate Preview remains protected by Vercel SSO. Do not weaken Preview protection or distribute bypass credentials merely to make external review easier; use exact-head Playwright/screenshot evidence for independent visual review.
- Production remains the SHA above until an Owner-approved merge/deploy is completed and exact Production SHA equality is re-verified.

## Capability matrix

| Capability | State | Current evidence | What is still missing |
| --- | --- | --- | --- |
| V1.1 Grounded Research | PRODUCTION VERIFIED (service ready) | Production `/api/research/v1.1/status` returned 200 again on 2026-09-23; free public web retrieval, max 8 sources, USD 0, no paid fallback. | Re-run a fresh successful live research query when qualifying a future release; status readiness alone is not evidence that every public source is available. |
| V1.2 Real File Artifacts | PRODUCTION VERIFIED (generator ready) | Production `/api/artifacts/v1.2/status` returned 200 again on 2026-09-23 and all self-tests were true for Markdown/CSV/PDF/DOCX/XLSX/PPTX. | Persistence remains client-save-only. Existing-file insertion/editing is a separate MCP/document-tool track and is not complete. |
| V1.3 Web / Application Builder | PRODUCTION VERIFIED (builder ready) | Production `/api/builder/v1.3/status` returned 200 again on 2026-09-23; landing/dashboard/webapp self-tests all true; verified static bundle handoff; USD 0. | Automatic external publishing remains disabled by design. Future publishing must remain approval-bound. |
| V1.4 Agentic Coding OS | PRODUCTION VERIFIED | Production `/api/coding/v1.4/status` returned `ready=true` again on 2026-09-23 with DB, durable stores, authorization, owner binding, crypto, dispatch, result store and worker all ready. Live DB shows repeated production smoke jobs ending `verified / CODING_CHECKS_PASSED`; latest verified job was created 2026-09-20 and changed only `src/agent/__origin_coding_smoke_v14__.ts`. | Continue regression monitoring. Provider rate-limit/unavailable cases remain expected fail-closed outcomes rather than paid fallback. |
| V1.5 Creative / Visual Generation | SPEC / PLANNED | PR #584 contains the free-only implementation specification. Production `/api/generate-image` remains explicitly disabled. | Actual $0 image generation runtime, provider qualification, generation/critic/repair flow, UI and live E2E. |
| MCP client / connected tools | IMPLEMENTED / CI VERIFIED OFF PRODUCTION | PR #585 includes client isolation, guarded transport, management UI/API, Supabase owner auth adapter, PKCE/OAuth lifecycle, encrypted stores, durable exact-tool grants, an owner-bound session factory and a separate owner-authenticated `/api/mcp/chat` single-tool execution boundary. Automatic agent execution is limited to explicitly reviewed read-only connectors; the first reviewed profile is constrained to GitHub Remote MCP read-only `get_file_contents`. All four MCP DB migrations are live with RLS enabled and browser-role access revoked. Exact head `b8af43fdb005a265303f2805d1a293aa574b86f7` passed Production Release CI/CD, Node 22/24 build/test/E2E, local production-browser release gate, Lighthouse, CodeQL, ACOS Quality Gate, OpenSSF, Cloudflare Workers compatibility, browser isolation and V1.4 hosted coding sandbox on 2026-09-21. | Production still runs `main` without #585. Vercel Preview for the latest branch head is externally blocked by the free-tier build-rate limit; paid upgrade is forbidden. Live connector completion still requires a real owner identity/consent boundary where the provider requires it, GitHub App registration/authorization, server-only production configuration, and live login + OAuth + refresh + probe + exact grant + `/api/mcp/chat` + disconnect/replay E2E. |
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

1. Keep PR #608 Draft and treat its live head as the only release candidate. After any code/doc change, re-run exact-tree CI, obtain an exact-head READY Preview and re-check runtime errors before accepting evidence.
2. Close Q1 evidence gaps without weakening security: retain exact-head rendered UI evidence; obtain measured live Answer Quality and held-out Coding evidence before making Q1/Claude-Code-class claims. The sealed held-out corpus must never be exposed to the mutable engineering candidate merely to make pre-release evaluation convenient.
3. Keep physical Android + Japanese IME as a manual device gate. Browser automation may prove responsive/IME contracts but is not a substitute for an actual-device PASS.
4. Continue independent UI/Agent/Security/Research review using exact-head artifacts. Treat external-AI findings as hypotheses until reproduced against the current tree/runtime.
5. Do not merge, publish or change Production until the Owner explicitly approves the same exact SHA.
6. After approval: merge, wait for Production, require Production SHA == merged main, then run health/chat/streaming/PWA/failure-recovery/Coding smoke and runtime-log verification.
7. Only after this release track is closed, resume MCP activation, deterministic existing-file mutation, V1.5 runtime expansion and V2 unification work.

## Evidence note

This ledger records observed state, not aspirational marketing claims. Update it whenever a production SHA, release gate, database state, connector eligibility, or roadmap capability materially changes.
