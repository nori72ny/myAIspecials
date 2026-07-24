# ORIGIN Provider Integration Standard

Status: Active Draft  
Governing documents:

- [PRODUCT_CONSTITUTION.md](./PRODUCT_CONSTITUTION.md)
- [SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md)
- [AI_ORCHESTRATION_SPEC.md](./AI_ORCHESTRATION_SPEC.md)
- [BENCHMARK_SPEC.md](./BENCHMARK_SPEC.md)
- [COST_AND_APPROVAL_POLICY.md](./COST_AND_APPROVAL_POLICY.md)

## 1. Purpose

This standard defines the provider-neutral boundary through which ORIGIN discovers, qualifies, invokes, observes, prices, restricts, and retires AI services, models, agents, and provider-hosted tools.

The standard exists so that the orchestration system can select capabilities rather than hard-code provider brands. A provider integration must expose normalized behavior while preserving provider-specific features through explicit extensions.

A compliant integration must make it possible to answer:

> Can this provider configuration safely, reliably, and economically perform the required role under the current constraints?

It must not force the rest of the system to understand provider-specific request formats, error types, usage fields, or lifecycle conventions.

## 2. Scope

This standard covers:

- provider and model identity;
- model discovery and catalog synchronization;
- capability declarations;
- authentication and secret handling;
- request and response normalization;
- streaming;
- structured output;
- multimodal inputs and outputs;
- tool invocation;
- hosted-agent and asynchronous-job execution;
- usage and cost reporting;
- rate limits and concurrency;
- health and availability;
- failure normalization;
- retries, idempotency, and cancellation;
- safety, privacy, region, and retention metadata;
- observability and audit;
- conformance testing;
- versioning, deprecation, and replacement.

This standard does not define:

- task routing policy;
- benchmark scoring methodology;
- user approval policy;
- user-interface layout;
- provider commercial agreements.

Those are defined in their respective specifications.

## 3. Normative Language

The terms MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are normative.

A provider integration is conformant only when all applicable MUST requirements are satisfied and verified by automated conformance tests.

## 4. Core Principles

### 4.1 Capability-first integration

The orchestration system selects declared and verified capabilities. Provider and model names are implementation details and audit metadata, not the primary routing abstraction.

### 4.2 Strict normalized core, explicit extensions

Common behavior MUST use normalized contracts. Provider-specific features MAY be exposed through namespaced extensions but MUST NOT silently alter normalized semantics.

### 4.3 Evidence over claims

Provider-advertised capabilities are provisional until verified. The catalog MUST distinguish declared, observed, benchmarked, and approved capability states.

### 4.4 Safe defaults

Unknown retention, region, pricing, tool permissions, or side effects MUST be treated conservatively. Missing metadata cannot be interpreted as permission.

### 4.5 Complete economic accountability

Every billable operation MUST be attributable to a request, execution node, provider configuration, pricing snapshot, and usage record.

### 4.6 Failure isolation

Provider-specific failures MUST be normalized at the adapter boundary. Provider outages or schema changes must not corrupt orchestration state.

### 4.7 Replaceability

A provider adapter MUST be removable or replaceable without changing core orchestration contracts.

## 5. Integration Architecture

```text
ORIGIN Core
  |
  | Normalized Provider Contract
  v
Provider Adapter
  |-- Authentication Driver
  |-- Catalog Discovery Driver
  |-- Request Mapper
  |-- Streaming Decoder
  |-- Tool Protocol Mapper
  |-- Usage and Cost Mapper
  |-- Error Normalizer
  |-- Health Probe
  v
Provider API / SDK / Hosted Agent Runtime
```

The adapter boundary is the only layer permitted to depend directly on provider SDK types, provider endpoint schemas, provider error classes, or provider-specific authentication mechanisms.

## 6. Provider Identity

Each integration MUST define a stable provider profile.

```ts
export interface ProviderProfile {
  providerId: string;
  displayName: string;
  adapterVersion: string;
  apiFamily: string;
  lifecycleState: ProviderLifecycleState;
  baseRegions: string[];
  documentationRevision?: string;
  termsRevision?: string;
  policyRevision?: string;
  extensions?: Record<string, unknown>;
}
```

