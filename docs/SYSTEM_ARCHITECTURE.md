# ORIGIN System Architecture

Status: Active Draft  
Governing document: [PRODUCT_CONSTITUTION.md](./PRODUCT_CONSTITUTION.md)  
Specification index: [PRODUCT_SPEC_INDEX.md](./PRODUCT_SPEC_INDEX.md)

## 1. Purpose

This document defines the target system architecture for ORIGIN: a provider-neutral, cost-aware AI orchestration platform that analyzes a user mission, assembles the best available AI workflow, executes it safely, evaluates competing outputs, synthesizes a final result, and presents that result in a clear and auditable form.

The architecture must preserve the original product objective, purpose, and cost conditions while remaining extensible to current and future AI services.

## 2. Architectural Outcomes

The architecture must make the following outcomes possible:

1. A user can submit a mission without selecting a provider or model.
2. ORIGIN can classify the mission by domain, complexity, risk, freshness, tools, and required capabilities.
3. ORIGIN can select one AI, several independent AIs, or a role-based AI team.
4. ORIGIN can estimate quality, latency, and cost before execution.
5. ORIGIN can require approval before consequential or over-budget actions.
6. ORIGIN can compare, verify, and synthesize candidate outputs.
7. ORIGIN can show conclusions first while preserving evidence, uncertainty, and auditability.
8. New providers and AI services can be introduced without changing the orchestration core.
9. Model and workflow performance can be measured by use case rather than by one universal ranking.
10. The system can improve routing decisions over time without silently changing fixed product policy.

## 3. Architecture Principles

### 3.1 Mission-first

The unit of work is a `Mission`, not a chat message. A mission may contain one request or a multi-step objective with constraints, files, tools, budget, and completion criteria.

### 3.2 Outcome-first

The final result and mission completion state are the primary units of value. Provider identity is operational metadata, not the product outcome.

### 3.3 Provider-neutral

The orchestration domain depends only on normalized provider and model contracts. Provider-specific SDKs, authentication, streaming formats, tool schemas, and errors are isolated behind adapters.

### 3.4 Cost-aware by default

Every executable plan must include an estimated cost, a budget status, and at least one explanation of why the selected plan offers sufficient value.

### 3.5 Progressive complexity

Simple missions use the smallest sufficient workflow. Additional models, reviewers, tools, and verification stages are added only when predicted benefit justifies their cost and latency.

### 3.6 Evidence-aware

Claims, sources, verification status, conflicts, and uncertainty must remain traceable through the pipeline.

### 3.7 Safe and reversible

External side effects, paid operations, destructive actions, publishing, sending, and production changes require explicit policy checks and, where applicable, user approval.

### 3.8 Evolvable but governed

Model catalogs, capability definitions, benchmark suites, routing policies, and evaluators are versioned. Operational learning may update rankings, but it must not rewrite the product constitution.

## 4. System Context

```text
┌───────────────────────────────────────────────────────────────────┐
│                           ORIGIN                                  │
│                                                                   │
│  Mission Intake → Analysis → Planning → Execution → Evaluation    │
│       → Verification → Synthesis → Result Presentation            │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
       │                │                  │                │
       ▼                ▼                  ▼                ▼
 AI providers      Search/data tools   User resources   Audit/metrics
 and agents        and connectors      and files        and benchmarks
```

External actors and systems include:

- end users;
- administrators and benchmark reviewers;
- AI providers and agent services;
- web search and data providers;
- code repositories, file stores, calendars, email, and other connectors;
- billing and usage-reporting sources;
- observability and incident-management systems.

## 5. Primary Bounded Contexts

### 5.1 Mission Context

Responsibilities:

- receive and normalize user intent;
- preserve original request and constraints;
- manage mission status and lifecycle;
- define completion criteria;
- associate files, tools, approvals, and results.

Core entities:

```typescript
interface Mission {
  id: string;
  userId: string;
  title?: string;
  originalRequest: string;
  normalizedRequest?: string;
  constraints: MissionConstraints;
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
}
```

