# ORIGIN Provider HTTP Attempt Ledger v1 — Architecture Decision

Date: 2026-11-03
Status: design decision; implementation intentionally deferred pending persistence and runtime-boundary review
Related PR: #1083 — shared cost evidence state
Decision owner: ORIGIN project

## Executive decision

Do not claim that ORIGIN has a complete request ledger today. Do not issue `ZERO_COST_VERIFIED` from an in-memory counter, provider response field, synthetic benchmark value, or this design.

The current transport performs retries inside `src/legacy/originProviderClient.ts` and can move through multiple OpenRouter policy stages. The AQ HTTP adapter observes an application-level invocation and reads `routing.providerAttempts`; that is not a record of each outbound HTTP attempt. A correct ledger must be written at the final HTTP egress boundary, immediately around each actual `fetchImpl(...)` invocation.

A durable append-only server-side sink has not been established in this PR. The Vercel serverless runtime must not be treated as durable storage: process memory, module globals, local files, logs, and client-side IndexedDB are not an authoritative append-only billing ledger. Do not add a paid database, paid logging product, new cloud resource, account upgrade, or external service to solve this without explicit owner approval and a proven $0.00 operating model. Until an existing approved durable sink is identified and its retention/integrity semantics are verified, the ledger implementation remains blocked. An ephemeral diagnostic observer may be useful for tests, but it must never be called a durable ledger or billing proof.

## Scope and non-goals

In scope:
- One host-generated logical execution ID per ORIGIN execution.
- One unique attempt ID per actual outbound HTTP request.
- Recording retries, policy-stage attempts, terminal outcomes, HTTP status, transport errors, and provider response identifiers when present.
- Explicitly separating host-observed events from provider-authenticated billing evidence.
- Fail-closed reconciliation inputs and measurable coverage.

Out of scope:
- Creating or enabling a provider billing verifier.
- Claiming a provider response is cryptographically signed.
- Enabling OpenRouter Management API, purchasing a plan/credit, using BYOK, or adding paid fallback.
- Capturing prompts, completions, tool arguments, authorization headers, API keys, cookies, or raw response bodies.
- Treating host ledger completeness as proof that the provider charged $0.00.

## Observed transport facts

Source reviewed at PR head:
- `src/legacy/originProviderClient.ts`
- `src/lib/orchestration/OriginAnswerQualityBenchmarkHttpRuntimeAdapters.ts`

The transport helper invokes the injected fetch implementation up to three times for retryable transport/HTTP failures. The OpenRouter request loop iterates the configured zero-cost policy stages and may issue another provider request for selected 403/404 outcomes. Therefore:
- one call to `executeOriginProvider` is not necessarily one HTTP attempt;
- one AQ `providerRequests` value is not an attempt-level ledger;
- a response can be absent even though an outbound request was sent;
- every retry and every policy-stage request must receive its own attempt ID;
- a logical execution may have multiple attempts, and all attempts must be accounted for before reconciliation.

### Free-quota retry guard added 2026-11-03

OpenRouter's current Free-plan documentation states that `:free` variants are limited to 20 requests/minute and 50 requests/day (unless the account has purchased credits); failed attempts also count toward the daily cap. The app's non-stream transport previously treated HTTP 429 as retryable, which could issue up to three requests after quota exhaustion. The non-stream and stream clients now classify 429 as non-retryable, preserve the provider's `Retry-After` value, and retain the one actual send in the transport counter. Regression tests assert exactly one outbound send for 429 in both paths. This is a quota-preservation change, not proof of $0.00 actual spend.

Other transient transport failures (for example selected 5xx/network/timeouts) retain bounded retry behavior. Each actual send still requires its own durable attempt ID/event; the in-process transport counter does not satisfy the append-only ledger or provider reconciliation contract.

## Event model

Use two distinct identifiers:
- `executionId`: host-generated opaque ID for one logical ORIGIN execution.
- `attemptId`: host-generated opaque ID for exactly one call to the provider transport.

Proposed event fields (allowlist only):
- `schemaVersion`: `origin.provider-attempt.v1`
- `sequence`: monotonic sequence within the execution, assigned by the authoritative sink
- `executionId`, `attemptId`
- `startedAt`, `finishedAt` (UTC RFC3339; preserve clock-quality metadata)
- `providerId`: canonical provider identity, e.g. `openrouter`
- `requestedModelId`, `servedModelId` (served model nullable until a valid response is parsed)
- `policyStageId`: stable local stage identifier, never raw policy object
- `retryIndex`: integer starting at zero for each transport call
- `outcome`: `HTTP_RESPONSE`, `NETWORK_ERROR`, `TIMEOUT`, `ABORTED`, `RESPONSE_PARSE_ERROR`
- `httpStatus`: integer or null
- `providerRequestId` / `generationId`: only if the provider documents and returns a stable identifier; otherwise null
- `usageTelemetryPresent`: boolean
- `providerReportedCostUsd`: parsed finite decimal string or null; telemetry only, never proof
- `providerReportedIsByok`: boolean or null
- `idempotencyKeyRef`: opaque reference only if an official idempotency mechanism is supported and used
- `eventDigest`: digest over canonical allowlisted event fields, computed by the trusted sink

