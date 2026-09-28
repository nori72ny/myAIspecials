# ORIGIN Benchmark Specification

Status: Active Draft  
Governing documents:

- [PRODUCT_CONSTITUTION.md](./PRODUCT_CONSTITUTION.md)
- [SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md)
- [AI_ORCHESTRATION_SPEC.md](./AI_ORCHESTRATION_SPEC.md)

## 1. Purpose

This specification defines how ORIGIN evaluates AI services, models, tools, agents, and complete orchestration workflows.

The benchmark system exists to answer a practical routing question:

> For this task class, risk level, budget, latency target, data policy, and user objective, which eligible execution configuration produces the best expected final outcome?

The benchmark system must not reduce all AI systems to one universal leaderboard. It must support domain-specific, role-specific, workflow-specific, and constraint-specific rankings.

## 2. Governing Principles

### 2.1 Evaluate outcomes, not reputation

Provider popularity, marketing claims, model size, release novelty, and generalized public leaderboard position are not substitutes for measured performance on ORIGIN use cases.

### 2.2 Compare like with like

A general conversational assistant, coding agent, research engine, browser agent, multimodal model, and autonomous execution system must not be ranked as though they perform the same job.

### 2.3 Benchmark complete configurations

The primary unit of evaluation is an `ExecutionConfiguration`, which may include:

- one AI model;
- one AI service with tools;
- one agent runtime;
- one model assigned to one role;
- multiple models assigned to different roles;
- a complete execution graph;
- retrieval, search, browser, code, file, and verification tools;
- prompts, policies, context strategy, retry rules, and synthesis logic.

### 2.4 Preserve cost discipline

Quality must be evaluated together with cost and latency. A small quality gain does not automatically justify a large increase in expense or execution time.

### 2.5 Separate capability from eligibility

A configuration may score highly in a benchmark and still be ineligible for a request because of:

- data residency requirements;
- privacy restrictions;
- contractual restrictions;
- missing access;
- unavailable tools;
- excessive cost;
- unacceptable latency;
- insufficient reliability;
- safety policy;
- provider outage or rate limit.

### 2.6 Treat benchmark results as time-bounded evidence

Model behavior, pricing, availability, context limits, tool quality, and provider policies change. Every result must include freshness and version metadata.

## 3. Benchmark Subjects

```typescript
export type BenchmarkSubjectType =
  | "model"
  | "service"
  | "agent"
  | "role-assignment"
  | "workflow"
  | "execution-configuration";

export interface BenchmarkSubject {
  id: string;
  type: BenchmarkSubjectType;
  providerId?: string;
  serviceId?: string;
  modelId?: string;
  agentId?: string;
  workflowId?: string;
  version: string;
  configurationHash: string;
  capabilities: string[];
  toolset: string[];
  contextPolicyId?: string;
  promptPolicyId?: string;
  evaluationStatus:
    | "unverified"
    | "sandbox"
    | "shadow"
    | "trial"
    | "approved"
    | "preferred"
    | "restricted"
    | "deprecated";
}
```

A result is invalid for routing if the executable configuration has materially changed without a new configuration version.

Material changes include:

- model version change;
- system prompt change;
- toolset change;
- retrieval strategy change;
- orchestration graph change;
- evaluator policy change;
- temperature or reasoning configuration change;
- cost or quota regime change when it affects execution behavior.

## 4. Domain Taxonomy

ORIGIN must maintain a versioned domain taxonomy. Initial top-level domains include:

- general assistance;
- research;
- factual question answering;
- summarization;
- writing and editing;
- translation;
- software engineering;
- code review;
- debugging;
- architecture and design;
- data analysis;
- business analysis;
- decision support;
- planning;
- education;
- creative work;
- visual understanding;
- document understanding;
- browser and web operation;
- autonomous task execution;
- legal information support;
- medical information support;
- financial information support.

High-risk domains must be represented separately from ordinary domain labels because risk changes evaluation requirements, evidence standards, and approval policy.

```typescript
export interface DomainTaxonomyNode {
  id: string;
  parentId?: string;
  name: string;
  version: string;
  riskClass: "low" | "moderate" | "high" | "critical";
  requiredDimensions: string[];
  forbiddenAutomation?: string[];
}
```

## 5. Task Archetypes

Each domain must contain concrete task archetypes. A task archetype represents a stable class of user intent rather than a single prompt.