`providerId` MUST be stable and machine-readable. Display names may change without changing identity.

Provider lifecycle states are:

- `discovered`;
- `sandbox`;
- `shadow`;
- `trial`;
- `approved`;
- `preferred`;
- `restricted`;
- `deprecated`;
- `removed`.

Only configurations permitted by lifecycle and governance policy may be routed to user-visible production work.

## 7. Model and Service Identity

A model or hosted service MUST use a version-aware identity.

```ts
export interface ProviderModelRef {
  providerId: string;
  modelId: string;
  providerModelName: string;
  revision?: string;
  releaseChannel?: string;
  endpointClass?: string;
}
```

The system MUST NOT assume that an unchanged marketing name represents unchanged behavior.

When a provider offers aliases such as `latest`, the adapter MUST resolve and record the concrete model or revision whenever the provider exposes it.

## 8. Adapter Contract

A provider adapter SHOULD implement the following normalized interface.

```ts
export interface ProviderAdapter {
  readonly profile: ProviderProfile;

  discoverModels(input: DiscoveryRequest): Promise<DiscoveryResult>;
  getModelProfile(ref: ProviderModelRef): Promise<ModelProfile>;
  execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult>;
  stream(request: ProviderExecutionRequest): AsyncIterable<ProviderStreamEvent>;
  cancel(handle: ProviderExecutionHandle): Promise<CancelResult>;
  getUsage(handle: ProviderExecutionHandle): Promise<UsageRecord | null>;
  healthCheck(input?: HealthCheckRequest): Promise<ProviderHealth>;
}
```

Adapters MAY omit an operation only when the provider does not support it and the capability profile declares that limitation explicitly.

## 9. Model Discovery

### 9.1 Discovery sources

Model discovery MAY use:

- provider model-list APIs;
- official metadata endpoints;
- signed catalog files;
- manually governed registry entries;
- approved release-monitoring processes.

Unverified web content MUST NOT directly modify the approved catalog.

### 9.2 Discovery result

```ts
export interface DiscoveryResult {
  discoveredAt: string;
  source: string;
  sourceRevision?: string;
  models: DiscoveredModel[];
  warnings: DiscoveryWarning[];
}
```

Discovery MUST be idempotent. Repeated discovery of unchanged provider state must not create duplicate catalog entities.

### 9.3 Reconciliation

Catalog reconciliation MUST identify:

- new models;
- removed models;
- alias changes;
- capability changes;
- pricing changes;
- context-window changes;
- policy or retention changes;
- regional availability changes;
- deprecation notices.

Material changes MUST trigger requalification under the AI Evolution and Lifecycle Specification.

### 9.4 Discovery freshness

Each discovery record MUST include a timestamp and source revision. Stale discovery data MUST reduce routing confidence or make the configuration ineligible when freshness is safety-critical.

## 10. Capability Declaration

### 10.1 Capability profile

```ts
export interface ModelCapabilityProfile {
  modalities: {
    input: string[];
    output: string[];
  };
  tasks: string[];
  context: {
    maxInputTokens?: number;
    maxOutputTokens?: number;
  };
  features: {
    streaming: boolean;
    structuredOutput: boolean;
    toolCalling: boolean;
    parallelToolCalling?: boolean;
    reasoningControls?: boolean;
    citations?: boolean;
    seed?: boolean;
    logprobs?: boolean;
    batch?: boolean;
    asynchronousJobs?: boolean;
  };
  languages?: string[];
  regions?: string[];
  limitations: CapabilityLimitation[];
  evidence: CapabilityEvidence[];
}
```

### 10.2 Evidence states

Each capability MUST carry one of these evidence states:

- `declared` — reported by provider metadata;
- `observed` — confirmed by adapter integration testing;
- `benchmarked` — measured by ORIGIN benchmark runs;
- `approved` — accepted for defined production use;
- `restricted` — available only under stated constraints;
- `unknown` — insufficient evidence.

Routing MUST rely on the strongest relevant current evidence, not solely on provider claims.

### 10.3 Capability limitations

Limitations MUST be machine-readable where practical, including:

- unsupported tool schemas;
- maximum tool count;
- output-schema restrictions;
- unsupported MIME types;
- language weaknesses;
- region exclusions;
- non-deterministic seed behavior;
- incompatibility between streaming and structured output;
- restrictions on system instructions;
- maximum request duration.

