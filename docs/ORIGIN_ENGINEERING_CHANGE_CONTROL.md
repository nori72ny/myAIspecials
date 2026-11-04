# ORIGIN Engineering Change-Control System v1

## Purpose

Prevent recurring rework by making acceptance criteria, evidence, ownership, dependency impact, and release decisions explicit. The system does not promise zero future changes; it prevents reopening accepted work without a recorded trigger and prevents the same defect from being rediscovered late.

## Current diagnosis

The recent ORIGIN history shows recurring rework risk from five systemic causes:

1. **Acceptance criteria were not frozen per deliverable.** A fix could be called complete after code or a local test, while a later audit evaluated a broader contract (for example: a billing field, a real provider response, a mobile viewport, or production behavior).
2. **Evidence levels were conflated.** Static code inspection, unit tests, CI, live provider execution, billing proof, and physical-device validation are different evidence. Passing one was sometimes treated as completion of another.
3. **Cross-PR integration was discovered late.** Multiple open Draft PRs and a stacked PR can each be correct in isolation but still drift in base SHA, shared contracts, or release assumptions.
4. **The change surface was too broad or mixed.** Security, provider routing, UI, and release concerns can overlap; a later correction then invalidates previously checked assumptions.
5. **Independent review was not always performed against one immutable candidate.** Reviews can become stale when the head SHA changes after review, or reviewers use different checklists and interpretations.

These are process defects, not reasons to blame an individual contributor. The remedy is a single evidence-backed change-control process.

## Open-PR backlog control

A paginated GitHub API snapshot on 2026-11-05 returned **247 distinct open PRs** across three pages: **141 Draft**, **106 non-Draft**, **153 based on `main`**, and **94 based on other PR branches**. The oldest returned PR was last updated on 2026-08-29. This is a verified repository-state snapshot, not proof that every PR is redundant or obsolete.

A changed-file and patch comparison confirmed concrete overlap:
- **Provider/security:** PRs #1088, #1089, #1090, and #1091 all touch `src/legacy/originProviderClient.ts`, `src/legacy/originProviderStreamClient.ts`, and `src/legacy/zeroCostRoutingPolicy.ts`. The `zeroCostRoutingPolicy.ts` patch in #1091 is identical to the patch in #1088, while #1091 also spans a much broader set of application, release, workflow, and routing files. This is a duplicate-candidate / integration-risk signal, not proof that the complete PRs are equivalent.
- **Mobile geometry:** PRs #1051, #1066, #1067, #1069, and #1087 all modify `src/origin-top-ui.css`. Their actual patches use different vertical-layout strategies (large viewport-relative top padding, centered flex zones, bottom margin auto, and explicit composer positioning). These are competing implementations of the same layout surface and must not be combined without viewport regression testing.
- **Image generation:** PRs #1052 and #1059 both modify `src/creative/cloudflareRasterImageProviderV15.ts` and `src/creative/rasterImageV15Router.test.ts`; PR #1061 is a broader image-history/provider change that also touches image routing and provider files. These require a single integrated candidate and one shared test baseline.
- **Answer-quality benchmark:** PRs #1073 and #1086 share the same benchmark environment-proof, frozen-execution, HTTP runtime-adapter, session, two-phase session, and official-comparison files. They are direct duplicate-candidate scope overlap and must be diff-reconciled before either is treated as canonical.

This backlog is a demonstrated contributor to repeated work: parallel proposals target the same source files with different implementation approaches, bases, and test assumptions. The corrective action is not mass-closing PRs; it is evidence-based workstream consolidation with one canonical candidate and explicit parking of the others.

Required triage before starting new implementation:
1. Search all open PRs and issues for the same files, behavior, acceptance criteria, and root cause.
2. Classify each candidate as `KEEP`, `SUPERSEDED`, `DUPLICATE-CANDIDATE`, `BLOCKED`, or `NEEDS-REBASE`; do not infer duplicate status from title alone.
3. Select one canonical implementation PR per workstream. Move valid missing commits into that PR only after diff and test equivalence are proven.
4. Record dependencies and merge order. A child PR is not release-ready until its parent is integrated and the child is retested against current `main`.
5. Do not create another PR for a small correction when it belongs to the same active workstream; amend the canonical branch before its review freeze.
6. Do not silently close, merge, or rewrite existing PRs. Require owner approval for destructive or repository-state changes.
7. Publish a short triage ledger with each PR's disposition, canonical successor (if any), exact head SHA, required action, and owner.