Examples:

### Research

- identify current facts with citations;
- compare competing products or services;
- synthesize multiple sources;
- identify uncertainty and disagreement;
- produce an executive briefing;
- monitor changes over time.

### Software engineering

- generate a small isolated function;
- modify an existing repository;
- diagnose a failing test;
- review a pull request;
- design a subsystem;
- perform a long-running multi-file change;
- explain implementation and risk.

### Decision support

- compare alternatives under explicit criteria;
- identify missing information;
- estimate trade-offs;
- produce a recommendation with assumptions;
- distinguish reversible and irreversible decisions.

### Autonomous execution

- plan a multi-step objective;
- use tools correctly;
- recover from partial failure;
- avoid unauthorized consequential action;
- maintain state over a long-running mission;
- terminate when the objective or stop condition is met.

## 6. Benchmark Types

ORIGIN uses four primary benchmark families.

## 6.1 Static Benchmark

A controlled set of predefined tasks with expected properties, reference answers, rubrics, or deterministic checks.

Suitable for:

- factual accuracy;
- reasoning consistency;
- structured output;
- coding correctness;
- formatting;
- instruction adherence;
- refusal and safety behavior.

Static benchmarks are reproducible but may not fully represent live tools, changing information, or extended autonomous work.

## 6.2 Execution Benchmark

A benchmark that allows the subject to use tools or operate in an instrumented environment.

Suitable for:

- web research;
- repository changes;
- command execution;
- data analysis;
- file transformation;
- browser workflows;
- structured tool calling;
- recovery from tool errors.

Execution benchmarks must record all tool calls, side effects, retries, and environment state.

## 6.3 Long-Running Agent Benchmark

A benchmark for multi-step autonomous work over longer durations and larger state spaces.

Suitable for:

- mission planning;
- task decomposition;
- progress tracking;
- context preservation;
- checkpointing;
- error recovery;
- budget control;
- stopping behavior;
- permission boundaries.

A long-running benchmark must include resource limits and explicit termination conditions.

## 6.4 Production Outcome Benchmark

A benchmark derived from real product use, subject to consent, privacy, and governance requirements.

Suitable signals include:

- task completion;
- user acceptance;
- user correction rate;
- follow-up burden;
- edit distance from delivered artifact to accepted artifact;
- rollback or failure rate;
- human review outcome;
- cost and latency;
- repeat use of the same workflow.

Raw satisfaction alone must not be treated as proof of factual correctness.

## 7. Benchmark Case Schema

```typescript
export interface BenchmarkCase {
  id: string;
  version: string;
  title: string;
  domainId: string;
  archetypeId: string;
  benchmarkType: "static" | "execution" | "agentic" | "production";

  input: {
    userRequest: string;
    attachments?: string[];
    environmentId?: string;
    initialState?: Record<string, unknown>;
  };

  constraints: {
    maximumCost?: number;
    maximumLatencyMs?: number;
    maximumToolCalls?: number;
    maximumSteps?: number;
    dataClass?: string;
    allowedProviders?: string[];
    forbiddenProviders?: string[];
    allowedTools?: string[];
    forbiddenActions?: string[];
  };

  expectedProperties: string[];
  referenceArtifacts?: string[];
  rubricId: string;
  evaluatorPolicyId: string;
  tags: string[];
  difficulty: "basic" | "standard" | "advanced" | "expert";
  riskLevel: "low" | "moderate" | "high" | "critical";
}
```

## 8. Evaluation Dimensions

No single scalar score is sufficient for analysis. Each result must retain dimension-level measurements.

Core dimensions:

- correctness;
- completeness;
- relevance;
- instruction adherence;
- reasoning quality where observable from outputs and actions;
- evidence quality;
- citation accuracy;
- uncertainty calibration;
- clarity;
- actionability;
- safety;
- policy compliance;
- tool-use correctness;
- artifact quality;
- robustness;
- recovery behavior;
- latency;
- cost;
- resource efficiency;
- reproducibility.

Additional domain dimensions may be required.

### Coding dimensions

- build success;
- test pass rate;
- static-analysis result;
- regression count;
- code maintainability;
- scope discipline;
- security impact;
- correctness of repository operations.

### Research dimensions

- source quality;
- source diversity;
- freshness;
- claim-to-source support;
- contradiction handling;
- distinction between fact and inference;
- coverage of material viewpoints.