## 11. Provider Configuration

A provider may expose multiple configurations with different credentials, projects, regions, data policies, quotas, or billing accounts.

```ts
export interface ProviderConfiguration {
  configurationId: string;
  providerId: string;
  credentialRef: string;
  projectRef?: string;
  billingRef?: string;
  region?: string;
  dataPolicyProfileId: string;
  quotaProfileId?: string;
  enabled: boolean;
}
```

Routing eligibility MUST be evaluated against the configuration, not merely the provider brand.

## 12. Authentication and Secret Handling

### 12.1 Secret references

Adapters MUST receive secret references or short-lived credentials. Long-lived raw secrets MUST NOT be embedded in source code, configuration files, prompts, logs, traces, or audit payloads.

### 12.2 Supported authentication

Adapters MAY support:

- API keys;
- OAuth 2.0;
- service accounts;
- workload identity;
- cloud-role federation;
- signed requests;
- short-lived session tokens.

### 12.3 Least privilege

Credentials MUST be scoped to the minimum required permissions, projects, models, regions, and actions.

Read-only model invocation credentials SHOULD be separate from credentials capable of file writes, agent actions, fine-tuning, administration, or billing changes.

### 12.4 Rotation and revocation

Secret rotation MUST not require application code changes. Revoked credentials MUST fail closed and produce a normalized authentication error.

### 12.5 Secret leakage prevention

The adapter and observability layers MUST redact:

- authorization headers;
- API keys;
- refresh tokens;
- signed URLs;
- provider account secrets;
- credential-bearing query parameters.

## 13. Normalized Execution Request

```ts
export interface ProviderExecutionRequest {
  requestId: string;
  executionNodeId: string;
  providerConfigurationId: string;
  model: ProviderModelRef;
  messages: NormalizedMessage[];
  instructions?: string;
  inputArtifacts?: ArtifactRef[];
  tools?: NormalizedToolDefinition[];
  responseFormat?: NormalizedResponseFormat;
  generation?: GenerationControls;
  safety?: SafetyControls;
  timeoutMs?: number;
  idempotencyKey?: string;
  metadata: ExecutionMetadata;
}
```

The request MUST contain no provider-specific fields except within a validated namespaced extension object.

## 14. Message and Content Model

Messages MUST support ordered multimodal content parts.

```ts
export interface NormalizedMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: ContentPart[];
  name?: string;
  toolCallId?: string;
}
```

Content parts MAY include:

- text;
- image reference;
- audio reference;
- video reference;
- document reference;
- structured data;
- tool result;
- citation reference.

Adapters MUST reject unsupported content types before billable execution whenever support can be determined locally.

## 15. Generation Controls

Normalized generation controls MAY include:

- maximum output tokens;
- temperature;
- top-p;
- stop sequences;
- seed;
- reasoning effort;
- verbosity;
- response count.

Adapters MUST report ignored, approximated, transformed, or unsupported controls. They MUST NOT silently claim exact control where the provider offers only an approximation.

## 16. Structured Output

### 16.1 Schema contract

Structured output SHOULD use JSON Schema or an ORIGIN-defined compatible subset.

```ts
export interface NormalizedResponseFormat {
  type: "text" | "json" | "json_schema";
  schema?: Record<string, unknown>;
  strict?: boolean;
}
```

### 16.2 Validation

Provider output MUST be validated against the requested schema outside the model response.

A provider's claim of schema compliance is not sufficient validation.

### 16.3 Repair

Schema repair MAY be attempted when:

- policy permits another invocation or deterministic repair;
- budget remains available;
- the repair is recorded;
- repair does not invent missing consequential values.

The final result MUST state whether it was provider-native, deterministically repaired, or model-repaired.

## 17. Streaming

### 17.1 Normalized stream events

```ts
export type ProviderStreamEvent =
  | { type: "started"; handle: ProviderExecutionHandle }
  | { type: "content_delta"; delta: ContentPartDelta }
  | { type: "tool_call_delta"; delta: ToolCallDelta }
  | { type: "citation_delta"; delta: CitationDelta }
  | { type: "usage_update"; usage: PartialUsageRecord }
  | { type: "warning"; warning: ProviderWarning }
  | { type: "completed"; result: ProviderExecutionResult }
  | { type: "failed"; error: NormalizedProviderError };
```

