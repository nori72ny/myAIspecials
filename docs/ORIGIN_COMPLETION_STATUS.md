# ORIGIN completion status

Last reconciled: 2026-09-21 UTC (repository/PR records and a fresh production health read)

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
- `/api/health`: HTTP 200, `costUsd=0`, `freeOnly=true`, `paidFallbackEnabled=false`, server-only secret delivery.

Main at reconciliation: `01f7db0c0d48ab3ba533148e99e1847203e13f4c`. Main is ahead of the observed production release. Health confirms release identity and advertised cost policy, not completion of every capability.

Cross-chat requirement index: [Enhancement handover](ORIGIN_ENHANCEMENT_HANDOVER_2026-09-21.md). Historical V1.1–V1.4 status/smoke observations below were not rerun during this documentation reconciliation; keep their original evidence scope.

## Capability matrix

| Capability | State | Current evidence | What is still missing |
| --- | --- | --- | --- |
| V1.1 Grounded Research | HISTORICAL STATUS VERIFIED (service ready) | Production `/api/research/v1.1/status` returned 200 on 2026-09-21; free public web retrieval, max 8 sources, USD 0, no paid fallback. | Re-run a fresh successful live research query when qualifying a future release; status readiness alone is not evidence that every public source is available. |
| V1.2 Real File Artifacts | HISTORICAL STATUS VERIFIED (generator ready) | Production `/api/artifacts/v1.2/status` returned 200 and all self-tests were true for Markdown/CSV/PDF/DOCX/XLSX/PPTX on 2026-09-21. | Persistence remains client-save-only. Existing-file insertion/editing is a separate MCP/document-tool track and is not complete. |
| V1.3 Web / Application Builder | HISTORICAL STATUS VERIFIED (builder ready) | Production `/api/builder/v1.3/status` returned 200; landing/dashboard/webapp self-tests all true; verified static bundle handoff; USD 0. | Automatic external publishing remains disabled by design. Future publishing must remain approval-bound. |
| V1.4 Agentic Coding OS | HISTORICAL PRODUCTION SMOKE VERIFIED | Production `/api/coding/v1.4/status` returned `ready=true` with DB, durable stores, authorization, owner binding, crypto, dispatch, result store and worker all ready. Live DB shows repeated production smoke jobs ending `verified / CODING_CHECKS_PASSED`; latest verified job was created 2026-09-20 and changed only `src/agent/__origin_coding_smoke_v14__.ts`. | Re-run release-matched evidence before certifying a new release. A synthetic smoke does not prove arbitrary task completion or Claude Code parity. Continue regression monitoring. Provider rate-limit/unavailable cases remain expected fail-closed outcomes rather than paid fallback. |
| V1.5 Creative / Visual Generation | SPEC / PLANNED | PR #584 contains the free-only implementation specification. Production `/api/generate-image` remains explicitly disabled. | Actual $0 image generation runtime, provider qualification, generation/critic/repair flow, UI and live E2E. |
| MCP client / connected tools | FOUNDATION MERGED; LIVE ACTIVATION INCOMPLETE | PR #602 merged the guarded client, auth, OAuth, encrypted stores and exact-tool execution foundation into main. PR #603/#604 remain open bootstrap candidates. | Real owner/provider consent, connector configuration and live login/OAuth/refresh/tool-call/disconnect/replay E2E; then activation and production verification. Main merge does not enable a connector. |
| ORIGIN MCP server (ORIGIN exposed outward) | SPEC / PLANNED | Ordering and security contract documented in #585. | Server implementation, auth/capability grants, tests and live host interoperability. |
| Deterministic document insertion | SPEC / PARTIAL FOUNDATION | #585 defines contracts for `insert_into_docx`, `insert_into_pptx`, `insert_into_xlsx`, `insert_into_pdf`. V1.2 can create files. | Existing-file owner-scoped storage/versioning, deterministic anchors, actual mutation engines, reopen/render verification and approval-bound external delivery. |
| Self-Evolution / autonomous update scout | IMPLEMENTED OFF MAIN | PR #580 is open Draft. | Review, exact-head release qualification, merge/production decision and bounded owner approval workflow. |
| Owner Improvement Inbox | IMPLEMENTED OFF MAIN | PR #582 and #583 are open Drafts. | Review, integration qualification, merge/production decision. |
| Final outbound-network hardening | OPEN RELEASE CANDIDATE | PR #579 is open. | Reconcile with current main/#585, exact-head release gate, merge decision. |
| Answer-quality scorer provenance | MERGED; FINAL QUALITY EVIDENCE SEPARATE | PR #578 is merged. PR #599/#600 add scheduled AQ and final held-out priority. | Check final results on the exact release SHA; scheduling/scorer code is not a passing quality score or competitor superiority. |
| UI/UX owner-screen repair | IMPLEMENTED / CI VERIFIED; NOT IN PRODUCTION | PR #605 head `5fa3c4d4deb63c13889428b7b2dfdf1e8f10ce77` passed all five Actions workflows and Vercel preview deployment. Theme, artifact close, empty preview, initial home height and Code banner corrected. | Preview is login-protected in the available browser; direct visual review and production deployment/recheck remain. Low-height/keyboard/conversation layout and other audit items remain open. |
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

1. Re-read latest main, open PRs and production health. Do not restart from the historical #585 branch.
2. Coordinate M2 GitHub bootstrap in #603/#604 without duplicating another chat's active work. Keep runtime activation disabled until its gates pass.
3. Verify M3 live owner login, OAuth discovery/callback/refresh, exact read-only tool grant, one authorized tool call, disconnect/revoke and replay rejection.
4. Complete the production-impact release gate and M4 deployment/verification. Foundation merge #602 is already done; live activation is separate.
5. Finish #605 visual/release verification and preserve the remaining UI/answer/security audit.
6. Retain MCP server, all four deterministic existing-file insertion tools, self-evolution #580, Inbox #582/#583, visual runtime #584 and V2–V4 as distinct unfinished tracks. Follow the enhancement handover for acceptance criteria.

## Evidence note

This ledger records observed state, not aspirational marketing claims. Update it whenever a production SHA, release gate, database state, connector eligibility, or roadmap capability materially changes.
