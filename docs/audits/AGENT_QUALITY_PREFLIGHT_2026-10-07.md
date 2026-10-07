# General Agent quality inspection preflight — 2026-10-07

Base: `4cc17a7fe78c9141bc54b94110828475b2f7e6b8`.
Scope: legacy General Agent V3. Coding V1.4, answer-quality candidates and image generation are separate workstreams.

## Changes needed before assessment

- The artifact verifier previously fabricated a recovered placeholder from empty output, stripped data, balanced brackets and truncated long output while marking it verified. Recovery now requires a successful bounded read-only rerun. Failed/wrong-tool reruns cannot supply recovery evidence. Writes, verification commands, research and generation are not repeated by this verifier.
- File reading previously silently dropped text after 12,000 characters. Return the complete bounded file up to 120,000 characters; reject larger content with no partial artifact. Reject oversized string parameters rather than execute a different truncated request.
- Read source text verbatim, including `undefined` and incomplete examples. Reading a file does not assert that its code is syntactically valid.
- Status explicitly distinguishes authorization/replay readiness from quality certification and identifies the unavailable code/document generation tools.

These checks are structural preflight, not task correctness, semantic verification, model quality, or external comparison. No new generation backend is claimed.

## Submission boundaries

| Inspection | Eligible scope | Required evidence / outstanding work |
| --- | --- | --- |
| Automated regression | Artifact integrity, approval/replay/cancel and existing Agent modules | Exact candidate commit, test output and typecheck |
| Visible internal HTTP diagnostic | Existing 12-task synthetic suite | Disposable clean checkout; all attempts and failures reported; never label as sealed/final |
| Live task-quality inspection | Repository reading, research, actual code/document outputs | Independent expected results, hashes and complete artifacts, goal-specific assertions and failure evidence |
| Sealed independent final evaluation | Frozen qualified candidate and unseen task corpus | Separate evaluator trust boundary, durable one-shot prevention, task-level verification; unavailable generation remains a blocker |
| External-AI comparison | Same tasks, budgets, permissions and evaluation rules | Real comparator outputs and blind assessment; currently not measured |

## Remaining blockers

1. `code_interpreter` and `document_generator` still return unavailable. Connect real generation/execution and independent task verifiers before including them as supported quality-inspection capabilities.
2. FIXED for exact-output tasks: the private runner now requires evaluator-owned SHA-256 and UTF-8 byte-length expectations before emitting verification-passed. Expectations are digest-bound and omitted from public tasks and tool requests. Semantic/non-deterministic quality assertions and isolated evaluator execution remain required for a final qualification.
3. Cleanup is now disabled until explicit disposable-checkout opt-in, corpus validation, exact-SHA validation and the clean-checkout check succeed. Child-process regressions confirm early errors preserve tracked edits and untracked files. The runner must still only be used in a disposable checkout.
4. Candidate runtime shares the evaluator process and environment in the existing private runner. Do not expose a new final private corpus until isolation and credential separation have been reviewed.
5. The workflow's one-shot marker is an expiring artifact. It is not permanent replay prevention; do not claim a durable final one-shot qualification from it.
6. Live deployment, Android UI and full multistep autonomous execution remain separate checks.

## Reproduce regression checks

```sh
npm ci --ignore-scripts --no-audit --no-fund
npx vitest run src/agent
npm run typecheck
```

For the visible diagnostic, use a disposable clean Git worktree with installed dependencies and run `ORIGIN_GENERAL_AGENT_DISPOSABLE_CHECKOUT=true node --import tsx scripts/run-general-agent-synthetic-live-v2.ts`. Do not supply private final corpus data. Do not run the private runner against a user's working checkout.

No main merge, production deployment, paid fallback or new external permissions in this change.

## Executed evidence

Runtime/test revision: `f590608385950c1e871b529b6a15784479b29b76`.