### 17.2 Ordering

Adapters MUST preserve provider event order and assign monotonically increasing sequence numbers when the provider does not.

### 17.3 Partial output

Partial output MUST be marked incomplete until a terminal success event is received. UI layers must not treat streamed text as verified final output.

### 17.4 Stream interruption

On interruption, the adapter MUST report:

- whether the provider may still be processing;
- whether usage may continue to accrue;
- whether retry is safe;
- whether partial content is available;
- the last confirmed sequence.

## 18. Tool Invocation

### 18.1 Normalized tool definition

```ts
export interface NormalizedToolDefinition {
  toolId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  sideEffectClass: "none" | "reversible" | "consequential";
  approvalRequirement: "none" | "conditional" | "required";
}
```

### 18.2 Model proposal versus execution

A provider model may propose a tool call. The adapter MUST NOT execute external tools directly unless the architecture explicitly delegates execution to the provider-hosted runtime and equivalent policy controls are enforced.

Tool proposals MUST pass through:

1. schema validation;
2. permission checks;
3. data-disclosure checks;
4. budget checks;
5. approval checks;
6. execution policy;
7. audit recording.

### 18.3 Tool call identity

Every tool call MUST have a stable call identifier linking:

- model proposal;
- validated arguments;
- approval decision;
- tool execution;
- tool result;
- subsequent model continuation.

### 18.4 Hosted tools

Provider-hosted search, code execution, retrieval, browsing, file handling, or computer-use tools MUST be declared as separately priced and separately governed capabilities.

The adapter MUST report provider-hosted tool usage distinctly from model-token usage whenever the provider exposes it.

### 18.5 Side effects

A provider-hosted agent MUST NOT be considered safe merely because the provider executes the tool. ORIGIN approval and scope policies still apply.

## 19. Asynchronous and Agentic Execution

Providers supporting asynchronous jobs or hosted agents MUST expose:

- job handle;
- status polling or event subscription;
- cancellation;
- checkpoint or intermediate state when available;
- step and tool counts;
- accumulated usage;
- final artifacts;
- terminal status.

The normalized status set is:

- `queued`;
- `running`;
- `waiting_for_tool`;
- `waiting_for_approval`;
- `completed`;
- `partial`;
- `cancelled`;
- `failed`;
- `expired`;
- `unknown`.

Provider-specific statuses MUST map to this set while retaining the original status in audit metadata.

## 20. Execution Result

```ts
export interface ProviderExecutionResult {
  handle: ProviderExecutionHandle;
  status: "completed" | "partial" | "cancelled" | "failed";
  output: ContentPart[];
  toolCalls: NormalizedToolCall[];
  citations: NormalizedCitation[];
  artifacts: ArtifactRef[];
  usage: UsageRecord;
  warnings: ProviderWarning[];
  providerMetadata: ProviderExecutionMetadata;
}
```

A successful transport response does not imply a successful task result. Adapter status describes provider execution only; evaluation and synthesis determine task quality.

## 21. Citation Normalization

When providers emit citations, adapters MUST preserve:

- source identifier or URL reference;
- cited span or claim association when available;
- retrieval timestamp;
- provider confidence if supplied;
- title and publisher metadata when supplied.

Adapters MUST NOT fabricate claim-level alignment when the provider only returns document-level sources.

Citation existence is not proof of source quality or factual support. Evaluation remains required.

## 22. Usage Reporting

### 22.1 Usage record

```ts
export interface UsageRecord {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  imageUnits?: number;
  audioInputSeconds?: number;
  audioOutputSeconds?: number;
  videoSeconds?: number;
  toolInvocations?: ToolUsageRecord[];
  storageUnits?: number;
  providerReported: boolean;
  final: boolean;
  measuredAt: string;
}
```

### 22.2 Provenance

Each usage field MUST indicate whether it is:

- provider-reported;
- locally measured;
- estimated;
- reconciled later.

### 22.3 Missing usage

Missing usage MUST NOT be treated as zero. The adapter MUST return an explicit unknown or estimate state.

