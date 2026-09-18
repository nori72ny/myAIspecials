# ORIGIN — Answer Quality Slice Acceptance Criteria

## AQ-1 Evidence Ledger

Pass when:
- append-only immutable record API exists;
- secret-like values are rejected/redacted by contract;
- cost and source kind are mandatory;
- records can map evidence to material claim IDs;
- unit tests cover invalid input and serialization.

## AQ-2 Material Claim Contract

Pass when:
- claim types are bounded;
- freshness/evidence requirements are explicit;
- execution claims are distinguishable from recommendations/inferences;
- claim count is bounded;
- no raw chain-of-thought field exists.

## AQ-3 Independent Verifier

Pass when:
- PASS / REPAIR_REQUIRED / BLOCKED_UNVERIFIED are exhaustive;
- missing evidence prevents PASS;
- stale required evidence prevents PASS;
- contradictory material evidence prevents unconditional PASS;
- independent-review-required cannot PASS without qualifying evidence;
- coding verified state cannot be synthesized by this verifier.

## AQ-4 Chat Integration

Pass when:
- current zero-cost routing remains intact;
- MAX_RETRIES=0 remains intact where required;
- provider failures still fail closed;
- evidence ledger is produced without leaking secrets;
- required verification affects final answer status.

## AQ-5 Research Integration

Pass when:
- existing retrieval-evidence-only semantics are preserved;
- source freshness reaches common evidence records;
- citation IDs map to actual URLs;
- structured conflicts reach verifier;
- self-presented provider citation alone is not treated as independently verified.

## AQ-6 Repair Loop

Pass when:
- repair rounds are strictly bounded;
- repair actions are generated only from verifier failures;
- exhausted budget returns blocked/unverified;
- no silent fallback to paid provider;
- evidence from prior failed state cannot be reused as if current when invalidated.

## AQ-7 Presenter/UI

Pass when:
- verified / unverified / blocked states are visible;
- limitations are textual, not color-only;
- sources are clickable when real;
- no fake percentage/ETA/confidence;
- no hidden chain-of-thought exposure.

## AQ-8 Benchmark Harness

Pass when:
- corpus is separate from V1.4 final unseen;
- Before/After exact SHAs are recorded;
- raw evidence is preserved;
- scoring is deterministic where feasible;
- hard failures are surfaced separately from quality metrics;
- total cost is measured and must remain 0 for production policy.

## Final integration acceptance

All AQ slices plus:
- full CI;
- security gates;
- browser gates;
- hosted coding sandbox;
- production health;
- main SHA == production SHA;
- no secret leakage;
- no paid fallback;
- exact release evidence recorded.