Do not record arbitrary headers, request/response bodies, prompts, completions, tool schemas/arguments, environment variables, API-key fragments, user identifiers, or unbounded provider error text. Error classes should be normalized to a bounded enum. Never log bearer tokens or raw URLs containing query strings.

## Required lifecycle

1. Create the logical execution ID before entering provider execution.
2. Before each actual outbound fetch, allocate a fresh attempt ID and append a `STARTED` event.
3. Invoke the transport.
4. Append exactly one terminal event for that attempt: HTTP response, network failure, timeout, or abort.
5. If the process exits between start and terminal append, the sink must retain an unmatched `STARTED` event; reconciliation treats it as incomplete, not as zero cost.
6. Retries and policy-stage transitions create new attempt IDs; they never overwrite a previous attempt.
7. At logical execution completion, append a closure record containing expected attempt count and the ordered attempt-ID digest.
8. A closure record is not provider billing evidence. It only proves the host's recorded execution boundary if the sink's own integrity controls are trusted.

The event sink must support atomic append, unique attempt IDs, ordered sequence allocation, durable acknowledgement, bounded retention, and explicit failure behavior. If the sink cannot durably acknowledge a start event, ORIGIN must not silently proceed while claiming complete ledger coverage. The product-level availability policy for that case must be decided separately; it must not weaken the $0.00 release gate.

## Reconciliation contract

For a bounded execution window, require:
- every host attempt has exactly one terminal event;
- every attempt is associated with one execution and one expected provider/model identity;
- no duplicate attempt IDs, duplicate provider generation IDs where uniqueness is expected, or sequence gaps;
- no stale/unclosed executions;
- every provider generation/request record is mapped to exactly one host attempt, where the provider exposes such records;
- no provider record remains unmatched;
- no host attempt remains unmatched;
- usage coverage includes every applicable cost dimension, not only inference token cost;
- provider-reported totals and request-level values agree with the authoritative provider activity/export source;
- the evidence source is actually available on the approved Free plan and does not require management-plan access, paid credits, BYOK, or a paid fallback.

If the provider does not expose enough authenticated data to meet these conditions, result remains `NOT_MEASURED` or `BLOCKED_UNVERIFIED`. An exact host-side ledger alone cannot mint `ZERO_COST_VERIFIED`.

## Integrity, privacy, and replay controls

- Sink assigns sequence numbers; callers cannot supply or reset them.
- Enforce unique `attemptId` and append-only semantics; updates/deletes are prohibited for accepted events.
- Canonicalize and hash the allowlisted event representation; hash chains alone do not provide authenticity if the writer can rewrite the whole store.
- Protect sink credentials and trust roots outside application input; never put them in source code or client state.
- Reject duplicate/replayed provider receipt IDs and expired evidence windows.
- Treat wall-clock timestamps as advisory unless the sink provides trusted time; preserve monotonic ordering independently.
- Bound all strings, arrays, and event rates to prevent resource exhaustion.
- Minimize retention and document deletion/retention rules before storing events.

## Failure matrix

| Condition | Required classification |
|---|---|
| Start append fails or is not durably acknowledged | Ledger incomplete; block cost verification |
| Terminal event missing | `BLOCKED_UNVERIFIED / INCOMPLETE_REQUEST_LEDGER` |
| Retry occurs | New attempt ID and new event pair |
| 403/404 causes policy-stage change | New attempt ID; retain prior attempt |
| Provider response has no usage cost | `NOT_MEASURED` or blocked; never infer zero |
| Provider reports nonzero cost | Reject $0.00 policy execution |
| Provider record is delayed or absent | `BLOCKED_UNVERIFIED / RECONCILIATION_FAILED` |
| Duplicate or replayed receipt | `BLOCKED_UNVERIFIED / REPLAY_DETECTED` |
| Provider/model identity mismatch | `BLOCKED_UNVERIFIED / CONTRADICTORY_EVIDENCE` |
| Sink outage or sequence gap | Incomplete ledger; block verification |
| Only an in-memory observer exists | Diagnostic telemetry only; not a ledger |

## Test acceptance matrix

Before production integration, add deterministic tests for:
1. one successful fetch produces exactly one start and one terminal event;
2. retryable 500/503/network failures produce one distinct attempt per actual fetch;
3. retry exhaustion retains all attempts and the final error;
4. 403/404 policy-stage transition creates a new attempt rather than mutating the old one;
5. timeout and abort produce terminal outcomes;
6. a crash/missing terminal event is detected as incomplete;
7. duplicate attempt IDs and sequence gaps are rejected;
8. missing usage fields never become zero;
9. nonzero, negative, NaN, Infinity, malformed, and string-coerced cost values are rejected or classified unverified;
10. served-provider/model mismatch is rejected;
11. duplicate/replayed provider receipt IDs are rejected;
12. delayed and unmatched provider records block reconciliation;
13. non-inference dimensions (tools, search, image, audio, cache, platform fees) are either covered by authoritative evidence or explicitly block verification;
14. prompts, completions, secrets, headers, and tool arguments never appear in serialized events;
15. sink append failure is observable and cannot be reported as successful ledger coverage;
16. event size/rate limits are enforced.

