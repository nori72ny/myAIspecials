# ORIGIN Product Specification Index

Status: Active  
Governing document: [PRODUCT_CONSTITUTION.md](./PRODUCT_CONSTITUTION.md)

## Purpose

This index defines the official product specification set for ORIGIN. Implementation work should reference these documents so product direction, architecture, orchestration, benchmarking, cost control, interface quality, governance, and future AI integration remain consistent.

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
- logical components and execution graph;
- provider adapter boundary;
- evaluation and synthesis pipeline;
- persistence and audit model;
- event flow;
- failure handling and fallback;
- safety and approval boundaries;
- observability and deployment boundaries;
- initial low-cost implementation slice.

Status: Active Draft

### 3. AI Orchestration Specification

File: `docs/AI_ORCHESTRATION_SPEC.md`

Defines:

- task analysis and clarification policy;
- capability derivation;
- hard constraints and candidate eligibility;
- exclusion records;
- cost-aware, quality-aware candidate scoring;
- role generation and independence requirements;
- single, reviewed, parallel, and deliberation modes;
- execution graph construction and validation;
- budget and approval integration;
- retries, fallback, partial completion, and stopping rules;
- evaluation and synthesis handoff;
- routing-decision metadata and versioning;
- deterministic zero-or-low-cost mock implementation;
- acceptance criteria and representative tests.

Status: Active Draft

### 4. Benchmark Specification

File: `docs/BENCHMARK_SPEC.md`

Defines:

- benchmark subjects covering models, services, agents, roles, workflows, and complete execution configurations;
- domain taxonomy and task archetypes;
- static, execution, long-running agent, and production outcome benchmarks;
- deterministic, reference-based, model-based, human, and user-outcome evaluators;
- dimension-level scoring and critical failure conditions;
- repetition, variance, confidence intervals, and pairwise evaluation;
- complete cost and latency measurement;
- quality-cost frontiers and Pareto-efficient configurations;
- workflow ablation and role-specific evaluation;
- constraint-specific performance profiles;
- cold-start uncertainty policy;
- sandbox, shadow, trial, promotion, restriction, and refresh policies;
- benchmark governance, integrity, reproducibility, and routing integration;
- initial zero-or-low-cost benchmark implementation.

Status: Active Draft

### 5. Cost and Approval Policy

File: `docs/COST_AND_APPROVAL_POLICY.md`

Defines:

- free and low-cost preference without accepting insufficient quality;
- request, mission, user, tenant, provider, and period budgets;
- soft, approval, and hard limits;
- complete cost estimation and versioned pricing snapshots;
- budget reservation and runtime cost enforcement;
- cheapest-sufficient-plan and marginal-value rules;
- paid provider, tool, retry, fallback, and agent-loop controls;
- cost, data, action, and scope approval categories;
- consequential-action approval gates;
- approval validity, expiration, revocation, and material-plan-change rules;
- actual-cost reconciliation and estimate-accuracy monitoring;
- economy, recommended, and premium alternatives;
- audit, failure handling, mock implementation, and acceptance tests.

Status: Active Draft

### 6. Result and UX Specification

File: `docs/RESULT_UX_SPEC.md`

Defines:

- request composer and task-understanding experience;
- role-first execution-plan preview;
- economy, recommended, and premium alternatives;
- cost, data, action, and scope approval presentation;
- exact consequential-action previews;
- user-centered progress and cancellation behavior;
- conclusion-first result hierarchy;
- research, coding, comparison, decision, writing, and autonomous-execution layouts;
- claim-level evidence, freshness, conflict, uncertainty, and confidence presentation;
- cost estimate and actual-cost reconciliation UX;
- partial, blocked, cancelled, and failed states;
- expert audit view without exposing secrets or hidden reasoning;
- accessibility, responsive behavior, internationalization, and semantic design-system requirements;
- initial zero-or-low-cost mock interface and acceptance tests.

Status: Active Draft

### 7. Provider Integration Standard

Planned file: `docs/PROVIDER_INTEGRATION_STANDARD.md`

Will define:

- adapter interface and model discovery;
- capability declarations;
- authentication and secret handling;
- streaming, structured output, and tool invocation;
- usage and cost reporting;
- health checks and failure normalization;
- provider-policy metadata;
- deprecation and replacement.