### 22.4 Delayed usage

When final usage is delayed, the execution result MUST remain financially unreconciled until a final record or governed timeout is reached.

## 23. Cost Reporting

### 23.1 Pricing snapshot

Every execution MUST reference a versioned pricing snapshot containing:

- provider configuration;
- model or service revision;
- region;
- currency;
- input, output, cache, media, tool, storage, and batch prices as applicable;
- effective time;
- source and verification status.

### 23.2 Cost calculation

Adapters SHOULD return raw usage. A centralized cost engine SHOULD calculate normalized cost to prevent inconsistent adapter arithmetic.

Provider-calculated charges MAY be recorded for reconciliation.

### 23.3 Unknown pricing

A configuration with unknown or stale pricing MUST be ineligible for unattended paid execution unless a conservative maximum cost cap is enforceable and policy explicitly permits it.

### 23.4 Free tiers and credits

Free-tier eligibility, credits, promotional balances, and subscription-included usage MAY be represented, but routing MUST distinguish nominal cost from expected out-of-pocket cost.

## 24. Rate Limits and Quotas

Adapters MUST normalize:

- requests per time unit;
- tokens or units per time unit;
- concurrent requests;
- daily or monthly quotas;
- model-specific limits;
- organization or project limits;
- retry-after guidance.

Unknown limits MUST not be represented as unlimited.

The runtime SHOULD maintain a local quota ledger and update it using provider response headers or quota APIs.

## 25. Concurrency and Backpressure

Adapters MUST support bounded concurrency. They MUST NOT create unbounded internal queues.

When capacity is exhausted, the adapter MUST return a normalized capacity condition that permits the planner to:

- wait;
- use another provider configuration;
- reduce parallelism;
- downgrade execution mode;
- ask for user approval when cost changes materially.

## 26. Timeout and Cancellation

### 26.1 Timeouts

Adapters MUST distinguish:

- connection timeout;
- response-start timeout;
- inactivity timeout;
- total execution timeout;
- hosted-job expiration.

### 26.2 Cancellation

Cancellation MUST be best-effort and report one of:

- `confirmed`;
- `requested`;
- `unsupported`;
- `too_late`;
- `unknown`.

Cancellation acknowledgement is not proof that billing stopped. Usage reconciliation must continue when necessary.

## 27. Idempotency

Billable or consequential operations SHOULD use provider-native idempotency keys when available.

The adapter MUST declare whether retries are:

- safely idempotent;
- conditionally idempotent;
- non-idempotent;
- unknown.

A timeout after request submission MUST NOT automatically trigger a retry when duplicate execution could cause additional cost or side effects.

## 28. Failure Normalization

### 28.1 Normalized error model

```ts
export interface NormalizedProviderError {
  category: ProviderErrorCategory;
  code: string;
  message: string;
  retryability: "yes" | "no" | "conditional" | "unknown";
  providerStatus?: number;
  retryAfterMs?: number;
  requestAccepted?: boolean;
  possibleBilling?: boolean;
  possibleSideEffect?: boolean;
  providerErrorCode?: string;
  safeDetails?: Record<string, unknown>;
}
```

### 28.2 Error categories

Required categories are:

- `authentication`;
- `authorization`;
- `invalid_request`;
- `unsupported_capability`;
- `content_policy`;
- `data_policy`;
- `rate_limit`;
- `quota_exhausted`;
- `capacity`;
- `timeout`;
- `network`;
- `provider_internal`;
- `model_unavailable`;
- `schema_violation`;
- `tool_failure`;
- `cancelled`;
- `billing`;
- `unknown`.

### 28.3 Error preservation

The original provider code and sanitized provider message MUST be retained for diagnosis, but core logic MUST act on normalized categories.

### 28.4 Retry guidance

Retryability MUST be derived from error type, request acceptance state, idempotency, remaining budget, latency constraints, and policy. HTTP status alone is insufficient.

## 29. Retry Rules

Adapters MAY implement transport-level retries only for clearly safe transient failures.

Orchestration-level retries MUST remain visible to the execution planner and cost guard.

Every retry MUST record:

- reason;
- prior attempt outcome;
- idempotency assessment;
- expected incremental cost;
- delay;
- selected configuration;
- final result.

