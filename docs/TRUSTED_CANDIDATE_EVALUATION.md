# Trusted exact-candidate evaluation

This document defines the pre-release evidence path for ORIGIN candidates.

## Problem

The product-quality gate requires evidence bound to one exact release-candidate SHA. The original final held-out Coding workflow is intentionally trusted and one-shot, but it also requires `refs/heads/main`. That creates a release-evidence cycle: an unmerged candidate cannot obtain exact-SHA final Coding evidence without first becoming main.

The solution must **not** solve this by giving a mutable candidate workflow access to the sealed corpus or provider credentials.

## Security invariants

1. The trusted evaluator workflow file must execute from `refs/heads/main`.
2. The candidate SHA must be the exact head of an open same-repository PR targeting `main`.
3. The sealed source corpus is parsed only by trusted main code.
4. Candidate rebinding changes only each private task's `baseSha`; prompt text, hidden tests, required paths, protected paths and time budget remain unchanged.
5. The one-shot identity is the **source sealed corpus digest before rebinding**. The execution workflow records that digest twice before the first provider request: as a retained Actions artifact and as an append-only GitHub Commit Status on the fixed anchor commit `01f7db0c0d48ab3ba533148e99e1847203e13f4c`. Deleting the artifact alone therefore cannot make the corpus appear unused.
6. Sanitized preflight evidence contains task IDs and digests only. It never contains prompts, hidden tests, messages or credentials.
7. Preflight executes no candidate code and performs no provider request.
8. Future execution must keep the real provider credential in a trusted proxy boundary. Candidate code must run without provider credentials and without unrestricted network access.
9. Hidden tests must not enter the candidate runtime before the candidate agent has stopped.
10. Any unavailable replay/one-shot protection fails closed. The fixed commit-status ledger is authoritative for reuse prevention; the artifact is secondary evidence.

## Current phase

`trusted-candidate-heldout-preflight-v15.yml` performs a no-provider readiness check. `trusted-candidate-heldout-v15.yml` is the execution workflow that becomes usable only after this evaluator code is trusted on `main`.

Execution uses two trusted-host Unix sockets: a provider proxy and a verification proxy. The candidate runs inside a Docker container with `--network none`, no provider secret, no sealed corpus, a read-only evaluator mount and bounded proxy capabilities. Every intermediate typecheck/lint/test/build attempt is executed by the host-side verifier and recorded in a host-only journal, so Self Repair evidence does not depend on the candidate's own audit log. After the candidate container exits, both proxies are stopped, the trusted controller independently reads the real diff, injects hidden tests for the first time, and re-runs hidden tests plus typecheck/lint/test/build in separate network-none verification containers. The Q1 Coding qualification is fixed in advance at 100% solved, all axes passing, zero regressions and USD 0.

The workflow reserves the stable sealed **source corpus digest** before the first provider request and also checks the legacy V14 start-marker name, so the same unseen corpus cannot be retested on a later candidate SHA after engineering sees the result.

No merge, Production deployment or paid provider route is authorized by this document.


## Independent-review hardening (2026-09-23)

The Claude independent review of PR #609 found no P0 escape or credential leak. The accepted hardening items are:
- reject trailing-slash relative paths and explicit hard-linked changed files;
- cap verifier-proxy concurrent connections and request/header timing;
- add a CI contract test that locks network-none, secret exclusion, proxy shutdown-before-hidden-test ordering and the one-shot ledger order;
- make the one-shot reservation resilient to Actions artifact deletion by recording the source corpus digest in GitHub Commit Status history on the fixed anchor commit before any provider execution.

The remaining limitation is explicit: the real secret-bearing one-shot qualification workflow cannot be executed until this evaluator infrastructure itself is trusted on `main`. Pre-merge CI proves its components and ordering, not a completed sealed-corpus qualification run.


### Cross-version one-shot compatibility

V14 final-held-out and V15 exact-candidate qualification use the same repository-wide concurrency group and the same fixed commit-status ledger context `origin/heldout-source/<sourceDigest>`. A corpus reserved by either evaluator is rejected by the other evaluator before any provider request. This closes the cross-version reuse path as well as the artifact-deletion-only path.
