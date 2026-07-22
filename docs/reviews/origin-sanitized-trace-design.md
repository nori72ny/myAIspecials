# ORIGIN Sanitized Execution Trace Contract

Status: design-only; not a production persistence implementation.

## Purpose

Define the minimum privacy-safe record needed to correlate planning, transmission policy, provider execution, verification, cost, and outcome for the authoritative `POST /api/chat` path.

This contract must not be treated as proof that durable storage already exists.

## Required properties

A trace record must:

- use the server-generated request/trace identifier;
- contain no full prompt, response body, credential, token, secret value, cookie, authorization header, provider response body, or raw IP address;
- record only enumerated policy outcomes and bounded numeric metadata;
- distinguish local-only handling, blocked transmission, rejected policy, provider failure, and accepted provider output;
- record the provider and model actually accepted after routing verification;
- record estimated and actual cost separately;
- record whether independent verification was required, skipped, passed, failed, or not run;
- be append-only after finalization, except for an explicit retention deletion operation;
- fail closed if trace persistence is mandatory and the configured sink cannot accept the record.

## Sanitized schema

```ts
export interface OriginExecutionTraceRecord {
  schemaVersion: "origin-execution-trace-v1";
  traceId: string;
  startedAt: string;
  completedAt: string;
  outcome:
    | "local-only"
    | "sensitive-input-blocked"
    | "context-rejected"
    | "policy-rejected"
    | "provider-failed"
    | "accepted";
  transmission: "not-attempted" | "attempted";
  policy: {
    freeOnly: true;
    maxEstimatedCostUsd: 0;
    timeoutMs: number;
    modelEvidenceStatus: "current" | "stale" | "invalid" | "not-applicable";
  };
  execution?: {
    providerId: string;
    modelId: string;
    fallbackUsed: false;
    estimatedCostUsd: number;
    actualCostUsd: number;
    inputTokens?: number;
    outputTokens?: number;
  };
  verification: {
    status: "not-required" | "not-run" | "pending" | "passed" | "failed";
    reviewerCount: number;
  };
  context?: {
    policyVersion: string;
    includedMessageCount: number;
    includedCharacterCount: number;
    omittedMessageCount: number;
    omittedCharacterCount: number;
  };
  errorCode?: string;
}
```

## Prohibited fields

The persisted representation must reject unknown fields and specifically prohibit:

- `prompt`, `goal`, `messages`, `content`, `answer`, `responseBody`;
- `apiKey`, `token`, `password`, `secret`, `authorization`, `cookie`;
- provider request and response payloads;
- unbounded diagnostic strings or stack traces;
- model-generated reasoning or hidden chain-of-thought.

## Persistence boundary

Persistence must be injected behind a narrow interface rather than embedded in the route:

```ts
export interface OriginExecutionTraceSink {
  append(record: OriginExecutionTraceRecord): Promise<void>;
}
```

No sink should be selected implicitly. A process-memory sink is test evidence only and is not durable. Browser local storage is device-local and must not be described as a server audit log. A production sink requires an explicit retention period, access control, deletion procedure, failure policy, and owner approval before configuration.

## Required tests before enablement

- accepted zero-cost execution records the exact verified provider/model and costs;
- sensitive input records only the block category and never the source value;
- invalid execution policy records no provider attempt;
- stale or invalid free-model evidence records no provider attempt;
- provider timeout and normalized provider errors omit upstream bodies;
- trace sink failure follows the configured fail-closed policy;
- schema validation rejects prohibited and unknown fields;
- bounded storage and retention tests prevent unbounded accumulation;
- concurrent requests cannot overwrite or cross-associate trace identifiers.

## Current disposition

The authoritative chat response already exposes a trace identifier and sanitized routing metadata, but no reviewed durable sink is configured. Therefore the unified durable-trace requirement remains open, and owner acceptance remains blocked.

## Restrictions

- No merge or deployment authorization.
- No database, cloud, account, DNS, billing, credential, or repository-setting change.
- No real provider request or paid execution.