Limit the active release train to one canonical PR per workstream. Other PRs remain parked until the canonical candidate is accepted or explicitly rejected. New work starts only after checking this ledger.

## Evidence-based workstream triage — 2026-11-05

This refreshed triage uses exact branch ancestry, changed-file/patch comparison, and exact-HEAD CI results. Candidate means audit priority only; it is not merge, release, or provider-eligibility approval. No PR was closed, rebased, merged, or deployed.

| Workstream | Canonical audit candidate | Related PRs | Evidence-based disposition |
|---|---:|---|---|
| Provider strict-ZDR / no-replay | **#1090** | #1088, #1089, #1091 | #1090 is the narrow 16-commit candidate. GitHub commit comparison proves #1090 contains all 13 commits from #1088 plus the two #1089 follow-ups and one final static-assertion correction; its exact-head required CI passed, including Node 22/24 build, unit, E2E, and Lighthouse jobs. #1088/#1089 are superseded candidates. #1091 contains the complete #1090 history plus 222 additional commits (238 total; 107 files), so it is an integration umbrella, not a safe merge unit. It contains unique important work (correct actualCostUsd=null semantics, served-model/billing checks, stream buffering, legacy direct-provider shutdown, routing and AQ changes); split/reconcile these by workstream rather than merging #1091 wholesale. **Hard blocker:** OpenRouter endpoint/model ZDR eligibility remains UNVERIFIED / previously found incompatible with the strict retention requirement. #1090 proves fail-closed request behavior, not upstream ZDR or production chat availability. |
| Mobile home geometry | **#1087** | #1069, #1067, #1066, #1051 | #1087 is a direct-main, one-file CSS candidate with all required CI green. Exact-head E2E logs record composer bottom alignment at 320×568, 360×640, 390×844, and 412×915; menu bounds also pass at 320×568, 390×844, and 390×560. Node 22/24 E2E and Lighthouse passed. #1069 is a stale/diverged stack against #1067 (4 commits ahead and 16 behind the compared parent head) and has no Actions run for its latest head; do not rebase or merge without approval. #1067/#1066 have failing Production Release CI/CD runs. Physical Android/iOS device and keyboard/address-bar behavior remain UNVERIFIED. |
| Image generation / image history | **No release candidate yet** | #1052, #1059, #1061, #1062, #1054 | #1052's exact-head CI passed, but that does not prove a live eligible provider, strict ZDR, Free-plan account state, or actual $0.00. #1059 and #1061 have failed exact-head Quality Gate / Production Release CI runs. #1061 is a broad integration proposal with shared provider/router scope. Keep image generation disabled and outside Release 1 until a single candidate has passing integrated CI plus independently verified provider, Free-plan, ZDR, and cost evidence. |
| Answer-quality environment proof | **#1086** | #1073, #1091 | #1086 is the current-main v2 candidate; its exact-head CI passed. #1073 is an older-base proposal touching overlapping AQ environment-proof/runtime files. #1091 also contains a broad copy of AQ changes and must not be merged as a substitute. The v2 contract correctly separates a zero policy ceiling from measured request spend; actual provider spend remains NOT_MEASURED. |
| Cloudflare Workers AI Preview | **#1092 parent + #1094 child** | — | #1092's exact-head Quality Gate, CodeQL, OpenSSF, compatibility, and Production Release CI checks passed; #1094's exact-head Cloudflare compatibility check passed. #1094 is explicitly stacked on #1092. Both remain disabled-by-default and outside Release 1 until actual account Free-plan, subscription, model entitlement, ZDR, and billing evidence is obtained. No live inference has been executed. |
| Change-control governance | **#1095** | #1058, #1072, #1080, #1082 | Exact HEAD 2c3b92083e921bfca9142e76002964d36443e02d passed ACOS 2.0 Quality Gate, CodeQL, OpenSSF Scorecard, and Production Release CI/CD. The latter included dependency review, Gitleaks, Chromium/Firefox/WebKit isolation, Node 22/24 build, unit, E2E, browser release gate (where enabled), Lighthouse, and SBOM steps. Deployment verification and changelog/release jobs were skipped by the workflow guard; no deployment occurred. This evidence applies only to the governance branch SHA, not the product's production readiness. |

### Consolidation rules from this triage