Provider SDK automatic retries MUST be disabled or surfaced when they would bypass ORIGIN retry, cost, or audit policy.

## 30. Health and Availability

### 30.1 Health profile

```ts
export interface ProviderHealth {
  status: "healthy" | "degraded" | "unavailable" | "unknown";
  checkedAt: string;
  latencyMs?: number;
  authenticationValid?: boolean;
  modelAvailability?: Record<string, string>;
  quotaState?: string;
  warnings: string[];
}
```

### 30.2 Health signals

Health MAY combine:

- provider status information;
- lightweight authenticated probes;
- recent execution success rate;
- latency distribution;
- rate-limit state;
- quota state;
- schema or behavior drift detection.

### 30.3 Routing use

Health is advisory unless policy marks a condition as a hard exclusion. A stale health record must be represented as unknown, not healthy.

## 31. Safety and Provider Policy Metadata

Each provider configuration MUST declare machine-readable policy metadata covering, when known:

- permitted content categories;
- prohibited uses;
- age restrictions;
- safety-filter behavior;
- provider moderation behavior;
- logging and abuse-monitoring practices;
- user opt-out controls;
- data retention;
- training-use policy;
- human review possibility;
- regional processing;
- subprocessors or hosting region when governed;
- intellectual-property restrictions;
- enterprise or zero-retention eligibility.

Unknown policy metadata MUST reduce eligibility for sensitive workloads.

## 32. Data Handling

Before dispatch, the adapter boundary MUST receive a data-classification decision and allowed-disclosure scope.

Adapters MUST enforce or validate:

- permitted provider configuration;
- permitted region;
- permitted retention profile;
- allowed artifact types;
- redaction requirements;
- user or organization consent state.

An adapter MUST refuse dispatch when required governance metadata is absent or incompatible.

## 33. Artifact Handling

Large files SHOULD be passed by governed artifact references rather than embedded repeatedly.

Artifact references MUST include:

- artifact identifier;
- content type;
- size;
- integrity hash when available;
- access scope;
- expiration;
- data classification;
- provider disclosure status.

Provider-uploaded file identifiers MUST be scoped to the provider configuration and MUST NOT be reused across tenants without explicit support and authorization.

## 34. Observability

Every provider call MUST emit or link the following telemetry:

- request ID;
- mission ID;
- execution node ID;
- provider and configuration IDs;
- model identity and revision;
- adapter version;
- start and end times;
- queue, connection, first-token, and total latency when available;
- attempt number;
- normalized status;
- error category;
- usage provenance;
- estimated and actual cost;
- region;
- policy profile;
- trace correlation ID.

Prompts, outputs, tool arguments, and artifacts MUST follow data-minimization and redaction policy. Observability does not grant permission to retain sensitive content.

## 35. Audit Record

The audit record MUST be sufficient to reconstruct:

- why the provider configuration was eligible;
- which catalog and capability revisions were used;
- which pricing snapshot applied;
- what normalized request controls were requested;
- what transformations the adapter performed;
- which provider-specific extensions were used;
- what usage and cost were reported;
- what failures, retries, cancellations, or fallbacks occurred;
- whether policy or approval restrictions affected execution.

## 36. Provider-specific Extensions

Extensions MUST be namespaced.

```ts
extensions: {
  "provider.example/feature-name": {
    enabled: true
  }
}
```

Extensions MUST declare:

- schema;
- lifecycle status;
- cost implications;
- safety implications;
- fallback behavior;
- whether routing depends on the feature;
- whether equivalent behavior exists elsewhere.

Unknown extension fields MUST be rejected in strict mode.

## 37. Adapter Versioning

Adapter versions MUST use semantic versioning or an equivalent governed scheme.

A breaking change includes:

- changed normalized semantics;
- changed capability mapping;
- changed error classification;
- changed usage or cost mapping;
- changed tool behavior;
- changed retention or policy interpretation.

Breaking changes require conformance revalidation and may require benchmark refresh.

## 38. Schema Versioning

All normalized request, response, usage, error, catalog, and audit schemas MUST include a version.

Readers SHOULD support at least the current and immediately previous compatible schema versions during migration.

