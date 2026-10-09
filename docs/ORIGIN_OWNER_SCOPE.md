# ORIGIN Owner Scope & Delivery Map

Last reconciled: 2026-09-21 UTC

Full cross-chat requirement index: [Enhancement handover](ORIGIN_ENHANCEMENT_HANDOVER_2026-09-21.md). Current status evidence: [Completion ledger](ORIGIN_COMPLETION_STATUS.md).

This document tells the Owner, in one place, **what ORIGIN is intended to become, what has already been commissioned, what works in production now, what is implemented but not live, and what the next release boundary is**.

## 1. Permanent owner mandate

ORIGIN is being built as a personal AI/agent operating system that can move from a natural-language request to a verified result while keeping the Owner in control of sensitive or external actions.

Permanent constraints:

- Construction and normal use must remain **USD 0**.
- No paid-model fallback, hidden billing path, or credit-card-required fallback.
- Fail closed on rate limit, timeout, unavailable providers, invalid responses, or missing approval.
- Secrets must never be exposed in URLs, browser storage, logs, generated artifacts, or model prompts.
- External publication, destructive actions, credential creation, and equivalent high-impact actions remain approval-bound.
- A capability is not considered complete merely because code exists. Completion must distinguish implementation, exact-head verification, production deployment, and live production E2E.

## 2. What the Owner has commissioned

The Owner has already commissioned the roadmap through the autonomous-agent stage, not only the currently active MCP work.

| Area | Commissioned outcome |
| --- | --- |
| Core AI | High-quality conversational assistant with streaming, history, recovery, PWA behavior, free-only model routing and fail-closed behavior. |
| V1.1 Grounded Research | Web research, source collection, cited summaries, multi-source comparison, fact checking and research reports. |
| V1.2 Artifacts | Generate real Markdown/CSV/PDF/DOCX/XLSX/PPTX files instead of only returning prose. |
| V1.3 Web / App Builder | Design and build landing pages, dashboards and web applications, verify them, and support approval-bound publishing. |
| V1.4 Agentic Coding OS | Understand repositories, plan edits, change multiple files, run tests, repair failures, use Git/terminal/sandbox/test runner, and produce verified coding results. |
| Connected tools / MCP client | Connect ORIGIN safely to external services using owner auth, least privilege, exact tool grants, OAuth/PKCE, encrypted credentials and bounded tool execution. |
| ORIGIN MCP server | Expose selected ORIGIN capabilities outward to compatible hosts with owner-controlled grants. |
| Deterministic document editing | Open an existing DOCX/PPTX/XLSX/PDF, make deterministic owner-requested edits, reopen/verify the result, and preserve version history. |
| V1.5 Creative / Visual | Image intent reasoning, prompt compilation, scene planning, generate→critic→repair, preserve/change controls and a zero-cost runtime. |
| V2 Agent Foundation | Unify Supervisor, Planner, Memory, Browser, Computer Use, Terminal, Git, Sandbox, Test Runner, Self Repair, Subagents, Approval, Deployment and Artifact Generation into one production execution system. |
| V3 Connected Agent OS | Add safe connections to GitHub, Google/Microsoft ecosystems, Notion, Slack/Discord, browsers, files and other approved services under least privilege and USD 0 constraints. |
| V4 Autonomous | Long-running task supervision, schedules, memory, multi-agent execution, self-evaluation, recovery and regression monitoring, while retaining approval gates for sensitive actions. |
| Self-evolution | Bounded improvement scouting and improvement inbox so ORIGIN can propose its own upgrades without silently deploying them. |

## 3. Previously verified production capability families

Earlier production records cover the following capability families. These records are scoped to their tested release and task; status readiness does not prove every user workflow. Main and deployed production must be checked separately:

1. **Grounded Research (V1.1)** — public-web research service with a free-only contract and source-bounded retrieval.
2. **Real File Artifacts (V1.2)** — generate Markdown, CSV, PDF, DOCX, XLSX and PPTX artifacts.
3. **Web / Application Builder (V1.3)** — generate verified static web bundles for landing pages, dashboards and web apps; automatic external publishing remains intentionally disabled.
4. **Agentic Coding OS (V1.4)** — durable coding jobs, repository edits, checks, repair rounds, owner-bound authorization and verified coding results.
5. **Core ORIGIN app** — conversational UI, history/PWA/recovery paths, free-only routing and failure UX.

The fresh production health read returned release `2f1d7069006c21050611e9703fb6506697b1bac1`; main is `01f7db0c0d48ab3ba533148e99e1847203e13f4c`. This reconciliation did not rerun authenticated coding jobs or all capability status endpoints.

