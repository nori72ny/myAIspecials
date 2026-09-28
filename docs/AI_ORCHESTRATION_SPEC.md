# ORIGIN AI Orchestration Specification

Status: Active Draft  
Governing documents:

- [PRODUCT_CONSTITUTION.md](./PRODUCT_CONSTITUTION.md)
- [SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md)

## 1. Purpose

This specification defines how ORIGIN analyzes a user request, identifies required capabilities, selects eligible AI services, assigns roles, estimates cost and quality, constructs an execution plan, applies approval policy, executes the plan, evaluates outputs, and records the routing decision.

The orchestration layer must preserve the original product objective and cost conditions. It must optimize the final outcome rather than favoring any provider, model, brand, or access method.

## 2. Scope

This document covers:

- task analysis;
- capability derivation;
- candidate eligibility;
- cost-aware and quality-aware ranking;
- role assignment;
- execution-mode selection;
- execution-plan construction;
- approval integration;
- retries, fallback, and partial completion;
- routing metadata;
- deterministic mock behavior for the first implementation slice.

This document does not define provider-specific API contracts, detailed benchmark methodology, final UX presentation, or security-retention rules. Those belong to separate specifications.

## 3. Design Principles

### 3.1 Outcome first

The unit of optimization is the final result delivered to the user.

### 3.2 Provider neutrality

Routing decisions must use declared capabilities, policy eligibility, measured performance, estimated cost, latency, and reliability. Provider names must not be embedded in task-specific business logic.

### 3.3 Cheapest sufficient plan

ORIGIN should select the lowest-cost plan that is expected to satisfy the task's quality, safety, and completion requirements.

A more expensive plan is justified only when the expected improvement is material for the task.

### 3.4 Minimum necessary orchestration

Multiple AI services must not be invoked merely because they are available. Additional roles or models require a clear purpose such as independent verification, specialist execution, critique, or synthesis.

### 3.5 Explicit uncertainty

Low confidence must alter the plan. The system may add evidence retrieval, independent review, clarification, or escalation rather than presenting unsupported certainty.

### 3.6 Safe degradation

When a preferred service is unavailable, the system should degrade to a valid alternative, reduce scope transparently, or return a partial result. It must not silently cross cost, privacy, or approval boundaries.

### 3.7 Reproducible decisions

Every plan must include enough metadata to explain why candidates were included, excluded, ranked, selected, retried, replaced, or rejected.

## 4. Core Domain Types

The following TypeScript-like schemas are normative at the conceptual level. Exact package placement may change during implementation.

### 4.1 Task analysis

```ts
export type TaskDomain =
  | "general"
  | "research"
  | "coding"
  | "business"
  | "writing"
  | "analytics"
  | "presentation"
  | "education"
  | "creative"
  | "legal"
  | "medical"
  | "financial"
  | "operations"
  | "multimodal"
  | "other";

export type ComplexityLevel = "low" | "medium" | "high" | "extreme";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type FreshnessRequirement = "none" | "historical" | "recent" | "realtime";

export interface TaskAnalysis {
  taskId: string;
  normalizedIntent: string;
  domains: TaskDomain[];
  taskType: string;
  complexity: ComplexityLevel;
  riskLevel: RiskLevel;
  freshness: FreshnessRequirement;
  requiredCapabilities: CapabilityRequirement[];
  desiredOutputs: OutputRequirement[];
  constraints: TaskConstraint[];
  requiresExternalAction: boolean;
  requiresClarification: boolean;
  clarificationQuestions: string[];
  confidence: number;
  analyzerVersion: string;
}
```

### 4.2 Capability requirement

```ts
export type RequirementStrength = "required" | "preferred" | "optional";

export interface CapabilityRequirement {
  capabilityId: string;
  strength: RequirementStrength;
  minimumLevel?: number;
  reason: string;
}
```

Capabilities may include, without being limited to:

- general reasoning;
- long-context analysis;
- web research;
- citation generation;
- code generation;
- repository editing;
- test execution;
- browser automation;
- structured output;
- image understanding;
- image generation;
- document generation;
- spreadsheet analysis;
- slide creation;
- tool use;
- autonomous multi-step execution;
- multilingual communication;
- low-latency response;
- local or private execution.

### 4.3 Constraints

```ts
export interface TaskConstraint {
  type:
    | "budget"
    | "latency"
    | "privacy"
    | "provider"
    | "data-residency"
    | "format"
    | "tool"
    | "approval"
    | "access-method"
    | "other";
  operator: "equals" | "not-equals" | "lte" | "gte" | "contains" | "excludes";
  value: unknown;
  source: "user" | "organization" | "system" | "inferred";
  hard: boolean;
}
```

