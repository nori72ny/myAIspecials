# ORIGIN Cost and Approval Policy

Status: Active Draft  
Governing documents:
- [PRODUCT_CONSTITUTION.md](./PRODUCT_CONSTITUTION.md)
- [SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md)
- [AI_ORCHESTRATION_SPEC.md](./AI_ORCHESTRATION_SPEC.md)
- [BENCHMARK_SPEC.md](./BENCHMARK_SPEC.md)

## 1. Purpose

This policy defines how ORIGIN controls monetary cost, provider usage, consequential actions, user approvals, and execution limits while preserving the original product objective: produce the best practical outcome without unnecessary expense or avoidable risk.

The policy does not optimize for the cheapest possible answer. It optimizes for the least expensive execution plan that is predicted to satisfy the task's required quality, safety, evidence, latency, and privacy constraints.

## 2. Fixed Principles

1. Prefer free tiers, cached results, local computation, and lower-cost providers when they are sufficient.
2. Do not invoke additional models, reviewers, tools, or retries without expected marginal value.
3. Do not conceal estimated or actual cost.
4. Do not exceed a hard budget limit.
5. Obtain explicit approval before consequential external actions.
6. Treat approval as authorization for a defined scope, not as unlimited permission.
7. Recalculate cost and approval state whenever the execution plan changes materially.
8. Separate informational generation from actions that modify external systems.
9. Preserve a complete audit record of estimates, approvals, actual usage, and deviations.
10. High-risk tasks may justify higher cost, but they do not remove approval or safety requirements.

## 3. Cost Domains

ORIGIN accounts for all material execution costs, including:

- model input tokens;
- model output tokens;
- cached-token charges;
- image, audio, video, and document processing;
- search, browsing, database, and retrieval tools;
- code execution and hosted sandbox time;
- external SaaS actions;
- storage, indexing, and vector operations;
- retries and fallback executions;
- reviewers, judges, and synthesis calls;
- provider minimum charges or session fees;
- currency conversion and applicable taxes where known.

Unknown cost components must be marked as uncertain rather than silently treated as zero.

## 4. Budget Model

### 4.1 Budget scopes

Budgets may exist at multiple scopes:

- request;
- mission;
- user;
- workspace or tenant;
- daily;
- monthly;
- provider;
- tool category;
- environment;
- experimental program.

The strictest applicable limit governs.

### 4.2 Budget fields

```ts
export interface ExecutionBudget {
  currency: string;
  softLimit: number;
  approvalLimit: number;
  hardLimit: number;
  spentToDate: number;
  reservedAmount: number;
  remainingAmount: number;
  allowPaidProviders: boolean;
  allowPaidTools: boolean;
  maximumParallelExecutions: number;
  maximumRetries: number;
}
```

### 4.3 Threshold semantics

- **Below soft limit:** execution may proceed automatically if no other approval rule applies.
- **At or above soft limit:** show a warning and prefer lower-cost alternatives.
- **At or above approval limit:** require explicit approval before execution.
- **At or above hard limit:** execution must not begin or continue.

The hard limit cannot be bypassed by a model, provider adapter, retry handler, or background job.

## 5. Cost Estimate

Every non-trivial execution plan must produce a pre-execution estimate.

```ts
export interface CostEstimate {
  currency: string;
  minimum: number;
  expected: number;
  maximum: number;
  confidence: number;
  assumptions: string[];
  uncertainComponents: string[];
  breakdown: CostLineItem[];
  pricingSnapshotId: string;
  estimatedAt: string;
}
```

Each line item should identify:

- provider;
- service or model;
- role;
- execution node;
- unit type;
- estimated quantity;
- unit price;
- minimum, expected, and maximum cost;
- pricing source and effective date;
- whether the estimate is fixed, metered, or uncertain.

Estimates must use a versioned pricing snapshot. Stale or missing pricing data lowers estimate confidence and may trigger approval.

## 6. Reservation and Runtime Enforcement

Before execution, ORIGIN reserves the expected amount plus a risk buffer derived from estimate uncertainty.

A plan may start only when:

```text
reserved amount <= remaining hard budget
```