Unknown future versions MUST fail explicitly rather than being parsed optimistically.

## 39. Deprecation and Replacement

### 39.1 Provider deprecation signal

The integration MUST capture:

- announcement date;
- deprecation date;
- shutdown date;
- affected models or endpoints;
- recommended replacement;
- behavior or pricing differences;
- migration status.

### 39.2 Routing restrictions

Deprecated configurations SHOULD not receive new long-running workloads when a verified replacement exists.

Configurations approaching shutdown MUST receive increasing routing penalties or become ineligible according to policy.

### 39.3 Replacement validation

A recommended provider replacement MUST be treated as a new benchmark subject. Similar naming does not establish equivalent quality, safety, cost, or behavior.

### 39.4 Removal

Removal requires:

- no active executions;
- retained audit readability;
- resolved usage reconciliation;
- catalog tombstone;
- migration or explicit discontinuation decision.

## 40. Conformance Test Suite

Every adapter MUST pass automated tests for all supported capabilities.

Minimum test groups are:

1. provider identity and configuration validation;
2. secret redaction;
3. discovery idempotency;
4. model alias and revision handling;
5. capability mapping;
6. unsupported capability rejection;
7. normalized request translation;
8. text response normalization;
9. streaming order and terminal states;
10. structured-output validation;
11. malformed structured-output handling;
12. tool call mapping;
13. tool schema rejection;
14. side-effect gating;
15. usage mapping;
16. missing and delayed usage handling;
17. pricing snapshot association;
18. cost reconciliation;
19. rate-limit normalization;
20. timeout classification;
21. cancellation behavior;
22. idempotency and duplicate-risk handling;
23. error-category mapping;
24. retry safety;
25. health-state freshness;
26. data-policy eligibility;
27. artifact isolation;
28. telemetry and audit completeness;
29. extension strictness;
30. deprecation handling.

## 41. Contract Test Fixtures

The repository SHOULD include provider-neutral fixtures for:

- simple text completion;
- multimodal input;
- structured JSON success;
- structured JSON failure;
- single tool call;
- parallel tool calls;
- hosted tool usage;
- stream interruption;
- rate limiting;
- authentication failure;
- provider timeout after acceptance;
- delayed usage;
- partial agent completion;
- cancellation with uncertain billing;
- model alias change.

Provider-specific fixtures MUST contain no live credentials or sensitive production content.

## 42. Certification Levels

An adapter MAY be certified at one or more levels.

### Level 0 — Catalog only

Supports governed provider and model metadata. No execution.

### Level 1 — Basic inference

Supports text request/response, errors, usage, health, and cost attribution.

### Level 2 — Advanced generation

Adds streaming, structured output, multimodal data, and normalized citations where supported.

### Level 3 — Tool-capable

Adds governed tool-calling support and complete tool audit linkage.

### Level 4 — Agentic

Adds asynchronous or hosted-agent execution, cancellation, step accounting, and runtime budget enforcement.

Certification MUST be capability-specific. Passing Level 4 does not imply that every lower-level optional feature is supported.

## 43. Initial Zero-or-Low-Cost Implementation

The first implementation SHOULD avoid paid provider calls and use deterministic mock adapters.

Initial components:

```text
packages/
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

services/
  provider-registry/
    src/
      catalog/
      discovery/
      qualification/
      lifecycle/

adapters/
  mock-provider/
    src/
      adapter.ts
      fixtures/
      failure-scenarios/
      conformance/
```

The mock adapter SHOULD support configurable:

- models and capabilities;
- deterministic text output;
- structured-output success and failure;
- streaming events;
- tool-call proposals;
- usage and pricing;
- latency;
- rate limits;
- authentication failure;
- timeouts;
- partial completion;
- delayed usage;
- provider outage;
- deprecation.

## 44. Acceptance Criteria

This specification is implementable when the system can:

1. register multiple provider configurations without core provider-specific code;
2. discover and reconcile model metadata idempotently;
3. preserve concrete model revisions where available;
4. distinguish declared, observed, benchmarked, approved, restricted, and unknown capabilities;
5. reject unsupported requests before billable execution when determinable;
6. obtain credentials through governed secret references;
7. prevent secrets from entering logs and audit payloads;
8. normalize text, structured, streaming, multimodal, and tool-call behavior;
9. validate structured output independently;
10. gate every tool execution through policy and approval;
11. normalize asynchronous and hosted-agent status;
12. attribute usage and cost to execution nodes and pricing snapshots;
13. represent missing usage and unknown pricing explicitly;
14. normalize provider errors and retryability;
15. avoid unsafe duplicate retries after ambiguous timeouts;
16. enforce bounded concurrency and backpressure;
17. expose health, quota, and rate-limit state;
18. enforce provider eligibility using data-policy metadata;
19. produce complete provider execution audit records;
20. pass the conformance suite using deterministic mock adapters;
21. version schemas and adapters explicitly;
22. detect material provider changes;
23. deprecate and replace integrations without changing orchestration contracts;
24. perform the initial implementation without paid provider execution.

## 45. Representative Tests

### Test 1 — Unsupported image input

A text-only model is selected for a request containing an image. The adapter rejects the request before dispatch and returns `unsupported_capability` without cost.

### Test 2 — Alias resolution

A provider alias resolves to a concrete revision. The concrete revision is recorded in execution and audit metadata.

### Test 3 — Structured-output violation

The provider returns invalid JSON. Independent validation fails, the failure is normalized, and any repair attempt is separately recorded and budgeted.

### Test 4 — Stream interruption

A stream stops after partial content. The result remains incomplete, possible billing is recorded, and retry is evaluated for duplicate risk.

### Test 5 — Tool proposal requiring approval

The model proposes a consequential tool call. The adapter returns the proposal but does not execute it. Execution remains blocked until valid approval exists.

### Test 6 — Delayed usage

The provider returns output before final usage. The result is usable but financially unreconciled until usage arrives or the governed timeout is reached.

### Test 7 — Rate limit fallback

The preferred configuration is rate-limited. The normalized condition lets the planner select an eligible alternative without embedding provider-specific logic.

### Test 8 — Ambiguous timeout

A timeout occurs after the provider may have accepted the request. Automatic retry is blocked because idempotency is unknown and duplicate billing is possible.

### Test 9 — Sensitive-data restriction

A configuration with unknown retention policy is excluded from a sensitive request even though the model capability is otherwise sufficient.

### Test 10 — Provider SDK hidden retry

A provider SDK is configured to retry internally. Conformance testing detects that behavior and requires it to be disabled or surfaced to ORIGIN accounting.

### Test 11 — Hosted search usage

A provider-hosted search tool is invoked. Search usage and cost are reported separately from model tokens.

### Test 12 — Cancellation uncertainty

Cancellation is requested but not confirmed. The execution status and possible continuing usage remain explicit.

### Test 13 — Model removal

Discovery no longer returns a model. The catalog marks it unavailable, active runs remain auditable, and routing stops assigning new work.

### Test 14 — Pricing change

A new pricing snapshot becomes effective. New requests use it while historical executions retain the prior snapshot.

### Test 15 — Provider extension

A namespaced provider feature is enabled. Its schema, cost impact, and fallback behavior are validated; an unknown extension is rejected in strict mode.

## 46. Non-Goals for the First Increment

The first increment does not require:

- live integration with every target AI provider;
- automated credential provisioning;
- automatic acceptance of provider claims;
- real consequential tool execution;
- paid benchmark campaigns;
- production-grade multi-region failover;
- provider-specific UI branches.

## 47. Decision Record

The following decisions are binding unless explicitly changed by the product owner:

- Provider adapters are capability-neutral infrastructure boundaries, not routing policy engines.
- Core orchestration code does not depend on provider SDK types.
- Provider names do not substitute for capability evidence.
- Configuration-level policy, region, credentials, quota, and cost matter independently of provider brand.
- Missing capability, price, usage, retention, or policy metadata is represented as unknown, never as favorable.
- Provider-hosted tools and agents remain subject to ORIGIN approval, budget, safety, and audit controls.
- Provider SDK retries must not bypass ORIGIN accounting or retry policy.
- A provider response is not final until normalized, validated, evaluated, and financially reconciled as applicable.
- Provider replacements require qualification and benchmark evidence.
- The original product goal, purpose, and cost conditions remain unchanged.
