# ORIGIN Product Specification Index

Status: Active  
Governing document: [PRODUCT_CONSTITUTION.md](./PRODUCT_CONSTITUTION.md)

## Purpose

This index defines the official product specification set for ORIGIN. Implementation work should reference these documents so product direction, architecture, orchestration, benchmarking, cost control, interface quality, provider integration, governance, and future AI evolution remain consistent.

## Specification Set

### 1. Product Constitution

File: `docs/PRODUCT_CONSTITUTION.md`

Defines the immutable vision, mission, original cost conditions, provider-neutral principles, outcome-first evaluation, safety boundaries, result-design requirements, AI evolution principles, and change control.

Status: Created

### 2. System Architecture

File: `docs/SYSTEM_ARCHITECTURE.md`

Defines:

- system context and architectural principles;
- bounded contexts and service responsibilities;
- complete request lifecycle;
- execution graph and provider-adapter boundary;
- evaluation, synthesis, persistence, audit, and event flow;
- failure handling, fallback, safety, observability, and deployment boundaries;
- initial low-cost implementation slice.

Status: Active Draft

### 3. AI Orchestration Specification

File: `docs/AI_ORCHESTRATION_SPEC.md`

Defines:

- task analysis, clarification, and capability derivation;
- hard constraints, candidate eligibility, and exclusions;
- cost-aware and quality-aware candidate scoring;
- role generation and independence requirements;
- single, reviewed, parallel, and deliberation modes;
- execution graph construction and validation;
- budget, approval, retry, fallback, and stopping rules;
- evaluation and synthesis handoff;
- routing-decision metadata and deterministic mock behavior.

Status: Active Draft

### 4. Benchmark Specification

File: `docs/BENCHMARK_SPEC.md`

Defines:

- models, services, agents, roles, workflows, and complete configurations as benchmark subjects;
- domain taxonomy and task archetypes;
- static, execution, long-running-agent, and production-outcome benchmarks;
- deterministic, reference, model-based, human, and user-outcome evaluators;
- critical failures, repetition, variance, confidence, pairwise comparison, and ablation;
- complete cost and latency measurement;
- quality-cost frontiers and constraint-specific performance profiles;
- sandbox, shadow, trial, promotion, restriction, and evidence-refresh policies.

Status: Active Draft

### 5. Cost and Approval Policy

File: `docs/COST_AND_APPROVAL_POLICY.md`

Defines:

- free and low-cost preference without accepting insufficient quality;
- request, mission, user, tenant, provider, and period budgets;
- soft, approval, and hard limits;
- cost estimation, reservation, runtime enforcement, and reconciliation;
- cheapest-sufficient-plan and marginal-value rules;
- cost, data, action, and scope approval categories;
- consequential-action gates, approval validity, revocation, and material-plan changes;
- economy, recommended, and premium alternatives.

Status: Active Draft

### 6. Result and UX Specification

File: `docs/RESULT_UX_SPEC.md`

Defines:

- request composer and task-understanding experience;
- role-first execution-plan preview;
- economy, recommended, and premium alternatives;
- cost, data, action, and scope approvals;
- exact consequential-action previews;
- progress, cancellation, and long-running-task behavior;
- conclusion-first results and task-specific layouts;
- claim-level evidence, freshness, conflict, uncertainty, and confidence;
- cost reconciliation, partial and failed states, expert audit view, accessibility, responsiveness, and internationalization.

Status: Active Draft

### 7. Provider Integration Standard

File: `docs/PROVIDER_INTEGRATION_STANDARD.md`

Defines:

- provider-neutral adapter architecture and contracts;
- provider, configuration, model, alias, and revision identity;
- model discovery and catalog reconciliation;
- capability evidence and approval states;
- authentication, secret handling, least privilege, rotation, and redaction;
- normalized text, multimodal, structured, streaming, citation, artifact, tool, and hosted-agent contracts;
- usage, pricing, cost attribution, rate limits, timeout, cancellation, and idempotency;
- error normalization, retry safety, health, policy metadata, audit, conformance, certification, and deprecation.