During execution, the runtime must:

1. record usage after each metered node;
2. update projected final cost;
3. compare the projection with thresholds;
4. pause before crossing the approval limit when new approval is required;
5. stop before crossing the hard limit;
6. release unused reservation after completion or cancellation.

A provider response arriving after cancellation must still be reconciled if it incurred cost.

## 7. Cheapest Sufficient Plan

Candidate plans are evaluated under the following order:

1. remove plans that violate safety, privacy, capability, or hard-budget constraints;
2. identify plans predicted to meet the required quality threshold;
3. among sufficient plans, prefer the lowest expected total cost;
4. use confidence, reliability, and latency as tie-breakers;
5. retain a higher-quality alternative when the expected improvement is material.

A plan with lower nominal model price is not cheaper if it requires more retries, extra reviewers, longer context, or expensive tools.

## 8. Marginal Value Rule

Additional execution is justified only when its predicted marginal value exceeds its incremental cost and risk.

```text
marginal value =
  expected improvement in outcome utility
  - incremental monetary cost
  - incremental latency cost
  - incremental privacy and operational risk
```

Examples of additional execution include:

- adding a reviewer;
- invoking a second independent model;
- enabling web research;
- using a larger-context model;
- running tests;
- retrying a failed node;
- extending an agent loop.

The router must record why each optional node was included.

## 9. Default Execution Classes

### 9.1 Light

Typical tasks:
- translation;
- rewriting;
- extraction;
- simple summarization;
- low-risk formatting.

Default policy:
- one inexpensive eligible service;
- no reviewer unless confidence is low;
- strict retry limit;
- free or low-cost preference.

### 9.2 Standard

Typical tasks:
- comparison;
- planning;
- coding assistance;
- technical explanation;
- ordinary research.

Default policy:
- one primary service;
- reviewer or tool use only when justified;
- normally one or two AI executions.

### 9.3 Advanced

Typical tasks:
- architecture;
- repository-wide changes;
- complex research;
- long reports;
- multi-stage analysis.

Default policy:
- explicit execution graph;
- two or three specialized roles when useful;
- mandatory cost preview;
- stronger runtime budget monitoring.

### 9.4 High Risk

Typical tasks:
- legal;
- medical;
- financial;
- contractual;
- production operations;
- sensitive personal data;
- irreversible external actions.

Default policy:
- quality and verification receive higher weight;
- consequential actions always require approval;
- uncertainty and limitations must be disclosed;
- budget approval does not imply safety approval.

## 10. Approval Categories

Approval is evaluated independently across four dimensions:

1. **Cost approval** — permission to spend within a defined amount.
2. **Data approval** — permission to disclose specified data to specified providers.
3. **Action approval** — permission to perform a consequential external operation.
4. **Scope approval** — permission for a bounded set of files, systems, recipients, or time period.

All required dimensions must be satisfied before execution.

## 11. Actions That May Proceed Automatically

Subject to policy and user settings, ORIGIN may proceed without additional approval when all of the following are true:

- the task is informational or read-only;
- the execution is below the approval threshold;
- no restricted data will be disclosed;
- no paid tool is used where paid-tool approval is required;
- no external system will be modified;
- no message, publication, payment, purchase, deployment, or deletion will occur;
- the plan remains within the approved scope.

## 12. Actions Requiring Explicit Approval

Explicit approval is required before:

- exceeding the configured approval threshold;
- first use of a paid provider or paid tool when policy requires it;
- purchasing or subscribing to a service;
- sending email, messages, notifications, or invitations;
- publishing to a website, social network, marketplace, or public repository;
- creating, modifying, merging, deploying, or deleting production resources;
- making payments, purchases, refunds, transfers, or financial commitments;
- signing, accepting, or submitting contracts or legal terms;
- deleting files, records, accounts, branches, databases, or backups;
- changing permissions, credentials, access controls, or security settings;
- transmitting confidential, regulated, or sensitive personal data to an external provider;
- submitting forms or applications with legal, financial, employment, educational, or medical consequences;
- acting as the user in a way that creates an external commitment.

Approval must state what will happen, where, using which account or provider, the estimated cost, and whether the action is reversible.