### Agentic dimensions

- plan quality;
- progress toward objective;
- unnecessary-action rate;
- unauthorized-action rate;
- checkpoint quality;
- recovery from tool failure;
- stopping correctness;
- budget adherence.

## 9. Evaluator Types

ORIGIN must combine multiple evaluator types.

## 9.1 Deterministic Evaluators

Examples:

- unit tests;
- schema validation;
- compiler and type checker;
- exact numeric checks;
- file existence and diff checks;
- citation URL or identifier validation;
- action-policy checks;
- cost calculation;
- latency measurement.

Deterministic evaluators have priority for properties they can validly measure.

## 9.2 Reference-Based Evaluators

Compare output with an accepted answer or artifact while allowing justified variation.

Reference answers must not be assumed complete when a task permits multiple valid solutions.

## 9.3 Model-Based Evaluators

Model judges may assess qualities that are difficult to measure deterministically, such as clarity, synthesis, prioritization, or nuanced completeness.

Requirements:

- evaluator identity and version must be recorded;
- evaluation prompts must be versioned;
- rubric criteria must be explicit;
- subject identity should be blinded where practical;
- presentation order should be randomized in pairwise evaluation;
- evaluator disagreement must be retained;
- model-based evaluation must not be the only check for high-risk correctness.

## 9.4 Human Evaluators

Human review is required when:

- objective evaluation is unavailable for a high-impact claim;
- benchmark results determine promotion into a high-risk role;
- model evaluators materially disagree;
- the task requires professional judgment;
- production incidents indicate benchmark blind spots;
- consequential actions are being validated.

Human evaluators must use structured rubrics rather than unrecorded intuition alone.

## 9.5 User Outcome Signals

User behavior may inform production ranking but must be interpreted carefully.

Examples:

- accepted result;
- requested revision;
- manual correction;
- abandonment;
- repeated use;
- explicit rating;
- successful completion of downstream task.

User outcome data must be anonymized or aggregated according to governance policy and only collected where permitted.

## 10. Rubric Definition

```typescript
export interface BenchmarkRubric {
  id: string;
  version: string;
  dimensions: Array<{
    id: string;
    weight: number;
    scoringMethod:
      | "deterministic"
      | "ordinal"
      | "pairwise"
      | "binary"
      | "continuous";
    minimumRequired?: number;
    criticalFailure?: boolean;
  }>;
  aggregationPolicy: string;
  tieBreakPolicy: string;
}
```

Critical dimensions must not be hidden by averaging. For example, a polished answer with fabricated evidence must fail a research benchmark even if clarity is excellent.

## 11. Critical Failure Conditions

A run may be marked as a critical failure regardless of aggregate score when it:

- performs an unauthorized consequential action;
- exposes restricted information;
- fabricates evidence or citations;
- claims completion when required work was not completed;
- violates a hard budget limit;
- modifies resources outside the allowed scope;
- introduces severe security vulnerabilities;
- gives dangerously unsupported high-risk guidance;
- ignores an explicit stop condition;
- conceals tool or execution failure.

```typescript
export interface CriticalFailure {
  code: string;
  severity: "major" | "critical";
  description: string;
  evidenceRefs: string[];
  disqualifiesRun: boolean;
  triggersRestrictionReview: boolean;
}
```

## 12. Repetition and Variance

Generative systems are stochastic. One run is not sufficient for broad conclusions.

Each benchmark program must define:

- minimum run count;
- sampling parameters;
- retry handling;
- environment reset policy;
- confidence interval method;
- outlier treatment;
- failure-rate reporting.

For deterministic or near-deterministic tasks, fewer repetitions may be appropriate. For agentic or high-variance tasks, more repetitions are required.

ORIGIN must report:

- mean;
- median;
- standard deviation or robust equivalent;
- success rate;
- critical failure rate;
- confidence interval;
- sample size.

## 13. Pairwise and Tournament Evaluation

Pairwise comparison is preferred when absolute scoring is unreliable.

Requirements:

- anonymize subject identity where practical;
- randomize left-right order;
- evaluate ties explicitly;
- use multiple evaluators for important comparisons;
- retain disagreement;
- avoid transitive assumptions when evidence is weak.

Tournament ranking may be used to reduce evaluation cost, but it must not erase dimension-level results.

## 14. Cost Measurement

Cost must be recorded at the complete execution-configuration level.