Status: Next

### 8. AI Evolution and Lifecycle Specification

Planned file: `docs/AI_EVOLUTION_SPEC.md`

Will define:

- discovery of new services and models;
- compatibility assessment;
- sandbox and shadow evaluation;
- limited trial;
- approval, promotion, demotion, restriction, and removal;
- release-change detection;
- benchmark refresh policy;
- catalog versioning.

Status: Planned

### 9. Security, Privacy, and Data Governance

Planned file: `docs/SECURITY_PRIVACY_GOVERNANCE.md`

Will define:

- data classification and provider eligibility;
- minimization, redaction, retention, and deletion;
- user consent;
- secrets management;
- tenant isolation;
- audit access;
- incident handling.

Status: Planned

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

The first implementation increment should establish provider-neutral, cost-aware domain models and a complete mock UX without invoking paid AI services.

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
        benchmark-subject.ts
        benchmark-case.ts
        rubric.ts
        run-result.ts
        performance-profile.ts
        constraint-profile.ts
      cost/
        money.ts
        pricing-snapshot.ts
        cost-estimate.ts
        budget.ts
        reconciliation.ts
      approval/
        approval-request.ts
        approval-decision.ts
        proposed-action.ts
        data-disclosure.ts

packages/
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

  benchmark-engine/
    src/
      case-registry/
      runner/
      evaluators/
      aggregation/
      ranking/
      promotion-policy/
```

Exact placement must be reconciled with the current repository structure. Existing types, services, and UI components should be reused rather than duplicated, and the mock stage should avoid unnecessary service proliferation.

## First Deliverable

The first usable, zero-or-low-cost deliverable can:

1. accept a request without requiring provider selection;
2. display interpreted objective, constraints, risk, and required capabilities;
3. enforce hard constraints;
4. compare registered AI service profiles;
5. explain candidate exclusions and score breakdowns;
6. generate roles and an execution graph;
7. calculate minimum, expected, and maximum cost;
8. apply budget thresholds and reserve mock funds;
9. present economy, recommended, and premium plans;
10. display predicted quality, confidence, latency, cost, and approval state;
11. distinguish cost, data, action, and scope approval;
12. preview simulated consequential actions exactly;
13. block simulated external writes without valid approval;
14. display user-centered execution progress;
15. render a conclusion-first structured mock result;
16. show claim-level evidence, uncertainty, limitations, and conflicts;
17. distinguish complete, partial, blocked, cancelled, and failed outcomes;
18. reconcile mock estimated and actual usage;
19. produce complete routing, cost, approval, and execution audit detail;
20. load synthetic benchmark results;
21. generate constraint-specific performance profiles;
22. identify a quality-cost frontier;
23. apply uncertainty and evidence-expiration rules;
24. operate with keyboard-accessible responsive UI;
25. perform no real provider charge or consequential external action.

No broad paid-provider rollout or real consequential external action is required for this deliverable.

## Decision Record

The following decisions are fixed unless explicitly changed by the product owner:

- The slogan and primary product objective remain unchanged.
- The original cost conditions remain unchanged.
- Current benchmark targets include ChatGPT, Claude, Gemini, Codex, Claude Code, Manus, Perplexity, Genspark, other current services, and future AI systems.
- The platform supports many use cases and does not reduce all AI systems to one universal ranking.
- New services enter through controlled evaluation rather than automatic trust.
- Roles describe work and remain independent of provider names.
- Multiple AI services are used only when they provide clear marginal value.
- The cheapest sufficient plan is preferred.
- Benchmarking evaluates complete result-producing configurations, not only individual models.
- Rankings are valid only for stated domains, roles, constraints, and evidence periods.
- Critical failures cannot be hidden by a high aggregate score.
- Cost, data disclosure, consequential action, and operational scope are approved independently.
- A hard budget limit cannot be bypassed by routing, retries, tools, agents, or provider adapters.
- Approval is explicit, informed, specific, bounded, versioned, and revocable.
- Automatic is the default user mode.
- Users are not required to select a provider.
- Roles and outcomes are presented before provider identities.
- Results are conclusion-first, with evidence and audit detail progressively disclosed.
- Material uncertainty, conflicting evidence, partial completion, and actual cost are not hidden.
- The final result, not provider popularity, is the primary unit of value.