### 5.2 Task Intelligence Context

Responsibilities:

- classify domain and task types;
- estimate complexity and risk;
- identify freshness and tool requirements;
- derive required capabilities;
- identify ambiguity and missing information;
- recommend execution intensity.

Output:

```typescript
interface TaskAnalysis {
  analysisVersion: string;
  taskTypes: string[];
  domains: string[];
  complexity: "low" | "medium" | "high" | "extreme";
  risk: "low" | "medium" | "high" | "critical";
  requiresCurrentInformation: boolean;
  requiresTools: boolean;
  requiredCapabilities: CapabilityRequirement[];
  expectedDeliverables: string[];
  ambiguity: AnalysisAmbiguity[];
  recommendedMode: ExecutionMode;
}
```

### 5.3 AI Catalog Context

Responsibilities:

- maintain AI service and model profiles;
- normalize service categories and access methods;
- maintain declared and measured capabilities;
- maintain availability, restrictions, and lifecycle status;
- expose versioned catalog snapshots to routing.

The initial catalog includes ChatGPT, Claude, Gemini, Codex, Claude Code, Manus, Perplexity, Genspark, other current AI services, and future systems.

The catalog does not imply equal comparability. General assistants, coding agents, research engines, autonomous agents, artifact generators, image systems, video systems, and specialized AI services may have different benchmark families and execution contracts.

### 5.4 Benchmark and Performance Context

Responsibilities:

- define benchmark domains and tasks;
- execute static, tool-use, repository, artifact, agentic, and production benchmarks;
- collect objective, evaluator-model, human, and user-outcome signals;
- calculate confidence and sample sufficiency;
- rank models and complete workflows by domain and conditions;
- manage sandbox, shadow, limited, approved, preferred, restricted, and retired states.

### 5.5 Cost and Policy Context

Responsibilities:

- estimate provider, tool, storage, and execution costs;
- apply per-request and aggregate budgets;
- compare predicted quality gain with incremental cost;
- determine warning, approval-required, or blocked status;
- enforce restrictions on paid, destructive, external, or sensitive operations;
- reconcile actual cost after execution.

### 5.6 Orchestration Context

Responsibilities:

- filter eligible candidates;
- score and rank candidate models and workflows;
- assign roles;
- build execution graphs;
- select single, reviewed, parallel, or deliberation modes;
- handle dependency order, retries, timeouts, and fallbacks;
- coordinate execution without embedding provider-specific logic.

### 5.7 Provider Runtime Context

Responsibilities:

- connect to AI providers and AI services;
- normalize request, response, streaming, structured output, and tool calls;
- report usage, cost, latency, and provider errors;
- expose health and rate-limit status;
- isolate credentials and provider-specific policies.

### 5.8 Evaluation and Verification Context

Responsibilities:

- score instruction adherence, correctness, completeness, clarity, safety, and usefulness;
- run objective checks such as tests, lint, type checking, schema validation, citation checks, and calculations;
- extract claims and identify conflicts;
- distinguish verified, supported, disputed, and unverified content;
- determine whether more execution is justified.

### 5.9 Synthesis Context

Responsibilities:

- combine candidate outputs without averaging them;
- preserve supported claims and useful alternatives;
- resolve or explicitly expose conflicts;
- remove unsupported statements;
- adapt detail, terminology, and format to the user and task;
- produce a structured final-result model.

### 5.10 Result Experience Context

Responsibilities:

- render conclusion-first results;
- show next actions and key warnings;
- present evidence and uncertainty progressively;
- provide task-specific layouts;
- expose expert audit detail without overwhelming general users;
- meet accessibility and responsive-design requirements.

### 5.11 Governance and Audit Context

Responsibilities:

- store versioned routing decisions;
- record approvals and policy outcomes;
- retain provider usage and execution metadata;
- preserve benchmark provenance;
- support replay and post-incident analysis;
- prevent silent policy changes.