- Agent regression: 69 test files, 460 tests passed, including 16 new integrity/recovery cases. The initial focused run had 53 passing tests before the status metadata addition; the 460-test run includes that addition.
- TypeScript `tsc --noEmit`: passed.
- Production bundle build (`vite build` and server esbuild): passed.
- Visible internal HTTP diagnostic in a separate clean disposable checkout: 12 attempted, 8 scored successful, 4 failed. The 8 consist of two cancellation cases and six repeated repository exploration cases; this is not broad agent capability coverage.
- Failed diagnostic task IDs: `internal-live-agent-01`, `02`, `03` (code recovery), and `06` (research). The diagnostic reports planning/tool-choice, execution and verification blockers, plus recovery blockers on the first three. Its aggregated codes do not independently establish the exact upstream cause. The code/document adapters' unavailability is separately confirmed in source and HTTP regressions.
- Diagnostic output reported `zeroCostSafe=true`; this reflects the internal response/status checks, not an independent billing audit.
- No sealed final corpus used, no external comparator run, no production-quality certification.
- Remote branch push was blocked by automatic approval review, citing unverified authorization to transmit repository source/history to the GitHub destination. No attempt through an alternative write tool was made. Approval to push the review branch and open its PR remains required; no merge/deployment is requested.


## Follow-up adjustment and actual diagnostic

Candidate runtime/evaluator revision: `21f2011490ff7df035747e9570ba029f9eb5e4e1`.

- Agent regression: 71 files / 471 tests passed. TypeScript passed, including the updated diagnostic script.
- The new diagnostic replaces six duplicate repository-overview cases with six different full-file reads. All six actual HTTP outputs matched evaluator-side hashes and byte counts. Two cancellation cases also passed: 8/12 total.
- The three code-repair cases still return HTTP 422 because legacy generation is unavailable; no repairs or task correctness are claimed. The research case also returns 422 through Agent V3.
- A separate direct Research V1.1 diagnostic identified DNS_FAILURE for both encyclopedia-search and web-search in all three attempts (HTTP 503 / RESEARCH_SOURCE_UNAVAILABLE). This is an environment retrieval blocker, not a measured answer-quality failure. No alternative network path or paid provider was used.
- Exact-output expectations fail closed when absent, malformed, truncated, altered, or oversized. They do not claim semantic correctness for arbitrary generated reports/code. Future generative inspection needs task-specific execution/content assertions.
- Push was again rejected by automatic approval review after the continuation request; the stated requirement is explicit permission for repository code/history disclosure and branch push. No remote workaround was attempted. Remote CI and PR creation remain blocked.

Current disposition: local inspection preparation and regression complete for the changes above; the full General Agent is NOT READY for final independent quality qualification. Outstanding: real code/document generation backend, network-enabled Research verification, semantic task verification/isolation, and authorized remote review/CI. No production changes.

## Inspection packet — final local boundary

Runtime revision: `575d72b72cc7a6901724f88bb6a3399a63ba766a`.

- Added `scripts/prepare-agent-quality-inspection.ts`: a one-command local HTTP inspection with separate ephemeral signing/operator credentials and temporary fixtures. It does not reset the source checkout or call external providers. Actual and expected artifacts, result rows and a SHA-256/byte-length manifest are retained.
- Added a PR CI job to preserve the packet, including failed case evidence. It is only configured locally; no remote PR/CI run is claimed.
- Fixed legitimate empty/whitespace file reads being rejected through both Agent orchestrator paths. Missing output remains rejected. Independent expected-output checks now accept an explicitly expected zero-byte file.
- Regression: 71 files / 475 tests passed. TypeScript passed. Local HTTP packet: 15/15 passed, comprising status, six exact-file reads (including empty, whitespace, Japanese, long text, incomplete source text and the 120000-character boundary), oversize rejection, authentication, parameter tampering, invalid approval, replay, cancellation and truthful rejection of unavailable code/document generation.
- The first packet run had 12/13 due to a fixture accidentally sized at 120001 characters. The fixture was corrected to compute its padding from the actual sentinel length. No production limit was relaxed. The earlier result is retained as a harness-development record.
- These are observable regression inputs/results for technical inspection. Code/document generation, live research, semantic task quality, independent sealed evaluation and production CI remain unqualified. The packet does not convert blocked generation into a passing feature.
