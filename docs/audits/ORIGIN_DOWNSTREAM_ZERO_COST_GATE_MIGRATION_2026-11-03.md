# ORIGIN Downstream Zero-Cost Gate Migration — 2026-11-03

Status: implementation committed to PR #1083; exact-head CI pending after these changes.
Scope: answer world-class, product-quality, and held-out coding qualification paths.
Release posture: fail closed. No trusted provider billing verifier or durable attempt ledger exists.

## Engineering checkpoints

1. Re-read PR #1083 metadata and confirmed the branch head before editing.
2. Re-read exact-head check runs; the previous head's TypeScript, unit, API, build, Node runtime, Serverless runtime, CodeQL, and Scorecard Analysis jobs had completed successfully.
3. Confirmed Scorecard itself still reports a NEUTRAL warning for missing main-branch configuration evidence; this is not a clean all-checks pass.
4. Inspected `OriginAnswerWorldClassGateV2` and found that `liveProviderRunCompleted && zeroCost` promoted a caller-supplied boolean into billing proof.
5. Changed the answer world-class gate so caller booleans cannot set `liveEvidencePassed`; it now emits `AQ_V2_ZERO_COST_NOT_PROVEN` until a trusted verifier is wired.
6. Preserved the old boolean input as deprecated compatibility shape to avoid silently changing upstream packet parsing in this step.
7. Added regression coverage proving `zeroCost: true` does not pass the answer world-class gate.
8. Inspected `OriginTrustedWorldClassQualityGateV2`; it forwards the legacy boolean and therefore inherits the fail-closed result from the lower-level gate.
9. Inspected `OriginProductQualityGateV1`; both AQ and Coding subdomains accepted caller-supplied `zeroCost: true`.
10. Added explicit `AQ_ZERO_COST_EVIDENCE_UNVERIFIED` and `CODING_ZERO_COST_EVIDENCE_UNVERIFIED` blockers.
11. Forced answer and coding product-quality acceptance to remain false until a trusted `ZERO_COST_VERIFIED` issuer is connected; quality metrics remain separately evaluated.
12. Marked both legacy `zeroCost` boolean fields deprecated and documented that caller booleans are not provider billing evidence.
13. Updated Product Quality tests so even complete-looking quality packets with `zeroCost: true` remain blocked.
14. Updated malformed-input and Claude Code parity scenarios to assert that parity evidence cannot bypass the independent billing gate.
15. Inspected `HeldOutFinalEvidenceV14` and found that every row's numeric `costUsd === 0` was treated as zero-cost eligibility.
16. Changed held-out final evidence to expose `costEvidenceStatus: NOT_MEASURED` and append `billing-not-measured`; numeric zero telemetry no longer qualifies the run.
17. Retained `totalCostUsd` only as a deprecated compatibility aggregate; it is not a billing attestation.
18. Changed V1.5 trusted-candidate Coding qualification so it cannot derive `zeroCost: true` from the numeric aggregate and cannot pass while held-out billing remains unmeasured.
19. Updated held-out and V1.5 regression tests to distinguish performance success from cost evidence; performance can be reported, but qualification remains blocked.
20. Kept PR #1083 Draft, unmerged, and undeployed; no provider calls, paid resources, secrets, account settings, cloud provisioning, or production changes were performed.

## Files changed in this migration

- `src/release/OriginAnswerWorldClassGateV2.ts`
- `src/release/OriginAnswerWorldClassGateV2.test.ts`
- `src/release/OriginProductQualityGateV1.ts`
- `src/release/OriginProductQualityGateV1.test.ts`
- `src/agent/heldOutCodingFinalQualificationV14.ts`
- `src/agent/heldOutCodingFinalQualificationV14.test.ts`
- `src/release/OriginHeldOutCandidateQualificationV15.ts`
- `src/release/OriginHeldOutCandidateQualificationV15.test.ts`

## Evidence and limitations

- CODE-PROVEN: the reviewed gate implementations no longer accept the legacy boolean/numeric-zero paths as verified billing evidence.
- TEST-COVERED: regression assertions were added/updated in the affected gate test files.
- EXECUTED: GitHub contents API committed the changes to the existing PR branch.
- UNVERIFIED: the new exact-head CI run has not yet completed at the time this document was authored.
- UNVERIFIED: no provider-authenticated billing receipt, signed receipt verification, durable append-only outbound-attempt ledger, or complete cost-dimension reconciliation exists.
- UNVERIFIED: actual ORIGIN spend remains unmeasured. No claim of `$0.00` is made.
- The runtime-only opaque brand in `OriginCostEvidenceV1` remains intentionally without an issuer. This migration does not invent one.

## Next blocking work

1. Poll all exact-head CI jobs and inspect failures/logs.
2. Review all remaining boolean-only and numeric-zero release gates individually; do not bulk-rewrite policy admission flags.
3. Decide a durable append-only ledger only after identifying an already-approved, provably free persistence boundary. No new service or paid plan is authorized.
4. Identify a Free-plan-compatible authoritative provider billing evidence source; ordinary response usage telemetry is not a signed receipt.
5. Implement and independently review a verifier only after both the full attempt ledger and authoritative provider evidence exist.
6. Wire the opaque verified evidence object into all release gates; keep every gate fail-closed until then.
7. Run the complete exact-head test matrix and independent review before any release decision.

No merge or deployment authorization is implied by this document.