## 6. Logical Component Model

```text
Mission API / UI
   │
   ▼
Mission Service
   │
   ▼
Task Analyzer
   │
   ├──────────────► Clarification Policy
   │
   ▼
Execution Planner
   ├── Model Registry
   ├── Capability Registry
   ├── Benchmark Store
   ├── Cost Estimator
   ├── Budget Policy
   └── Approval Policy
   │
   ▼
Execution Graph
   │
   ▼
Orchestration Runtime
   ├── Provider Adapters
   ├── Tool Adapters
   ├── Retry/Fallback Controller
   └── Usage Collector
   │
   ▼
Candidate Results
   │
   ▼
Evaluation Pipeline
   ├── Objective Validators
   ├── Claim Extractor
   ├── Evidence Verifier
   ├── Conflict Analyzer
   └── Quality Evaluators
   │
   ▼
Synthesis Engine
   │
   ▼
Result Model
   ├── Conclusion
   ├── Recommended Actions
   ├── Evidence
   ├── Uncertainty
   ├── Alternatives
   └── Audit Detail
```

## 7. Request Lifecycle

### 7.1 Intake

1. Receive the original request.
2. Attach user-selected files, data sources, tool permissions, and explicit constraints.
3. Create a mission record.
4. Apply input limits, malware checks, and data classification where required.

### 7.2 Analysis

1. Detect task domains and expected deliverables.
2. Estimate complexity, risk, and freshness requirements.
3. Identify tools and data access required.
4. Determine whether clarification is essential or execution can proceed with explicit assumptions.
5. Generate capability requirements.

### 7.3 Planning

1. Load a versioned model-catalog snapshot.
2. Exclude unavailable, restricted, incompatible, or unsafe candidates.
3. Score remaining candidates by capability fit, measured performance, reliability, latency, and cost.
4. construct one or more candidate workflows.
5. estimate cost, time, quality, and confidence.
6. apply approval and budget policies.
7. present an execution preview where required.

### 7.4 Execution

1. Freeze the approved execution plan and its policy versions.
2. Dispatch nodes according to execution-graph dependencies.
3. collect normalized outputs, tool results, usage, latency, and errors.
4. apply bounded retries and fallbacks.
5. stop or request approval if actual execution materially exceeds limits.

### 7.5 Evaluation

1. run objective validators first when possible;
2. score each candidate against the mission and deliverable criteria;
3. extract claims and evidence;
4. identify agreements, conflicts, omissions, and unsupported content;
5. decide whether the available quality is sufficient or another bounded execution is justified.

### 7.6 Synthesis

1. select the strongest supported content by criterion;
2. preserve meaningful alternatives and trade-offs;
3. resolve conflicts using evidence and objective checks;
4. state unresolved uncertainty explicitly;
5. create a task-specific final-result structure.

### 7.7 Delivery

1. show the conclusion and recommended actions first;
2. show key evidence, warnings, and confidence;
3. allow progressive expansion into methods, sources, model roles, costs, and audit history;
4. record user feedback and outcome signals where permitted.

### 7.8 Reconciliation

1. reconcile estimated and actual cost;
2. record latency, success, retries, and failures;
3. update performance observations without immediately rewriting approved benchmark status;
4. emit audit and observability events.

## 8. Execution Modes

```typescript
type ExecutionMode =
  | "single"
  | "reviewed"
  | "parallel"
  | "deliberation";
```

### Single

One primary AI or service executes the task. Used when one candidate is sufficient and incremental verification has low expected value.

### Reviewed

One primary executor produces the result and one separate reviewer checks it. Used for moderate complexity, lower-cost quality improvement, and many coding or structured-output tasks.

### Parallel

Two or more independent candidates execute without seeing one another's initial outputs. Used when diversity of reasoning or solution search is valuable.

### Deliberation

A controlled role-based graph is used, for example researcher → architect → critic → verifier → synthesizer. Used only when complexity, risk, or expected quality gain justifies the extra cost and latency.

