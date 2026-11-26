# ORIGIN AQ V2 Trust-Boundary Remediation Architecture

Status: design contract only. No signing key, external evaluator, provider account, secret, or runtime trust configuration has been provisioned by this document.

## Decision

Keep AQ V2 competitive certification blocked until evidence provenance is authenticated outside the evidence packet. Existing schema and digest validation remain useful integrity checks, but are not identity or execution authentication.

Do not retrofit cryptographic claims into the existing V2 boolean fields. Introduce a versioned attestation envelope and a trusted verifier path. Until the verifier has an independently provisioned trust root, the result is NOT QUALIFIED.

## Threat model

Assume a candidate branch, uploaded JSON packet, report generator, or benchmark participant can fabricate every field it controls, including:
- evaluator IDs, judge IDs, reference-system IDs, evidence IDs, timestamps, and artifact digest strings;
- booleans claiming independent execution, blindness, host isolation, network blocking, free-only routing, or zero cost;
- internally consistent answer hashes and pair hashes;
- a plausible result packet with valid schema and complete matrix shape.

The trust system must prevent these self-assertions from becoming trusted evidence.

Out of scope for a simple signature verifier: compromised trusted signer keys, malicious but correctly signed evaluations, provider-side billing misreporting, and physical-device test fraud. These require revocation, reviewer governance, provider reconciliation, and independent sampling.

## 1. Canonical signed evidence envelope

Every signed statement must use one canonical, versioned payload with:
- schemaVersion;
- attestationType (host-execution, evaluator-score, reference-answer, judge-vote, provider-usage);
- keyId and signer role;
- repository full name and exact candidate SHA;
- corpus, rubric, evaluator, and benchmark-round digests;
- artifact digest and immutable artifact locator;
- issued-at and expiry timestamps;
- nonce / unique attestation ID;
- the complete statement-specific payload.

Canonicalization must be deterministic (RFC 8785 JSON Canonicalization Scheme or an equally strict documented encoding). Reject duplicate JSON keys, non-canonical payloads, unknown fields where schema is closed, expired/future attestations, key-role mismatch, wrong candidate/corpus/rubric/round, reused nonce, and digest mismatch.

Use Ed25519 signatures with Node's built-in crypto verifier. Do not add a runtime SaaS dependency. The private key never enters the repository, candidate runtime, PR workflow, or candidate logs.

## 2. Trust registry and signer governance

The trust registry is supplied by the trusted verifier, never by the packet under review. Each entry includes:
- immutable keyId;
- public key bytes and algorithm;
- permitted signer role and scope;
- validity start/end;
- status (active, suspended, revoked);
- approver and change record.

The registry must be protected by CODEOWNERS/review rules in the trusted main branch and be version-bound into every audit report. PR code cannot add or replace a trusted key for its own evaluation.

Key onboarding requires out-of-band identity verification and a challenge-signing ceremony. Key rotation overlaps validity windows; revocation invalidates new and, where necessary, prior attestations. Do not create placeholder keys or claim a reviewer exists before they have independently enrolled.

Required signer roles:
- host attestor;
- absolute answer evaluator (at least two distinct signers per case/axis);
- each reference system's evidence signer or independently authenticated capture operator;
- each blind judge;
- provider usage/cost evidence verifier.

A signer cannot occupy multiple roles in the same comparison round if that would compromise independence.

## 3. Host-execution attestation

Replace caller-provided trustedHostControlled, providerProxyEnforced, freeOnlyEnforced, zeroCostVerified, and network-isolation booleans as trusted facts.

The trusted host creates an attestation after execution. It binds:
- GitHub repository, workflow path/ref, run ID, run attempt, event type, and actor;
- exact candidate SHA and trusted evaluator SHA;
- sealed corpus ID/digest and proof it was not mounted into the candidate process;
- candidate container image digest and runtime policy;
- network allow/deny policy and observed egress;
- provider proxy identity and request count;
- sanitized artifact digest;
- secret exposure/leak scan results;
- cancellation/termination state;
- measured start/end times.

Verify the host attestation against an independently trusted CI identity (e.g. GitHub OIDC-backed artifact provenance) and the actual workflow run. An environment variable copied into a JSON file is not an attestation.

## 4. External answer evaluator, references, and blind judges

### Absolute answer scoring

Require two independent evaluator signatures per candidate answer and each of the ten canonical AQ V2 axes. Bind each score to the exact answer digest, case ID, family, candidate SHA, corpus digest, rubric digest, and round ID.

