# ORIGIN Agent/Coding V3 independent 24-task release scoring — 2026-10-09

Status: **candidate gate only / NOT_MEASURED / DO NOT RELEASE**.

## Trust boundary

The candidate repository must not own, generate, read or hold the independent evaluator's Ed25519 **private key**, secret task packet, or reference-agent transcripts. Only the evaluator has signing authority. The verifier receives a pinned evaluator **public** key and expected sealed-corpus digest, one-shot run ID, and exact candidate/release SHA from a protected execution environment. None can be supplied by the candidate or via an HTTP request.

The signing payload is `canonicalAgentFrontierEvidenceV3(input)`: it binds each of the frozen 24 task IDs and all outcome/evidence fields to the candidate SHA, corpus identity and evaluation run. Signature is Ed25519 raw 64 bytes encoded as base64url, over the UTF-8 canonical payload. `attestation.signature` is intentionally **not** part of the signed payload.

Required independent evaluator inputs (configured out-of-band, never committed):

- `ORIGIN_AGENT_FRONTIER_EVALUATOR_PUBLIC_KEY_PEM` — trusted Ed25519 public key in PEM SPKI format
- `ORIGIN_AGENT_FRONTIER_CORPUS_SHA256` — frozen secret-corpus digest, supplied by evaluator
- `ORIGIN_AGENT_FRONTIER_RUN_ID` — unique one-shot evaluation round ID
- `ORIGIN_AGENT_FRONTIER_CANDIDATE_SHA` — exact 40-character release candidate commit

The sealed signed JSON ledger must contain `version`, `candidateSha`, the 24 `tasks`, and `attestation: { corpusDigest, evaluationRunId, signature }`.

Independent evaluator signs the canonical payload **only after** it checks the original task packets, tool-execution traces, changed-path evidence, final verification state, cost and approval logs. Merely hashing or signing candidate-supplied synthetic scores is not proof of correct execution.

## How to evaluate

The evaluator prepares a private one-shot ledger outside the repository, signs it with its own private key in its protected environment, and runs:

```bash
npm run eval:agent-frontier-24 -- /secure/evaluator/ledger.json
```

This command prints aggregate scores and safe blocker codes only. Exit 0 means the **signed 24-task scoring gate** passed; exit 1 means a measured or trust constraint failed; exit 2 means input or evaluator configuration could not be validated. Never upload the hidden ledger or signing key to a public PR, screenshot, artifact or job log.

## Promotion is still separate

Even a signed 24-task scoring PASS does **not** grant autonomous Production deployment. Require independent technical review, latest exact-head CI, fresh live production smoke on the promoted build, no P0/P1 or false-completion, $0 without paid fallback, all required privacy/security checks, and Owner visual approval. Do not auto-enable the Agent-Coding bridge or merge the Draft candidate.

This addition is a verifier/trust-boundary implementation. It does not itself execute the 24 hidden tasks, create independent reference-agent runs, or prove Astra-class task completion.