## 9. Execution Graph

Every plan is represented as a directed acyclic graph unless a future specification explicitly permits bounded iterative loops.

```typescript
interface ExecutionGraph {
  id: string;
  mode: ExecutionMode;
  nodes: ExecutionNode[];
  edges: ExecutionEdge[];
  budget: ExecutionBudget;
  estimatedCost: number;
  estimatedLatencyMs: number;
  predictedQuality: number;
  predictedConfidence: number;
  approvalStatus: ApprovalStatus;
}

interface ExecutionNode {
  id: string;
  role: string;
  kind: "ai" | "tool" | "validator" | "synthesizer";
  candidateId?: string;
  dependsOn: string[];
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  fallbackCandidateIds: string[];
}
```

The graph must be inspectable before execution and reconstructable after execution.

## 10. Provider Adapter Boundary

```typescript
interface AIProviderAdapter {
  providerId: string;
  discoverModels(): Promise<ModelDefinition[]>;
  getCapabilities(modelId: string): Promise<ModelCapabilities>;
  estimateCost(request: ModelExecutionRequest): Promise<CostEstimate>;
  execute(request: ModelExecutionRequest): Promise<ModelExecutionResponse>;
  checkHealth(): Promise<ProviderHealth>;
}
```

Provider adapters must normalize:

- authentication errors;
- rate limits;
- timeouts;
- safety refusals;
- structured-output failures;
- tool-call requests and results;
- token or unit usage;
- estimated and actual cost;
- model deprecation and aliases.

The orchestration context must never depend directly on a provider SDK.

## 11. Data and Persistence Model

The minimum persistent records are:

- mission;
- task analysis;
- model-catalog version;
- capability-registry version;
- benchmark-policy version;
- routing-policy version;
- execution plan and graph;
- approval decisions;
- normalized provider requests and responses, subject to retention policy;
- candidate results;
- evaluator results;
- claim and evidence records;
- final result;
- estimated and actual cost;
- audit events;
- user feedback and outcome signals, subject to consent.

Large prompts, files, provider outputs, and artifacts should be stored in object storage with references in the transactional database. Secrets must never be persisted in mission records.

## 12. Event Model

The architecture uses domain events to decouple mission progression from provider execution and evaluation.

Core events include:

```text
MissionCreated
MissionAnalyzed
ClarificationRequired
ExecutionPlanProposed
ApprovalRequired
ExecutionPlanApproved
ExecutionStarted
ExecutionNodeStarted
ExecutionNodeCompleted
ExecutionNodeFailed
BudgetWarningRaised
EvaluationCompleted
VerificationConflictDetected
SynthesisCompleted
ResultPublished
CostReconciled
BenchmarkObservationRecorded
```

Events must include mission ID, correlation ID, causation ID, timestamp, schema version, actor, and policy-version metadata.

## 13. Failure Handling

### 13.1 Failure classes

- transient provider failure;
- rate limiting;
- provider outage;
- invalid structured output;
- tool failure;
- safety or policy refusal;
- budget overrun;
- unsupported capability;
- evidence failure;
- synthesis failure;
- internal invariant violation.

### 13.2 Retry rules

Retries must be bounded, use backoff, and account for cost. Non-idempotent external actions must not be retried automatically unless the adapter supplies an idempotency guarantee.

### 13.3 Fallback rules

Fallback candidates must be selected during planning where possible. Runtime fallback may not violate data-classification, provider, budget, or approval policies.

### 13.4 Graceful degradation

When a complete plan cannot be executed, ORIGIN should return the strongest valid partial result with explicit disclosure of missing verification, unavailable sources, or reduced confidence.

## 14. Safety and Approval Boundaries

The execution planner must identify consequential actions before runtime.

Approval is generally required for:

- spending above configured thresholds;
- starting paid subscriptions or contracts;
- sending email or messages;
- publishing content;
- creating public resources;
- deleting data;
- changing production systems;
- financial transactions;
- legal commitments;
- sending sensitive information to an external provider;
- materially expanding the original scope.