## 13. Approval Request Schema

```ts
export interface ApprovalRequest {
  id: string;
  missionId: string;
  planId: string;
  categories: Array<'cost' | 'data' | 'action' | 'scope'>;
  summary: string;
  actions: ProposedAction[];
  dataDisclosures: ProposedDisclosure[];
  estimatedCost: CostEstimate;
  maximumAuthorizedCost: number;
  reversibility: 'reversible' | 'partially_reversible' | 'irreversible';
  expiresAt: string;
  policyVersion: string;
}
```

## 14. Valid Approval

An approval is valid only when it is:

- explicit;
- informed;
- specific;
- unexpired;
- issued by an authorized actor;
- bound to the current material plan;
- recorded with timestamp and policy version.

Silence, inactivity, or an earlier unrelated approval is not consent.

## 15. Material Plan Changes

New approval is required when a plan materially changes, including:

- estimated maximum cost increases beyond the approved amount;
- a new provider or paid tool is introduced;
- additional sensitive data will be disclosed;
- a new recipient or external system is involved;
- an action becomes less reversible;
- production scope expands;
- the requested operation changes from read-only to write;
- retry or fallback behavior introduces a new risk category.

Minor changes within the approved amount and scope may proceed without renewed approval.

## 16. Approval Expiration and Revocation

Approvals expire at the earliest of:

- the stated expiration time;
- mission cancellation;
- material plan change;
- relevant credential or policy change;
- completion of the approved action;
- user revocation.

Revocation stops future actions. Already-incurred charges and completed external actions remain part of the audit record.

## 17. Paid Provider and Tool Policy

Provider registration must declare:

- pricing model;
- free-tier availability;
- billing unit;
- minimum charge;
- cancellation behavior;
- usage reporting delay;
- currency;
- pricing effective date;
- whether costs are deterministic or estimated.

Unknown, unverifiable, or stale pricing may not be treated as free. Such services require either conservative estimation or explicit approval.

## 18. Retry and Fallback Cost Rules

Retries are permitted only when:

- the failure is classified as retryable;
- retry budget remains;
- projected total cost remains within limits;
- expected recovery value is positive;
- the retry does not duplicate a completed consequential action.

Fallback to another provider must trigger re-evaluation of:

- cost;
- data eligibility;
- approval requirements;
- capability sufficiency;
- latency;
- output compatibility.

## 19. Agent Loop Limits

Autonomous loops must have explicit limits for:

- maximum steps;
- maximum elapsed time;
- maximum cost;
- maximum tool calls;
- maximum external writes;
- maximum retries;
- no-progress termination.

An agent must stop when marginal progress is insufficient, even if budget remains.

## 20. Actual Cost Reconciliation

After execution, ORIGIN must reconcile estimated and actual usage.

```ts
export interface CostReconciliation {
  estimateId: string;
  actualTotal: number;
  currency: string;
  varianceAbsolute: number;
  variancePercentage: number;
  lineItems: ActualCostLineItem[];
  unreportedUsage: boolean;
  finalizedAt?: string;
}
```

The system must explain material variance caused by:

- longer-than-estimated outputs;
- additional retries;
- fallback providers;
- tool expansion;
- provider pricing changes;
- delayed usage reports;
- currency conversion;
- estimation defects.

## 21. Cost Estimate Accuracy

Estimate accuracy is itself a monitored quality metric.

Track at least:

- mean absolute error;
- median percentage error;
- underestimation frequency;
- threshold-crossing frequency;
- provider-specific variance;
- task-class variance;
- estimate-confidence calibration.

Persistent underestimation must reduce confidence and increase the runtime reserve buffer.

## 22. User Experience Requirements

Before a chargeable or approval-gated execution, the user should see:

- recommended plan;
- expected quality and confidence;
- expected cost range;
- maximum authorized cost;
- expected duration;
- providers and tools involved at an understandable level;
- data disclosures;
- consequential actions;
- lower-cost alternative;
- higher-quality alternative;
- reason approval is required.

The default view should remain simple. Detailed token, unit-price, and node-level information belongs in an expandable audit view.

