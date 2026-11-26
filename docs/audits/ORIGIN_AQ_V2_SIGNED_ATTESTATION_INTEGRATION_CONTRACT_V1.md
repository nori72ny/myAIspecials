# AQ V2 Signed Attestation Integration Contract V1

Status: implementation contract; NOT an implementation or qualification result.

This document defines the minimum fail-closed integration required before AQ V2 may describe a score bundle, execution, reference answer, blind judgement, or provider cost as independently authenticated.

## 1. Current boundary

`OriginEvidenceAttestationV1.ts` supplies an Ed25519 envelope verifier. It is a verification primitive only. It does not establish who controls a public key, provision an out-of-band trust registry, prove that an artifact's bytes match a declared digest, or change the result of `qualifyOriginTrustedAnswerQualityV2`.

The current AQ V2 qualifier still accepts a structured evaluator record with self-asserted identity fields. The trusted-run aggregator also derives `zeroCostVerified` from submitted case fields. Neither behavior is independent evidence. Until the integration below is implemented and tested, the AQ result MUST remain NOT QUALIFIED / NOT MEASURED for external certification, and zero-cost MUST remain UNVERIFIED.

## 2. Artifact identity and digest

1. Define one versioned, deterministic serialization for the complete score bundle. Reject unsupported values, non-finite numbers, duplicate JSON keys, and non-canonical encodings.
2. Hash the exact UTF-8 artifact bytes with SHA-256. The expected digest MUST be computed by the verifier from those bytes; never accept a digest supplied only by the candidate.
3. Parse the same bytes, validate the parsed schema, and ensure the verifier passes only that parsed object to the existing scoring function. Do not hash one object and score another.
4. Bind each attestation to the exact repository, 40-character candidate SHA, corpus digest, rubric digest, round ID, and computed artifact digest.
5. Do not accept a detached score bundle or a digest string without the corresponding artifact bytes.

## 3. Independent absolute scoring

A passing absolute-quality qualification requires at least TWO valid evaluator-score attestations:
- Each key is enrolled in a verifier-controlled trust registry through an out-of-band identity process.
- Each signer has the `absolute-evaluator` role and a distinct signer ID AND key ID.
- Both attestations bind to the exact same score artifact digest and all expected run bindings.
- Both attestations must be valid at verification time, unrevoked, correctly signed, and successfully claimed in an atomic nonce ledger.
- The evaluator identities must be independent of the candidate team and of each other. Cryptographic key distinctness alone does not prove organizational independence; registry enrollment must record and enforce that relationship.
- If the two score artifacts disagree, the system must preserve both results and apply a predeclared adjudication policy. It must not silently select the more favorable score.

Only after all required attestations validate may the trusted qualification adapter call `qualifyOriginTrustedAnswerQualityV2`. The legacy self-declared evaluator object MUST NOT independently authorize a pass.

## 4. Separate evidence roles

Keep evidence channels separate. A signature for one role cannot satisfy another:
- `host-execution` / `host-attestor`: exact candidate execution, isolated environment, network controls, artifact provenance, and sanitized logs.
- `evaluator-score` / `absolute-evaluator`: independently produced rubric scores for the exact score artifact.
- `reference-answer` / `reference-capture`: provenance and digest of reference answers captured before candidate evaluation.
- `judge-vote` / `blind-judge`: blinded pairwise judgement, randomized presentation, and recorded vote artifact.
- `provider-usage` / `provider-cost-verifier`: provider-side usage and billing evidence for the exact request IDs and measurement window.

The integration must reject missing roles, duplicate role substitution, signer/key reuse across roles where separation is required, cross-SHA substitution, cross-round substitution, stale/revoked keys, expired attestations, invalid signatures, malformed payloads, and replayed nonces.

## 5. Nonce and trust-registry requirements