Status: Active Draft

### 8. AI Evolution and Lifecycle Specification

File: `docs/AI_EVOLUTION_SPEC.md`

Defines:

- lifecycle subjects covering providers, models, revisions, adapters, tools, agents, roles, and workflows;
- Discovered, Intake Review, Compatible, Sandbox, Shadow, Limited Trial, Approved, Preferred, Restricted, Suspended, Deprecated, and Removed states;
- discovery sources, identity, alias, revision, and duplicate handling;
- release, capability, pricing, policy, region, adapter, and behavior change detection;
- compatibility, intake risk, sandbox qualification, shadow evaluation, and bounded trials;
- scoped promotion and preferred-status gates;
- evidence strength, cold-start uncertainty, expiration, and refresh;
- continuous monitoring and quality, safety, cost, latency, reliability, policy, format, and tool-use drift;
- restriction, demotion, suspension, incident response, restoration, deprecation, replacement, and removal;
- immutable catalog snapshots and lifecycle decision records;
- evaluation budgets, human oversight, security, privacy, observability, and deterministic mock implementation.

Status: Active Draft

### 9. Security, Privacy, and Data Governance

Planned file: `docs/SECURITY_PRIVACY_GOVERNANCE.md`

Will define:

- data classification and provider eligibility;
- minimization, redaction, retention, and deletion;
- user consent and lawful handling boundaries;
- secrets management and credential isolation;
- tenant isolation and access control;
- audit access and tamper resistance;
- security incident and data-incident handling;
- regional, contractual, and provider-policy controls.

Status: Next

### 10. Development and Quality Standard

Planned file: `docs/DEVELOPMENT_STANDARD.md`

Will define:

- architecture and coding rules;
- test requirements;
- schema versioning and migrations;
- observability;
- feature flags;
- pull-request quality gates;
- release readiness and rollback.

Status: Planned

## Initial Implementation Packages

The first implementation increment should establish provider-neutral, cost-aware domain models, deterministic provider adapters, governed lifecycle records, and a complete mock UX without invoking paid AI services.

```text
packages/
  ai-core/
    src/
      task-analysis.ts
      service-profile.ts
      model-profile.ts
      capabilities.ts
      candidate.ts
      role.ts
      execution-plan.ts
      result.ts
      routing-decision.ts
      benchmark/
      cost/
      approval/
      evolution/
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

  provider-contracts/
    src/
      provider-adapter.ts
      provider-profile.ts
      provider-configuration.ts
      model-ref.ts
      capability-profile.ts
      execution-request.ts
      execution-result.ts
      stream-event.ts
      usage-record.ts
      provider-error.ts
      provider-health.ts
      tool-definition.ts

  ui/
    src/
      request-composer/
      task-understanding-card/
      plan-summary-card/
      plan-alternative-card/
      approval-card/
      proposed-action-preview/
      progress-timeline/
      result-workspace/
      evidence-view/
      uncertainty-view/
      cost-reconciliation/
      audit-view/

services/
  orchestrator/
    src/
      task-analyzer/
      capability-resolver/
      model-registry/
      capability-registry/
      candidate-filter/
      candidate-ranker/
      cost-estimator/
      budget-policy/
      reservation-ledger/
      role-planner/
      execution-planner/
      approval-policy/
      runtime-cost-guard/
      retry-planner/
      reconciliation/
      routing-recorder/

  provider-registry/
    src/
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

  benchmark-engine/
    src/
      case-registry/
      runner/
      evaluators/
      aggregation/
      ranking/
      promotion-policy/

adapters/
  mock-provider/
    src/
      adapter.ts
      fixtures/
      failure-scenarios/
      conformance/
```

Exact placement must be reconciled with the current repository structure. Existing types, services, adapters, and UI components should be reused rather than duplicated, and the mock stage should avoid unnecessary service proliferation.

