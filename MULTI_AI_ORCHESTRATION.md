# ACOS 2.0 Multi-AI Orchestration

## Operating model

AI Studio is the default implementation assistant. Specialized work may be delegated to another configured AI when deterministic routing indicates a better fit.

## Initial task classes

- implementation
- review
- security
- UX
- research
- test
- documentation
- operations

## Selection order

1. Classify the request using explicit task type or deterministic keywords.
2. Remove unavailable providers.
3. Under `FREE_ONLY=true`, remove every provider that is not explicitly free-only.
4. Prefer a provider that declares the task as a specialty.
5. Otherwise prefer AI Studio when it supports the task.
6. Return a human-readable selection reason.
7. Select a different review-capable provider for optional verification.

## Permission boundary

No delegated AI may perform any of the following without separate owner approval:

- merge a pull request
- deploy an application
- change DNS
- enter, read, or expose secrets
- enable a paid plan
- select an automatic or paid model

Operations and secret-bearing tasks are always marked as requiring human approval.

## Context minimization

Delegation instructions contain only the task goal, role, cost policy, permission boundary, and expected report. Credentials and unrelated conversation history must not be included.

## First increment

The first increment is deliberately local and deterministic. It does not call AI providers. It supplies:

- provider-neutral task and capability contracts
- an AI Studio-first capability registry
- free-only deterministic routing
- human-readable selection reasons
- optional second-provider verification selection
- copyable delegation instructions
- tests that paid-only providers cannot be selected

Provider execution, UI integration, and audit persistence will be implemented in later increments after the contracts are stable.