```typescript
export interface BenchmarkCost {
  currency: string;
  inputTokenCost: number;
  outputTokenCost: number;
  reasoningTokenCost?: number;
  toolCost: number;
  searchCost: number;
  computeCost: number;
  storageCost?: number;
  retryCost: number;
  evaluatorCost: number;
  totalCost: number;
  pricingVersion: string;
  estimatedOrActual: "estimated" | "actual";
}
```

Free-tier execution must not be recorded as permanently zero-cost. The benchmark record must distinguish:

- provider list price;
- contract price if applicable;
- free-tier realized cost;
- internal compute cost;
- marginal request cost.

## 15. Latency Measurement

Latency measurements include:

- queue time;
- time to first useful output;
- total completion time;
- tool-wait time;
- retry delay;
- human-approval wait time, reported separately;
- synthesis time.

Streaming systems must be evaluated on both time to first useful output and final completion time.

## 16. Quality-Cost Frontier

ORIGIN must identify Pareto-efficient configurations rather than declaring one universal winner.

A configuration is dominated when another eligible configuration is:

- equal or better in required quality dimensions;
- no more expensive;
- no slower beyond the accepted threshold;
- no less reliable;
- no less safe.

The benchmark output should identify at least:

- lowest-cost acceptable configuration;
- recommended balanced configuration;
- highest-quality justified configuration;
- fastest acceptable configuration where latency matters.

Incremental value must be calculated explicitly.

```text
Incremental value =
weighted expected quality gain
/
incremental expected cost
```

The routing policy may reject a higher-scoring configuration when the gain is too small relative to additional cost or latency.

## 17. Workflow Benchmarking

A workflow benchmark evaluates the complete graph, not merely each component in isolation.

Example:

```text
Researcher
  -> Evidence Extractor
  -> Independent Reviewer
  -> Synthesizer
  -> Safety and Citation Gate
```

Workflow evaluation must capture:

- final outcome quality;
- contribution of each node;
- propagation of errors;
- redundancy value;
- disagreement resolution;
- total cost;
- total latency;
- failure recovery;
- whether simpler workflows achieve equivalent results.

Ablation tests should remove or replace individual nodes to measure whether they provide real value.

## 18. Role-Specific Evaluation

Models must be evaluated for the role they perform.

Initial roles include:

- primary solver;
- researcher;
- planner;
- architect;
- coder;
- reviewer;
- fact checker;
- safety reviewer;
- critic;
- synthesizer;
- editor;
- presenter;
- tool operator.

A model that performs well as a synthesizer may perform poorly as a primary researcher. Rankings must preserve this distinction.

## 19. Benchmark Result Schema

```typescript
export interface BenchmarkRunResult {
  id: string;
  benchmarkCaseId: string;
  subjectId: string;
  subjectVersion: string;
  startedAt: string;
  completedAt: string;
  environmentVersion: string;

  status:
    | "completed"
    | "partial"
    | "failed"
    | "disqualified"
    | "cancelled";

  dimensionScores: Record<string, number>;
  aggregateScore?: number;
  confidence?: number;
  criticalFailures: CriticalFailure[];
  cost: BenchmarkCost;
  latency: Record<string, number>;
  toolCallCount: number;
  retryCount: number;
  evaluatorResults: string[];
  outputArtifactRefs: string[];
  traceRef?: string;
  reproducibilityMetadata: Record<string, unknown>;
}
```

## 20. Aggregated Performance Profile

```typescript
export interface PerformanceProfile {
  subjectId: string;
  subjectVersion: string;
  domainId: string;
  archetypeId?: string;
  roleId?: string;
  constraintProfileId?: string;

  sampleSize: number;
  successRate: number;
  criticalFailureRate: number;
  qualityDistribution: Record<string, number>;
  medianCost: number;
  medianLatencyMs: number;
  confidenceInterval: {
    lower: number;
    upper: number;
  };

  validFrom: string;
  expiresAt: string;
  evidenceVersion: string;
  routingEligibility: "eligible" | "shadow-only" | "restricted" | "expired";
}
```

## 21. Constraint-Specific Rankings

Rankings must be generated under explicit constraint profiles.

Examples:

- free-tier only;
- lowest cost;
- under 5 seconds;
- offline or local only;
- no external retention;
- enterprise-approved providers only;
- Japanese-language quality priority;
- high-risk evidence priority;
- coding with repository tools;
- long-context document analysis;
- multimodal input required.