Hard constraints must never be violated by ranking logic.

### 4.4 Candidate profile

```ts
export interface OrchestrationCandidate {
  serviceId: string;
  modelId?: string;
  accessMethod: "api" | "sdk" | "cli" | "browser" | "desktop" | "connector" | "local";
  capabilities: Record<string, number>;
  benchmarkProfileId?: string;
  availability: "available" | "degraded" | "unavailable" | "unknown";
  lifecycleStatus: "sandbox" | "shadow" | "limited" | "approved" | "preferred" | "restricted" | "deprecated";
  estimatedCost: CostEstimate;
  estimatedLatencyMs: number;
  reliabilityScore: number;
  policyTags: string[];
}
```

### 4.5 Execution role

```ts
export type ExecutionRoleType =
  | "lead"
  | "researcher"
  | "planner"
  | "specialist"
  | "coder"
  | "tool-operator"
  | "critic"
  | "fact-checker"
  | "safety-reviewer"
  | "synthesizer"
  | "editor"
  | "presenter";

export interface ExecutionRole {
  roleId: string;
  type: ExecutionRoleType;
  objective: string;
  requiredCapabilities: CapabilityRequirement[];
  independenceGroup?: string;
  mandatory: boolean;
}
```

### 4.6 Execution mode

```ts
export type ExecutionMode =
  | "single"
  | "reviewed"
  | "parallel"
  | "deliberation";
```

### 4.7 Execution plan

```ts
export interface ExecutionPlan {
  planId: string;
  taskId: string;
  mode: ExecutionMode;
  nodes: ExecutionNode[];
  edges: ExecutionEdge[];
  estimatedCost: CostEstimate;
  estimatedLatencyMs: number;
  predictedQuality: number;
  predictedConfidence: number;
  budgetStatus: "within-budget" | "warning" | "approval-required" | "blocked";
  approvalRequirements: ApprovalRequirement[];
  alternatives: PlanAlternative[];
  rationale: string[];
  policyVersion: string;
  routerVersion: string;
  createdAt: string;
}
```

## 5. Request Analysis

### 5.1 Analysis stages

The Task Analyzer should process a request in the following order:

1. normalize the request without changing user intent;
2. identify the primary task and requested deliverables;
3. detect domains and subdomains;
4. identify hard constraints;
5. estimate complexity;
6. estimate risk and consequence;
7. determine freshness requirements;
8. derive required and preferred capabilities;
9. identify whether external actions are requested;
10. determine whether clarification is required;
11. produce confidence and analysis metadata.

### 5.2 Clarification policy

Clarification is required when proceeding would create a material risk of:

- producing the wrong deliverable;
- spending beyond a likely budget boundary;
- exposing restricted information;
- taking an irreversible or consequential action;
- selecting incompatible assumptions;
- failing because required input is missing.

Clarification should not be used for minor ambiguity that can be handled through reversible assumptions. Such assumptions must be recorded.

### 5.3 Complexity assessment

Complexity should consider:

- number of distinct objectives;
- depth of reasoning;
- amount and diversity of source material;
- number of tools or systems involved;
- dependency depth;
- execution duration;
- need for iterative refinement;
- need for specialist knowledge;
- expected output size and structure.

### 5.4 Risk assessment

Risk is separate from complexity. A short request can be high risk.

Risk signals include:

- legal, medical, financial, contractual, or safety consequences;
- production-system changes;
- public communication;
- data deletion;
- payments or purchases;
- identity, privacy, or confidential data;
- account or permission changes;
- inability to reverse an action;
- high reputational impact.

## 6. Capability Derivation

Capabilities must be derived from the task rather than from a preferred service.

Example:

```text
Task: Diagnose and fix a failing repository build

Required capabilities:
- repository inspection
- code reasoning
- code editing
- test execution
- structured change reporting

Preferred capabilities:
- framework-specific expertise
- independent code review
- low-cost local execution
```

The registry must support future capabilities without requiring a redesign of the routing algorithm.

## 7. Candidate Eligibility

Eligibility filtering occurs before ranking.

### 7.1 Mandatory exclusions

A candidate must be excluded when any of the following applies:

- it lacks a required capability;
- it is unavailable;
- its lifecycle status does not permit production use;
- it violates a hard provider or access-method constraint;
- it violates privacy, residency, retention, or data-class policy;
- it cannot produce the required output format;
- its estimated minimum cost exceeds the hard limit;
- its use requires an approval that cannot be obtained;
- it is deprecated without an approved exception;
- its reliability is below the task's minimum threshold.

