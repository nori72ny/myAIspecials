# Google AI Studio: Free End-to-End ORIGIN Verification Contract

Status: required operating specification; this document does not claim that the integrations or tests are already implemented.

## Owner requirement

Google AI Studio is intended to coordinate ORIGIN checks before release and continuously after release, using other AI systems and external tools where available. The owner should not have to relay instructions between AIs, operate GitHub/Vercel manually, or run technical commands. The orchestrator should produce evidence, findings, remediation PRs, and a clear approve/reject recommendation.

## Absolute cost policy

- The normal ORIGIN workflow must cost the owner $0 / ¥0. Do not create a paid API, subscription, model, sandbox, connector, or usage commitment.
- Never switch to a paid model/provider as a fallback. If a free quota, price guarantee, privacy requirement, or budget evidence is missing, fail closed and report the blocked check.
- A provider's free tier is not a guarantee of permanent free service. Before enabling any integration, verify current plan, quotas, billing settings, rate limits, retention policy, and whether accidental billable usage is possible. If zero-cost cannot be enforced and verified, keep it disabled.
- Do not treat an app's returned `costUsd: 0`, a request header, a model name containing `:free`, CI success, or a mocked response as billing evidence.
- Prefer repository-local deterministic tests, static analysis, Playwright/browser tests, and local evaluation runners that do not call a model. External AI review must use a genuinely available no-cost route or remain marked unavailable; do not silently substitute a paid route.
- No secrets in URLs, prompts, logs, artifacts, PR comments, or AI handoff documents. Never expose provider keys to candidate-controlled code or untrusted evaluator scripts.

## Required architecture

Separate these roles and credentials:

1. **Orchestrator (Google AI Studio)**: plan and dispatch bounded tasks, track evidence, compare reviewers, and recommend release decisions. It must not be assumed to have repository or deployment access until a read-only pilot proves that access.
2. **Implementation agent**: edits a non-production branch and opens a PR; no direct writes to main and no production credentials.
3. **Trusted test runner**: checks out an immutable commit, runs deterministic unit/integration/security/browser tests, and writes a machine-readable result artifact. Candidate-controlled code must not receive provider credentials.
4. **Independent reviewer**: a separate AI/provider or independent human reviewer who did not author the change. It receives only the necessary diff and sanitized evidence, has no write/deploy credentials, and must return a structured review tied to the exact commit SHA. If no free independent reviewer is available, record BLOCKED rather than claiming a pass.
5. **Release controller**: validates all hard gates, exact commit SHA, deployment target, rollback path, and owner authorization policy. It must not equate CI success with functional correctness.
6. **Post-release monitor**: read-only synthetic checks and error/latency monitoring. Alerts and automatic rollback may be enabled only after tested, bounded rules and a safe rollback target exist.

## Before-release gates (all required)

- [ ] Candidate commit SHA is immutable and all CI checks ran against that exact SHA.
- [ ] Unit, integration, typecheck, lint, dependency/security, secret scan, browser/E2E, accessibility, and production-build checks pass.
- [ ] Real user flows are exercised in a non-production preview: sign-in/session, chat, empty/error/loading states, artifact creation and persistence, coding flow, image generation flow, agent/tool handoff, mobile viewport/keyboard, desktop layout, and graceful no-quota/provider-unavailable behavior. Mark features not implemented as NOT IMPLEMENTED, never as passed.
- [ ] AQ-40 runs 40 fixed, versioned cases against the actual intended model route. Save case-level outcomes, rubric/version, commit SHA, model ID, timestamps, error/empty-answer counts, and aggregate score. No skipped placeholders, hand-written pass claims, or mock outputs count.
- [ ] Actual provider routing is verified to reject paid fallback. Capture redacted provider/model identifiers and independently sourced price/quota evidence. A zero price claim must be backed by provider billing/usage evidence where available; otherwise mark cost proof UNVERIFIED and block.
- [ ] ZDR/retention is established from the provider's applicable documented terms and account/request configuration. Request headers or local labels alone do not prove it.
- [ ] Independent audit by a separate reviewer returns PASS for the exact same SHA, with no unresolved critical/high findings. Reviewer identity, method, time, and report are recorded.
- [ ] Threat review covers credential boundaries, prompt injection/tool permissions, SSRF, unsafe code execution, data leakage, quota abuse, reruns/TOCTOU, and rollback.
- [ ] A staged rollout and tested rollback are available; existing production is not overwritten by an unverified candidate.
- [ ] No gate is waived to make a dashboard green. If any gate is unavailable, release status is BLOCKED.

## Post-release checks

Run automatically after each production deployment and on a bounded schedule, using only no-cost/local tests unless an externally billed route has been explicitly prohibited (it is prohibited by default):

- [ ] Verify the deployment's exact source SHA, HTTP health/readiness, critical route response, and browser smoke on mobile and desktop.
- [ ] Run synthetic UI/functional checks with fixtures and provider calls disabled, then a separate real-provider check only if the free-only, credential-isolation, quota-reservation, and ZDR gates are verified.
- [ ] Check empty answers, malformed outputs, error rates, timeouts, latency, accessibility regressions, artifact persistence, auth failures, and paid-fallback rejection.
- [ ] Verify the deployment did not alter cost policy, privacy configuration, secrets, or feature flags.
- [ ] Store redacted machine-readable evidence with timestamps and deployment SHA; alert on regressions.
- [ ] Automatically halt promotion or roll back only under explicit, tested thresholds; never silently retry through a paid provider.
- [ ] Re-run the relevant checks after any code, model, provider, configuration, or policy change.

## Evidence record schema

Every check must report: `check_id`, `status` (PASS/FAIL/BLOCKED/NOT_MEASURED/NOT_IMPLEMENTED), `commit_sha`, `environment`, `started_at`, `finished_at`, `method`, `artifact_uri` (if available), `redactions_applied`, `cost_evidence`, `privacy_evidence`, `reviewer`, and `findings`.

A status of PASS is valid only when an executable check ran and its output is attached. Absence of evidence means NOT_MEASURED, not PASS.

## Current integration proof required

Before calling the system operational, demonstrate all of the following with links/logs and no secrets:

1. Google AI Studio can read the intended repository/PR metadata through a real, least-privilege connection.
2. It can dispatch or track checks against an immutable SHA without being able to write directly to main or deploy production.
3. A separate reviewer can receive a sanitized diff and return a SHA-bound report.
4. A browser runner can test a preview URL and save artifacts.
5. Post-deployment checks can read deployment metadata and runtime/health signals.
6. A budget/permission guard demonstrably prevents paid routes and unauthorized writes.
7. An end-to-end dry run produces a consolidated report, and an intentional failed check blocks promotion.

Until each capability has a reproducible proof, mark it UNVERIFIED. Repository instructions alone do not connect Google AI Studio to GitHub, Vercel, browser automation, or another AI.

## Current known blocker

The current repository review has identified an AQ-40 placeholder and hardcoded zero-cost/ZDR response fields in an open draft PR. Those are not acceptable evidence. Keep the PR unmerged and do not promote to production until the real implementation, exact-SHA tests, independent audit, and free-only/privacy evidence meet the gates above.