Record both raw scores, rationales, confidence, and adjudication outcome. Compute inter-rater agreement (Krippendorff's alpha or a justified ordinal-scale alternative). If agreement falls below the predeclared threshold, send the disagreement to a third blinded adjudicator; do not average away disagreement.

### Reference answer provenance

Each reference answer artifact must be signed by a trusted capture identity and include the exact product surface, displayed model/version, plan/tier, timestamp, tools, prompt digest, input digest, response digest, and failure state. A model name typed into JSON is not proof the model ran.

### Blind preference

Each judge signs the complete randomized vote artifact, not a caller-authored row. The trusted randomization service records the concealed mapping and reveals it only after votes are locked. Signatures bind the vote artifact digest, pair digest, candidate answer digest, reference answer digest, rubric, and round.

Judges must be distinct, blinded, and authenticated. Retain ties and losses. No selective reruns.

## 5. Provider cost and usage attestation

A :free model ID, free-tier account, provider status endpoint, or costUsd: 0 JSON field is not proof of an individual request's zero cost.

Before each request:
1. enforce free-only route allowlist and paid fallback disabled;
2. reserve the request against a bounded quota ledger;
3. bind request ID, provider, model, data policy, maximum permitted cost USD 0, and idempotency key;
4. block if the provider cannot give an adequate zero-price authorization signal.

After each request:
1. retain sanitized request/response IDs and usage counters;
2. reconcile provider-side usage/billing evidence against the reserved request;
3. verify no paid model, paid endpoint, overage, or alternate billing path was used;
4. sign the reconciliation result with a trusted verifier identity.

If the provider cannot provide request-level zero-price proof, mark cost UNKNOWN and do not execute the competitive live round. A post-hoc costUsd: 0 field generated by the candidate is not acceptable.

## 6. Statistical qualification

For each named opponent, preserve paired task-level outcomes and report:
- wins, ties, losses, and denominators;
- per-family breakdown;
- paired effect size;
- task-clustered 95% confidence intervals (cluster by task/case, not by repeated judge votes);
- judge agreement and adjudication rate;
- missing, refused, failed, timed-out, and incomplete cases.

Do not treat each judge vote as an independent task. Pre-register the primary outcome and analysis. Superiority requires the predeclared confidence interval and effect-size criterion to support an advantage against each opponent; pooled averages cannot hide an opponent-specific loss.

## 7. Migration sequence

1. Freeze current V2 outputs as untrusted historical records; do not silently upgrade their trust label.
2. Implement a pure Ed25519 envelope verifier and canonical payload module with adversarial unit tests.
3. Implement a protected trust registry with empty-by-default enrollment; no signer is trusted until independently verified.
4. Add host-run attestation creation and independent verification against the workflow run and artifact digest.
5. Add reference/evaluator/judge signed artifact intake and identity binding.
6. Add provider usage/cost reconciliation. Keep live inference disabled until the provider evidence contract is satisfied.
7. Add two-scorer absolute AQ scoring, inter-rater agreement, and blinded adjudication.
8. Add task-clustered statistical reporting and per-opponent qualification.
9. Run adversarial forgery, replay, key-rotation, expiry, digest-tamper, cross-SHA, cross-round, and role-confusion tests.
10. Execute a fresh sealed round only after every preceding gate passes.

## 8. Mandatory fail-closed tests

At minimum, tests must reject:
- forged signer ID with no valid signature;
- valid signature from an unknown, revoked, expired, or wrong-role key;
- altered payload or artifact bytes after signing;
- duplicate JSON keys or non-canonical serialization;
- signature replay against another candidate SHA, corpus, rubric, or round;
- reused nonce or attestation ID;
- evaluator key used as a judge or host key;
- one person/key counted as two independent scorers;
- missing second scorer, disagreement below threshold, or absent adjudication;
- host attestation whose workflow/run/actor/ref differs from GitHub evidence;
- candidate-generated host booleans without a verified host signature;
- provider request lacking a pre-request reservation or zero-price authorization;
- post-request usage evidence with missing/paid/over-limit/contradictory charges;
- missing competitor run or selectively dropped failed case;
- confidence interval that does not support the declared superiority claim.

## Current disposition

- V2 schema/digest/matrix checks: useful structural controls, not independent identity authentication.
- Signed host attestation: NOT IMPLEMENTED / NOT VERIFIED.
- External evaluator and judge trust registry: NOT PROVISIONED.
- Provider request-level cost reconciliation: NOT VERIFIED.
- Two-scorer absolute scoring and inter-rater agreement: NOT ENFORCED.
- Task-clustered confidence intervals per opponent: NOT IMPLEMENTED.
- Competitive certification: NO-GO.

No keys, secrets, paid services, cloud resources, production settings, merges, or deployments are created or changed by this plan.