A ranking without its constraint profile is incomplete and must not be used for routing.

## 22. New AI Evaluation Lifecycle

New services and models follow this sequence:

```text
Discovered
  -> Compatibility Review
  -> Sandbox Benchmark
  -> Shadow Evaluation
  -> Limited Trial
  -> Approved
  -> Preferred for Specific Roles or Domains
```

Possible later states:

```text
Approved
  -> Restricted
  -> Demoted
  -> Deprecated
  -> Removed
```

Promotion requires evidence of meaningful value. Novelty alone is insufficient.

Minimum promotion evidence should include:

- capability compatibility;
- safety and privacy review;
- cost and quota review;
- static benchmark results;
- execution benchmark results where tools are used;
- reliability measurement;
- comparison with the current preferred configuration;
- identified domain or role where improvement is measurable.

## 23. Shadow Evaluation

Shadow evaluation executes or simulates a candidate without using its output as the primary user result.

Shadow evaluation must:

- remain within an explicit evaluation budget;
- avoid consequential external actions;
- avoid transmitting ineligible data;
- record the incumbent and candidate configurations;
- compare final outcome, cost, latency, and failure behavior;
- protect the production user experience.

Paid shadow execution must be rate-limited and justified by the expected value of evaluation.

## 24. Promotion Policy

A candidate may be promoted when:

- it exceeds the minimum quality threshold;
- it does not increase critical failure rate;
- reliability meets the role requirement;
- data and provider policies permit use;
- its incremental value is justified;
- evidence is sufficiently recent;
- sample size is sufficient for the decision risk;
- no unresolved severe regression exists.

Promotion may be limited to:

- one domain;
- one task archetype;
- one language;
- one risk class;
- one execution mode;
- one budget tier;
- one role.

## 25. Demotion and Restriction

A subject must be reviewed for demotion or restriction when:

- critical failure rate increases;
- provider behavior changes materially;
- pricing changes invalidate cost assumptions;
- latency or availability degrades;
- benchmark evidence expires;
- privacy or contractual terms change;
- production outcomes materially diverge from benchmarks;
- a better configuration dominates it;
- a security or safety incident occurs.

## 26. Benchmark Refresh Policy

Minimum refresh triggers:

- major model release;
- model alias or version change;
- provider pricing change;
- provider policy change;
- tool or API behavior change;
- orchestration prompt or graph change;
- material production regression;
- scheduled periodic review.

Recommended cadence:

- lightweight health and regression checks: daily or per release;
- preferred-subject domain checks: weekly;
- broad portfolio review: monthly;
- full methodology review: quarterly;
- immediate targeted rerun after a material change.

Cadence must be adjusted to evaluation cost and risk.

## 27. Benchmark Data Governance

Benchmark datasets must be versioned and access-controlled.

They must distinguish:

- public test cases;
- private holdout cases;
- adversarial cases;
- production-derived cases;
- restricted high-risk cases.

To reduce overfitting:

- maintain private holdouts;
- rotate case wording and data;
- separate development and promotion datasets;
- detect memorized benchmark artifacts where practical;
- avoid publishing all exact high-value evaluation cases.

Production-derived cases must be de-identified and governed by user consent and retention policy.

## 28. Reproducibility

Every benchmark run must record enough metadata to explain and, where possible, reproduce the result:

- subject and version;
- model identifier;
- provider endpoint or runtime;
- prompt and policy versions;
- tool versions;
- environment version;
- dataset version;
- evaluator versions;
- sampling configuration;
- date and time;
- region where relevant;
- pricing version;
- input and output artifact references;
- execution trace reference.

Provider nondeterminism must be acknowledged rather than disguised.

## 29. Benchmark Integrity

The system must prevent or detect:

- subject-specific favorable prompts not available in production;
- unequal tool access;
- hidden manual intervention;
- selective reporting of successful runs;
- excluding retries from cost;
- excluding failed runs from reliability calculations;
- changing rubrics after seeing results without versioning;
- using production data without authorization;
- evaluator identity leakage that biases judging.

## 30. Reporting

Benchmark reports must contain:

1. scope and purpose;
2. subjects and exact versions;
3. domain and task distribution;
4. constraints;
5. evaluator methodology;
6. sample sizes;
7. dimension-level results;
8. critical failures;
9. cost and latency;
10. uncertainty and confidence intervals;
11. quality-cost frontier;
12. known limitations;
13. recommendation and applicable scope;
14. evidence expiration date.