1. Use #1090 as the narrow source candidate for strict-ZDR/no-replay behavior; retain #1091 only as a source of separately reviewed changes. Do not merge #1091 as a 107-file umbrella.
2. Use #1087 as the mobile geometry audit candidate. Preserve its exact geometry assertions; require physical-device verification before claiming device-level completion.
3. Do not designate an image-generation PR as canonical while provider and cost eligibility remain unproven.
4. Use #1086 as the current-base AQ environment-proof candidate; keep request-level cost checks separate from policy ceilings.
5. Keep #1092/#1094 preview-only and disabled until account-level proof exists.
6. After a candidate is selected, freeze its exact SHA, run the required CI and independent review on that SHA, then re-run only the impact-selected regressions after any permitted change. No stale check or report transfers to a new SHA.

## Non-negotiable operating rules

- GitHub `main` is the source of truth. A PR branch is a proposal, not a release.
- Every PR has one primary outcome and a narrow change surface. Split unrelated changes.
- No claim of completion without an explicit acceptance contract and evidence record.
- A review, CI result, or test result applies only to the exact commit SHA it evaluated.
- Any commit added after a passing check invalidates that check for the new head until the required checks rerun.
- No merge, deployment, production setting change, live inference, or account/billing change without the required explicit approval.
- Preserve `$0.00`, Free-only, no paid fallback, strict ZDR, and secrets-only-in-environment requirements. Unknown billing/privacy states fail closed.
- Never convert missing evidence into a positive claim. Use `UNVERIFIED` or `NOT_MEASURED`.

## Work-item lifecycle

Every deliverable moves through these states:

1. **DISCOVERED** — problem, user impact, scope, and evidence source recorded.
2. **SPECIFIED** — acceptance criteria, non-goals, dependencies, rollback, and test plan written before implementation.
3. **IMPLEMENTED** — code/docs changed in one focused PR.
4. **SELF-VERIFIED** — targeted tests and static checks pass; evidence attached to the exact SHA.
5. **INDEPENDENTLY REVIEWED** — a reviewer who did not author the change checks the same SHA against the same contract.
6. **INTEGRATION-VERIFIED** — full required CI and dependent PR/base compatibility pass on the exact candidate SHA.
7. **ACCEPTED / FROZEN** — acceptance record created; no further edits unless a reopening trigger is met.
8. **RELEASE-ELIGIBLE** — all release gates, including runtime, security, cost/privacy and relevant device checks, are satisfied.
9. **RELEASED** — explicit approval and deployment evidence recorded.

A state is never inferred from elapsed time, a green partial job, or a verbal summary.

## Definition of Done

A work item is complete only when all applicable conditions are true:

- Acceptance criteria are binary and testable.
- Non-goals and protected invariants are listed.
- Required tests are mapped to each criterion.
- Exact commit SHA, CI run IDs, test results, reviewer, and unresolved risks are recorded.
- No critical/high-severity issue remains open.
- Relevant integration and regression checks pass.
- The evidence type is named: `CODE-PROVEN`, `TEST-COVERED`, `CI-PASSED`, `EXECUTED`, or `UNVERIFIED`.
- Runtime, external service, actual billing, privacy retention, and physical-device claims require corresponding runtime/account/device evidence; code inspection cannot substitute.

## Frozen-baseline / reopening policy

Once accepted, a work item is frozen. It is reopened only for one of these recorded triggers:

- A reproducible defect or security/privacy vulnerability.
- A changed requirement explicitly approved by the product owner.
- A dependency, API, runtime, browser, OS, model, or provider change that invalidates its evidence.
- A regression detected by an automated or independent test.
- New authoritative evidence contradicting the acceptance record.

A reopening record must state: trigger, reproduction/evidence, affected acceptance criteria, impact radius, owner, required regression suite, and whether rollback is safer than a patch.

Do not reopen accepted work for cosmetic preference changes unless the product owner explicitly reprioritizes them. Do not redo unaffected tests: run the impact-selected regression set, then the full release suite when the release candidate changes.

## Change-impact control

Before editing a shared component, identify its dependents. Maintain an impact map in the PR description:

- **S0 — isolated:** documentation or isolated component; targeted tests.
- **S1 — local contract:** one module/API; module tests plus direct consumers.
- **S2 — cross-system:** auth, provider, routing, persistence, cost, privacy, shared UI shell; all dependent tests and integration CI.
- **S3 — release boundary:** billing, ZDR, secrets, deployment, data migration, production routing; independent security review and explicit owner approval; no live operation without approval.

