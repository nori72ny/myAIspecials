# Google AI Studio Multi-AI Operations and Handoff Contract

Status: **design / implementation checklist; not proof that external AI connectors are already configured**  
Owner: Nori (final approval only)  
Repository: nori72ny/myAIspecials  
Production: https://origin-personal.vercel.app

## Mission

Google AI Studio is the intended executive orchestrator for ORIGIN Personal. Nori should not be asked to perform technical work, relay prompts between AI systems, click through GitHub/Vercel troubleshooting, or manually collect evidence. Nori's human responsibilities are limited to product vision, explicit approval/rejection at defined gates, and real-device acceptance when required.

The orchestrator must delegate implementation, testing, security review, answer-quality evaluation, and independent release audit to appropriate external AI systems/services when available. If a required integration is unavailable, report it as a blocker and continue with work that can be completed safely; never claim that a delegation or audit occurred unless there is a traceable result.

## Non-negotiable policy

1. **Evidence, not assertions.** Distinguish confirmed, unverified, blocked, and completed. CI green is not model-quality evidence.
2. **Zero-cost fail-closed.** Normal intended use must be $0. No paid fallback, BYOK path, silent model substitution, or ambiguous price metadata. A missing proof means stop.
3. **ZDR/privacy fail-closed.** Verify actual provider policy/configuration and data path. A locally hardcoded zero-cost or ZDR value is not proof.
4. **Independent audit before public release.** A different AI/reviewer must inspect the actual candidate commit, tests, security/privacy/cost controls, AQ-40 results, deployment plan, and rollback. Preserve the audit report and exact commit SHA. Any unresolved critical/high finding blocks release.
5. **No release from unreviewed drafts.** Keep risky work in branches/draft PRs until evidence and independent review are complete.
6. **No secrets in code, prompts, issues, artifacts, or logs.** Use scoped credentials, secret stores/environment injection, minimum permissions, and rotation.
7. **No unapproved destructive actions.** Production deployment, merge, data deletion, permission escalation, or any action that can incur cost must be gated by an explicit approval policy. The owner should see a concise approval decision, not a technical to-do list.

## Target collaboration architecture

Use a central, auditable work queue and structured handoffs instead of owner-mediated AI-to-AI messaging.

- **Executive orchestrator:** Google AI Studio agent/session. Owns task plan, assigns work, reconciles conflicting reviews, and maintains the release gate.
- **System of record:** GitHub repository, issues/PRs, review comments, commits, Actions logs/artifacts. Each task must identify the exact base/head SHA.
- **Implementation worker:** a coding-capable agent (for example, Gemini/Claude Code/Codex where available) works on a dedicated branch and submits a PR. It must not deploy or merge its own unreviewed work.
- **Test/evaluation worker:** runs deterministic unit/integration/security tests and the real AQ-40 benchmark on a pinned dataset/model/configuration. Stores machine-readable results and human-readable summary as artifacts.
- **Independent auditor:** a separate AI/provider or reviewer that did not author the change. It reads the actual diff and evidence, checks the stated acceptance criteria, and posts findings against the exact SHA. An automated scanner alone is not the independent AI audit.
- **Release operator:** a controlled workflow validates all gates and deploys only the approved SHA. Deployment verification checks the live domain and health routes, then records deployment ID, SHA, timestamp, smoke results, and rollback reference.

### Preferred integration transport

Prefer a **remote MCP server using HTTPS and Streamable HTTP** when a supported AI host can connect to it. Expose narrowly scoped tools such as:
- github_get_task, github_read_file, github_get_pr_diff
- github_create_branch, github_commit_changes, github_open_draft_pr
- github_post_review_findings, github_get_checks_and_artifacts
- run_read_only_tests, get_aq40_report, get_deployment_status
- request_release_approval (must pause; never self-approve)

Use a queue/issue/PR as durable task state. Every tool call must be authenticated, least-privileged, idempotent where possible, logged without secrets, and scoped to an allowlist of repositories/actions. The MCP server must not expose arbitrary shell, unrestricted network, secret retrieval, or direct production deployment to untrusted candidate code.

Google's Gemini Interactions API documents remote MCP tools (type: mcp_server) over Streamable HTTP; server names should use underscores, not hyphens. Do not assume every Google AI Studio UI/session has identical MCP support. Validate the actual target AI Studio workflow and capabilities before depending on them.

## Required integration phases

### Phase A — inventory (read-only)

1. Confirm which Google AI Studio feature is being used (Playground managed agent, app/API integration, or another environment).
2. Inventory existing connected services and scopes: GitHub, Vercel, model providers, test/evaluation runner, and external review AI.
3. Record each integration's owner, authentication method, minimum scopes, billing exposure, data-retention policy, endpoint/transport, health check, and revocation method.
4. Never ask Nori to copy secrets into chat. If a platform-only setup action is unavoidable, explain exactly why it is a one-time approval/setup blocker and do not claim it is configured.