## First Deliverable

The first usable, zero-or-low-cost deliverable can:

1. accept a request without requiring provider selection;
2. interpret objective, constraints, risk, freshness, and capabilities;
3. register and reconcile deterministic mock providers, models, revisions, and aliases;
4. enforce provider, capability, data, risk, and budget constraints;
5. compare candidates and explain exclusions and score breakdowns;
6. generate roles, an execution graph, and economy, recommended, and premium plans;
7. estimate, reserve, enforce, and reconcile mock cost;
8. distinguish cost, data, action, and scope approval;
9. normalize mock text, structured, streaming, tool, partial, and failure results;
10. block simulated consequential actions without valid approval;
11. display progress and a conclusion-first result with evidence and uncertainty;
12. load synthetic benchmark evidence and identify a quality-cost frontier;
13. discover a mock model revision or alias change;
14. advance a subject through Sandbox, Shadow, Limited Trial, and scoped Approval;
15. apply cold-start uncertainty and evidence expiration;
16. detect simulated quality, cost, latency, reliability, policy, and safety drift;
17. restrict, demote, suspend, restore, deprecate, replace, and remove mock subjects;
18. create immutable catalog snapshots;
19. link routing and lifecycle decisions to the snapshot used;
20. produce complete routing, provider, benchmark, cost, approval, lifecycle, and execution audit detail;
21. pass provider and lifecycle tests without live credentials;
22. operate with keyboard-accessible responsive UI;
23. perform no real provider charge or consequential external action.

No broad paid-provider rollout, live credential requirement, unrestricted production trial, or real consequential external action is required for this deliverable.

## Decision Record

The following decisions are fixed unless explicitly changed by the product owner:

- The slogan and primary product objective remain unchanged.
- The original cost conditions remain unchanged.
- Current benchmark targets include ChatGPT, Claude, Gemini, Codex, Claude Code, Manus, Perplexity, Genspark, other current services, and future AI systems.
- The platform supports many use cases and does not reduce all AI systems to one universal ranking.
- Roles describe work and remain independent of provider names.
- Multiple AI systems are used only when they provide clear marginal value.
- The cheapest sufficient plan is preferred.
- Benchmarking evaluates complete result-producing configurations, not only individual models.
- Rankings are valid only for stated domains, roles, constraints, and evidence periods.
- Critical failures cannot be hidden by a high aggregate score.
- Cost, data disclosure, consequential action, and operational scope are approved independently.
- Hard budget limits cannot be bypassed by routing, retries, tools, agents, provider SDKs, adapters, trials, or benchmark campaigns.
- Approval is explicit, informed, specific, bounded, versioned, and revocable.
- Automatic is the default user mode, and users are not required to select a provider.
- Roles and outcomes are presented before provider identities.
- Results are conclusion-first, with evidence and audit detail progressively disclosed.
- Material uncertainty, conflicting evidence, partial completion, and actual cost are not hidden.
- Core orchestration code does not depend on provider SDK types.
- Provider names and claims do not substitute for verified capability evidence.
- Missing capability, pricing, usage, retention, region, policy, or lifecycle metadata is represented as unknown, not favorable.
- Provider-hosted tools and agents remain subject to ORIGIN approval, budget, safety, privacy, and audit controls.
- New AI systems enter through controlled discovery, qualification, shadow evaluation, and bounded trial rather than automatic trust.
- Lifecycle approval is scoped by task, role, risk, data, region, tools, cost, user or tenant, and time.
- Preferred status is temporary, evidence-dependent, and reversible.
- Model aliases and revisions are tracked separately.
- Material changes can expire evidence and trigger requalification.
- Provider-designated replacements are independently qualified.
- Critical safety, privacy, action, and budget failures can suspend a subject immediately.
- Historical catalog snapshots, evidence, incidents, and lifecycle decisions are retained.
- The final result-producing configuration, not provider popularity, is the primary unit of value.
