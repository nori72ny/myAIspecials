# ORIGIN AI Evolution and Lifecycle Specification

Status: Active Draft  
Governing document: [PRODUCT_CONSTITUTION.md](./PRODUCT_CONSTITUTION.md)  
Related specifications:

- [SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md)
- [AI_ORCHESTRATION_SPEC.md](./AI_ORCHESTRATION_SPEC.md)
- [BENCHMARK_SPEC.md](./BENCHMARK_SPEC.md)
- [COST_AND_APPROVAL_POLICY.md](./COST_AND_APPROVAL_POLICY.md)
- [PROVIDER_INTEGRATION_STANDARD.md](./PROVIDER_INTEGRATION_STANDARD.md)

## 1. Purpose

This specification defines how ORIGIN discovers, qualifies, introduces, monitors, promotes, restricts, demotes, replaces, and removes AI services, models, agents, tools, and complete execution configurations.

The objective is not to adopt every new AI system quickly. The objective is to incorporate useful change safely, economically, reproducibly, and without weakening existing quality, privacy, safety, or approval guarantees.

ORIGIN must remain capable of benefiting from future AI systems without binding its architecture or product behavior to current provider names.

## 2. Governing Principles

1. New does not mean better.
2. Provider claims are evidence inputs, not proof.
3. Unknown properties are represented as unknown, not favorable.
4. Production eligibility requires observed and benchmarked evidence.
5. Promotion is scoped by domain, role, data class, region, cost profile, and risk class.
6. A model may be preferred for one task and prohibited for another.
7. No lifecycle transition may bypass cost, privacy, safety, approval, or audit controls.
8. Existing preferred configurations are not displaced without material evidence.
9. Rollback must be possible before promotion.
10. Catalog history and evaluation evidence are append-only and reproducible.
11. Continuous improvement must not become uncontrolled production experimentation.
12. The final result-producing configuration is the primary unit of evaluation.

## 3. Lifecycle Subjects

A lifecycle subject may be any independently governable unit:

- provider;
- provider account or regional configuration;
- model family;
- model revision;
- hosted agent;
- hosted tool;
- local model;
- open-weight model plus runtime;
- provider adapter version;
- prompt or role template;
- tool bundle;
- orchestration workflow;
- complete execution configuration.

Every subject must have a stable internal identifier independent of marketing names.

## 4. Lifecycle States

The canonical lifecycle states are:

```text
Discovered
  -> Intake Review
  -> Compatible
  -> Sandbox
  -> Shadow
  -> Limited Trial
  -> Approved
  -> Preferred

Any active state
  -> Restricted
  -> Suspended
  -> Deprecated
  -> Removed
```

### 4.1 Discovered

A potential subject has been detected but has not been trusted or executed.

Allowed activities:

- metadata collection;
- documentation review;
- duplicate detection;
- preliminary provider-policy review.

Production routing is prohibited.

### 4.2 Intake Review

Basic identity, ownership, availability, terms, pricing, regions, authentication, and data-policy information are reviewed.

The subject may be rejected before technical integration.

### 4.3 Compatible

The subject can be represented through existing provider-neutral contracts, or an explicitly governed extension has been accepted.

Compatibility does not imply quality or production approval.

### 4.4 Sandbox

The subject is executed only in isolated, synthetic, public, or explicitly approved test environments.

Sandbox execution must have:

- bounded cost;
- non-production credentials;
- no consequential external actions;
- test data appropriate to the provider policy;
- complete telemetry;
- reproducible configuration.

### 4.5 Shadow

The subject receives production-like tasks or replayed workloads but its result does not directly affect the user or external systems.

Shadow execution may be:

- offline replay;
- asynchronous duplicate execution;
- sampled comparison;
- evaluator-only execution.

Sensitive data must not be sent merely because the primary production path is allowed to use it. Shadow eligibility is independently evaluated.

### 4.6 Limited Trial

The subject may influence a bounded subset of real user outcomes under explicit safeguards.

A trial must define:

- eligible domains;
- eligible users or tenants;
- traffic percentage or request cap;
- budget cap;
- data classifications;
- regions;
- risk ceiling;
- allowed roles;
- success criteria;
- rollback trigger;
- trial expiration.

### 4.7 Approved

The subject is eligible for normal routing within an explicit approval scope.

Approval is never global by default. It is a policy object with bounded applicability.

### 4.8 Preferred

The subject is favored by routing for a stated domain and constraint profile because current evidence shows a meaningful advantage.

Preferred status must be periodically revalidated.

### 4.9 Restricted

The subject remains usable only under reduced scope, such as:

- non-sensitive data only;
- low-risk tasks only;
- no tools;
- no autonomous loops;
- no production writes;
- specific regions only;
- manual approval required;
- shadow-only operation.

### 4.10 Suspended

All new production use is blocked while investigation or remediation is underway.

### 4.11 Deprecated

The subject remains available only for migration, reproducibility, or bounded legacy use. New routing should prefer an approved replacement.

### 4.12 Removed

The subject is unavailable for execution. Historical records remain intact.

## 5. Discovery

### 5.1 Discovery Sources

ORIGIN may discover subjects through:

- provider model-list APIs;
- provider release feeds;
- official documentation changes;
- adapter catalog synchronization;
- benchmark-community submissions;
- internal proposals;
- user requests;
- repository or package release monitoring;
- policy, pricing, or terms-change notifications.

### 5.2 Discovery Record

Each discovery record must include:

- discovery ID;
- subject type;
- provider and subject identifiers;
- source;
- observed timestamp;
- claimed release date;
- claimed capabilities;
- pricing availability;
- regional availability;
- policy-document references;
- preliminary duplicate relationship;
- intake priority;
- evidence provenance.

### 5.3 Duplicate and Alias Handling

Marketing renames, aliases, snapshot IDs, dated revisions, and regional variants must not create accidental duplicate subjects.

The catalog must distinguish:

- same revision under another alias;
- new immutable revision;
- provider-side mutable alias;
- regional deployment of the same model;
- materially different runtime configuration.

## 6. Change Detection

ORIGIN must detect material changes to existing subjects, including:

- model alias retargeting;
- model revision release;
- capability addition or removal;
- context-window change;
- tool-use behavior change;
- structured-output behavior change;
- pricing change;
- free-tier change;
- rate-limit change;
- latency or availability change;
- retention or training-policy change;
- region availability change;
- safety-policy change;
- provider terms change;
- deprecation notice;
- adapter or SDK change.

A material change creates a new change event and may invalidate existing evidence.

## 7. Change Materiality

Changes are classified as:

- `NON_MATERIAL`: documentation or metadata correction with no routing impact;
- `LOW`: minor operational change requiring observation;
- `MEDIUM`: capability, price, latency, or reliability change requiring targeted refresh;
- `HIGH`: model revision, data-policy, safety, tool, or behavior change requiring requalification;
- `CRITICAL`: security incident, unauthorized data use, severe regression, hidden model replacement, or consequential-action failure requiring immediate suspension.

Materiality is determined by impact, not provider wording.

## 8. Compatibility Assessment

Compatibility assessment verifies that the subject can operate within ORIGIN contracts and controls.

Required checks include:

- identity stability;
- authentication method;
- secret-management compatibility;
- request and result normalization;
- streaming semantics;
- structured-output behavior;
- cancellation;
- timeout handling;
- usage reporting;
- cost attribution;
- rate-limit behavior;
- tool-call representation;
- consequential-action separation;
- retention and region metadata;
- auditability;
- adapter conformance.

Compatibility failure must produce a structured reason rather than an informal note.

## 9. Intake Risk Assessment

Before sandbox execution, ORIGIN evaluates:

- provider maturity;
- ownership and jurisdiction;
- data retention;
- training use;
- human-review possibility;
- security documentation;
- terms stability;
- pricing transparency;
- billing risk;
- credential scope;
- tool permissions;
- autonomous-action capability;
- content-policy compatibility;
- shutdown and deletion mechanisms.