- The trust registry is provisioned outside candidate-controlled code and artifacts.
- Registry records include key ID, signer ID, role, public key, validity interval, revocation state, and documented independence/ownership metadata.
- Duplicate key IDs or conflicting signer/role records fail closed.
- Nonce claims use an atomic uniqueness constraint in a trusted durable store. An in-memory set or check-then-write sequence is insufficient.
- Verify attestations sequentially when nonce claims are side effects. A failed claim or ledger outage aborts qualification.
- Trust registry or nonce-ledger unavailability means NOT QUALIFIED, not a degraded pass.

## 6. Honest zero-cost evidence

A policy flag such as `freeOnly`, a configured maximum cost of zero, a local `costUsd: 0` field, or a provider's free-tier marketing statement does NOT prove actual request cost.

A request may be labelled ZERO-COST-VERIFIED only when all of the following exist:
1. A trusted host attestation listing exact request IDs, provider, model, timestamps, and the enforced no-paid-fallback policy.
2. A provider-origin usage/billing record covering those exact request IDs and the relevant billing window, authenticated by an enrolled `provider-cost-verifier`.
3. A reconciliation showing no billable usage, no credits consumed where credits have economic value, no paid fallback, and no unaccounted requests.
4. A declared evidence coverage window and explicit limitations. Missing or delayed billing data remains UNVERIFIED.
5. A test proving that uncertainty, missing records, positive spend, or provider mismatch fails closed before the run is marked qualified.

Do not issue live provider requests merely to test this path unless the request is independently proven to cost exactly $0.00 before execution. No paid fallback is permitted.

## 7. Required adversarial test matrix

At minimum, test:
- one evaluator only; duplicate signer ID; duplicate key ID; two keys controlled by one enrolled identity;
- signature tampering; payload tampering; duplicate JSON keys; non-canonical bytes;
- artifact bytes changed after digesting; digest supplied by candidate; parsed-object/hashed-byte mismatch;
- wrong repository, candidate SHA, corpus digest, rubric digest, round ID, or artifact digest;
- wrong role, role substitution, revoked key, out-of-window key, expired envelope;
- nonce replay under sequential and concurrent verification; ledger outage;
- missing host, reference, judge, or provider-usage attestation;
- provider usage record missing, incomplete, delayed, mismatched, positive-cost, or unsupported;
- legacy self-asserted evaluator metadata attempting to pass without signatures.

Each negative case must assert a stable blocker code and no qualified result. Add positive tests only with test keys and a deterministic fake nonce ledger; never commit production private keys.

## 8. Acceptance gates

- Unit tests cover every matrix row above.
- Typecheck, unit, integration, production build/runtime, CodeQL, OpenSSF Scorecard, and exact-head release CI all pass.
- No external inference, paid API, secret, cloud resource, production setting, merge, or deployment is needed for the verifier unit tests.
- A separate security review validates trust enrollment and nonce-ledger deployment before any real certification run.
- A valid test fixture proves the complete adapter path; it does not establish real-world evaluator independence or provider $0.00.
- Public competitive claims remain prohibited until a preregistered, blinded, same-condition comparison has been executed and independently reviewed with task-clustered uncertainty.

## 9. Evidence labels

- CODE-PROVEN: source implementation establishes the stated behavior.
- TEST-COVERED: a deterministic test covers the behavior.
- EXECUTED: the exact candidate SHA completed the relevant runtime procedure.
- UNVERIFIED: evidence is absent, self-asserted, incomplete, or not independently authenticated.

Never promote UNVERIFIED to EXECUTED or ZERO-COST-VERIFIED based on configuration, schema shape, or a passing unit test alone.


## 10. Source-level audit: benchmark execution and cost path

The following existing source paths were inspected on `main` (baseline `a43e91cbe96f07b8743735534c0d76ebd63f76df`) and the corresponding environment-proof changes in PR #1073:

- `src/lib/orchestration/OriginAnswerQualityBenchmarkRunner.ts`
- `src/lib/orchestration/OriginAnswerQualityBenchmarkHttpRuntimeAdapters.ts`
- `src/lib/orchestration/OriginAnswerQualityBenchmarkRunProvenance.ts`
- `src/lib/orchestration/OriginAnswerQualityBenchmarkSession.ts`
- `src/lib/orchestration/OriginAnswerQualityBenchmarkTwoPhaseSession.ts`
- `src/lib/orchestration/OriginAnswerQualityBenchmarkEnvironmentProof.ts`

