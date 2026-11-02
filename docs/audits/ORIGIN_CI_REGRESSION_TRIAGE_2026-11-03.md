# ORIGIN CI Regression Triage and Remediation — 2026-11-03

Latest branch head after remediation: `f43febf01ce174395074f743d27c8be90255e078`.
PR #1083 remains Draft, open, unmerged and undeployed.

## 20 engineering checkpoints

1. Refreshed PR #1083 and confirmed the active branch and exact head SHA.
2. Retrieved exact-head job summaries rather than relying on an earlier SHA's green checks.
3. Confirmed TypeScript/design-token lint passed on the code-bearing SHA `80bf0eff...`.
4. Confirmed the explicit TypeScript typecheck passed on that SHA.
5. Waited for core unit tests to finish; they failed, so the run was not treated as a pass.
6. Retrieved the full GitHub Actions job log for the failing test job.
7. Confirmed the run executed 3,135 tests: 3,133 passed and 2 failed across 356 files.
8. Identified the first failure in `OriginAnswerExperienceV2.test.ts`: the test expected an old blocker list that omitted the newly correct `AQ_V2_ZERO_COST_NOT_PROVEN`.
9. Updated that test to require the new blocker; production gate behavior was not weakened.
10. Identified the second failure in `OriginHeldOutCandidateQualificationV15.test.ts`: the upper gate could still accept `evidence.eligible === true` without verifying the cost evidence object.
11. Re-read `OriginCostEvidenceV1.ts` and confirmed its runtime-only brand and `isOriginCostZeroVerifiedV1` verifier check.
12. Extended held-out final evidence to carry the typed `OriginCostEvidenceV1` object in addition to its explicit status.
13. Changed the held-out summarizer to emit a real `NOT_MEASURED` object via `createOriginCostNotMeasuredV1`, not a caller-asserted string alone.
14. Changed V1.5 qualification to require `isOriginCostZeroVerifiedV1(evidence.costEvidence)`; a caller-supplied boolean or status string cannot qualify.
15. Changed the public `zeroCost` output to reflect only the runtime-branded evidence result.
16. Normalized all non-branded input with `classifyOriginCostEvidenceV1`; a JSON-shaped forged `ZERO_COST_VERIFIED` claim becomes `BLOCKED_UNVERIFIED`.
17. Added a regression test that forges the full JSON receipt shape and proves it cannot pass the held-out gate.
18. Updated the world-class gate test to expect its explicit new zero-cost blocker.
19. Preserved performance evidence separately: held-out scores and task completion can be reported, but cannot override missing billing proof.
20. Confirmed the latest commits triggered fresh exact-head CI; the new SHA's checks are queued and must complete before this remediation can be called verified.

## Failing-run evidence

Workflow run: `41544702851`, job `125617315928`.
- TypeScript/design-token lint: success.
- Explicit typecheck: success.
- Core unit tests: failure.
- 3,133 tests passed; 2 failed.
- Failures were the stale blocker expectation and the missing branded-evidence condition described above.
- Integration API tests, build, and runtime checks were skipped because the core test step failed.

## Current verification

Latest head: `f43febf01ce174395074f743d27c8be90255e078`.
Fresh checks:
- Verify Quality & Code Guidelines: queued (run `41545393098`).
- CodeQL: queued (run `41545393417`).
- Scorecard Analysis: queued (run `41545393082`).

No success claim is made for these fresh runs until they complete.

## Cost / release posture

- The held-out path now checks the opaque runtime brand rather than trusting a boolean, numeric zero, or JSON status.
- No issuer exists for `ZERO_COST_VERIFIED`; therefore current held-out runs remain unqualified for zero-cost release.
- Provider billing remains NOT_MEASURED; no `$0.00` claim is made.
- No provider inference, paid API, paid database, new cloud resource, secret/account setting change, merge or deployment was performed.
- PR remains Draft and NO-GO for release until exact-head CI, independent review, full ledger and trusted provider evidence are complete.