Reports must avoid language such as "best AI" without stating the domain, role, constraints, and evidence period.

## 31. Routing Integration

The Model Router consumes benchmark evidence through `PerformanceProfile` records.

Routing must:

1. filter subjects by eligibility;
2. retrieve profiles matching domain, archetype, role, risk, and constraint profile;
3. reject expired or insufficient evidence where required;
4. apply uncertainty penalties;
5. construct candidate workflows;
6. calculate expected quality, cost, latency, and reliability;
7. select a Pareto-efficient plan;
8. retain cheaper and higher-quality alternatives;
9. record the evidence profile IDs used in the decision.

A routing decision must never silently treat missing benchmark evidence as strong evidence.

## 32. Cold-Start Policy

A new subject with limited evidence may be used only under controlled conditions.

Cold-start measures include:

- conservative prior scores;
- uncertainty penalty;
- sandbox or shadow-only status;
- low-risk tasks only;
- small traffic allocation;
- strict cost caps;
- no consequential actions;
- enhanced logging and review.

## 33. Initial Low-Cost Implementation

The first implementation does not require large-scale paid benchmarking.

Initial deliverables:

- versioned benchmark domain types;
- mock service and workflow profiles;
- deterministic sample cases;
- local rubric evaluation;
- stored synthetic benchmark results;
- quality-cost frontier calculation;
- constraint-specific ranking;
- routing integration using mock profiles;
- benchmark evidence display in the audit view.

Suggested initial package structure:

```text
packages/
  ai-core/
    src/
      benchmark/
        benchmark-subject.ts
        benchmark-case.ts
        rubric.ts
        run-result.ts
        performance-profile.ts
        constraint-profile.ts

services/
  benchmark-engine/
    src/
      case-registry/
      runner/
      evaluators/
      aggregation/
      ranking/
      promotion-policy/
```

The final location must reuse current repository assets and avoid unnecessary service proliferation during the mock stage.

## 34. Initial Test Scenarios

The benchmark engine must be tested against at least these scenarios:

1. a cheap subject meets the quality threshold and defeats a more expensive subject;
2. a higher-cost subject is selected because the cheaper subject fails a critical requirement;
3. a polished research answer with fabricated citations is disqualified;
4. a coding workflow passes narrative review but fails deterministic tests;
5. a new subject receives an uncertainty penalty and remains shadow-only;
6. an expired profile is excluded from normal routing;
7. two subjects are Pareto-efficient under different cost-latency preferences;
8. a multi-model workflow is rejected because a single model achieves equivalent quality at lower cost;
9. a reviewer node is retained because ablation materially increases error rate;
10. a high-risk task requires human review despite a strong aggregate score;
11. a provider price change alters the recommended configuration;
12. failed and retried runs remain included in cost and reliability metrics;
13. pairwise evaluator order randomization produces no material positional bias;
14. a critical unauthorized action overrides a high aggregate score;
15. production satisfaction improves while factual correctness declines, preventing automatic promotion.

## 35. Definition of Done

This specification is implementation-ready when the system can:

- register versioned benchmark subjects and cases;
- run deterministic local evaluations;
- store dimension-level results;
- record complete cost and latency;
- detect critical failures;
- aggregate repeated runs with uncertainty;
- generate domain-, role-, and constraint-specific profiles;
- identify Pareto-efficient configurations;
- compare individual models and complete workflows;
- apply cold-start uncertainty penalties;
- expire stale evidence;
- feed evidence into routing decisions;
- explain why a subject was promoted, restricted, or rejected;
- do all of the above initially without requiring broad paid-provider execution.

## 36. Non-Goals for the First Increment

The first increment does not require:

- a universal public leaderboard;
- exhaustive evaluation of every available AI;
- automatic trust of newly discovered services;
- large paid benchmark runs;
- autonomous production promotion without policy checks;
- collection of private production data without explicit governance;
- replacement of professional human evaluation in high-risk domains.

## 37. Fixed Decision

ORIGIN will benchmark the result-producing system, not merely the underlying model.

The long-term competitive advantage is the evidence-driven ability to select and improve combinations of AI services, tools, roles, prompts, and workflows while preserving the original quality, safety, and cost conditions.