### 7.2 Conditional eligibility

A degraded, limited, shadow, or sandbox candidate may be used only under explicit policy.

Examples:

- shadow candidates may receive a duplicate, non-authoritative task for evaluation;
- limited candidates may serve a controlled percentage of low-risk requests;
- degraded candidates may be used when no healthier eligible candidate exists and the failure mode is acceptable;
- sandbox candidates must not receive production-sensitive data.

### 7.3 Exclusion record

Every excluded candidate should produce an exclusion code and human-readable reason.

```ts
export interface CandidateExclusion {
  serviceId: string;
  modelId?: string;
  code: string;
  reason: string;
  policySource: string;
}
```

## 8. Candidate Scoring

Only eligible candidates are scored.

### 8.1 Score dimensions

The initial score should include:

- capability fit;
- domain benchmark performance;
- task-type benchmark performance;
- workflow compatibility;
- reliability;
- latency fit;
- cost efficiency;
- safety and policy confidence;
- historical production performance;
- diversity value when used in a multi-model plan.

### 8.2 Normalized score

```text
Candidate Score =
  capabilityFitWeight * capabilityFit
+ benchmarkWeight * benchmarkPerformance
+ reliabilityWeight * reliability
+ latencyWeight * latencyFit
+ costWeight * costEfficiency
+ safetyWeight * policyConfidence
+ productionWeight * productionPerformance
+ diversityWeight * diversityValue
```

Weights must be policy-driven and task-sensitive.

For example:

- low-risk rewriting increases cost and latency weights;
- contract review increases safety, reliability, and domain-performance weights;
- realtime interaction increases latency weight;
- creative ideation may increase diversity weight;
- production code repair increases execution and test-performance weights.

### 8.3 Cost efficiency

Cost efficiency must not be calculated as "cheapest wins." It should estimate quality delivered per incremental unit of cost.

```text
Marginal Value = Expected Quality Gain / Incremental Cost
```

A higher-cost candidate should be selected when:

- the cheaper candidate is unlikely to satisfy the minimum quality target;
- the task is high risk and the quality difference is material;
- the additional candidate provides independent verification;
- the additional cost remains within policy or receives approval.

### 8.4 Missing benchmark data

A candidate with insufficient evidence must receive an uncertainty penalty. New services must not be ranked as preferred solely from vendor claims.

## 9. Role Assignment

Roles describe work, not providers.

### 9.1 Role generation

The planner derives roles from task structure.

Examples:

#### Simple rewriting

```text
Lead / Editor
```

#### Research report

```text
Researcher
Analyst
Fact Checker
Synthesizer / Editor
```

#### Repository change

```text
Planner
Coder
Test Operator
Independent Reviewer
Final Reporter
```

#### High-risk analysis

```text
Domain Specialist
Evidence Reviewer
Risk Reviewer
Synthesizer
```

### 9.2 Role minimization

A role should exist only when it has a distinct objective or independence requirement.

The planner should merge roles when one execution can safely satisfy both objectives at lower cost.

### 9.3 Independence requirements

Independent review must avoid correlated failure where practical.

Independence may require:

- a different provider;
- a different model family;
- a separate prompt context;
- independent evidence retrieval;
- no access to the first answer until an initial judgment is recorded.

Independence is especially important for factual verification, safety review, and high-risk decisions.

## 10. Execution Mode Selection

### 10.1 Single

Use when one candidate is expected to meet the required quality and risk thresholds.

Typical conditions:

- low or medium complexity;
- low risk;
- no independent verification requirement;
- strong benchmark evidence;
- narrow deliverable;
- limited budget.

### 10.2 Reviewed

Use when one service creates the primary output and a second role reviews or verifies it.

Typical conditions:

- medium or high complexity;
- material factual or technical risk;
- review provides high marginal value;
- independent validation is desirable but full parallel execution is unnecessary.

### 10.3 Parallel

Use when multiple independent attempts or specialist workstreams improve coverage or reduce uncertainty.

Typical conditions:

- multiple domains;
- competing valid approaches;
- broad research;
- need for independent answers;
- decomposable workstreams;
- evaluation can compare outputs objectively.

Parallel execution must have a defined comparison and synthesis step.

### 10.4 Deliberation

Use for highly complex tasks where iterative critique and revision are expected to materially improve the result.

Typical conditions:

- high or extreme complexity;
- strategic or architectural decisions;
- conflicting evidence;
- long-horizon planning;
- high-value output;
- sufficient budget and latency allowance.

Deliberation must be bounded by:

- maximum rounds;
- maximum nodes;
- cost ceiling;
- time ceiling;
- stopping criteria;
- approval policy.

