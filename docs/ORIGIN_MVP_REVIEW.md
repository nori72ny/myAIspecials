# ORIGIN MVP Review

Status: Active owner-review document  
Scope: Personal-use v0.1 assessment  
Decision rule: Do not expand the specification set or merge/deploy product changes until the owner has reviewed the current usable experience.

## 1. Why This Review Exists

ORIGIN already contains substantial product and orchestration work. The immediate problem is not a lack of ideas or specifications. The problem is that completed, draft, preview-only, and future work are mixed together, making it difficult for the product owner to know:

- what can be used now;
- what exists only in a Draft PR;
- what changes the visible design;
- what has been independently reviewed;
- what is unnecessary for personal use;
- what should be tested before more development begins.

This document changes the working sequence to:

1. inventory;
2. owner-visible preview;
3. personal-use validation;
4. narrowly scoped fixes;
5. explicit merge decision;
6. only then, the next product increment.

## 2. Current Product Inventory

### 2.1 Available on `main`

The current default experience already includes a Personal Edition with:

- a dashboard;
- unified chat;
- workspace/project navigation;
- memory navigation;
- new-chat entry;
- user settings;
- light and dark presentation support;
- responsive sidebar behavior.

The application also mounts the Multi-AI delegation planner globally. The merged orchestration increments provide:

- deterministic task classification;
- free-only provider eligibility rules;
- provider selection and fallback ranking;
- a separate verifier selection where applicable;
- human-readable selection reasons;
- copyable delegation instructions;
- human approval requirements for sensitive or consequential work;
- browser-local delegation history;
- result, verification, and elapsed-time recording;
- quota, reliability, and expected-latency-aware fallback behavior.

Important limitation: the merged delegation planner primarily plans, explains, records, and prepares instructions. It must not be represented as complete automatic multi-provider execution.

### 2.2 Implemented but not merged

#### PR #38 — Privacy and browser resilience

Adds or strengthens:

- sensitive-input detection and strict redaction;
- audit-storage failure handling;
- clipboard success/failure behavior;
- keyboard and dialog-focus behavior;
- accessibility regression coverage;
- independent review remediation.

Assessment: strong candidate for the personal-use safety baseline, but still requires an explicit owner merge decision.

#### PR #40 — Localized V2 delegation experience

Adds a parallel preview-only V2 experience with:

- Japanese-first provider-neutral presentation;
- user-facing task and provider labels without raw internal identifiers;
- clearer selection and verification explanations;
- responsive layouts across mobile, tablet, desktop, zoom-equivalent, and reduced-motion conditions;
- extended accessibility checks;
- external-review remediation.

Assessment: this PR contains the main visible design and information-architecture changes. It has not replaced the normal user-facing panel by default. The owner must compare the current panel and V2 before adoption.

#### PR #41 — Deterministic answer-quality evaluation

Adds:

- versioned synthetic evaluation fixtures;
- deterministic scoring for instruction adherence, relevance, clarity, safety/privacy, Japanese quality, and structured output;
- suite execution and sanitized failure reporting;
- a preview UI for answer-quality evaluation.

Assessment: useful for regression control, but not required to begin personal use. It should not block v0.1 unless the owner decides that visible answer scoring is part of the first daily-use experience.

### 2.3 Documentation-only work

PR #42 changes product and architecture documentation only. It does not change runtime behavior, application layout, component styling, routing, provider execution, billing, deployment, or production configuration.

The documentation is retained as a long-term reference, but specification expansion is paused while the personal-use product is reviewed.

## 3. Personal-Use v0.1 Definition

### 3.1 Primary user outcome

The owner can open ORIGIN and complete a useful daily session without understanding provider internals.

A successful v0.1 session is:

1. open Personal Edition;
2. begin a new chat or select a working context;
3. describe the desired outcome;
4. use the delegation planner when specialist allocation or independent verification is useful;
5. receive or prepare a clear result/instruction;
6. review the reason, safety constraints, and verification plan;
7. record the outcome locally;
8. resume later from personal history or workspace context.

### 3.2 Required for v0.1

- Personal Edition remains the default entry.
- Dashboard, chat, workspace, memory, and settings remain reachable.
- Free-only behavior remains mandatory.
- Paid fallback remains prohibited.
- Sensitive input is blocked or redacted before it can be copied or stored.
- Delegation decisions use understandable Japanese labels.
- Internal provider IDs are not exposed in normal user-facing output.
- The selected assignee, reason, verification method, approval requirement, and failure state are understandable.
- Mobile and desktop completion flows are usable.
- Local history does not falsely claim persistence when browser storage fails.
- No merge, deployment, credential request, DNS change, or paid-service activation occurs without explicit owner approval.