## 23. Alternative Plans

When meaningful, ORIGIN should present:

- **Economy plan** — lower expected cost with disclosed quality or coverage trade-offs;
- **Recommended plan** — cheapest plan predicted to satisfy requirements;
- **Premium plan** — higher expected quality with explicit marginal benefit and incremental cost.

A premium plan must not be presented as better when evidence does not support a material improvement.

## 24. Audit Record

The audit record must include:

- budget snapshot;
- pricing snapshot;
- estimate and assumptions;
- plan alternatives;
- selected plan and reason;
- approval requests and decisions;
- scope and expiration;
- runtime budget events;
- retries and fallbacks;
- actual usage and reconciliation;
- cancellations, revocations, and hard stops;
- policy and router versions.

## 25. Failure Modes

### 25.1 Cost cannot be estimated

Default behavior:
- block paid execution;
- offer a free or bounded alternative;
- request approval only with a conservative maximum estimate.

### 25.2 Usage reporting is delayed

Default behavior:
- reserve against the conservative maximum;
- mark reconciliation as pending;
- prevent aggregate budget reuse until sufficient certainty exists.

### 25.3 Approval service unavailable

Default behavior:
- do not perform approval-gated actions;
- preserve the pending plan;
- allow safe read-only work where separable.

### 25.4 Hard limit approached

Default behavior:
- stop optional nodes;
- finish only nodes that can safely terminate within the remaining budget;
- return a partial result with clear status;
- never silently exceed the limit.

### 25.5 Duplicate action risk

Default behavior:
- verify idempotency state before retry;
- require renewed approval when action outcome is uncertain and duplication is consequential.

## 26. Initial Zero-or-Low-Cost Implementation

The first implementation may use:

- synthetic pricing tables;
- mock provider usage;
- deterministic token estimates;
- configurable thresholds;
- simulated approvals;
- a local in-memory ledger;
- mock cost reconciliation;
- no real paid API calls;
- no real external write actions.

This stage must still implement the complete policy state machine so later provider integration does not bypass governance.

## 27. Suggested Modules

```text
packages/ai-core/src/cost/
  money.ts
  pricing-snapshot.ts
  cost-estimate.ts
  budget.ts
  reconciliation.ts

packages/ai-core/src/approval/
  approval-request.ts
  approval-decision.ts
  proposed-action.ts
  data-disclosure.ts

services/orchestrator/src/
  cost-estimator/
  budget-policy/
  reservation-ledger/
  approval-policy/
  runtime-cost-guard/
  reconciliation/
```

## 28. Acceptance Criteria

The policy implementation is acceptable when it can:

1. calculate minimum, expected, and maximum plan cost;
2. explain every cost line item;
3. apply request and aggregate budgets;
4. reserve funds before execution;
5. block hard-limit violations;
6. pause for approval at the configured threshold;
7. distinguish cost, data, action, and scope approval;
8. invalidate approval after a material plan change;
9. enforce retry and agent-loop limits;
10. reconcile estimated and actual cost;
11. expose estimate variance;
12. generate economy, recommended, and premium alternatives;
13. preserve a complete audit record;
14. operate entirely with mocks and synthetic pricing;
15. prevent external write actions without valid approval.

## 29. Representative Tests

- a free sufficient plan is selected over a paid equivalent;
- a cheaper but insufficient plan is rejected;
- adding a reviewer is rejected when marginal value is negligible;
- execution pauses before crossing the approval threshold;
- execution stops before crossing the hard limit;
- a fallback provider increases cost and triggers renewed approval;
- approval for one recipient does not authorize another recipient;
- approval expires before a delayed action;
- a write action cannot reuse read-only approval;
- a retry does not duplicate a payment or publication;
- actual cost variance is recorded and explained;
- stale pricing lowers estimate confidence;
- delayed provider usage remains reserved;
- an autonomous loop stops after no progress;
- mock mode performs no real paid or external action.

## 30. Governance

Changes to default thresholds, approval categories, or cost-selection logic must be versioned, reviewed, and tested against representative tasks. The original cost conditions may be changed only by an explicit product-owner decision recorded in the governing documentation.