### Phase B — safe read-only pilot

1. Connect GitHub read-only first and prove the agent can retrieve repo metadata, PR diff, check runs, and artifacts.
2. Connect a separate reviewer endpoint/provider and submit a synthetic, non-sensitive test diff. Verify the result is persisted and can be traced to the reviewer and exact SHA.
3. Confirm timeouts, retries, rate limits, audit logs, secret redaction, and fail-closed behavior.
4. Do not connect production secrets or allow write actions until the read-only pilot passes.

### Phase C — controlled write access

1. Grant branch/PR write access only; do not grant direct main-branch writes.
2. The implementation worker can create commits and draft PRs. It cannot approve its own PR, merge it, or deploy.
3. The test worker runs only pinned, reviewed workflows; untrusted pull-request code must never inherit live provider credentials.
4. The independent auditor must be separate from the implementation worker and must inspect the final candidate SHA, not a stale diff.
5. Quota reservations and provider-request guards must cover retries, reruns, pagination limits, and concurrent runs. Incomplete history or unknown quota state must block live provider calls.

### Phase D — release gate

The release controller must require all of the following for the exact candidate SHA:
- Required CI checks actually ran and passed; no placeholder or skipped test substitutes.
- Real AQ-40 benchmark completed with 40 scored cases, a versioned dataset/rubric, reproducible settings, per-case outputs, aggregate score, and explicit acceptance threshold.
- Zero-cost proof from the actual request/provider path, not hardcoded response fields.
- ZDR/privacy proof from provider configuration/terms and the actual data path.
- Security/privacy review and artifact/UI accessibility tests complete.
- Independent AI audit report contains no unresolved critical/high findings.
- Explicit owner approval recorded for public promotion.
- Deployment health/smoke checks and rollback reference are prepared.

If any gate is missing, the status must be **BLOCKED**, not PASS. An AQ-40 skip, quota skip, unavailable reviewer, missing cost evidence, missing ZDR evidence, or unavailable check-run data cannot be interpreted as success.

## Required task handoff format

Every delegated task must include:

- Task ID and objective
- Repository, branch, base SHA, candidate SHA
- Allowed paths/actions and prohibited actions
- Acceptance criteria and exact test commands
- Required evidence/artifact paths
- Cost/privacy constraints
- Reviewer identity/role and independence requirement
- Status: NOT_STARTED, IN_PROGRESS, BLOCKED, FAILED, or PASS
- Findings, unresolved risks, and next autonomous action

Every completed task must return a concise evidence packet, not just “done”.

## Current known blockers at the time this document was drafted

These are review observations, not claims that fixes or tests have completed:

- AQ-40 has previously been reported as 0/40 / NOT_MEASURED; a real benchmark result is still required.
- PR #990: quota-guard chain needs independent review; confirm actual GitHub environment protections rather than relying on comments.
- PR #991: strict free-only request policy requires provider-path and negative-test verification.
- PR #992: hardcoded zero-cost/ZDR claims and a skipped AQ-40 placeholder do not prove policy compliance; review the auth adapter and secret handling.
- PR #993: SVG attribute validation, real contrast calculation, and durable artifact persistence require hardening and tests.
- The GitHub connector has been used to record review findings on PRs #990–#993. That does **not** establish that Google AI Studio or any other external AI is already connected.
- No external independent-AI audit result is claimed by this document.

## First autonomous actions for the Google AI Studio orchestrator

1. Read this contract and refresh current main, open PRs, review comments, checks, artifacts, and live deployment facts.
2. Reconcile PR dependencies and do not stack or merge changes based only on stale SHA information.
3. Create/update a connector inventory with confirmed vs unverified status.
4. Establish the read-only external reviewer pilot and preserve its evidence; if no external reviewer endpoint/credential exists, mark the integration BLOCKED and identify the smallest platform-level setup required without asking Nori to relay messages.
5. Address the blockers above in separate, testable PRs.
6. Run actual AQ-40 only after the free-only, quota, privacy, and secret-isolation gates are proven.
7. Obtain independent audit of the final candidate SHA, then request Nori's approval only when the approval packet is complete.

## Official technical references

- Google AI Studio managed agents, environment/network allowlists, credentials and MCP caution: https://ai.google.dev/gemini-api/docs/aistudio-agents
- Gemini API function calling / remote MCP server configuration: https://ai.google.dev/gemini-api/docs/function-calling

This document is an operating contract and implementation checklist. It does not by itself create an MCP endpoint, grant Google AI Studio access, configure external credentials, or prove any external AI connection is live.