Confirmed implementation boundary:

1. The runner's `validExecution` accepts an execution record when its caller-supplied `costUsd` is exactly numeric zero. It does not verify a provider-signed usage record or billing statement.
2. `runOriginAnswerQualityBenchmarkExecutionOnly` constructs the aggregate with `totalCostUsd: 0` after those local checks. The aggregate digest then commits to that locally constructed value; hashing does not authenticate its origin.
3. `createOriginAnswerQualityBenchmarkRunProvenance` validates the literal `totalCostUsd === 0` and returns a typed zero-cost provenance object. It does not receive provider billing evidence.
4. The HTTP adapters consume response fields such as `routing.actualCostUsd`, `usage.costUsd`, research `body.costUsd`, or artifact response headers. These are application response assertions, not independently authenticated provider-side billing records in the inspected implementation.
5. PR #1073 correctly changes environment proof semantics to `maxPermittedCostUsd: 0` and deliberately rejects `costUsd` in `/api/health`. This is a policy ceiling, not proof of actual request cost. The downstream runner and provenance path still require a separate authenticated cost-evidence integration.
6. In the inspected HTTP adapter, research execution evidence currently records `providerRequests: 0`; request counts and exact provider request IDs therefore also need an authoritative host-side request ledger before billing reconciliation can be complete.

Required implementation change before any ZERO-COST-VERIFIED label:

- Replace locally asserted per-case `costUsd` as the certification authority with a required verified-evidence reference produced by a trusted host/provider reconciliation adapter.
- Bind exact request IDs, provider/model identifiers, timestamps, run ID, candidate SHA, and billing coverage window to a signed provider-usage attestation.
- Derive aggregate cost only by reconciling the complete request ledger against authenticated provider usage/billing records; never initialize or hardcode the certified aggregate to zero.
- Missing request IDs, missing/delayed billing records, unsupported providers, incomplete coverage, nonzero usage, or verifier/ledger failure must return a stable blocker and prevent qualification.
- Keep `maxPermittedCostUsd: 0` as a pre-execution policy guard, not as an actual-cost assertion.

Evidence classification: CODE-PROVEN for the local zero-value construction and response-field checks described above; UNVERIFIED for actual provider billing and $0.00. No live inference was performed.

## 11. Provider usage gate prototype status (2026-11-03)

A fail-closed prototype was added in PR #1079:

- `src/release/OriginProviderUsageAttestationGateV1.ts` verifies a `provider-usage` Ed25519 attestation through the V1 verifier and checks the dedicated `provider-cost-verifier` role.
- The signed statement binds run ID, provider ID, model ID, billing-window start/end, and a completeness marker.
- The gate reconciles the provider request IDs exactly against the independently supplied host request-ID ledger. Missing, extra, duplicate, malformed, wrong-provider/model, out-of-window, or nonzero-cost rows block.
- `src/release/OriginProviderUsageAttestationGateV1.test.ts` adds deterministic tests for valid reconciliation, missing and duplicate IDs, positive cost, wrong run, billing-window mismatch, empty trust, missing nonce ledger, and replay rejection.

Current evidence classification:
- CODE-PROVEN: prototype implements the above fail-closed checks on its input contract.
- TEST-COVERED: adversarial test cases are authored, but the exact PR head has no completed CI evidence yet.
- UNVERIFIED: no provider-origin billing adapter, independently provisioned host request ledger, enrolled production trust key, or durable atomic nonce service is connected.
- NOT INTEGRATED: the AQ runner, frozen session, provenance constructor, and final qualification gate do not yet require this prototype. Existing local `totalCostUsd: 0` construction remains a certification blocker.

The prototype is not a zero-cost certification and must not be used to authorize live inference. It is a component awaiting a trusted evidence source and runner integration. PR #1079 is a draft and must pass exact-head CI and code review before further integration.
