# ORIGIN AQ quota scope audit — 2026-10-18

Status: source-level audit only. No provider requests were sent. This document is not an independent external review, model-quality result, billing receipt, ZDR attestation, or release approval.

## Exact candidate inspected

- PR: https://github.com/nori72ny/myAIspecials/pull/1002
- Branch: `integration/aq-calibration-no-bypass-quota-guard`
- Audited commit before this note: `12ecdac01af63cfa66e6a059dc348f0b2164a99e`
- AQ-40 status: `NOT_MEASURED`

## Confirmed source facts

1. `scripts/check-aq-live-quota-guard.mjs` only recognizes four workflow filenames: `aq-live-lane-shard.yml`, `aq-live-research-shard.yml`, `q1-final-aq.yml`, and `aq-free-provider-calibration.yml`. The workflow-run scan is repository-wide, but the reservation policy is not repository-wide: all other workflow names are ignored.
2. The guard scans prior workflow runs and artifacts and fails closed on malformed or incomplete scans. It is a read-then-check protocol; it is not itself an atomic reservation service.
3. The calibration, unified AQ lane, and Q1 final AQ workflows share `origin-aq-live-unified-lane-shard` and `cancel-in-progress: false`. This serializes those workflows with one another at the Actions workflow concurrency boundary.
4. `trusted-answer-quality-v2.yml` has a separate `origin-aq-v2-trusted-one-shot` group and uses an append-only status ledger / sealed-corpus reservation protocol. `trusted-candidate-heldout-v15.yml` has `origin-held-out-final-one-shot` and its own one-shot marker/status-ledger protocol. Their provider proxies call the OpenRouter-backed provider client.
5. Image bakeoff workflows have separate concurrency groups and explicitly bounded paid-evaluation settings. They must remain outside the zero-cost AQ path unless a separate, explicit policy says otherwise.
6. Existing quota-guard tests cover previous reservations, the 24-hour boundary, pagination, malformed responses, and fail-closed behavior. They do not establish atomicity against concurrent independent callers.

## Interpretation / do not overclaim

- The current guard protects its four enumerated AQ live/calibration workflows only. Calling it a repository-wide or global provider quota is not supported by the implementation.
- The other trusted AQ workflows have separate one-shot mechanisms, but this audit did not prove those mechanisms enforce a common 24-hour request budget across workflows.
- Do not simply add their filenames to `RESERVED_WORKFLOWS`: their marker/artifact names and reservation semantics differ, and the held-out flow uses an append-only status ledger. The guard must explicitly parse and validate each policy or the system must formally document separate budgets.
- GitHub Actions concurrency is a workflow-level mutex only for workflows that use the same group. It is not a distributed lock for unrelated groups, external clients, or production inference calls.

## Required before live AQ-40

1. Decide and document the quota boundary: one repository-wide inference budget, or separate budgets for calibration, AQ V2, held-out coding, image evaluation, and production.
2. If one global budget is required, implement a single reservation authority with atomic create-if-absent / compare-and-swap semantics and immutable request-count accounting. A scan-then-upload artifact cannot provide atomicity.
3. If separate budgets are intended, give each lane its own explicit cap, scope, expiration, and fail-closed enforcement; update misleading "global" wording.
4. Add tests for two simultaneous callers, reservation-write failure, workflow reruns, missing/expired/corrupt records, pagination limits, and all provider-inference entry points.
5. Verify exact-head CI, independently audit the final diff with an external AI reviewer, and only then authorize a bounded public calibration. Record model ID, request count, strict zero cost, BYOK state, ZDR/data-collection policy evidence, and raw sanitized quality outcomes.
6. Run the official frozen 40-case AQ-40 separately from the two-request calibration. Never convert CI success or calibration success into an AQ-40 pass.

## Release decision

**HOLD — do not merge or deploy on this evidence.** No live provider call or production action was performed as part of this audit.