It must never become an uncontrolled agent loop.

## 11. Execution Graph Construction

The execution plan is a directed acyclic graph unless an explicitly bounded revision loop is represented as versioned nodes.

### 11.1 Node types

```ts
export type ExecutionNodeType =
  | "analyze"
  | "retrieve"
  | "generate"
  | "tool"
  | "review"
  | "verify"
  | "synthesize"
  | "edit"
  | "approval"
  | "deliver";
```

### 11.2 Node definition

```ts
export interface ExecutionNode {
  nodeId: string;
  type: ExecutionNodeType;
  role: ExecutionRole;
  assignedCandidate?: OrchestrationCandidate;
  inputRefs: string[];
  outputContract: OutputContract;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  estimatedCost: CostEstimate;
  status: "planned" | "waiting" | "running" | "succeeded" | "failed" | "skipped" | "blocked";
}
```

### 11.3 Plan validation

Before execution, the planner must validate:

- every mandatory role is assigned;
- every required capability is covered;
- all dependencies resolve;
- no hard policy is violated;
- the graph has no unbounded cycle;
- cost and latency estimates are available or marked uncertain;
- required approvals are represented;
- output contracts are compatible;
- fallback paths exist for critical nodes where practical.

## 12. Cost and Budget Integration

The planner consumes a budget policy rather than defining financial thresholds internally.

### 12.1 Required estimates

The plan should estimate:

- input usage;
- output usage;
- tool charges;
- search or retrieval charges;
- compute charges;
- expected retries;
- review and synthesis charges;
- uncertainty range;
- currency and price timestamp.

### 12.2 Budget states

- `within-budget`: estimated maximum remains below the normal threshold;
- `warning`: within the hard limit but materially above the preferred budget;
- `approval-required`: policy requires explicit consent before execution;
- `blocked`: hard limit or policy boundary prevents execution.

### 12.3 Alternative plans

When useful, the planner should generate:

- a recommended plan;
- a lower-cost plan;
- a higher-quality plan.

Alternatives must explain the trade-off, not merely show different prices.

## 13. Approval Integration

Approval is part of the execution graph.

Approval may be required for:

- exceeding a configured cost threshold;
- first use of a paid provider or tool;
- creating a new subscription or commercial commitment;
- sending messages or publishing content;
- payments or purchases;
- deleting or overwriting data;
- changing production systems;
- exposing sensitive data to an external service;
- high-impact legal, medical, financial, or contractual actions;
- any organization-specific consequential action.

Approval must identify:

- the exact action;
- estimated cost;
- provider or destination;
- data involved;
- reversibility;
- relevant risks;
- what happens if approval is denied.

The system must not treat approval of one action as blanket approval for unrelated actions.

## 14. Retry Policy

Retries must be bounded and cost-aware.

### 14.1 Retryable failures

Examples:

- transient network failure;
- rate limit with an acceptable retry window;
- provider timeout;
- malformed structured output that can be repaired cheaply;
- temporary tool unavailability;
- incomplete response where continuation is supported.

### 14.2 Non-retryable failures

Examples:

- authentication failure requiring human action;
- policy rejection;
- unsupported capability;
- hard budget violation;
- invalid or unsafe request;
- deterministic provider incompatibility;
- repeated failure beyond the retry budget.

### 14.3 Retry budget

Each node must define:

- maximum attempts;
- maximum additional cost;
- maximum elapsed time;
- backoff policy;
- whether candidate replacement is permitted.

## 15. Fallback Policy

Fallback selection repeats eligibility checks. A fallback is not allowed to bypass the original task constraints.

Fallback order should consider:

1. equivalent approved model from the same service;
2. equivalent approved service with similar benchmark evidence;
3. lower-capability service that can return a reduced-scope result;
4. partial completion with explicit limitations;
5. user clarification or manual intervention.

The system must disclose material plan changes when they affect quality, cost, privacy, latency, or deliverable scope.

## 16. Evaluation and Synthesis Handoff

Orchestration is responsible for delivering structured outputs to the evaluation pipeline.

Each result should include:

- node and role identity;
- service and model identity;
- prompt or task version reference;
- structured output;
- evidence references;
- declared uncertainty;
- tool results;
- usage and actual cost;
- latency;
- warnings and errors.

The evaluator may:

- accept the output;
- request targeted repair;
- trigger independent verification;
- select among parallel outputs;
- reject an output;
- escalate to a safer plan;
- pass accepted outputs to synthesis.

The evaluator must not silently add an expensive execution path without running budget and approval checks again.