If the impact radius is unknown, classify as S3 until proven otherwise.

## PR and branch policy

- Prefer PRs based directly on current `main`. Stack PRs only when technically necessary.
- For a stack, declare the parent PR, exact parent SHA, merge order, and rebase plan. Do not treat child CI as final until the parent is merged and the child is retested against the resulting main.
- Never combine unrelated fixes merely to reduce PR count.
- Before review, freeze the candidate SHA. Any subsequent commit restarts review for affected criteria and all required checks.
- A Draft PR is not accepted. A green subset of workflows is not an overall pass.
- Do not merge a child PR before its parent. Do not merge a broad PR simply because its head is green.

## Independent review and external agents

Use distinct review roles for material changes:

- **Implementation reviewer:** correctness, maintainability, tests, scope.
- **Security/privacy reviewer:** threat model, ZDR, secrets, data flow, fail-closed behavior.
- **Release reviewer:** integration, rollback, runtime, UX/device, cost evidence.

One reviewer may cover multiple roles only when the change is low risk; S2/S3 requires independent review. Reviewers must receive the same frozen SHA, acceptance criteria, changed-file list, test evidence, and explicit questions. Require findings with severity, file/line, reproducible evidence, and a recommended test. A reviewer must return `PASS`, `CONDITIONAL`, `FAIL`, or `UNVERIFIED`; vague approval is not accepted.

External AI review must be advisory and isolated:
- Send only the minimum source/diff and synthetic data required; never send secrets, customer data, production tokens, or private account evidence.
- Do not let an external agent merge, deploy, change settings, or execute paid/live calls.
- Require model/provider, review timestamp, exact SHA, prompt/checklist version, findings, and confidence in the returned report.
- Two agents reviewing the same diff are not independent if they share the same model/provider or merely copy each other's conclusions.
- Automated dispatch is disabled until a supported connector, data handling/ZDR terms, $0 cost proof, access scope, and owner approval are verified. Until then, generate a reusable review packet for manual handoff. Never claim an external AI was contacted unless an actual integration confirms it.

## Evidence freshness

- Code review and CI are SHA-bound; any new commit makes the prior result stale for the new head.
- Account/plan/billing evidence is valid only for the account and timestamp observed; re-check before enabling a provider and after plan changes.
- Browser/device evidence is valid only for the tested build, viewport, OS/browser, and device configuration.
- Provider privacy/retention evidence is valid only for the exact provider, model, route, and applicable terms.
- Actual cost evidence is separate from a zero-priced model label or provider-reported usage. If final billed amount is not observed, retain `actualCostUsd: null` and `NOT_MEASURED`.

## Release gate

Release candidate acceptance requires:
- At least 90% of the defined release checklist passing.
- Zero unresolved critical or high-severity security/privacy/cost blockers.
- 100% pass for hard invariants: no paid path, no secret exposure, no unapproved production mutation, strict required privacy controls, and correct fail-closed behavior.
- Exact candidate SHA with all required CI green.
- Independent security and release review.
- Relevant live/runtime and real-device checks completed where the product claim requires them.
- Explicit product-owner release approval.

A weighted 90% score cannot override a failed hard invariant.

## Required status language

Use these labels consistently:

- `CODE-PROVEN`: established by source inspection only.
- `TEST-COVERED`: a test exists and passed in a named run.
- `CI-PASSED`: all required CI checks passed for the exact SHA.
- `EXECUTED`: the behavior was run in the stated environment.
- `UNVERIFIED`: required evidence is missing or stale.
- `NOT_MEASURED`: no authoritative measurement exists (especially actual cost).

Never say “done”, “fixed”, “safe”, “free”, “ZDR”, or “production-ready” without naming the evidence supporting that claim.

## Current open work — no implied acceptance

As of the creation of this document, PRs #1091, #1092, and #1094 are open Draft proposals. PR #1094 is stacked on #1092. They are not merged and are not accepted release components. Their current evidence must be re-evaluated against each exact head SHA. This document does not approve merging, deployment, live inference, or account changes.

## Required records for every material PR

Use `.github/PULL_REQUEST_TEMPLATE.md`. For S2/S3 work, also attach an external review packet with exact SHA and a completed findings table. Record the final acceptance in the PR description before merge.