### 3.3 Recommended v0.1 composition

Recommended sequence, subject to owner review:

1. keep the current `main` product as the comparison baseline;
2. review and, if accepted, integrate PR #38 as the safety baseline;
3. compare the current delegation panel with PR #40 V2;
4. adopt V2 only after the owner confirms the design and flow;
5. defer PR #41's visible evaluation panel, while retaining the evaluator as a later quality gate if useful.

This is a recommendation, not merge authorization.

## 4. Deferred From v0.1

The following work is not required for the first personal-use release:

- enterprise organization management;
- multi-tenant isolation and administration;
- marketplace expansion;
- public workflow sharing;
- provider lifecycle automation;
- automatic discovery and promotion of new models;
- broad live-provider integration;
- automatic paid execution or paid fallback;
- billing and commercial packaging;
- unrestricted autonomous actions;
- large-scale benchmark operations;
- complex economy/recommended/premium purchasing flows;
- production-grade regional governance beyond the needs of the personal preview.

These items may remain documented, but they must not distract from owner validation of the daily-use core.

## 5. Design and Structure Review Required

The owner has not yet approved the current design direction. Therefore no claim should be made that V2 is the final design.

The next visual review must compare:

- current `main` Personal Edition;
- current `main` delegation panel;
- PR #40 V2 delegation panel;
- desktop flow;
- narrow mobile flow;
- light and dark modes;
- empty, success, sensitive-input, storage-failure, and verification-recording states.

For every visible change, the review must state:

- what changed;
- why it changed;
- whether it is required for personal use;
- whether it simplifies or complicates the flow;
- whether the owner accepts, rejects, or requests revision.

## 6. Existing Review Evidence and Gaps

Existing PR records include automated CI, responsive Playwright evidence, accessibility checks, and external AI review activity. However, review status must be interpreted carefully:

- a prepared review prompt is not a completed review;
- an AI that could not access the repository or preview does not provide product approval;
- code-level findings do not replace owner usability review;
- automated accessibility checks do not replace real assistive-technology testing;
- a review of one PR does not automatically approve the stacked combined result.

Remaining key gap: an owner-visible, end-to-end review of the exact personal-use candidate.

## 7. Staged Decision Gates

### Gate A — Inventory confirmed

- [x] Separate merged, Draft, preview-only, and documentation-only work.
- [x] Identify the personal-use core.
- [x] Identify deferred scope.

### Gate B — Owner preview package

- [ ] Provide current-versus-V2 screen evidence.
- [ ] Explain every material design and flow change.
- [ ] Demonstrate desktop and mobile completion paths.
- [ ] Demonstrate sensitive-input and storage-failure behavior.

### Gate C — Owner hands-on use

- [ ] Owner completes representative daily tasks.
- [ ] Owner identifies confusing, unnecessary, or missing behavior.
- [ ] Findings are converted into a small, prioritized fix list.

### Gate D — Technical consolidation

- [ ] Select only the accepted PR changes.
- [ ] Rebase or restack safely against the current approved base.
- [ ] Run full CI and inspect matching visual evidence.
- [ ] Complete one integrated review of the exact candidate SHA.

### Gate E — Explicit release decision

- [ ] Owner authorizes Ready for review or merge.
- [ ] Owner separately authorizes any preview deployment.
- [ ] No public or production deployment is implied by a merge decision.

## 8. Immediate Next Action

Do not create the next broad governance specification yet.

The next action is to prepare the owner preview package for the current `main` experience and PR #40 V2, using the existing tested evidence where it matches the exact reviewed commits. After the owner chooses the preferred flow, create only the minimal integration and fix plan required for personal use.

## 9. Current Decision

- Specification expansion: **Paused**
- PR #42: **Documentation-only Draft; retain for reference**
- Personal-use v0.1: **Candidate exists but is not yet owner-accepted**
- Design change approval: **Pending owner comparison**
- PR #38 merge: **Not authorized**
- PR #40 adoption: **Not authorized**
- PR #41 inclusion in v0.1: **Deferred pending owner need**
- Deployment: **Not authorized**
- Paid services or automatic paid fallback: **Prohibited**
