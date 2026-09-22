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
5. The one-shot identity is the **source sealed corpus digest before rebinding**. Therefore the same unseen corpus cannot be tried against candidate A and then reused against candidate B after engineering observes the result.
6. Sanitized preflight evidence contains task IDs and digests only. It never contains prompts, hidden tests, messages or credentials.
7. Preflight executes no candidate code and performs no provider request.
8. Future execution must keep the real provider credential in a trusted proxy boundary. Candidate code must run without provider credentials and without unrestricted network access.
9. Hidden tests must not enter the candidate runtime before the candidate agent has stopped.
10. Any unavailable replay/one-shot protection fails closed.

## Current phase

`trusted-candidate-heldout-preflight-v15.yml` implements the trusted binding and one-shot readiness check only. It deliberately does **not** run the candidate agent yet.

The next phase adds a main-controlled provider proxy and a network-isolated candidate container. That execution phase must pass security tests before this preflight PR is eligible for merge.

No merge, Production deployment or paid provider route is authorized by this document.