## 17. Stopping Criteria

Execution should stop when any of the following applies:

- all mandatory output contracts are satisfied;
- the quality target is met with sufficient confidence;
- further execution has low expected marginal value;
- budget or time limit is reached;
- required approval is denied or expires;
- a hard policy violation is detected;
- the task becomes impossible with available candidates;
- the user cancels the mission.

A stopped plan may still return a partial result when safe and useful.

## 18. Routing Decision Record

Every plan must create a routing decision record.

```ts
export interface RoutingDecision {
  decisionId: string;
  taskId: string;
  analysis: TaskAnalysis;
  eligibleCandidates: CandidateScoreRecord[];
  exclusions: CandidateExclusion[];
  selectedPlanId: string;
  selectionReasons: string[];
  rejectedAlternatives: PlanAlternativeDecision[];
  budgetSnapshot: unknown;
  approvalSnapshot: unknown;
  benchmarkSnapshotIds: string[];
  assumptions: string[];
  warnings: string[];
  routerVersion: string;
  policyVersion: string;
  createdAt: string;
}
```

The record should support:

- user-facing explanation;
- debugging;
- audit;
- benchmark feedback;
- cost reconciliation;
- regression analysis;
- future routing improvement.

Sensitive prompts, credentials, or unnecessary personal data must not be copied into routing metadata.

## 19. Determinism and Policy Versioning

The initial mock planner should be deterministic for the same:

- normalized task analysis;
- candidate registry snapshot;
- benchmark snapshot;
- cost policy;
- approval policy;
- router version.

Randomized exploration, A/B routing, and learning-based policies must be explicit, versioned, and auditable.

## 20. Initial Mock Implementation

The first implementation should not require paid AI execution.

### 20.1 Inputs

- user request;
- local model and service catalog fixture;
- capability registry fixture;
- benchmark fixture;
- cost policy fixture;
- approval policy fixture.

### 20.2 Outputs

- task analysis;
- eligible and excluded candidates;
- score breakdown;
- selected roles;
- selected execution mode;
- execution graph;
- predicted cost, latency, quality, and confidence;
- budget and approval status;
- lower-cost and higher-quality alternatives;
- complete routing decision record.

### 20.3 Suggested package boundaries

```text
packages/ai-core/src/
  task-analysis.ts
  capability.ts
  candidate.ts
  role.ts
  execution-plan.ts
  routing-decision.ts

services/orchestrator/src/
  task-analyzer/
  capability-resolver/
  candidate-filter/
  candidate-ranker/
  role-planner/
  execution-planner/
  retry-planner/
  routing-recorder/
```

The implementation must first inspect existing repository types and reuse compatible definitions.

## 21. Acceptance Criteria

This specification is considered implemented for the first slice when:

1. a request can be analyzed into a versioned `TaskAnalysis`;
2. required capabilities and hard constraints are represented explicitly;
3. ineligible candidates are excluded with reasons;
4. eligible candidates receive an explainable score breakdown;
5. a recommended execution mode is selected;
6. roles are assigned independently of provider names;
7. a validated execution graph is produced;
8. budget and approval states are calculated;
9. at least one lower-cost or higher-quality alternative can be produced when applicable;
10. retry and fallback policies are represented;
11. a complete routing decision record is stored or returned;
12. deterministic unit tests cover representative task classes;
13. no paid provider is required to run the test suite.

## 22. Representative Test Scenarios

The initial test suite should include at least:

- a low-risk text rewrite selecting a single low-cost candidate;
- a current-information research task requiring retrieval and citation capability;
- a repository repair task selecting coding, test, and review roles;
- a high-risk contract analysis requiring independent review and approval-aware behavior;
- a strict low-budget task producing a reduced plan;
- a provider outage causing a valid fallback;
- a missing required capability causing a blocked plan;
- a high-cost deliberation plan requiring approval;
- a new unbenchmarked candidate receiving an uncertainty penalty;
- a task with sensitive data excluding ineligible external providers.

## 23. Non-Goals for the First Slice

The first slice will not:

- automatically subscribe to external services;
- invoke every registered AI;
- make irreversible external changes;
- learn routing weights directly from production without review;
- rely on one universal leaderboard;
- claim precise quality predictions without benchmark evidence;
- implement an unbounded autonomous loop;
- hide material cost or fallback decisions from the user.

## 24. Next Specification

The next document should be `docs/BENCHMARK_SPEC.md`.

It will define the evidence used by candidate scoring, including domain taxonomies, benchmark task formats, objective evaluators, model-based evaluators, human review, confidence treatment, workflow ranking, shadow evaluation, and promotion rules.
