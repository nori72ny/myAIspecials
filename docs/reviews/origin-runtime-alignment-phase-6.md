# ORIGIN Runtime Alignment — Phase 6 Review and Synthesis Foundation

Target: PR #45  
Tracking issue: #44  
Status: Draft, unmerged, undeployed

## Objective

Create the minimum provider-neutral contract needed to distinguish:

- a primary answer;
- a genuinely independent review;
- an accepted result;
- a result requiring revision;
- a rejected result.

## Implemented

`OriginReviewSynthesis.ts` adds deterministic data contracts and synthesis rules.

The current rules:

- require valid primary and reviewer trace identifiers;
- require provider and model identity for both executions;
- reject reviewer confidence outside `0..1`;
- refuse to call a review independent when the primary and reviewer use the same provider;
- accept the primary answer only when the review decision is `accept` and no required corrections remain;
- return `needs-revision` when corrections are present;
- reject the primary answer when the reviewer decision is `reject`;
- preserve reviewer findings, primary limitations, and both trace IDs.

## Verification

Unit tests cover:

- accepted independent review;
- same-provider non-independence;
- revision-required findings;
- rejected primary result;
- invalid reviewer confidence.

## Important limitation

This phase does not call a second external AI. It establishes deterministic orchestration and audit semantics only. No claim is made that independent multi-AI execution is complete.

Before owner review, the remaining implementation must:

- define when review adds measurable value;
- choose an eligible reviewer with a provider distinct from the primary;
- execute both through the same privacy, zero-cost, data-policy, timeout, and routing-evidence boundary;
- prevent the reviewer from receiving unnecessary private context;
- perform correction or re-execution rather than presenting unverified synthesis as accepted;
- expose conclusion-first status and optional trace details in Personal Edition;
- audit the exact integrated SHA independently.

No merge, deployment, DNS, billing, credential, account, or paid-service action is authorized.