A high-risk intake may proceed only with narrower data, role, cost, and action boundaries.

## 10. Sandbox Qualification

Sandbox qualification includes four classes of evidence.

### 10.1 Contract Evidence

- adapter conformance tests;
- schema validation;
- streaming reconstruction;
- error normalization;
- cancellation behavior;
- usage-record completeness;
- deterministic failure handling.

### 10.2 Capability Evidence

- supported modalities;
- context limits;
- structured output;
- tool use;
- citation behavior;
- artifact generation;
- language support;
- domain-specific task performance.

### 10.3 Operational Evidence

- latency distribution;
- timeout rate;
- rate-limit behavior;
- availability;
- output stability;
- usage-report delay;
- pricing accuracy;
- retry safety.

### 10.4 Safety and Governance Evidence

- data-policy eligibility;
- instruction-boundary behavior;
- action authorization;
- prompt-injection resistance where relevant;
- secret leakage tests;
- harmful or prohibited action controls;
- audit completeness.

## 11. Shadow Evaluation

Shadow evaluation compares the candidate against the current approved or preferred configuration under equivalent conditions.

### 11.1 Shadow Comparison Requirements

Comparisons should control for:

- task version;
- input data;
- tools available;
- time limit;
- cost ceiling;
- role assignment;
- evaluator version;
- evidence freshness;
- randomization where supported.

### 11.2 Shadow Metrics

At minimum:

- task success;
- factual correctness;
- instruction compliance;
- evidence quality;
- critical failure rate;
- latency;
- cost;
- reliability;
- variance;
- user-impact simulation;
- safety-policy compliance.

### 11.3 Shadow Independence

Candidate output must not influence the production response unless the candidate is already approved for that use.

## 12. Limited Trial Design

A limited trial is an explicit experiment, not silent unrestricted rollout.

The trial plan must include:

- hypothesis;
- baseline;
- candidate configuration;
- target domain and cohort;
- inclusion and exclusion criteria;
- sample-size target;
- traffic allocation;
- duration;
- budget;
- success and failure thresholds;
- safety stop conditions;
- user-consent requirements;
- monitoring owner;
- rollback procedure.

Trials involving consequential actions require stronger approval than trials limited to answer generation.

## 13. Promotion Policy

Promotion requires evidence that is sufficient for the requested scope.

### 13.1 Promotion Gates

A subject cannot become Approved unless:

- identity is stable;
- required metadata is complete;
- provider policy is acceptable for the scope;
- adapter certification is sufficient;
- benchmark evidence meets minimum thresholds;
- critical failure rate is below the allowed ceiling;
- cost behavior is understood;
- usage reporting is adequate;
- rollback is tested;
- approval scope is recorded;
- evidence is not expired.

### 13.2 Preferred Promotion

Preferred status additionally requires:

- statistically or operationally meaningful improvement;
- positive marginal value after cost and latency;
- no material regression in safety or reliability;
- adequate sample size;
- comparison against current preferred configurations;
- no unresolved critical incidents.

### 13.3 Scoped Promotion

Promotion records must specify:

- domain;
- task archetype;
- role;
- risk class;
- data classification;
- region;
- user or tenant scope;
- tool permissions;
- cost profile;
- execution mode;
- validity period.

## 14. Evidence Strength

Evidence is categorized as:

- `CLAIMED`: provider documentation only;
- `OBSERVED`: direct isolated observation;
- `BENCHMARKED`: repeated controlled evaluation;
- `SHADOW_VALIDATED`: production-like shadow evidence;
- `TRIAL_VALIDATED`: bounded real-use evidence;
- `PRODUCTION_VALIDATED`: sustained production evidence.

Routing must not treat these categories as equivalent.

## 15. Confidence and Cold Start

New subjects receive a cold-start uncertainty penalty until adequate evidence accumulates.

The penalty considers:

- sample count;
- domain coverage;
- variance;
- recency;
- evaluator quality;
- operational exposure;
- provider-policy completeness;
- revision stability.

Cold-start uncertainty may reduce routing rank, restrict risk class, require review, or keep the subject in shadow mode.

## 16. Evidence Expiration

Evidence expires or is weakened when:

- the model revision changes;
- a mutable alias changes target;
- the provider adapter changes materially;
- pricing changes materially;
- provider policy changes;
- benchmark tasks become contaminated;
- tool behavior changes;
- significant time passes without refresh;
- production incidents contradict prior evidence.

Expiration rules must be explicit by evidence type and risk class.

## 17. Continuous Monitoring

Approved and Preferred subjects are continuously monitored for:

- success rate;
- critical failures;
- quality drift;
- latency drift;
- cost drift;
- rate-limit behavior;
- provider outages;
- usage-report discrepancies;
- citation degradation;
- policy changes;
- user complaints;
- evaluator disagreement;
- anomalous output distribution.

Monitoring must distinguish provider-wide, model-specific, region-specific, adapter-specific, and workflow-specific failures.

## 18. Drift Detection

Drift may be:

- quality drift;
- safety drift;
- cost drift;
- latency drift;
- reliability drift;
- policy drift;
- capability drift;
- output-format drift;
- tool-use drift.

Drift detectors must define baseline, window, threshold, minimum sample count, and escalation action.

## 19. Restriction, Demotion, and Suspension

### 19.1 Restriction Triggers

- incomplete policy metadata;
- elevated error rate;
- uncertain model revision;
- cost volatility;
- degraded structured output;
- insufficient evidence for a new capability;
- region-specific issue;
- tool or autonomous-action concern.

### 19.2 Demotion Triggers

Preferred status may be removed when:

- another configuration materially outperforms it;
- advantage is no longer statistically or operationally meaningful;
- evidence expires;
- cost rises beyond marginal value;
- reliability degrades;
- critical failures exceed the ceiling.

### 19.3 Immediate Suspension Triggers

- security compromise;
- unauthorized data retention or disclosure;
- critical provider-policy violation;
- uncontrolled consequential action;
- hard-budget bypass;
- severe output-integrity failure;
- hidden model substitution with material behavior change;
- inability to cancel dangerous execution;
- audit trail failure for high-risk use.

## 20. Incident Response

Lifecycle incidents must produce:

- incident ID;
- affected subjects and scopes;
- detection source;
- severity;
- start and detection times;
- containment action;
- routing impact;
- affected requests;
- cost impact;
- data impact;
- user-notification requirement;
- evidence invalidation;
- remediation owner;
- restoration criteria;
- post-incident review.

Restoration must use explicit gates and may begin at Restricted or Shadow rather than returning directly to Preferred.

## 21. Deprecation and Replacement

Deprecation planning must include:

- provider deadline;
- affected aliases and revisions;
- affected routing policies;
- replacement candidates;
- compatibility gaps;
- benchmark comparison;
- migration cost;
- prompt or tool changes;
- user-visible behavior change;
- rollback plan;
- archival requirements.

A provider-designated successor is not automatically an ORIGIN-approved replacement.

## 22. Removal

Removal requires:

- routing disabled;
- credentials revoked where appropriate;
- scheduled work cancelled or migrated;
- cache and artifact policy applied;
- catalog status changed;
- audit history retained;
- user-facing dependencies addressed;
- billing exposure closed;
- replacement status recorded.

## 23. Catalog Versioning

The catalog must support immutable snapshots.

A catalog snapshot includes:

- providers;
- configurations;
- models and revisions;
- aliases and targets;
- capability evidence;
- lifecycle status;
- approval scopes;
- restrictions;
- pricing references;
- policy references;
- benchmark-profile references;
- adapter versions;
- effective timestamp.

Every routing decision must reference the catalog snapshot used.

## 24. Decision Records

Each lifecycle transition creates a decision record containing:

- subject ID;
- previous state;
- next state;
- requested scope;
- approved scope;
- evidence references;
- benchmark version;
- policy version;
- catalog snapshot;
- decision maker or automated policy;
- rationale;
- confidence;
- conditions;
- expiration;
- rollback target;
- timestamp.

Automated decisions must be explainable through policy inputs and must remain auditable.

## 25. Human Oversight

Human review is required when:

- a subject handles highly sensitive data for the first time;
- consequential actions are introduced;
- a critical incident is restored;
- provider policy is ambiguous;
- benchmark evaluators materially disagree;
- promotion would displace a high-risk preferred configuration;
- evidence is insufficient but business pressure requests acceleration;
- removal affects contractual or regulatory obligations.

Human review cannot waive hard safety, privacy, or budget constraints without a separately governed policy change.

## 26. Automation Boundaries

The lifecycle engine may automatically:

- discover catalog changes;
- create intake records;
- run deterministic conformance tests;
- schedule sandbox benchmarks;
- calculate evidence age;
- recommend transitions;
- restrict a subject on predefined critical signals;
- expire approval scopes;
- route around suspended subjects.

It must not automatically:

- send sensitive data to an unapproved provider;
- grant consequential-action permissions;
- exceed evaluation budgets;
- promote a subject beyond policy-defined scope;
- erase incident evidence;
- reinterpret unknown metadata as acceptable.

## 27. Cost Governance for Evaluation

Evaluation itself is subject to cost control.

Every lifecycle campaign must have:

- maximum budget;
- estimated minimum, expected, and maximum cost;
- provider and tool caps;
- run-count limits;
- stopping rules;
- approval requirement where applicable;
- actual-cost reconciliation.

Evaluation should stop when additional samples are unlikely to change the decision enough to justify their cost.

## 28. Privacy and Data Governance

Lifecycle stages have independent data eligibility.

Default posture:

- Discovered and Intake Review: metadata only;
- Sandbox: synthetic or public data;
- Shadow: production-like data only when separately approved;
- Limited Trial: bounded real data under explicit policy;
- Approved and Preferred: only within recorded data-class and region scopes.

Data minimization and redaction apply to benchmark and diagnostic payloads as well as user-facing execution.

## 29. Security Requirements

- evaluation credentials must be separated from production credentials;
- sandbox tools must not possess production write privileges;
- lifecycle systems must use least privilege;
- promotion cannot grant secret access implicitly;
- downloaded model artifacts require integrity verification;
- supply-chain changes require reassessment;
- incident evidence must be tamper-evident;
- privileged lifecycle transitions require authenticated authorization.

## 30. Observability

Lifecycle observability includes:

- discoveries by source;
- intake backlog and age;
- state transitions;
- time in state;
- benchmark campaign cost;
- promotion and rejection rate;
- shadow comparison results;
- trial exposure;
- drift alerts;
- restrictions and suspensions;
- evidence-expiration backlog;
- deprecated subjects still receiving traffic;
- rollback frequency;
- catalog freshness.

## 31. Lifecycle Service Boundaries

Suggested logical components:

```text
services/provider-registry/src/
  discovery/
  intake/
  compatibility/
  qualification/
  shadow/
  trial/
  promotion/
  monitoring/
  incident/
  deprecation/
  catalog-versioning/
```

These are logical boundaries, not a requirement to deploy separate microservices.

## 32. Core Domain Types

Suggested provider-neutral types:

```text
packages/ai-core/src/evolution/
  lifecycle-subject.ts
  lifecycle-state.ts
  discovery-record.ts
  change-event.ts
  compatibility-assessment.ts
  qualification-campaign.ts
  shadow-evaluation.ts
  trial-plan.ts
  approval-scope.ts
  lifecycle-decision.ts
  evidence-record.ts
  drift-signal.ts
  incident-record.ts
  deprecation-plan.ts
  catalog-snapshot.ts
```

## 33. Initial Zero-or-Low-Cost Implementation

The first implementation should use deterministic fixtures and synthetic benchmark data.

It should support:

1. registering mock providers, models, revisions, and aliases;
2. detecting a new revision and an alias retarget;
3. creating discovery and change records;
4. running mock compatibility and conformance checks;
5. advancing a subject through Sandbox, Shadow, and Limited Trial;
6. applying scoped approval and restriction records;
7. calculating cold-start uncertainty;
8. expiring evidence after a simulated material change;
9. promoting and demoting by deterministic policy;
10. simulating quality, cost, latency, and safety drift;
11. automatically suspending on a critical signal;
12. creating a replacement and deprecation plan;
13. producing immutable catalog snapshots;
14. linking routing decisions to the snapshot used;
15. operating without paid APIs or production credentials.

## 34. Acceptance Criteria

The specification is satisfied by an implementation when:

1. lifecycle subjects have stable provider-neutral identities;
2. every subject has exactly one current lifecycle state;
3. state transitions are validated and audited;
4. production routing rejects non-approved subjects;
5. approval is scoped rather than global;
6. discovery source and evidence provenance are retained;
7. model aliases and revisions are distinguished;
8. material changes can invalidate evidence;
9. sandbox execution cannot perform consequential production actions;
10. shadow output cannot silently affect production results;
11. limited trials have explicit exposure and rollback boundaries;
12. promotion requires current benchmark and policy evidence;
13. cold-start uncertainty affects routing eligibility;
14. preferred status can be automatically reviewed and demoted;
15. critical incidents can suspend a subject immediately;
16. restoration does not bypass requalification;
17. provider-designated replacements are independently evaluated;
18. evaluation spending obeys budget policy;
19. catalog snapshots are immutable and versioned;
20. routing records reference a catalog snapshot;
21. evidence expiration is deterministic and testable;
22. unknown metadata is never treated as favorable;
23. removed subjects cannot receive new work;
24. historical evidence and decision records remain available;
25. the complete mock lifecycle works without live credentials or paid calls.

## 35. Representative Tests

- discover a new mock model and prevent production routing;
- reject a duplicate marketing alias;
- detect that a mutable alias points to a new revision;
- require targeted requalification after a pricing change;
- require full requalification after a retention-policy change;
- pass adapter conformance but fail safety qualification;
- enter Shadow while remaining ineligible for sensitive data;
- stop a trial when the critical failure threshold is crossed;
- promote only for a coding-review role, not all coding roles;
- prefer a candidate only when quality gain justifies incremental cost;
- apply cold-start penalty to a high claimed score with few samples;
- expire evidence after a model revision change;
- demote a preferred subject after sustained latency and cost drift;
- restrict a model to non-sensitive data after a policy ambiguity;
- immediately suspend after a simulated unauthorized external action;
- restore a suspended subject to Shadow rather than Preferred;
- reject a provider-nominated replacement that fails benchmarks;
- migrate a deprecated subject without losing audit history;
- block evaluation when its campaign budget is exhausted;
- verify routing uses the intended immutable catalog snapshot.

## 36. Non-Goals for the Initial Increment

The initial increment does not require:

- automatic discovery from every commercial provider;
- live paid benchmark campaigns;
- unrestricted production experimentation;
- real sensitive-data shadow traffic;
- automatic legal interpretation of provider terms;
- deployment as separate microservices;
- autonomous promotion outside explicit policy.

## 37. Fixed Decisions

Unless explicitly changed by the product owner:

- new AI systems are not trusted merely because they are new or popular;
- capability claims remain distinct from observed and benchmarked evidence;
- lifecycle approval is scoped by task, role, risk, data, region, tools, cost, and time;
- production experimentation is bounded and reversible;
- critical safety, privacy, action, and budget failures override aggregate quality scores;
- provider aliases and model revisions are tracked separately;
- evidence can expire;
- preferred status is temporary and evidence-dependent;
- replacements are independently qualified;
- historical lifecycle decisions are retained;
- future providers integrate through controlled evaluation rather than architectural rewrites;
- the final result-producing configuration remains the primary unit of value.
