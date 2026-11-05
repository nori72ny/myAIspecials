# ORIGIN Review Orchestrator — Architecture and Safe Rollout

## Objective

Coordinate independent review around one immutable PR candidate SHA, reduce repeated manual briefing, and prevent stale or conflicting reviews. The orchestrator is advisory: deterministic CI and the product owner's release decision remain authoritative.

## Current capability boundary

The repository has GitHub Actions and the ChatGPT GitHub integration. No supported direct dispatch connector to Claude, Manus, or Google AI Studio was verified in this work. ChatGPT's available plugin search did not surface a usable connector for those reviewer services. Therefore no claim is made that any external AI has been contacted, and no external API credentials are assumed.

The current safe mechanism is:
1. Use `docs/ORIGIN_EXTERNAL_REVIEW_PACKET.md`.
2. Freeze the candidate SHA.
3. Share the same sanitized packet and relevant diff with each reviewer through its approved UI.
4. Record each response and its exact reviewed SHA in the PR.
5. Reject stale reports if the PR head changes.

## Target architecture

```text
GitHub PR event
   |
   v
Candidate freezer ----> SHA + base SHA + changed files + risk class
   |
   v
Evidence collector ---> required CI / tests / code owners / dependency map
   |
   v
Data minimizer -------> secret scan + PII scan + allowlisted file selection
   |
   v
Policy gate ----------> cost=$0 proven AND ZDR/retention approved AND access read-only
   |                                  |
   | PASS                             | FAIL / UNKNOWN
   v                                  v
Reviewer adapters                  Manual review packet only
(Claude / Manus / Google)          status=EXTERNAL_REVIEW_UNAVAILABLE
   |
   v
Finding normalizer ---> severity, file/line, evidence, reproduction, fix, test
   |
   v
Independent adjudication
   |
   v
Evidence ledger ------> PASS / CONDITIONAL / FAIL / UNVERIFIED
   |
   v
Human release approval (never automated)
```

## Adapter contract

Every future reviewer adapter must implement these operations without repository write permissions:

- `capabilities()`: provider/model identity, supported inputs, retention/ZDR terms, region, and cost basis.
- `preflight(candidate)`: verify exact SHA, data classification, cost cap, and privacy policy before submission.
- `submit(packet)`: one idempotent request; no automatic retry on ambiguous outcome.
- `collect(jobId)`: retrieve the response and provider request ID.
- `normalize(response)`: convert findings into the shared schema without upgrading a provider opinion into a verified fact.

Adapter output is untrusted input. It may suggest changes but cannot edit files, create commits, merge, deploy, alter settings, or invoke production services.

## Hard admission policy

An adapter is disabled unless all are proven:

1. API access is supported and authorized by the account owner.
2. Per-request cost is contractually and technically `$0.00`; unknown cost is a rejection.
3. ZDR, retention, training-use, region, and data-processing terms meet the project's policy for the exact endpoint/model.
4. Only minimum necessary, non-secret source/diff is transmitted.
5. Credentials are scoped, server-side, rotatable, and absent from logs/artifacts.
6. A kill switch and request budget are enforced.
7. The adapter cannot write to GitHub or production.

No paid fallback, no usage-based retry, no credit-funded trial, and no fail-open behavior. If a provider changes terms, model, endpoint, price, or retention, its adapter returns to disabled pending requalification.

## Review independence

- Use different organizations/providers for independent opinions where possible.
- Do not count two runs from the same model/provider as independent.
- Do not let reviewers see each other's verdict until their initial reports are submitted.
- Require each reviewer to identify the exact SHA and cite source lines.
- A reviewer that cannot reproduce or substantiate a finding must label it as an unverified concern.
- Conflicting results go to a human adjudication record; majority vote never overrides a hard security or cost blocker.

## Stale-review invalidation

Every result is keyed by:
`repository + PR + head SHA + base SHA + checklist version + reviewer identity`.

If any key changes, the report becomes stale for release acceptance. A changed file invalidates only the impacted review domains for triage, but the final candidate still needs required checks on its exact SHA. Changes to security boundaries, cost, provider, authentication, persistence, or release configuration require full re-review of those domains.

## Rollout sequence

### Phase 0 — Available now
- PR template and shared review packet.
- Manual dispatch to external reviewers.
- Exact-SHA review records.
- No credentials or new paid services.

### Phase 1 — Deterministic GitHub automation
- Generate a review manifest from PR metadata, changed files, diff stats, and existing CI.
- Classify S0–S3 impact using a maintained path-to-domain map.
- Produce a sanitized packet artifact; never include environment files, secrets, user data, or unrestricted repository archives.
- Detect head SHA changes and mark earlier review manifests stale.
- Do not call external AI services.

### Phase 2 — Provider adapters (only after admission)
- Add one adapter at a time behind an explicit feature flag.
- Run contract tests with synthetic data and a mocked provider first.
- Verify cost and privacy terms independently before any live submission.
- Start with a read-only, low-risk review scope.
- Keep automatic dispatch disabled by default until owner approval.

### Phase 3 — Controlled orchestration
- Parallelize only independent review roles.
- Normalize and deduplicate findings.
- Route blocking findings to a human owner.
- Require human approval for any code change, merge, deployment, or production operation.

## Operational SLOs

- 100% of accepted reviews record the exact head SHA and checklist version.
- 0 external submissions when cost or privacy status is unknown.
- 0 external reviewer write permissions.
- 0 merges/deployments initiated by the orchestrator.
- 100% of head-SHA changes invalidate stale review evidence.
- Every reopened accepted item includes a trigger and regression plan.

## Decision

Do not integrate Claude, Manus, Google AI Studio, or another external reviewer through API yet. The direct connectors, exact $0 terms, and strict ZDR conditions have not been established. The manual review packet is the correct current implementation; deterministic GitHub packet generation is the next safe automation step.