Approval decisions must be scoped to a specific plan or clearly bounded class of actions. Approval is not a permanent waiver of policy.

## 15. Observability

Every execution must expose:

- mission and correlation IDs;
- plan and policy versions;
- selected roles, services, and models;
- estimated versus actual cost;
- estimated versus actual latency;
- retries and fallback decisions;
- provider and tool errors;
- evaluation and verification scores;
- synthesis provenance;
- approval checkpoints;
- final mission status.

Logs, traces, metrics, and audit records have different retention and access requirements and must not be treated as one undifferentiated log stream.

## 16. Deployment Boundaries

The target architecture may be deployed as a modular monolith during early development and split into services only when operational needs justify it.

Initial recommended deployable boundaries:

```text
apps/web
services/mission-engine
services/orchestrator
services/provider-runtime
services/evaluation
services/benchmark
```

Shared contracts belong in packages, not copied across services.

```text
packages/ai-core
packages/orchestration-contracts
packages/result-contracts
packages/provider-contracts
packages/policy-contracts
packages/observability
```

Early implementation should prefer fewer deployables, in-process events, and deterministic mocks to minimize cost and complexity. Interfaces and domain boundaries should still be preserved so later extraction does not require rewriting the core model.

## 17. Initial Low-Cost Implementation Slice

The first architecture slice does not require broad paid-provider execution.

It must support:

1. a deterministic task-analysis mock;
2. a versioned AI service catalog;
3. a capability registry;
4. rule-based eligibility filtering;
5. cost and quality estimation from fixture data;
6. generation of single, reviewed, parallel, and deliberation plan previews;
7. approval-state calculation;
8. a mock execution graph;
9. a structured mock final result;
10. an audit view showing why the plan was selected.

This slice validates the architecture, contracts, UI, and product behavior before significant API spending.

## 18. Initial Repository Mapping

Target placement, subject to reconciliation with existing code:

```text
packages/
  ai-core/
    src/
      mission.ts
      task-analysis.ts
      service-profile.ts
      model-profile.ts
      capabilities.ts
      benchmark.ts
      execution-plan.ts
      evaluation.ts
      result.ts
      audit.ts

services/
  orchestrator/
    src/
      task-analyzer/
      candidate-filter/
      model-router/
      role-assignment/
      cost-estimator/
      execution-planner/
      approval-policy/
      runtime/

  evaluation/
    src/
      evaluators/
      validators/
      claim-extraction/
      evidence-verification/
      conflict-analysis/
      synthesis/
```

Existing repository components and types must be inspected and reused. No duplicate architecture should be introduced merely to match this document.

## 19. Architecture Decision Rules

A new architecture decision is acceptable only when it:

- preserves the product constitution;
- improves mission outcome, safety, extensibility, or cost efficiency;
- has explicit operational ownership;
- includes observability and failure behavior;
- does not couple the domain to a provider implementation;
- includes a migration or rollback path where applicable;
- documents impact on budget, security, privacy, and user experience.

## 20. Non-goals for the First Implementation

The first implementation will not:

- integrate every available AI service;
- run all models for every request;
- automatically purchase subscriptions;
- autonomously promote an unverified provider to preferred status;
- expose private chain-of-thought content;
- perform consequential external actions without policy checks;
- introduce microservices solely for architectural appearance;
- claim world-leading quality without comparative evidence.

## 21. Completion Criteria for This Specification

This architecture is sufficiently implemented for the first product increment when:

- all central domain contracts exist;
- one mission can be analyzed into a deterministic plan;
- plan selection is provider-neutral and cost-aware;
- the plan can be shown before execution;
- mock candidate results can be evaluated and synthesized;
- the result can be rendered with evidence and uncertainty;
- all decisions are traceable to catalog, benchmark, routing, and policy versions;
- no paid multi-provider rollout is required to demonstrate the full flow.
