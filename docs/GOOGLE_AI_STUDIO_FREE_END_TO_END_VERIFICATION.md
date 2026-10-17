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
- [ ] **Legacy AQ-40 compatibility run:** run its 40 fixed, versioned cases against the actual intended model route when reporting the owner's AQ-40 milestone. Save all case-level outcomes, rubric/version, commit SHA, model ID, timestamps, error/empty-answer counts, and aggregate score. No skipped placeholders, hand-written pass claims, or mock outputs count.
- [ ] **Canonical AQ V2 / world-class answer gate:** separately satisfy the current `OriginTrustedAnswerRunV2` contract. It requires `ORIGIN_AQ_V2_FAMILIES.length * 3` trusted cases (currently 48 if the 16-family registry remains unchanged), with exact-SHA/corpus/round bindings, trusted-runner evidence, blind-preference and answer-quality evidence. Do not describe a 40-case legacy AQ-40 pass as satisfying the stricter V2 comparative gate, or vice versa. Reconfirm the family count and evaluator contract on the candidate SHA before a run.
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


## World-leading competitive quality gate (mandatory before release)

The owner's requirement is stricter than ordinary CI: for every implemented ORIGIN capability, measure it against strong current alternatives and improve every evidenced weakness before promotion. This is a requirement, not a claim that ORIGIN is currently world-leading.

### Scoring integrity

- Use a versioned, capability-specific rubric with observable criteria, fixed weights, critical-failure rules, and a documented measurement method. Freeze the rubric and test set before evaluating the candidate.
- Compare against relevant leading products/models available at evaluation time, selected and documented by capability (answer quality, coding, image generation, agent/tool execution, mobile UX, privacy/security). Do not use one generic score for unrelated capabilities.
- Use the same prompts/tasks, allowed tools, time/budget limits, and scoring rubric where a fair comparison is possible. Blind/randomize candidate identities for human review. Record any unavoidable differences.
- For factual/answer tasks, use a versioned benchmark with gold answers, source/citation checks, freshness requirements where relevant, contradiction checks, and separate safety/privacy scoring. AQ-40 is a minimum regression set, not by itself proof of world leadership.
- For coding, use reproducible hidden tests, task completion, correctness, security, regression rate, and human-reviewed maintainability; passing compilation alone is not quality proof.
- For image generation, evaluate prompt adherence, legibility/text rendering where applicable, artifact quality, editability/workflow completion, and failure rate using a predeclared blinded rubric.
- For agents, verify end-to-end task completion, tool-call correctness, recovery from failures, permission boundaries, prompt-injection resistance, and truthful reporting against recorded traces.
- For UX/accessibility, combine automated checks with defined manual mobile/desktop and assistive-technology checks. Automated axe/Lighthouse results do not prove real screen-reader behavior.
- Run repeated trials where output variance matters; report sample size, confidence intervals or variability, failure cases, and evaluator agreement. Do not cherry-pick best outputs.
- Require at least two independent assessments for the release candidate: one trusted deterministic test runner and one genuinely separate reviewer who did not author the change. A reviewer that only reads documentation, shares the implementer's context, or lacks access to the exact candidate is not independent runtime proof.
- External AI reviews must use a verified no-cost route and be bound to the exact candidate SHA. If free quota is exhausted or the service cannot be verified free, mark BLOCKED; never switch to paid use.

### 100/100 rule

A capability can be marked 100/100 only when all predeclared rubric points are evidenced, every critical gate passes, there are no unresolved critical/high findings, the exact candidate SHA is tested, and the independent reviewer signs off on that SHA. A numeric 100 cannot override a failed critical gate.

- Any missing run, unavailable comparator, absent evidence, skipped test, or unverified claim is NOT_MEASURED/BLOCKED, not zero-risk and not a pass.
- If a credible leading alternative scores higher, ORIGIN must be improved and re-evaluated. If parity/superiority cannot be demonstrated with a fair reproducible comparison, report the gap honestly; do not claim "world's best".
- The aggregate release score is the minimum of capability critical-gate status and the documented weighted score; no averaging away a critical failure.
- Re-run affected benchmarks after every material code, model, prompt, provider, tool, configuration, or policy change.
- Keep before/after results and regression evidence as versioned artifacts linked to the SHA. Promotion is blocked until every required capability is 100/100 under this rubric or explicitly marked not in release scope with the owner's prior written approval. No scope exclusion may disguise a broken or advertised feature.

### Mandatory report fields

For each capability, publish a table/artifact with: candidate SHA; comparator names and model/product versions; date; task-set/rubric version and hash; sample size; per-case scores; aggregate and uncertainty; critical failures; safety/privacy/security results; cost evidence; independent reviewer and exact-SHA verdict; remediation commits; rerun results; and final PASS/FAIL/BLOCKED status.

### Current baseline status

The repository's existing `QA_REPORT.md` explicitly records answer-quality superiority as UNVERIFIED and lists competitive blind comparison, versioned answer benchmark, production behavior, physical-device checks, assistive-technology checks, and latest-SHA independent audit as unproven. The existing AI Studio evaluator audit also says it must not be used as final proof of factual correctness, independent review, or production readiness. Therefore this requirement is currently NOT SATISFIED. This document does not convert those gaps into implementation or evidence; the release gate must remain blocked until executable tests and evidence artifacts exist.