## Downstream release-gate migration

Plain booleans such as `zeroCost: true` are not trusted evidence. Any product release gate that still accepts a caller-supplied boolean must be migrated before it consumes this ledger. The gate should require an evidence object/status produced by a trusted verifier, a reference to the reconciliation window, and a complete coverage result. Do not accept a serialized `ZERO_COST_VERIFIED` claim from client/API payloads.

## 20-step execution checklist

1. Refresh PR #1083 state and exact head SHA.
2. Refresh exact-head workflow runs; distinguish success, in-progress, skipped, and missing.
3. Enumerate all changed paths in the PR.
4. Read the current cost-evidence type and confirm there is no public zero-cost issuer.
5. Read the provider transport implementation.
6. Locate the actual fetch boundary.
7. Count transport retry branches.
8. Count policy-stage branches that can issue additional fetches.
9. Compare AQ invocation-level request counting with actual fetch attempts.
10. Confirm the provider response's usage/cost fields are unsigned provider telemetry.
11. Confirm the current provider Free-plan evidence limitation from the provider capability audit.
12. Identify the missing durable sink as a blocking dependency.
13. Reject in-memory, process-local, client-side, and local-file substitutes as authoritative ledgers.
14. Define execution and attempt identifiers.
15. Define the allowlisted, privacy-minimized event schema.
16. Define start/terminal event pairing and crash semantics.
17. Define retry, policy-stage, timeout, and network-error behavior.
18. Define exact reconciliation and replay/integrity requirements.
19. Define regression/security tests and downstream boolean-gate migration.
20. Record the implementation gate: do not integrate or mint verified cost until an approved durable sink and Free-plan-compatible authoritative provider evidence source are proven.

## Current release decision

- Provider attempt ledger: NOT IMPLEMENTED.
- Durable append-only sink: NOT ESTABLISHED.
- Authenticated provider billing receipt: NOT ESTABLISHED.
- Complete provider-to-host reconciliation: NOT ESTABLISHED.
- `ZERO_COST_VERIFIED`: MUST REMAIN UNREACHABLE.
- AQ cost evidence: `NOT_MEASURED`.
- Release: NO-GO for any claim requiring independently verified $0.00.
- No paid service, plan upgrade, new cloud resource, merge, or deployment is authorized by this document.


## Existing persistence reuse assessment — 2026-11-03

A read-only review checked whether ORIGIN can safely reuse an already-approved durable store instead of introducing a new database or paid service.

### Findings

- The repository's V1.4 production-readiness record states that the existing Supabase project `origin-personal` has the V1.4 coding-job and encrypted-result migrations applied, with RLS enabled and direct browser-role privileges revoked.
- The same readiness record states that the Vercel production runtime does **not** currently expose a parseable PostgreSQL URI through `POSTGRES_URL`, `DATABASE_URL`, or `SUPABASE_DB_URL`; its status remains `databaseReady=false`, `storeConfigured=false`, and `resultStoreConfigured=false`. A database visible through a management interface is not evidence that the Vercel runtime can reach it.
- The existing `origin_coding_jobs_v14` schema is a lifecycle/queue table, not an append-only provider-attempt journal. It permits status/attempt updates and has a bounded job lifecycle. The result table is encrypted result storage and has cancellation cleanup that deletes result evidence. Reusing either table for immutable provider billing evidence would violate their current data model and retention semantics.
- The existing DB URL resolver accepts only the three server-side PostgreSQL environment candidates and intentionally fails closed. No credential or environment value was inspected during this review.
- The repository's sanitized execution-trace design also states that process-memory sinks are test-only and that a production sink requires explicit retention, access-control, deletion, failure-policy, and owner-approval decisions.

### Decision

Do **not** reuse the V1.4 coding tables for provider attempts. Do **not** configure or expose database credentials, enable a new connection, alter RLS, create migrations, or provision another resource as part of this PR. Runtime database connectivity is currently unverified/unavailable according to the existing readiness record, and the existing tables are semantically unsuitable for append-only billing evidence.

The implementation gate remains blocked pending (1) explicit owner approval of a specific already-existing durable sink, (2) proof that its use adds no cost and does not require account/secret/configuration changes beyond separately approved actions, (3) a dedicated append-only schema with atomic durable acknowledgements and retention controls, and (4) independent security review. Until then, use only ephemeral test observers for transport tests and never call them a ledger or cost proof.

### Verification boundary

This was a source/documentation review only. No production status endpoint was called, no database connection was attempted, no credentials were read, and no Supabase/Vercel settings or schema were changed. The readiness statements above are repository-recorded evidence, not a fresh live production measurement.