## 4. Implemented but not yet live

### MCP client / connected tools — foundation #602 merged; bootstrap #603/#604 open

The merged foundation implements the foundation required for ORIGIN to call external tools without turning the public chat endpoint into an unrestricted tool runner:

- owner-only session boundary;
- Supabase-backed authentication adapter;
- OAuth + PKCE lifecycle;
- encrypted credential/token storage;
- durable exact-tool grants;
- SSRF/DNS-rebinding guarded Node transport;
- provider discovery verification;
- zero-cost evidence checks;
- separate owner-authenticated `/api/mcp/chat` route;
- one bounded tool round;
- no destructive-call retry;
- first reviewed automatic execution profile limited to GitHub Remote MCP read-only `get_file_contents`;
- four server-side MCP database tables/migrations live with browser-role access revoked.

This is **not yet a production-complete connected-app feature**.

## 5. Not complete yet

- A real Supabase Auth Owner account/session for the intended Owner.
- A real GitHub App registration and installation/authorization.
- Live GitHub OAuth callback/refresh/revocation.
- Live MCP tool discovery and exact grant persistence.
- Live `/api/mcp/chat` execution against a real owner-authorized GitHub repository.
- Live production activation of the merged MCP foundation and reviewed bootstrap candidate.
- ORIGIN MCP server.
- Existing-file deterministic DOCX/PPTX/XLSX/PDF editing.
- V1.5 image generation runtime.
- Full V2 unified agent runtime.
- Full V3 connected-app coverage.
- V4 autonomous supervision.

## 6. Current release boundary

M1 foundation was merged through PR #602 after candidate CI verification. This does not mean a live connector has been activated. Historical #585 is not the active branch to restart.

M2 bootstrap candidates #603/#604 are open and remain separate from UI repair #605. Runtime activation still requires owner/provider consent where necessary, live connector evidence, current zero-cost eligibility and the production release gate. No permission expansion or paid upgrade is implied.

UI repair #605 is CI-verified and preview-deployed, but not production-deployed. Direct preview inspection is login-protected in the available browser. Do not mark UI work complete merely because the automated gates passed.

## 7. Next boundaries after M1

### M2 — Approval-only identity + GitHub bootstrap
ORIGIN/AI prepares the identity/bootstrap configuration, least-privilege permissions, callback URLs, repository scope, validation and rollback plan. The Owner is not expected to perform setup work. The Owner only approves an identity/authorization/installation consent when a provider requires a real human approval that cannot be delegated safely. ORIGIN must never invent personal credentials or silently broaden installation scope.

### M3 — Live connector E2E
Verify login → OAuth discovery → callback → token refresh → connector probe → exact `get_file_contents` grant → one MCP read → safe response → disconnect/revoke → replay rejection. All must pass at USD 0.

### M4 — Production MCP activation
Only after M3: merge the reviewed candidate, deploy through the approved production path, verify production SHA/health/free-only contract, then repeat the live connector E2E against production.

### M5 — Next capability block
Implement ORIGIN MCP server and deterministic existing-file editing first, then V1.5 creative/visual runtime, followed by V2 unification and the broader V3/V4 roadmap.

## 8. Owner vs ORIGIN responsibilities

**ORIGIN/AI owns the work:** architecture, coding, tests, CI investigation, security hardening, documentation, branches/PRs, evidence collection, regression repair, account/service configuration wherever the available authorized tools permit it, connector setup preparation, deployment preparation, rollback preparation and verification.

**Owner role is approval-only:** approve third-party consent/installation when a provider requires human consent, approve any permission expansion, and approve production-impacting actions at the established release gate. The Owner should not be asked to perform routine setup, copy configuration, debug, edit files, run commands, or create credentials manually when ORIGIN can do the work through authorized tooling.

If a provider requires a non-delegable human action, ORIGIN must reduce it to the smallest possible approval step and resume the rest of the workflow itself.

## 9. Status language

Every future report must use one of these meanings consistently:

- **Implemented** — code exists.
- **CI verified** — exact commit passed the defined automated gates.
- **Preview verified** — exact commit was deployed to preview and checked.
- **Production deployed** — exact commit is actually serving production.
- **Production verified** — live production checks/E2E passed.
- **Owner approval required** — a provider requires a non-delegable human consent/authorization step; all surrounding setup remains ORIGIN's responsibility.

The Owner should be able to ask “今どこ？” and receive the current milestone, exact SHA, verification level, remaining blockers and next action using these definitions.
